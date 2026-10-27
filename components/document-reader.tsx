'use client';
import {ReadingPosition} from './reading-position';
import {useEffect,useRef,useState} from 'react';
import {Download,FileText,ChevronLeft,PanelRight} from 'lucide-react';
import {Pill} from './workspace-ui';
import {ReadingArticle,ReadingMarks,ReadingSettings,SelectionExcerpt,BackToTop} from './reading-tools';
import {download} from '../lib/backup-client';
import type {ReadingLocation} from '../lib/reading';
const RAIL_KEY='algonotes.ui.readingRail';
export function DocumentReader({doc,entries,notes,prefs,onPrefs,close,createNote,openNote,save,remove,tell,owner}:any){
    const article=useRef<HTMLDivElement>(null);
    const excerptRef=useRef<((text:string)=>void)|null>(null);
    // 专注形态（03 §6.12/§3.4 + 批3-2 决策：偏好记忆优先覆盖深链默认）：rail 初始读偏好（'0'=展开/'1'=收起），无偏好时深链(focus)默认收起、普通打开默认展开
    const [railOpen,setRailOpen]=useState(()=>{try{const v=localStorage.getItem(RAIL_KEY);if(v==='0')return true;if(v==='1')return false;}catch{}return !doc.focus;});
    const toggleRail=()=>setRailOpen(v=>{const next=!v;try{localStorage.setItem(RAIL_KEY,next?'0':'1');}catch{}return next;});
    const selection=()=>{const s=window.getSelection();return s?.anchorNode&&article.current?.contains(s.anchorNode)?s.toString():'';};
    function jump(p:ReadingLocation){if(!p.quote){article.current?.scrollIntoView({block:'start'});return;}const nodes=article.current?.querySelectorAll('p,pre,li,h1,h2,h3,h4,blockquote');const target=Array.from(nodes||[]).find(n=>n.textContent?.includes(p.quote!));if(target)target.scrollIntoView({block:'center',behavior:'smooth'});else tell('原文已变化或摘录跨段，请用文章搜索核对摘录');}
    useEffect(()=>{if(doc.readLocation)jump(doc.readLocation);},[doc.id]);
    // 决策⑪：页面级导航语义——不用 dialog 角色，改由 document.title 联动 + 返回钮 autoFocus + Esc（workbench 全局）承载
    useEffect(()=>{const prev=document.title;document.title=doc.title+' · AlgoNotes';return()=>{document.title=prev;};},[doc.title]);
    return <div className="reading-page" data-reading-title={doc.title}>
        <header className="reading-topbar"><button className="text-button" autoFocus onClick={close}><ChevronLeft size={16}/>返回工作台</button><div className="reading-heading"><Pill>{doc.kind}</Pill><h2>{doc.title}</h2></div><div className="button-group">{doc.focus&&<button className="button small" aria-pressed={!railOpen} onClick={toggleRail}><PanelRight size={14}/>{railOpen?'收起辅助栏':'辅助栏'}</button>}{doc.downloadId&&<a className="button small" href={'/api/coach-files?id='+doc.downloadId}><Download size={14}/>下载原件</a>}<button className="button small" onClick={()=>download(doc.body,doc.title+'.md','text/markdown')}><Download size={14}/>下载 MD</button><button className="button small" onClick={()=>createNote('',doc.body,doc.title+' · 我的笔记',{docIds:[doc.id]})}>复制到我的笔记</button><button className="button small primary" onClick={()=>createNote('',`# ${doc.title} · 我的理解\n\n来源：${doc.title}\n\n`,doc.title+' · 我的理解',{docIds:[doc.id]})}>写关联笔记</button></div></header>
        <div className={'reading-layout'+(railOpen?'':' rail-collapsed')}><div className="reading-main"><div className="document-body" ref={article}><ReadingArticle body={doc.body}/></div><SelectionExcerpt container={article} readSelection={selection} onExcerpt={text=>excerptRef.current?.(text)} tell={tell}/><BackToTop/></div>
        {railOpen&&<aside className="reading-rail"><ReadingPosition owner={owner} target={{id:doc.id,type:'document',title:doc.title,version:doc.baseVersion??doc.version??0}} entries={entries} save={save} jump={jump} tell={tell} location={{}}/>
        <ReadingMarks target={{id:doc.id,type:'document',title:doc.title,version:doc.baseVersion??doc.version??0}} location={{}} entries={entries} save={save} remove={remove} onJump={jump} tell={tell} readSelection={selection} excerptRef={excerptRef}/>
        <div className="document-evidence"><strong>我的使用证据</strong>{['读过讲义','短操作完成','正式题应用','延时独立应用'].map(v=>{const old=entries.find((e:any)=>!e.deleted&&e.kind==='knowledge'&&e.data.docId===doc.id&&e.data.evidence===v);return <button key={v} className={old?'active':''} onClick={async()=>{try{if(old){const ok=await remove(old);if(ok===false)return;tell('已取消这条使用证据，可重新记录');}else{await save('knowledge',{title:doc.title,docId:doc.id,evidence:v,at:new Date().toISOString(),status:'未评估'});tell('已记录实际证据，没有自动标为掌握');}}catch(e:any){tell(e.message);}}}>{v}</button>;})}</div>
        <section className="linked-notes-rail"><h3>关联笔记 · {notes.filter((n:any)=>(n.data.docIds??[]).includes(doc.id)).length}</h3>{notes.filter((n:any)=>(n.data.docIds??[]).includes(doc.id)).map((n:any)=><button className="linked-note" key={n.id} onClick={()=>openNote(n)}><FileText size={15}/>{n.data.title || '未命名笔记'}</button>)}{!notes.some((n:any)=>(n.data.docIds??[]).includes(doc.id))&&<p className="muted">“写关联笔记”保存后出现在这里。</p>}</section>
        <ReadingSettings prefs={prefs} onPrefs={onPrefs}/></aside>}</div>
    </div>;
}
