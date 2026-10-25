export const CHUNK_BYTES=8*1024*1024;
export const MULTIPART_LIMIT=256*1024*1024;
export const ATTACHMENT_QUOTA=1024*1024*1024;
export const TRANSFER_TTL=24*60*60*1000;
export function validateUpload(x:any){
 if(!x||typeof x.id!=='string'||!/^[a-zA-Z0-9_.:-]{1,140}$/.test(x.id)||typeof x.name!=='string'||!x.name||x.name.length>180||/[\r\n/\\]/.test(x.name)||!Number.isInteger(x.size)||x.size<1||x.size>MULTIPART_LIMIT||!/^[a-f0-9]{64}$/.test(x.hash))throw new Error('分块上传参数无效，单文件支持1字节至256MiB');
 return {id:x.id,name:x.name,size:x.size,hash:x.hash,parentId:String(x.parentId||''),folderId:String(x.folderId||''),problemId:String(x.problemId||''),previousId:String(x.previousId||''),relativePath:String(x.relativePath||x.name),batchId:String(x.batchId||'').slice(0,100),restoreSession:String(x.restoreSession||'').slice(0,100)};
}
export function partSize(size:number,part:number){const count=Math.ceil(size/CHUNK_BYTES);if(!Number.isInteger(part)||part<1||part>count)throw new Error('分块序号无效');return Math.min(CHUNK_BYTES,size-(part-1)*CHUNK_BYTES);}
