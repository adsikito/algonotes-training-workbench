#!/usr/bin/env node
/**
 * Exports the legacy D1 SQLite database to a JSON snapshot.
 *
 * The legacy database is opened **read-only** (`SQLITE_OPEN_READONLY` plus a
 * `PRAGMA query_only` guard) and is never modified. The snapshot lands outside
 * the repository because it contains personal data and must not be committed.
 *
 * Usage:
 *   node --experimental-sqlite scripts/export-legacy-snapshot.mjs
 *   node --experimental-sqlite scripts/export-legacy-snapshot.mjs --verify
 *
 * Options:
 *   --db <path>    Override the legacy database path.
 *   --out <path>   Override the snapshot output path.
 *   --verify       Re-read the snapshot and compare it row by row with the
 *                  database (id / kind / version / updated / owner).
 *
 * Exit codes: 0 success, 1 verification mismatch or unreadable database.
 */
import {DatabaseSync} from 'node:sqlite';
import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/** Repository root (this file lives in <root>/scripts). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Legacy Miniflare D1 database that the running v1 app writes to. */
const DEFAULT_DB = resolve(
  REPO_ROOT,
  '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite',
);

/**
 * Snapshot destination. Kept outside the repository (one level up, in
 * `_migration/`) on purpose: it is personal data and must never be committed.
 */
const DEFAULT_OUT = resolve(REPO_ROOT, '..', '_migration', 'legacy-snapshot-2026-10-28.json');

/** Owner value used by shared seed content, as opposed to a real user. */
const SHARED_OWNER = '__content__';

/**
 * Minimal argument parser for `--flag` and `--key value` forms.
 *
 * @param {string[]} argv Process arguments after the script name.
 * @return {{db: string, out: string, verify: boolean}} Parsed options.
 */
function parseArgs(argv) {
  const options = {db: DEFAULT_DB, out: DEFAULT_OUT, verify: false};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--verify') options.verify = true;
    else if (arg === '--db') options.db = resolve(argv[++index]);
    else if (arg === '--out') options.out = resolve(argv[++index]);
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

/**
 * Opens the legacy database strictly read-only.
 *
 * `readOnly: true` maps to SQLITE_OPEN_READONLY at the driver level; the
 * `query_only` pragma is a second, independent guard so an accidental write
 * statement fails loudly instead of touching the file.
 *
 * @param {string} path Database file path.
 * @return {DatabaseSync} Open read-only connection.
 */
function openReadOnly(path) {
  if (!existsSync(path)) throw new Error(`旧库不存在：${path}`);
  const db = new DatabaseSync(path, {readOnly: true});
  db.exec('PRAGMA query_only = ON');
  return db;
}

/**
 * Classifies an owner value as personal data or shared seed content.
 *
 * @param {string} owner Owner column value.
 * @return {'shared'|'personal'} Bucket name.
 */
function ownerBucket(owner) {
  return owner === SHARED_OWNER ? 'shared' : 'personal';
}

/**
 * Builds the snapshot object from the database.
 *
 * Payload text is parsed into `data` and kept verbatim alongside it. A row
 * whose payload is not valid JSON is **not dropped**: it keeps the raw text and
 * is flagged with `parseError: true`, so the migration can never silently lose
 * a record because of one bad character.
 *
 * @param {DatabaseSync} db Read-only connection.
 * @param {string} dbPath Database file path (for the size stat).
 * @return {object} Snapshot document.
 */
function buildSnapshot(db, dbPath) {
  const rows = db.prepare('SELECT owner, id, kind, payload, version, deleted, updated FROM records ORDER BY owner, id').all();

  const kinds = {};
  const owners = {shared: 0, personal: 0};
  let parseErrors = 0;
  const records = rows.map((row) => {
    const payloadText = String(row.payload);
    const payloadBytes = Buffer.byteLength(payloadText, 'utf8');
    kinds[row.kind] = (kinds[row.kind] ?? 0) + 1;
    owners[ownerBucket(row.owner)] += 1;

    /** @type {Record<string, unknown>} */
    const record = {
      owner: row.owner,
      id: row.id,
      kind: row.kind,
      version: row.version,
      deleted: row.deleted,
      updated: row.updated,
      payloadBytes,
    };

    try {
      record.data = JSON.parse(payloadText);
      record.payloadRaw = null;
    } catch (error) {
      // Keep the original text so the migration can inspect and repair it.
      record.data = null;
      record.payloadRaw = payloadText;
      record.parseError = true;
      record.parseErrorReason = error instanceof Error ? error.message : String(error);
      parseErrors += 1;
    }
    return record;
  });

  // Revisions and operations are summarised, not exported in full: the
  // migration gate only needs to know they exist and how they are shaped.
  const countOf = (table) => db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      database: dbPath,
      actualPath: db.location(),
      bytes: statSync(dbPath).size,
    },
    counts: {
      records: records.length,
      revisions: countOf('revisions'),
      operations: countOf('operations'),
      parseErrors,
    },
    distribution: {kinds, owners},
    revisionOwners: db.prepare('SELECT owner, COUNT(*) AS c FROM revisions GROUP BY owner ORDER BY owner').all(),
    operationOwners: db.prepare('SELECT owner, COUNT(*) AS c FROM operations GROUP BY owner ORDER BY owner').all(),
    // Distinct legacy record shape, for the field survey report.
    kindsSeen: Object.keys(kinds).sort(),
    records,
  };
}

