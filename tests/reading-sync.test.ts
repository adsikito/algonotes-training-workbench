import assert from 'node:assert/strict';
import {byteRange,matchesETag} from '../lib/http-range.ts';
import {cleanLocation,marksFor,locateQuote} from '../lib/reading.ts';
import {readRecordCursor,nextRecordCursor} from '../lib/record-pagination.ts';
import {preferences,searchIndex,searchItems} from '../lib/workspace.ts';
assert.deepEqual(byteRange('bytes=0-9',100),{offset:0,length:10});
assert.deepEqual(byteRange('bytes=90-',100),{offset:90,length:10});
assert.deepEqual(byteRange('bytes=-12',100),{offset:88,length:12});
assert.deepEqual(byteRange('bytes=80-999',100),{offset:80,length:20});
assert.equal(byteRange('bytes=100-',100),'unsatisfiable');assert.equal(byteRange('bytes=-0',100),'unsatisfiable');assert.equal(byteRange('bytes=0-1',0),'unsatisfiable');assert.equal(byteRange('bytes=8-2',100),'unsatisfiable');
assert.equal(byteRange('bytes=0-2,5-6',100),null);assert.equal(byteRange('broken',100),null);
assert.equal(matchesETag('"old", W/"now"','"now"'),true);assert.equal(matchesETag('"old"','"now"'),false);
assert.deepEqual(cleanLocation({line:-8,page:2.9,quote:'x'.repeat(2500)}),{line:1,page:2,quote:'x'.repeat(2000)});
assert.equal(locateQuote('a\nb\nc','b'),2);assert.equal(locateQuote('a','missing'),null);
const mark:any={id:'mark',kind:'bookmark',deleted:false,version:1,updated:'now',data:{targetId:'file',targetType:'file',title:'课程',markKind:'疑问',comment:'边界',location:{quote:'pop'}}};
assert.equal(marksFor([mark,{...mark,id:'deleted',deleted:true}],{id:'file',type:'file',title:''}).length,1);
assert.equal(searchItems(searchIndex([],[],[mark]),'pop 边界')[0].kind,'标记');
assert.equal(preferences({readerWidth:99999,readerLineHeight:9}).readerWidth,800);
assert.equal(preferences({showFolderTree:false}).showFolderTree,false);
const now='2026-10-24T12:00:00.000Z',since='2026-10-24T11:00:00.000Z';
const first=readRecordCursor(null,since,now);const next=readRecordCursor(nextRecordCursor(first,{updated:since,id:'entry1'}),null);
assert.equal(next.since,since);assert.equal(next.until,now);assert.equal(next.id,'entry1');
assert.throws(()=>readRecordCursor('{broken',null));assert.throws(()=>readRecordCursor(null,'bad'));assert.throws(()=>readRecordCursor(JSON.stringify({...next,updated:'2027-01-01T00:00:00.000Z'}),null));
// More than 3000 records and equal-timestamp boundaries retain a stable (updated,id) cursor.
const rows=Array.from({length:3505},(_,i)=>({updated:since,id:String(i).padStart(5,'0')}));
let c=first,seen:string[]=[];while(true){const page=rows.filter(r=>r.updated>c.updated||r.updated===c.updated&&r.id>c.id).slice(0,250);if(!page.length)break;seen.push(...page.map(r=>r.id));c=readRecordCursor(nextRecordCursor(c,page.at(-1)!),null);}
assert.equal(new Set(seen).size,3505);assert.deepEqual(seen,rows.map(r=>r.id));
console.log('reading/sync: ranges, conditional tags, bookmark isolation/search, settings defaults, pagination >3000 and timestamp ties passed');
