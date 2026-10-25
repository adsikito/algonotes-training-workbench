import {db} from './server';
let ready:Promise<any>|null=null;
/** Managed Vite preview reuses its DB; native deployments apply tracked Drizzle migrations. */
export async function ensurePreviewSchema(){if(!import.meta.env.DEV)return;if(!ready)ready=db().batch([
 db().prepare('CREATE TABLE IF NOT EXISTS transfers(owner TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,size INTEGER NOT NULL,state TEXT NOT NULL,expires INTEGER NOT NULL,upload_id TEXT NOT NULL,key TEXT NOT NULL,PRIMARY KEY(owner,id))'),
 db().prepare('CREATE INDEX IF NOT EXISTS transfer_expiry ON transfers(owner,expires)'),
 db().prepare('CREATE TABLE IF NOT EXISTS transfer_parts(owner TEXT NOT NULL,id TEXT NOT NULL,part INTEGER NOT NULL,etag TEXT NOT NULL,hash TEXT NOT NULL,size INTEGER NOT NULL,PRIMARY KEY(owner,id,part))'),
 db().prepare('CREATE TABLE IF NOT EXISTS snapshots(owner TEXT NOT NULL,id TEXT NOT NULL,created TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(owner,id))'),
 db().prepare('CREATE TABLE IF NOT EXISTS snapshot_rows(owner TEXT NOT NULL,snapshot TEXT NOT NULL,row INTEGER NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(owner,snapshot,row))')
 ]).catch(e=>{ready=null;throw e;});await ready;}
