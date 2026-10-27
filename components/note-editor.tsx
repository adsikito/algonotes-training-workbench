'use client';
import { useState, useEffect, useRef } from 'react';
import { Cloud, History, Download, Save, Code2, ListChecks, Paperclip, Eye } from 'lucide-react';
import { readDraft, removeDraft } from '../lib/drafts';
import { download } from '../lib/backup-client';
import { folderRows, noteProblemIds } from '../lib/workspace';
import {FileDownload} from './file-download';
import {RelationPanel} from './study-hub';
import { Modal, Markdown, ChipSelect } from './workspace-ui';
import { useNoteSync } from './use-note-sync';
/* 共享同步引擎接入（03 §6.13 ⑧.6/⑦.7 / §7 #7）：writeDraft/flush 状态机迁至 useNoteSync，
   行为契约逐条保留：IME 防抖 700ms、change 900ms flush、未上云空笔记不落库（K2✔）、
   附件“未保存先存”顺序守卫（attach）、保存成功仍有新内容 800ms 补拍、关闭未同步提示。
   E4（⑦.7）：表单 label 显式 for/id；关联题目原生 multiple select → 共享 ChipSelect（§7 #6）。 */
export default function NoteEditor({ entry, owner, problems, folders, files, save, close, tell, upload, showHistory, onSaved, openFile, entries, referenceOptions, openEntity, remove }: any) {
    const [title, setTitle] = useState(entry.data.title), [body, setBody] = useState(entry.data.body), [folderId, setFolderId] = useState(entry.data.folderId || ''), [tags, setTags] = useState((entry.data.tags || []).join('，')), [preview, setPreview] = useState(false), [recover, setRecover] = useState<any>(null);
    const textRef = useRef<HTMLTextAreaElement>(null), attachmentRef = useRef<HTMLInputElement>(null);
    const [problemIds, setProblemIds] = useState<string[]>(noteProblemIds(entry.data));
    const key = owner + ':' + entry.id;
    const sync = useNoteSync({ key, entry, save, onSaved, initialStatus: entry.version ? '云端已保存' : '尚未保存', messages: { draftSaved: '本机已保存 · 等待同步', draftSavedOffline: '离线 · 已保留本机草稿', draftFailed: '本机草稿保存失败，请立即下载正文', syncing: '正在同步…', saved: '云端已保存', pending: '新内容待同步', failed: (m: string) => '未同步 · ' + m, skippedEmpty: '尚未保存' }, isEmpty: (d: any) => !String(d.title ?? '').trim() && !String(d.body ?? '').trim(), initialData: null });
    const liveFields=useRef<any>({});liveFields.current={title,body,folderId,problemIds,tags};
    useEffect(() => {
        if (!entry.version && entry.data.body) {
            sync.bootstrap();
        }
        readDraft(key).then(d => {
            if (d && d.data && JSON.stringify(d.data) !== JSON.stringify(entry.data))
                setRecover(d);
        }).catch(() => sync.setStatus('本机草稿不可用，请及时云端保存'));
    }, []);
    useEffect(() => { const listener = () => { sync.flush(); }; window.addEventListener('online', listener); return () => window.removeEventListener('online', listener); }, []);
    function change(patch: any) { const next = { ...sync.current.current.data, ...sync.latest.current, ...liveFields.current, problemId: liveFields.current.problemIds[0] || '', tags: liveFields.current.tags.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean), ...patch }; sync.update(next); }
    async function attach(file:File){
        if(!sync.current.current.version){
            if(sync.isSaving())throw new Error('笔记正在保存，请稍后重试附件');
            sync.cancelSchedule();sync.beginManualSave();
            try{const out=await save('note',sync.latest.current||{...entry.data,title,body,folderId,problemIds},sync.current.current,entry.id);sync.markSaved(out);}
            finally{sync.endManualSave();}
        }
        const f=await upload(file,{problemId:problemIds[0]||'',parentId:entry.id,folderId});
        const ids=Array.from(new Set([...(sync.latest.current?.fileIds||sync.current.current.data.fileIds||[]),f.id]));change({fileIds:ids});return f;
    }
    function insert(value: string) { const ta = textRef.current; const start = ta?.selectionStart ?? body.length, end = ta?.selectionEnd ?? body.length; const text=sync.latest.current?.body??body;const next = text.slice(0, start) + value + text.slice(end); setBody(next); change({ body: next }); requestAnimationFrame(() => { ta?.focus(); ta?.setSelectionRange(start + value.length, start + value.length); }); }
    return <Modal title="我的笔记" close={() => {
            if (sync.dirty.current)
                tell('未同步内容保留在本机；再次打开可恢复');
            close();
        }} wide><div className="editor-meta"><span className={'save-status ' + (sync.status.includes('未同步') ? 'warning' : '')}><Cloud size={13}/>{sync.status}</span><div className="button-group"><button className="icon-button" aria-label="历史版本" onClick={showHistory}><History size={16}/></button><button className="button small" onClick={() => download(body, (title || '笔记') + '.md', 'text/markdown')}><Download size={14}/>下载 MD</button><button className="button small primary" onClick={() => { sync.flush(); }}><Save size={14}/>立即保存</button></div></div>{recover && <div className="callout">发现未同步草稿（{recover.at?.slice(0, 16)}）。<button className="text-button" onClick={() => { setTitle(recover.data.title); setBody(recover.data.body); setFolderId(recover.data.folderId || ''); setProblemIds(noteProblemIds(recover.data)); setTags((recover.data.tags||[]).join('，')); sync.adoptDraft(recover); setRecover(null); sync.setStatus('已恢复本机草稿，点击立即保存'); }}>恢复草稿</button><button className="text-button" onClick={() => { removeDraft(key); setRecover(null); }}>使用云端版</button></div>}
 <div className="note-source-links">{files.filter((f:any)=>(entry.data.fileIds??[]).includes(f.id)||entry.data.sourceFileId===f.id).map((f:any)=><button className="button small" key={f.id} onClick={()=>openFile?.(f)}><Paperclip size={14}/>关联原件：{f.data.name}</button>)}</div>
 <input className="note-title-input" aria-label="笔记标题" value={title} onChange={e => { setTitle(e.target.value); change({ title: e.target.value }); }} placeholder="给这个想法取个名字"/>
 <div className="editor-settings"><label htmlFor="note-folder">文件夹<select id="note-folder" value={folderId} onChange={e => { setFolderId(e.target.value); change({ folderId: e.target.value }); }}><option value="">收件箱</option>{folderRows(folders).map(r => <option key={r.entry.id} value={r.entry.id}>{r.path}</option>)}</select></label><label htmlFor="note-tags">标签<input id="note-tags" value={tags} placeholder="用逗号分隔，可自定义" onChange={e => { setTags(e.target.value); change({ tags: e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean) }); }}/></label><ChipSelect label="关联题目（可多选）" options={problems.map((p: any) => ({ value: p.id, text: p.code + ' · ' + p.title }))} values={problemIds} onChange={ids => { setProblemIds(ids); change({ problemIds: ids, problemId: ids[0] || '' }); }}/></div>
 <div className="editor-toolbar"><div><button onClick={() => insert('**加粗文字**')} aria-label="插入加粗"><strong>B</strong></button><button onClick={() => insert('\n## 小标题\n')} aria-label="插入标题">H2</button><button onClick={() => insert('\n```cpp\n// 代码写在这里\n```\n')} aria-label="插入代码"><Code2 size={16}/></button><button onClick={() => insert('\n- ')} aria-label="插入列表"><ListChecks size={16}/></button><button onClick={() => attachmentRef.current?.click()} aria-label="添加附件"><Paperclip size={16}/></button></div><button className={preview ? 'active' : ''} onClick={() => setPreview(!preview)}><Eye size={15}/>{preview ? '编辑' : '预览'}</button></div>
 {preview ? <div className="editor-preview"><Markdown body={body || '*还没有正文。*'}/></div> : <textarea ref={textRef} className="note-editor" aria-label="笔记正文" value={body} placeholder="哪一步想通了？为什么这么做？先随手写下来…\n\n支持 Markdown、代码块和数学公式。" onCompositionStart={() => sync.beginCompose()} onCompositionEnd={() => sync.endCompose()} onChange={e => { setBody(e.target.value); change({ body: e.target.value }); }} onPaste={async (e) => {
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
 <RelationPanel target={{id:entry.id,type:'note',title,version:sync.current.current.version}} entries={entries||[]} options={referenceOptions||[]} save={async(...args:any[])=>{await sync.flush();if(!sync.current.current.version)throw new Error('请先保存笔记');return save(...args);}} remove={remove} open={openEntity} tell={tell}/>
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
