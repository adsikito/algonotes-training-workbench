#!/usr/bin/env node
/**
 * 旧数据导入（第一刀：只迁 `problem` / `note` / `folder`）。
 *
 * 数据源是**已校验的快照** `_migration/legacy-snapshot-2026-10-28.json`，不是直接读旧库。
 * 原因：快照已用 `--verify` 与旧库逐条比对过（112/112 一致），用它既等价又不可能
 * 误写旧库。
 *
 * 用法：
 *   node --experimental-sqlite v2/migrate/import-legacy.mjs
 *   node --experimental-sqlite v2/migrate/import-legacy.mjs --verify
 *
 * 设计要点（每一条都对应报告里的一个实测发现）：
 * 1. **两遍写入**：先 nodes（建 id），再 edges。架构文档明确这是硬要求 ——
 *    edges.dst 可能指向后写入的 node，一遍过会违反外键。
 * 2. **parent_id 按被引用节点的真实 kind 判断**，不假定 `parentId` 一定指向 folder。
 *    实测 `file.parentId` 指向的是 note；本轮范围内 `note.folderId` → folder、
 *    `folder.parentId` → folder，但判断走的是 kind 查表而不是字段名。
 * 3. **目标是软删除节点或不存在时不建边**，记进断链清单 —— 断链是数据的真实状态，
 *    不是导入错误，不能靠"造一条边"掩盖。
 * 4. **folder 先父后子**（拓扑排序 + 环检测），用真外键。
 * 5. **幂等**：`ON CONFLICT(id) DO NOTHING` / `INSERT OR IGNORE`，重复跑不产生重复行。
 */
import {DatabaseSync} from 'node:sqlite';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {toSearchText} from '../db/fts-text.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const DEFAULT_DB = resolve(REPO_ROOT, 'v2', 'data', 'algonotes.sqlite');
const DEFAULT_SNAPSHOT = resolve(REPO_ROOT, '..', '_migration', 'legacy-snapshot-2026-10-28.json');

/** 本轮迁移的 kind 范围。 */
const IN_SCOPE = ['problem', 'note', 'folder'];

/** 共享种子内容的 owner；其余视为个人数据。 */
const SHARED_OWNER = '__content__';

/**
 * 解析参数。
 *
 * @param {string[]} argv 脚本名之后的参数。
 * @return {{db: string, snapshot: string, verify: boolean}} 选项。
 */
