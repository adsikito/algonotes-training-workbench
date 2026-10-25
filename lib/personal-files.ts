import {bucket,getEntry,mutate,hash} from './server';
import {FILE_LIMIT,fileCapability,relativePath,sourceIndex} from './file-policy';
import {beginTransfer,putTransferPart,finishTransfer} from './multipart-upload';
import {CHUNK_BYTES} from './upload-policy';
/** Legacy small-file route shares quota reservations and complete-file verification. */
export async function uploadPersonalFile(owner:string,form:FormData){
 const file=form.get('file') as File|null,id=String(form.get('id')||'');if(!file||!id)throw new Error('请选择文件');if(file.size>FILE_LIMIT)throw new Error('此兼容入口单文件上限20MiB');
 const digest=await hash(await file.arrayBuffer()),meta:any={id,name:file.name,size:file.size,hash:digest};for(const k of ['parentId','folderId','problemId','previousId','relativePath','batchId','restoreSession'])meta[k]=String(form.get(k)||'');
 if(file.size===0){if(!/^[a-zA-Z0-9_.:-]{1,140}$/.test(id))throw new Error('文件ID无效');const old=await getEntry(owner,id);if(old){if(old.kind!=='file'||old.data.hash!==digest||old.deleted)throw new Error('文件ID冲突');return old;}const key=owner+'/'+id+'/'+digest;await bucket().put(key,new Uint8Array());return mutate(owner,{id,kind:'file',data:{...meta,type:fileCapability(file.name).mime,key,relativePath:relativePath(meta.relativePath||file.name),logicalId:id,...sourceIndex(file.name,new ArrayBuffer(0))},baseVersion:0,operationId:'upload-'+id,internal:true});}
 const session=await beginTransfer(owner,meta);if(session.complete)return session.entry;
 for(let offset=0,part=1;offset<file.size;offset+=CHUNK_BYTES,part++)await putTransferPart(owner,id,part,await file.slice(offset,offset+CHUNK_BYTES).arrayBuffer());
 return finishTransfer(owner,id);
}
