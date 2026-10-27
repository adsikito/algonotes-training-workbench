#!/usr/bin/env node
/**
 * 为真实数据里 0 条的 4 种 kind 构造测试数据，用来证明迁移器里那 4 条分支
 * **真的执行过**（不是"写了但从未跑到"）。
 *
 * 做法：复制已校验的旧库快照，追加 13 条 `__test_` 前缀记录，写成临时快照；
 * 然后用 `import-legacy.mjs --snapshot <临时快照>` 走**同一套映射代码**。
 * 这样验证的是真实代码路径，而不是另写一段验证逻辑自说自话。
 *
 * 用法：
 *   node v2/migrate/test-missing-kinds.mjs --make      # 生成临时快照
 *   node v2/migrate/test-missing-kinds.mjs --cleanup   # 删除所有 __test_ 数据并报告计数
 *
 * 注意：payload 字段严格照旧代码的真实形状构造（`lib/backup-manager.ts`、
 * `components/reading-position.tsx`、`components/study-hub.tsx`）。
 * 团队要求的两个边界在旧代码里**并不存在**，见报告：
 * - `export` 没有 `filters` 字段（它的真实语义是"备份分卷"，不是"带筛选的导出"）
 * - `reading-state` 没有 `progress` 字段（进度只能由 location/scroll 推断）
 */
import {DatabaseSync} from 'node:sqlite';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const SOURCE_SNAPSHOT = resolve(REPO_ROOT, '..', '_migration', 'legacy-snapshot-2026-10-28.json');
const TEST_SNAPSHOT = resolve(REPO_ROOT, '..', '_migration', 'test-snapshot-missing-kinds.json');
const DEFAULT_DB = resolve(REPO_ROOT, 'v2', 'data', 'algonotes.sqlite');

/** 所有构造数据的 id 前缀，删除时按它识别。 */
const PREFIX = '__test_';

/** 固定的测试时间线：团队给的"今天"是 2026-10-28。 */
const TODAY = '2026-10-28';

/**
 * 构造 13 条测试记录（4 种缺失 kind + 3 条活 review）。
 *
 * @return {Array<object>} 快照记录形状的对象。
 */
function buildTestRecords() {
  /** 统一包装成快照记录的形状。 */
  const record = (id, kind, data, deleted = false) => ({
    owner: 'preview-only',
    id: `${PREFIX}${id}`,
    kind,
    version: 1,
    deleted: deleted ? 1 : 0,
    updated: '2026-10-28T00:00:00.000Z',
    payloadBytes: Buffer.byteLength(JSON.stringify(data), 'utf8'),
    data,
    payloadRaw: null,
  });

  return [
    // ── export 2 条：真实语义是"备份分卷"，不是"带筛选的数据导出" ──
    // 分卷 0（manifest）
    record('export_manifest', 'export', {
      backupId: '__test_backup_protected',
      key: 'preview-only/exports/__test_manifest.zip',
      name: 'backup-__test-manifest.zip',
      size: 128,
      partIndex: 0,
      expiresAt: 4102444800000, // 远期，未过期
    }),
    // 分卷 1（真正数据卷），且 expiresAt 已过期
    record('export_part1', 'export', {
      backupId: '__test_backup_expired',
      key: 'preview-only/exports/__test_part1.zip',
      name: 'backup-__test-part1.zip',
      size: 4096,
      partIndex: 1,
      expiresAt: 1700000000000, // 2023 年，已过期
    }),

    // ── backup 2 条：protected 真/假 + 过期 ──
    record('backup_protected', 'backup', {
      title: '受保护备份（测试）',
      expectedParts: 2,
      status: 'ready',
      protected: true,
      expiresAt: 4102444800000,
      createdAt: '2026-10-28T00:00:00.000Z',
    }),
    record('backup_expired', 'backup', {
      title: '已过期未保护备份（测试）',
      expectedParts: 2,
      status: 'ready',
      protected: false,
      expiresAt: 1700000000000, // 已过期
      createdAt: '2026-10-28T00:00:00.000Z',
    }),

    // ── simulation 3 条：duration 下界 / 上界 / 含不存在题号 ──
    record('sim_duration_1', 'simulation', {
      title: '限时训练·最短 1 分钟（测试）',
      status: '准备',
      problemIds: ['ABC085C'],
      duration: 1,
    }),
    record('sim_duration_600', 'simulation', {
      title: '限时训练·最长 600 分钟（测试）',
      status: '进行中',
      problemIds: ['ABC085C', 'P1226'],
      duration: 600,
      startedAt: '2026-10-28T00:00:00.000Z',
      elapsed: 0,
    }),
    record('sim_missing_problem', 'simulation', {
      title: '限时训练·含不存在题号（测试）',
      status: '准备',
      problemIds: ['ABC085C', `${PREFIX}missing_problem`],
      duration: 90,
    }),

    // ── reading-state 3 条：未开始 / 读到末尾 / 目标不存在 ──
    // 注意：旧代码没有 progress 字段，用 location/scroll 表达位置
    record('reading_start', 'reading-state', {
      title: '阅读位置·开头（测试）',
      targetId: 'stl-2026-10-18-6',
      targetType: 'document',
      sourceVersion: 1,
      location: {line: 1},
      scroll: 0,
      at: '2026-10-28T00:00:00.000Z',
    }),
    record('reading_end', 'reading-state', {
      title: '阅读位置·末尾（测试）',
      targetId: 'stl-2026-10-19-13',
      targetType: 'document',
      sourceVersion: 1,
      location: {line: 120, quote: '末尾锚点'},
      scroll: 99999,
      at: '2026-10-28T00:00:00.000Z',
    }),
    record('reading_missing', 'reading-state', {
      title: '阅读位置·目标不存在（测试）',
      targetId: `${PREFIX}missing_target`,
      targetType: 'document',
      sourceVersion: 1,
      location: {line: 3},
      scroll: 10,
      at: '2026-10-28T00:00:00.000Z',
    }),

    // ── review 3 条活数据：过去 / 今天 / 未来，验证 due <= today ──
    record('review_past', 'review', {
      title: '复习·已到期（测试）',
      due: '2026-10-20',
      status: '待做',
      problemId: 'ABC085C',
    }),
    record('review_today', 'review', {
      title: '复习·今天到期（测试）',
      due: TODAY,
      status: '待做',
      problemId: 'P1226',
    }),
    record('review_future', 'review', {
      title: '复习·未到期（测试）',
      due: '2026-11-05',
      status: '待做',
      problemId: 'ABC178C',
    }),
  ];
}

