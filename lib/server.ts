import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../app/chatgpt-auth';
import {fileMetadataChangeAllowed} from './workspace';
import { validateEntry, type Entry } from './domain';
import {readRecordCursor,nextRecordCursor} from './record-pagination';
export function db(){if(!env.DB)throw new Error('数据库尚未接通');return env.DB;}
export function bucket(){if(!env.BUCKET)throw new Error('附件存储尚未接通');return env.BUCKET;}
export function json(data:any,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export async function actor(request:Request){const u=await getChatGPTUser();if(u)return {id:u.userId,email:u.email,name:u.displayName||u.email,preview:false};if(import.meta.env.DEV&&['terminal.local','localhost','127.0.0.1'].includes(new URL(request.url).hostname))return{id:'preview-only',email:'本地验收',name:'验收空间',preview:true};throw Object.assign(new Error('请登录后继续'),{status:401});}
export function checkOrigin(r:Request){const origin=r.headers.get('origin');if(origin&&origin!==new URL(r.url).origin)throw Object.assign(new Error('不允许跨站修改'),{status:403});}
export async function hash(value:string|ArrayBuffer){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export function parseRow(r:any):Entry{return{id:r.id,kind:r.kind,data:JSON.parse(r.payload),version:r.version,deleted:!!r.deleted,updated:r.updated};}
export async function getEntry(owner:string,id:string){const r=await db().prepare('SELECT * FROM records WHERE owner=? AND id=?').bind(owner,id).first();return r?parseRow(r):null;}
export async function recordPage(owner:string,cursor:string|null=null,since:string|null=null){
 const c=readRecordCursor(cursor,since),values:any[]=[owner,c.until];
 let where="owner=? AND kind NOT IN ('export','backup') AND updated<=?";
 if(c.since){where+=' AND updated>=?';values.push(c.since);}
 if(c.updated){where+=' AND (updated>? OR (updated=? AND id>?))';values.push(c.updated,c.updated,c.id);}
 const rows=(await db().prepare('SELECT * FROM records WHERE '+where+' ORDER BY updated,id LIMIT 251').bind(...values).all()).results.map(parseRow);
 const entries=rows.slice(0,250);
 return {entries,nextCursor:rows.length>250?nextRecordCursor(c,entries[entries.length-1]):null,until:c.until};
}
export async function allEntries(owner:string){
 const out:Entry[]=[];let after='';
 while(true){const rows=(await db().prepare("SELECT * FROM records WHERE owner=? AND id>? AND kind NOT IN ('export','backup') ORDER BY id LIMIT 500").bind(owner,after).all()).results.map(parseRow);out.push(...rows);if(rows.length<500)return out;after=rows[rows.length-1].id;}
}
export async function mutate(owner:string,input:any){
 const {id,kind,data,baseVersion,operationId}=input;validateEntry({id,kind,data});
 if(['backup','export'].includes(kind)&&!input.internal)throw Object.assign(new Error('备份必须通过备份管理接口操作'),{status:403});
 if(!Number.isInteger(baseVersion)||baseVersion<0||typeof operationId!=='string'||!operationId.length||operationId.length>180)throw new Error('版本或操作ID无效');
 if(input.deleted!==undefined&&typeof input.deleted!=='boolean')throw new Error('回收状态无效');
 if(kind==='file'&&!input.internal){const old=await getEntry(owner,id);if(!old||!fileMetadataChangeAllowed(old.data,data))throw Object.assign(new Error('附件只能通过上传接口登记'),{status:403});}
 const h=await hash(JSON.stringify({id,kind,data,baseVersion,deleted:!!input.deleted}));
 const prior:any=await db().prepare('SELECT * FROM operations WHERE owner=? AND id=?').bind(owner,operationId).first();
 if(prior){if(prior.hash!==h)throw Object.assign(new Error('操作ID已用于另一请求'),{status:409});return JSON.parse(prior.response);}
 if(data.folderId){const folder=await getEntry(owner,data.folderId);if(!folder||folder.kind!=='folder'||(folder.deleted&&!input.internal))throw new Error('目标文件夹不存在');}
 if(kind==='folder'&&data.parentId){let parent=data.parentId;const seen=new Set([id]);while(parent){if(seen.has(parent))throw new Error('文件夹不能移动到自己或后代');seen.add(parent);const item=await getEntry(owner,parent);if(!item||item.kind!=='folder'||(item.deleted&&!input.internal))throw new Error('父文件夹不存在');parent=item.data.parentId;}}
 if(kind==='taxonomy'&&data.parentId){let parent=data.parentId;const seen=new Set([id]);while(parent){if(seen.has(parent))throw new Error('分类不能形成循环');seen.add(parent);const row=await getEntry(owner,parent);if(!row||(!input.internal&&row.deleted)||row.kind!=='taxonomy')throw new Error('父分类不存在');parent=row.data.parentId;}}
 if(kind==='submission'){const a=await getEntry(owner,data.attemptId);if(!a||a.kind!=='attempt'||(!input.internal&&a.deleted)||a.data.problemId!==data.problemId)throw new Error('提交必须关联当前账号的一次有效尝试');const levels=['未知','独立','实现提示','思路提示','题解','完整代码'];const earlier=await db().prepare("SELECT payload FROM records WHERE owner=? AND kind='submission' AND deleted=0").bind(owner).all();const highest=Math.max(levels.indexOf(a.data.help),...earlier.results.map((r:any)=>JSON.parse(r.payload)).filter((r:any)=>r.attemptId===data.attemptId).map((r:any)=>levels.indexOf(r.help)));if(!input.internal&&!data.correctionAt&&levels.indexOf(data.help)<highest)throw new Error('本次已记录更高程度帮助；请按实际最高程度记录，误录请更正');}
 if(kind==='problem'&&data.url&&!/^https?:\/\//.test(data.url))throw new Error('题目入口须为HTTP或HTTPS链接');
 const old=await getEntry(owner,id);if((old?.version??0)!==baseVersion)throw Object.assign(new Error('其他设备已修改，请保留草稿并处理冲突'),{status:409,current:old});
 if(old&&old.kind!==kind)throw new Error('不能更改记录类型');
 if(old?.deleted&&!input.restore&&input.deleted!==true)throw Object.assign(new Error('记录已在回收站，请显式恢复'),{status:409,current:old});
 const now=new Date().toISOString(),version=baseVersion+1,payload=JSON.stringify(data),deleted=input.deleted?1:0;
 const result={id,kind,data,version,deleted:!!deleted,updated:now};const guard=crypto.randomUUID();
 const transferGuard=input.internal&&input.guardTransfer?input.guardTransfer:null;
 const relatedGuard=input.internal&&input.guardRecord?input.guardRecord:null;
 try{await db().batch([
  db().prepare('INSERT INTO guards(id,ok) VALUES (?,CASE WHEN COALESCE((SELECT version FROM records WHERE owner=? AND id=?),0)=? THEN 1 ELSE 0 END)').bind(guard,owner,id,baseVersion),
  ...(relatedGuard?[db().prepare('INSERT INTO guards(id,ok) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM records WHERE owner=? AND id=? AND version=? AND deleted=0) THEN 1 ELSE 0 END)').bind(guard+':parent',owner,relatedGuard.id,relatedGuard.version)]:[]),
  ...(transferGuard?[db().prepare("INSERT INTO guards(id,ok) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM transfers WHERE owner=? AND id=? AND state='completing' AND expires>?) AND (SELECT COALESCE(SUM(CAST(json_extract(payload,'$.size') AS INTEGER)),0) FROM records WHERE owner=? AND kind='file')+(SELECT COALESCE(SUM(size),0) FROM transfers t WHERE t.owner=? AND t.state IN ('uploading','completing') AND t.expires>? AND NOT EXISTS(SELECT 1 FROM records r WHERE r.owner=t.owner AND r.id=t.id AND r.kind='file'))<=1073741824 THEN 1 ELSE 0 END)").bind(guard+':transfer',owner,transferGuard,Date.now(),owner,owner,Date.now())]:[]),
  db().prepare('INSERT INTO operations(owner,id,hash,response,created) VALUES (?,?,?,?,?)').bind(owner,operationId,h,JSON.stringify(result),now),
  db().prepare('INSERT INTO records(owner,id,kind,payload,version,deleted,updated) VALUES (?,?,?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET payload=excluded.payload,version=excluded.version,deleted=excluded.deleted,updated=excluded.updated').bind(owner,id,kind,payload,version,deleted,now),
  db().prepare('INSERT INTO revisions(owner,id,kind,payload,version,deleted,updated) VALUES (?,?,?,?,?,?,?)').bind(owner,id,kind,payload,version,deleted,now),
  db().prepare('DELETE FROM guards WHERE id=?').bind(guard),
  ...(transferGuard?[db().prepare('DELETE FROM guards WHERE id=?').bind(guard+':transfer')]:[]),
  ...(relatedGuard?[db().prepare('DELETE FROM guards WHERE id=?').bind(guard+':parent')]:[])
 ]);}catch(error){const p:any=await db().prepare('SELECT * FROM operations WHERE owner=? AND id=?').bind(owner,operationId).first();if(p&&p.hash===h)return JSON.parse(p.response);throw Object.assign(new Error('保存冲突，云端版本未被覆盖'),{status:409,current:await getEntry(owner,id)});}
 return result;
}
export function failure(e:any){return json({error:e.message||'操作失败',current:e.current??null},e.status??400);}
