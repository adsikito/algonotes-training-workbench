import {sha256} from '@noble/hashes/sha2.js';
import {CHUNK_BYTES,MULTIPART_LIMIT} from './upload-policy.ts';
export async function fileHash(file:Blob,progress?:(n:number)=>void){const h=sha256.create();for(let at=0;at<file.size;at+=CHUNK_BYTES){h.update(new Uint8Array(await file.slice(at,at+CHUNK_BYTES).arrayBuffer()));progress?.(Math.min(file.size,at+CHUNK_BYTES));}return Array.from(h.digest(),n=>n.toString(16).padStart(2,'0')).join('');}
async function jsonRequest(data:any){const r=await fetch('/api/transfers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const x=await r.json() as any;if(!r.ok)throw new Error(x.error);return x;}
export async function uploadChunked(file:File,meta:any,progress?:(n:number)=>void,pause?:()=>boolean){
 if(file.size>MULTIPART_LIMIT)throw new Error('分块上传上限256MiB');const digest=meta.hash||await fileHash(file);try{const r=await fetch('/api/transfers');if(r.ok){const all:any=await r.json();const known=all.find((t:any)=>t.expires>Date.now()&&t.resumeMeta?.hash===digest&&t.name===file.name&&t.size===file.size&&(t.resumeMeta.folderId||'')===(meta.folderId||'')&&(t.resumeMeta.parentId||'')===(meta.parentId||'')&&(t.resumeMeta.restoreSession||'')===(meta.restoreSession||''));if(known)meta={...meta,...known.resumeMeta};}}catch{}return uploadChunkSource({size:file.size,name:file.name,slice:(a,b)=>file.slice(a,b).arrayBuffer()}, {...meta,hash:digest},progress,pause);
}
export async function uploadChunkSource(source:{name:string;size:number;slice:(a:number,b:number)=>Promise<ArrayBuffer>},meta:any,progress?:(n:number)=>void,pause?:()=>boolean){
 const session=await jsonRequest({action:'begin',...meta,name:source.name,size:source.size});if(session.complete)return session.entry;
 const known=new Map<number,any>(session.parts.map((p:any)=>[p.part,p]));let done=0;
 for(let at=0,part=1;at<source.size;at+=CHUNK_BYTES,part++){
  if(pause?.())throw new Error('已暂停；重试同一项可从已确认分块继续');
  if(known.has(part)){done+=known.get(part).size;progress?.(done);continue;}
  const bytes=await source.slice(at,Math.min(source.size,at+CHUNK_BYTES)),r=await fetch('/api/transfers?id='+encodeURIComponent(meta.id)+'&part='+part,{method:'PUT',body:bytes}),x:any=await r.json();if(!r.ok)throw new Error(x.error);done+=bytes.byteLength;progress?.(done);
 }
 return jsonRequest({action:'complete',id:meta.id});
}
