'use client';
import { useState, useEffect, useRef } from 'react';
import { Cloud, History, Download, Save, Code2, ListChecks, Paperclip, Eye } from 'lucide-react';
import { readDraft, writeDraft, removeDraft } from '../lib/drafts';
import { download } from '../lib/backup-client';
import { folderRows, noteProblemIds } from '../lib/workspace';
import {FileDownload} from './file-download';
import {RelationPanel} from './study-hub';
import { Modal, Markdown, Pill } from './workspace-ui';
export default function NoteEditor({ entry, owner, problems, folders, files, save, close, tell, upload, showHistory, onSaved, openFile, entries, referenceOptions, openEntity, remove }: any) {
    const [title, setTitle] = useState(entry.data.title), [body, setBody] = useState(entry.data.body), [folderId, setFolderId] = useState(entry.data.folderId || ''), [tags, setTags] = useState((entry.data.tags || []).join('，')), [preview, setPreview] = useState(false), [status, setStatus] = useState(entry.version ? '云端已保存' : '尚未保存'), [recover, setRecover] = useState<any>(null);
    const current = useRef(entry), latest = useRef<any>(null), dirty = useRef(false), saving = useRef(false), timer = useRef<any>(null), textRef = useRef<HTMLTextAreaElement>(null), composition = useRef(false), attachmentRef = useRef<HTMLInputElement>(null);
    const [problemIds, setProblemIds] = useState<string[]>(noteProblemIds(entry.data));
    const key = owner + ':' + entry.id;
    useEffect(() => {
        if (!entry.version && entry.data.body) {
            latest.current = { ...entry.data };
            dirty.current = true;
            writeDraft(key, { data: entry.data, baseVersion: 0, at: new Date().toISOString() }).then(() => setStatus('本机已保存 · 等待同步')).catch(() => { });
            timer.current = setTimeout(flush, 900);
        }
        readDraft(key).then(d => {
            if (d && d.data && JSON.stringify(d.data) !== JSON.stringify(entry.data))
                setRecover(d);
        }).catch(() => setStatus('本机草稿不可用，请及时云端保存'));
        return () => { clearTimeout(timer.current); };
    }, []);
    async function flush() {
        if (saving.current || !dirty.current || composition.current)
            return;
        saving.current = true;
        const snapshot = latest.current;
        dirty.current = false;
        if (snapshot == null) { saving.current = false; return; }
        if (!current.current.version && !String(snapshot.title ?? '').trim() && !String(snapshot.body ?? '').trim()) { await removeDraft(key); setStatus('尚未保存'); saving.current = false; return; }
        setStatus('正在同步…');
        try {
            const out = await save('note', snapshot, current.current, entry.id);
            current.current = out;
            onSaved(out);
            if (!dirty.current) {
                await removeDraft(key);
                setStatus('云端已保存');
            }
            else {
                setStatus('新内容待同步');
                timer.current = setTimeout(flush, 800);
            }
        }
        catch (e: any) {
            dirty.current = true;
            setStatus('未同步 · ' + e.message);
        }
        finally {
            saving.current = false;
        }
    }
    useEffect(() => { const listener = () => flush(); window.addEventListener('online', listener); return () => window.removeEventListener('online', listener); }, []);
    const liveFields=useRef<any>({});liveFields.current={title,body,folderId,problemIds,tags};
    function change(patch: any) { const next = { ...current.current.data, ...latest.current, ...liveFields.current, problemId: liveFields.current.problemIds[0] || '', tags: liveFields.current.tags.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean), ...patch }; latest.current = next; dirty.current = true; writeDraft(key, { data: next, baseVersion: current.current.version, at: new Date().toISOString() }).then(() => setStatus(navigator.onLine ? '本机已保存 · 等待同步' : '离线 · 已保留本机草稿')).catch(() => setStatus('本机草稿保存失败，请立即下载正文')); clearTimeout(timer.current); timer.current = setTimeout(flush, 900); }
    async function attach(file:File){
        if(!current.current.version){
            if(saving.current)throw new Error('笔记正在保存，请稍后重试附件');
            clearTimeout(timer.current);saving.current=true;
            try{const out=await save('note',latest.current||{...entry.data,title,body,folderId,problemIds},current.current,entry.id);current.current=out;onSaved(out);}
            finally{saving.current=false;}
        }
        const f=await upload(file,{problemId:problemIds[0]||'',parentId:entry.id,folderId});
        const ids=Array.from(new Set([...(latest.current?.fileIds||current.current.data.fileIds||[]),f.id]));change({fileIds:ids});return f;
    }
    function insert(value: string) { const ta = textRef.current; const start = ta?.selectionStart ?? body.length, end = ta?.selectionEnd ?? body.length; const text=latest.current?.body??body;const next = text.slice(0, start) + value + text.slice(end); setBody(next); change({ body: next }); requestAnimationFrame(() => { ta?.focus(); ta?.setSelectionRange(start + value.length, start + value.length); }); }
    return <Modal title="我的笔记" close={() => {
            if (dirty.current)
                tell('未同步内容保留在本机；再次打开可恢复');
            close();
        }} wide><div className="editor-meta"><span className={'save-status ' + (status.includes('未同步') ? 'warning' : '')}><Cloud size={13}/>{status}</span><div className="button-group"><button className="icon-button" aria-label="历史版本" onClick={showHistory}><History size={16}/></button><button className="button small" onClick={() => download(body, (title || '笔记') + '.md', 'text/markdown')}><Download size={14}/>下载 MD</button><button className="button small primary" onClick={flush}><Save size={14}/>立即保存</button></div></div>{recover && <div className="callout">发现未同步草稿（{recover.at?.slice(0, 16)}）。<button className="text-button" onClick={() => { setTitle(recover.data.title); setBody(recover.data.body); setFolderId(recover.data.folderId || ''); setProblemIds(noteProblemIds(recover.data)); setTags((recover.data.tags||[]).join('，')); latest.current = recover.data; dirty.current = true; current.current = { ...current.current, version: recover.baseVersion }; setRecover(null); setStatus('已恢复本机草稿，点击立即保存'); }}>恢复草稿</button><button className="text-button" onClick={() => { removeDraft(key); setRecover(null); }}>使用云端版</button></div>}
 <div className="note-source-links">{files.filter((f:any)=>(entry.data.fileIds??[]).includes(f.id)||entry.data.sourceFileId===f.id).map((f:any)=><button className="button small" key={f.id} onClick={()=>openFile?.(f)}><Paperclip size={14}/>关联原件：{f.data.name}</button>)}</div>
 <input className="note-title-input" aria-label="笔记标题" value={title} onChange={e => { setTitle(e.target.value); change({ title: e.target.value }); }} placeholder="给这个想法取个名字"/>
 <div className="editor-settings"><label>文件夹<select value={folderId} onChange={e => { setFolderId(e.target.value); change({ folderId: e.target.value }); }}><option value="">收件箱</option>{folderRows(folders).map(r => <option key={r.entry.id} value={r.entry.id}>{r.path}</option>)}</select></label><label>标签<input value={tags} placeholder="用逗号分隔，可自定义" onChange={e => { setTags(e.target.value); change({ tags: e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean) }); }}/></label><label>关联题目（可多选）<select multiple aria-label="关联题目" value={problemIds} onChange={e => { const ids = Array.from(e.target.selectedOptions).map(o => o.value); setProblemIds(ids); change({ problemIds: ids, problemId: ids[0] || '' }); }}>{problems.map((p: any) => <option key={p.id} value={p.id}>{p.code} · {p.title}</option>)}</select></label></div>
 <div className="editor-toolbar"><div><button onClick={() => insert('**加粗文字**')} aria-label="插入加粗"><strong>B</strong></button><button onClick={() => insert('\n## 小标题\n')} aria-label="插入标题">H2</button><button onClick={() => insert('\n```cpp\n// 代码写在这里\n```\n')} aria-label="插入代码"><Code2 size={16}/></button><button onClick={() => insert('\n- ')} aria-label="插入列表"><ListChecks size={16}/></button><button onClick={() => attachmentRef.current?.click()} aria-label="添加附件"><Paperclip size={16}/></button></div><button className={preview ? 'active' : ''} onClick={() => setPreview(!preview)}><Eye size={15}/>{preview ? '编辑' : '预览'}</button></div>
 {preview ? <div className="editor-preview"><Markdown body={body || '*还没有正文。*'}/></div> : <textarea ref={textRef} className="note-editor" aria-label="笔记正文" value={body} placeholder="哪一步想通了？为什么这么做？先随手写下来…\n\n支持 Markdown、代码块和数学公式。" onCompositionStart={() => composition.current = true} onCompositionEnd={() => { composition.current = false; clearTimeout(timer.current); timer.current = setTimeout(flush, 700); }} onChange={e => { setBody(e.target.value); change({ body: e.target.value }); }} onPaste={async (e) => {
                const file = Array.from(e.clipboardData.files).find(f => f.type.startsWith('image/'));
                if (file) {
                    e.preventDefault();
                    try {
                        const f = await attach(file);
                        insert(`\n![${f.data.name}](/api/files?id=${f.id}&preview=1)\n`);
                        tell('图片原件已保存');
                    }
                    catch (e: any) {
                        tell(e.message);
                    }
                }
            }}/>}
 <div className="editor-bottom"><span>{body.length} 字符 · Markdown</span><span>正文可离线编辑，云端确认后跨设备可见</span></div><div className="attached-list">{files.filter((f: any) => f.data.parentId === entry.id).map((f: any) => <div key={f.id}><Paperclip size={13}/>{f.data.name}<FileDownload entry={f}/></div>)}</div>
 <RelationPanel target={{id:entry.id,type:'note',title,version:current.current.version}} entries={entries||[]} options={referenceOptions||[]} save={async(...args:any[])=>{await flush();if(!current.current.version)throw new Error('请先保存笔记');return save(...args);}} remove={remove} open={openEntity} tell={tell}/>
 <input ref={attachmentRef} hidden type="file" onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file)
                return;
            try {
                const f = await attach(file);
                insert(`\n[${f.data.name}](/api/files?id=${f.id})\n`);
                tell('附件已保存');
            }
            catch (e: any) {
                tell(e.message);
            }
        }}/></Modal>;
}