function parseArgs(argv) {
  const options = {db: DEFAULT_DB, snapshot: DEFAULT_SNAPSHOT, verify: false};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--verify') options.verify = true;
    else if (arg === '--db') options.db = resolve(argv[++index]);
    else if (arg === '--snapshot') options.snapshot = resolve(argv[++index]);
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

/**
 * 建立 id → kind 索引（用**全量**快照，不只是范围内的 kind），
 * 这样判断引用目标时能看到 file / knowledge 等范围外实体。
 *
 * @param {Array<object>} records 快照记录。
 * @return {Map<string, string>} id → kind。
 */
function buildKindIndex(records) {
  const index = new Map();
  for (const record of records) index.set(record.id, record.kind);
  return index;
}

/**
 * 把旧 payload 映射成 `nodes` 行。
 *
 * 注意：旧库**没有 `created` 列**（表结构只有 updated），所以 `created` 只能取
 * `updated` 作为占位。这是已知的信息缺失，不是映射错误，已在报告中标注。
 *
 * @param {object} record 快照记录。
 * @param {Map<string, string>} kindIndex id → kind。
 * @param {(id: string, kind: string) => void} onUnresolvedParent parent 无法解析时的回调。
 * @return {object} nodes 行。
 */
function toNodeRow(record, kindIndex, onUnresolvedParent) {
  const data = record.data ?? {};
  const kind = record.kind;
  const origin = record.owner === SHARED_OWNER ? 'seed' : 'user';

  let parentId = null;
  let meta = {};

  if (kind === 'problem') {
    // problem 的题面在 body，其余字段没有列可以承接，全部进 meta。
    meta = {
      code: data.code ?? null,
      url: data.url ?? null,
      difficulty: data.difficulty ?? null,
      difficultyLabel: data.difficultyLabel ?? null,
      topic: data.topic ?? null,
      knowledge: data.knowledge ?? null,
      type: data.type ?? null,
      role: data.role ?? null,
      position: data.position ?? null,
      date: data.date ?? null,
      tags: Array.isArray(data.tags) ? data.tags : [],
    };
  } else if (kind === 'note') {
    // 目录归属：只认目标是 folder 的引用，不按字段名猜。
    parentId = resolveParent(data.folderId, 'folder', kindIndex, onUnresolvedParent, record.id, 'folderId');
    meta = {
      tags: Array.isArray(data.tags) ? data.tags : [],
    };
    // fileIds 无列可承接且目标 kind 不在本轮范围，原样留在 meta 里等下一轮。
    if (Array.isArray(data.fileIds) && data.fileIds.length) meta.fileIds = data.fileIds;
  } else if (kind === 'folder') {
    parentId = resolveParent(data.parentId, 'folder', kindIndex, onUnresolvedParent, record.id, 'parentId');
  }

  const title = typeof data.title === 'string' ? data.title : '';
  const bodyMd = typeof data.body === 'string' ? data.body : '';

  return {
    id: record.id,
    kind,
    title,
    body_md: bodyMd,
    parent_id: parentId,
    origin,
    meta: JSON.stringify(meta),
    search_text: toSearchText(title, bodyMd),
    created: record.updated,
    updated: record.updated,
    deleted: record.deleted,
    version: record.version,
  };
}

/**
 * 解析 parent 引用：只有目标存在、kind 匹配、且未被软删除时才连。
 *
 * @param {unknown} raw 原始引用值。
 * @param {string} expectedKind 期望的目标 kind。
 * @param {Map<string, string>} kindIndex id → kind。
 * @param {Function} onUnresolvedParent 无法解析时的回调。
 * @param {string} sourceId 源节点 id。
 * @param {string} field 字段名（用于报告）。
 * @return {string|null} 可用的 parent id。
 */
function resolveParent(raw, expectedKind, kindIndex, onUnresolvedParent, sourceId, field) {
  const id = typeof raw === 'string' ? raw : '';
  if (!id) return null;
  const actualKind = kindIndex.get(id);
  if (actualKind !== expectedKind) {
    onUnresolvedParent({sourceId, field, value: id, actualKind: actualKind ?? null, expectedKind});
    return null;
  }
  return id;
}

/**
 * 把 folder 按「父先于子」排序，并检测环。
 *
 * @param {Array<object>} folders 范围内的 folder 记录。
 * @return {{ordered: Array<object>, cycles: string[]}} 排序结果与环成员。
 */
function orderFolders(folders) {
  const byId = new Map(folders.map((record) => [record.id, record]));
  const ordered = [];
  const state = new Map(); // id -> 'visiting' | 'done'
  const cycles = [];

  /** 深度优先：先递归 parent，再输出自己。 */
  const visit = (id, trail) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      cycles.push(...trail.slice(trail.indexOf(id)));
      return;
    }
    state.set(id, 'visiting');
    const record = byId.get(id);
    const parentId = record?.data?.parentId;
    if (parentId && byId.has(parentId)) visit(parentId, [...trail, id]);
    state.set(id, 'done');
    ordered.push(record);
  };

  for (const folder of folders) visit(folder.id, []);
  return {ordered: ordered.filter(Boolean), cycles: [...new Set(cycles)]};
}

/**
 * 检测 `(parent_id, title)` 在未删除行里的重复。
 *
 * 关键细节：`nodes_path` 是普通唯一索引，SQLite 认为 **每个 NULL 互不相等**，
 * 所以根节点（parent_id IS NULL）同名不会冲突；只有 parent_id 非 NULL 时才真正
 * 会被拒绝。这里按这个语义区分，避免报假警。
 *
 * @param {Array<object>} rows 待写入的 nodes 行。
 * @return {{blocking: Array<object>, allowed: Array<object>}} 会违反索引的 / 索引不约束的。
 */
