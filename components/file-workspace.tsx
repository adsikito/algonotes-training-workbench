'use client';
import {FileDownload} from './file-download';
import {ReadingPosition} from './reading-position';
import {useEffect,useRef,useState,useMemo} from 'react';
import {ReadingArticle,ReadingMarks,ReadingSettings} from './reading-tools';
import {locateQuote,type ReadingLocation} from '../lib/reading';
import {Upload,FolderPlus,Download,RefreshCw,FileText,Check,AlertCircle,Pause,Search,ChevronRight,ChevronLeft} from 'lucide-react';
import {Modal,Markdown,Pill} from './workspace-ui';
import {fileCapability,checkBatch,relativePath,FILE_LIMIT} from '../lib/file-policy';
import {expandCourseZip} from '../lib/course-archive';
import {createId,folderRows,noteProblemIds,normalized} from '../lib/workspace';
import type {Entry} from '../lib/domain';
import {fileHash} from '../lib/upload-client';
import {MULTIPART_LIMIT} from '../lib/upload-policy';
type Transfer={id:string;file:File;path:string;status:'待上传'|'上传中'|'已保存'|'失败'|'已存在';message?:string;included:boolean;directory?:boolean};
export function TransferCenter({entries,initialFolder,upload,save,tell,close}:any){
    const [queue,setQueue]=useState<Transfer[]>([]),[target,setTarget]=useState(initialFolder||''),[running,setRunning]=useState(false),[reading,setReading]=useState(false),[summary,setSummary]=useState(''),[limit,setLimit]=useState(30);
    const files=useRef<HTMLInputElement>(null),directory=useRef<HTMLInputElement>(null),zip=useRef<HTMLInputElement>(null),cancelled=useRef(false),live=useRef(entries),batch=useRef(createId());live.current=entries;
    const folders=entries.filter((e:Entry)=>e.kind==='folder'&&!e.deleted);
    const patch=(id:string,change:Partial<Transfer>)=>setQueue(q=>q.map(t=>t.id===id?{...t,...change}:t));
    async function choose(list:FileList|null,archive=false){if(!list?.length)return;setReading(true);try{
        let incoming:{file:File;path:string;directory?:boolean}[]=[];
        if(archive)incoming=await expandCourseZip(list[0]);else incoming=Array.from(list).map(file=>({file,path:relativePath(file.webkitRelativePath||file.name)}));
        const keep=queue.filter(t=>t.status!=='已保存'&&t.status!=='已存在');
        const planned=[...keep.map(t=>({path:t.path,size:t.file.size})),...incoming.map(t=>({path:t.path,size:t.file.size}))];if(planned.length>200||planned.reduce((n,f)=>n+f.size,0)>1024*1024*1024||planned.some(f=>f.size>MULTIPART_LIMIT))throw new Error('单批最多200项/1GiB，单文件256MiB');
        const all=new Set(keep.map(t=>t.path));
        if(incoming.some(t=>{if(all.has(t.path))return true;all.add(t.path);return false;}))throw new Error('本批有同名路径，请分批导入，避免无意覆盖');
        setQueue([...keep,...incoming.map(t=>({...t,id:createId(),status:'待上传' as const,included:true}))]);setSummary('先检查目录与格式，再点击开始；不会自动运行文件。');
    }catch(e:any){tell(e.message);}finally{setReading(false);if(files.current)files.current.value='';if(directory.current)directory.current.value='';if(zip.current)zip.current.value='';}}
    async function run(){setRunning(true);cancelled.current=false;let count=0,failed=0,existing=0;const known=[...live.current];
        const ensureFolder=async(path:string)=>{let parent=target;for(const title of path.split('/').slice(0,-1)){
            let found=known.find((e:Entry)=>e.kind==='folder'&&!e.deleted&&e.data.title===title&&(e.data.parentId||'')===parent);
            if(!found){found=await save('folder',{title,parentId:parent});known.push(found);} parent=found.id;
        }return parent;};
        try{for(const item of queue.filter(t=>t.included&&['待上传','失败'].includes(t.status))){if(cancelled.current)break;patch(item.id,{status:'上传中',message:''});
            try{if(item.directory){await ensureFolder(item.path+'/__directory__');patch(item.id,{status:'已保存',message:'目录结构已创建（含空目录）'});count++;continue;}const folderId=await ensureFolder(item.path);
                const digest=await fileHash(item.file,n=>patch(item.id,{message:'计算校验 '+Math.round(n/Math.max(1,item.file.size)*100)+'%'}));
                const found=known.find((e:Entry)=>e.kind==='file'&&!e.deleted&&e.data.hash===digest&&e.data.name===item.file.name&&(e.data.folderId||'')===folderId);
                if(found){patch(item.id,{status:'已存在',message:'相同目录、文件名和内容，已跳过'});existing++;continue;}
                const previous=known.find((e:Entry)=>e.kind==='file'&&!e.deleted&&e.data.name===item.file.name&&(e.data.folderId||'')===folderId);
                const out=await upload(item.file,{id:item.id,folderId,relativePath:item.path,batchId:batch.current,hash:digest,onProgress:(n:number)=>patch(item.id,{message:'分块确认 '+Math.round(n/Math.max(1,item.file.size)*100)+'%'}),shouldPause:()=>cancelled.current,...(previous?{previousId:previous.id}:{})});known.push(out);
                patch(item.id,{status:'已保存',message:previous?'已保存为新版本，旧原件保留':'原件已确认'});count++;
            }catch(e:any){patch(item.id,{status:'失败',message:e.message});failed++;}
        }setSummary(`${count}项保存，${existing}项已存在，${failed}项失败${cancelled.current?'；已暂停，未处理项保留':''}`);tell('传输结果已更新，可仅重试失败和待上传项');}
        finally{setRunning(false);}
    }
    const done=queue.filter(t=>['已保存','已存在'].includes(t.status)).length;
    return <Modal title="上传与课程资料导入" close={()=>{if(running){tell('请先暂停；当前文件确认后可关闭');return;}close();}} wide><div className="transfer-intro"><Upload size={22}/><div><strong>原目录带进来，资料找得到</strong><p>PPT / PPTX / PDF / CPP 均可保存原件。分块上传单文件256MiB，单批200项 / 1GiB（账户总额度1GiB）；Office暂不在线转换。MD/TXT 在此入口会按附件保存；要生成可编辑笔记请用笔记页的「导入 Markdown / JSON」。</p></div></div>
        <div className="transfer-actions"><button className="button" disabled={running||reading} onClick={()=>files.current?.click()}><Upload size={15}/>选择文件</button><button className="button" disabled={running||reading} onClick={()=>directory.current?.click()}><FolderPlus size={15}/>选择文件夹</button><button className="button" disabled={running||reading} onClick={()=>zip.current?.click()}>展开课程ZIP</button><a className="text-button" href="/api/file-policy" target="_blank" rel="noreferrer">文件能力与限制</a></div>
        <label>保存到<select value={target} disabled={running} onChange={e=>setTarget(e.target.value)}><option value="">收件箱 / 顶层</option>{folderRows(folders).map(f=><option key={f.entry.id} value={f.entry.id}>{f.path}</option>)}</select></label>
        <div className="transfer-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!running)choose(e.dataTransfer.files);}}>{reading?'正在检查压缩包…':'也可把文件拖到这里；保留目录请用“选择文件夹”'}<small>先显示清单，不会静默忽略第11个文件。同名不同内容保留为新版本。</small></div>
        {!!queue.length&&<><div className="section-heading"><strong>{queue.length}项 · {(queue.reduce((n,t)=>n+t.file.size,0)/1024/1024).toFixed(2)}MiB</strong><span>{done}项完成</span></div><progress className="transfer-progress" max={queue.length} value={done} aria-label="已确认文件数"/><div className="transfer-list">{queue.slice(0,limit).map(t=><div key={t.id} className="transfer-row"><input type="checkbox" aria-label={'上传 '+t.path} checked={t.included} disabled={running||['已保存','已存在'].includes(t.status)} onChange={e=>patch(t.id,{included:e.target.checked})}/><div><strong>{t.path}</strong><small>{t.directory?'目录（保留结构）':fileCapability(t.file.name).preview} · {(t.file.size/1024).toFixed(1)}KiB</small>{t.message&&<p>{t.message}</p>}</div><Pill tone={t.status==='失败'?'amber':t.status==='已保存'?'green':''}>{t.status}</Pill></div>)}</div>{queue.length>limit&&<button className="text-button" onClick={()=>setLimit(n=>n+40)}>展开更多文件</button>}<div className="button-group"><button className="button primary" disabled={running||reading||!queue.some(t=>t.included&&['待上传','失败'].includes(t.status))} onClick={run}><Upload size={15}/>{queue.some(t=>t.status==='失败')?'重试失败与待上传项':'确认并开始上传'}</button>{running&&<button className="button" onClick={()=>{cancelled.current=true;setSummary('当前文件确认后暂停');}}><Pause size={15}/>暂停后续上传</button>}<button className="button" disabled={running} onClick={()=>{setQueue([]);setSummary('');batch.current=createId();}}>清空清单</button></div></>}
        <p className="transfer-summary" role="status" aria-live="polite">{summary}</p><p className="tiny">关闭后已保存原件留在云端；未完成文件重新选择同一原件可续传；展开ZIP仍限压缩20MiB、展开100MiB/200项。不会访问你未选择的本地目录。</p>
        <input ref={files} type="file" multiple hidden onChange={e=>choose(e.target.files)}/><input ref={directory} type="file" multiple hidden {...({webkitdirectory:'',directory:''} as any)} onChange={e=>choose(e.target.files)}/><input ref={zip} type="file" accept=".zip" hidden onChange={e=>choose(e.target.files,true)}/>
    </Modal>;
}
export function FileReader({entry,entries,close,createNote,openNote,prefs,onPrefs,save,remove,tell,owner}:any){
    const cap=fileCapability(entry.data.name),isMarkdown=/\.(md|markdown)$/i.test(entry.data.name);
    const [body,setBody]=useState(entry.data.body||''),[status,setStatus]=useState(''),[line,setLine]=useState('1'),[page,setPage]=useState('1'),[pdfPage,setPdfPage]=useState(1),[view,setView]=useState(isMarkdown?'formatted':'source'),[limit,setLimit]=useState(1000),[jumpTick,setJumpTick]=useState(0);
    const reading=useRef<HTMLDivElement>(null),jumpRef=useRef<ReadingLocation>(entry.readLocation||{});
    const url='/api/files?id='+encodeURIComponent(entry.id),notes=entries.filter((e:Entry)=>!e.deleted&&e.kind==='note'&&((e.data.fileIds??[]).includes(entry.id)||e.data.sourceFileId===entry.id||e.data.body?.includes(url)));
    const lines=useMemo(()=>body.split('\n'),[body]);
    useEffect(()=>{const controller=new AbortController();let active=true;
        if(cap.kind==='text'&&entry.data.size<=2*1024*1024){setStatus('正在读取完整原件…');fetch(url+'&preview=1',{signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error('原件读取失败');const bytes=await r.arrayBuffer();const {decodeSource}=await import('../lib/file-policy');return decodeSource(bytes).text;}).then(text=>{if(active){setBody(text);setStatus('完整原件文本已读取；代码不会被执行');}}).catch(e=>{if(active&&e.name!=='AbortError')setStatus(e.message);});}
        return()=>{active=false;controller.abort();};
    },[entry.id]);
    function jump(p:ReadingLocation){jumpRef.current=p;if(p.page){setPage(String(p.page));setPdfPage(p.page);}if(p.line){setLine(String(p.line));setView('source');setLimit(n=>Math.max(n,p.line!+100));}setJumpTick(n=>n+1);}
    useEffect(()=>{if(entry.readLocation)jump(entry.readLocation);},[entry.id]);
    useEffect(()=>{const p=jumpRef.current;if(!p.line&&!p.quote)return;const timer=requestAnimationFrame(()=>{if(p.quote&&view==='formatted'){const el=Array.from(reading.current?.querySelectorAll('p,li,pre,blockquote')||[]).find(n=>n.textContent?.includes(p.quote!));if(el){el.scrollIntoView({block:'center'});return;}}const n=p.quote?locateQuote(body,p.quote)||p.line:p.line;if(n){if(n>limit){setLimit(n+100);return;}reading.current?.querySelector('[data-source-line="'+n+'"]')?.scrollIntoView({block:'center'});}});return()=>cancelAnimationFrame(timer);},[body,jumpTick,limit,view]);
    const selection=()=>{const s=window.getSelection();return s?.anchorNode&&reading.current?.contains(s.anchorNode)?s.toString():'';};
    return <div className="reading-page" role="dialog" aria-modal="true" aria-label={entry.data.title||entry.data.name}>
        <header className="reading-topbar"><button className="text-button" autoFocus onClick={close}><ChevronLeft size={16}/>返回工作台</button><div className="reading-heading"><Pill>{cap.label}</Pill><h2>{entry.data.title||entry.data.name}</h2></div><div className="button-group"><FileDownload entry={entry}/><button className="button small primary" onClick={()=>createNote('',`# ${entry.data.name} · 阅读笔记\n\n来源：[${entry.data.name}](${url})\n定位：${cap.kind==='text'?'第'+line+'行':'第'+page+'页 / 幻灯片'}\n\n`,'阅读笔记 · '+entry.data.name,{sourceFileId:entry.id,fileIds:[entry.id],sourceVersion:entry.version})}>写关联笔记</button></div></header>
        <div className="reading-layout"><div className="reading-main">
        <p className="mini">{entry.data.relativePath||entry.data.name} · {(entry.data.size/1024).toFixed(1)}KiB · {entry.data.encoding||cap.preview}</p>
        {cap.kind==='text'?<><div className="reader-position">{isMarkdown&&<select aria-label="Markdown显示方式" value={view} onChange={e=>setView(e.target.value)}><option value="formatted">排版阅读</option><option value="source">原始文本</option></select>}<label>行号<input type="number" min="1" max={lines.length} value={line} onChange={e=>setLine(e.target.value)}/></label><button className="button small" onClick={()=>jump({line:Math.max(1,Math.min(lines.length,Number(line)||1))})}>定位到行</button><span className="mini">共{lines.length}行</span></div><p className="tiny" role="status">{status||(entry.data.indexTruncated?'搜索索引有截取；正在读取原件以供阅读':'可复制文本')}</p><div ref={reading}>{entry.data.size>2*1024*1024?<div className="callout">超过2MiB的文本暂不在浏览器中展开，可下载完整原件；已上传内容没有被截断。</div>:view==='formatted'?<ReadingArticle body={body}/>:<><div className="source-reader"><pre>{lines.slice(0,limit).map((text:string,i:number)=><span data-source-line={i+1} className="source-line" key={i}><span aria-hidden="true">{i+1}</span><code>{text||' '}</code></span>)}</pre></div>{lines.length>limit&&<div className="button-group"><p className="mini">当前展示前{limit}行 / 共{lines.length}行，原件保留完整。</p><button className="button small" onClick={()=>setLimit(n=>n+2000)}>再显示2000行</button></div>}</>}</div></>:cap.kind==='image'?<div ref={reading}><img className="file-image" alt={entry.data.name} src={url+'&preview=1'}/></div>:cap.kind==='pdf'?<><div className="reader-position"><label>PDF页码<input type="number" min="1" value={page} onChange={e=>setPage(e.target.value)}/></label><button className="button small" onClick={()=>jump({page:Math.max(1,Number(page)||1)})}>跳转并记录页码</button></div><p className="tiny">页码由你填写；浏览器内置阅读器翻页不会自动同步。设备不支持预览时可下载原件。</p><iframe className="pdf-reader" title={entry.data.name} src={url+'&preview=1#page='+pdfPage}/></>:<div className="callout">{cap.preview}。PPT/PPTX原件可以下载，暂不提供幻灯片在线转换。</div>}
        </div>
        <aside className="reading-rail"><ReadingPosition owner={owner} target={{id:entry.id,type:'file',title:entry.data.name,version:entry.version}} entries={entries} save={save} jump={jump} tell={tell} location={cap.kind==='text'?{line:Math.max(1,Number(line)||1)}:{page:Math.max(1,Number(page)||1)}}/><ReadingSettings prefs={prefs} onPrefs={onPrefs}/><ReadingMarks target={{id:entry.id,type:'file',title:entry.data.title||entry.data.name,version:entry.version}} location={cap.kind==='text'?{line:Math.max(1,Number(line)||1)}:{page:Math.max(1,Number(page)||1)}} entries={entries} save={save} remove={remove} onJump={jump} tell={tell} readSelection={cap.kind==='text'?selection:undefined}/>
        <section className="linked-notes-rail"><h3>引用这份资料的笔记 · {notes.length}</h3>{notes.map((n:Entry)=><button key={n.id} className="linked-note" onClick={()=>openNote(n)}><FileText size={16}/>{n.data.title || '未命名笔记'}<ChevronRight size={14}/></button>)}{!notes.length&&<p className="muted">“写关联笔记”保存后会统一出现在笔记中心和这里。</p>}</section></aside></div>
    </div>;
}
