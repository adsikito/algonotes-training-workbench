'use client';
import {FileDownload} from './file-download';
import { useMemo, useState, useDeferredValue, useEffect, useRef } from 'react';
import { Folder, FolderPlus, ChevronDown, ChevronRight, Settings2, Pin, FileText, Paperclip, Search, Download, History, Trash2, RotateCcw, ArrowUp, ArrowDown, Bookmark, Upload, Pencil } from 'lucide-react';
import type { Entry } from '../lib/domain';
import { defaults, descendantIds, folderRows, loadIdSet, plainText, saveIdSet, normalized, preferences, searchSnippet, matchesQuery, searchItems, NAV_GROUPS, type Preferences, type SearchItem } from '../lib/workspace';
import { Modal, Empty } from './workspace-ui';
/* J7/D3 双树合并（03 §6.7）：侧栏与页内共用同一 FolderTree、同一折叠键 algonotes.ui.folderCollapsed；
   旧侧栏键 algonotes.ui.sidebarExpanded（存“展开”集合）一次性迁移（读旧写新后删除），两实例经事件同步折叠态。 */
const FOLDER_KEY = 'algonotes.ui.folderCollapsed', FOLDER_OLD_KEY = 'algonotes.ui.sidebarExpanded', FOLDER_EVENT = 'algonotes:folder-tree';
function migrateFolderKey(folders: Entry[]): Set<string> {
    try {
        if (localStorage.getItem(FOLDER_KEY) === null) {
            const old = localStorage.getItem(FOLDER_OLD_KEY);
            if (old !== null) {
                const expanded = new Set(loadIdSet(FOLDER_OLD_KEY));
                const branch = new Set(folders.filter(f => folders.some(n => n.data.parentId === f.id)).map(f => f.id));
                const next = new Set([...branch].filter(id => !expanded.has(id)));
                saveIdSet(FOLDER_KEY, next);
                localStorage.removeItem(FOLDER_OLD_KEY);
                return next;
            }
        }
    } catch { }
    return new Set(loadIdSet(FOLDER_KEY).filter(id => folders.some(f => f.id === id)));
}
function useFolderCollapsed(folders: Entry[]) {
    const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set<string>());
    const restored = useRef(false);
    useEffect(() => { if (restored.current || !folders.length) return; restored.current = true; setCollapsed(migrateFolderKey(folders)); }, [folders]);
    useEffect(() => { const sync = () => setCollapsed(new Set(loadIdSet(FOLDER_KEY).filter((id: string) => folders.some(f => f.id === id)))); window.addEventListener(FOLDER_EVENT, sync); return () => window.removeEventListener(FOLDER_EVENT, sync); }, [folders]);
    const toggle = (id: string) => setCollapsed(s => { const next = new Set(s); next.has(id) ? next.delete(id) : next.add(id); saveIdSet(FOLDER_KEY, next); window.dispatchEvent(new Event(FOLDER_EVENT)); return next; });
    return [collapsed, toggle] as const;
}
export function FolderTree({ variant = 'page', folders, entries, selected, onSelect, onEdit, onCreate, onUpload, prefs, onPrefs }: any) {
    const [collapsed, toggle] = useFolderCollapsed(folders);
    const [query, setQuery] = useState('');
    const rows = useMemo(() => folderRows(folders), [folders]);
    const byId = useMemo(() => new Map<string, Entry>(folders.map((f: Entry): [string, Entry] => [f.id, f])), [folders]);
    const hasChild = (id: string) => folders.some((n: Entry) => n.data.parentId === id);
    if (variant === 'sidebar') {
        const visible = rows.filter((r: any) => { if (query) return r.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()); let p = r.entry.data.parentId; const seen = new Set<string>(); while (p && !seen.has(p)) { seen.add(p); if (collapsed.has(p)) return false; p = byId.get(p)?.data.parentId; } return true; });
        return <section className="sidebar-folders"><header><span>资料文件夹</span><div><button aria-label="侧栏新建文件夹" title="新建顶层文件夹" onClick={() => onCreate?.()}><FolderPlus size={16}/></button><button aria-label="上传课程文件夹" title="上传文件或文件夹" onClick={() => onUpload?.()}><Upload size={16}/></button></div></header>{folders.length > 5 && <label className="sidebar-folder-search"><Search size={13}/><input aria-label="搜索文件夹" placeholder="找文件夹…" value={query} onChange={e => setQuery(e.target.value)}/></label>}<div className="sidebar-folder-list"><button className="sidebar-folder-all" onClick={() => onSelect('')}>全部笔记与资料</button>{visible.map(({ entry, depth, path }: any) => <div key={entry.id} className={'sidebar-folder-row ' + (selected === entry.id ? 'active' : '')} style={{ paddingLeft: query ? 0 : Math.min(depth, 6) * 12 }}><button className="folder-disclosure" disabled={!hasChild(entry.id)} aria-label={(!collapsed.has(entry.id) ? '收起' : '展开') + '目录 ' + entry.data.title} aria-expanded={hasChild(entry.id) ? !collapsed.has(entry.id) : undefined} onClick={() => toggle(entry.id)}>{hasChild(entry.id) ? (collapsed.has(entry.id) ? <ChevronRight size={13}/> : <ChevronDown size={13}/>) : <Folder size={13}/>}</button><button title={path} onClick={() => onSelect(entry.id)}>{entry.data.title}</button></div>)}</div>{!folders.length && <p>创建文件夹，或上传课程目录。子文件夹会一起显示在这里。</p>}{!!query && !visible.length && <p>没有匹配目录</p>}</section>;
    }
    const hidden = (entry: Entry) => { let id = entry.data.parentId; const seen = new Set(); while (id && !seen.has(id)) {
        if (collapsed.has(id))
            return true;
        seen.add(id);
        id = folders.find((f: Entry) => f.id === id)?.data.parentId;
    } return false; };
    return <div className="folder-tree"><div className="section-heading"><h3>文件夹</h3><button className="icon-button" aria-label="新建文件夹" title="新建文件夹" onClick={() => onCreate(selected)}><FolderPlus size={18}/></button></div><button className={'tree-root ' + (!selected ? 'active' : '')} onClick={() => onSelect('')}><Folder size={16}/>全部内容 <span>{entries.filter((e: Entry) => !e.deleted && ['note', 'file'].includes(e.kind)).length}</span></button><button className={'tree-root ' + (selected === '__inbox' ? 'active' : '')} onClick={() => onSelect('__inbox')}>收件箱 / 未归类</button>{rows.filter(r => !hidden(r.entry)).map(({ entry: f, depth, path }) => { const pinned = prefs.pinnedFolders.includes(f.id); return <div key={f.id} className={'tree-row ' + (selected === f.id ? 'active' : '')} style={{ paddingLeft: Math.min(depth, 8) * 13 }}><button className="tree-chevron" aria-label={(collapsed.has(f.id) ? '展开' : '收起') + f.data.title} aria-expanded={hasChild(f.id) ? !collapsed.has(f.id) : undefined} disabled={!hasChild(f.id)} onClick={() => toggle(f.id)}>{hasChild(f.id) ? (collapsed.has(f.id) ? <ChevronRight size={13}/> : <ChevronDown size={13}/>) : <Folder size={13}/>}</button><button className="tree-title" title={path} onClick={() => onSelect(f.id)}>{f.data.title}</button><button className={'tree-action ' + (pinned ? 'is-pinned' : '')} aria-label={(pinned ? '取消固定' : '固定') + f.data.title} onClick={() => onPrefs({ ...prefs, pinnedFolders: pinned ? prefs.pinnedFolders.filter((id: string) => id !== f.id) : [...prefs.pinnedFolders, f.id] })}><Pin size={12}/></button><button className="tree-action" aria-label={'管理文件夹 ' + f.data.title} title="改名、移动或回收" onClick={() => onEdit(f)}><Settings2 size={14}/></button></div>; })}{!folders.length && <p className="tiny">点右上角＋，建立第一个文件夹。也可以先写到收件箱。</p>}<label className="check-label"><input type="checkbox" checked={prefs.includeChildren} onChange={e => onPrefs({ ...prefs, includeChildren: e.target.checked })}/>包含子文件夹</label></div>;
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
/* 批5 适配（03 §3(1)）：排序按 训练/知识/复盘 三组分区呈现——上移/下移仅组内生效（跳过历史跨组存储序中的他组项），
   组边界移钮 disabled+aria-disabled 可辨；仍写全序数组（Preferences.order 结构不变，侧栏渲染端按组归属分组）；
   today 保持不可隐藏（组内可移动）；hidden 复选与恢复默认预设不动。 */
