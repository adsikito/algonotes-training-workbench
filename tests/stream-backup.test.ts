import assert from 'node:assert/strict';
import {createStreamBackup,previewStreamRestore,restoreStreamBackup} from '../lib/backup-v2.ts';
import {sha256} from '@noble/hashes/sha2.js';
import {CHUNK_BYTES} from '../lib/upload-policy.ts';
const raw=new Uint8Array(21*1024*1024+7);raw[0]=10;raw[raw.length-1]=9;
const hex=(b:Uint8Array)=>Array.from(sha256(b),v=>v.toString(16).padStart(2,'0')).join('');
const entry=(id:string,kind:string,data:any)=>({id,kind,data,deleted:false,version:1,updated:'2026-10-24T00:00:00Z'});
const file=entry('file-a','file',{name:'course.cpp',size:raw.length,hash:hex(raw),folderId:'folder-a',body:'original index',key:'old/file'});
const empty=entry('empty','file',{name:'empty.txt',size:0,hash:hex(new Uint8Array()),key:'old/empty'});
const all=[entry('folder-a','folder',{title:'课程',parentId:''}),entry('attempt-a','attempt',{problemId:'P1',status:'进行中'}),file,empty,entry('note-a','note',{title:'反例',body:'[source](/api/files?id=file-a)',fileIds:['file-a'],folderId:'folder-a'}),entry('relation-a','relation',{title:'关联',from:{id:'note-a',type:'note'},to:{id:'file-a',type:'file'},relation:'引用'}),entry('t-child','taxonomy',{title:'子分类',category:'知识点',aliases:['边界'],parentId:'t-root'}),entry('t-root','taxonomy',{title:'根分类',category:'知识点',aliases:[],parentId:''}),...Array.from({length:17},(_,i)=>entry('n-'+i,'note',{title:'n'+i,body:'body'}))];
const rows=[...all.map(entry=>({type:'entry',entry})),...all.map(entry=>({type:'revision',entry}))].map((r,i)=>({...r,row:i+1}));
const snapshot={snapshotId:'qa-stream-snapshot',createdAt:'2026-10-24',total:rows.length,pageSize:10,entries:all.length,revisions:all.length};
const volumes:File[]=[],restored:any[]=[],sessions=new Map<string,any>();let expected=0,complete=0,ranges=0;const json=(x:any)=>Response.json(x);
const originalFetch=globalThis.fetch;
globalThis.fetch=(async(url:any,init:any={})=>{
 const u=new URL(String(url),'http://test');const data=init.headers?.['content-type']==='application/json'?JSON.parse(init.body):null;
 if(u.pathname==='/api/snapshot'){
  if(init.method==='POST')return json(snapshot);if(init.method==='DELETE')return json({removed:true});
  if(u.searchParams.get('catalog'))return json({files:[{id:file.id,row:3,...file.data},{id:empty.id,row:4,...empty.data}],folders:[{id:'folder-a',title:'课程',parentId:''}]});
  const after=Number(u.searchParams.get('after'));return json({rows:rows.slice(after,after+10),after:Math.min(rows.length,after+10)});
 }
 if(u.pathname==='/api/files'&&init.method==='POST'){const f=init.body.get('file');assert.equal(f.size,0);return json({});}
 if(u.pathname==='/api/files'){const r=/bytes=(\d+)-(\d+)/.exec(init.headers.Range)!;ranges++;return new Response(raw.slice(Number(r[1]),Number(r[2])+1),{status:206});}
 if(u.pathname==='/api/exports'){
  if(data?.action==='create'){expected=data.expectedParts;return json({});}
  if(data?.action==='complete'){complete++;assert.equal(volumes.length,expected);return json(complete===1?{pending:true,entry:{data:{verifyOffset:2}}}:{});}
  volumes.push(new File([init.body],u.searchParams.get('name')!));return json({});
 }
 if(u.pathname==='/api/restore-chunk'){restored.push(...data.rows);return json({restored:data.rows.length,skipped:0});}
 if(u.pathname==='/api/transfers'){
  if(data?.action==='begin'){sessions.set(data.id,{...data,parts:[]});return json({parts:[]});}
  if(data?.action==='complete'){const s=sessions.get(data.id),h=sha256.create();for(const p of s.parts)h.update(p);assert.equal(Array.from(h.digest(),v=>v.toString(16).padStart(2,'0')).join(''),s.hash);return json({id:data.id});}
  if(init.method==='PUT'){const s=sessions.get(u.searchParams.get('id')!);assert.ok(init.body.byteLength<=CHUNK_BYTES);s.parts.push(new Uint8Array(init.body));return json({});}
 }
 throw new Error('unexpected '+url);
}) as any;
try{
 const out=await createStreamBackup(()=>{});assert.equal(out.parts,Math.ceil(rows.length/10)+6+1);assert.equal(ranges,6);assert.equal(complete,2);
 const pack=await previewStreamRestore(volumes,()=>{});assert.equal(pack?.manifest.entries,all.length);const result=await restoreStreamBackup(pack!,()=>{});assert.ok(result.restored>all.length);
 const n=restored.find(r=>r.type==='entry'&&r.entry.kind==='note'&&r.entry.data.title==='反例').entry;
 assert.ok(n.id.startsWith('restore:'));assert.ok(n.data.body.includes('/api/files?id=restore:'));assert.ok(n.data.fileIds[0].startsWith('restore:'));assert.ok(n.data.folderId.startsWith('restore:'));
 const ti=restored.filter(r=>r.type==='entry'&&r.entry.kind==='taxonomy');assert.equal(ti[0].entry.data.title,'根分类');assert.equal(ti[1].entry.data.title,'子分类');assert.ok(ti[1].entry.data.parentId.startsWith('restore:'));assert.equal(sessions.size,1);assert.ok([...sessions.values()][0].id.startsWith('restore:'));
 await assert.rejects(()=>previewStreamRestore(volumes.slice(1),()=>{}),/缺少分包/);
 console.log('V2 backup/restore integration passed: 21MiB + empty file, 50 current/history rows + taxonomy parent order, 6 range chunks, reference remap, pending completion and missing-part rejection');
}finally{globalThis.fetch=originalFetch;}
