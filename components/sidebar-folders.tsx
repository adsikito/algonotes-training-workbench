'use client';
import {useMemo,useState,useEffect,useRef} from 'react';
import {ChevronDown,ChevronRight,Folder,FolderPlus,Upload,Search} from 'lucide-react';
import {folderRows,loadIdSet,saveIdSet} from '../lib/workspace';
import type {Entry} from '../lib/domain';
export function SidebarFolders({folders,selected,onSelect,onCreate,onUpload}:{folders:Entry[];selected:string;onSelect:(id:string)=>void;onCreate:()=>void;onUpload:()=>void}){
    const [expanded,setExpanded]=useState(new Set<string>()),[query,setQuery]=useState('');
    const rows=useMemo(()=>folderRows(folders),[folders]);
    const restored=useRef(false);
    useEffect(()=>{if(restored.current||!folders.length)return;restored.current=true;setExpanded(new Set(loadIdSet('algonotes.ui.sidebarExpanded').filter(id=>folders.some(f=>f.id===id))));},[folders]);
    const byId=useMemo(()=>new Map(folders.map(f=>[f.id,f])),[folders]);
    const parents=useMemo(()=>new Set(folders.map(f=>f.data.parentId)),[folders]);
    const visible=rows.filter(r=>{if(query)return r.path.toLocaleLowerCase().includes(query.toLocaleLowerCase());let p=r.entry.data.parentId;const seen=new Set<string>();while(p&&!seen.has(p)){seen.add(p);if(!expanded.has(p))return false;p=byId.get(p)?.data.parentId;}return true;});
    return <section className="sidebar-folders"><header><span>资料文件夹</span><div><button aria-label="侧栏新建文件夹" title="新建顶层文件夹" onClick={onCreate}><FolderPlus size={16}/></button><button aria-label="上传课程文件夹" title="上传文件或文件夹" onClick={onUpload}><Upload size={16}/></button></div></header>{folders.length>5&&<label className="sidebar-folder-search"><Search size={13}/><input aria-label="搜索文件夹" placeholder="找文件夹…" value={query} onChange={e=>setQuery(e.target.value)}/></label>}<div className="sidebar-folder-list"><button className="sidebar-folder-all" onClick={()=>onSelect('')}>全部笔记与资料</button>{visible.map(({entry,depth,path})=><div key={entry.id} className={'sidebar-folder-row '+(selected===entry.id?'active':'')} style={{paddingLeft:query?0:Math.min(depth,6)*12}}><button className="folder-disclosure" disabled={!parents.has(entry.id)} aria-label={(expanded.has(entry.id)?'收起':'展开')+'目录 '+entry.data.title} aria-expanded={parents.has(entry.id)?expanded.has(entry.id):undefined} onClick={()=>setExpanded(s=>{const n=new Set(s);n.has(entry.id)?n.delete(entry.id):n.add(entry.id);saveIdSet('algonotes.ui.sidebarExpanded',n);return n;})}>{parents.has(entry.id)?expanded.has(entry.id)?<ChevronDown size={13}/>:<ChevronRight size={13}/>:<Folder size={13}/>}</button><button title={path} onClick={()=>onSelect(entry.id)}>{entry.data.title}</button></div>)}</div>{!folders.length&&<p>创建文件夹，或上传课程目录。子文件夹会一起显示在这里。</p>}{!!query&&!visible.length&&<p>没有匹配目录</p>}</section>;
}
