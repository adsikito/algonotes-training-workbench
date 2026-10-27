'use client';
import { useEffect, useRef, useState } from 'react';
import { Cloud, NotebookPen } from 'lucide-react';
import { readDraft } from '../lib/drafts';
import type { Entry } from '../lib/domain';
import { createId } from '../lib/workspace';
import { useNoteSync } from './use-note-sync';
/* 共享同步引擎接入（03 §6.13 ⑧.6 / §7 #7）：writeDraft/flush 状态机迁移至 useNoteSync，
   行为契约逐条保留（挂载自动恢复/900ms flush/IME 防抖/文案逐字）；空笔记不落库（K2✔）经 isEmpty 生效。 */
export function QuickProblemNote({ problem, owner, entry, save, open }: any) {
    const initial = useRef<Entry>(entry ?? { id: createId(), kind: 'note', data: { title: problem.code + ' · 随手记', body: '', problemId: problem.id, problemIds: [problem.id], folderId: '', tags: [], quick: true }, version: 0, deleted: false, updated: new Date().toISOString() });
    const [body, setBody] = useState(initial.current.data.body), [ready, setReady] = useState(false);
    const key = owner + ':' + initial.current.id;
    const sync = useNoteSync({ key, entry: initial.current, save, initialStatus: entry ? '云端已保存' : '一句话也可以', messages: { draftSaved: '本机草稿已保存 · 等待同步', draftSavedOffline: '本机草稿已保存 · 等待同步', draftFailed: '本机保存失败，请复制正文并重试', syncing: '正在同步…', saved: '云端已保存', failed: (m: string) => '未同步：' + m, skippedEmpty: '一句话也可以' }, isEmpty: (data: any) => !String(data.body ?? '').trim() });
    useEffect(() => { let alive = true; readDraft(key).then(d => { if (alive && d?.data) {
        sync.adoptDraft(d);
        setBody(d.data.body);
        sync.setStatus('已恢复本机待同步内容');
    } if (alive)
        setReady(true); }).catch(() => { if (alive)
        setReady(true); }); return () => { alive = false; }; }, []);
    function change(value: string) { setBody(value); sync.update({ ...sync.latest.current, body: value }); }
    return <div className="quick-problem-note"><label htmlFor={'quick-note-' + problem.id}><NotebookPen size={17}/><strong>随手记理解与感悟</strong></label><textarea id={'quick-note-' + problem.id} aria-label="题下随手记" rows={3} value={body} disabled={!ready} placeholder="哪一步想通了？哪里还找不到错？直接写在这里…" onChange={e => change(e.target.value)} onBlur={() => { sync.flush(); }} onCompositionStart={() => sync.beginCompose()} onCompositionEnd={() => sync.endCompose()}/><div><span role="status"><Cloud size={13}/>{sync.status}</span><button className="text-button" onClick={async () => { await sync.flush(); open({ ...sync.current.current, data: sync.latest.current }); }}>展开完整笔记</button><button className="text-button" onClick={() => { sync.flush(); }}>立即保存</button></div></div>;
}
