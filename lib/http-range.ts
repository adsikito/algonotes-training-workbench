/** One HTTP byte range. Multiple ranges fall back to a normal full response. */
export function byteRange(header:string|null,size:number):{offset:number;length:number}|null|'unsatisfiable'{
    if(!header||header.includes(','))return null;
    const m=/^bytes=(\d*)-(\d*)$/.exec(header.trim());if(!m||!m[1]&&!m[2])return null;
    if(size===0)return 'unsatisfiable';
    const start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));
    const end=m[1]?(m[2]?Math.min(Number(m[2]),size-1):size-1):size-1;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start||(!m[1]&&Number(m[2])===0))return 'unsatisfiable';
    return {offset:start,length:end-start+1};
}
export function matchesETag(header:string|null,etag:string){return !!header&&header.split(',').some(s=>s.trim()==='*'||s.trim().replace(/^W\//,'')===etag);}
