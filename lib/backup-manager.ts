import type { Entry } from './domain';

export const BACKUP_TTL = 7 * 24 * 60 * 60 * 1000;
export const EXPORT_LIMIT = 28 * 1024 * 1024;
export type BackupPart = { id: string; name: string; size: number; index: number; url: string };
export type BackupBundle = {
    id: string; title: string; createdAt: string; expiresAt: number; protected: boolean;
    error?: string;
    status: 'ready' | 'building' | 'deleting' | 'expired' | 'legacy';
    parts: BackupPart[]; expectedParts: number; size: number; legacy: boolean;
};

export function legacyBackupId(entry: Entry) {
    const match = /^backup-([a-zA-Z0-9-]+)-(?:manifest|part\d+)\.zip$/.exec(entry.data.name || '');
    return 'legacy:' + (match?.[1] || entry.id);
}

/** Group all volumes. Never expose a per-volume delete action. */
export function backupBundles(entries: Entry[], now = Date.now()): BackupBundle[] {
    const bundles = new Map<string, BackupBundle>();
    for (const e of entries.filter(e => e.kind === 'backup' && !e.deleted)) {
        const expiresAt = Number(e.data.expiresAt) || 0;
        bundles.set(e.id, { id: e.id, title: e.data.title || '完整备份', createdAt: e.data.createdAt || e.updated,
            expiresAt, protected: e.data.protected === true,
            status: e.data.status === 'deleting' ? 'deleting' : !e.data.protected && expiresAt <= now ? 'expired' : e.data.status === 'ready' ? 'ready' : 'building',
            error:e.data.error||'', expectedParts: e.data.expectedParts || 0, parts: [], size: 0, legacy: false });
    }
    for (const e of entries.filter(e => e.kind === 'export' && !e.deleted)) {
        const id = e.data.backupId || legacyBackupId(e);
        let group = bundles.get(id);
        if (!group && e.data.backupId) continue;
        if (!group) {
            group = { id, title: '旧版备份 · ' + new Date(e.updated).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }), createdAt: e.updated,
                expiresAt: Number(e.data.expiresAt) || 0, protected: false, status: 'legacy', parts: [], expectedParts: 0, size: 0, legacy: true };
            bundles.set(id, group);
        }
        group.parts.push({ id: e.id, name: e.data.name, size: Number(e.data.size) || 0, index: e.data.partIndex ?? (/manifest\.zip$/.test(e.data.name) ? 0 : 1), url: '/api/exports?id=' + encodeURIComponent(e.id) });
        group.size += Number(e.data.size) || 0;
        if (group.legacy) {
            group.expiresAt = Math.min(group.expiresAt, Number(e.data.expiresAt) || 0);
            group.createdAt = group.createdAt < e.updated ? group.createdAt : e.updated;
            group.status = group.expiresAt <= now ? 'expired' : 'legacy';
        }
    }
    return [...bundles.values()].map(b => ({ ...b, parts: b.parts.sort((a, z) => a.index - z.index || a.name.localeCompare(z.name)), expectedParts: b.legacy ? b.parts.length : b.expectedParts })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export type BackupStore = {
    list(): Promise<Entry[]>;
    get(id: string): Promise<Entry | null>;
    save(old: Entry, data: any, deleted?: boolean): Promise<Entry>;
    deleteObject(key: string): Promise<void>;
};
export type DeleteReceipt = { id: string; ok: boolean; removedParts: number; removedBytes: number; error?: string };

/** Owner-scoped store + namespace guard; deleting is durable and safely retryable. */
export async function deleteBackup(store: BackupStore, owner: string, id: string): Promise<DeleteReceipt> {
    let removedParts = 0, removedBytes = 0;
    try {
        const all = await store.list();
        let parent = all.find(e => e.id === id && e.kind === 'backup');
        if (parent?.deleted) return { id, ok: true, removedParts, removedBytes };
        const legacy = id.startsWith('legacy:');
        if (!legacy && !parent) throw new Error('备份不存在或不属于当前账号');
        if (parent?.data.protected) throw new Error('此备份已保护，请先解除保护再删除');
        const belongs = (e: Entry) => e.kind === 'export' && !e.deleted && (legacy ? !e.data.backupId && legacyBackupId(e) === id : e.data.backupId === id);
        let parts = all.filter(belongs);
        if (parts.some(e => typeof e.data.key !== 'string' || !e.data.key.startsWith(owner + '/exports/'))) throw new Error('备份存储路径异常，未执行删除');
        if (parent && parent.data.status !== 'deleting') parent = await store.save(parent, { ...parent.data, status: 'deleting' });
        // A part may have committed between the first list and the parent CAS.
        // Re-read after closing uploads; their transactional parent guard now rejects new parts.
        if (parent) parts = (await store.list()).filter(belongs);
        if (parts.some(e => typeof e.data.key !== 'string' || !e.data.key.startsWith(owner + '/exports/'))) throw new Error('备份存储路径异常，未执行删除');
        for (const part of parts) {
            await store.deleteObject(part.data.key);
            await store.save(part, { ...part.data, purgedAt: new Date().toISOString() }, true);
            removedParts++; removedBytes += Number(part.data.size) || 0;
        }
        if (parent) await store.save(parent, { ...parent.data, status: 'deleted', purgedAt: new Date().toISOString() }, true);
        return { id, ok: true, removedParts, removedBytes };
    } catch (e: any) { return { id, ok: false, removedParts, removedBytes, error: e.message || '清理失败，可重试' }; }
}

export function requireCompleteBackup(parent: Entry, parts: Entry[]) {
    if (parent.deleted || parent.data.status === 'deleting') throw new Error('备份已删除或正在清理');
    const expected = parent.data.expectedParts;
    if (!Number.isInteger(expected) || expected < 1 || expected > 1000) throw new Error('分包数量无效');
    const active = parts.filter(p => p.kind === 'export' && !p.deleted && p.data.backupId === parent.id);
    if (active.length !== expected || new Set(active.map(p => p.data.partIndex)).size !== expected || active.some(p => !Number.isInteger(p.data.partIndex) || p.data.partIndex < 0 || p.data.partIndex >= expected)) throw new Error('备份尚不完整，请重新生成完整备份；本次残留可单独清理');
}
