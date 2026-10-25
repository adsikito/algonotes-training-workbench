import {applyContentBatch} from './content-batch';
import {ensurePreviewSchema} from './preview-schema';
import {db,bucket,hash,mutate,getEntry,allEntries,parseRow,recordPage} from './server';
import seed from './catalog';
import {deleteBackup,backupBundles,requireCompleteBackup,type BackupStore} from './backup-manager';
import {uploadPersonalFile} from './personal-files';
import {mergedContent,validateDelivery} from './content-delivery';
export async function diagnostics(){const owner='__qa__'+crypto.randomUUID(),key=owner+'/fixture',checks:{name:string,passed:boolean,detail?:string}[]=[];const uploadedKeys:string[]=[];const expect=(name:string,condition:boolean)=>{checks.push({name,passed:!!condition});if(!condition)throw new Error(name);};
 try{
 await ensurePreviewSchema();
 expect('内容目录：63题/9日单/23个STL模块',seed.problems.length===63&&seed.lists.length===9&&seed.docs.filter(d=>d.kind==='STL专题').length===23);
 expect('跨站题号唯一',new Set(seed.problems.map(p=>p.id)).size===63);
 const payload={id:'note-a',kind:'note',data:{title:'隔离验收',body:'中文 / ```cpp\nint a=1;\n```'},baseVersion:0,operationId:'create'};
 const a=await mutate(owner,payload);expect('D1创建并回读正文',a.version===1&&(await getEntry(owner,'note-a'))?.data.body===payload.data.body);
 const duplicate=await mutate(owner,payload);expect('重复操作不增加版本',duplicate.version===1&&(await allEntries(owner)).length===1);
 let mismatch=false;try{await mutate(owner,{...payload,data:{...payload.data,title:'另一个请求'}});}catch{mismatch=true;}expect('同操作ID不同内容被拒绝',mismatch);
 const b=await mutate(owner,{...payload,data:{...payload.data,body:'第二版'},baseVersion:1,operationId:'edit'});expect('条件更新版本递增',b.version===2);
 let conflict=false;try{await mutate(owner,{...payload,operationId:'stale'});}catch(e:any){conflict=e.status===409;}expect('陈旧版本不覆盖',conflict&&(await getEntry(owner,'note-a'))?.version===2);
 expect('账号隔离：另一个owner无法读取',await getEntry(owner+'-other','note-a')===null);
 const rev:any=await db().prepare('SELECT count(*) n FROM revisions WHERE owner=?').bind(owner).first();expect('失败写入不产生历史版本',rev.n===2);
 const before:any=await db().prepare('SELECT count(*) n FROM operations WHERE owner=?').bind(owner).first();let rolled=false;try{await db().batch([db().prepare('INSERT INTO guards(id,ok) VALUES (?,CASE WHEN COALESCE((SELECT version FROM records WHERE owner=? AND id=?),0)=? THEN 1 ELSE 0 END)').bind(owner,owner,'note-a',0),db().prepare('INSERT INTO operations(owner,id,hash,response,created) VALUES (?,?,?,?,?)').bind(owner,'must-not-exist','h','{}','now')]);}catch{rolled=true;}
 const after:any=await db().prepare('SELECT count(*) n FROM operations WHERE owner=?').bind(owner).first();expect('D1真实批事务：0行CAS保护会回滚后续回执',rolled&&before.n===after.n);
 const del=await mutate(owner,{...payload,baseVersion:2,operationId:'trash',deleted:true});let zombie=false;try{await mutate(owner,{...payload,baseVersion:3,operationId:'old-device'});}catch{zombie=true;}expect('删除标记防止旧设备复活',del.deleted&&zombie);
 const restored=await mutate(owner,{...payload,baseVersion:3,operationId:'restore',restore:true});expect('回收内容可显式恢复',restored.version===4&&!restored.deleted);
 const content=new TextEncoder().encode('附件校验 \u4e2d\u6587 0123456789');await bucket().put(key,content);const obj=await bucket().get(key);const bytes=await obj!.arrayBuffer();expect('R2原件写入、读取与SHA256一致',await hash(bytes)===await hash(content.buffer as ArrayBuffer));
 const snap=await db().batch([db().prepare('SELECT * FROM records WHERE owner=?').bind(owner),db().prepare('SELECT * FROM revisions WHERE owner=?').bind(owner)]);expect('快照包含当前记录与4个历史版本',snap[0].results.length===1&&snap[1].results.length===4);
 const copy=await mutate(owner,{id:'restored-copy',kind:'note',data:JSON.parse((snap[0].results[0] as any).payload),baseVersion:0,operationId:'restored-copy'});expect('结构化快照能恢复为独立副本',copy.data.body===payload.data.body);
 const pref=await mutate(owner,{id:'preferences:workspace',kind:'preference',data:{order:['today','notes'],fontSize:18},baseVersion:0,operationId:'pref'});expect('布局偏好保存并可回读',pref.kind==='preference'&&(await getEntry(owner,pref.id))?.data.fontSize===18);
 const root=await mutate(owner,{id:'folder-root',kind:'folder',data:{title:'目录'},baseVersion:0,operationId:'folder-root'});
 const child=await mutate(owner,{id:'folder-child',kind:'folder',data:{title:'子目录',parentId:root.id},baseVersion:0,operationId:'folder-child'});
 let cycle=false;try{await mutate(owner,{id:root.id,kind:'folder',data:{...root.data,parentId:child.id},baseVersion:1,operationId:'cycle'});}catch{cycle=true;}expect('阻止目录移入自身后代',cycle);
 const file=await mutate(owner,{id:'meta-file',kind:'file',data:{key,hash:await hash(content.buffer as ArrayBuffer),size:content.length,name:'fixture.txt',folderId:root.id},baseVersion:0,operationId:'meta-file',internal:true});
 const moved=await mutate(owner,{id:file.id,kind:'file',data:{...file.data,folderId:child.id},baseVersion:1,operationId:'move-meta'});expect('附件移动目录保留原件地址',moved.data.folderId===child.id&&moved.data.key===key);
 let denied=false;try{await mutate(owner,{id:file.id,kind:'file',data:{...moved.data,key:'another-object'},baseVersion:2,operationId:'illegal-key'});}catch(e:any){denied=e.status===403;}expect('附件元数据通道不能改原件地址',denied);

 for(const name of ['课程.cpp','课件.ppt','课件.pptx','阅读.pdf']){
  const form=new FormData(),id='upload-'+uploadedKeys.length;const raw=new TextEncoder().encode('// 文件原件校验 '+name+' 中文QAtoken');
  form.set('file',new File([raw],name));form.set('id',id);form.set('folderId',child.id);form.set('relativePath','课程/章节/'+name);
  const f=await uploadPersonalFile(owner,form);uploadedKeys.push(f.data.key);
  const object=await bucket().get(f.data.key);expect(name+'上传下载字节一致',await hash(await object!.arrayBuffer())===await hash(raw.buffer as ArrayBuffer));
  const retry=await uploadPersonalFile(owner,form);expect(name+'重复上传不新增版本',retry.version===f.version);
  if(name.endsWith('.cpp'))expect('C++中文内容可检索，目录保留',f.data.body.includes('QAtoken')&&f.data.relativePath==='课程/章节/'+name&&f.data.type==='text/plain');
 }
 const unsafe=new FormData();unsafe.set('file',new File(['x'],'a.cpp'));unsafe.set('id','unsafe');unsafe.set('relativePath','../escape.cpp');
 let pathDenied=false;try{await uploadPersonalFile(owner,unsafe);}catch{pathDenied=true;}expect('课程上传拒绝越界路径',pathDenied);
 const backupStore:BackupStore={
  list:async()=>(await db().prepare("SELECT * FROM records WHERE owner=? AND kind IN ('backup','export')").bind(owner).all()).results.map(parseRow),
  get:id=>getEntry(owner,id),save:(old,data,deleted=false)=>mutate(owner,{id:old.id,kind:old.kind,data,deleted,baseVersion:old.version,operationId:crypto.randomUUID(),internal:true}),deleteObject:k=>bucket().delete(k)
 };
 let backup=await mutate(owner,{id:'qa-backup',kind:'backup',data:{title:'可丢弃测试备份',expectedParts:2,status:'building',expiresAt:Date.now()+60000},baseVersion:0,operationId:'backup',internal:true});
 for(let i=0;i<2;i++){const k=owner+'/exports/part'+i;uploadedKeys.push(k);await bucket().put(k,'backup fixture '+i);await mutate(owner,{id:'qa-part'+i,kind:'export',data:{backupId:backup.id,key:k,name:'part'+i+'.zip',size:16,partIndex:i},baseVersion:0,operationId:'part'+i,internal:true,guardRecord:{id:backup.id,version:backup.version}});}
 requireCompleteBackup(backup,await backupStore.list());backup=await backupStore.save(backup,{...backup.data,status:'ready',protected:true});
 expect('受保护备份拒绝删除且字节保留',!(await deleteBackup(backupStore,owner,backup.id)).ok&&!!await bucket().head(owner+'/exports/part0'));
 backup=await backupStore.save(backup,{...backup.data,protected:false});
 const broken={...backupStore,deleteObject:async(k:string)=>{if(k.endsWith('part1'))throw new Error('模拟暂时失败');await bucket().delete(k);}};
 const partial=await deleteBackup(broken,owner,backup.id);expect('备份清理部分失败如实回执',!partial.ok&&partial.removedParts===1&&(await getEntry(owner,backup.id))?.data.status==='deleting');
 let lateUpload=false;try{await mutate(owner,{id:'late-part',kind:'export',data:{backupId:backup.id},baseVersion:0,operationId:'late',internal:true,guardRecord:{id:backup.id,version:backup.version}});}catch{lateUpload=true;}expect('清理期间陈旧上传事务被拒绝',lateUpload&&await getEntry(owner,'late-part')===null);
 const deleted=await deleteBackup(backupStore,owner,backup.id);expect('清理重试删除剩余备份字节',deleted.ok&&deleted.removedParts===1&&await bucket().head(owner+'/exports/part1')===null);
 expect('备份删除不影响资料原件与笔记',!!await bucket().head(key)&&!!await getEntry(owner,'note-a'));
 expect('重复删除幂等，备份不再出现在列表',(await deleteBackup(backupStore,owner,backup.id)).ok&&backupBundles(await backupStore.list()).length===0);
 for(let i=0;i<260;i+=25){await db().batch(Array.from({length:Math.min(25,260-i)},(_,j)=>db().prepare("INSERT INTO records(owner,id,kind,payload,version,deleted,updated) VALUES (?,?,'note',?,1,0,?)").bind(owner,'page-'+String(i+j).padStart(4,'0'),JSON.stringify({title:'分页测试',body:'同时间戳'}),'2026-10-20T00:00:00.000Z')));}
 const seen=new Set<string>();let cursor:string|null=null;let pages=0;do{const p=await recordPage(owner,cursor);p.entries.forEach(e=>seen.add(e.id));cursor=p.nextCursor;pages++;}while(cursor);
 expect('真实分页查询保留同时间戳边界且排除备份',pages>=2&&Array.from(seen).filter(id=>id.startsWith('page-')).length===260&&!seen.has('qa-backup'));
 const contentItems=[{id:'doc-atomic',kind:'document',data:{title:'事务测试',body:'isolated'},baseVersion:0},{id:'list-atomic',kind:'list',data:{title:'事务测试列表',items:['one']},baseVersion:0}];
 const digest=await hash(JSON.stringify(contentItems));const receipt=await applyContentBatch('qa-atomic',contentItems,digest,owner);
 expect('共享内容批次与回执原子提交',receipt.atomic&&(await getEntry(owner,'doc-atomic'))?.version===1&&(await getEntry(owner,'batch-qa-atomic'))?.data.completed===2);
 expect('同批重复回执幂等',(await applyContentBatch('qa-atomic',contentItems,digest,owner)).hash===digest&&(await getEntry(owner,'doc-atomic'))?.version===1);
 const concurrent=await Promise.allSettled([applyContentBatch('qa-race-a',[{...contentItems[0],baseVersion:1,data:{title:'A',body:'A'}},{id:'only-a',kind:'document',data:{title:'A'},baseVersion:0}], 'race-a',owner),applyContentBatch('qa-race-b',[{...contentItems[0],baseVersion:1,data:{title:'B',body:'B'}},{id:'only-b',kind:'document',data:{title:'B'},baseVersion:0}], 'race-b',owner)]);
 expect('并发内容版本冲突整批回滚',concurrent.filter(r=>r.status==='fulfilled').length===1&&!!(await getEntry(owner,'only-a'))!==!!(await getEntry(owner,'only-b')));
 const overlay:any=[{id:seed.lists[0].id,kind:'list',data:{...seed.lists[0],title:'测试更新'},version:2,deleted:false}];
 expect('推送目录回读包含覆盖版本',mergedContent(seed,overlay).lists.find((l:any)=>l.id===seed.lists[0].id)?.baseVersion===2);
 let poolDenied=false;try{validateDelivery([{id:'bad',kind:'list',data:{date:'2026-10-23',items:['P1449']}}],seed);}catch{poolDenied=true;}expect('题单预检拒绝不足7题或重复题号',poolDenied);
 }catch(e:any){checks.push({name:'后续检查中止',passed:false,detail:e.message});}finally{try{await bucket().delete(key);for(const k of uploadedKeys)await bucket().delete(k);await db().batch([db().prepare('DELETE FROM revisions WHERE owner=?').bind(owner),db().prepare('DELETE FROM records WHERE owner=?').bind(owner),db().prepare('DELETE FROM operations WHERE owner=?').bind(owner),db().prepare('DELETE FROM transfer_parts WHERE owner=?').bind(owner),db().prepare('DELETE FROM transfers WHERE owner=?').bind(owner),db().prepare('DELETE FROM guards WHERE id=?').bind(owner)]);}catch(e:any){checks.push({name:'隔离测试数据清理',passed:false,detail:e.message});}}
 return{at:new Date().toISOString(),checks,passed:checks.every(c=>c.passed),scope:'仅隔离测试空间；不修改用户笔记、成绩或附件'};}
