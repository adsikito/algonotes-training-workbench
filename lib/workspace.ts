import type { Entry } from './domain';
export const pageIds = ['today', 'problems', 'knowledge', 'notes', 'review', 'records', 'studio'] as const;
export type Preferences = {
    order: string[];
    hidden: string[];
    pinnedFolders: string[];
    pinnedNotes: string[];
    sidebarWidth: number;
    density: 'comfortable' | 'compact';
    fontSize: number;
    noteView: 'cards' | 'list' | 'reader';
    includeChildren: boolean;
    dismissed: string[];
    showFolderTree: boolean;
    readerWidth: number;
    readerLineHeight: number;
};
export const defaults: Preferences = { order: [...pageIds], hidden: [], pinnedFolders: [], pinnedNotes: [], sidebarWidth: 232, density: 'comfortable', fontSize: 16, noteView: 'list', includeChildren: true, dismissed: [], showFolderTree: true, readerWidth:800, readerLineHeight:1.85 };
export function createId(source: Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>> = crypto) { return typeof source.randomUUID === 'function' ? source.randomUUID() : Array.from(source.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2, '0')).join(''); }
export function preferences(value: any = {}): Preferences {
    const strings = (x: any) => Array.isArray(x) ? [...new Set(x.filter((s: any) => typeof s === 'string'))] as string[] : [];
    const order = [...strings(value.order).filter(s => (pageIds as readonly string[]).includes(s)), ...pageIds].filter((s, i, a) => a.indexOf(s) === i);
    return { ...defaults, showFolderTree:value.showFolderTree!==false, readerWidth:[680,800,960].includes(Number(value.readerWidth))?Number(value.readerWidth):800, readerLineHeight:[1.65,1.85,2.05].includes(Number(value.readerLineHeight))?Number(value.readerLineHeight):1.85, order, hidden: strings(value.hidden).filter(s => s !== 'today' && (pageIds as readonly string[]).includes(s)), pinnedFolders: strings(value.pinnedFolders).slice(0, 30), pinnedNotes: strings(value.pinnedNotes).slice(0, 30), sidebarWidth: Math.min(320, Math.max(200, Number(value.sidebarWidth) || 232)), density: value.density === 'compact' ? 'compact' : 'comfortable', fontSize: Math.min(22, Math.max(14, Number(value.fontSize) || 16)), noteView: ['cards', 'list', 'reader'].includes(value.noteView) ? value.noteView : 'list', includeChildren: value.includeChildren !== false, dismissed: strings(value.dismissed).slice(-200) };
}
export function folderIndex(folders: Entry[]) {
    const byId=new Map(folders.map(f=>[f.id,f]));
    const children=new Map<string,Entry[]>();
    for(const f of folders){const parent=byId.has(f.data.parentId)?f.data.parentId:'';const a=children.get(parent)||[];a.push(f);children.set(parent,a);}
    for(const a of children.values())a.sort((a,b)=>(a.data.order??0)-(b.data.order??0)||String(a.data.title).localeCompare(String(b.data.title),'zh-CN'));
    return {byId,children};
}
export function descendantIds(folders:Entry[],id:string):Set<string>{
    const {children}=folderIndex(folders), result=new Set<string>(), queue=[id];
    for(let i=0;i<queue.length;i++){const next=queue[i];if(result.has(next))continue;result.add(next);for(const c of children.get(next)||[])queue.push(c.id);}
    return result;
}
export function folderRows(folders:Entry[]){
    const {children}=folderIndex(folders),seen=new Set<string>(),result:{entry:Entry;depth:number;path:string}[]=[];
    const visit=(root:Entry)=>{const stack=[{entry:root,depth:0,path:String(root.data.title)}];while(stack.length){const row=stack.pop()!;if(seen.has(row.entry.id))continue;seen.add(row.entry.id);result.push(row);const kids=children.get(row.entry.id)||[];for(let i=kids.length-1;i>=0;i--)stack.push({entry:kids[i],depth:row.depth+1,path:row.path+' / '+kids[i].data.title});}};
    for(const f of children.get('')||[])visit(f);for(const f of folders)if(!seen.has(f.id))visit(f);
    return result;
}
export function matchesQuery(text:string,query:string){return normalized(query).split(' ').filter(Boolean).every(t=>normalized(text).includes(t));}
/** 摘要/搜索片段用的 Markdown 纯文本化：链接取文字、去代码围栏标记、去强调符号 */
export function plainText(s:any){
    return String(s??'')
        .replace(/```[a-zA-Z0-9+#.-]*\n?/g,'').replace(/```/g,'')
        .replace(/`([^`\n]+)`/g,'$1')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g,'$1')
        .replace(/^#{1,6}\s+/gm,'')
        .replace(/^>\s?/gm,'')
        .replace(/[*_~]{1,3}([^*_~\n]+)[*_~]{1,3}/g,'$1');
}
export function searchSnippet(body:string,query:string){
    const terms=normalized(query).split(' ').filter(Boolean),lines=String(body||'').split('\n');
    let at=lines.findIndex(line=>terms.some(t=>normalized(line).includes(t)));if(at<0)at=0;
    const full=plainText(lines[at]||''),needle=terms.map(t=>normalized(full).indexOf(t)).filter(n=>n>=0).sort((a,b)=>a-b)[0]??0;
    const start=Math.max(0,needle-40);return {line:at+1,text:(start?'…':'')+full.slice(start,start+180)+(full.length>start+180?'…':'')};
}
/** UI 树状态（文件夹折叠等）的 localStorage 读写；读取时过滤非法值 */
export function loadIdSet(storageKey:string):string[]{try{const v=JSON.parse(localStorage.getItem(storageKey)||'[]');return Array.isArray(v)?v.filter((x:any)=>typeof x==='string'):([] as string[]);}catch{return[];}}
export function saveIdSet(storageKey:string,ids:Iterable<string>){try{localStorage.setItem(storageKey,JSON.stringify([...ids]));}catch{}}
export function noteProblemIds(data: any): string[] { return [...new Set([data.problemId, ...(Array.isArray(data.problemIds) ? data.problemIds : [])].filter((id: any) => typeof id === 'string' && id))] as string[]; }
export const normalized = (s: any) => String(s ?? '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
export type SearchItem = {
    id: string;
    kind: string;
    title: string;
    body: string;
    code?: string;
    source: any;
    text: string;
};
export function searchIndex(problems: any[], docs: any[], entries: Entry[]): SearchItem[] {
    const data: Omit<SearchItem, 'text'>[] = [...problems.map(p => ({ id: p.id, kind: '题目', title: p.title, body: p.body ?? '', code: p.code, source: p })), ...docs.map(d => ({ id: d.id, kind: d.kind === 'STL专题' ? 'STL' : '讲义', title: d.title, body: d.body ?? '', source: d })), ...entries.filter(e => !e.deleted && ['note', 'file', 'knowledge', 'feedback', 'bookmark','mistake','snippet','taxonomy'].includes(e.kind)).map(e => ({ id: e.id, kind: ({ note: '笔记', file: '文件', knowledge: '个人知识', feedback: '卡点', bookmark:'标记',mistake:'错题',snippet:'代码模板',taxonomy:'分类' } as any)[e.kind], title: e.data.title ?? e.data.name ?? '未命名', body: [e.data.relativePath,e.data.body, e.data.reply, e.data.comment, e.data.location?.quote, ...(e.data.tags ?? [])].filter(Boolean).join(' '), source: e }))];
    return data.map(d => ({ ...d, text: normalized([d.code, d.title, d.body, d.source.topic, d.source.knowledge].join(' ')) }));
}
export function searchItems(items: SearchItem[], query: string) { const q = normalized(query); if (!q)
    return []; const terms = q.split(' '); return items.filter(i => terms.every(t => i.text.includes(t))).map(item => ({ item, score: normalized(item.code) === q ? 0 : normalized(item.title) === q ? 1 : normalized(item.title).includes(q) ? 2 : 3 })).sort((a, b) => a.score - b.score || a.item.title.localeCompare(b.item.title, 'zh-CN')).map(r => r.item); }
export function elapsedSeconds(base: number, started: number | null, now: number) { return Math.max(0, base) + (started === null ? 0 : Math.max(0, Math.floor((now - started) / 1000))); }
/** 外链统一出口：仅允许 http(s)；返回 null 表示已打开，否则返回给用户的提示文案 */
export function openExternal(url: string): string | null {
    if (!/^https?:\/\//.test(url || ''))
        return '该内容没有可打开的原站链接';
    const w = window.open(url, '_blank', 'noopener');
    return w ? null : '浏览器拦截了新窗口，请长按/复制链接打开：' + url;
}
export function sameOutput(expected: string, actual: string) { return expected === actual; }
export function fileMetadataChangeAllowed(before: any, after: any) { const clean = (x: any) => Object.fromEntries(Object.entries(x).filter(([k]) => !['folderId', 'title', 'tags', 'problemId', 'problemIds', 'parentId', 'archived', 'favorite'].includes(k))); return JSON.stringify(clean(before)) === JSON.stringify(clean(after)); }
export function learningSuggestions(problems: any[], entries: Entry[], day: string, listIds: string[] = []) {
    const active = entries.filter(e => !e.deleted), out: {
        problem: any;
        reason: string;
    }[] = [];
    const used = new Set<string>();
    const add = (id: string, reason: string) => { const problem = problems.find(p => p.id === id); if (problem && !used.has(id)) {
        out.push({ problem, reason });
        used.add(id);
    } };
    active.filter(e => e.kind === 'attempt' && e.data.status === '进行中').sort((a, b) => b.updated.localeCompare(a.updated)).forEach(e => add(e.data.problemId, '有你明确开始的尝试，可继续；不代表未通过'));
    active.filter(e => e.kind === 'selection' && e.data.day === day).forEach(e => { if (!active.some(a => a.kind === 'submission' && a.data.problemId === e.data.problemId && a.data.result === 'AC'))
        add(e.data.problemId, '你已选入当天训练；是否完成仍以记录为准'); });
    listIds.forEach(id => { if (!active.some(e => e.kind === 'attempt' && e.data.problemId === id))
        add(id, '当天训练池候选，尚无练习记录；可自由跳过'); });
    return out.slice(0, 3);
}
