import { actor, checkOrigin, bucket, mutate, getEntry, json, failure, db, parseRow, hash } from '../../../lib/server';
import { backupBundles, deleteBackup, requireCompleteBackup, BACKUP_TTL, EXPORT_LIMIT, type BackupStore } from '../../../lib/backup-manager';

function storeFor(owner: string): BackupStore {
    return {
        list: async () => (await db().prepare("SELECT * FROM records WHERE owner=? AND kind IN ('export','backup') ORDER BY updated DESC").bind(owner).all()).results.map(parseRow),
        get: id => getEntry(owner, id),
        save: (old, data, deleted = false) => mutate(owner, { id: old.id, kind: old.kind, data, deleted, baseVersion: old.version, operationId: 'backup-change:' + crypto.randomUUID(), internal: true }),
        deleteObject: key => bucket().delete(key)
    };
}

export async function POST(r: Request) {
    try {
        checkOrigin(r); const u = await actor(r); const store = storeFor(u.id);
        if (r.headers.get('content-type')?.includes('application/json')) {
            const x = await r.json() as any;
            if (x.action === 'create') {
                if (typeof x.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(x.id) || !Number.isInteger(x.expectedParts) || x.expectedParts < 1 || x.expectedParts > 1000) throw new Error('备份会话格式无效');
                const old = await store.get(x.id);
                if (old) { if (old.kind !== 'backup' || old.deleted || old.data.expectedParts !== x.expectedParts) throw new Error('备份会话不可重用'); return json(old); }
                return json(await mutate(u.id, { id: x.id, kind: 'backup', data: { title: String(x.title || '完整备份').slice(0, 120), expectedParts: x.expectedParts, status: 'building', protected: false, createdAt: new Date().toISOString(), expiresAt: Date.now() + BACKUP_TTL }, baseVersion: 0, operationId: 'backup-create:' + x.id, internal: true }));
            }
            const parent = await store.get(x.id);
            if (!parent || parent.kind !== 'backup' || parent.deleted) throw new Error('备份不存在');
            if (x.action === 'complete') {
                const parts = await store.list(); requireCompleteBackup(parent, parts);
                const ordered=parts.filter(p=>p.kind==='export'&&!p.deleted&&p.data.backupId===parent.id).sort((a,b)=>a.data.partIndex-b.data.partIndex);
                if(parent.data.status==='ready')return json(parent);
                const offset=Number(parent.data.verifyOffset)||0;
                for(const p of ordered.slice(offset,offset+50)){
                    if(!p.data.key.startsWith(u.id+'/exports/'))throw new Error('备份路径异常');
                    const object=await bucket().head(p.data.key);if(!object||object.size!==p.data.size)throw new Error('分包字节未确认');
                }
                const verified=Math.min(ordered.length,offset+50),finished=verified===ordered.length;
                const out=await store.save(parent,{...parent.data,verifyOffset:verified,status:finished?'ready':'verifying',...(finished?{verifiedAt:new Date().toISOString()}:{})});
                return json(finished?out:{pending:true,entry:out});
            }
            if(x.action==='fail'){if(parent.data.status==='ready'||parent.data.status==='deleting')throw new Error('该备份不能标记为生成失败');return json(await store.save(parent,{...parent.data,status:'failed',error:String(x.error||'备份未完成').slice(0,700)}));}
            if (x.action === 'protect') {
                if (parent.data.status !== 'ready') throw new Error('只有完整备份可以设为保护');
                if (typeof x.protected !== 'boolean') throw new Error('保护状态无效');
                if (x.protected && !parent.data.protected && parent.data.expiresAt <= Date.now()) throw new Error('备份已过期，请重新生成');
                return json(await store.save(parent, { ...parent.data, protected: x.protected, expiresAt: x.protected ? parent.data.expiresAt : Date.now() + BACKUP_TTL }));
            }
            throw new Error('不支持的备份操作');
        }
        const length = Number(r.headers.get('content-length'));
        if (length && length > EXPORT_LIMIT + 65536) throw new Error('导出分包超过28MiB');
        const form = await r.formData(), f = form.get('file');
        if (!(f instanceof File) || f.size > EXPORT_LIMIT) throw new Error('导出分包超过28MiB');
        const backupId = String(form.get('backupId') || ''), index = Number(form.get('partIndex'));
        const parent = backupId ? await store.get(backupId) : null;
        if (backupId && (!parent || parent.kind !== 'backup' || parent.deleted || parent.data.status !== 'building' || parent.data.expiresAt <= Date.now() || !Number.isInteger(index) || index < 0 || index >= parent.data.expectedParts)) throw new Error('备份会话已结束或分包序号无效');
        const id = backupId ? backupId + '.part' + index : crypto.randomUUID();
        const bytes = await f.arrayBuffer(), digest = await hash(bytes), old = await store.get(id);
        const key = u.id + '/exports/' + id + '/' + digest + '/' + crypto.randomUUID();
        if (old) {
            if (old.kind !== 'export' || old.deleted || old.data.hash !== digest || old.data.name !== f.name) throw new Error('分包重试内容不一致');
            return json({ id: old.id, url: '/api/exports?id=' + old.id, name: old.data.name, size: old.data.size });
        }
        await bucket().put(key, bytes);
        try {
            const e = await mutate(u.id, { id, kind: 'export', data: { key, name: f.name.replace(/[\r\n]/g, ''), size: f.size, hash: digest, expiresAt: parent?.data.expiresAt || Date.now() + BACKUP_TTL, ...(parent ? { backupId, partIndex: index } : {}) }, baseVersion: 0, operationId: 'export-' + id, internal: true, ...(parent ? { guardRecord: { id: parent.id, version: parent.version } } : {}) });
            return json({ id: e.id, url: '/api/exports?id=' + e.id, name: f.name, size: f.size });
        } catch (e) {
            const registered = await store.get(id);
            if (!registered || registered.data.key !== key || registered.deleted) await bucket().delete(key).catch(() => {});
            throw e;
        }
    } catch (e) { return failure(e); }
}