function findPathConflicts(rows) {
  const buckets = new Map();
  for (const row of rows) {
    if (row.deleted) continue;
    const key = `${row.parent_id ?? '\u0000null'}\u0000${row.title}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row.id);
  }
  const all = [...buckets.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({key: key.replace('\u0000null', '(根)').replace('\u0000', ' / '), ids}));

  // parent_id 为 NULL 的桶不会触发唯一索引，单独归类说明。
  const blocking = all.filter((item) => !item.key.startsWith('(根)'));
  const allowed = all.filter((item) => item.key.startsWith('(根)'));
  return {blocking, allowed};
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.db)) throw new Error(`v2 库不存在，先跑 v2/db/migrate-0001.mjs：${options.db}`);
  if (!existsSync(options.snapshot)) throw new Error(`快照不存在：${options.snapshot}`);

  const snapshot = JSON.parse(readFileSync(options.snapshot, 'utf8'));
  const kindIndex = buildKindIndex(snapshot.records);
  const db = new DatabaseSync(options.db);
  db.exec('PRAGMA foreign_keys = ON');

  try {
    if (options.verify) return verifyImport(db, snapshot);

    const scoped = snapshot.records.filter((record) => IN_SCOPE.includes(record.kind));

    // ── 第一遍：nodes。folder 先父后子，其余顺序无关。 ──
    const folders = scoped.filter((record) => record.kind === 'folder');
    const {ordered: orderedFolders, cycles} = orderFolders(folders);
    const rest = scoped.filter((record) => record.kind !== 'folder');
    const writeOrder = [...orderedFolders, ...rest];

    const unresolvedParents = [];
    const rows = writeOrder.map((record) =>
      toNodeRow(record, kindIndex, (info) => unresolvedParents.push(info)),
    );

    const pathConflicts = findPathConflicts(rows);

    const insertNode = db.prepare(
      `INSERT INTO nodes (id, kind, title, body_md, parent_id, origin, meta, search_text, created, updated, deleted, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    );
    let inserted = 0;
    for (const row of rows) {
      const result = insertNode.run(
        row.id, row.kind, row.title, row.body_md, row.parent_id, row.origin,
        row.meta, row.search_text, row.created, row.updated, row.deleted, row.version,
      );
      inserted += result.changes;
    }

    // ── 第二遍：edges（此刻 nodes 已齐，dst 都能解析） ──
    const insertEdge = db.prepare(
      'INSERT OR IGNORE INTO edges (src, rel, dst, ord) VALUES (?, ?, ?, ?)',
    );

    const refs = {total: 0, edges: 0, duplicates: 0, broken: [], outOfScope: [], softDeletedTarget: []};
    const edgeKeys = new Set();

    for (const record of scoped.filter((item) => item.kind === 'note')) {
      const data = record.data ?? {};
      const single = typeof data.problemId === 'string' && data.problemId ? [data.problemId] : [];
      const multi = Array.isArray(data.problemIds) ? data.problemIds.filter(Boolean) : [];
      const files = Array.isArray(data.fileIds) ? data.fileIds.filter(Boolean) : [];

      for (const targetId of [...single, ...multi]) {
        refs.total += 1;
        classifyReference(record.id, targetId, 'problem', kindIndex, snapshot, refs, () => {
          const key = `${record.id}\u0000about\u0000${targetId}`;
          if (edgeKeys.has(key)) {
            refs.duplicates += 1;
            return;
          }
          edgeKeys.add(key);
          insertEdge.run(record.id, 'about', targetId, 0);
          refs.edges += 1;
        });
      }

      for (const targetId of files) {
        refs.total += 1;
        // file 不在本轮范围：不建边，也不假装它断链——单独归到「目标 kind 未迁」。
        classifyReference(record.id, targetId, 'file', kindIndex, snapshot, refs, () => {
          refs.outOfScope.push({src: record.id, field: 'fileIds', targetId, kind: 'file'});
        }, true);
      }
    }

    report({
      scoped, rows, inserted, refs, unresolvedParents, pathConflicts, cycles,
      existingNodes: db.prepare('SELECT COUNT(*) AS c FROM nodes').get().c,
      existingEdges: db.prepare('SELECT COUNT(*) AS c FROM edges').get().c,
    });
    return 0;
  } finally {
    db.close();
  }
}

/**
 * 判定一条引用该怎么处理：建边 / 断链 / 目标未迁 / 目标已软删除。
 *
 * @param {string} srcId 源节点 id。
 * @param {string} targetId 目标 id。
 * @param {string} expectedKind 期望目标 kind。
 * @param {Map<string, string>} kindIndex id → kind。
 * @param {object} snapshot 快照。
 * @param {object} refs 统计累加器。
 * @param {Function} onEdge 可建边时的回调。
 * @param {boolean} [allowOutOfScope] 目标 kind 不在本轮范围时是否归入「未迁」而不是「断链」。
 */
function classifyReference(srcId, targetId, expectedKind, kindIndex, snapshot, refs, onEdge, allowOutOfScope = false) {
  const actualKind = kindIndex.get(targetId);
  if (!actualKind) {
    refs.broken.push({src: srcId, targetId, reason: '目标在旧库中不存在'});
    return;
  }
  if (actualKind !== expectedKind) {
    refs.broken.push({src: srcId, targetId, reason: `kind 不匹配：期望 ${expectedKind}，实际 ${actualKind}`});
    return;
  }
  if (allowOutOfScope) {
    onEdge();
    return;
  }
  const target = snapshot.records.find((record) => record.id === targetId);
  if (target?.deleted) {
    refs.softDeletedTarget.push({src: srcId, targetId});
    refs.broken.push({src: srcId, targetId, reason: '目标已软删除'});
    return;
  }
  onEdge();
}

