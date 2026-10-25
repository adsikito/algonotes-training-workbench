'use client';
import {FileDownload} from './file-download';
import { useMemo, useState, useDeferredValue, useEffect, useRef } from 'react';
import { Folder, FolderPlus, ChevronDown, ChevronRight, Settings2, Pin, FileText, Paperclip, Search, Download, History, Trash2, RotateCcw, ArrowUp, ArrowDown, Bookmark } from 'lucide-react';
import type { Entry } from '../lib/domain';
import { defaults, descendantIds, folderRows, loadIdSet, plainText, saveIdSet, normalized, preferences, searchSnippet, matchesQuery, type Preferences, type SearchItem, searchItems } from '../lib/workspace';
import { Markdown, Modal, Empty } from './workspace-ui';
export function FolderTree({ folders, entries, selected, onSelect, onEdit, onCreate, prefs, onPrefs }: any) {
    const [collapsed, setCollapsed] = useState(new Set<string>());
    const rows = useMemo(() => folderRows(folders), [folders]);
    const restored = useRef(false);
    useEffect(() => { if (restored.current || !folders.length) return; restored.current = true; setCollapsed(new Set(loadIdSet('algonotes.ui.folderCollapsed').filter((id: string) => folders.some((f: Entry) => f.id === id)))); }, [folders]);
    const hidden = (entry: Entry) => { let id = entry.data.parentId; const seen = new Set(); while (id && !seen.has(id)) {
        if (collapsed.has(id))
            return true;
        seen.add(id);
        id = folders.find((f: Entry) => f.id === id)?.data.parentId;
    } return false; };
    return <div className="folder-tree"><div className="section-heading"><h3>文件夹</h3><button className="icon-button" aria-label="新建文件夹" title="新建文件夹" onClick={() => onCreate(selected)}><FolderPlus size={18}/></button></div><button className={'tree-root ' + (!selected ? 'active' : '')} onClick={() => onSelect('')}><Folder size={16}/>全部内容 <span>{entries.filter((e: Entry) => !e.deleted && ['note', 'file'].includes(e.kind)).length}</span></button><button className={'tree-root ' + (selected === '__inbox' ? 'active' : '')} onClick={() => onSelect('__inbox')}>收件箱 / 未归类</button>{rows.filter(r => !hidden(r.entry)).map(({ entry: f, depth, path }) => { const hasChild = folders.some((n: Entry) => n.data.parentId === f.id); const pinned = prefs.pinnedFolders.includes(f.id); return <div key={f.id} className={'tree-row ' + (selected === f.id ? 'active' : '')} style={{ paddingLeft: Math.min(depth, 8) * 13 }}><button className="tree-chevron" aria-label={(collapsed.has(f.id) ? '展开' : '收起') + f.data.title} aria-expanded={hasChild ? !collapsed.has(f.id) : undefined} disabled={!hasChild} onClick={() => setCollapsed(s => { const next = new Set(s); next.has(f.id) ? next.delete(f.id) : next.add(f.id); saveIdSet('algonotes.ui.folderCollapsed', next); return next; })}>{hasChild ? (collapsed.has(f.id) ? <ChevronRight size={13}/> : <ChevronDown size={13}/>) : <Folder size={13}/>}</button><button className="tree-title" title={path} onClick={() => onSelect(f.id)}>{f.data.title}</button><button className={'tree-action ' + (pinned ? 'is-pinned' : '')} aria-label={(pinned ? '取消固定' : '固定') + f.data.title} onClick={() => onPrefs({ ...prefs, pinnedFolders: pinned ? prefs.pinnedFolders.filter((id: string) => id !== f.id) : [...prefs.pinnedFolders, f.id] })}><Pin size={12}/></button><button className="tree-action" aria-label={'管理文件夹 ' + f.data.title} title="改名、移动或回收" onClick={() => onEdit(f)}><Settings2 size={14}/></button></div>; })}{!folders.length && <p className="tiny">点右上角＋，建立第一个文件夹。也可以先写到收件箱。</p>}<label className="check-label"><input type="checkbox" checked={prefs.includeChildren} onChange={e => onPrefs({ ...prefs, includeChildren: e.target.checked })}/>包含子文件夹</label></div>;
}
export function FolderDialog({ entry, parent, folders, entries, save, remove, close, tell, onSelected }: any) {
    const [title, setTitle] = useState(entry?.data.title ?? ''), [parentId, setParent] = useState(entry?.data.parentId ?? parent ?? ''), [busy, setBusy] = useState(false), [recycleMode, setRecycle] = useState('move'), [armRecycle, setArmRecycle] = useState(false); const armTimer = useRef<any>(null); useEffect(() => () => { if (armTimer.current) clearTimeout(armTimer.current); }, []);
    const forbidden = entry ? descendantIds(folders, entry.id) : new Set();
    async function submit() { if (!title.trim())
        return tell('请填写文件夹名称'); setBusy(true); try {
        const out = await save('folder', { ...entry?.data, title: title.trim(), parentId }, entry);
        onSelected(out.id);
        close();
        tell(entry ? '文件夹已更新，原关联保持不变' : '文件夹已创建，可以开始写笔记或上传资料');
    }
    catch (e: any) {
        tell(e.message);
    }
    finally {
        setBusy(false);
    } }
    async function retire() { if (!entry)
        return; setBusy(true); let completed = 0; try {
        const children = descendantIds(folders, entry.id);
        if (recycleMode === 'move') {
            const target = folders.some((f: Entry) => f.id === entry.data.parentId) ? entry.data.parentId : '';
            for (const e of entries.filter((e: Entry) => !e.deleted && ((e.kind === 'folder' && e.data.parentId === entry.id) || (['note', 'file'].includes(e.kind) && e.data.folderId === entry.id)))) {
                await save(e.kind, { ...e.data, ...(e.kind === 'folder' ? { parentId: target } : { folderId: target }) }, e);
                completed++;
            }
        }
        else {
            for (const e of entries.filter((e: Entry) => !e.deleted && e.id !== entry.id && ((e.kind === 'folder' && children.has(e.id)) || (['note', 'file'].includes(e.kind) && children.has(e.data.folderId)))).sort((a: Entry, b: Entry) => a.kind === 'folder' && b.kind !== 'folder' ? 1 : b.kind === 'folder' && a.kind !== 'folder' ? -1 : (folderRows(folders).find(r => r.entry.id === b.id)?.depth ?? 0) - (folderRows(folders).find(r => r.entry.id === a.id)?.depth ?? 0))) {
                if (await remove(e) === false) throw new Error('回收失败：'+(e.data.title||e.data.name||e.id));
                completed++;
            }
        }
        if (await remove(entry) === false) throw new Error('父目录未回收；已完成项仍保留回执');
        onSelected('');
        close();
        tell(`已回收目录，处理${completed}项内容；可从回收站恢复`);
    }
    catch (e: any) {
        tell(`已处理${completed}项，其余未完成：${e.message}。请重新打开管理检查。`);
    }
    finally {
        setBusy(false);
    } }
    return <Modal title={entry ? '管理文件夹' : '新建文件夹'} close={close}><label>名称<input autoFocus value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter')
        submit(); }}/></label><label>上级文件夹<select value={parentId} onChange={e => setParent(e.target.value)}><option value="">顶层</option>{folderRows(folders).filter(r => !forbidden.has(r.entry.id)).map(r => <option key={r.entry.id} value={r.entry.id}>{r.path}</option>)}</select></label><p className="tiny">位置：笔记与资料 → 文件夹。移动和改名保留笔记及附件关联。</p><button className="button primary" disabled={busy} onClick={submit}>保存文件夹</button>{entry && <details className="danger-zone"><summary>回收此文件夹</summary><label><select value={recycleMode} onChange={e => { setRecycle(e.target.value); setArmRecycle(false); }}><option value="move">直属内容移到上级，只回收此目录</option><option value="subtree">连同子目录、笔记和资料一起回收</option></select></label><p className="tiny">批量操作逐项保存；若中断会报告已处理数量。回收不等于永久删除。</p><button className={'button' + (armRecycle ? ' danger-button' : '')} disabled={busy} onClick={() => { if (!armRecycle) { setArmRecycle(true); if (armTimer.current) clearTimeout(armTimer.current); armTimer.current = setTimeout(() => setArmRecycle(false), 3000); return; } if (armTimer.current) clearTimeout(armTimer.current); setArmRecycle(false); retire(); }}><Trash2 size={14}/>{armRecycle ? '确认回收（再点一次执行）' : '按所选范围回收'}</button></details>}</Modal>;
}
export function WorkspaceSettings({ value, nav, onSave, close }: any) { const [draft, setDraft] = useState<Preferences>(preferences(value)), [busy, setBusy] = useState(false); const patch = (p: Partial<Preferences>) => setDraft(d => ({ ...d, ...p })); const move = (i: number, step: number) => { const a = [...draft.order]; [a[i], a[i + step]] = [a[i + step], a[i]]; patch({ order: a }); }; return <Modal title="我的工作台布局" close={close}><p>设置保存到私人云空间。固定内容可在文件夹和笔记列表中选择。</p><div className="nav-order">{draft.order.map((id, i) => <div key={id}><label><input type="checkbox" disabled={id === 'today'} checked={!draft.hidden.includes(id)} onChange={e => patch({ hidden: e.target.checked ? draft.hidden.filter(s => s !== id) : [...draft.hidden, id] })}/>{nav.find((n: any) => n[0] === id)?.[1]}</label><button className="icon-button" aria-label={'上移' + nav.find((n: any) => n[0] === id)?.[1]} disabled={!i} onClick={() => move(i, -1)}><ArrowUp size={14}/></button><button className="icon-button" aria-label={'下移' + nav.find((n: any) => n[0] === id)?.[1]} disabled={i === draft.order.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14}/></button></div>)}</div><label className="check-label"><input type="checkbox" checked={draft.showFolderTree} onChange={e=>patch({showFolderTree:e.target.checked})}/>在侧边栏显示资料文件夹</label><label>侧边栏宽度：{draft.sidebarWidth}px<input type="range" min="200" max="320" step="8" value={draft.sidebarWidth} onChange={e => patch({ sidebarWidth: Number(e.target.value) })}/></label><label>正文字号：{draft.fontSize}px<input type="range" min="14" max="22" value={draft.fontSize} onChange={e => patch({ fontSize: Number(e.target.value) })}/></label><label>列表密度<select value={draft.density} onChange={e => patch({ density: e.target.value as any })}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label><div className="button-group"><button className="button primary" disabled={busy} onClick={async () => { setBusy(true); try {
    await onSave(draft);
    close();
}
finally {
    setBusy(false);
} }}>保存布局</button><button className="button" onClick={() => setDraft({ ...defaults })}>恢复默认预设</button></div></Modal>; }
export function SearchResults({ index, query, open, onClose }: {
    index: SearchItem[];
    query: string;
    open: (item: SearchItem) => void;
    onClose?: () => void;
}) { const deferred = useDeferredValue(query), [limits, setLimits] = useState<Record<string, number>>({}); const matches = useMemo(() => searchItems(index, deferred), [index, deferred]); const kinds = ['题目', '笔记', 'STL', '讲义', '个人知识', '文件', '卡点', '标记','错题','代码模板','分类']; if (!query.trim())
    return null; return <section className="search-results" aria-busy={deferred !== query}><div className="section-heading"><h2>全局搜索 <span className="count">{matches.length}</span></h2><span className="mini">新上传文本与代码可搜内容；PDF与图片只搜文件名</span><button className="text-button" onClick={() => onClose?.()}>收起</button></div>{kinds.map(kind => { const hits = matches.filter(i => i.kind === kind); if (!hits.length)
    return null; const limit = limits[kind] ?? 8; return <section className="search-group" key={kind}><h3>{kind} · {hits.length}</h3>{hits.slice(0, limit).map(i => <button className="search-hit" key={kind + i.id} onClick={() => open(i)}><Search size={14}/><div><strong>{i.code ? i.code + ' · ' : ''}{i.title}</strong><p>{searchSnippet(i.body, query).text}</p></div><ChevronRight size={15}/></button>)}{hits.length > limit && <button className="text-button" onClick={() => setLimits(s => ({ ...s, [kind]: limit + 20 }))}>继续显示，剩余{hits.length - limit}项</button>}</section>; })}{!matches.length && <Empty title="没有找到匹配内容" text="试试题号、函数名或笔记中的一句话；多个词以空格分隔。"/>}</section>; }
