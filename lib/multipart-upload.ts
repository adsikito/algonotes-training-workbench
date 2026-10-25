import {db,bucket,getEntry,mutate,hash} from './server';
import {relativePath,fileCapability,sourceIndex} from './file-policy';
import {CHUNK_BYTES,ATTACHMENT_QUOTA,TRANSFER_TTL,validateUpload,partSize} from './upload-policy';
import {sha256} from '@noble/hashes/sha2.js';
export async function transfer(owner:string,id:string){return db().prepare('SELECT * FROM transfers WHERE owner=? AND id=?').bind(owner,id).first<any>();}
export async function parts(owner:string,id:string){return (await db().prepare('SELECT part,etag,hash,size FROM transfer_parts WHERE owner=? AND id=? ORDER BY part').bind(owner,id).all()).results as any[];}
async function references(owner:string,m:any){
 for(const [id,kind] of [[m.folderId,'folder'],[m.parentId,'']])if(id){const e=await getEntry(owner,id);if(!e||e.deleted||kind&&e.kind!==kind)throw new Error('关联记录或文件夹不存在');}
 if(m.previousId){const e=await getEntry(owner,m.previousId);if(!e||e.deleted||e.kind!=='file')throw new Error('旧原件不存在');}
}
export async function beginTransfer(owner:string,input:any){
 const m=validateUpload(input);m.relativePath=relativePath(m.relativePath);await references(owner,m);
 const old=await getEntry(owner,m.id);if(old){if(old.deleted||old.kind!=='file'||old.data.hash!==m.hash||old.data.size!==m.size)throw new Error('文件ID已用于其他内容');return {complete:true,entry:old};}
 const previous=await transfer(owner,m.id);if(previous){if(previous.payload!==JSON.stringify(m)||previous.state==='cancelled'||previous.expires<=Date.now())throw new Error('上传会话已失效或内容不同，请清除该项后重新选择');return {id:m.id,parts:await parts(owner,m.id),state:previous.state,expires:previous.expires,chunkBytes:CHUNK_BYTES};}
 const key=owner+'/'+m.id+'/'+m.hash+'/'+crypto.randomUUID();const mp=await bucket().createMultipartUpload(key,{httpMetadata:{contentType:'application/octet-stream'}});const guard='quota:'+crypto.randomUUID();
 try{await db().batch([
  db().prepare("INSERT INTO guards(id,ok) VALUES (?,CASE WHEN (SELECT COALESCE(SUM(CAST(json_extract(payload,'$.size') AS INTEGER)),0) FROM records WHERE owner=? AND kind='file')+(SELECT COALESCE(SUM(size),0) FROM transfers t WHERE t.owner=? AND t.state IN ('uploading','completing') AND t.expires>? AND NOT EXISTS(SELECT 1 FROM records r WHERE r.owner=t.owner AND r.id=t.id AND r.kind='file'))+?<=? THEN 1 ELSE 0 END)").bind(guard,owner,owner,Date.now(),m.size,ATTACHMENT_QUOTA),
  db().prepare('INSERT INTO transfers(owner,id,payload,size,state,expires,upload_id,key) VALUES (?,?,?,?,?,?,?,?)').bind(owner,m.id,JSON.stringify(m),m.size,'uploading',Date.now()+TRANSFER_TTL,mp.uploadId,key),
  db().prepare('DELETE FROM guards WHERE id=?').bind(guard)
 ]);}catch{await mp.abort().catch(()=>{});const known=await transfer(owner,m.id);if(known?.payload===JSON.stringify(m))return {id:m.id,parts:await parts(owner,m.id),chunkBytes:CHUNK_BYTES};throw new Error('额度不足或并发上传冲突；附件及上传预留总额上限1GiB');}
 return {id:m.id,parts:[],chunkBytes:CHUNK_BYTES,expires:Date.now()+TRANSFER_TTL};
}
export async function putTransferPart(owner:string,id:string,part:number,bytes:ArrayBuffer){
 const t=await transfer(owner,id);if(!t||t.state!=='uploading'||t.expires<=Date.now())throw new Error('上传会话不可写');const m=JSON.parse(t.payload);if(bytes.byteLength!==partSize(m.size,part))throw new Error('分块字节数不符');const digest=await hash(bytes);
 const old=await db().prepare('SELECT * FROM transfer_parts WHERE owner=? AND id=? AND part=?').bind(owner,id,part).first<any>();if(old){if(old.hash!==digest)throw new Error('重试分块内容不同');return old;}
 const mp=bucket().resumeMultipartUpload(t.key,t.upload_id),out=await mp.uploadPart(part,bytes),guard='part:'+crypto.randomUUID();
 await db().batch([db().prepare("INSERT INTO guards(id,ok) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM transfers WHERE owner=? AND id=? AND state='uploading' AND expires>?) THEN 1 ELSE 0 END)").bind(guard,owner,id,Date.now()),db().prepare('INSERT INTO transfer_parts(owner,id,part,etag,hash,size) VALUES (?,?,?,?,?,?) ON CONFLICT(owner,id,part) DO NOTHING').bind(owner,id,part,out.etag,digest,bytes.byteLength),db().prepare('DELETE FROM guards WHERE id=?').bind(guard)]);
 return {part,etag:out.etag,hash:digest,size:bytes.byteLength};
}
export async function finishTransfer(owner:string,id:string){
 const t=await transfer(owner,id);if(!t||t.expires<=Date.now()||!['uploading','completing','complete'].includes(t.state))throw new Error('上传会话不可完成');const m=JSON.parse(t.payload),old=await getEntry(owner,id);if(old){if(old.kind!=='file'||old.data.hash!==m.hash)throw new Error('登记记录不同');return old;}
 const p=await parts(owner,id);if(p.length!==Math.ceil(m.size/CHUNK_BYTES)||p.some((p,i)=>p.part!==i+1||p.size!==partSize(m.size,i+1)))throw new Error('仍有分块未确认');
 await db().prepare("UPDATE transfers SET state='completing' WHERE owner=? AND id=? AND state='uploading'").bind(owner,id).run();
 let object=await bucket().get(t.key);if(!object){await bucket().resumeMultipartUpload(t.key,t.upload_id).complete(p.map(x=>({partNumber:x.part,etag:x.etag})));object=await bucket().get(t.key);}
 if(!object||object.size!==m.size)throw new Error('完整原件大小校验失败');
 const h=sha256.create(),reader=object.body.getReader();const small:Uint8Array[]=[];let n=0;while(true){const {done,value}=await reader.read();if(done)break;h.update(value);n+=value.length;if(m.size<=2*1024*1024)small.push(value);}
 const digest=Array.from(h.digest(),x=>x.toString(16).padStart(2,'0')).join('');if(n!==m.size||digest!==m.hash)throw new Error('完整原件SHA-256不一致，未登记文件');
 const bytes=new Uint8Array(n<=2*1024*1024?n:0);let at=0;for(const b of small){bytes.set(b,at);at+=b.length;}
 await references(owner,m);const previous=m.previousId?await getEntry(owner,m.previousId):null;const cap=fileCapability(m.name);
 const entry=await mutate(owner,{id,kind:'file',data:{...m,type:cap.mime,key:t.key,logicalId:previous?.data.logicalId||previous?.id||id,...(bytes.length?sourceIndex(m.name,bytes.buffer):{body:'',indexTruncated:cap.kind==='text',indexStatus:cap.kind==='text'?'large-file-not-indexed':'not-text'})},baseVersion:0,operationId:'upload-'+id,internal:true,guardTransfer:id});
 await db().prepare("UPDATE transfers SET state='complete' WHERE owner=? AND id=?").bind(owner,id).run();return entry;
}
export async function cancelTransfer(owner:string,id:string){
 const t=await transfer(owner,id);if(!t||t.state==='cancelled')return {cancelled:true};if(await getEntry(owner,id))throw new Error('原件已经登记，不能作为未完成上传清理');
 if(t.state==='completing'&&t.expires>Date.now())throw new Error('正在完成校验，请稍后重试');
 const changed=await db().prepare("UPDATE transfers SET state='cancelled' WHERE owner=? AND id=? AND state=?").bind(owner,id,t.state).run();if(!changed.meta.changes)throw new Error('上传状态刚刚改变，请刷新重试');
 if(!t.key.startsWith(owner+'/'))throw new Error('临时上传路径异常');
 await bucket().resumeMultipartUpload(t.key,t.upload_id).abort().catch(()=>{});if(t.expires<=Date.now())await bucket().delete(t.key);
 return {cancelled:true};
}
