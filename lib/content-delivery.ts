import type { Entry } from './domain';
export function mergedContent(seed: any, entries: Entry[]) {
    const group = (key:string,kinds:string[]) => {
        const changes=entries.filter(e=>kinds.includes(e.kind));
        return [...(seed[key]??[]).filter((x:any)=>!changes.some(e=>e.id===x.id)).map((x:any)=>({...x,baseVersion:0})), ...changes.filter(e=>!e.deleted).map(e=>({...e.data,id:e.id,baseVersion:e.version}))];
    };
    return { problems:group('problems',['problem']),lists:group('lists',['list']).sort((a:any,b:any)=>a.date.localeCompare(b.date)),docs:group('docs',['document','knowledge']) };
}
export function validateDelivery(items: any[], current: any) {
    const prospective=mergedContent(current,items.map(e=>({...e,version:e.baseVersion+1,deleted:false})) as Entry[]);
    const ids=new Set(prospective.problems.map((p:any)=>p.id));
    const seen=new Set<string>();
    for (const item of items) {
        if(seen.has(item.id)) throw new Error('一个更新包不能重复包含同一ID'); seen.add(item.id);
        if(item.kind==='list') {
            if(!/^\d{4}-\d{2}-\d{2}$/.test(item.data.date)||!Array.isArray(item.data.items)||item.data.items.length!==7||new Set(item.data.items).size!==7) throw new Error('每日题单须为7个不同题号的可选池');
            if(item.data.items.some((id:string)=>!ids.has(id))) throw new Error('题单引用了不存在的题目，请与题目一同更新');
        }
    }
}
