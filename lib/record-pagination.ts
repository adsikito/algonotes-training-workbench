export type RecordCursor = { since: string; until: string; updated: string; id: string };
const iso = (s: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s) && Number.isFinite(Date.parse(s));
export function readRecordCursor(cursor: string | null, since: string | null, now = new Date().toISOString()): RecordCursor {
    if (cursor) {
        if(cursor.length>2000)throw new Error('分页游标过长');
        const c = JSON.parse(cursor);
        if(!c || typeof c.since!=='string' || c.since && !iso(c.since) || !iso(c.until) || !iso(c.updated) || typeof c.id!=='string' || c.id.length>180 || c.updated>c.until)throw new Error('分页游标无效');
        return {since:c.since,until:c.until,updated:c.updated,id:c.id};
    }
    if(since && !iso(since))throw new Error('同步时间无效');
    return {since:since || '',until:now,updated:'',id:''};
}
export function nextRecordCursor(c: RecordCursor, last: {updated:string;id:string}) { return JSON.stringify({...c,updated:last.updated,id:last.id}); }
