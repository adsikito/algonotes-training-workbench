// Shared generation/restore boundary: never offer a new backup the restore path rejects.
export const BACKUP_RECORD_LIMIT = 3000;
export const BACKUP_REVISION_LIMIT = 20000;
export function checkBackupRecords(pack: any) {
    if (pack?.schemaVersion !== 1 || !Array.isArray(pack.entries) || !Array.isArray(pack.revisions)) throw new Error('不支持的备份格式');
    if (pack.entries.length > BACKUP_RECORD_LIMIT || pack.revisions.length > BACKUP_REVISION_LIMIT) throw new Error('当前备份恢复支持3000条记录、20000条历史版本；本次未生成完整备份，请先下载重要原件');
}
