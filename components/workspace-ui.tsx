'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { X, Copy, Check, Plus } from 'lucide-react';
import { useState, useId } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
function Code({ children, className }: any) { const [copied, setCopied] = useState(false); const text = String(children).replace(/\n$/, ''); return <div className="code-sample"><button className="code-copy" aria-label="复制代码" onClick={async () => { try {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
}
catch {
    setCopied(false);
} }}>{copied ? <Check size={14}/> : <Copy size={14}/>}{copied ? '已复制' : '复制'}</button><pre><code className={className}>{children}</code></pre></div>; }
export function Markdown({ body }: {
    body: string;
}) { return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} skipHtml components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" onClick={e=>{if(href?.startsWith('/api/files?id=')){e.preventDefault();const id=new URL(href,location.origin).searchParams.get('id');window.dispatchEvent(new CustomEvent('algonotes:open-file',{detail:id}));}}}>{children}</a>, pre: ({ children }: any) => { const child = children?.props; return child ? <Code {...child}/> : <pre>{children}</pre>; }, img: ({ src, alt }) => typeof src === 'string' && src.startsWith('/api/files') ? <img loading="lazy" src={src} alt={alt || '附件图片'}/> : <span className="muted">[外部图片：{alt || '点击原文查看'}]</span> }}>{body}</ReactMarkdown></div>; }
export function Pill({ children, tone = '' }: {
    children: ReactNode;
    tone?: string;
}) { return <span className={'pill ' + tone}>{children}</span>; }
export function Select({ value, onChange, options, label }: {
    value: string;
    onChange: (v: string) => void;
    options: string[];
    label: string;
}) { return <select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{options.map(v => <option key={v} value={v}>{v || '全部'}</option>)}</select>; }
export function Modal({ title, children, close, wide = false }: {
    title: string;
    children: ReactNode;
    close: () => void;
    wide?: boolean;
}) {
    const ref = useRef<HTMLElement>(null), closeRef = useRef(close);
    closeRef.current = close;
    useEffect(() => {
        const original = document.activeElement as HTMLElement | null;
        const node = ref.current;
        const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>('button,input,textarea,select,[tabindex="0"]');
        first?.focus();
        const key = (e: KeyboardEvent) => { if (e.isComposing)
            return; if (Array.from(document.querySelectorAll('.modal-overlay section')).at(-1) !== node)
            return; if (e.key === 'Escape') {
            e.stopImmediatePropagation();
            e.preventDefault();
            closeRef.current();
        } if (e.key === 'Tab') {
            const els = Array.from(node?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea,select,a[href],[tabindex="0"]') ?? []).filter(el => el.getClientRects().length > 0);
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
                first.focus();
            }
        } };
        document.addEventListener('keydown', key, true);
        return () => { document.removeEventListener('keydown', key, true); original?.focus(); };
    }, []);
    return <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget)
        close(); }}><section ref={ref} role="dialog" aria-modal="true" aria-label={title} className={'modal' + (wide ? ' wide' : '')}><header><div><span className="eyebrow">ALGONOTES WORKSPACE</span><h2>{title}</h2></div><button className="icon-button" onClick={close} aria-label="关闭"><X size={20}/></button></header>{children}</section></div>;
}
/* Empty 三态约定（R20 / 决策⑫）：first-use 首用（默认，向后兼容既有 17 处调用）、
   no-match 无匹配、error 失败——文案语义由调用方区分，视觉区分走 .empty--* 轻量档。
   secondAction/secondActionLabel：首用双 CTA（R20.2，03 §6.7 笔记首用态 新建+上传）。 */
export function Empty({ title, text, action, actionLabel, secondAction, secondActionLabel, variant = 'first-use' }: {
    title: string;
    text: string;
    action?: () => void;
    actionLabel?: string;
    secondAction?: () => void;
    secondActionLabel?: string;
    variant?: 'first-use' | 'no-match' | 'error';
}) { return <div className={'empty empty--' + variant}><h3>{title}</h3><p>{text}</p>{action && <button className="button" onClick={action}>{actionLabel}</button>}{secondAction && <button className="button" onClick={secondAction}>{secondActionLabel}</button>}</div>; }

