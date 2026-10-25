import {actor,checkOrigin,json,failure,db,getEntry,mutate} from '../../../lib/server';
import {validateEntry} from '../../../lib/domain';
export async function POST(r:Request){try{checkOrigin(r);const u=await actor(r),x:any=await r.json();if(typeof x.snapshotId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(x.snapshotId)||!Array.isArray(x.rows)||x.rows.length>10)throw new Error('恢复分块无效');let restored=0,skipped=0;
 for(const row of x.rows){if(!['entry','revision'].includes(row.type))throw new Error('恢复行类型无效');const e=row.entry;validateEntry(e);if(['backup','export'].includes(e.kind))throw new Error('不能恢复临时备份记录');if(row.type==='revision'){if(!Number.isInteger(e.version)||e.version<1||typeof e.updated!=='string')throw new Error('历史版本无效');await db().prepare('INSERT OR IGNORE INTO revisions(owner,id,kind,payload,version,deleted,updated) VALUES (?,?,?,?,?,?,?)').bind(u.id,'archive:'+e.id,e.kind,JSON.stringify(e.data),e.version,e.deleted?1:0,e.updated).run();restored++;continue;}
  const old=await getEntry(u.id,e.id);
  if(e.kind==='file'){
   if(!old||old.kind!=='file'||old.data.hash!==e.data.hash||old.data.size!==e.data.size)throw new Error('附件字节尚未完整恢复：'+e.id);
   if(old.data.restoreSession===x.snapshotId){const data={...e.data,key:old.data.key};delete data.restoreSession;await mutate(u.id,{id:e.id,kind:e.kind,data,deleted:!!e.deleted,baseVersion:old.version,operationId:'restore-meta:'+x.snapshotId+':'+e.id,internal:true});restored++;}else skipped++;
  }else if(old){if(['folder','taxonomy'].includes(e.kind)&&old.data.restoreSession===x.snapshotId){await mutate(u.id,{id:e.id,kind:e.kind,data:e.data,deleted:!!e.deleted,baseVersion:old.version,operationId:'restore-folder:'+x.snapshotId+':'+e.id,internal:true});restored++;}else skipped++;}
  else{await mutate(u.id,{id:e.id,kind:e.kind,data:e.data,deleted:!!e.deleted,baseVersion:0,operationId:'restore-v2:'+x.snapshotId+':'+e.id,internal:true});restored++;}
 }
 return json({restored,skipped});
 }catch(e){return failure(e);}}
