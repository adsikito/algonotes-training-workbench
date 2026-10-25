import assert from 'node:assert/strict';
import { backupBundles, deleteBackup, requireCompleteBackup, type BackupStore } from '../lib/backup-manager.ts';
import type {Entry} from '../lib/domain.ts';
const entry = (id:string,kind:Entry['kind'],data:any):Entry=>({id,kind,data,version:1,deleted:false,updated:'2026-10-24T01:00:00Z'});
const parent=entry('set1','backup',{expectedParts:2,status:'ready',expiresAt:1000,title:'课程备份'});
const p1=entry('p1','export',{backupId:'set1',key:'u/exports/p1',name:'m.zip',partIndex:0,size:4});
const p2=entry('p2','export',{backupId:'set1',key:'u/exports/p2',name:'p.zip',partIndex:1,size:8});
const original=entry('f1','file',{key:'u/f1/hash',size:123});
const note=entry('n1','note',{title:'笔记',body:'不应被改动'});
function fake(rows:Entry[],fail='') {
    const data=new Map(rows.map(e=>[e.id,structuredClone(e)])), deletedKeys:string[]=[];
    let failKey=fail;
    const store:BackupStore={list:async()=>[...data.values()],get:async id=>data.get(id)||null,
        save:async(old,body,deleted=false)=>{const cur=data.get(old.id);if(cur?.version!==old.version)throw new Error('version conflict');const e={...old,data:body,deleted,version:old.version+1};data.set(e.id,e);return e;},
        deleteObject:async key=>{if(key===failKey)throw new Error('temporary storage failure');deletedKeys.push(key);}};
    return {store,data,deletedKeys,recover:()=>{failKey='';}};
}
const grouped=backupBundles([parent,p1,p2],2000);assert.equal(grouped.length,1);assert.equal(grouped[0].status,'expired');assert.equal(grouped[0].size,12);
assert.equal(backupBundles([{...parent,data:{...parent.data,protected:true}},p1,p2],2000)[0].status,'ready');
requireCompleteBackup(parent,[p1,p2]);
assert.throws(()=>requireCompleteBackup(parent,[p1]),/不完整/);
assert.throws(()=>requireCompleteBackup(parent,[p1,{...p2,data:{...p2.data,partIndex:0}}]),/不完整/);
const safe=fake([parent,p1,p2,original,note]);
assert.equal((await deleteBackup(safe.store,'u','set1')).ok,true);
assert.deepEqual(safe.deletedKeys,['u/exports/p1','u/exports/p2']);
assert.deepEqual(safe.data.get('f1'),original);assert.deepEqual(safe.data.get('n1'),note);
assert.equal(backupBundles([...safe.data.values()]).length,0);
assert.equal((await deleteBackup(safe.store,'u','set1')).removedParts,0);
const protectedSet=fake([{...parent,data:{...parent.data,protected:true}},p1,p2]);
assert.equal((await deleteBackup(protectedSet.store,'u','set1')).ok,false);assert.equal(protectedSet.deletedKeys.length,0);
const invalid=fake([parent,p1,{...p2,data:{...p2.data,key:'other/exports/p2'}}]);
assert.equal((await deleteBackup(invalid.store,'u','set1')).ok,false);assert.equal(invalid.deletedKeys.length,0);
const originalPath=fake([parent,p1,{...p2,data:{...p2.data,key:'u/f1/hash'}}]);
assert.equal((await deleteBackup(originalPath.store,'u','set1')).ok,false);assert.equal(originalPath.deletedKeys.length,0);
const interrupted=fake([parent,p1,p2],'u/exports/p2');
const first=await deleteBackup(interrupted.store,'u','set1');assert.equal(first.ok,false);assert.equal(first.removedParts,1);assert.equal(interrupted.data.get('set1')?.data.status,'deleting');
interrupted.recover();const retry=await deleteBackup(interrupted.store,'u','set1');assert.equal(retry.ok,true);assert.equal(retry.removedParts,1);
assert.equal((await deleteBackup(interrupted.store,'u','missing')).ok,false);
const legacy1=entry('old1','export',{key:'u/exports/old1',name:'backup-abc-123-manifest.zip',size:2,expiresAt:3000});
const legacy2=entry('old2','export',{key:'u/exports/old2',name:'backup-abc-123-part1.zip',size:3,expiresAt:3000});
const legacy=fake([legacy1,legacy2,original]);const oldGroups=backupBundles([...legacy.data.values()],1000);assert.equal(oldGroups.length,1);assert.equal(oldGroups[0].status,'legacy');
assert.equal((await deleteBackup(legacy.store,'u',oldGroups[0].id)).removedParts,2);assert.deepEqual(legacy.data.get('f1'),original);
console.log('backup manager: grouping, partial sets, namespace protection, user isolation, protected sets, idempotent deletion, partial retry, original preservation, legacy compatibility passed');

// A concurrent upload committed after the initial list must also be deleted.
const race=fake([parent,p1]);
const normalSave=race.store.save;
race.store.save=async(old,body,deleted=false)=>{if(old.kind==='backup'&&body.status==='deleting')race.data.set(p2.id,structuredClone(p2));return normalSave(old,body,deleted);};
assert.equal((await deleteBackup(race.store,'u','set1')).removedParts,2);
assert.deepEqual(race.deletedKeys,['u/exports/p1','u/exports/p2']);
console.log('concurrent part commit before deletion CAS is included in cleanup');
