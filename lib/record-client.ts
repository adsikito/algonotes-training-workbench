import type {Entry} from './domain';
/** Retries reuse the complete command, including its operation ID. */
export async function postRecord(command:unknown,fetcher:typeof fetch=fetch){
    const body=JSON.stringify(command);
    for(let attempt=0;attempt<2;attempt++){
        try{const response=await fetcher('/api/record',{method:'POST',headers:{'Content-Type':'application/json'},body});
            if(response.status>=500&&attempt===0)continue;
            let out:any;try{out=await response.json();}catch{throw new Error('保存回执无法读取，请保留草稿后重试');}
            return {ok:response.ok,status:response.status,out};
        }catch(e){if(attempt===1)throw e;}
    }
    throw new Error('保存失败，草稿已保留');
}
/** A slow reload cannot replace a confirmed newer version. */
export function mergeEntries(current:Entry[],snapshot:Entry[]){
    const all=new Map(current.map(e=>[e.id,e]));
    for(const e of snapshot)if(!all.has(e.id)||all.get(e.id)!.version<=e.version)all.set(e.id,e);
    return [...all.values()];
}