export async function GET(r: Request) {
    try {
        const u = await actor(r), q = new URL(r.url).searchParams;
        if (q.get('list') === '1') return json({ backups: backupBundles(await storeFor(u.id).list()), serverTime: Date.now() });
        const e = await getEntry(u.id, q.get('id') || '');
        if (!e || e.kind !== 'export' || e.deleted || !e.data.key?.startsWith(u.id + '/exports/')) throw Object.assign(new Error('备份分包不存在或已删除'), { status: 404 });
        const parent = e.data.backupId ? await getEntry(u.id, e.data.backupId) : null;
        if (e.data.backupId && (!parent || parent.kind !== 'backup' || parent.deleted || parent.data.status !== 'ready')) throw Object.assign(new Error('备份未完成或正在清理，不能下载'), { status: 409 });
        if (!parent?.data.protected && Date.now() >= (parent?.data.expiresAt ?? e.data.expiresAt)) throw Object.assign(new Error('备份已过期，可在备份管理中清理或重新生成'), { status: 410 });
        const object = await bucket().get(e.data.key);
        if (!object) throw new Error('备份字节缺失，请重新生成；原始资料未受影响');
        return new Response(object.body, { headers: { 'Content-Type': 'application/zip', 'Content-Length': String(object.size), 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(e.data.name), 'Cache-Control': 'private,no-store', 'X-Content-Type-Options': 'nosniff' } });
    } catch (e) { return failure(e); }
}

export async function DELETE(r: Request) {
    try {
        checkOrigin(r); const u = await actor(r), x = await r.json() as any;
        if (!Array.isArray(x.ids) || !x.ids.length || x.ids.length > 20 || x.ids.some((id: any) => typeof id !== 'string' || id.length > 180)) throw new Error('每次可清理1至20套备份');
        const receipts = [];
        for (const id of new Set<string>(x.ids)) receipts.push(await deleteBackup(storeFor(u.id), u.id, id));
        return json({ receipts });
    } catch (e) { return failure(e); }
}

/** Binary transport avoids multipart form buffering for multi-megabyte backup volumes. */
export async function PUT(r:Request){let cleanupKey='';try{
 checkOrigin(r);const u=await actor(r),q=new URL(r.url).searchParams,backupId=q.get('id')||'',index=Number(q.get('part')),name=q.get('name')||'';
 if(Number(r.headers.get('content-length'))>6*1024*1024)throw new Error('二进制备份分包上限6MiB');
 const parent=await getEntry(u.id,backupId);if(!parent||parent.kind!=='backup'||parent.deleted||parent.data.status!=='building'||parent.data.expiresAt<=Date.now()||!Number.isInteger(index)||index<0||index>=parent.data.expectedParts||!/^backup-[a-zA-Z0-9-]+-part\d+\.zip$/.test(name))throw new Error('备份会话或分包参数无效');
 const bytes=await r.arrayBuffer();if(bytes.byteLength>6*1024*1024)throw new Error('二进制备份分包上限6MiB');
 const digest=await hash(bytes),id=backupId+'.part'+index,old=await getEntry(u.id,id);if(old){if(old.deleted||old.kind!=='export'||old.data.hash!==digest||old.data.name!==name)throw new Error('分包重试内容不一致');return json({id:old.id,name,url:'/api/exports?id='+old.id});}
 const key=u.id+'/exports/'+id+'/'+digest+'/'+crypto.randomUUID();cleanupKey=key;
 if(bytes.byteLength>1024*1024){const mp=await bucket().createMultipartUpload(key);try{const part=await mp.uploadPart(1,bytes);await mp.complete([part]);}catch(e){await mp.abort().catch(()=>{});throw e;}}else await bucket().put(key,bytes);
 const e=await mutate(u.id,{id,kind:'export',data:{key,name,size:bytes.byteLength,hash:digest,expiresAt:parent.data.expiresAt,backupId,partIndex:index},baseVersion:0,operationId:'export-'+id,internal:true,guardRecord:{id:parent.id,version:parent.version}});cleanupKey='';return json({id:e.id,name,url:'/api/exports?id='+id});
 }catch(e){if(cleanupKey){try{const u=await actor(r),id=new URL(r.url).searchParams.get('id')+'.part'+new URL(r.url).searchParams.get('part'),registered=await getEntry(u.id,id);if(!registered||registered.data.key!==cleanupKey)await bucket().delete(cleanupKey);}catch{}}return failure(e);}}
