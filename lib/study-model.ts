import type {Entry} from './domain';
import {attemptDays} from './domain';
const localDay=(d=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const normalized=(s:any)=>String(s??'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
export const studyKinds=['mistake','relation','taxonomy','snippet','simulation'] as const;
export const errorStates=['待定位','已定位','已修正','待验证','验证通过','暂缓'];
export const relationTypes=['相关','前置','解释','反例','应用','引用'];
export const targetTypes=['problem','note','file','document','knowledge','taxonomy','snippet','mistake'];
export type Ref={id:string;type:string;title?:string;version?:number};
const ref=(x:any)=>x&&targetTypes.includes(x.type)&&typeof x.id==='string'&&/^[a-zA-Z0-9_.:-]{1,180}$/.test(x.id);
export function validateStudy(kind:string,d:any){
 if(!studyKinds.includes(kind as any))return;
 if(typeof d.title!=='string'||!d.title.trim()||d.title.length>250)throw new Error('请填写1—250字符的标题');
 if(kind==='mistake'&&(!errorStates.includes(d.status)||typeof d.problemId!=='string'))throw new Error('错题状态或关联题号无效');
 if(kind==='relation'&&(!ref(d.from)||!ref(d.to)||d.from.id===d.to.id&&d.from.type===d.to.type||!relationTypes.includes(d.relation)))throw new Error('关联端点或关系类型无效');
 if(kind==='taxonomy'&&(!['知识点','题目类型','自定义'].includes(d.category)||d.parentId&&typeof d.parentId!=='string'||!Array.isArray(d.aliases)||d.aliases.length>30))throw new Error('分类格式无效');
 if(kind==='snippet'&&(!['C++11','C++14','C++17','C++20','C++23'].includes(d.standard)||typeof d.code!=='string'||d.code.length>150000))throw new Error('模板语言版本或代码无效');
 if(kind==='simulation'&&(!['准备','进行中','暂停','结束'].includes(d.status)||!Array.isArray(d.problemIds)||!d.problemIds.length||d.problemIds.length>20||new Set(d.problemIds).size!==d.problemIds.length||!Number.isFinite(d.duration)||d.duration<1||d.duration>600))throw new Error('限时训练需要1—20道不同题目、1—600分钟');
}
export function compareOutput(expected:string,actual:string,mode='exact'){
 const clean=(s:string)=>mode==='tokens'?s.trim().split(/\s+/).filter(Boolean).join(' '):mode==='lines'?s.replace(/\r\n?/g,'\n').split('\n').map(l=>l.trimEnd()).join('\n').replace(/\n+$/,''):s;
 const a=clean(expected),b=clean(actual);let at=0;while(at<Math.min(a.length,b.length)&&a[at]===b[at])at++;
 return {equal:a===b,index:at,line:a.slice(0,at).split('\n').length,column:at-(a.slice(0,at).lastIndexOf('\n')+1)+1,expected:a.slice(at,at+30),actual:b.slice(at,at+30)};
}
export function textDiff(before:string,after:string){
 const a=before.split('\n'),b=after.split('\n');let start=0;while(start<Math.min(a.length,b.length)&&a[start]===b[start])start++;let end=0;while(end<a.length-start&&end<b.length-start&&a[a.length-1-end]===b[b.length-1-end])end++;
 return {start:start+1,removed:a.slice(start,a.length-end),added:b.slice(start,b.length-end),unchanged:start+end,equal:before===after};
}
export function studyStats(entries:Entry[],from:string,to:string){
 const rows=entries.filter(e=>!e.deleted);
 const inRange=(e:Entry)=>{if(e.kind==='submission')return localDay(new Date(e.data.at||e.updated))>=from&&localDay(new Date(e.data.at||e.updated))<=to;return attemptDays(e.data).some(d=>d>=from&&d<=to);};
 const attempts=rows.filter(e=>e.kind==='attempt'&&inRange(e));const submissions=rows.filter(e=>e.kind==='submission'&&inRange(e));
 const daily=new Map<string,{day:string;attempts:number;minutes:number;unknownTime:number}>();
 for(const e of attempts){const days=attemptDays(e.data);for(let i=0;i<days.length;i++){const row=daily.get(days[i])||{day:days[i],attempts:0,minutes:0,unknownTime:0};row.attempts++;if(i===0){if(e.data.minutes!==''&&e.data.minutes!=null&&Number.isFinite(Number(e.data.minutes))&&Number(e.data.minutes)>=0)row.minutes+=Number(e.data.minutes);else row.unknownTime++;}daily.set(days[i],row);}}
 const helps=new Map<string,number>();for(const s of submissions){const h=s.data.help||'未知';helps.set(h,(helps.get(h)||0)+1);}
 return {attempts,submissions,daily:[...daily.values()].sort((a,b)=>a.day.localeCompare(b.day)),helps:[...helps],uniqueProblems:new Set(attempts.map(a=>a.data.problemId)).size,independent:new Set(submissions.filter(s=>s.data.result==='AC'&&s.data.help==='独立').map(s=>s.data.problemId)).size,minutes:[...daily.values()].reduce((n,r)=>n+r.minutes,0),unknownTime:[...daily.values()].reduce((n,r)=>n+r.unknownTime,0)};
}
export function budgetPlan(problems:any[],entries:Entry[],pool:string[],budget:number,excluded:string[]=[]){
 const a=entries.filter(e=>!e.deleted),candidates=pool.map(id=>problems.find(p=>p.id===id)).filter(Boolean).filter(p=>!excluded.includes(p.id));
 const ranked=candidates.map((p,index)=>{const continuing=a.some(e=>e.kind==='attempt'&&e.data.problemId===p.id&&e.data.status==='进行中'),selected=a.some(e=>e.kind==='selection'&&e.data.problemId===p.id),seen=a.some(e=>e.kind==='attempt'&&e.data.problemId===p.id);return {problem:p,minutes:Math.max(10,Number(p.minutes)||30),score:continuing?0:selected?1:index===0?2:3,reason:continuing?'你明确开始过，可继续':selected?'你曾选入训练':'当前题池候选；用时采用题单估计',seen};}).sort((x,y)=>x.score-y.score);
 let remaining=Math.max(0,budget-10);const chosen=[];for(const c of ranked){if(c.minutes<=remaining&&chosen.length<3){chosen.push(c);remaining-=c.minutes;}}
 return {chosen,remaining,reserved:10,candidates:ranked};
}
export function linkedRefs(entries:Entry[],target:Ref){return entries.filter(e=>!e.deleted&&e.kind==='relation'&&([e.data.from,e.data.to].some(r=>r?.id===target.id&&r?.type===target.type)));}
export function sourcePack(items:{id:string;title:string;body:string;version?:number}[],question:string){
 return '# 资料问答包\n\n问题：'+question+'\n\n以下为我明确选定的来源；请依据来源回答，无法确认时说明未知。不要把阅读记为掌握。\n\n'+items.map(x=>'## '+x.title+'\n\n来源ID：'+x.id+'；版本：'+(x.version??'未记录')+'\n\n'+x.body).join('\n\n---\n\n');
}
export function studySearch(entries:Entry[],query:string){const terms=normalized(query).split(' ').filter(Boolean);return entries.filter(e=>!e.deleted&&studyKinds.includes(e.kind as any)&&terms.every(t=>normalized(JSON.stringify(e.data)).includes(t)));}
