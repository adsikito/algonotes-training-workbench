'use client';
import { useEffect, useMemo, useState } from 'react';
import { Archive, Download, RefreshCw, ShieldCheck, ShieldOff, Trash2, Search, AlertCircle } from 'lucide-react';
import { Modal, Pill, Empty } from './workspace-ui';
import type { BackupBundle, DeleteReceipt } from '../lib/backup-manager';

const size = (n: number) => (n / 1024 / 1024).toFixed(2) + ' MiB';
const date = (v: number | string) => new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const statusLabel = { ready: '完整可下载', building: '生成未完成', deleting: '清理未完成', expired: '已过期', legacy: '旧版 · 完整性待核对' };
export function BackupManager({ close, create, creating, restore, restoreCloud, tell }: { close: () => void; create: () => Promise<void>; creating: boolean; restore: () => void; restoreCloud?: (b:any)=>void; tell: (s: string) => void }) {
    const [items, setItems] = useState<BackupBundle[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [selected, setSelected] = useState<string[]>([]), [pending, setPending] = useState<BackupBundle[]>([]), [receipts, setReceipts] = useState<DeleteReceipt[]>([]);
    async function load() {
        setLoading(true); setError('');
        try { const r = await fetch('/api/exports?list=1'); const x: any = await r.json(); if (!r.ok) throw new Error(x.error); setItems(x.backups); setSelected(s => s.filter(id => x.backups.some((b: BackupBundle) => b.id === id && !b.protected))); }
        catch (e: any) { setError(e.message); } finally { setLoading(false); }
    }
    useEffect(() => { load(); }, []);
    const filtered = useMemo(() => items.filter(b => (filter === 'all' || filter === 'protected' && b.protected || filter === 'expired' && b.status === 'expired' || filter === 'unfinished' && ['building', 'deleting'].includes(b.status)) && (b.title + b.id + b.createdAt).toLocaleLowerCase().includes(query.toLocaleLowerCase())), [items, filter, query]);
    const expired = items.filter(b => b.status === 'expired' && !b.protected);
    const total = items.reduce((n, b) => n + b.size, 0);
    async function protect(b: BackupBundle) {
        setBusy(true); setError('');
        try { const r = await fetch('/api/exports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'protect', id: b.id, protected: !b.protected }) }); const x: any = await r.json(); if (!r.ok) throw new Error(x.error); await load(); tell(b.protected ? '已解除保护，从现在起保留7天' : '已保护：保留下载，清理时自动跳过'); }
        catch (e: any) { setError(e.message); } finally { setBusy(false); }
    }
    async function remove() {
        setBusy(true); setError(''); const ids = pending.map(b => b.id); setPending([]); const result: DeleteReceipt[] = [];
        try {
            for (let i = 0; i < ids.length; i += 20) {
                const chunk = ids.slice(i, i + 20);
                try { const r = await fetch('/api/exports', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: chunk }) }); const x: any = await r.json(); if (!r.ok) throw new Error(x.error); result.push(...x.receipts); }
                catch (e: any) { result.push(...chunk.map(id => ({ id, ok: false, removedParts: 0, removedBytes: 0, error: '结果未确认：' + e.message + '，刷新后可安全重试' }))); break; }
            }
            setReceipts(result); setSelected([]); await load();
            tell(`已清理${result.filter(r => r.ok).length}套，失败或未确认${result.filter(r => !r.ok).length}套，未处理${ids.length - result.length}套`);
        } finally { setBusy(false); }
    }
    const disabled = busy || creating;
    return <Modal title="备份管理" close={() => { if (disabled) { tell('当前操作正在确认，请稍候关闭'); return; } close(); }} wide>
        <div className="backup-intro"><Archive size={26}/><div><h3>备份副本，单独管理</h3><p>管理云端备份的全部分包。删除副本不会影响题目、笔记、做题记录和资料原件，也不会删除电脑上已下载的 ZIP。</p></div></div>
        <div className="backup-stats"><div><strong>{items.length}</strong><span>套备份</span></div><div><strong>{size(total)}</strong><span>副本占用（记录值）</span></div><div><strong>{expired.length}</strong><span>已过期可清理</span></div></div>
        <div className="button-group backup-actions"><button className="button primary" disabled={disabled} onClick={async () => { await create(); await load(); }}>{creating ? '正在生成与校验…' : '生成完整备份'}</button><button className="button" disabled={disabled} onClick={restore}>从本地备份恢复</button><button className="button" disabled={disabled || loading} onClick={load}><RefreshCw size={15}/>刷新</button><button className="button" disabled={disabled || !expired.length} onClick={() => setPending(expired)}><Trash2 size={15}/>清理已过期</button></div>
        <p className="mini">普通副本保留7天，到期停止下载；点击清理后才释放存储。完整副本可以设为保护，解除保护后重新保留7天。新备份分块处理原件与元数据，最多1000个分包；旧格式仍可恢复。</p>
        <div className="backup-filters"><label className="search-field"><Search size={16}/><input aria-label="搜索备份" placeholder="搜索名称、日期或备份编号" value={query} onChange={e => setQuery(e.target.value)}/></label><select aria-label="备份状态" value={filter} onChange={e => { setFilter(e.target.value); setSelected([]); }}><option value="all">全部备份</option><option value="protected">已保护</option><option value="expired">已过期</option><option value="unfinished">未完成 / 清理失败</option></select></div>
        {error && <div className="callout" role="alert"><AlertCircle size={16}/>{error}</div>}
        {!!selected.length && <div className="bulk-toolbar"><strong>已选{selected.length}套完整备份组</strong><button className="button small danger-button" disabled={disabled} onClick={() => setPending(items.filter(b => selected.includes(b.id) && !b.protected))}>删除所选备份</button><button className="text-button" disabled={disabled} onClick={() => setSelected([])}>取消选择</button></div>}
        {loading && <p role="status">正在读取备份目录…</p>}
        <div className="backup-list">{filtered.map(b => <article className="backup-card" key={b.id}>
            <header><input type="checkbox" aria-label={'选择备份 ' + b.id} disabled={disabled || b.protected} checked={selected.includes(b.id)} onChange={e => setSelected(s => e.target.checked ? [...s, b.id] : s.filter(id => id !== b.id))}/><div><strong>{b.title}</strong><small>{date(b.createdAt)} · {b.parts.length}/{b.expectedParts}个分包 · {size(b.size)}</small></div><Pill tone={b.status === 'ready' ? 'green' : 'amber'}>{statusLabel[b.status]}</Pill></header>
            <p className="mini">{b.protected ? '已保护，不自动到期' : '到期时间：' + date(b.expiresAt)} · 编号 {b.id}</p>
            <div className="button-group">{!b.legacy && (b.status === 'ready' || b.protected) && <button className="button small" disabled={disabled} onClick={() => protect(b)}>{b.protected ? <ShieldOff size={14}/> : <ShieldCheck size={14}/>} {b.protected ? '解除保护' : '保护此备份'}</button>}<button className="button small danger-button" disabled={disabled || b.protected} onClick={() => setPending([b])}><Trash2 size={14}/>{b.status === 'deleting' ? '重试清理' : '删除整套'}</button></div>
            {b.status==='ready'&&restoreCloud&&<button className="button small" disabled={creating} onClick={()=>restoreCloud(b)}>校验并恢复为独立副本</button>}{b.error&&<p className="inline-error">上次中断原因：{b.error}</p>}<details><summary>查看{b.parts.length}个分包{b.legacy ? '（旧版不自动推定完整）' : ''}</summary>{b.parts.map(p => ['ready', 'legacy'].includes(b.status) ? <a className="download-volume" key={p.id} href={p.url} download={p.name}><Download size={15}/><span>{p.name}</span><small>{size(p.size)}</small></a> : <p className="mini" key={p.id}>{p.name} · {size(p.size)}</p>)}</details>
        </article>)}</div>
        {!loading && !filtered.length && <Empty title={items.length ? '没有符合条件的备份' : '还没有云端备份副本'} text="生成后会在这里保留历史入口，关闭窗口后也能再次下载和管理。"/>}
        {!!receipts.length && <section className="backup-receipts" aria-live="polite"><h3>本次清理结果</h3>{receipts.map(r => <p key={r.id}>{r.ok ? '已清理' : '未完成'} · {r.id} · {r.removedParts}个分包{r.error ? ' · ' + r.error : ''}</p>)}</section>}
        <p className="tiny">请把同一套的全部分包下载并放在一起。成功生成不等于已下载，也不等于已完成恢复演练。</p>
        {!!pending.length && <Modal title="确认删除备份副本" close={() => setPending([])}><p>将永久删除 <strong>{pending.length}套备份、{pending.reduce((n, b) => n + b.parts.length, 0)}个分包</strong>，记录大小 {size(pending.reduce((n, b) => n + b.size, 0))}。</p><div className="callout">这会取消对应备份的下载和恢复入口，无法从回收站恢复。正在使用的原始资料、题目和笔记不受影响；本地已下载副本仍保留。</div><ul className="backup-confirm-list">{pending.map(b => <li key={b.id}>{b.title} · {date(b.createdAt)}</li>)}</ul><div className="button-group"><button className="button" onClick={() => setPending([])}>保留备份</button><button className="button danger-button" onClick={remove}>确认永久删除这些副本</button></div></Modal>}
    </Modal>;
}
