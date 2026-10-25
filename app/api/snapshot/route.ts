import {ensurePreviewSchema} from '../../../lib/preview-schema';
import {actor,checkOrigin,db,json,failure} from '../../../lib/server';
const PAGE=10;
export async function POST(r:Request){try{await ensurePreviewSchema();checkOrigin(r);const u=await actor(r),id=crypto.randomUUID(),now=new Date().toISOString();
 await db().batch([
 db().prepare('DELETE FROM snapshot_rows WHERE owner=? AND snapshot IN (SELECT id FROM snapshots WHERE owner=? AND expires<=?)').bind(u.id,u.id,Date.now()),
 db().prepare('DELETE FROM snapshots WHERE owner=? AND expires<=?').bind(u.id,Date.now()),
 db().prepare('INSERT INTO snapshots(owner,id,created,expires) VALUES (?,?,?,?)').bind(u.id,id,now,Date.now()+86400000),
 db().prepare("INSERT INTO snapshot_rows(owner,snapshot,row,type,payload) SELECT ?,?,ROW_NUMBER() OVER(ORDER BY type,id,version),type,json_object('id',id,'kind',kind,'data',json(payload),'version',version,'deleted',json(CASE WHEN deleted=1 THEN 'true' ELSE 'false' END),'updated',updated) FROM (SELECT 'entry' AS type,* FROM records WHERE owner=? AND kind NOT IN ('backup','export') UNION ALL SELECT 'revision' AS type,* FROM revisions WHERE owner=? AND kind NOT IN ('backup','export'))").bind(u.id,id,u.id,u.id)
 ]);
 const counts=(await db().prepare('SELECT type,COUNT(*) AS count FROM snapshot_rows WHERE owner=? AND snapshot=? GROUP BY type').bind(u.id,id).all()).results;
 const total=counts.reduce((n:number,c:any)=>n+Number(c.count),0);
 return json({snapshotId:id,createdAt:now,total,pageSize:PAGE,entries:Number((counts.find((c:any)=>c.type==='entry') as any)?.count)||0,revisions:Number((counts.find((c:any)=>c.type==='revision') as any)?.count)||0});
 }catch(e){return failure(e);}}
export async function GET(r:Request){try{await ensurePreviewSchema();const u=await actor(r),q=new URL(r.url).searchParams,id=q.get('id')||'',s:any=await db().prepare('SELECT * FROM snapshots WHERE owner=? AND id=? AND expires>?').bind(u.id,id,Date.now()).first();if(!s)throw new Error('快照不存在或已过期');
 const after=Number(q.get('after')||0);if(!Number.isInteger(after)||after<0)throw new Error('快照游标无效');
 if(q.get('catalog')==='1'){
 const rows=(await db().prepare("SELECT row,json_extract(payload,'$.id') AS id,json_extract(payload,'$.data.name') AS name,json_extract(payload,'$.data.hash') AS hash,json_extract(payload,'$.data.size') AS size FROM snapshot_rows WHERE owner=? AND snapshot=? AND type='entry' AND json_extract(payload,'$.kind')='file' ORDER BY row").bind(u.id,id).all()).results;
 const folders=(await db().prepare("SELECT json_extract(payload,'$.id') AS id,json_extract(payload,'$.data.title') AS title,json_extract(payload,'$.data.parentId') AS parentId FROM snapshot_rows WHERE owner=? AND snapshot=? AND type='entry' AND json_extract(payload,'$.kind')='folder' ORDER BY row").bind(u.id,id).all()).results;
 return json({files:rows,folders});}
 const rows=(await db().prepare('SELECT row,type,payload FROM snapshot_rows WHERE owner=? AND snapshot=? AND row>? ORDER BY row LIMIT ?').bind(u.id,id,after,PAGE).all()).results;
 return json({rows:rows.map((x:any)=>({row:x.row,type:x.type,entry:JSON.parse(x.payload)})),after:rows.length?rows[rows.length-1].row:after});
 }catch(e){return failure(e);}}
export async function DELETE(r:Request){try{await ensurePreviewSchema();checkOrigin(r);const u=await actor(r),q=new URL(r.url).searchParams,id=q.get('id');await db().batch([db().prepare('DELETE FROM snapshot_rows WHERE owner=? AND snapshot=?').bind(u.id,id),db().prepare('DELETE FROM snapshots WHERE owner=? AND id=?').bind(u.id,id)]);return json({removed:true});}catch(e){return failure(e);}}
