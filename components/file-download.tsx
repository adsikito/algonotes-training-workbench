'use client';
import {useRef,useState} from 'react';
import {sha256} from '@noble/hashes/sha2.js';
import {Download} from 'lucide-react';
import {download} from '../lib/backup-client';
/** Bounded requests fit the Site preview gateway; fallback Blob is browser memory, not Worker heap. */
export function FileDownload({entry,small=true}:any){const [busy,setBusy]=useState(false),[status,setStatus]=useState('');const cancel=useRef(false);const f=entry.data,url='/api/files?id='+encodeURIComponent(entry.id);
 async function run(){if(busy){cancel.current=true;return;}setBusy(true);cancel.current=false;let writer:any=null;const chunks:BlobPart[]=[];
 try{
  if(typeof (window as any).showSaveFilePicker==='function'){const handle=await (window as any).showSaveFilePicker({suggestedName:f.name});writer=await handle.createWritable();}
  const h=sha256.create(),chunkSize=4*1024*1024;
  for(let at=0;at<f.size;at+=chunkSize){if(cancel.current)throw new Error('已取消下载');const end=Math.min(f.size,at+chunkSize),r=await fetch(url,{headers:{Range:`bytes=${at}-${end-1}`}});if(r.status!==206){await r.body?.cancel();throw new Error('分块读取失败：HTTP '+r.status);}const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length!==end-at)throw new Error('下载分块大小不符');h.update(bytes);if(writer)await writer.write(bytes);else chunks.push(bytes as Uint8Array<ArrayBuffer>);setStatus('下载校验 '+Math.round(end/f.size*100)+'%');}
  const digest=Array.from(h.digest(),n=>n.toString(16).padStart(2,'0')).join('');if(digest!==f.hash)throw new Error('SHA-256不一致，本次没有生成完整下载');
  if(writer)await writer.close();else download(new Blob(chunks,{type:'application/octet-stream'}),f.name);
  setStatus('完整字节校验通过，已交给浏览器保存');
 }catch(e:any){if(writer)await writer.abort().catch(()=>{});setStatus(e.name==='AbortError'?'已取消保存':e.message);}finally{setBusy(false);}}
 if(f.size<=4*1024*1024)return <a className={'button '+(small?'small':'')} href={url}><Download size={14}/>下载原件</a>;
 return <div className="range-download"><button className={'button '+(small?'small':'')} onClick={run}><Download size={14}/>{busy?'取消当前下载':'分块下载原件'}</button><span className="mini" role="status">{status||'完整SHA-256校验；不支持直接写磁盘的浏览器会暂存原件字节，较大文件建议桌面端下载。'}</span></div>;
}