/**
 * Prints the human-readable summary required by the migration plan.
 *
 * @param {object} snapshot Snapshot document.
 */
function printSummary(snapshot) {
  const {counts, distribution, records} = snapshot;
  console.log(`库文件      ${snapshot.source.actualPath ?? snapshot.source.database}`);
  console.log(`库大小      ${(snapshot.source.bytes / 1024).toFixed(1)} KB`);
  console.log(`records     ${counts.records}`);
  console.log(`revisions   ${counts.revisions}（仅计数）`);
  console.log(`operations  ${counts.operations}（仅计数）`);
  console.log(`解析失败    ${counts.parseErrors}`);
  console.log('');
  console.log(`按 owner：共享 __content__ ${distribution.owners.shared} 条 / 个人 ${distribution.owners.personal} 条`);
  console.log(`kind 种类   ${snapshot.kindsSeen.length}`);
  console.log('按 kind 计数：');
  for (const [kind, count] of Object.entries(distribution.kinds).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`  ${kind.padEnd(14)} ${count}`);
  }
  console.log('');
  console.log('payload 体积 top5（字节）：');
  for (const record of [...records].sort((a, b) => b.payloadBytes - a.payloadBytes).slice(0, 5)) {
    console.log(`  ${String(record.payloadBytes).padStart(8)}  ${record.kind.padEnd(12)} ${record.id}`);
  }
}

/**
 * Compares the snapshot against the live database row by row.
 *
 * @param {object} snapshot Previously written snapshot.
 * @param {DatabaseSync} db Read-only connection.
 * @return {number} Number of mismatches; 0 means the snapshot is faithful.
 */
function verifySnapshot(snapshot, db) {
  const rows = db.prepare('SELECT owner, id, kind, version, deleted, updated, payload FROM records ORDER BY owner, id').all();
  const key = (row) => `${row.owner}\u0000${row.id}`;
  const live = new Map(rows.map((row) => [key(row), row]));

  console.log(`库内 records  ${rows.length}`);
  console.log(`快照 records  ${snapshot.records.length}`);

  let same = 0;
  const mismatches = [];

  if (rows.length !== snapshot.records.length) {
    mismatches.push(`总数不一致：库 ${rows.length} / 快照 ${snapshot.records.length}`);
  }

  for (const record of snapshot.records) {
    const row = live.get(key(record));
    if (!row) {
      mismatches.push(`${record.owner}/${record.id}：快照有、库内无`);
      continue;
    }
    const diffs = [];
    if (row.kind !== record.kind) diffs.push(`kind ${row.kind}≠${record.kind}`);
    if (row.version !== record.version) diffs.push(`version ${row.version}≠${record.version}`);
    if (row.deleted !== record.deleted) diffs.push(`deleted ${row.deleted}≠${record.deleted}`);
    if (row.updated !== record.updated) diffs.push(`updated ${row.updated}≠${record.updated}`);
    // Payload length is a cheap extra guard: it catches truncation/corruption
    // that would not show up in the four metadata columns above.
    const liveBytes = Buffer.byteLength(String(row.payload), 'utf8');
    if (liveBytes !== record.payloadBytes) diffs.push(`payload ${liveBytes}B≠${record.payloadBytes}B`);

    if (diffs.length) mismatches.push(`${record.owner}/${record.id}：${diffs.join('；')}`);
    else same += 1;
    live.delete(key(record));
  }
  for (const leftover of live.values()) {
    mismatches.push(`${leftover.owner}/${leftover.id}：库内有、快照无`);
  }

  console.log('');
  console.log(`一致 ${same} 条 / 不一致 ${mismatches.length} 条`);
  for (const line of mismatches) console.log(`  ✖ ${line}`);
  return mismatches.length;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const db = openReadOnly(options.db);

  try {
    if (options.verify) {
      if (!existsSync(options.out)) throw new Error(`快照不存在，请先导出：${options.out}`);
      const snapshot = JSON.parse(readFileSync(options.out, 'utf8'));
      const mismatches = verifySnapshot(snapshot, db);
      return mismatches === 0 ? 0 : 1;
    }

    const snapshot = buildSnapshot(db, options.db);
    mkdirSync(dirname(options.out), {recursive: true});
    writeFileSync(options.out, JSON.stringify(snapshot, null, 2), 'utf8');
    printSummary(snapshot);
    console.log('');
    console.log(`已写入 ${options.out}`);
    return 0;
  } finally {
    db.close();
  }
}

process.exitCode = main();
