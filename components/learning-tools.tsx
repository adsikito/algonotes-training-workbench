'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Bell, Pause, Play, RotateCcw, Timer, Plus, Trash2, Download, CheckCircle2 } from 'lucide-react';
import type { Entry } from '../lib/domain';
import { elapsedSeconds, learningSuggestions, sameOutput, createId, openExternal } from '../lib/workspace';
import { download } from '../lib/backup-client';
export function LearningOverview({ problems, entries, day, listIds, open, prefs, onPrefs, onReview, tell }: any) {
    const suggestions = useMemo(() => learningSuggestions(problems, entries, day, listIds), [problems, entries, day, listIds]);
    const notices = entries.filter((e: Entry) => !e.deleted && ((e.kind === 'review' && e.data.status === '待做' && e.data.due <= day) || (e.kind === 'feedback' && e.data.status !== '已解决'))).map((e: Entry) => ({ entry: e, key: e.id + ':' + e.version })).filter((n: any) => !prefs.dismissed.includes(n.key));
    return <section className="learning-overview"><div className="section-heading"><h2>继续一件有价值的事</h2><span className="mini">按你的选择与真实记录建议</span></div><div className="suggestion-grid">{suggestions.map(s => <div className="suggestion-card" key={s.problem.id}><button className="suggestion-open" onClick={() => open(s.problem)}><span>{s.problem.code}</span><strong>{s.problem.title}</strong><p>{s.reason}</p></button><button className="suggestion-ext" aria-label={'新窗口打开原站 ' + s.problem.code} onClick={() => { const msg = openExternal(s.problem.url); if (msg) tell?.(msg); }}><ArrowUpRight size={15}/></button></div>)}</div>{!suggestions.length && <p className="muted">当前没有待继续的已选内容，可从训练池自由选择。</p>}{notices.length > 0 && <div className="inbox-notices"><div><Bell size={16}/><strong>你的待处理事项 · {notices.length}</strong><button className="text-button" onClick={onReview}>打开复习与卡点</button></div>{notices.slice(0, 4).map((n: any) => <div className="notice-row" key={n.key}><span>{n.entry.kind === 'review' ? '复习安排' : '卡点'} · {n.entry.data.title}</span><button className="text-button" onClick={() => onPrefs({ ...prefs, dismissed: [...prefs.dismissed, n.key] })}>隐藏此提醒</button></div>)}<small>隐藏只收起本版本提醒，不改变任务状态；内容更新后可以再次出现。没有站外推送。</small></div>}</section>;
}
export function CoveragePanel({ problems, entries, onTopic }: any) { const rows = useMemo(() => { const groups = new Map<string, any[]>(); for (const p of problems) {
    const topic = p.knowledge || p.topic || '未分类';
    groups.set(topic, [...(groups.get(topic) ?? []), p]);
} return [...groups].map(([topic, ps]) => { const ids = new Set(ps.map(p => p.id)); const active = entries.filter((e: Entry) => !e.deleted); return { topic, total: ps.length, practiced: new Set(active.filter((e: Entry) => e.kind === 'attempt' && ids.has(e.data.problemId)).map((e: Entry) => e.data.problemId)).size, independent: new Set(active.filter((e: Entry) => e.kind === 'submission' && ids.has(e.data.problemId) && e.data.result === 'AC' && e.data.help === '独立').map((e: Entry) => e.data.problemId)).size }; }); }, [problems, entries]); return <details className="coverage-panel"><summary>专题覆盖与证据 · {rows.length}个分支</summary><p className="tiny">题库覆盖不是熟练度。独立AC只统计同一条提交中明确的AC与独立；没有记录保持未知。</p><div className="coverage-table"><table><caption className="tiny">按知识点分支统计真实练习与独立AC证据；未记录保持未知</caption><thead><tr><th>分支</th><th>题库</th><th>练过</th><th>明确独立AC</th><th>回查</th></tr></thead><tbody>{rows.map(r => <tr key={r.topic}><td>{r.topic}</td><td>{r.total}</td><td>{r.practiced}</td><td>{r.independent}</td><td><button className="text-button" onClick={() => onTopic(r.topic)}>查看题目</button></td></tr>)}</tbody></table></div></details>; }
export function PracticeTimer({ owner, attemptId, onMinutes, tell }: any) {
    const [base, setBase] = useState(0), [started, setStarted] = useState<number | null>(null), [now, setNow] = useState(Date.now()), [ready, setReady] = useState(false), [armReset, setArmReset] = useState(false); const resetTimer = useRef<any>(null); useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);
    const key = 'algonotes-timer:' + owner + ':' + attemptId;
    useEffect(() => { try {
        const old = JSON.parse(localStorage.getItem(key) || '{}');
        setBase(Math.max(0, Number(old.base) || 0));
        setStarted(typeof old.started === 'number' ? old.started : null);
    }
    catch { } setReady(true); return () => setReady(false); }, [key]);
    useEffect(() => { if (!ready)
        return; try {
        localStorage.setItem(key, JSON.stringify({ base, started }));
    }
    catch { } }, [base, started, key, ready]);
    useEffect(() => { if (started === null)
        return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [started]);
    const seconds = elapsedSeconds(base, started, now), pause = () => { const value = elapsedSeconds(base, started, Date.now()); setBase(value); setStarted(null); return value; };
    return <section className="practice-timer"><div><Timer size={16}/><strong>{Math.floor(seconds / 60).toString().padStart(2, '0')}:{(seconds % 60).toString().padStart(2, '0')}</strong><span className="mini">{started === null ? '已暂停' : '计时中'}</span></div><div className="button-group"><button className="button small" onClick={() => { if (started !== null)
        pause();
    else {
        setNow(Date.now());
        setStarted(Date.now());
    } }}>{started !== null ? <Pause size={13}/> : <Play size={13}/>} {started !== null ? '暂停' : '开始'}</button><button className="button small" onClick={() => { const value = pause(); onMinutes((value / 60).toFixed(1)); tell('已填入用时，请保存本次记录；不会自动记为完成'); }}>填入用时</button><button className={'icon-button' + (armReset ? ' danger-button' : '')} aria-label={armReset ? '确认重置（再点一次执行）' : '重置计时器'} onClick={() => { if (!armReset) { setArmReset(true); if (resetTimer.current) clearTimeout(resetTimer.current); resetTimer.current = setTimeout(() => setArmReset(false), 3000); return; } if (resetTimer.current) clearTimeout(resetTimer.current); setArmReset(false); setBase(0); setStarted(null); }}><RotateCcw size={13}/></button></div><p>手动开始/暂停；本设备可恢复。云端用时以“填入用时”后保存记录为准。</p></section>;
}
export function TestCaseNotebook({ value, onChange }: any) { const cases = Array.isArray(value) ? value : []; const patch = (i: number, key: string, v: string) => onChange(cases.map((c: any, n: number) => n === i ? { ...c, [key]: v } : c)); return <details className="test-notebook"><summary>我的测试与反例（{cases.length}）</summary><p className="tiny">手动记录输入、预期和实际输出，不执行代码。文本相同不代表已通过OJ。</p>{cases.map((c: any, i: number) => <section className="test-case" key={c.id}><header><input aria-label={'测试名称 ' + (i + 1)} value={c.title} placeholder="例如：空区间、重复值" onChange={e => patch(i, 'title', e.target.value)}/><button className="icon-button" aria-label={'移除测试 ' + (i + 1)} onClick={() => onChange(cases.filter((_: any, n: number) => n !== i))}><Trash2 size={14}/></button></header><label>输入<textarea value={c.input} rows={2} onChange={e => patch(i, 'input', e.target.value)}/></label><label>预期输出<textarea value={c.expected} rows={2} onChange={e => patch(i, 'expected', e.target.value)}/></label><label>实际输出<textarea value={c.actual} rows={2} onChange={e => patch(i, 'actual', e.target.value)}/></label>{c.actual !== '' && <p className={sameOutput(c.expected, c.actual) ? 'comparison-equal' : 'comparison-different'}>{sameOutput(c.expected, c.actual) ? '逐字一致' : '逐字不同（包含空格与换行）'}</p>}<label>发现与原因<textarea value={c.note} rows={2} onChange={e => patch(i, 'note', e.target.value)}/></label></section>)}<div className="button-group"><button className="button small" disabled={cases.length >= 20} onClick={() => onChange([...cases, { id: createId(), title: '', input: '', expected: '', actual: '', note: '' }])}><Plus size={13}/>新增测试</button>{cases.length > 0 && <button className="button small" onClick={() => download(JSON.stringify(cases, null, 2), '我的测试与反例.json', 'application/json')}><Download size={13}/>导出</button>}</div><p className="tiny">最多20项，随“保存本次记录”写入当前尝试。</p></details>; }
