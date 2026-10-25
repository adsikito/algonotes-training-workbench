import type { Entry } from './domain';
export type ReadingTarget = { id:string; type:'file'|'document'; title:string; version?:number };
export type ReadingLocation = { line?:number; page?:number; quote?:string };
export const markKinds=['重点','疑问','待回顾','书签'] as const;
export function cleanLocation(value:any):ReadingLocation {
    const integer=(x:any)=>Math.min(1000000,Math.max(1,Math.floor(Number(x)||1)));
    return {...(value?.line?{line:integer(value.line)}:{}),...(value?.page?{page:integer(value.page)}:{}),...(value?.quote?{quote:String(value.quote).slice(0,2000)}:{})};
}
export function marksFor(entries:Entry[],target:ReadingTarget){return entries.filter(e=>!e.deleted&&e.kind==='bookmark'&&e.data.targetId===target.id&&e.data.targetType===target.type).sort((a,b)=>b.updated.localeCompare(a.updated));}
export function locateQuote(body:string,quote:string){const at=body.indexOf(quote);return at<0?null:body.slice(0,at).split('\n').length;}
