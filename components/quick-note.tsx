'use client';
import { useEffect, useRef, useState } from 'react';
import { Cloud, NotebookPen } from 'lucide-react';
import { readDraft, writeDraft, removeDraft } from '../lib/drafts';
import type { Entry } from '../lib/domain';
import { createId } from '../lib/workspace';
export function QuickProblemNote({ problem, owner, entry, save, open }: any) {
    const initial = useRef<Entry>(entry ?? { id: createId(), kind: 'note', data: { title: problem.code + ' · 随手记', body: '', problemId: problem.id, problemIds: [problem.id], folderId: '', tags: [], quick: true }, version: 0, deleted: false, updated: new Date().toISOString() });
    const [body, setBody] = useState(initial.current.data.body), [status, setStatus] = useState(entry ? '云端已保存' : '一句话也可以'), [ready, setReady] = useState(false);
    const current = useRef(initial.current), latest = useRef(initial.current.data), dirty = useRef(false), saving = useRef(false), composing = useRef(false), timer = useRef<any>(null), saveRef = useRef(save);
    saveRef.current = save;
    const key = owner + ':' + initial.current.id;
    useEffect(() => { let alive = true; readDraft(key).then(d => { if (alive && d?.data) {
        latest.current = d.data;
        setBody(d.data.body);
        dirty.current = true;
        current.current = { ...current.current, version: d.baseVersion ?? current.current.version };
        setStatus('已恢复本机待同步内容');
    } if (alive)
        setReady(true); }).catch(() => { if (alive)
        setReady(true); }); return () => { alive = false; clearTimeout(timer.current); }; }, []);
    async function flush() { if (composing.current || saving.current || !dirty.current)
        return current.current; saving.current = true; const snapshot = latest.current; dirty.current = false; setStatus('正在同步…'); try {
        const out = await saveRef.current('note', snapshot, current.current, current.current.id);
        current.current = out;
        if (!dirty.current) {
            await removeDraft(key);
            setStatus('云端已保存');
        }
        else
            timer.current = setTimeout(flush, 800);
        return out;
    }
    catch (e: any) {
        dirty.current = true;
        setStatus('未同步：' + e.message);
        return current.current;
    }
    finally {
        saving.current = false;
    } }
    function change(value: string) { setBody(value); latest.current = { ...latest.current, body: value }; dirty.current = true; writeDraft(key, { data: latest.current, baseVersion: current.current.version, at: new Date().toISOString() }).then(() => setStatus('本机草稿已保存 · 等待同步')).catch(() => setStatus('本机保存失败，请复制正文并重试')); clearTimeout(timer.current); timer.current = setTimeout(flush, 900); }
    return <div className="quick-problem-note"><label><NotebookPen size={17}/><strong>随手记理解与感悟</strong></label><textarea aria-label="题下随手记" rows={3} value={body} disabled={!ready} placeholder="哪一步想通了？哪里还找不到错？直接写在这里…" onChange={e => change(e.target.value)} onBlur={flush} onCompositionStart={() => { composing.current = true; clearTimeout(timer.current); }} onCompositionEnd={() => { composing.current = false; timer.current = setTimeout(flush, 700); }}/><div><span role="status"><Cloud size={13}/>{status}</span><button className="text-button" onClick={async () => { await flush(); open({ ...current.current, data: latest.current }); }}>展开完整笔记</button><button className="text-button" onClick={flush}>立即保存</button></div></div>;
}