export function NotesBrowser({ entries, folders, folder, trash, search, prefs, onPrefs, onOpen, onHistory, onRemove, onUploadVersion, onSave, tell, onCreate }: any) {
    const [limit, setLimit] = useState(20);
    const [removing,setRemoving]=useState('');
    const [kind, setKind] = useState('全部'), [sort, setSort] = useState('updated'), [selected, setSelected] = useState<string[]>([]), [target, setTarget] = useState(''), [busy, setBusy] = useState(false), [archived, setArchived] = useState(false);
    const deferred = useDeferredValue(search);
    useEffect(()=>{setKind('全部');setArchived(false);},[folder,trash]);
    useEffect(()=>{setSelected([]);setLimit(20);},[folder,trash,kind,deferred,archived,prefs.includeChildren]);
    const rows = useMemo(() => folderRows(folders), [folders]);
    const filtered = useMemo(() => { const ids = prefs.includeChildren && folder && folder !== '__inbox' ? descendantIds(folders, folder) : new Set([folder]); return entries.filter((e: Entry) => ['note', 'file'].includes(e.kind) && e.deleted === trash && (!folder || (folder === '__inbox' ? !e.data.folderId : ids.has(e.data.folderId))) && (!archived ? !e.data.archived : true) && (kind === '全部' || (kind === '笔记' ? e.kind === 'note' : e.kind === 'file')) && matchesQuery([e.data.title, e.data.name, e.data.body, ...(e.data.tags ?? [])].join(' '), deferred)).sort((a: Entry, b: Entry) => sort === 'title' ? (a.data.title ?? a.data.name).localeCompare(b.data.title ?? b.data.name, 'zh-CN') : b.updated.localeCompare(a.updated)); }, [entries, folder, prefs.includeChildren, trash, kind, sort, deferred, archived, folders]);
    async function bulk() { setBusy(true); let count = 0; try {
        for (const id of selected) {
            const e = entries.find((e: Entry) => e.id === id);
            if (e && !e.deleted) {
                await onSave(e.kind, { ...e.data, folderId: target }, e);
                count++;
            }
        }
        setSelected([]);
        tell(`已移动${count}项，关联保持不变`);
    }
    catch (e: any) {
        tell(`已移动${count}项，其余未完成：${e.message}`);
    }
    finally {
        setBusy(false);
    } }
    return <><div className="notes-controls"><div className="seg-group" role="group" aria-label="内容类型">{['全部', '笔记', '附件'].map(t => <button className={'seg-button ' + (kind === t ? 'active' : '')} aria-pressed={kind === t} key={t} onClick={() => setKind(t)}>{t}</button>)}</div><select aria-label="笔记排序" value={sort} onChange={e => setSort(e.target.value)}><option value="updated">最近修改</option><option value="title">名称顺序</option></select><select aria-label="笔记视图" value={prefs.noteView} onChange={e => onPrefs({ ...prefs, noteView: e.target.value })}><option value="list">列表</option><option value="cards">卡片</option><option value="reader">集中阅读</option></select><label className="check-label"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)}/>含归档</label><span className="mini">{filtered.length}项</span></div>{selected.length > 0 && <div className="bulk-toolbar"><strong>已选{selected.length}项</strong><select aria-label="批量移动到文件夹" value={target} onChange={e => setTarget(e.target.value)}><option value="">收件箱</option>{rows.map(r => <option key={r.entry.id} value={r.entry.id}>{r.path}</option>)}</select><button className="button small" disabled={busy || trash} onClick={bulk}>移动所选</button><button className="text-button" onClick={() => setSelected([])}>取消选择</button></div>}<div className={'unified-notes ' + prefs.noteView}>{filtered.slice(0, limit).map((e: Entry) => { const pinned = prefs.pinnedNotes.includes(e.id); const heading = e.kind === 'note' ? (e.data.title || '未命名笔记') : (e.data.title || e.data.name); return <article className="unified-note" key={e.id}><header>{!trash && <input type="checkbox" aria-label={'选择 ' + heading} checked={selected.includes(e.id)} onChange={ev => setSelected(s => ev.target.checked ? [...s, e.id] : s.filter(id => id !== e.id))}/>}{e.kind === 'note' ? <FileText size={17}/> : <Paperclip size={17}/>}<button className="note-heading" onClick={() => onOpen(e)}>{heading}</button><div className="button-group"><button className={'icon-button ' + (pinned ? 'is-pinned' : '')} aria-label={(pinned ? '取消固定' : '固定') + heading} onClick={() => onPrefs({ ...prefs, pinnedNotes: pinned ? prefs.pinnedNotes.filter((id: string) => id !== e.id) : [...prefs.pinnedNotes, e.id] })}><Pin size={14}/></button><button className="icon-button" aria-label="查看历史版本" onClick={() => onHistory(e)}><History size={14}/></button>{e.kind === 'file' && <button className="icon-button" aria-label="上传新版" onClick={() => onUploadVersion(e)}><ArrowUp size={14}/></button>}<button className="icon-button" aria-label={trash ? '恢复' : '回收'} disabled={removing===e.id} onClick={async()=>{setRemoving(e.id);try{await onRemove(e);}finally{setRemoving('');}}}>{trash ? <RotateCcw size={14}/> : <Trash2 size={14}/>}</button></div></header>{e.kind === 'note' ? (prefs.noteView === 'reader' ? <div className="reader-body"><Markdown body={e.data.body || '*暂无正文*'}/></div> : <p className="note-excerpt">{plainText(e.data.body).slice(0, prefs.noteView === 'cards' ? 160 : 90) || '还没有正文。'}</p>) : <p className="note-excerpt">{(e.data.size / 1024).toFixed(1)} KiB · {e.data.type || '原文件'}</p>}<footer><span>{rows.find(r => r.entry.id === e.data.folderId)?.path || (e.data.folderId ? (entries.find((f: Entry) => f.id === e.data.folderId && f.kind === 'folder')?.data.title + '（已回收）') : '收件箱')} · {new Date(e.updated).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}{e.data.archived ? ' · 已归档' : ''}</span><span>{(e.data.tags ?? []).join(' · ')}</span>{e.kind === 'file' ? <FileDownload entry={e}/> : <button className="text-button" onClick={() => onSave('note', { ...e.data, archived: !e.data.archived }, e).catch((e: any) => tell(e.message))}>{e.data.archived ? '取消归档' : '归档'}</button>}</footer></article>; })}</div>{filtered.length > limit && <button className="button" onClick={() => setLimit(n => n + 20)}>继续显示（剩余{filtered.length - limit}项）</button>}{!filtered.length && <Empty title={search ? '没有符合条件的笔记或文件' : trash ? '回收站是空的' : '把第一条想法留在这里'} text="可以清除搜索、切换文件夹，或直接新建一篇自由笔记。" action={onCreate} actionLabel="新建笔记"/>}</>;
}
