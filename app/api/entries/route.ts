import { actor, recordPage, json, failure } from '../../../lib/server';
export async function GET(r:Request) {
    try { const u=await actor(r),q=new URL(r.url).searchParams; return json(await recordPage(u.id,q.get('cursor'),q.get('since'))); }
    catch(e){return failure(e);}
}
