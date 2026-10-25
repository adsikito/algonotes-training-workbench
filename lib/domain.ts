import {validateStudy} from './study-model.ts';
export const kinds=['preference','note','folder','attempt','submission','state','review','feedback','view','knowledge','selection','file','problem','list','document','update','export','backup','bookmark','mistake','relation','taxonomy','snippet','simulation','reading-state'] as const;
export type Kind=typeof kinds[number];
export type Entry={id:string;kind:Kind;data:any;version:number;deleted:boolean;updated:string};
export const progress=['未记录','未开始','进行中','卡住','暂缓','已完成'];
export const mastery=['未评估','仍不理解','理解但写不稳','可独立实现','可迁移应用'];
export const results=['未知','未提交','AC','WA','TLE','MLE','RE','CE','部分通过'];
export const help=['未知','独立','实现提示','思路提示','题解','完整代码'];
export const tools=['未知','独立使用','查API','通用示例','操作帮助'];
export function localDay(d=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
/** 归日统一口径：一次尝试在其活跃日（activityDays，缺省回退开始日）各计一次；总尝试数仍按记录行数 */
export function attemptDays(data:any):string[]{const raw:string[]=Array.isArray(data?.activityDays)&&data.activityDays.length?data.activityDays:[data?.day].filter(Boolean);return [...new Set(raw.filter((d):d is string=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)))];}
export function independentAC(attempts:Entry[],submissions:Entry[],problemId:string){return submissions.some(s=>!s.deleted&&s.data.problemId===problemId&&s.data.result==='AC'&&s.data.help==='独立');}
/** 提交结果的形状线索（规则15：状态不只靠颜色区分） */
export function resultMark(r:string){return r==='AC'?'✓':r==='WA'?'✕':['TLE','MLE','RE','CE','部分通过'].includes(r)?'!':'·';}
export function resultTone(r:string){return r==='AC'?'ac':r==='WA'?'wa':'';}
export function safePath(p:string){return !p.startsWith('/')&&!p.includes('\\')&&!p.split('/').some(x=>x==='..'||x==='');}
export function validateEntry(e:any){
 if(!e||typeof e.id!=='string'||!/^[a-zA-Z0-9_.:-]{1,180}$/.test(e.id)||!kinds.includes(e.kind)||typeof e.data!=='object'||e.data===null||Array.isArray(e.data))throw new Error('记录格式不正确');
 if(new TextEncoder().encode(JSON.stringify(e.data)).length>550000)throw new Error('单条记录超过550000字节限制');
 if(e.kind==='preference'&&(!Array.isArray(e.data.order)))throw new Error('布局偏好格式无效');
 if(e.kind==='state'&&(!progress.includes(e.data.progress)||!mastery.includes(e.data.mastery)))throw new Error('进度或掌握状态无效');
 if(e.kind==='submission'&&(!results.includes(e.data.result)||!help.includes(e.data.help)))throw new Error('结果或帮助程度无效');
 if(e.kind==='folder'&&(typeof e.data.title!=='string'||!e.data.title.trim()||e.data.title.length>250))throw new Error('文件夹名称须为1—250字符');
 if(e.kind==='note'&&(typeof e.data.body!=='string'||typeof e.data.title!=='string'))throw new Error('笔记正文或标题缺失');
 validateStudy(e.kind,e.data);
 return e;
}
export function escapeCSV(s:any){const text=String(s??'');return '"'+(/^[\s]*[=+\-@]/.test(text)?"'":'')+text.replaceAll('"','""')+'"';}