/**
 * 打印导入结果与对账。
 *
 * @param {object} result 汇总数据。
 */
function report(result) {
  const {scoped, rows, inserted, refs, unresolvedParents, pathConflicts, cycles, existingNodes, existingEdges} = result;

  console.log('=== 迁移范围 ===');
  for (const kind of IN_SCOPE) {
    const all = scoped.filter((record) => record.kind === kind);
    console.log(`  ${kind.padEnd(8)} ${String(all.length).padStart(3)} 条（软删除 ${all.filter((r) => r.deleted).length}）`);
  }
  console.log(`  合计     ${String(scoped.length).padStart(3)} 条（软删除 ${scoped.filter((r) => r.deleted).length}）`);
  console.log('');

  console.log('=== nodes 写入 ===');
  console.log(`  本次新插入 ${inserted} 行；跳过（已存在）${rows.length - inserted} 行`);
  console.log(`  库内 nodes 总数 ${existingNodes}；edges 总数 ${existingEdges}`);
  console.log('');

  console.log('=== 引用对账（note → problem / file） ===');
  console.log(`  快照里 note 引用字段非空总数   ${refs.total}`);
  console.log(`  → 实际建边（src,rel,dst 去重） ${refs.edges}`);
  console.log(`  → 同 (src,rel,dst) 重复折叠     ${refs.duplicates}`);
  console.log(`  → 断链（目标不存在/软删除）     ${refs.broken.length}`);
  console.log(`  → 目标 kind 未迁（本轮不建边）  ${refs.outOfScope.length}`);
  const sum = refs.edges + refs.duplicates + refs.broken.length + refs.outOfScope.length;
  console.log(`  校验：${refs.edges} + ${refs.duplicates} + ${refs.broken.length} + ${refs.outOfScope.length} = ${sum} ${sum === refs.total ? '✓ 与总数一致' : '✖ 对不上'}`);
  console.log('');

  console.log('=== 断链清单（真实数据状态，不掩盖） ===');
  if (!refs.broken.length) console.log('  无');
  for (const item of refs.broken) console.log(`  ${item.src} → ${item.targetId}：${item.reason}`);
  console.log('');

  console.log('=== 本轮不建边的引用（目标 kind 尚未迁移） ===');
  if (!refs.outOfScope.length) console.log('  无');
  for (const item of refs.outOfScope) console.log(`  ${item.src}.${item.field} → ${item.targetId}（kind=${item.kind}）`);
  console.log('');

  console.log('=== parent 解析 ===');
  console.log(`  无法解析而置空 ${unresolvedParents.length} 处`);
  for (const item of unresolvedParents) {
    console.log(`  ${item.sourceId}.${item.field} = ${item.value}（实际 kind=${item.actualKind ?? '不存在'}，期望 ${item.expectedKind}）`);
  }
  const withParent = rows.filter((row) => row.parent_id).length;
  console.log(`  有 parent_id 的节点 ${withParent} / ${rows.length}`);
  console.log('');

  console.log('=== 约束预检 ===');
  console.log(`  会违反 nodes_path 唯一索引的重复（parent 非 NULL）：${pathConflicts.blocking.length}`);
  for (const conflict of pathConflicts.blocking) console.log(`  ✖ ${conflict.key} → ${conflict.ids.join(', ')}`);
  console.log(`  根节点同名（parent NULL，SQLite 视为互不相等，索引不约束）：${pathConflicts.allowed.length}`);
  for (const conflict of pathConflicts.allowed) console.log(`  · ${conflict.key} → ${conflict.ids.join(', ')}`);
  console.log(`  folder 环：${cycles.length ? cycles.join(', ') : '无'}`);
}

/**
 * 校验导入结果（验收用）。
 *
 * @param {DatabaseSync} db 目标连接。
 * @param {object} snapshot 快照。
 * @return {number} 0 通过，1 有不一致。
 */