/**
 * 生成临时快照：原快照 + 测试记录 + 对应的 revision 首见记录。
 */
function makeSnapshot() {
  if (!existsSync(SOURCE_SNAPSHOT)) throw new Error(`源快照不存在：${SOURCE_SNAPSHOT}`);
  const snapshot = JSON.parse(readFileSync(SOURCE_SNAPSHOT, 'utf8'));
  const extras = buildTestRecords();

  snapshot.records.push(...extras);
  // 每条测试记录都当作"只有 1 条 revision、从未编辑"，让 created 取精确值。
  snapshot.revisionFirstSeen.push(
    ...extras.map((item) => ({owner: item.owner, id: item.id, firstUpdated: item.updated, revisionCount: 1})),
  );

  writeFileSync(TEST_SNAPSHOT, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`已生成临时快照：${TEST_SNAPSHOT}`);
  console.log(`  原记录 ${snapshot.records.length - extras.length} 条 + 测试记录 ${extras.length} 条 = ${snapshot.records.length} 条`);
  const byKind = {};
  for (const item of extras) byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
  console.log(`  测试记录按 kind：${Object.entries(byKind).map(([kind, count]) => `${kind}=${count}`).join('，')}`);
}

/**
 * 删除库里所有 `__test_` 数据，并报告前后计数。
 *
 * @param {string} dbPath 目标库。
 */
function cleanup(dbPath) {
  if (!existsSync(dbPath)) throw new Error(`库不存在：${dbPath}`);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');

  const countOf = () => ({
    nodes: db.prepare('SELECT COUNT(*) AS c FROM nodes').get().c,
    edges: db.prepare('SELECT COUNT(*) AS c FROM edges').get().c,
    tags: db.prepare('SELECT COUNT(*) AS c FROM tags').get().c,
    settings: db.prepare('SELECT COUNT(*) AS c FROM settings').get().c,
  });

  const before = countOf();
  const testNodes = db.prepare("SELECT id FROM nodes WHERE id LIKE '__test\\_%' ESCAPE '\\'").all();
  const testEdges = db.prepare("SELECT src, rel, dst FROM edges WHERE src LIKE '__test\\_%' ESCAPE '\\' OR dst LIKE '__test\\_%' ESCAPE '\\'").all();
  const testTags = db.prepare("SELECT id FROM tags WHERE id LIKE '__test\\_%' ESCAPE '\\'").all();

  console.log(`删除前：${JSON.stringify(before)}`);
  console.log(`待删：nodes ${testNodes.length}、edges ${testEdges.length}、tags ${testTags.length}`);

  // 先删边再删节点（外键 ON DELETE CASCADE 也会处理，但显式删更清楚）
  const delEdges = db.prepare("DELETE FROM edges WHERE src LIKE '__test\\_%' ESCAPE '\\' OR dst LIKE '__test\\_%' ESCAPE '\\'").run().changes;
  const delNodes = db.prepare("DELETE FROM nodes WHERE id LIKE '__test\\_%' ESCAPE '\\'").run().changes;
  const delTags = db.prepare("DELETE FROM tags WHERE id LIKE '__test\\_%' ESCAPE '\\'").run().changes;

  const after = countOf();
  console.log(`实删：edges ${delEdges}、nodes ${delNodes}、tags ${delTags}`);
  console.log(`删除后：${JSON.stringify(after)}`);
  const clean = after.nodes === before.nodes - delNodes && after.edges === before.edges - delEdges;
  console.log(`计数自洽：${clean ? '是 ✓' : '否 ✖'}`);
  db.close();
  return clean ? 0 : 1;
}

const args = process.argv.slice(2);
const dbIndex = args.indexOf('--db');
const dbPath = dbIndex >= 0 ? resolve(args[dbIndex + 1]) : DEFAULT_DB;

if (args.includes('--cleanup')) {
  process.exitCode = cleanup(dbPath);
} else {
  makeSnapshot();
}
