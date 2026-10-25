import {actor,checkOrigin,bucket,getEntry,json,failure} from '../../../lib/server';
import {uploadPersonalFile} from '../../../lib/personal-files';
import {byteRange,matchesETag} from '../../../lib/http-range';
import {FILE_LIMIT} from '../../../lib/file-policy';
export async function POST(r:Request){try{checkOrigin(r);const u=await actor(r);const length=Number(r.headers.get('content-length'));if(length>FILE_LIMIT+65536)throw Object.assign(new Error('单文件上限20MiB'),{status:413});return json(await uploadPersonalFile(u.id,await r.formData()));}catch(e){return failure(e);}}
async function read(r:Request,headOnly=false){try{
    const u=await actor(r),q=new URL(r.url).searchParams;
    const f=await getEntry(u.id,q.get('id')||'');
    if(!f||f.kind!=='file'||f.deleted&&q.get('backup')!=='1'||!f.data.key?.startsWith(u.id+'/'))throw Object.assign(new Error('文件不存在或已回收'),{status:404});
    const meta=await bucket().head(f.data.key);if(!meta)throw Object.assign(new Error('原件缺失，请联系维护'),{status:404});
    const preview=q.get('preview')==='1'&&['application/pdf','image/png','image/jpeg','image/webp','image/gif','text/plain'].includes(f.data.type);
    const headers=new Headers({'Content-Type':preview?f.data.type:'application/octet-stream','Content-Disposition':`${preview?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(f.data.name)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private,no-cache','Content-Security-Policy':"default-src 'none'; sandbox",'Accept-Ranges':'bytes','ETag':meta.httpEtag});
    // Authentication and ownership checks above run even on a conditional request.
    if(matchesETag(r.headers.get('if-none-match'),meta.httpEtag))return new Response(null,{status:304,headers});
    const ifRange=r.headers.get('if-range');const range=byteRange(!ifRange||ifRange===meta.httpEtag?r.headers.get('range'):null,meta.size);
    if(range==='unsatisfiable'){headers.set('Content-Range',`bytes */${meta.size}`);return new Response(null,{status:416,headers});}
    headers.set('Content-Length',String(range?.length??meta.size));
    if(range)headers.set('Content-Range',`bytes ${range.offset}-${range.offset+range.length-1}/${meta.size}`);
    if(headOnly)return new Response(null,{status:range?206:200,headers});
    const object=await bucket().get(f.data.key,range?{range}:undefined);if(!object)throw new Error('原件暂不可用，请重试');
    return new Response(object.body,{status:range?206:200,headers});
}catch(e){return failure(e);}}
export function GET(r:Request){return read(r);}
export function HEAD(r:Request){return read(r,true);}
