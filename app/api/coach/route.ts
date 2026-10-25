import { env } from 'cloudflare:workers';
import {applyContentBatch,coachAccessBoundary} from '../../../lib/content-batch';
import {uploadContentFile} from '../../../lib/content-files';
import seed from '../../../lib/catalog';
import {diagnostics} from '../../../lib/diagnostics';
import {getEntry,allEntries,mutate,json,failure,checkOrigin,hash} from '../../../lib/server';
import {validateEntry} from '../../../lib/domain';
import {mergedContent,validateDelivery} from '../../../lib/content-delivery';
const allowed=['problem','list','document','knowledge'];
export async function runCoach(action:string,args:any){
 if(action==='upload_markdown_resource'){if(typeof args.text!=='string'||new TextEncoder().encode(args.text).length>500000)throw new Error('Markdown原件上限500000字节');return uploadContentFile(new File([args.text],args.name||'资料.md',{type:'text/markdown'}),args.id,args.baseVersion??0,args.operationId);}
 if(action==='verify_workbench')return diagnostics();
 if(action==='read_training_state'){const entries=await allEntries('__content__'),current=mergedContent(seed,entries);return {scope:'仅共享训练内容；私人笔记与作答记录不开放',entries,catalog:{lists:current.lists,problems:current.problems.map((p:any)=>({id:p.id,title:p.title,url:p.url,baseVersion:p.baseVersion})),stlModules:current.docs.filter((d:any)=>d.kind==='STL专题').length,documents:current.docs.map((d:any)=>({id:d.id,title:d.title,kind:d.kind,baseVersion:d.baseVersion}))},rules:{timezone:'Asia/Shanghai',dailyPool:7,contests:['蓝桥杯','PAT','CSP','百度之星'],unrecorded:'未知'}};}
 if(action==='get_update_status')return getEntry('__content__','batch-'+args.batchId);
 if(!['preview_content_update','apply_content_update'].includes(action))throw new Error('未知工具');
 if(!Array.isArray(args.items)||!args.items.length||args.items.length>80||!args.batchId||!/^[a-zA-Z0-9_.:-]{1,100}$/.test(args.batchId))throw new Error('更新包格式错误');
 for(const e of args.items){validateEntry(e);if(!allowed.includes(e.kind))throw new Error('该工具不能修改私人记录');}
 if(new TextEncoder().encode(JSON.stringify(args.items)).length>4*1024*1024)throw new Error('单批内容上限4MiB，请按独立日单拆分');
 const digest=await hash(JSON.stringify(args.items));const batch=await getEntry('__content__','batch-'+args.batchId);if(batch){if(batch.data.hash!==digest)throw new Error('批次ID已用于不同内容');return action==='preview_content_update'?{batchId:args.batchId,alreadyApplied:true,canApply:true,receipt:batch.data}:batch.data;}
 validateDelivery(args.items,mergedContent(seed,await allEntries('__content__')));
 const preview=[];for(const e of args.items){const old=await getEntry('__content__',e.id);preview.push({id:e.id,action:old?'修改':'新增',expected:e.baseVersion??0,current:old?.version??0,conflict:(old?.version??0)!==(e.baseVersion??0)});}
 if(action==='preview_content_update')return {batchId:args.batchId,items:preview,canApply:!preview.some(e=>e.conflict)};
 return applyContentBatch(args.batchId,args.items,digest);
}
export async function POST(r:Request){try{coachAccessBoundary(r,(env as any).COACH_TOKEN);checkOrigin(r);const x:any=await r.json();return json(await runCoach(x.action,x.arguments));}catch(e){return failure(e);}}
export async function GET(r:Request){try{coachAccessBoundary(r,(env as any).COACH_TOKEN);return json({writer:'ready',scope:'private-site training-content only',tools:['read_training_state','preview_content_update','apply_content_update','get_update_status']});}catch(e){return failure(e);}}