export function WorkspaceSettings({ value, nav, onSave, close }: any) { const [draft, setDraft] = useState<Preferences>(preferences(value)), [busy, setBusy] = useState(false); const patch = (p: Partial<Preferences>) => setDraft(d => ({ ...d, ...p })); const groupOf = (id: string) => NAV_GROUPS.find(([, ids]) => ids.includes(id as any))?.[0] ?? NAV_GROUPS[0][0];
    const neighbor = (order: string[], id: string, step: number) => { const i = order.indexOf(id); const group = groupOf(id); let j = i + step; while (j >= 0 && j < order.length && groupOf(order[j]) !== group) j += step; return j >= 0 && j < order.length ? j : -1; };
    const move = (id: string, step: number) => { const a = [...draft.order]; const i = a.indexOf(id); const j = neighbor(a, id, step); if (j < 0) return; [a[i], a[j]] = [a[j], a[i]]; patch({ order: a }); };
    return <Modal title="我的工作台布局" close={close}><p>设置保存到私人云空间。固定内容可在文件夹和笔记列表中选择。组内可用「上移 / 下移」自由排序；三组之间的顺序固定。</p><div className="nav-order">{NAV_GROUPS.map(([group, ids]) => <div className="nav-order-group" key={group}><span className="nav-order-label">{group}</span>{draft.order.filter(id => ids.includes(id as any)).map(id => { const label = nav.find((n: any) => n[0] === id)?.[1]; const upBlocked = neighbor(draft.order, id, -1) < 0, downBlocked = neighbor(draft.order, id, 1) < 0; return <div className="nav-row" key={id}><label><input type="checkbox" disabled={id === 'today'} checked={!draft.hidden.includes(id)} onChange={e => patch({ hidden: e.target.checked ? draft.hidden.filter(s => s !== id) : [...draft.hidden, id] })}/>{label}</label><button className="button small nav-move" aria-label={'上移' + label} title={upBlocked ? '已是本组第一项' : '组内上移'} aria-disabled={upBlocked} disabled={upBlocked} onClick={() => move(id, -1)}><ArrowUp size={13}/>上移</button><button className="button small nav-move" aria-label={'下移' + label} title={downBlocked ? '已是本组最后一项' : '组内下移'} aria-disabled={downBlocked} disabled={downBlocked} onClick={() => move(id, 1)}><ArrowDown size={13}/>下移</button></div>; })}</div>)}</div><label className="check-label"><input type="checkbox" checked={draft.showFolderTree} onChange={e=>patch({showFolderTree:e.target.checked})}/>在侧边栏显示资料文件夹</label><label>侧边栏宽度：{draft.sidebarWidth}px<input type="range" min="200" max="320" step="8" value={draft.sidebarWidth} onChange={e => patch({ sidebarWidth: Number(e.target.value) })}/></label><label>正文字号：{draft.fontSize}px<input type="range" min="14" max="22" value={draft.fontSize} onChange={e => patch({ fontSize: Number(e.target.value) })}/></label><label>列表密度<select value={draft.density} onChange={e => patch({ density: e.target.value as any })}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label><div className="button-group"><button className="button primary" disabled={busy} onClick={async () => { setBusy(true); try {
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
export function NotesBrowser({ entries, folders, folder, trash, search, prefs, onPrefs, onOpen, onEdit, onHistory, onRemove, onUploadVersion, onSave, tell, onCreate, onUpload }: any) {
    const [limit, setLimit] = useState(20);
    const [removing,setRemoving]=useState('');
    const [kind, setKind] = useState('全部'), [sort, setSort] = useState('updated'), [selected, setSelected] = useState<string[]>([]), [target, setTarget] = useState(''), [busy, setBusy] = useState(false), [archived, setArchived] = useState(false);
    const deferred = useDeferredValue(search);
    /* 03 §6.7(3)：NotesBrowser reader 视图退役（list/cards 保留）；prefs.noteView='reader' 消费端回退 'cards'，Preferences 结构不变 */
    const view = prefs.noteView === 'reader' ? 'cards' : prefs.noteView;
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
    return <><div className="notes-controls"><div className="seg-group" role="group" aria-label="内容类型">{['全部', '笔记', '附件'].map(t => <button className={'seg-button ' + (kind === t ? 'active' : '')} aria-pressed={kind === t} key={t} onClick={() => setKind(t)}>{t}</button>)}</div><select aria-label="笔记排序" value={sort} onChange={e => setSort(e.target.value)}><option value="updated">最近修改</option><option value="title">名称顺序</option></select><select aria-label="笔记视图" value={view} onChange={e => onPrefs({ ...prefs, noteView: e.target.value })}><option value="list">列表</option><option value="cards">卡片</option></select><label className="check-label"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)}/>含归档</label><span className="mini">{filtered.length}项</span></div>{selected.length > 0 && <div className="bulk-toolbar"><strong>已选{selected.length}项</strong><select aria-label="批量移动到文件夹" value={target} onChange={e => setTarget(e.target.value)}><option value="">收件箱</option>{rows.map(r => <option key={r.entry.id} value={r.entry.id}>{r.path}</option>)}</select><button className="button small" disabled={busy || trash} onClick={bulk}>移动所选</button><button className="text-button" onClick={() => setSelected([])}>取消选择</button></div>}<div className={'unified-notes ' + view}>{filtered.slice(0, limit).map((e: Entry) => { const pinned = prefs.pinnedNotes.includes(e.id); const heading = e.kind === 'note' ? (e.data.title || '未命名笔记') : (e.data.title || e.data.name); return <article className="unified-note" key={e.id}><header>{!trash && <input type="checkbox" aria-label={'选择 ' + heading} checked={selected.includes(e.id)} onChange={ev => setSelected(s => ev.target.checked ? [...s, e.id] : s.filter(id => id !== e.id))}/>}{e.kind === 'note' ? <FileText size={17}/> : <Paperclip size={17}/>}<button className="note-heading" onClick={() => onOpen(e)}>{heading}</button><div className="button-group">{e.kind === 'note' && <button className="icon-button" aria-label={'编辑 ' + heading} title="打开编辑器" onClick={() => onEdit?.(e)}><Pencil size={14}/></button>}<button className={'icon-button ' + (pinned ? 'is-pinned' : '')} aria-label={(pinned ? '取消固定' : '固定') + heading} onClick={() => onPrefs({ ...prefs, pinnedNotes: pinned ? prefs.pinnedNotes.filter((id: string) => id !== e.id) : [...prefs.pinnedNotes, e.id] })}><Pin size={14}/></button><button className="icon-button" aria-label="查看历史版本" onClick={() => onHistory(e)}><History size={14}/></button>{e.kind === 'file' && <button className="icon-button" aria-label="上传新版" onClick={() => onUploadVersion(e)}><ArrowUp size={14}/></button>}<button className="icon-button" aria-label={trash ? '恢复' : '回收'} disabled={removing===e.id} onClick={async()=>{setRemoving(e.id);try{await onRemove(e);}finally{setRemoving('');}}}>{trash ? <RotateCcw size={14}/> : <Trash2 size={14}/>}</button></div></header>{e.kind === 'note' ? <p className="note-excerpt">{plainText(e.data.body).slice(0, view === 'cards' ? 160 : 90) || '还没有正文。'}</p> : <p className="note-excerpt">{(e.data.size / 1024).toFixed(1)} KiB · {e.data.type || '原文件'}</p>}<footer><span>{rows.find(r => r.entry.id === e.data.folderId)?.path || (e.data.folderId ? (entries.find((f: Entry) => f.id === e.data.folderId && f.kind === 'folder')?.data.title + '（已回收）') : '收件箱')} · {new Date(e.updated).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}{e.data.archived ? ' · 已归档' : ''}</span><span>{(e.data.tags ?? []).join(' · ')}</span>{e.kind === 'file' ? <FileDownload entry={e}/> : <button className="text-button" onClick={() => onSave('note', { ...e.data, archived: !e.data.archived }, e).catch((e: any) => tell(e.message))}>{e.data.archived ? '取消归档' : '归档'}</button>}</footer></article>; })}</div>{filtered.length > limit && <button className="button" onClick={() => setLimit(n => n + 20)}>继续显示（剩余{filtered.length - limit}项）</button>}{!filtered.length && <Empty title={search ? '没有符合条件的笔记或文件' : trash ? '回收站是空的' : '把第一条想法留在这里'} text="可以清除搜索、切换文件夹，或直接新建一篇自由笔记。" action={onCreate} actionLabel="新建笔记" secondAction={!search && !trash ? onUpload : undefined} secondActionLabel="上传资料"/>}</>;
}
