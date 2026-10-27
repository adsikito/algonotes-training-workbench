'use client';
import { useEffect, useMemo, useRef, useState, useDeferredValue } from 'react';
import { Search, ChevronRight, CornerDownLeft } from 'lucide-react';
import { searchItems, searchSnippet, normalized, type SearchItem } from '../lib/workspace';
import { Empty } from './workspace-ui';

/* CommandHub 快速查找覆盖层（03 §6.3，批4）：合并 topbar 全局搜索 + SearchResults 常驻区 + 命令面板三套查找界面。
   迁移合并非新设计语言：命令注入协议（commands {label,run}）、SearchResults 的 11 kind 分组+组内分页机制、
   command-palette 的键盘模式（↑↓/Enter/选中态）原样迁移；openSearch 分发表由 workbench 注入（冻结）。
   层内不跳页：输入只更新本层状态，不触发 go()；选中命令 run() 或 open(item) 分发后才离开本层。
   Esc 两段关闭：首击清空 query 并 stopImmediatePropagation（复用全局搜索 Esc 先例，全局键不受影响），二击关层；点遮罩关层。 */
const KINDS = ['题目', '笔记', 'STL', '讲义', '个人知识', '文件', '卡点', '标记', '错题', '代码模板', '分类'];
export function CommandHub({ commands, index, open, close, initialQuery = '' }: {
    commands: { label: string; run: () => void }[];
    index: SearchItem[];
    open: (item: SearchItem) => void;
    close: () => void;
    initialQuery?: string;
}) {
    const [q, setQ] = useState(initialQuery);
    const [selected, setSelected] = useState(0);
    const [limits, setLimits] = useState<Record<string, number>>({});
    const deferred = useDeferredValue(q);
    const inputRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLElement>(null);
    const restoreRef = useRef<HTMLElement | null>(null);
    const closeRef = useRef(close); closeRef.current = close;
    const queryRef = useRef(q); queryRef.current = q;
    const actions = useMemo(() => commands.filter((c: { label: string }) => !q || c.label.toLowerCase().includes(normalized(q))), [commands, q]);
    const matches = useMemo(() => searchItems(index, deferred), [index, deferred]);
    /* 键盘选择的扁平清单：命令（非空时置顶）→ 各 kind 可见命中；组内分页展开后自动纳入 */
    const rows = useMemo(() => {
        const out: { key: string; title: string; activate: () => void }[] = [];
        actions.forEach(c => out.push({ key: 'cmd:' + c.label, title: c.label, activate: () => { closeRef.current(); c.run(); } }));
        KINDS.forEach(kind => { const hits = matches.filter(i => i.kind === kind).slice(0, limits[kind] ?? 8); hits.forEach(i => out.push({ key: kind + ':' + i.id, title: i.code ? i.code + ' · ' + i.title : i.title, activate: () => { closeRef.current(); open(i); } })); });
        return out;
    }, [actions, matches, limits, open]);
    const onQuery = (value: string) => { setQ(value); setSelected(0); };
    useEffect(() => { restoreRef.current = document.activeElement as HTMLElement | null; inputRef.current?.focus(); return () => { restoreRef.current?.focus?.(); }; }, []);
    /* Esc 两段（capture 优先于 workbench 全局 window 键）；Tab 圈定复用 Modal 模式 */
    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            if (e.isComposing)
                return;
            if (Array.from(document.querySelectorAll('.command-hub')).at(-1) !== panelRef.current)
                return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (queryRef.current.trim())
                    setQ('');
                else
                    closeRef.current();
            }
            if (e.key === 'Tab') {
                const node = panelRef.current;
                const els = Array.from(node?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? []).filter(el => el.getClientRects().length > 0);
                const first = els[0], last = els.at(-1);
                if (!first) {
                    e.preventDefault();
                    return;
                }
                if (e.shiftKey && (document.activeElement === first || !node?.contains(document.activeElement))) {
                    e.preventDefault();
                    last?.focus();
                }
                else if (!e.shiftKey && (document.activeElement === last || !node?.contains(document.activeElement))) {
                    e.preventDefault();
                    first?.focus();
                }
            }
        };
        document.addEventListener('keydown', key, true);
        return () => document.removeEventListener('keydown', key, true);
    }, []);
    useEffect(() => { panelRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selected]);
    const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(n => Math.min(rows.length - 1, n + 1)); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(n => Math.max(0, n - 1)); }
        if (e.key === 'Home' && rows.length) { e.preventDefault(); setSelected(0); }
        if (e.key === 'End' && rows.length) { e.preventDefault(); setSelected(rows.length - 1); }
        if (e.key === 'Enter' && rows[selected]) { e.preventDefault(); rows[selected].activate(); }
    };
    let rowAt = -1;
    return <div className="command-hub-overlay" onMouseDown={e => { if (e.target === e.currentTarget)
        closeRef.current(); }}><section ref={panelRef} className="command-hub" role="dialog" aria-modal="true" aria-label="快速查找">
        <div className="command-hub-input"><Search size={16}/><input ref={inputRef} data-autofocus aria-label="搜索题目、知识点或笔记" value={q} placeholder="搜索题目、知识点或笔记…" onChange={e => onQuery(e.target.value)} onKeyDown={onInputKey}/></div>
        <div className="command-hub-body" aria-busy={deferred !== q}>
            <p className="command-hub-section">命令</p>
            <div className="command-list">{actions.map(c => { rowAt++; const at = rowAt; return <button key={'cmd:' + c.label} data-active={selected === at} className={selected === at ? 'active' : ''} onMouseEnter={() => setSelected(at)} onClick={() => { closeRef.current(); c.run(); }}><CornerDownLeft size={13}/>{c.label}</button>; })}{!actions.length && <p className="tiny">没有匹配命令；下方为内容命中。</p>}</div>
            {KINDS.map(kind => { const hits = matches.filter(i => i.kind === kind); if (!hits.length)
                return null; const limit = limits[kind] ?? 8; return <section className="search-group" key={kind}><p className="command-hub-section">{kind} · {hits.length}</p>{hits.slice(0, limit).map(i => { rowAt++; const at = rowAt; return <button className={'search-hit' + (selected === at ? ' active' : '')} data-active={selected === at} key={kind + i.id} onMouseEnter={() => setSelected(at)} onClick={() => { closeRef.current(); open(i); }}><Search size={14}/><div><strong>{i.code ? i.code + ' · ' : ''}{i.title}</strong><p>{searchSnippet(i.body, deferred).text}</p></div><ChevronRight size={15}/></button>; })}{hits.length > limit && <button className="text-button" onClick={() => setLimits(s => ({ ...s, [kind]: limit + 20 }))}>继续显示，剩余{hits.length - limit}项</button>}</section>; })}
            {!rows.length && <Empty title="没有找到匹配内容" text="试试题号、函数名或笔记中的一句话；多个词以空格分隔。"/>}
        </div>
        <p className="tiny" role="status" style={{ padding: '8px 16px 0' }}>{rows.length}项匹配{rows[selected] ? ' · 当前：' + rows[selected].title : ''}</p>
        <div className="command-hub-foot"><span>↑↓ 选择</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 清空后再按关闭</span><span><kbd>⌘ K</kbd> 打开</span></div>
    </section></div>;
}