/* 自绘 chip 多选（03 §7 共享组件 #6）：替代原生 multiple select 的统一多选组件，
   上限校验内置（达到 max 后未选项禁用并提示）；筛选框解决大题库下的可选项定位。
   消费方：NoteEditor 关联题目 / StudyEditor simulation 题目（≤20）/ SourceAssistant 来源（≤5，rv-12 已接入）。
   E4：容器 role=group aria-labelledby + 筛选框 label for/id 显式关联。 */
export function ChipSelect({ label, options, values, onChange, max, filterLabel }: {
    label: string;
    options: { value: string; text: string }[];
    values: string[];
    onChange: (next: string[]) => void;
    max?: number;
    filterLabel?: string;
}) {
    const rid = useId().replace(/[:]/g, '');
    const [q, setQ] = useState('');
    const atMax = max !== undefined && values.length >= max;
    const normalizedQ = q.trim().toLowerCase();
    const candidates = (normalizedQ ? options.filter(o => o.text.toLowerCase().includes(normalizedQ)) : options).filter(o => !values.includes(o.value));
    const toggle = (value: string, on: boolean) => {
        if (on)
            onChange(Array.from(new Set([...values, value])));
        else
            onChange(values.filter(v => v !== value));
    };
    return <div className="chip-select" role="group" aria-labelledby={'cs-l-' + rid} aria-label={label + (max !== undefined ? `（最多${max}项，已选${values.length}项）` : `（已选${values.length}项）`)}>
        <label className="chip-select-label" id={'cs-l-' + rid} htmlFor={'cs-q-' + rid}>{label}{max !== undefined && <span className="mini"> · 已选 {values.length}/{max}</span>}</label>
        {values.length > 0 && <div className="chip-row chip-selected">{values.map(v => { const o = options.find(x => x.value === v); return <button type="button" key={v} className="chip chip-on" aria-pressed="true" aria-label={'移除 ' + (o?.text ?? v)} onClick={() => toggle(v, false)}>{o?.text ?? v}<X size={13}/></button>; })}</div>}
        <input id={'cs-q-' + rid} className="chip-filter" value={q} placeholder={filterLabel ?? '输入关键词筛选，点击下方选项加入'} onChange={e => setQ(e.target.value)}/>
        <div className="chip-row chip-options">
            {candidates.slice(0, 30).map(o => <button type="button" key={o.value} className="chip" aria-pressed="false" disabled={atMax} title={atMax ? `已达上限 ${max} 项，先移除一项` : undefined} onClick={() => toggle(o.value, true)}><Plus size={13}/>{o.text}</button>)}
            {!candidates.length && <span className="mini">{atMax ? `已达上限 ${max} 项` : '没有可加入的选项'}</span>}
        </div>
    </div>;
}

/* 决策⑭（02 §6.1-14，C-DRW）：移动端抽屉（.sidebar.open）焦点管理与滚动锁定。
   设计系统层自挂载增强——打开移焦首个可点项、关闭还原焦点并解除 body 滚动锁定；
   不改动页面结构与 B12 三路径关闭行为。 */
declare global { interface Window { __algonotesDrawerA11y?: boolean } }
if (typeof window !== 'undefined' && !window.__algonotesDrawerA11y) {
    window.__algonotesDrawerA11y = true;
    let prevOpen = false;
    let restoreFocus: (() => void) | null = null;
    let prevOverflow = '';
    let prevPaddingRight = '';
    const sync = () => {
        const drawer = document.querySelector<HTMLElement>('.sidebar.open');
        const open = !!drawer;
        if (open === prevOpen)
            return;
        prevOpen = open;
        if (open) {
            const before = document.activeElement as HTMLElement | null;
            const first = drawer?.querySelector<HTMLElement>('[data-autofocus],button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]');
            first?.focus();
            restoreFocus = () => { if (before && document.contains(before))
                before.focus(); };
            const gap = window.innerWidth - document.documentElement.clientWidth;
            prevOverflow = document.body.style.overflow;
            prevPaddingRight = document.body.style.paddingRight;
            document.body.style.overflow = 'hidden';
            if (gap > 0)
                document.body.style.paddingRight = gap + 'px';
        }
        else {
            document.body.style.overflow = prevOverflow;
            document.body.style.paddingRight = prevPaddingRight;
            restoreFocus?.();
            restoreFocus = null;
        }
    };
    const start = () => {
        sync();
        new MutationObserver(sync).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
    };
    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', start, { once: true });
    else
        start();
}
