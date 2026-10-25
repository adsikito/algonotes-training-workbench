import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {sha256} from '@noble/hashes/sha2.js';
import {CHUNK_BYTES} from './upload-policy.ts';
import {uploadChunkSource} from './upload-client.ts';
import {validateEntry} from './domain.ts';
export const BACKUP_CHUNK_BYTES=4*1024*1024;
const hex=(bytes:Uint8Array)=>Array.from(sha256(bytes),x=>x.toString(16).padStart(2,'0')).join('');
async function request(url:string,body?:any){const r=await fetch(url,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const x=await r.json() as any;if(!r.ok)throw new Error(x.error);return x;}
export async function createStreamBackup(notify:(s:string)=>void){
 const snapshot=await request('/api/snapshot',{}),id=snapshot.snapshotId;let index=0;
 try{
 const catalog=await request('/api/snapshot?id='+id+'&catalog=1');const expected=Math.ceil(snapshot.total/snapshot.pageSize)+catalog.files.reduce((n:number,f:any)=>n+Math.ceil(f.size/BACKUP_CHUNK_BYTES),0)+1;
 if(expected>1000)throw new Error('分包数超过1000，请先分批导出历史资料；本次未生成完整备份');
 await request('/api/exports',{action:'create',id,expectedParts:expected,title:'流式完整备份 · '+snapshot.createdAt.slice(0,10)});
 const manifest:any={schemaVersion:2,...snapshot,chunkBytes:BACKUP_CHUNK_BYTES,metadata:[],files:[],folders:catalog.folders,scope:'云端记录、历史和回收站；本机未同步草稿需另行导出'};
 async function upload(path:string,bytes:Uint8Array){const name='backup-'+id+'-part'+index+'.zip',zipped=zipSync({[path]:bytes as Uint8Array<ArrayBuffer>},{level:0});
 const r=await fetch('/api/exports?id='+id+'&part='+index+'&name='+encodeURIComponent(name),{method:'PUT',headers:{'content-type':'application/octet-stream'},body:zipped as Uint8Array<ArrayBuffer>});const raw=await r.text();let x:any;try{x=JSON.parse(raw);}catch{throw new Error('备份分包服务返回HTTP '+r.status+'：'+raw.slice(0,120));}if(!r.ok)throw new Error(x.error);index++;return {name,path,hash:hex(bytes),size:bytes.length};}

 let after=0;while(after<snapshot.total){notify('分块备份元数据 '+after+'/'+snapshot.total);const page=await request('/api/snapshot?id='+id+'&after='+after);if(!page.rows.length)throw new Error('快照分页提前结束');const part=await upload('metadata/'+manifest.metadata.length+'.json',strToU8(JSON.stringify(page.rows)));manifest.metadata.push(part);after=page.after;}
 for(const f of catalog.files){notify('分块备份附件 '+f.name);const chunks=[],h=sha256.create();for(let at=0;at<f.size;at+=BACKUP_CHUNK_BYTES){const end=Math.min(f.size,at+BACKUP_CHUNK_BYTES),r=await fetch('/api/files?id='+encodeURIComponent(f.id)+'&backup=1',{headers:{Range:`bytes=${at}-${end-1}`}});if(r.status!==206)throw new Error('附件分块读取失败（'+r.status+'）：'+f.name+' '+(await r.text()).slice(0,300));const b=new Uint8Array(await r.arrayBuffer());if(b.length!==end-at)throw new Error('附件分块大小不符');h.update(b);chunks.push(await upload('files/'+f.id+'/'+chunks.length,b));}
  if(Array.from(h.digest(),n=>n.toString(16).padStart(2,'0')).join('')!==f.hash)throw new Error('附件SHA-256不符：'+f.name);manifest.files.push({...f,chunks});}
 await upload('manifest-v2.json',strToU8(JSON.stringify(manifest)));let completion;do{completion=await request('/api/exports',{action:'complete',id});notify('确认备份分包 '+(completion.entry?.data?.verifyOffset||index)+'/'+index);}while(completion.pending);return {id,parts:index};
 }catch(e:any){await request('/api/exports',{action:'fail',id,error:e.message}).catch(()=>{});throw e;}finally{await fetch('/api/snapshot?id='+id,{method:'DELETE'}).catch(()=>{});}
}
export type ArchiveSource={name:string;size:number;arrayBuffer():Promise<ArrayBuffer>};
export type StreamRestore={version:2;manifest:any;archives:Map<string,ArchiveSource>;taxonomies?:any[]};
async function archive(file:ArchiveSource){if(file.size>16*1024*1024)throw new Error('V2分包上限16MiB');let count=0;return unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:e=>{count++;if(count>1||e.originalSize>12*1024*1024||e.name.includes('..')||e.name.startsWith('/')||e.name.includes('\\'))throw new Error('恢复包结构异常');return true;}});}
async function bytesOf(files:Map<string,ArchiveSource>,ref:any){const f=files.get(ref.name);if(!f)throw new Error('缺少分包：'+ref.name);const a=await archive(f),b=a[ref.path];if(!b||b.length!==ref.size||hex(b)!==ref.hash)throw new Error('分包字节校验失败：'+ref.name);return b;}
export async function previewStreamRestore(files:ArchiveSource[],notify:(s:string)=>void):Promise<StreamRestore|null>{
 const candidates=files.filter(f=>/^backup-.*-part\d+\.zip$/.test(f.name));let m:any=null;
 // Manifest is last part; inspect in descending numeric order without retaining file bytes.
 for(const f of [...candidates].sort((a,b)=>Number(b.name.match(/part(\d+)/)?.[1])-Number(a.name.match(/part(\d+)/)?.[1]))){const a=await archive(f);if(a['manifest-v2.json']){m=JSON.parse(strFromU8(a['manifest-v2.json']));break;}}
 if(!m)return null;if(m.schemaVersion!==2||m.chunkBytes!==BACKUP_CHUNK_BYTES||typeof m.snapshotId!=='string'||!Array.isArray(m.metadata)||!Array.isArray(m.files)||!Array.isArray(m.folders)||m.metadata.length>1000||m.files.length>20000)throw new Error('流式备份清单无效');
 const map=new Map<string,ArchiveSource>();for(const f of files){if(map.has(f.name))throw new Error('重复分包名');map.set(f.name,f);}
 let count=0,records=0,revisions=0;const current=new Map<string,any>();const refs=[...m.metadata,...m.files.flatMap((f:any)=>f.chunks)];if(refs.length>1000||new Set(refs.map((r:any)=>r.name)).size!==refs.length)throw new Error('分包清单重复或超限');
 for(const ref of m.metadata){notify('核验元数据分包 '+(++count)+'/'+refs.length);const rows=JSON.parse(strFromU8(await bytesOf(map,ref)));if(!Array.isArray(rows)||rows.length>10)throw new Error('元数据分包格式无效');for(const row of rows){if(!['entry','revision'].includes(row.type))throw new Error('元数据类型无效');validateEntry(row.entry);if(row.type==='entry'){if(current.has(row.entry.id))throw new Error('当前记录ID重复');current.set(row.entry.id,{kind:row.entry.kind,hash:row.entry.data.hash,size:row.entry.data.size,title:row.entry.data.title,category:row.entry.data.category,parentId:['folder','taxonomy'].includes(row.entry.kind)?row.entry.data.parentId:null,attemptId:row.entry.data.attemptId,problemId:row.entry.data.problemId});records++;}else revisions++;}}
 if(records!==m.entries||revisions!==m.revisions)throw new Error('元数据数量不符');
 if(new Set(m.files.map((f:any)=>f.id)).size!==m.files.length||[...current.values()].filter(e=>e.kind==='file').length!==m.files.length)throw new Error('附件清单数量或ID不符');
 for(const [id,e] of current){if(['folder','taxonomy'].includes(e.kind)){const seen=new Set([id]);let parent=e.parentId;while(parent){if(seen.has(parent))throw new Error('文件夹依赖循环');seen.add(parent);const p=current.get(parent);if(!p||p.kind!==e.kind)throw new Error('文件夹父记录缺失');parent=p.parentId;}}if(e.kind==='submission'){const a=current.get(e.attemptId);if(!a||a.kind!=='attempt'||a.problemId!==e.problemId)throw new Error('提交关联的尝试缺失或不一致');}}
 for(const f of m.files){const meta=current.get(f.id);if(!meta||meta.kind!=='file'||meta.hash!==f.hash||meta.size!==f.size)throw new Error('附件清单与元数据不一致');if(!Array.isArray(f.chunks)||f.chunks.length!==Math.ceil(f.size/BACKUP_CHUNK_BYTES))throw new Error('附件分块数无效');const h=sha256.create();let n=0;for(const c of f.chunks){notify('核验附件分包 '+(++count)+'/'+refs.length);const b=await bytesOf(map,c);h.update(b);n+=b.length;}if(n!==f.size||Array.from(h.digest(),n=>n.toString(16).padStart(2,'0')).join('')!==f.hash)throw new Error('附件完整校验失败：'+f.name);}
 return {version:2,manifest:m,archives:map,taxonomies:[...current].filter(([id,e])=>e.kind==='taxonomy').map(([id,e])=>({id,title:e.title,category:e.category,parentId:e.parentId}))};
}
export async function restoreStreamBackup(pack:StreamRestore,notify:(s:string)=>void){const m=pack.manifest;let restored=0,skipped=0;
 async function send(rows:any[]){if(!rows.length)return;const result=await request('/api/restore-chunk',{snapshotId:m.snapshotId,rows});restored+=result.restored;skipped+=result.skipped;}
 const ids=new Map<string,string>();
 for(const ref of m.metadata){const rows=JSON.parse(strFromU8(await bytesOf(pack.archives,ref)));for(const row of rows)if(!ids.has(row.entry.id))ids.set(row.entry.id,'restore:'+hex(strToU8(m.snapshotId+':'+row.entry.id)).slice(0,48));}
 function remap(x:any):any{if(typeof x==='string'){if(ids.has(x))return ids.get(x);return x.replace(/(\/api\/files\?id=)([a-zA-Z0-9_.:-]+)/g,(_:string,p:string,id:string)=>p+(ids.get(id)||id));}if(Array.isArray(x))return x.map(remap);if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,remap(v)]));return x;}
 const sendOriginal=send;
 const sendRemapped=(rows:any[])=>sendOriginal(rows.map(r=>({...r,entry:{...r.entry,id:ids.get(r.entry.id)||r.entry.id,data:remap(r.entry.data)}})));
 const pending=m.folders.map((f:any)=>({...f,id:ids.get(f.id)||f.id,parentId:ids.get(f.parentId)||f.parentId}));const done=new Set<string>();while(pending.length){const i=pending.findIndex((f:any)=>!f.parentId||done.has(f.parentId)||!pending.some((p:any)=>p.id===f.parentId));if(i<0)throw new Error('文件夹依赖循环');const f=pending.splice(i,1)[0];await send([{type:'entry',entry:{id:f.id,kind:'folder',data:{title:f.title,parentId:f.parentId||'',restoreSession:m.snapshotId},version:1,deleted:false,updated:m.createdAt}}]);done.add(f.id);}
 const taxPending=(pack.taxonomies||[]).map(t=>({...t,id:ids.get(t.id)||t.id,parentId:ids.get(t.parentId)||t.parentId}));const taxDone=new Set<string>();while(taxPending.length){const i=taxPending.findIndex(t=>!t.parentId||taxDone.has(t.parentId)||!taxPending.some(p=>p.id===t.parentId));if(i<0)throw new Error('分类依赖循环');const t=taxPending.splice(i,1)[0];await send([{type:'entry',entry:{id:t.id,kind:'taxonomy',data:{title:t.title,parentId:t.parentId||'',category:t.category,aliases:[],restoreSession:m.snapshotId},version:1,deleted:false,updated:m.createdAt}}]);taxDone.add(t.id);}
 // Restore attempts before attachment metadata and submission references.
 for(const ref of m.metadata){const rows=JSON.parse(strFromU8(await bytesOf(pack.archives,ref)));await sendRemapped(rows.filter((r:any)=>r.type==='entry'&&r.entry.kind==='attempt'));}
 for(const f of m.files){notify('恢复附件 '+f.name);if(f.size===0){const form=new FormData();form.set('file',new File([],f.name));form.set('id',ids.get(f.id)||f.id);form.set('restoreSession',m.snapshotId);const r=await fetch('/api/files',{method:'POST',body:form});if(!r.ok)throw new Error((await r.json() as any).error);continue;}await uploadChunkSource({name:f.name,size:f.size,slice:async(a,b)=>{const joined=new Uint8Array(b-a);for(let pos=a;pos<b;pos+=m.chunkBytes){const ref=f.chunks[Math.floor(pos/m.chunkBytes)],bytes=await bytesOf(pack.archives,ref);joined.set(bytes.subarray(0,Math.min(bytes.length,b-pos)),pos-a);}return joined.buffer;}},{id:ids.get(f.id)||f.id,hash:f.hash,restoreSession:m.snapshotId});}
 for(const ref of m.metadata){notify('恢复记录与历史 '+ref.name);const rows=JSON.parse(strFromU8(await bytesOf(pack.archives,ref)));await sendRemapped(rows.filter((r:any)=>r.type!=='entry'||r.entry.kind!=='attempt'));}
 return {restored,skipped};
}

export async function previewCloudBackup(bundle:any,notify:(s:string)=>void){
 const sources:ArchiveSource[]=bundle.parts.map((p:any)=>({name:p.name,size:p.size,arrayBuffer:async()=>{const r=await fetch(p.url);if(!r.ok)throw new Error('云端备份读取失败：HTTP '+r.status);return r.arrayBuffer();}}));
 const result=await previewStreamRestore(sources,notify);if(!result)throw new Error('此副本为旧格式，请先下载全部分包，再使用本地恢复入口');return result;
}
