'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { X, Copy, Check } from 'lucide-react';
import { useState } from 'react';
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
export function Modal({ title, children, close, wide = false, full = false }: {
    title: string;
    children: ReactNode;
    close: () => void;
    wide?: boolean;
    full?: boolean;
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
        close(); }}><section ref={ref} role="dialog" aria-modal="true" aria-label={title} className={'modal ' + (wide ? 'wide' : '')+(full?' focus-reader':'')}><header><div><span className="eyebrow">ALGONOTES WORKSPACE</span><h2>{title}</h2></div><button className="icon-button" onClick={close} aria-label="关闭"><X size={20}/></button></header>{children}</section></div>;
}
export function Empty({ title, text, action, actionLabel }: {
    title: string;
    text: string;
    action?: () => void;
    actionLabel?: string;
}) { return <div className="empty"><h3>{title}</h3><p>{text}</p>{action && <button className="button" onClick={action}>{actionLabel}</button>}</div>; }
