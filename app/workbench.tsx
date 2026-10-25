'use client';
import { useState, useEffect, useRef, useMemo, useCallback, useDeferredValue, lazy, Suspense } from 'react';
import { BookOpen, LayoutDashboard, Search, NotebookPen, Folder, History, RefreshCw, Code2, ChevronRight, ChevronLeft, Plus, Check, CheckCircle2, Circle, Clock3, FileText, Paperclip, Download, Upload, MoreHorizontal, X, Trash2, Sun, Moon, Settings, Bookmark, Filter, CalendarDays, ArrowRight, FolderPlus, Layers, Library, Terminal, ExternalLink, Cloud, CloudOff, AlertCircle, RotateCcw, MessageSquare, Pause, Play, Copy, Eye, Save, Braces, Target, ListChecks, ShieldCheck, HardDrive, Menu } from 'lucide-react';
import { Markdown, Modal, Pill, Select, Empty } from '../components/workspace-ui';
import { FolderTree, FolderDialog, WorkspaceSettings, NotesBrowser, SearchResults } from '../components/workspace-controls';
import { LearningOverview, CoveragePanel, PracticeTimer, TestCaseNotebook } from '../components/learning-tools';
import { preferences, folderRows, noteProblemIds, searchIndex, normalized, type Preferences } from '../lib/workspace';
import {TransferCenter,FileReader} from '../components/file-workspace';
import {DailyDeliveryCard} from '../components/daily-delivery';
import {postRecord,mergeEntries} from '../lib/record-client';
import {StudyHub,entityOptions} from '../components/study-hub';
import {StoragePanel} from '../components/storage-panel';
import {CommandPalette} from '../components/command-palette';
import {TextDiff} from '../components/study-hub';
import NoteEditor from '../components/note-editor';
import {BackupManager} from '../components/backup-manager';
import {SidebarFolders} from '../components/sidebar-folders';
import {DocumentReader} from '../components/document-reader';
import {MarkCenter} from '../components/reading-tools';
import ProblemPanel from '../components/problem-panel';
const StlBrowser = lazy(() => import('../components/stl-browser').then(m => ({ default: m.StlBrowser })));
import { type Entry, type Kind, progress, mastery, results, help, tools, localDay, independentAC, escapeCSV, attemptDays, resultMark, resultTone } from '../lib/domain';
import { writeDraft, readDraft, removeDraft, listDrafts } from '../lib/drafts';import { AskBox } from '../components/ask-box';
import {uploadChunked} from '../lib/upload-client';
import {createStreamBackup,previewStreamRestore,restoreStreamBackup,previewCloudBackup} from '../lib/backup-v2';
import { download, createBackup, previewRestore } from '../lib/backup-client';
const nav = [['today', '今日训练', LayoutDashboard], ['problems', '题库', BookOpen], ['knowledge', '知识与 STL', Code2], ['notes', '笔记与资料', NotebookPen], ['review', '复习与卡点', RefreshCw], ['records', '练习记录', History], ['studio', '学习工具', Layers]] as const;
const uid = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2, '0')).join('');
const label = (s: string) => s?.split(' · ')[0];
const TOOLKIT = ['std::stack', 'queue / deque', 'vector 与迭代', 'sort 与比较器', 'map / set', 'string / stringstream', 'priority_queue'];
const POOL_TABS = ['全部', '专题主线', 'STL练习', '思维与应用'];
const KNOWLEDGE_TABS = ['STL专题', '接口速查', '日单原文', '项目文档', '我的知识'];
const friendlyError = (m: string) => m.includes('D1_ERROR') ? '本地数据库连接失败，请重启开发服务后重试' : m.includes('401') || m.includes('登录') ? '请登录后继续' : m ? '加载失败：' + m : '加载失败，请重试';
export default function Workbench() {
    const [boot, setBoot] = useState<any>(null), [entries, setEntries] = useState<Entry[]>([]), [page, setPage] = useState('today'), [loading, setLoading] = useState(true), [error, setError] = useState(''), [toast, setToast] = useState(''), [date, setDate] = useState(localDay()), [query, setQuery] = useState(''), [filters, setFilters] = useState({ status: '', mastery: '', topic: '', type: '', help: '', result: '', date: '' }), [smart, setSmart] = useState(''), [problem, setProblem] = useState<any>(null), [doc, setDoc] = useState<any>(null), [note, setNote] = useState<Entry | null>(null), [folder, setFolder] = useState(''), [noteSearch, setNoteSearch] = useState(''), [section, setSection] = useState('全部'), [modal, setModal] = useState(''), [mobile, setMobile] = useState(false), [busy, setBusy] = useState(false), [trash, setTrash] = useState(false), [dark, setDark] = useState(false), [history, setHistory] = useState<Entry[]>([]), [conflict, setConflict] = useState<any>(null), [imports, setImports] = useState<any>(null), [lastImport, setLastImport] = useState<any>(null), [diagnostic, setDiagnostic] = useState<any>(null), [restore, setRestore] = useState<any>(null), [drafts, setDrafts] = useState<any[]>([]), [folderName, setFolderName] = useState(''), [folderParent, setFolderParent] = useState(''), [custom, setCustom] = useState<any>({ code: '', title: '', url: '', difficulty: '未评级', topic: '自定义', body: '' });
    const [knowledgeTab, setKnowledgeTab] = useState('STL专题'), [folderEditing, setFolderEditing] = useState<Entry | null>(null), [folderStart, setFolderStart] = useState(''), [globalQuery, setGlobalQuery] = useState('');
    const [readingFile,setReadingFile]=useState<Entry|null>(null),[offline,setOffline]=useState(false);
    const deferredQuery = useDeferredValue(query), [shown, setShown] = useState(60);
    useEffect(() => { setShown(60); }, [deferredQuery, filters, smart]);
    const recordsRef = useRef<Entry[]>([]), searchRef = useRef<HTMLInputElement>(null), fileRef = useRef<HTMLInputElement>(null), importRef = useRef<HTMLInputElement>(null), restoreRef = useRef<HTMLInputElement>(null), replaceFileRef = useRef('');
    // React 19 只为 <dialog> 元素接线 onCancel；文件选择框取消时重置“替换版本”目标需挂原生 cancel 监听
    const attachFileInput = useCallback((el: HTMLInputElement | null) => { fileRef.current = el; if (el) el.addEventListener('cancel', () => { replaceFileRef.current = ''; }); }, []);
    function acceptEntries(incoming:Entry[]){const next=mergeEntries(recordsRef.current,incoming);recordsRef.current=next;setEntries(next);}
    const tell = (s: string) => { setToast(s); };
    const [askBox, setAskBox] = useState<null | { title: string; label: string; value: string; apply: (v: string) => void; cancel?: () => void }>(null); const askResolve = useRef<((v: string | null) => void) | null>(null); function askText(title: string, label: string, value: string, apply: (v: string) => void) { setAskBox({ title, label, value, apply }); } function askSync(title: string, label: string, value: string): Promise<string | null> { setAskBox({ title, label, value, apply: v => { askResolve.current?.(v); askResolve.current = null; }, cancel: () => { askResolve.current?.(null); askResolve.current = null; } }); return new Promise(res => { askResolve.current = res; }); }
    const [customId, setCustomId] = useState(''), [customBase, setCustomBase] = useState(0), customSaveRef = useRef<HTMLButtonElement>(null); function editCustom(p: any) { const real = recordsRef.current.find(x => x.id === p.id); setCustomId(p.id); setCustomBase(real?.version ?? p.baseVersion ?? 0); setCustom({ code: p.code ?? '', title: p.title ?? '', url: p.url ?? '', difficulty: p.difficulty ?? '未评级', topic: p.topic ?? '自定义', body: p.body ?? '' }); setProblem(null); setModal('custom'); } async function removeCustom(p: any) { const real = recordsRef.current.find(x => x.id === p.id); try { await save('problem', { code: p.code, title: p.title, url: p.url, difficulty: p.difficulty, topic: p.topic, body: p.body ?? '', type: '自定义', role: '自选题', tags: [p.topic], position: 0, date: p.date ?? localDay() }, real ?? undefined, p.id, { deleted: true }); tell('已删除自定义题目'); setProblem(null); } catch (e: any) { tell(e.message); } }
    useEffect(() => {
        if (toast) {
            const t = setTimeout(() => setToast(''), 5000);
            return () => clearTimeout(t);
        }
    }, [toast]);
    const syncRef=useRef({since:'',loaded:false}),reloadRef=useRef<Promise<void>|null>(null);
    function reload():Promise<void> {
        if(reloadRef.current)return reloadRef.current;
        const job=(async()=>{
            const qs=new URLSearchParams();if(syncRef.current.loaded)qs.set('includeSeed','0');if(syncRef.current.since)qs.set('since',syncRef.current.since);
            const r=await fetch('/api/bootstrap?'+qs);const x:any=await r.json();if(!r.ok)throw new Error(x.error);
            let all:Entry[]=x.entries;let cursor=x.nextCursor;
            while(cursor){const pr=await fetch('/api/entries?cursor='+encodeURIComponent(cursor));const page:any=await pr.json();if(!pr.ok)throw new Error(page.error);all=mergeEntries(all,page.entries);cursor=page.nextCursor;}
            setBoot((old:any)=>({...old,...x,seed:x.seed??old?.seed}));
            acceptEntries(all);
            syncRef.current={since:x.until,loaded:true};
            listDrafts(x.user.id).then(setDrafts).catch(()=>{});setError('');
        })();reloadRef.current=job;job.then(()=>{reloadRef.current=null;setOffline(false);},()=>{reloadRef.current=null;setOffline(true);});return job;
    }
    useEffect(() => {
        reload().catch(e => setError(e.message)).finally(() => setLoading(false));
        const t = setInterval(() => {
            if (document.visibilityState === 'visible')
                reload().catch(() => { });
        }, 45000);
        const key = (e: KeyboardEvent) => {
            if (e.isComposing)
                return;
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                setModal('command');
            }
            if (e.key === 'Escape') {
                setMobile(false);
                setModal('');
                setDoc(null);
                setProblem(null);
                setNote(null);
                setReadingFile(null);
            }
        };
        window.addEventListener('keydown', key);
        return () => { clearInterval(t); window.removeEventListener('keydown', key); };
    }, []);
    useEffect(() => {
        const h = location.hash.slice(1).replace(/^\//, '');
        if (nav.some(n => n[0] === h))
            setPage(h);
        const theme = localStorage.getItem('algonotes-theme');
        if (theme === 'dark')
            setDark(true);
    }, []);
    useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('algonotes-theme', dark ? 'dark' : 'light'); }, [dark]);
    useEffect(() => { document.title = (nav.find(n => n[0] === page)?.[1] || '工作台') + ' · AlgoNotes'; }, [page]);
    function go(p: string) { setPage(p); setSection('全部'); location.hash = p; setProblem(null); setDoc(null); setNote(null); setMobile(false); setTrash(false); }
    const active = useMemo(() => entries.filter(e => !e.deleted), [entries]);
    const of = (k: string) => active.filter(e => e.kind === k);
    const attempts = of('attempt'), subs = of('submission'), notes = of('note'), folders = of('folder'), files = of('file'), states = of('state');
    const stateIndex = useMemo(() => new Map(states.map(e => [e.data.problemId, e.data])), [entries]);
    const state = (id: string) => stateIndex.get(id) ?? { progress: '未记录', mastery: '未评估', favorite: false };
    const prefs = useMemo(() => preferences((active.find(e => e.kind === 'preference' && e.id === 'preferences:workspace') ?? active.filter(e => e.kind === 'preference').at(-1))?.data), [entries]);
    const orderedNav = prefs.order.map(id => nav.find(n => n[0] === id)!).filter(Boolean).filter(n => !prefs.hidden.includes(n[0]));
    const prefQueue = useRef(Promise.resolve());
    async function savePrefs(next: Preferences) { const delta = Object.fromEntries(Object.entries(next).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify((prefs as any)[key]))); const job = prefQueue.current.catch(() => { }).then(async () => { const old = recordsRef.current.find(e => e.id === 'preferences:workspace'); await save('preference', preferences({ ...preferences(old?.data ?? prefs), ...delta }), old, 'preferences:workspace'); }); prefQueue.current = job; try {
        await job;
    }
    catch (e: any) {
        tell(e.message);
        throw e;
    } }
    const setPrefs = (next: Preferences) => { savePrefs(next).catch(() => { }); };
    const seed = boot?.seed ?? { problems: [], lists: [], docs: [] };
    const changes = (boot?.updates ?? []).filter((e: Entry) => !e.deleted);
    const problems = [...seed.problems.filter((p: any) => !changes.some((e: Entry) => e.kind === 'problem' && e.id === p.id)), ...changes.filter((e: Entry) => e.kind === 'problem').map((e: Entry) => ({ ...e.data, id: e.id })), ...of('problem').map(e => ({ ...e.data, id: e.id }))];
    const lists = [...seed.lists.filter((l: any) => !changes.some((e: Entry) => e.kind === 'list' && e.id === l.id)), ...changes.filter((e: Entry) => e.kind === 'list').map((e: Entry) => ({ ...e.data, id: e.id }))].sort((a: any, b: any) => a.date.localeCompare(b.date));
    const docs = [...seed.docs.filter((d: any) => !changes.some((e: Entry) => ['document', 'knowledge'].includes(e.kind) && e.id === d.id)), ...changes.filter((e: Entry) => ['document', 'knowledge'].includes(e.kind)).map((e: Entry) => ({ ...e.data, id: e.id }))];
    const catalogRef=useRef<any>({});catalogRef.current={docs,files,problems};
    useEffect(()=>{if(!boot)return;const change=()=>{const h=location.hash.slice(1).replace(/^\//,'');const m=/^read\/(document|file)\/(.+)$/.exec(h);if(m){const id=decodeURIComponent(m[2]),source=m[1]==='document'?catalogRef.current.docs.find((d:any)=>d.id===id):catalogRef.current.files.find((f:Entry)=>f.id===id);if(source){if(m[1]==='document')setDoc({...source,focus:true});else setReadingFile({...source,focus:true} as any);}else tell('阅读来源不存在或已回收');}else if(nav.some(n=>n[0]===h)){setPage(h);setDoc(null);setReadingFile(null);}};change();const openFile=(event:any)=>{const f=catalogRef.current.files.find((f:Entry)=>f.id===event.detail);if(f)setReadingFile(f);else tell('原件不存在或已回收');};window.addEventListener('hashchange',change);window.addEventListener('algonotes:open-file',openFile);return()=>{window.removeEventListener('hashchange',change);window.removeEventListener('algonotes:open-file',openFile);};},[!!boot]);
    function closeReading(){setDoc(null);setReadingFile(null);if(/^#\/?read\//.test(location.hash))location.hash=page;}
    const currentList = lists.find((l: any) => l.date === date);
    const index = useMemo(() => searchIndex(problems, docs, active), [boot, entries]);
    const problemTexts = useMemo(() => new Map(problems.map((p: any) => [p.id, normalized([p.code, p.title, p.topic, p.knowledge, p.body, ...notes.filter(n => noteProblemIds(n.data).includes(p.id)).map(n => n.data.body)].join(' '))])), [boot, entries]);
    const grouped = useMemo(() => { const attemptsBy = new Map<string, Entry[]>(), submissionsBy = new Map<string, Entry[]>(); for (const e of attempts)
        attemptsBy.set(e.data.problemId, [...(attemptsBy.get(e.data.problemId) ?? []), e]); for (const e of subs)
        submissionsBy.set(e.data.problemId, [...(submissionsBy.get(e.data.problemId) ?? []), e]); return { attemptsBy, submissionsBy }; }, [entries]);
    function openMark(m:Entry){
        setModal('');
        if(m.data.targetType==='file'){const f=files.find(f=>f.id===m.data.targetId);if(f)setReadingFile({...f,readLocation:m.data.location} as any);else tell('来源文件已回收或不存在，请先恢复原件');}
        else {const d=docs.find((d:any)=>d.id===m.data.targetId);if(d)setDoc({...d,readLocation:m.data.location});else tell('来源讲义已变更，标记摘录仍保留');}
    }
    function selectFolder(id:string){go('notes');setFolder(id);setNoteSearch('');setQuery('');}
    function shiftDate(step: number) { const [y, m, d] = date.split('-').map(Number); setDate(new Date(Date.UTC(y, m - 1, d + step)).toISOString().slice(0, 10)); }
    function openSearch(item: any) { if (item.kind === '题目')
        setProblem(item.source);
    else if (item.kind === '笔记')
        setNote(item.source);
    else if (item.kind === '文件')
        setReadingFile(item.source);
    else if (['STL', '讲义'].includes(item.kind))
        setDoc(item.source);
    else if (item.kind === '标记')
        openMark(item.source);
    else if (['错题','代码模板','分类'].includes(item.kind))
        go('studio');
    else if (item.kind === '卡点')
        go('review');
    else
        setDoc({ ...item.source.data, id: item.source.id, kind: '个人知识', body: item.source.data.body || '尚无正文，可写一篇关联笔记。' }); }
    function openEntity(r:any){
        if(r.type==='problem'){const p=problems.find((p:any)=>p.id===r.id);if(p)setProblem(p);else tell('题目来源不存在');}
        else if(r.type==='document'){const d=docs.find((d:any)=>d.id===r.id);if(d)setDoc(d);else tell('文档来源不存在');}
        else {const e=active.find(e=>e.id===r.id&&e.kind===r.type);if(!e)return tell('来源已回收或不存在');if(r.type==='note')setNote(e);else if(r.type==='file')setReadingFile(e);else go('studio');}
    }
    async function save(kind: Kind, data: any, old?: Entry | null, id?: string, extra: any = {}) {
        const entry = { id: id ?? old?.id ?? uid(), kind, data, baseVersion: old?.version ?? 0, operationId: uid(), ...extra };
        const response = await postRecord(entry);
        const out: any = response.out;
        if (!response.ok) {
            if (response.status === 409)
                setConflict({ local: entry, current: out.current });
            throw new Error(out.error);
        }
        acceptEntries([out]);
        return out as Entry;
    }
    async function updateState(id: string, patch: any) {
        try {
            const old = recordsRef.current.find(e => e.kind === 'state' && e.data.problemId === id && !e.deleted);
            await save('state', { ...state(id), problemId: id, ...patch }, old, 'state:' + id);
            tell('状态已保存，未改动历史提交');
            return true;
        }
        catch (e: any) {
            tell(e.message);
            return false;
        }
    }
    async function remove(e: Entry) {
        try {
            if (e.deleted) {
                const ensure = async (id: string, seen = new Set<string>()): Promise<void> => { if (!id || seen.has(id))
                    return; seen.add(id); const f = recordsRef.current.find(n => n.id === id && n.kind === 'folder'); if (f?.deleted) {
                    await ensure(f.data.parentId, seen);
                    await save('folder', f.data, f, f.id, { deleted: false, restore: true });
                } };
                await ensure(e.kind === 'folder' ? e.data.parentId : e.data.folderId);
            }
            await save(e.kind, e.data, e, e.id, { deleted: !e.deleted, restore: e.deleted });
            tell(e.deleted ? '已恢复' : e.kind === 'selection' ? '已从今日训练池移除，可重新勾选' : e.kind === 'review' ? '已删除复习安排' : e.kind === 'view' ? '已删除保存的视图' : e.kind === 'feedback' ? '已删除该条卡点' : ['note', 'file', 'folder', 'mistake', 'relation', 'taxonomy', 'snippet', 'simulation', 'bookmark'].includes(e.kind) ? '已移入回收站，可恢复' : '已删除');
            if (note?.id === e.id)
                setNote(null);
            return true;
        }
        catch (x: any) {
            tell(x.message);
            return false;
        }
    }
    function createNote(problemId = '', body = '', title = '', links:any = {}) { const id = uid(); setNote({ id, kind: 'note', data: { title: title || '', body, folderId: folder === '__inbox' ? '' : folder, problemId, tags: [], ...links }, version: 0, deleted: false, updated: new Date().toISOString() }); }
    async function start(p: any, force = false) {
        const found = !force && attempts.find(e => e.data.problemId === p.id && e.data.status === '进行中');
        if (found) {
            setProblem(p);
            return;
        }
        try {
            await save('attempt', { problemId: p.id, status: '进行中', day: localDay(), activityDays: [localDay()], startedAt: new Date().toISOString(), help: '未知', tool: '未知', minutes: '', code: '', reflection: '', blocker: '' });
            const statusSaved=await updateState(p.id, { progress: '进行中' });
            setProblem(p);
            tell(statusSaved?'已开始一次尝试':'尝试已保存，但题目状态同步失败；可在题目中重新设置进度');
        }
        catch (e: any) {
            tell(e.message);
        }
    }
    async function upload(file:File,link:any={}){
        const {onProgress,shouldPause,...meta}=link;
        if(file.size>0){const x=await uploadChunked(file,{id:uid(),folderId:folder==='__inbox'?'':folder,...meta},onProgress,shouldPause);acceptEntries([x]);return x;}
        const form=new FormData();form.set('file',file);form.set('id',uid());Object.entries(meta).forEach(([k,v])=>form.set(k,String(v??'')));const r=await fetch('/api/files',{method:'POST',body:form});const x:any=await r.json();if(!r.ok)throw new Error(x.error);acceptEntries([x]);return x;
    }
    async function handleFiles(fs: FileList | null) {
        if(!fs?.length)return;setBusy(true);let completed=0,failed=0;
        for(const f of Array.from(fs)){try{
            await upload(f,replaceFileRef.current?{previousId:replaceFileRef.current}:note?{parentId:note.version?note.id:'',problemId:note.data.problemId}:problem?{problemId:problem.id}:{});completed++;
        }catch(e:any){failed++;tell(f.name+'：'+e.message);}}
        setBusy(false);tell(`已保存${completed}项，失败${failed}项；失败文件可重新选择上传`);
        if(fileRef.current)fileRef.current.value='';replaceFileRef.current='';
    }
    async function showHistory(e: Entry) {
        try {
            const r = await fetch('/api/history?id=' + encodeURIComponent(e.id));
            const x: any = await r.json();
            if (!r.ok)
                throw new Error(x.error);
            setHistory(x);
            setModal('history');
        }
        catch (e: any) {
            tell(e.message);
        }
    }
    async function exportAll(){setBusy(true);try{await createStreamBackup(tell);setModal('backup');tell('流式完整备份已校验保存，请下载全部分包（含最后的清单包）');}catch(e:any){setModal('backup');tell(e.message+'；未完成副本可在备份管理中清理');}finally{setBusy(false);}}
    async function inspectImport(fs: FileList | null) {
        if (!fs)
            return;
        try {
            const f = fs[0];
            if (f.size > 2 * 1024 * 1024)
                throw new Error('可编辑导入上限2MiB；较大文件请先上传原件');
            const text = await f.text();
            if (/\.json$/i.test(f.name)) {
                const x = JSON.parse(text);
                if (Array.isArray(x)) {
                    const r = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', entries: x }) });
                    const preview: any = await r.json();
                    if (!r.ok)
                        throw new Error(preview.error);
                    setImports({ type: 'records', entries: x, name: f.name, preview });
                }
                else
                    throw new Error('JSON应为导出的笔记/自定义记录数组；完整备份请用恢复入口');
            }
            else
                setImports({ type: 'markdown', body: text, name: f.name });
            setModal('import');
        }
        catch (e: any) {
            tell(e.message);
        }
    }
    async function applyImport() {
        if (!imports)
            return;
        setBusy(true);
        try {
            if (imports.type === 'markdown') {
                createNote('', imports.body, imports.name.replace(/\.(md|markdown|txt)$/i, ''));
            }
            else {
                const r = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'apply', entries: imports.entries }) });
                const out: any = await r.json();
                if (!r.ok)
                    throw new Error(out.error);
                await reload();
                setLastImport(imports.entries);
            }
            setModal('');
            setImports(null);
            tell('导入完成；原文件未被修改');
        }
        catch (e: any) {
            tell(e.message);
        }
        finally {
            setBusy(false);
        }
    }
    async function restoreBackup() {
        if (!restore)
            return;
        setBusy(true);
        try {
            if(restore.version===2){const result=await restoreStreamBackup(restore,tell);await reload();setRestore(null);setModal('backup');tell('恢复完成：'+result.restored+'项，已存在项跳过'+result.skipped+'项');return;}
            const m = restore.manifest;
            const prefix = 'restore-' + m.snapshotId + '-';
            const ids = new Map<string, string>();
            for (const e of m.entries)
                ids.set(e.id, prefix + e.id);
            function remap(x: any): any {
                if (typeof x === 'string') {
                    if (ids.has(x))
                        return ids.get(x);
                    return x.replace(/(\/api\/files\?id=)([a-zA-Z0-9_.:-]+)/g, (_: string, prefix: string, id: string) => prefix + (ids.get(id) ?? id));
                }
                if (Array.isArray(x))
                    return x.map(remap);
                if (x && typeof x === 'object')
                    return Object.fromEntries(Object.entries(x).filter(([k]) => !['owner', 'ownerId'].includes(k)).map(([k, v]) => [k, remap(v)]));
                return x;
            }
            const newEntries = m.entries.map((e: any) => ({ ...e, id: ids.get(e.id), data: remap(e.data) }));
            const oversized = m.entries.filter((e: any) => e.kind === 'file' && (restore.bytes['files/' + e.id]?.byteLength ?? 0) > 20 * 1024 * 1024);
            if (oversized.length)
                throw new Error('该 V1 备份包含超过 20MiB 的附件（如 ' + oversized[0].data.name + '），旧版恢复通道无法接收并会中途中断；请改用 V2 完整备份或单独上传该附件。');
            for (const e of newEntries.filter((e: any) => e.kind === 'file')) {
                const orig = m.entries.find((f: any) => ids.get(f.id) === e.id);
                const form = new FormData();
                form.set('file', new File([restore.bytes['files/' + orig.id]], e.data.name, { type: e.data.type }));
                form.set('id', e.id);
                const r = await fetch('/api/files', { method: 'POST', body: form });
                const out: any = await r.json();
                if (!r.ok)
                    throw new Error(out.error);
                e.data = { ...e.data, ...out.data, parentId: e.data.parentId, problemId: e.data.problemId, folderId: e.data.folderId };
            }
            const r = await fetch('/api/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schemaVersion: 1, entries: newEntries, revisions: m.revisions.map((e: any) => ({ ...e, id: ids.get(e.id) ?? prefix + e.id, data: remap(e.data) })) }) });
            const x: any = await r.json();
            if (!r.ok)
                throw new Error(x.error);
            await reload();
            setRestore(null);
            setModal('');
            tell('恢复完成，已创建独立副本，重复恢复不会翻倍');
        }
        catch (e: any) {
            tell(e.message);
        }
        finally {
            setBusy(false);
        }
    }
    const visibleProblems = useMemo(() => problems.filter((p: any) => { const st = state(p.id), aa = grouped.attemptsBy.get(p.id) ?? [], ss = grouped.submissionsBy.get(p.id) ?? []; return (problemTexts.get(p.id) ?? '').includes(normalized(deferredQuery)) && (!filters.status || st.progress === filters.status) && (!filters.mastery || st.mastery === filters.mastery) && (!filters.topic || (p.knowledge || p.topic) === filters.topic) && (!filters.type || p.type === filters.type) && (!(filters.help || filters.result) || ss.some(s => (!filters.help || s.data.help === filters.help) && (!filters.result || s.data.result === filters.result) && (!filters.date || localDay(new Date(s.data.at)) === filters.date))) && (!filters.date || (filters.result || filters.help || smart === 'independent') || aa.some(a => attemptDays(a.data).includes(filters.date))) && (!smart || smart === 'favorite' && st.favorite || smart === 'done' && aa.length > 0 || smart === 'independent' && ss.some(s => s.data.result === 'AC' && s.data.help === '独立' && (!filters.date || localDay(new Date(s.data.at)) === filters.date)) || smart === 'blocked' && st.progress === '卡住'); }), [boot, entries, filters, smart, deferredQuery]);
    const totalPracticed = new Set(attempts.map(a => a.data.problemId)).size;
    const acCount = new Set(subs.filter(s => s.data.result === 'AC').map(s => s.data.problemId)).size;
    function row(p: any, i: number, compact = false) {
        const s = state(p.id);
        const done = subs.some(e => e.data.problemId === p.id && e.data.result === 'AC');
        const selected = of('selection').find(e => e.data.problemId === p.id && e.data.day === date);
        return <div key={p.id} className={'problem-row ' + (compact ? 'compact' : '')}><button className={'check-select ' + (selected ? 'selected' : '')} aria-label={'选择 ' + p.code} aria-pressed={!!selected} onClick={async () => {
                try {
                    selected ? await remove(selected) : await save('selection', { problemId: p.id, day: date });
                }
                catch (e: any) {
                    tell(e.message);
                }
            }}>{selected ? <Check size={14}/> : <span />}</button><span className="row-number">{String(i + 1).padStart(2, '0')}</span><button className="problem-name" onClick={() => setProblem(p)}><div><span className="code-label">{p.code}</span><strong>{p.title.replace(p.code, '').trim()}</strong>{p.position === 3 && <Pill>选做</Pill>}</div><p>{p.role}<span>·</span>{p.position >= 5 ? '独立选法' : p.topic}</p></button><span className={'difficulty ' + (/1400|1500|中等|普及$/.test(p.difficulty) ? 'amber' : '')}>{p.difficultyLabel || p.difficulty?.replace(/Codeforces官方\s*/, 'CF ').replace('洛谷', '').split('；')[0]}</span><div className="row-state">{done ? <><CheckCircle2 size={14}/><span>曾 AC</span></> : s.progress === '未记录' ? <><Circle size={13}/><span>未记录</span></> : <><Clock3 size={14}/><span>{s.progress}</span></>}</div><button className="icon-button" onClick={() => setProblem(p)} aria-label={'打开 ' + p.code}><ChevronRight size={18}/></button></div>;
    }
    if (loading)
        return <div className="loading-screen"><div className="brand-mark"><Braces /></div><h2>算法训练工作台</h2><p>正在读取你的私人空间…</p></div>;
    if (!boot)
        return <div className="loading-screen"><AlertCircle /><h2>暂时无法读取工作台</h2><p>{friendlyError(error)}</p><a className="button primary" href="/signin-with-chatgpt?return_to=%2F" target="_top">登录并继续</a><button className="button" onClick={() => { setLoading(true); reload().catch(e => setError(e.message)).finally(() => setLoading(false)); }}>重试</button></div>;
    return <div className={"app-shell density-" + prefs.density} style={{ "--sidebar-width": prefs.sidebarWidth + "px", "--reading-size": prefs.fontSize + "px", "--reader-line-height":prefs.readerLineHeight, "--reader-width":prefs.readerWidth+"px" } as any}><a className="skip-link" href="#main-content">跳到主要内容</a>{mobile && <div className="sidebar-backdrop" onClick={() => setMobile(false)} aria-hidden="true"/>}<aside className={'sidebar ' + (mobile ? 'open' : '')}><button className="brand" onClick={() => go('today')}><div className="brand-mark"><Braces size={23}/></div><div><strong>AlgoNotes<span>算法训练工作台</span></strong></div></button><div className="workspace-label">个人学习空间 <ShieldCheck size={13}/></div><nav aria-label="主要导航">{orderedNav.map(([id, text, Icon]) => <button className={page === id ? 'active' : ''} key={id} onClick={() => go(id)}><Icon size={18}/><span>{text}</span>{id === 'review' && of('review').filter(e => e.data.status === '待做').length > 0 && <b>{of('review').filter(e => e.data.status === '待做').length}</b>}</button>)}</nav><div className="sidebar-section"><span>我的视图</span><button onClick={() => { go('problems'); setSmart('favorite'); }}><Bookmark size={16}/>收藏的题目</button><button onClick={() => { go('problems'); setSmart('blocked'); }}><AlertCircle size={16}/>待突破的卡点</button>{of('view').map(v => <button key={v.id} onClick={() => { go('problems'); setFilters(v.data.filters); setQuery(v.data.query ?? ''); setSmart(v.data.smart ?? ''); }}><Filter size={15}/>{v.data.title}<span className="tiny-delete" role="button" tabIndex={0} aria-label={'删除视图 ' + v.data.title} onClick={e => { e.stopPropagation(); remove(v); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); remove(v); } }}>×</span></button>)}</div><div className="sidebar-section"><button onClick={()=>setModal('marks')}><Bookmark size={16}/>我的阅读标记 <span>{of('bookmark').length||''}</span></button></div>{prefs.showFolderTree&&<SidebarFolders folders={folders} selected={page==='notes'?folder:''} onSelect={selectFolder} onCreate={()=>{setFolderEditing(null);setFolderStart('');setModal('folder');}} onUpload={()=>setModal('transfers')}/>}<div className="sidebar-section pinned-section"><span>固定内容</span>{prefs.pinnedFolders.map(id => folders.find(f => f.id === id)).filter(Boolean).map((f: any) => <button key={f.id} onClick={() => { selectFolder(f.id); }}><Folder size={15}/>{f.data.title}</button>)}{prefs.pinnedNotes.map(id => active.find(e => e.id === id)).filter(Boolean).map((n: any) => <button key={n.id} onClick={() => n.kind === 'note' ? setNote(n) : setReadingFile(n)}><FileText size={15}/>{n.kind === 'note' ? n.data.title || '未命名笔记' : n.data.title || n.data.name}</button>)}<button onClick={() => setModal('workspace')}><Settings size={15}/>自定义侧边栏</button></div><div className="sidebar-bottom"><button onClick={() => { go('notes'); setTrash(true); }}><Trash2 size={16}/>回收站</button><button onClick={() => setModal('backup')}><HardDrive size={16}/>备份管理</button><button onClick={() => setModal('settings')}><Settings size={16}/>设置与数据</button><div className="profile"><div className="avatar">学</div><div><strong>我的算法旅程</strong><span><span className="live-dot"/>私有空间 · 已连接</span></div><button className="icon-button" aria-label="切换深浅主题" onClick={() => setDark(d => !d)}>{dark ? <Sun size={16}/> : <Moon size={16}/>}</button></div></div></aside>
 <div className="main-shell"><header className="topbar"><button className="mobile-menu icon-button" aria-label="打开导航" onClick={() => setMobile(!mobile)}><Menu /></button><div className="breadcrumbs"><span>学习工作台</span><ChevronRight size={13}/><strong>{nav.find(n => n[0] === page)?.[1]}</strong></div>{offline && <span className="mini" role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><CloudOff size={13}/>离线重试中…</span>}<div className="global-search"><Search size={16}/><input aria-label="全局搜索" ref={searchRef} value={globalQuery} onKeyDown={e => { if (e.key === 'Escape') { setGlobalQuery(''); e.stopPropagation(); searchRef.current?.blur(); } }} onChange={e => {
            setGlobalQuery(e.target.value);
            if (page !== 'problems')
                go('problems');
        }} placeholder="搜索题目、知识点或笔记…"/><kbd>⌘ K</kbd></div><button className="button small" onClick={() => createNote()}><Plus size={16}/><span>随手记</span></button></header>
 {boot.user.preview && <div className="preview-banner">本地验收空间 · 使用隔离数据，正式站点通过 ChatGPT 登录</div>}
 <main id="main-content" className="main-content">
 {page === 'today' && <><div className="page-title"><div><div className="eyebrow">YOUR DAILY PRACTICE</div><h1>今天，也向前一步<span className="title-dot">.</span></h1><p>专注一条主线，留下每一次思考。不必做完所有题。</p></div><div className="date-switch"><CalendarDays size={16}/><button className="icon-button" aria-label="前一天" onClick={() => shiftDate(-1)}><ChevronLeft size={16}/></button><input type="date" aria-label="选择训练日期" value={date} style={{ border: 0, background: 'transparent', fontSize: 11, padding: '6px 3px', color: 'inherit' }} onChange={e => { if (e.target.value) setDate(e.target.value); }}/><button className="icon-button" aria-label="后一天" onClick={() => shiftDate(1)}><ChevronRight size={16}/></button>{date !== localDay() && <button className="text-button" onClick={() => setDate(localDay())}>回今天</button>}</div></div>
 <div className="dashboard-grid"><div className="dashboard-main"><section className="hero"><div className="hero-label"><span className="hero-dot"/>每日专题集训 <span>/ {date.slice(5).replace('-', '.')}</span></div><h2>{currentList?.title || '自由训练日'}</h2><p>把方法用在不同的问题里，<br />也把自己的理解留在这里。</p><div className="hero-bottom"><button className="button hero-button" onClick={() => {
                const p = problems.find((p: any) => p.id === currentList?.items[0]);
                if (p)
                    setProblem(p);
            }}>开始今日训练 <ArrowRight size={16}/></button><span>{currentList?.items.length ?? 0} 题可选池 <i /> ④ 挑战选做</span></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit1"/><div className="orbit orbit2"/><div className="code-tile"><Braces size={50} strokeWidth={1.2}/></div><span className="float-code a">push()</span><span className="float-code b">while</span><span className="float-node n1"/><span className="float-node n2"/><span className="float-node n3"/></div></section>
 <DailyDeliveryCard list={currentList} docs={docs} changes={changes} open={setDoc}/><LearningOverview problems={problems} entries={entries} day={date} listIds={currentList?.items ?? []} open={setProblem} prefs={prefs} onPrefs={setPrefs} onReview={() => go('review')} tell={tell}/><div className="section-heading"><h2><span className="section-dot"/>今日训练池 <span className="count">{currentList?.items.length ?? 0}</span></h2><button className="text-button" onClick={() => {
                const d = docs.find((d: any) => d.date === date);
                if (d)
                    setDoc(d);
            }}>查看完整学习单 <ArrowRight size={14}/></button></div><div className="tabs" role="tablist" aria-label="训练池分组" onKeyDown={e => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? POOL_TABS.length - 1 : (POOL_TABS.indexOf(section) + (e.key === 'ArrowRight' ? 1 : -1) + POOL_TABS.length) % POOL_TABS.length; setSection(POOL_TABS[next]); (e.currentTarget.querySelectorAll('[role="tab"]')[next] as HTMLElement)?.focus(); }}>{POOL_TABS.map(s => <button key={s} role="tab" tabIndex={section === s ? 0 : -1} aria-selected={section === s} className={section === s ? 'active' : ''} onClick={() => setSection(s)}>{s}</button>)}</div><div className="problem-list">{currentList?.items.map((id: string) => problems.find((p: any) => p.id === id)).filter(Boolean).filter((p: any) => section === '全部' || section === '专题主线' && p.position < 4 || section === 'STL练习' && p.position === 4 || section === '思维与应用' && p.position > 4).map((p: any, i: number) => row(p, i, true))}{!currentList && <Empty title="这一天没有题单" text="自由训练日：可到题库挑题，勾选加入当天训练池。"/>}</div><p className="below-note"><ShieldCheck size={13}/>推荐 ≠ 完成；未反馈保持未知，未开始不积累补做债。</p>
 <div className="section-heading"><h2><NotebookPen size={18}/>留住刚刚的想法</h2><button className="text-button" onClick={() => go('notes')}>全部笔记 <ChevronRight size={14}/></button></div><div className="quick-note" onClick={() => createNote()}><div className="quick-note-icon"><Plus size={21}/></div><div><strong>哪一步想通了？哪里还卡着？</strong><p>写一句也很好。代码、图片和文件都可以放进来。</p></div><ArrowRight size={19}/></div></div>
 <aside className="dashboard-side"><section className="card progress-card"><div className="section-heading"><h3>今日小结</h3><span className="mini">真实记录</span></div><div className="progress-ring" style={{ '--progress': Math.min(100, attempts.filter(a => attemptDays(a.data).includes(date)).length / Math.max(1, of('selection').filter(e => e.data.day === date).length) * 100) + '%' } as any}><div><strong>{attempts.filter(a => attemptDays(a.data).includes(date)).length}</strong><span>次实际尝试</span></div></div><div className="progress-stats"><div><strong>{of('selection').filter(e => e.data.day === date).length}</strong><span>自主选题</span></div><div><strong>{notes.filter(n => localDay(new Date(n.updated)) === date).length}</strong><span>笔记更新</span></div></div><div className="gentle-tip">小步前进，也算前进。<br />今天练什么，由你决定。</div></section>
 <section className="card stl-card"><div className="stl-icon"><Terminal size={20}/></div><span className="eyebrow">DAILY TOOLKIT</span><h3>{TOOLKIT[new Date(date + 'T00:00:00+08:00').getDay()] ?? '每日 STL 工具箱'}</h3><p>接口、参数、边界与通用示例。<br />学工具，也练真正的应用。</p><button className="text-button" onClick={() => { go('knowledge'); setKnowledgeTab('STL专题'); }}>打开 STL 专题 <ArrowRight size={15}/></button></section>
 <section className="card quiet-card"><div className="small-icon"><Layers size={17}/></div><h3>你的积累，从这里开始</h3><div className="library-counts"><div><strong>{problems.length}</strong><span>道题目</span></div><div><strong>{docs.filter((d: any) => d.kind === 'STL专题').length}</strong><span>STL 模块</span></div></div><p>内容已就位，个人记录等你书写。</p></section></aside></div></>}
 {page === 'problems' && <><div className="page-title"><div><div className="eyebrow">PROBLEM LIBRARY</div><h1>找到下一道，值得思考的题。</h1><p>{problems.length} 道题目 · 按日期、知识点、类型与真实练习状态筛选</p></div><button className="button primary" onClick={() => { setCustomId(''); setCustomBase(0); setCustom({ code: '', title: '', url: '', difficulty: '未评级', topic: '自定义', body: '' }); setModal('custom'); }}><Plus size={16}/>添加题目</button></div><div className="stats-strip"><div><span>题目总量</span><strong>{problems.length}</strong></div><div><span>实际练过</span><strong>{totalPracticed}</strong></div><div><span>曾有 AC</span><strong>{acCount}</strong></div><div><span>独立 AC</span><strong>{problems.filter((p: any) => independentAC(attempts, subs, p.id)).length}</strong></div></div><details className="card"><summary>历史日单 · {lists.length}</summary><div style={{ display: 'grid', gap: 2 }}>{lists.slice().reverse().map((l: any) => <button key={l.id} className="text-button" style={{ justifyContent: 'flex-start' }} onClick={() => { setDate(l.date); go('today'); }}>{l.date} · {l.title} · {l.items?.length ?? 0}题</button>)}</div></details><section className="card filter-panel"><div className="filter-row"><div className="search-field"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="题号 / 标题 / 正文 / 题下笔记"/></div><button className="button" onClick={async () => {
                const title = await askSync('保存当前筛选', '视图名称', '我的筛选');
                if (title)
                    try {
                        await save('view', { title, filters, query, smart });
                        tell('已保存到侧栏');
                    }
                    catch (e: any) {
                        tell(e.message);
                    }
            }}><Bookmark size={15}/>保存视图</button></div><details className="advanced-filters" {...(Object.values(filters).some(Boolean) ? { open: true } : {})}><summary>高级筛选{Object.values(filters).some(Boolean) ? ` · 已启用 ${Object.values(filters).filter(Boolean).length} 项` : ' · 日期 / 知识点 / 结果等'}</summary><div className="filter-row wrap"><Select label="练习进度" value={filters.status} options={['', ...progress]} onChange={v => setFilters({ ...filters, status: v })}/><Select label="掌握情况" value={filters.mastery} options={['', ...mastery]} onChange={v => setFilters({ ...filters, mastery: v })}/><Select label="考察知识点" value={filters.topic} options={['', ...Array.from(new Set(problems.map((p: any) => p.knowledge || p.topic))) as string[]]} onChange={v => setFilters({ ...filters, topic: v })}/><Select label="题目类型" value={filters.type} options={['', ...Array.from(new Set(problems.map((p: any) => p.type))) as string[]]} onChange={v => setFilters({ ...filters, type: v })}/><Select label="提交结果" value={filters.result} options={['', ...results]} onChange={v => setFilters({ ...filters, result: v })}/><Select label="帮助程度" value={filters.help} options={['', ...help]} onChange={v => setFilters({ ...filters, help: v })}/><input type="date" aria-label="实际练习日" value={filters.date} onChange={e => setFilters({ ...filters, date: e.target.value })}/><button className="text-button" onClick={() => { setFilters({ status: '', mastery: '', topic: '', type: '', help: '', result: '', date: '' }); setSmart(''); setQuery(''); }}>重置</button></div></details><div className="smart-chips">{[['', '全部题目'], ['done', '我练过的'], ['independent', '独立 AC'], ['blocked', '待突破'], ['favorite', '已收藏']].map(([s, t]) => <button className={smart === s ? 'active' : ''} key={s} aria-pressed={smart === s} onClick={() => setSmart(s)}>{t}</button>)}</div></section><SearchResults index={index} query={globalQuery} open={openSearch} onClose={() => setGlobalQuery('')}/><div className="section-heading"><h2>题目列表 <span className="count">{visibleProblems.length}</span></h2><button className="text-button" onClick={() => download('\uFEFF题号,题名,进度,掌握\n' + visibleProblems.map((p: any) => [p.code, p.title, state(p.id).progress, state(p.id).mastery].map(escapeCSV).join(',')).join('\n'), '题目清单.csv', 'text/csv;charset=utf-8')}><Download size={14}/>导出 CSV</button></div><div className="problem-list">{visibleProblems.slice(0, shown).map((p: any, i: number) => row(p, i))}{visibleProblems.length > shown && <button className="button" onClick={() => setShown(n => n + 60)}>继续显示（剩余{visibleProblems.length - shown}项）</button>}{!visibleProblems.length && <Empty title="没有符合条件的题目" text={query.trim() ? '页内筛选没有命中；可减少筛选条件，或在全局搜索中查找笔记、文件与讲义。' : '试着减少筛选条件，或添加你正在练的题。'} action={query.trim() ? () => setGlobalQuery(query) : undefined} actionLabel="在全局搜索中查找"/>}</div></>}
 {page === 'knowledge' && <><div className="page-title"><div><div className="eyebrow">KNOWLEDGE & TOOLKIT</div><h1>让知识，从看懂走向会用。</h1><p>独立 STL 专题、每日技巧与知识笔记；阅读不等于掌握。</p></div><button className="button" onClick={() => { createNote('', '', '我的知识笔记'); }}><Plus size={16}/>写知识笔记</button></div><div className="tabs" role="tablist" aria-label="知识分类" onKeyDown={e => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); const cur = KNOWLEDGE_TABS.indexOf(knowledgeTab), next = e.key === 'Home' ? 0 : e.key === 'End' ? KNOWLEDGE_TABS.length - 1 : ((cur === -1 ? 0 : cur) + (e.key === 'ArrowRight' ? 1 : -1) + KNOWLEDGE_TABS.length) % KNOWLEDGE_TABS.length; setKnowledgeTab(KNOWLEDGE_TABS[next]); (e.currentTarget.querySelectorAll('[role="tab"]')[next] as HTMLElement)?.focus(); }}>{KNOWLEDGE_TABS.map(s => <button key={s} role="tab" tabIndex={(knowledgeTab === s || knowledgeTab === '全部' && s === 'STL专题') ? 0 : -1} aria-selected={knowledgeTab === s} className={(knowledgeTab === s || knowledgeTab === '全部' && s === 'STL专题') ? 'active' : ''} onClick={() => setKnowledgeTab(s)}>{s}</button>)}</div>{knowledgeTab === '接口速查' && <Suspense fallback={<p>正在打开接口目录…</p>}><StlBrowser docs={docs} entries={entries} onOpen={setDoc} onSave={save} onNote={createNote} tell={tell}/></Suspense>}<div className="knowledge-grid">{docs.filter((d: any) => ['STL专题', '日单原文', '项目文档'].includes(knowledgeTab) && d.kind === knowledgeTab).map((d: any, i: number) => <button className="knowledge-card" key={d.id} onClick={() => setDoc(d)}><div className="knowledge-top"><span className="module-number">{String(i + 1).padStart(2, '0')}</span><Code2 size={20}/></div><h3>{d.title}</h3><p>{d.kind === 'STL专题' ? '参数与返回 · 复杂度 · 易错边界 · 可运行示例' : d.date || '实施基线与功能要求'}</p><div><Pill>{d.kind}</Pill><ChevronRight size={16}/></div></button>)}</div>{['STL专题', '日单原文', '项目文档'].includes(knowledgeTab) && !docs.some((d: any) => d.kind === knowledgeTab) && <Empty title="暂无这类文档" text="教练内容更新后会出现在这里。"/>}{knowledgeTab === '我的知识' && <><div className="section-heading"><h2>个人知识条目</h2><button className="button" onClick={async () => {
                    const name = await askSync('新增知识条目', '知识点名称', '');
                    if (name)
                        try { await save('knowledge', { title: name, status: '未评估', body: '', parent: '' }); } catch (e: any) { tell(e.message); }
                }}><Plus size={15}/>新增条目</button></div>{of('knowledge').map(e => <div className="card list-card" key={e.id}><Code2 /><strong>{e.data.title}</strong><Select label="知识掌握" value={e.data.status ?? '未评估'} options={mastery} onChange={v => save('knowledge', { ...e.data, status: v }, e).catch((e: any) => tell(e.message))}/><button className="text-button" onClick={() => createNote('', e.data.body, e.data.title)}>补充笔记</button></div>)}{!of('knowledge').length && <Empty title="还没有个人知识条目" text="把踩过的坑和想通的方法沉淀成条目，方便日后回看。"/>}</>}</>}
 {page === 'notes' && <><div className="page-title"><div><div className="eyebrow">NOTES & RESOURCES</div><h1>{trash ? '回收站' : '给思考，一个安放的地方。'}</h1><p>{trash ? '恢复不会覆盖当前内容；第一版不自动永久清空。' : '题下感悟、独立笔记、代码与资料，放在同一个空间。'}</p></div><div className="button-group">{trash && <button className="button" onClick={() => setTrash(false)}><ChevronLeft size={16}/>返回笔记</button>}<button className="button" onClick={() => setModal('transfers')} disabled={busy}><Upload size={16}/>上传 / 导入文件夹</button><button className="button primary" onClick={() => createNote()}><Plus size={16}/>新建笔记</button></div></div><div className="notes-layout"><aside className="folder-panel"><FolderTree folders={folders} entries={entries} selected={folder} onSelect={(id:string)=>{setFolder(id);setNoteSearch('');}} onEdit={(f: Entry) => { setFolderEditing(f); setModal('folder'); }} onCreate={(id: string) => { setFolderEditing(null); setFolderStart(id === '__inbox' ? '' : id); setModal('folder'); }} prefs={prefs} onPrefs={setPrefs}/><button onClick={() => importRef.current?.click()}><Upload size={16}/>导入 Markdown / JSON</button>{lastImport && <button onClick={async () => {
                    try {
                        const r = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'undo', entries: lastImport }) });
                        const x: any = await r.json();
                        if (!r.ok)
                            throw new Error(x.error);
                        await reload();
                        tell(`已回收${x.removed}项；${x.conflicts.length}项有后续编辑/关联而保留`);
                    }
                    catch (e: any) {
                        tell(e.message);
                    }
                }}><RotateCcw size={16}/>撤销本批安全新增项</button>}<button onClick={() => { download(JSON.stringify([...folders, ...notes], null, 2), '我的笔记.json', 'application/json'); }}><Download size={16}/>导出笔记 JSON</button></aside><div><div className="note-tools"><div className="search-field"><Search size={16}/><input value={noteSearch} onChange={e => setNoteSearch(e.target.value)} placeholder="搜索正文、代码或文件名…"/></div></div><>{drafts.length > 0 && !trash && <div className="draft-list"><strong>本机待同步草稿</strong>{drafts.map(d => <button key={d.key} onClick={() => { if(d.kind==='attempt'){const p=problems.find((p:any)=>p.id===d.problemId);if(p)setProblem({...p,resumeAttemptId:d.targetId});else tell('原题目不存在，请先导出草稿');return;} const id = d.key.slice(boot.user.id.length + 1); setNote({ id, kind: "note", data: d.data, version: d.baseVersion ?? 0, updated: d.at, deleted: false }); }}><CloudOff size={14}/>{d.kind==='attempt'?'练习草稿 · '+(problems.find((p:any)=>p.id===d.problemId)?.code||d.problemId):d.data.title || "未命名草稿"}<span>恢复编辑</span></button>)}</div>}</>{trash && entries.some(e => e.kind === 'folder' && e.deleted) && <section className="card recycled-folders"><h3>已回收文件夹</h3><p className="tiny">恢复内容时会先恢复所需的父目录；逐项操作保留历史。</p>{folderRows(entries.filter(e => e.kind === 'folder' && e.deleted)).map(r => <button className="button small" key={r.entry.id} onClick={() => remove(r.entry)}><RotateCcw size={14}/>{r.path}</button>)}</section>}<NotesBrowser entries={entries} folders={folders} folder={folder} trash={trash} search={noteSearch} prefs={prefs} onPrefs={setPrefs} onOpen={(e: Entry) => e.kind === 'note' ? setNote(e) : setReadingFile(e)} onHistory={showHistory} onRemove={remove} onUploadVersion={(e: Entry) => { replaceFileRef.current = e.id; fileRef.current?.click(); }} onSave={save} tell={tell} onCreate={() => createNote()}/></div></div></>}
 {page === 'review' && <><div className="page-title"><div><div className="eyebrow">REFLECT & REVISIT</div><h1>回头看看，是为了走得更稳。</h1><p>只安排你选择的复习；没有反馈的题目保持未知。</p></div><button className="button primary" onClick={() => setModal('review')}><Plus size={16}/>安排复习</button></div><div className="two-columns"><section><div className="section-heading"><h2>我的复习安排</h2><Pill>{of('review').length}</Pill></div>{of('review').map(e => <div className="card review-card" key={e.id}><div><Pill tone={e.data.status === '完成' ? 'green' : ''}>{e.data.status}</Pill><span className="muted">{e.data.due}</span></div><h3>{e.data.title}</h3><p>{e.data.body}</p><div className="button-group"><button className="button small" onClick={() => save('review', { ...e.data, status: '完成', completedAt: e.data.completedAt || new Date().toISOString() }, e).catch((e: any) => tell(e.message))}><Check size={14}/>完成</button><button className="button small" onClick={() => save('review', { ...e.data, status: '暂缓' }, e).catch((e: any) => tell(e.message))}>暂缓</button><button className="icon-button" aria-label="删除复习安排" onClick={() => remove(e)}><Trash2 size={15}/></button></div></div>)}{!of('review').length && <Empty title="没有必须补做的任务" text="发现值得再看的片段时，再放进来。"/>}</section><section><div className="section-heading"><h2>卡点与反馈</h2><button className="text-button" onClick={() => setModal('feedback')}><Plus size={15}/>记录卡点</button></div>{of('feedback').map(e => <div className="card review-card" key={e.id}><div><Pill>{e.data.category}</Pill><span className="muted">{e.data.status}</span></div><h3>{e.data.title}</h3><p>{e.data.body}</p>{e.data.reply && <div className="reply"><strong>反馈</strong><p>{e.data.reply}</p></div>}<div className="button-group"><button className="button small" onClick={async () => {
                    const reply = await askSync('补充处理/反馈', '反馈内容', e.data.reply || '');
                    if (reply !== null)
                        save('feedback', { ...e.data, reply }, e).catch((e: any) => tell(e.message));
                }}>补充反馈</button><button className="button small" onClick={() => save('feedback', { ...e.data, status: e.data.status === '已解决' ? '待处理' : '已解决' }, e).catch((e: any) => tell(e.message))}>{e.data.status === '已解决' ? '重新打开' : '标为解决'}</button></div></div>)}{!of('feedback').length && <Empty title="卡住也可以留下线索" text="记录哪里不理解，不等于给自己贴上不会的标签。"/>}</section></div></>}
 {page === 'studio' && <StudyHub entries={entries} problems={problems} docs={docs} currentList={currentList} save={save} remove={remove} open={openEntity} tell={tell} owner={boot.user.id}/>}
 {page === 'records' && <><div className="page-title"><div><div className="eyebrow">YOUR LEARNING TRACE</div><h1>你的进步，有自己的轨迹。</h1><p>尝试、提交和更正是事实；掌握程度单独评估。</p></div><button className="button" onClick={() => download(JSON.stringify([...attempts, ...subs], null, 2), '练习记录.json', 'application/json')}><Download size={16}/>导出记录</button></div><div className="stats-strip"><div><span>实际尝试</span><strong>{attempts.length}</strong></div><div><span>提交记录</span><strong>{subs.length}</strong></div><div><span>记录过的题</span><strong>{totalPracticed}</strong></div><div><span>已写笔记</span><strong>{notes.length}</strong></div></div><CoveragePanel problems={problems} entries={entries} onTopic={(topic: string) => { go("problems"); setFilters({ ...filters, topic }); }}/><section className="card"><div className="section-heading"><h2>练习时间线</h2><span className="mini">帮助程度缺失时保留未知</span></div>{attempts.sort((a, b) => b.updated.localeCompare(a.updated)).map(a => {
                const p = problems.find((p: any) => p.id === a.data.problemId);
                return <div className="timeline-row" key={a.id}><div className="timeline-dot"/><div><span className="mini">{a.data.day} · {a.data.status}</span><button className="link-title" onClick={() => p && setProblem(p)}>{p?.title || a.data.problemId}</button><div className="button-group">{subs.filter(s => s.data.attemptId === a.id).map(s => <button key={s.id} className={'submission-badge ' + resultTone(s.data.result)} onClick={async () => {
                            const result = await askSync('纠正提交结果', '结果（' + results.join(' / ') + '，未改动可取消）', s.data.result);
                            if (result && results.includes(result))
                                save('submission', { ...s.data, result, correctionAt: new Date().toISOString() }, s).catch((e: any) => tell(e.message)); else if (result) tell('结果不在可选范围：' + results.join(' / ') + '，本次未保存');
                        }}>{resultMark(s.data.result)} {s.data.result} · {s.data.help}</button>)}</div>{a.data.reflection && <p>{a.data.reflection}</p>}</div><button className="icon-button" aria-label="查看记录修订" onClick={() => showHistory(a)}><History size={17}/></button></div>;
            })}{!attempts.length && <Empty title="还没有实际练习记录" text="题库已经准备好。开始一道题，再记下真实过程。" action={() => go('today')} actionLabel="去今日训练"/>}</section></>}
 </main><footer className="page-footer"><span>AlgoNotes <i />专注思考，认真积累。</span><span><Cloud size={12}/>私有云空间 <i /> v1.4</span></footer></div>
 {modal==='transfers'&&<TransferCenter entries={entries} initialFolder={folder==='__inbox'?'':folder} upload={upload} save={save} tell={tell} close={()=>setModal('')}/>}
 {readingFile&&<FileReader owner={boot.user.id} key={readingFile.id} prefs={prefs} onPrefs={setPrefs} save={save} remove={remove} tell={tell} entry={readingFile} entries={entries} problems={problems} close={closeReading} createNote={createNote} openNote={setNote}/>}
 <input ref={attachFileInput} hidden type="file" multiple onChange={e => handleFiles(e.target.files)}/><input ref={importRef} hidden type="file" accept=".md,.txt,.json" onChange={e => inspectImport(e.target.files)}/><input ref={restoreRef} hidden type="file" accept=".zip" multiple onChange={async (e) => {
            try {
                const selected=Array.from(e.target.files??[]);setBusy(true);setRestore(await previewStreamRestore(selected,tell)||await previewRestore(selected));
                setModal('restore');
            }
            catch (e: any) {
                tell(e.message);
            }finally{setBusy(false);e.target.value='';}
        }}/>
 {problem && <ProblemPanel key={problem.id} owner={boot.user.id} p={problem} state={state(problem.id)} attempts={attempts.filter(e => e.data.problemId === problem.id)} submissions={subs} notes={notes.filter(n => noteProblemIds(n.data).includes(problem.id))} files={files.filter(n => n.data.problemId === problem.id)} close={() => setProblem(null)} save={save} updateState={(patch: any) => updateState(problem.id, patch)} start={(force = false) => start(problem, force)} createNote={() => createNote(problem.id)} openNote={setNote} upload={() => { replaceFileRef.current = ''; fileRef.current?.click(); }} tell={tell} history={showHistory} review={() => { setModal('review'); }} onEditCustom={editCustom} onRemoveCustom={removeCustom}/>}
 {note && <NoteEditor key={note.id} entry={note} entries={entries} referenceOptions={entityOptions(problems,docs,entries)} openEntity={openEntity} remove={remove} owner={boot.user.id} problems={problems} folders={folders} files={files} save={save} close={() => setNote(null)} tell={tell} upload={upload} showHistory={() => showHistory(note)} onSaved={setNote} openFile={setReadingFile}/>}
 {doc && <DocumentReader owner={boot.user.id} key={doc.id} doc={doc} entries={entries} notes={notes} prefs={prefs} onPrefs={setPrefs} close={closeReading} createNote={createNote} openNote={setNote} save={save} remove={remove} tell={tell}/>}
 {modal === 'marks' && <Modal title="我的阅读标记" close={()=>setModal('')} wide><MarkCenter entries={entries} onOpen={openMark} remove={remove} tell={tell}/></Modal>}
 {modal === 'settings' && <Modal title="设置与数据" close={() => setModal('')}><div className="settings-list"><div><ShieldCheck /><section><h3>私人空间</h3><p>当前身份：{boot.user.email}。数据按账号隔离，附件下载同样鉴权。</p></section></div><div><HardDrive /><section><h3>备份与恢复</h3><p>完整备份包含云端记录、历史、回收站与附件字节。需下载全部分包；新备份按4MiB附件块和小批元数据分包处理，最多1000包；保留旧版恢复兼容。</p><div className="button-group"><button className="button" onClick={() => setModal('backup')}><HardDrive size={15}/>管理备份与清理</button><button className="button primary" disabled={busy} onClick={exportAll}><Download size={15}/>{busy ? '正在校验…' : '生成完整备份'}</button><button className="button" onClick={() => restoreRef.current?.click()}><Upload size={15}/>从备份恢复</button></div></section></div><div><HardDrive/><StoragePanel owner={boot.user.id} tell={tell}/></div><div><RefreshCw /><section><h3>教练内容维护</h3><p>已提供受限内容工具：预检、应用更新和状态回读。不能修改你的私人笔记和作答记录。每日任务的真实定时接入状态见更新日志。</p><button className="button" onClick={() => setModal('updates')}>查看更新日志</button></section></div><div><CheckCircle2 /><section><h3>数据通路自检</h3><p>在独立测试空间检查保存、并发、重复写入与原件校验，不修改你的记录。</p><button className="button" disabled={busy} onClick={async () => {
                setBusy(true);
                try {
                    const r = await fetch('/api/coach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify_workbench', arguments: {} }) });
                    const x: any = await r.json();
                    if (!r.ok)
                        throw new Error(x.error);
                    setDiagnostic(x);
                    tell(x.passed ? '数据通路检查通过' : '有检查未通过，请查看结果');
                }
                catch (e: any) {
                    tell(e.message);
                }
                finally {
                    setBusy(false);
                }
            }}>运行隔离自检</button>{diagnostic && <div className="diagnostic-results">{diagnostic.checks.map((c: any, i: number) => <p key={i}>{c.passed ? '✓' : '!'} {c.name}{c.detail ? '：' + c.detail : ''}</p>)}</div>}</section></div><div><BookOpen /><section><h3>当前使用边界</h3><p>外站评测；不运行提交代码。搜索题名、正文、笔记及新上传文本/代码内容；不做图片/PDF文字识别。离线编辑保留本机草稿，重新联网后显式保存。</p></section></div><div><Moon /><section><h3>界面偏好</h3><button className="button" onClick={() => setModal("workspace")}>侧边栏、字号与密度</button><button className="button" onClick={() => setDark(!dark)}>{dark ? '切换浅色' : '切换深色'}</button></section></div><a className="text-button" href="/signout-with-chatgpt?return_to=%2F" target="_top">退出登录</a></div></Modal>}
 {modal === 'updates' && <Modal title="内容更新日志" close={() => setModal('')}><p className="muted">当前目录：{lists.length}份日单、{problems.length}道题、{docs.filter((d:any)=>d.kind==='STL专题').length}个STL模块。推送写入回执不代表已读或已做。</p>{changes.filter((e: Entry) => e.kind === 'update').map((e: Entry) => <div className="card list-card" key={e.id}><CheckCircle2 /><div><strong>{e.data.batchId}</strong><p>{e.data.status} · {e.data.completed}项 · {e.data.at}</p></div></div>)}{!changes.some((e: Entry) => e.kind === 'update') && <p>尚无通过工具应用的更新批次。</p>}</Modal>}
 {modal==='command'&&<CommandPalette index={index} close={()=>setModal('')} open={openSearch} commands={[...nav.map(([id,label])=>({label:'打开 '+label,run:()=>go(id)})),{label:'新建笔记',run:()=>createNote()},{label:'上传文件或课程文件夹',run:()=>setModal('transfers')},{label:'管理备份',run:()=>setModal('backup')},{label:'自定义侧边栏',run:()=>setModal('workspace')}]}/>}
 {modal === 'workspace'  && <WorkspaceSettings value={prefs} nav={nav} onSave={savePrefs} close={() => setModal('')}/>}
 {modal === 'folder' && <FolderDialog entry={folderEditing} parent={folderStart} folders={folders} entries={entries} save={save} remove={(e: Entry) => save(e.kind, e.data, e, e.id, { deleted: true })} close={() => setModal('')} tell={tell} onSelected={selectFolder}/>}
 {modal === 'history' && <Modal title="历史版本与更正" close={() => setModal('')} wide>{history.map((e, i) => <div className="revision" key={i}><div><strong>{e.id.startsWith('archive:') ? '恢复的历史' : '版本'} {e.version}</strong><span>{e.updated}</span><button className="button small" onClick={async () => {
                    const current = entries.find(x => x.id === e.id);
                    if (!current)
                        return tell('归档历史可查阅，请复制为新笔记');
                    try {
                        await save(e.kind, e.data, current, e.id, { restore: true });
                        setModal('');
                        tell('已恢复为新版本，原历史保留');
                    }
                    catch (e: any) {
                        tell(e.message);
                    }
                }}>恢复为新版本</button></div>{history[i+1]&&<TextDiff before={history[i+1].data.body||history[i+1].data.code||JSON.stringify(history[i+1].data,null,2)} after={e.data.body||e.data.code||JSON.stringify(e.data,null,2)}/>}<pre>{e.kind === 'note' ? e.data.body : JSON.stringify(e.data, null, 2)}</pre></div>)}</Modal>}
 {modal === 'import' && imports && <Modal title="导入预览" close={() => setModal('')}><p>来源：{imports.name}</p><p>{imports.type === 'markdown' ? '将创建一篇独立可编辑笔记。原文件保持不变。' : `已预检${imports.entries.length}条记录；创建独立副本，重复导入同一数据跳过已有项。`}</p><pre className="import-preview">{imports.body?.slice(0, 1500) || JSON.stringify(imports.entries.slice(0, 3), null, 2)}</pre><button className="button primary" disabled={busy} onClick={applyImport}>确认导入</button></Modal>}
 {modal === 'backup' && <BackupManager close={() => setModal('')} create={exportAll} creating={busy} restoreCloud={async(b:any)=>{setBusy(true);try{setRestore(await previewCloudBackup(b,tell));setModal('restore');}catch(e:any){tell(e.message);}finally{setBusy(false);}}} restore={() => restoreRef.current?.click()} tell={tell}/>}
 {modal === 'restore' && restore && <Modal title="恢复预览" close={() => setModal('')}><p>快照：{restore.manifest.createdAt}</p><p>{restore.version===2?restore.manifest.entries:restore.manifest.entries.length}条记录，{restore.version===2?restore.manifest.revisions:restore.manifest.revisions.length}条历史；所有附件字节校验通过。</p><div className="callout">恢复到当前账号的独立副本，不覆盖现有记录。重复恢复同一个快照不翻倍。历史版本作为可查阅归档保留。</div><button className="button primary" disabled={busy} onClick={restoreBackup}>{busy ? '正在恢复…' : '确认恢复'}</button></Modal>}
 {['review', 'feedback'].includes(modal) && <QuickForm key={modal} mode={modal} problem={problem} close={() => setModal('')} submit={async (data: any) => { await save(modal as Kind, data); setModal(''); tell('已保存'); }} tell={tell}/>}
 {modal === 'custom' && <Modal title="添加自定义题目" close={() => setModal('')} wide><div className="form-grid">{[['code', '题号'], ['title', '完整题名'], ['url', '评测链接'], ['difficulty', '官方难度（无则未评级）'], ['topic', '知识点 / 专题']].map(([key, title]) => <label key={key}>{title}<input data-autofocus={key === 'code' ? '' : undefined} value={custom[key]} onChange={e => setCustom({ ...custom, [key]: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') customSaveRef.current?.click(); }}/></label>)}</div><label>题面 / 个人摘要（Markdown）<textarea rows={8} value={custom.body} onChange={e => setCustom({ ...custom, body: e.target.value })}/></label><button className="button primary" ref={customSaveRef} onClick={async () => {
                if (!custom.title.trim() || !custom.code.trim())
                    return tell('请填写题号和题名');
                try {
                    await (async () => {
                        const r = await postRecord({ id: customId || 'custom-' + uid(), kind: 'problem', data: { ...custom, type: '自定义', role: '自选题', tags: [custom.topic], position: 0, date: localDay() }, baseVersion: customBase, operationId: uid() });
                        const x: any = r.out;
                        if (!r.ok) { if (r.status === 409 && x?.current) setConflict({ local: { id: customId || 'custom-' + uid(), kind: 'problem', data: { ...custom, type: '自定义', role: '自选题', tags: [custom.topic], position: 0, date: localDay() }, baseVersion: customBase }, current: x.current }); throw new Error(x.error); }
                        acceptEntries([x]);
                    })();
                    setModal('');
                    tell(customId ? '自定义题目已更新' : '题目已加入私人题库');
                }
                catch (e: any) {
                    tell(e.message);
                }
            }}>保存题目</button></Modal>}
 {conflict && <Modal title="云端已有更新，你的内容仍在" close={() => setConflict(null)} wide><p>没有覆盖云端版本。请比较并决定：保留草稿、另存笔记，或重新打开云端版。</p><div className="two-columns"><div><h3>我的修改</h3><pre>{JSON.stringify(conflict.local.data, null, 2)}</pre></div><div><h3>云端当前版</h3><pre>{JSON.stringify(conflict.current?.data, null, 2)}</pre></div></div><div className="button-group"><button className="button primary" onClick={() => { createNote('', conflict.local.data.body || JSON.stringify(conflict.local.data, null, 2), '冲突保留副本'); setConflict(null); }}>另存为笔记</button><button className="button" onClick={async () => { await reload(); setNote(null); setConflict(null); }}>读取云端版</button></div></Modal>}
 {askBox && <AskBox box={askBox} close={() => setAskBox(null)} />} {toast && <div className="toast" role="status"><span className="live-dot"/>{toast}<button aria-label="关闭消息" onClick={() => setToast('')}><X size={14}/></button></div>}{busy && <div className="busy-indicator" role="status"><RefreshCw size={14}/>正在处理，请保留当前页面</div>}
 </div>;
}
function QuickForm({ mode, problem, close, submit, tell }: any) {
    const [title, setTitle] = useState(problem?.title || ''), [body, setBody] = useState(''), [due, setDue] = useState(localDay()), [category, setCategory] = useState('实现'), [busy, setBusy] = useState(false);
    const review = mode === 'review'; const saveRef = useRef<HTMLButtonElement>(null);
    return <Modal title={review ? '安排一次有价值的复习' : '记录卡点与反馈'} close={close}><label>标题<input data-autofocus value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !busy) saveRef.current?.click(); }} placeholder="题目 / 知识点 / 问题"/></label>{review ? <label>计划日期<input type="date" value={due} onChange={e => setDue(e.target.value)}/></label> : <label>问题分类<Select label="问题分类" value={category} options={['题意', '模型', '算法', '数据结构', '实现', '边界', '调试', '时间管理', '其他']} onChange={setCategory}/></label>}<label>{review ? '回顾什么' : '现象、已有尝试、希望获得的帮助'}<textarea rows={6} value={body} onChange={e => setBody(e.target.value)} placeholder={review ? '只写最值得再看的部分，不必重做整题。' : '可以直接描述，也可以在笔记中附代码和文件。'}/></label><button className="button primary" disabled={busy} ref={saveRef} onClick={async () => {
            if (!title.trim())
                return tell('请写一个标题');
            setBusy(true);
            try {
                await submit({ title, body, due, category, status: review ? '待做' : '待处理', problemId: problem?.id || '' });
            }
            catch (e: any) {
                tell(e.message);
            }
            finally {
                setBusy(false);
            }
        }}>保存</button></Modal>;
}
