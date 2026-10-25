import { env } from 'cloudflare:workers';
import {db,getEntry,hash} from './server';
import type {Entry} from './domain';
/** D1 batch is transactional: published content and the final receipt become visible together. */
export async function applyContentBatch(batchId:string,items:any[],digest:string,owner='__content__'){
 const receiptId='batch-'+batchId,guard='coach:'+crypto.randomUUID(),now=new Date().toISOString();
 const oldReceipt=await getEntry(owner,receiptId);if(oldReceipt){if(oldReceipt.data.hash!==digest)throw new Error('批次ID已用于不同内容');return oldReceipt.data;}
 const out:Entry[]=[],statements:any[]=[];
 for(const item of items){
  const old=await getEntry(owner,item.id);const expected=item.baseVersion??0;
  if((old?.version??0)!==expected)throw Object.assign(new Error('内容版本冲突；本批尚未应用'),{status:409,current:old});
  if(old?.kind&&old.kind!==item.kind)throw new Error('不能更改内容类型');
  out.push({id:item.id,kind:item.kind,data:item.data,version:expected+1,deleted:false,updated:now});
 }
 const receipt={batchId,completed:items.length,total:items.length,hash:digest,status:'已应用',atomic:true,at:now};
 out.push({id:receiptId,kind:'update',data:receipt,version:1,deleted:false,updated:now});
 for(let i=0;i<out.length;i++){
  const e=out[i],expected=e.version-1,g=guard+':'+i,payload=JSON.stringify(e.data),op='coach-item:'+await hash(batchId+':'+e.id);
  const operationHash=await hash(JSON.stringify({id:e.id,kind:e.kind,data:e.data,baseVersion:expected,deleted:false}));
  statements.push(db().prepare('INSERT INTO guards(id,ok) VALUES (?,CASE WHEN COALESCE((SELECT version FROM records WHERE owner=? AND id=?),0)=? THEN 1 ELSE 0 END)').bind(g,owner,e.id,expected));
  statements.push(db().prepare('INSERT INTO records(owner,id,kind,payload,version,deleted,updated) VALUES (?,?,?,?,?,0,?) ON CONFLICT(owner,id) DO UPDATE SET payload=excluded.payload,version=excluded.version,deleted=0,updated=excluded.updated').bind(owner,e.id,e.kind,payload,e.version,now));
  statements.push(db().prepare('INSERT INTO revisions(owner,id,kind,payload,version,deleted,updated) VALUES (?,?,?,?,?,0,?)').bind(owner,e.id,e.kind,payload,e.version,now));
  statements.push(db().prepare('INSERT INTO operations(owner,id,hash,response,created) VALUES (?,?,?,?,?)').bind(owner,op,operationHash,JSON.stringify(e),now));
  statements.push(db().prepare('DELETE FROM guards WHERE id=?').bind(g));
 }
 try{await db().batch(statements);}catch{
  const known=await getEntry(owner,receiptId);if(known?.data.hash===digest)return known.data;
  throw Object.assign(new Error('批次提交冲突，事务已回滚；请回读当前版本后重试'),{status:409});
 }
 return receipt;
}
export function coachAccessBoundary(r:Request,token:string|undefined=env.COACH_TOKEN){
 // 服务凭据已配置时只认 x-coach-token 完全匹配，不依赖主机名白名单。
 if(token){if(r.headers.get('x-coach-token')!==token)throw Object.assign(new Error('教练凭据无效'),{status:401});return;}
 // 凭据未配置：维持原主机名白名单。
 // Private Sites dispatch validates viewer/service credentials before requests reach this Worker.
 // Service bypass intentionally carries no visitor identity. Requiring a visitor would break it.
 const host=new URL(r.url).hostname;
 if(host==='algonotes-training-workbench.basiccreek2.chatgpt.site')return;
 if(import.meta.env.DEV&&['terminal.local','localhost','127.0.0.1'].includes(host))return;
 throw Object.assign(new Error('教练入口仅用于当前私人站点'),{status:403});
}
