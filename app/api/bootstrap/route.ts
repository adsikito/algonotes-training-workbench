import seed from '../../../lib/catalog';
import {actor,allEntries,recordPage,json,failure} from '../../../lib/server';
export async function GET(r:Request){try{const u=await actor(r),q=new URL(r.url).searchParams;const page=await recordPage(u.id,null,q.get('since'));return json({user:u,...(q.get('includeSeed')==='0'?{}:{seed}),...page,updates:await allEntries('__content__'),serverTime:page.until,version:'1.4.0'});}catch(e){return failure(e);}}
