'use client';
import { useState, useEffect, useRef } from 'react';
import {readDraft,writeDraft,removeDraft} from '../lib/drafts';
import {download} from '../lib/backup-client';
import { ChevronLeft, ChevronRight, Bookmark, X, ExternalLink, Plus, Paperclip, FileText, Download, History, Save, Pause, Play, RefreshCw, NotebookPen, Pencil, Trash2 } from 'lucide-react';
import { localDay, attemptDays, resultMark, resultTone, progress, mastery, help, tools, results } from '../lib/domain';
import { Markdown, Modal, Pill, Select, Empty } from './workspace-ui';
import { PracticeTimer, TestCaseNotebook } from './learning-tools';
import { QuickProblemNote } from './quick-note';const VIEW_TABS = ['题目', '题下笔记', '尝试历史'];
export default function ProblemPanel({ owner, p, state, attempts, submissions, notes, files, close, save, updateState, start, createNote, openNote, upload, tell, history, review, onEditCustom, onRemoveCustom, onMistake }: any) {
    const [tab, setTab] = useState('题目'), [attemptId, setAttemptId] = useState(p.resumeAttemptId || attempts.find((a: any) => a.data.status === '进行中')?.id || attempts.at(-1)?.id || ''), [form, setForm] = useState<any>({ help: '未知', tool: '未知', code: '', reflection: '', minutes: '', blocker: '' }), [result, setResult] = useState('未提交'), [posting, setPosting] = useState(false);
    const current = attempts.find((a: any) => a.id === attemptId) ?? attempts.filter((a: any) => a.data.status === '进行中').at(-1) ?? attempts.at(-1);
    const [draftStatus,setDraftStatus]=useState(''),[recovery,setRecovery]=useState<any>(null),[confirmRemove,setConfirmRemove]=useState(false);
    const currentRef=useRef<any>(current),pending=useRef(Promise.resolve()),dirty=useRef(false),snapshotRef=useRef<any>(null);
    const draftKey=current?owner+':attempt:'+current.id:'';
    useEffect(()=>{
        currentRef.current=current;dirty.current=false;setRecovery(null);setDraftStatus('');
        if(!current)return;
        setForm({...current.data});snapshotRef.current={...current.data};
        let active=true;
        readDraft(draftKey).then(d=>{if(active&&d?.kind==='attempt')setRecovery(d);}).catch(()=>active&&setDraftStatus('本机草稿不可用，请及时保存或下载'));
        return()=>{active=false;};
    },[current?.id]);
    useEffect(()=>{const listener=(e:BeforeUnloadEvent)=>{if(dirty.current){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',listener);return()=>window.removeEventListener('beforeunload',listener);},[]);
    // G3（账本 E2 回退项）：detail-overlay 模态详情层 Tab 圈定——候选与可见过滤同 Modal 基座（workspace-ui.tsx:49-63），首尾环绕；不拦截 Esc，全局关闭顺序（workbench）保留
    useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key!=='Tab')return;const node=document.querySelector('.detail-overlay');if(!node)return;const els=Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea,select,a[href],[tabindex="0"]')).filter(el=>el.getClientRects().length>0);const first=els[0],last=els.at(-1);if(!first){e.preventDefault();return;}if(e.shiftKey&&(document.activeElement===first||!node.contains(document.activeElement))){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||!node.contains(document.activeElement))){e.preventDefault();first.focus();}};document.addEventListener('keydown',key,true);return()=>document.removeEventListener('keydown',key,true);},[]);
    function local(next:any){snapshotRef.current=next;dirty.current=true;const key=draftKey,base=currentRef.current?.version,targetId=currentRef.current?.id;
        pending.current=pending.current.catch(()=>{}).then(()=>writeDraft(key,{kind:'attempt',targetId,problemId:p.id,data:next,baseVersion:base,at:new Date().toISOString()}));
        pending.current.then(()=>setDraftStatus('本机草稿已保存 · 尚未同步云端')).catch(()=>setDraftStatus('草稿保存失败，请下载当前记录'));
    }
    const change=(key:string,value:any)=>{setForm((s:any)=>{const next={...s,[key]:value};local(next);return next;});};
    async function saveAttempt(status?: string, nested = false) {
        if (!current)
            return;
        if(!nested)setPosting(true);
        try {
            const snapshot={...form};
            const out=await save('attempt', { ...currentRef.current.data, ...snapshot, activityDays: Array.from(new Set([...(current.data.activityDays ?? [current.data.day]), localDay()])), status: status ?? currentRef.current.data.status, ...(status === '结束' && currentRef.current.data.status !== '结束' ? { endedAt: new Date().toISOString() } : {}) }, currentRef.current);
            currentRef.current=out;await pending.current;
            if(JSON.stringify(snapshotRef.current)===JSON.stringify(snapshot)){await removeDraft(draftKey);dirty.current=false;setDraftStatus('云端已保存');setRecovery(null);}
            tell('本次记录已保存，结果与掌握状态保持分开');
            return true;
        }
        catch (e: any) {
            tell(e.message);
            return false;
        }
        finally {
            if(!nested)setPosting(false);
        }
    }
    async function submission() {
        if (!current)
            return;
        setPosting(true);
        try {
            if(!await saveAttempt(undefined,true))return;
            await save('submission', { problemId: p.id, attemptId: current.id, result, help: form.help, tool: form.tool, code: form.code, tests: form.tests ?? [], at: new Date().toISOString(), source: '手动记录' });
            tell('提交结果已记录；未自动标为完成或掌握');
        }
        catch (e: any) {
            tell(e.message);
        }
        finally {
            setPosting(false);
        }
    }
    return <div className="detail-overlay" role="dialog" aria-modal="true" aria-label={p.title}><section className="detail-panel"><header className="detail-top"><button className="text-button" autoFocus onClick={close}><ChevronLeft size={16}/>返回工作台</button><div className="button-group"><button className={'icon-button ' + (state.favorite ? 'favorited' : '')} aria-label={state.favorite ? '取消收藏' : '收藏题目'} aria-pressed={!!state.favorite} onClick={() => updateState({ favorite: !state.favorite })}><Bookmark size={18} fill={state.favorite ? 'currentColor' : 'none'}/></button>{String(p.id).startsWith('custom-') && <><button className="icon-button" aria-label="编辑自定义题目" onClick={() => onEditCustom?.(p)}><Pencil size={16}/></button><button className="icon-button danger-button" aria-label="删除自定义题目" onClick={() => setConfirmRemove(true)}><Trash2 size={16}/></button></>}<button className="icon-button" aria-label="关闭题目" onClick={close}><X size={20}/></button></div></header><div className="detail-heading"><span className="eyebrow">{p.code} / {p.role}</span><h1>{p.title}</h1><div className="detail-badges"><Pill tone="green">{p.difficulty}</Pill><Pill>{p.topic}</Pill><span className="mini">通过率未采集</span><a className="text-button" href={p.url} target="_blank" rel="noreferrer">前往原站评测 <ExternalLink size={14}/></a></div></div><div className="detail-layout"><article><div className="tabs" role="tablist" aria-label="题目视图" onKeyDown={e => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? VIEW_TABS.length - 1 : (VIEW_TABS.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : -1) + VIEW_TABS.length) % VIEW_TABS.length; setTab(VIEW_TABS[next]); (e.currentTarget.querySelectorAll('[role="tab"]')[next] as HTMLElement)?.focus(); }}>{VIEW_TABS.map(t => <button role="tab" tabIndex={tab === t ? 0 : -1} aria-selected={tab === t} className={tab === t ? 'active' : ''} key={t} onClick={() => setTab(t)}>{t}{t === '题下笔记' && notes.length > 0 && <span className="count">{notes.length}</span>}</button>)}</div>{tab === '题目' && <><Markdown body={p.body}/><section className="under-note"><QuickProblemNote key={p.id} owner={owner} problem={p} entry={notes.find((n: any) => n.data.quick)} save={save} open={openNote}/><div><NotebookPen size={20}/><h3>把这道题，变成自己的理解。</h3></div><p>一句想通的地方、一段代码、一个反例，都可以留在题目下面。</p><button className="button" onClick={createNote}><Plus size={16}/>写下理解与感悟</button><button className="button" onClick={upload}><Paperclip size={15}/>上传附件</button>{notes.slice(0, 3).map((n: any) => <button className="linked-note" key={n.id} onClick={() => openNote(n)}><FileText size={16}/><div><strong>{n.data.title || '未命名笔记'}</strong><p>{n.data.body.slice(0, 100)}</p></div><ChevronRight size={15}/></button>)}</section></>}{tab === '题下笔记' && <><div className="section-heading"><h3>我的理解与感悟</h3><button className="button" onClick={createNote}><Plus size={15}/>随手记</button></div>{notes.map((n: any) => <button className="linked-note" key={n.id} onClick={() => openNote(n)}><FileText size={18}/><div><strong>{n.data.title || '未命名笔记'}</strong><p>{n.data.body.slice(0, 200)}</p></div><ChevronRight size={15}/></button>)}{!notes.length && <Empty title="先记一句，也很好" text="不要求完整题解。记录你自己的理解。" action={createNote} actionLabel="写下想法"/>}{files.length > 0 && <h3>题目附件</h3>}{files.map((f: any) => <a className="linked-note" key={f.id} href={'/api/files?id=' + f.id}><Paperclip size={16}/>{f.data.name}<Download size={15}/></a>)}</>}{tab === '尝试历史' && <>{attempts.map((a: any) => <div className="card attempt-history" key={a.id}><div><strong>{attemptDays(a.data).join(' · ') || a.data.day} · {a.data.status}</strong><button className="icon-button" aria-label="查看更正历史" onClick={() => history(a)}><History size={16}/></button></div><p>算法帮助：{a.data.help} · STL：{a.data.tool || '未知'} · 用时：{a.data.minutes || '未记录'}</p><div className="button-group">{submissions.filter((s: any) => s.data.attemptId === a.id).map((s: any) => <button className={'submission-badge ' + resultTone(s.data.result)} key={s.id} onClick={() => history(s)}>{resultMark(s.data.result)} {s.data.result} · {s.data.help}</button>)}</div><p>{a.data.reflection}</p><button className="text-button" onClick={() => setAttemptId(a.id)}>打开本次记录</button></div>)}{!attempts.length && <Empty title="还没有尝试记录" text="开始练习后，记录每一次真实过程。"/>}</>}</article><aside className="practice-sidebar"><div className="practice-box"><div className="section-heading"><h3>我的练习</h3><Pill>独立记录</Pill></div><label>题目进度<Select label="题目进度" value={state.progress} options={progress} onChange={v => updateState({ progress: v })}/></label><label>掌握自评<Select label="掌握自评" value={state.mastery} options={mastery} onChange={v => updateState({ mastery: v })}/></label><p className="tiny">AC 不自动等于独立掌握。</p><hr />{current ? <><div className="section-heading"><h4>本次尝试</h4><span className="mini">{current.data.status}</span></div><div className="attempt-draft-status" role="status" aria-live="polite">{draftStatus||'编辑后保留本机草稿，点击保存后同步云端'}</div>{recovery&&<div className="callout"><strong>发现本机练习草稿</strong><p>{recovery.at?.slice(0,16)} · 云端版本未覆盖</p><button className="button small" onClick={()=>{setForm(recovery.data);setResult(recovery.data.resultDraft||'未提交');snapshotRef.current=recovery.data;currentRef.current={...currentRef.current,version:recovery.baseVersion};dirty.current=true;setRecovery(null);setDraftStatus('已恢复本机内容，请核对后保存');}}>恢复练习草稿</button><button className="text-button" onClick={async()=>{await removeDraft(draftKey);setRecovery(null);}}>使用云端记录</button></div>}<button className="text-button" onClick={()=>download(JSON.stringify({problemId:p.id,attemptId:current.id,...form},null,2),p.code+'-练习草稿.json','application/json')}>下载当前记录</button><PracticeTimer key={current.id} owner={owner} attemptId={current.id} onMinutes={(v: string) => change("minutes", v)} tell={tell}/><label>算法帮助<Select label="算法帮助程度" value={form.help} options={help} onChange={v => change('help', v)}/></label><label>STL依赖<Select label="STL依赖" value={form.tool || '未知'} options={tools} onChange={v => change('tool', v)}/></label><label>用时（分钟，可不填）<input type="number" min="0" value={form.minutes || ''} onChange={e => change('minutes', e.target.value)}/></label><label>卡点<input value={form.blocker || ''} placeholder="例如：边界 / 模型 / 类型溢出" onChange={e => change('blocker', e.target.value)}/></label><label>一句感悟<textarea rows={3} value={form.reflection || ''} placeholder="这次最有价值的一点…" onChange={e => change('reflection', e.target.value)}/></label><details><summary>代码与复杂度</summary><textarea className="code-input" rows={9} value={form.code || ''} placeholder="粘贴本次代码（不会运行）" onChange={e => change('code', e.target.value)}/><input value={form.complexity || ''} placeholder="时间 / 空间复杂度" onChange={e => change('complexity', e.target.value)}/></details><TestCaseNotebook value={form.tests} onChange={(tests: any) => change("tests", tests)}/><div className="save-zone"><button className="button primary full" disabled={posting} onClick={() => saveAttempt()}><Save size={15}/>保存本次记录</button><div className="result-input"><Select label="本次提交结果" value={result} options={results} onChange={v=>{setResult(v);change('resultDraft',v);}}/><button className="button" disabled={posting} onClick={submission}>记录提交</button></div><div className="button-group"><button className="button small" disabled={posting} onClick={() => saveAttempt('暂缓')}><Pause size={13}/>暂缓</button><button className="button small" disabled={posting} onClick={() => saveAttempt('结束')}>结束本次</button><button className="button small" onClick={async () => {
                if (current?.data.status === '进行中' && !await saveAttempt('结束'))return;
                setAttemptId('');
                await start(true);
            }}>重做</button>{onMistake && <button className="button small" onClick={() => onMistake({ problemId: p.id, title: p.title, snapshot: current ? { attemptId: current.id, version: current.version, at: current.updated, code: current.data.code || '', testCases: current.data.tests || [] } : null })}><NotebookPen size={13}/>记为错题</button>}</div></div></> : <><p className="muted">未记录练习。推荐过，不代表已经开始。</p><button className="button primary full" onClick={() => start()}><Play size={15}/>开始一次尝试</button></>}<hr /><button className="text-button" onClick={review}><RefreshCw size={14}/>按需安排复习</button></div><div className="practice-tip"><span>提示层级</span><p>题意 → 最小提示 → 模型 → 伪代码 → 完整代码</p><small>查通用 API 与获取本题核心思路分开记录。</small></div></aside></div></section>{confirmRemove && <Modal title="删除这道自定义题目？" close={()=>setConfirmRemove(false)}><p>这道自定义题目将移入回收站，可随时恢复；练习与提交记录保留。</p><div className="button-group"><button className="button danger-solid" data-autofocus onClick={()=>{setConfirmRemove(false);onRemoveCustom?.(p);}}>确认删除</button><button className="button" onClick={()=>setConfirmRemove(false)}>取消</button></div></Modal>}</div>;
}