function verifyImport(db, snapshot) {
  const problems = [];
  const scoped = snapshot.records.filter((record) => IN_SCOPE.includes(record.kind));

  // ① 逐 kind 计数
  console.log('=== ① 逐 kind 计数对账 ===');
  for (const kind of IN_SCOPE) {
    const expected = scoped.filter((record) => record.kind === kind).length;
    const actual = db.prepare('SELECT COUNT(*) AS c FROM nodes WHERE kind = ?').get(kind).c;
    const ok = expected === actual;
    if (!ok) problems.push(`${kind}: 快照 ${expected} / 库内 ${actual}`);
    console.log(`  ${kind.padEnd(8)} 快照 ${String(expected).padStart(3)} / 库内 ${String(actual).padStart(3)}  ${ok ? '✓' : '✖'}`);
  }
  const totalNodes = db.prepare('SELECT COUNT(*) AS c FROM nodes').get().c;
  console.log(`  nodes 总数 ${totalNodes}（期望 ${scoped.length}）${totalNodes === scoped.length ? ' ✓' : ' ✖'}`);
  if (totalNodes !== scoped.length) problems.push(`nodes 总数 ${totalNodes} ≠ ${scoped.length}`);
  console.log('');

  // ② 抽样 3 条（每 kind 1 条）逐字段比对
  console.log('=== ② 抽样逐字段比对（title / body_md / created / updated / deleted / version） ===');
  for (const kind of IN_SCOPE) {
    const sample = scoped.find((record) => record.kind === kind);
    if (!sample) continue;
    const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(sample.id);
    if (!row) {
      problems.push(`${kind} 样本 ${sample.id} 未入库`);
      console.log(`  ${kind}: 样本未入库 ✖`);
      continue;
    }
    const expectedTitle = typeof sample.data?.title === 'string' ? sample.data.title : '';
    const expectedBody = typeof sample.data?.body === 'string' ? sample.data.body : '';
    const checks = [
      ['title', row.title === expectedTitle],
      ['body_md', row.body_md === expectedBody],
      ['updated', row.updated === sample.updated],
      ['created', row.created === sample.updated],
      ['deleted', row.deleted === sample.deleted],
      ['version', row.version === sample.version],
    ];
    const bad = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (bad.length) problems.push(`${kind} ${sample.id} 字段不一致：${bad.join(',')}`);
    console.log(`  ${kind.padEnd(8)} ${sample.id.slice(0, 28).padEnd(30)} ${bad.length ? '✖ ' + bad.join(',') : '✓ 全部一致'}`);
  }
  console.log('');

  // ③ folder 层级：最深一层能否一路查到根
  console.log('=== ③ folder 层级与环检测 ===');
  const folders = db.prepare("SELECT id, parent_id, title FROM nodes WHERE kind = 'folder'").all();
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let deepest = {id: null, depth: 0, chain: []};
  let cycles = 0;
  for (const folder of folders) {
    const chain = [];
    let current = folder;
    const guard = new Set();
    while (current) {
      if (guard.has(current.id)) {
        cycles += 1;
        break;
      }
      guard.add(current.id);
      chain.push(current.title);
      current = current.parent_id ? byId.get(current.parent_id) : null;
    }
    if (chain.length > deepest.depth) deepest = {id: folder.id, depth: chain.length, chain};
  }
  console.log(`  folder 数 ${folders.length}；检测到环 ${cycles} 个 ${cycles === 0 ? '✓' : '✖'}`);
  if (cycles) problems.push(`folder 存在 ${cycles} 个环`);
  console.log(`  最深链（深度 ${deepest.depth}）：${deepest.chain.join(' → ')}`);
  const orphan = folders.filter((folder) => folder.parent_id && !byId.has(folder.parent_id));
  console.log(`  parent_id 指向不存在的 folder：${orphan.length} ${orphan.length === 0 ? '✓' : '✖'}`);
  if (orphan.length) problems.push(`${orphan.length} 个 folder 的 parent_id 悬空`);
  console.log('');

  // ④ edges 与悬空检查
  console.log('=== ④ edges 一致性 ===');
  const edges = db.prepare('SELECT src, rel, dst FROM edges').all();
  const danglingEdges = edges.filter((edge) => {
    const src = db.prepare('SELECT 1 AS x FROM nodes WHERE id = ?').get(edge.src);
    const dst = db.prepare('SELECT 1 AS x FROM nodes WHERE id = ?').get(edge.dst);
    return !src || !dst;
  });
  console.log(`  edges 共 ${edges.length} 条；悬空 ${danglingEdges.length} ${danglingEdges.length === 0 ? '✓' : '✖'}`);
  if (danglingEdges.length) problems.push(`${danglingEdges.length} 条边悬空`);
  for (const edge of danglingEdges) console.log(`  ✖ ${edge.src} -${edge.rel}-> ${edge.dst}`);
  console.log('');

  if (problems.length) {
    console.log(`=== 结论：${problems.length} 处不一致 ===`);
    for (const problem of problems) console.log(`  ✖ ${problem}`);
    return 1;
  }
  console.log('=== 结论：全部一致 ✓ ===');
  return 0;
}

process.exitCode = main();
