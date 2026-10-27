#!/usr/bin/env node
/**
 * 旧数据导入（第二轮：`problem` / `note` / `folder` / `file` / `knowledge`）。
 *
 * 数据源是**已校验的快照** `_migration/legacy-snapshot-2026-10-28.json`，不是直接读旧库。
 * 快照已用 `--verify` 与旧库逐条比对过（112/112 一致），用它既等价又不可能误写旧库。
 *
 * 用法：
 *   node --experimental-sqlite v2/migrate/import-legacy.mjs
 *   node --experimental-sqlite v2/migrate/import-legacy.mjs --verify
 *
 * 设计要点（每条都对应一个实测发现）：
 * 1. **两遍写入**：先 nodes，再 edges/tags。edges.dst 可能指向后写的 node，一遍过会违反外键。
 * 2. **引用按被引用节点的真实 kind 判定**，不按字段名假定（实证：`file.parentId` 指向 note）。
 * 3. **目标不存在/已软删除时不建边**，记进断链清单——断链是数据真实状态，不靠造边掩盖。
 * 4. **folder 先父后子**（拓扑排序 + 环检测），用真外键。
 * 5. **`created` 从 revisions 的最早版本补救**。旧 `records` 表没有 created 列：
 *    - 该记录只有 1 条 revision（从未被编辑）→ `created = updated`，可视为**精确**；
 *    - 有多条 revision → 取 `MIN(revision.updated)`，是比 updated 更紧的**上界**
 *      （首次编辑时间 ≥ 真实创建时间），标记 `createdInferred`；
 *    - 完全无 revision → 退回 `updated`，标记 `createdInferred`。
 * 6. **幂等**：`ON CONFLICT(id) DO NOTHING` / `INSERT OR IGNORE`，重复跑不产生重复行。
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
const IN_SCOPE = ['problem', 'note', 'folder', 'file', 'knowledge'];

/** 共享种子内容的 owner；其余视为个人数据。 */
const SHARED_OWNER = '__content__';

/**
 * STL 速查（`content/stl-reference.json`）已决定归档后删除，但旧笔记里
 * "我引用过哪个 STL 接口"是用户写字时的上下文。为它建一个 `deleted=1` 的占位节点：
 * 默认不出现在列表，却能被引用 —— 既不撒谎（内容确实没了），也不丢信息。
 */
const ARCHIVE_NODE = {
  id: 'archive:stl-reference',
  kind: 'archive',
  title: '旧 STL 速查（已归档）',
  body_md: '原 `content/stl-reference.json`（110 条接口速查）已归档并从应用中移除。旧记录对它的引用保留在此节点上。',
  meta: JSON.stringify({source: 'content/stl-reference.json', itemCount: 110, archivedAt: '2026-10-28'}),
  origin: 'seed',
};

/** 引用 `stl-reference.json`、迁移后应改指向归档占位节点的关系名。 */
const ARCHIVED_REF_REL = 'references-archived';

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

/** 复合键：owner + id（旧库主键是 (owner, id)）。 */
const keyOf = (owner, id) => `${owner}\u0000${id}`;

/**
 * 建立 id → kind 索引（用**全量**快照，含范围外 kind），便于判断引用目标。
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
 * 依据 revisions 决定 created 取值。
 *
 * @param {object} record 快照记录。
 * @param {Map<string, object>} firstSeen owner+id → {firstUpdated, revisionCount}。
 * @return {{created: string, inferred: boolean, gainedMs: number}} 取值与推断标记。
 */
function resolveCreated(record, firstSeen) {
  const seen = firstSeen.get(keyOf(record.owner, record.id));
  const updatedMs = Date.parse(record.updated);

  if (!seen) {
    // 完全没有 revision：只能退回 updated，且是推断值。
    return {created: record.updated, inferred: true, gainedMs: 0};
  }
  if (seen.revisionCount === 1) {
    // 只有一条 revision = 从未被编辑过，created 就是 updated（精确）。
    return {created: record.updated, inferred: false, gainedMs: 0};
  }
  const firstMs = Date.parse(seen.firstUpdated);
  if (Number.isFinite(firstMs) && firstMs < updatedMs) {
    // 首次编辑时间早于最后更新时间：用它作为 created 的上界（仍非精确值）。
    return {created: seen.firstUpdated, inferred: true, gainedMs: updatedMs - firstMs};
  }
  return {created: record.updated, inferred: true, gainedMs: 0};
}

/**
 * 把旧 payload 映射成 `nodes` 行。
 *
 * @param {object} record 快照记录。
 * @param {Map<string, string>} kindIndex id → kind。
 * @param {Map<string, object>} firstSeen revisions 首见索引。
 * @param {Function} noteIssue 无法解析引用时的回调。
 * @return {object} nodes 行。
 */
function toNodeRow(record, kindIndex, firstSeen, noteIssue) {
  const data = record.data ?? {};
  const kind = record.kind;
  const created = resolveCreated(record, firstSeen);

  let parentId = null;
  let meta = {};

  if (kind === 'problem') {
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
    parentId = resolveParent(data.folderId, 'folder', kindIndex, noteIssue, record.id, 'folderId');
    meta = {tags: Array.isArray(data.tags) ? data.tags : []};
  } else if (kind === 'folder') {
    parentId = resolveParent(data.parentId, 'folder', kindIndex, noteIssue, record.id, 'parentId');
  } else if (kind === 'file') {
    // 实测 file.parentId 指向 note，不是 folder：按真实 kind 决定落 parent_id 还是建边。
    const parentKind = data.parentId ? kindIndex.get(data.parentId) : null;
    if (parentKind === 'folder') {
      parentId = data.parentId;
    }
    meta = {
      key: data.key ?? null,
      logicalId: data.logicalId ?? null,
      name: data.name ?? null,
      relativePath: data.relativePath ?? null,
      mime: data.type ?? null,
      sha256: data.hash ?? null,
      size: data.size ?? null,
      encoding: data.encoding ?? null,
      indexed: data.indexed ?? null,
      indexTruncated: data.indexTruncated ?? null,
      // 以下引用字段本轮仍无列可承接，原样保留供下一轮处理
      folderId: data.folderId || null,
      problemId: data.problemId || null,
      previousId: data.previousId || null,
      batchId: data.batchId || null,
      restoreSession: data.restoreSession || null,
      parentRef: data.parentId || null,
    };
  } else if (kind === 'knowledge') {
    // docId / referenceApiId 都指向 stl-reference.json（guideId / item id），
    // 原值留在 meta，边指向归档占位节点。
    meta = {
      status: data.status ?? null,
      evidence: data.evidence ?? null,
      at: data.at ?? null,
      favorite: data.favorite ?? null,
      parent: data.parent ?? null,
      docId: data.docId ?? null,
      referenceApiId: data.referenceApiId ?? null,
    };
  }

  meta.createdInferred = created.inferred;

  const title = typeof data.title === 'string' ? data.title : (data.name ?? '');
  const bodyMd = typeof data.body === 'string' ? data.body : '';

  return {
    id: record.id,
    kind,
    title,
    body_md: bodyMd,
    parent_id: parentId,
    origin: record.owner === SHARED_OWNER ? 'seed' : 'user',
    meta: JSON.stringify(meta),
    search_text: toSearchText(title, bodyMd),
    created: created.created,
    updated: record.updated,
    deleted: record.deleted,
    version: record.version,
    createdGainMs: created.gainedMs,
  };
}

/**
 * 解析 parent 引用：只有目标存在、kind 匹配时才连。
 *
 * @param {unknown} raw 原始引用值。
 * @param {string} expectedKind 期望的目标 kind。
 * @param {Map<string, string>} kindIndex id → kind。
 * @param {Function} noteIssue 无法解析时的回调。
 * @param {string} sourceId 源节点 id。
 * @param {string} field 字段名。
 * @return {string|null} 可用的 parent id。
 */
function resolveParent(raw, expectedKind, kindIndex, noteIssue, sourceId, field) {
  const id = typeof raw === 'string' ? raw : '';
  if (!id) return null;
  const actualKind = kindIndex.get(id);
  if (actualKind !== expectedKind) {
    noteIssue({sourceId, field, value: id, actualKind: actualKind ?? null, expectedKind});
    return null;
  }
  return id;
}

/**
 * 把 folder 按「父先于子」排序并检测环。
 *
 * @param {Array<object>} folders 范围内的 folder 记录。
 * @return {{ordered: Array<object>, cycles: string[]}} 排序结果与环成员。
 */
function orderFolders(folders) {
  const byId = new Map(folders.map((record) => [record.id, record]));
  const ordered = [];
  const state = new Map();
  const cycles = [];

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
 * 检测 `(parent_id, title)` 重复。SQLite 唯一索引认为每个 NULL 互不相等，
 * 所以只有 parent_id 非 NULL 的重复才会真正被拒绝。
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
  return {
    blocking: all.filter((item) => !item.key.startsWith('(根)')),
    allowed: all.filter((item) => item.key.startsWith('(根)')),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.db)) throw new Error(`v2 库不存在，先跑 v2/db/migrate-0001.mjs：${options.db}`);
  if (!existsSync(options.snapshot)) throw new Error(`快照不存在：${options.snapshot}`);

  const snapshot = JSON.parse(readFileSync(options.snapshot, 'utf8'));
  const kindIndex = buildKindIndex(snapshot.records);
  const firstSeen = new Map(snapshot.revisionFirstSeen.map((row) => [keyOf(row.owner, row.id), row]));
  const db = new DatabaseSync(options.db);
  db.exec('PRAGMA foreign_keys = ON');

  try {
    if (options.verify) return verifyImport(db, snapshot);

    const scoped = snapshot.records.filter((record) => IN_SCOPE.includes(record.kind));

    // ── 第一遍：nodes。folder 先父后子，其余顺序无关。 ──
    const folders = scoped.filter((record) => record.kind === 'folder');
    const {ordered: orderedFolders, cycles} = orderFolders(folders);
    const rest = scoped.filter((record) => record.kind !== 'folder');

    const unresolvedParents = [];
    const rows = [
      ...orderedFolders,
      ...rest,
    ].map((record) => toNodeRow(record, kindIndex, firstSeen, (info) => unresolvedParents.push(info)));

    const pathConflicts = findPathConflicts(rows);

    const insertNode = db.prepare(
      `INSERT INTO nodes (id, kind, title, body_md, parent_id, origin, meta, search_text, created, updated, deleted, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    );

    // 归档占位节点先写，供 knowledge 的边引用
    const archiveInserted = insertNode.run(
      ARCHIVE_NODE.id, ARCHIVE_NODE.kind, ARCHIVE_NODE.title, ARCHIVE_NODE.body_md,
      null, ARCHIVE_NODE.origin, ARCHIVE_NODE.meta, toSearchText(ARCHIVE_NODE.title, ARCHIVE_NODE.body_md),
      '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 1, 1,
    ).changes;

    let inserted = 0;
    for (const row of rows) {
      inserted += insertNode.run(
        row.id, row.kind, row.title, row.body_md, row.parent_id, row.origin,
        row.meta, row.search_text, row.created, row.updated, row.deleted, row.version,
      ).changes;
    }

    // file 的字节元数据出一行 `files`（§2.3.4：file → node + files 行）
    const insertFile = db.prepare(
      `INSERT INTO files (node_id, rel_path, size, mime, sha256, text_bytes)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(node_id) DO NOTHING`,
    );
    let fileRows = 0;
    for (const record of scoped.filter((item) => item.kind === 'file')) {
      const data = record.data ?? {};
      fileRows += insertFile.run(
        record.id,
        data.relativePath || data.name || '',
        Number(data.size) || 0,
        data.type || null,
        data.hash || null,
        typeof data.body === 'string' ? Buffer.byteLength(data.body, 'utf8') : 0,
      ).changes;
    }

    // ── 第二遍：edges（nodes 已齐，dst 都能解析） ──
    const insertEdge = db.prepare('INSERT OR IGNORE INTO edges (src, rel, dst, ord) VALUES (?, ?, ?, ?)');
    const edgeKeys = new Set();
    const refs = {total: 0, edges: 0, duplicates: 0, broken: [], byRel: {}, archivedDetail: [], archivedFolded: 0};

    /**
     * 建一条边；同 `(src, rel, dst)` 折叠为一条。
     *
     * @return {boolean} 真正插入时返回 true，被折叠返回 false。
     */
    const addEdge = (src, rel, dst, ord = 0) => {
      refs.total += 1;
      const key = `${src}\u0000${rel}\u0000${dst}`;
      if (edgeKeys.has(key)) {
        refs.duplicates += 1;
        return false;
      }
      edgeKeys.add(key);
      insertEdge.run(src, rel, dst, ord);
      refs.edges += 1;
      refs.byRel[rel] = (refs.byRel[rel] ?? 0) + 1;
      return true;
    };

    /** 判定一条类型化引用：目标必须存在且 kind 匹配，否则记断链（不建边）。 */
    const addTypedRef = (src, targetId, expectedKind, rel) => {
      const actualKind = kindIndex.get(targetId);
      if (!actualKind) {
        refs.total += 1;
        refs.broken.push({src, targetId, reason: '目标在旧库中不存在'});
        return;
      }
      if (actualKind !== expectedKind) {
        refs.total += 1;
        refs.broken.push({src, targetId, reason: `kind 不匹配：期望 ${expectedKind}，实际 ${actualKind}`});
        return;
      }
      addEdge(src, rel, targetId);
    };

    for (const record of scoped) {
      const data = record.data ?? {};

      if (record.kind === 'note') {
        const single = typeof data.problemId === 'string' && data.problemId ? [data.problemId] : [];
        const multi = Array.isArray(data.problemIds) ? data.problemIds.filter(Boolean) : [];
        for (const targetId of [...single, ...multi]) addTypedRef(record.id, targetId, 'problem', 'about');
        // 笔记 → 附件是"提及"，与"关于某题"语义不同，关系名分开。
        for (const targetId of Array.isArray(data.fileIds) ? data.fileIds.filter(Boolean) : []) {
          addTypedRef(record.id, targetId, 'file', 'mentions');
        }
      }

      if (record.kind === 'file') {
        // 实测 file.parentId 指向 note；folder 的情况上文已落 parent_id，这里只处理非 folder。
        const parentRef = typeof data.parentId === 'string' ? data.parentId : '';
        const parentKind = parentRef ? kindIndex.get(parentRef) : null;
        if (parentRef && parentKind !== 'folder') {
          if (!parentKind) {
            refs.total += 1;
            refs.broken.push({src: record.id, targetId: parentRef, reason: 'parentId 目标不存在'});
          } else {
            addEdge(record.id, 'part_of', parentRef);
          }
        }
      }

      if (record.kind === 'knowledge') {
        // docId（guideId）与 referenceApiId（item id）都指向 stl-reference.json。
        // STL 归档后两者都改指归档占位节点，原值留在 meta 里。
        const refsToArchive = [
          ...(typeof data.docId === 'string' && data.docId ? [['docId', data.docId]] : []),
          ...(typeof data.referenceApiId === 'string' && data.referenceApiId ? [['referenceApiId', data.referenceApiId]] : []),
        ];
        for (const [field, original] of refsToArchive) {
          const insertedEdge = addEdge(record.id, ARCHIVED_REF_REL, ARCHIVE_NODE.id);
          refs.archivedDetail.push({src: record.id, field, original, insertedEdge});
          if (!insertedEdge) refs.archivedFolded += 1;
        }
      }
    }

    report({
      scoped, rows, inserted, fileRows, archiveInserted, refs,
      unresolvedParents, pathConflicts, cycles, db,
    });
    return 0;
  } finally {
    db.close();
  }
}

/**
 * 打印导入结果与累计对账。
 *
 * @param {object} result 汇总数据。
 */
function report(result) {
  const {scoped, rows, inserted, fileRows, archiveInserted, refs, unresolvedParents, pathConflicts, cycles, db} = result;

  console.log('=== 迁移范围 ===');
  for (const kind of IN_SCOPE) {
    const all = scoped.filter((record) => record.kind === kind);
    console.log(`  ${kind.padEnd(10)} ${String(all.length).padStart(3)} 条（软删除 ${all.filter((r) => r.deleted).length}）`);
  }
  console.log(`  合计       ${String(scoped.length).padStart(3)} 条（软删除 ${scoped.filter((r) => r.deleted).length}）`);
  console.log('');

  console.log('=== 写入结果 ===');
  console.log(`  nodes 新插入 ${inserted}（跳过已存在 ${rows.length - inserted}）；归档占位节点新增 ${archiveInserted}`);
  console.log(`  files 表新插入 ${fileRows}`);
  console.log(`  库内 nodes ${db.prepare('SELECT COUNT(*) AS c FROM nodes').get().c}，edges ${db.prepare('SELECT COUNT(*) AS c FROM edges').get().c}`);
  console.log('');

  console.log('=== created 推断统计（本轮范围内） ===');
  const inferred = rows.filter((row) => JSON.parse(row.meta).createdInferred);
  const exact = rows.filter((row) => !JSON.parse(row.meta).createdInferred);
  const gained = rows.filter((row) => row.createdGainMs > 0);
  const maxGain = gained.reduce((max, row) => (row.createdGainMs > max.gainMs ? {gainMs: row.createdGainMs, id: row.id} : max), {gainMs: 0, id: null});
  console.log(`  已迁 ${rows.length} 条：created 精确 ${exact.length} 条 / 推断 ${inferred.length} 条`);
  console.log(`  从 revisions 拿到更早时间 ${gained.length} 条；最大提前 ${(maxGain.gainMs / 86400000).toFixed(2)} 天（${maxGain.id}）`);
  console.log('');

  console.log('=== 引用对账 ===');
  console.log(`  引用总数 ${refs.total}`);
  console.log(`  → 建边 ${refs.edges}（同 (src,rel,dst) 折叠 ${refs.duplicates}）`);
  console.log(`  → 断链 ${refs.broken.length}`);
  console.log(`  按关系：${Object.entries(refs.byRel).map(([rel, count]) => `${rel}=${count}`).join('，') || '无'}`);
  const sum = refs.edges + refs.duplicates + refs.broken.length;
  console.log(`  校验：${refs.edges} + ${refs.duplicates} + ${refs.broken.length} = ${sum} ${sum === refs.total ? '✓' : '✖'}`);
  console.log('');

  console.log('=== 断链清单 ===');
  if (!refs.broken.length) console.log('  无');
  for (const item of refs.broken) console.log(`  ${item.src} → ${item.targetId}：${item.reason}`);
  console.log('');

  console.log('=== 归档引用（指向 archive:stl-reference） ===');
  if (!refs.archivedDetail?.length) console.log('  无');
  for (const item of refs.archivedDetail) {
    const suffix = item.insertedEdge ? '' : '（与同节点的另一条归档引用合并）';
    console.log(`  ${item.src}.${item.field} = ${item.original} → ${ARCHIVE_NODE.id}${suffix}`);
  }
  if (refs.archivedFolded) console.log(`  合并折叠 ${refs.archivedFolded} 处（同一 knowledge 的 docId + referenceApiId 指向同一占位节点）`);
  console.log('');

  console.log('=== parent 解析 ===');
  console.log(`  无法解析而置空 ${unresolvedParents.length} 处`);
  for (const item of unresolvedParents) {
    console.log(`  ${item.sourceId}.${item.field} = ${item.value}（实际 kind=${item.actualKind ?? '不存在'}，期望 ${item.expectedKind}）`);
  }
  console.log(`  有 parent_id 的节点 ${rows.filter((row) => row.parent_id).length} / ${rows.length}`);
  console.log('');

  console.log('=== 约束预检 ===');
  console.log(`  会违反 nodes_path 的重复（parent 非 NULL）：${pathConflicts.blocking.length}`);
  for (const conflict of pathConflicts.blocking) console.log(`  ✖ ${conflict.key} → ${conflict.ids.join(', ')}`);
  console.log(`  根节点同名（parent NULL，索引不约束）：${pathConflicts.allowed.length}`);
  console.log(`  folder 环：${cycles.length ? cycles.join(', ') : '无'}`);
}

/**
 * 校验导入结果（验收用）。覆盖全部已迁 kind，不只本轮新增。
 *
 * @param {DatabaseSync} db 目标连接。
 * @param {object} snapshot 快照。
 * @return {number} 0 通过，1 有不一致。
 */
function verifyImport(db, snapshot) {
  const problems = [];
  const ALL_KINDS = ['problem', 'note', 'folder', 'file', 'knowledge'];
  const scoped = snapshot.records.filter((record) => ALL_KINDS.includes(record.kind));

  console.log('=== ① 累计对账表（kind / 快照数 / 已迁数 / 差） ===');
  let expectedTotal = 0;
  let actualTotal = 0;
  for (const kind of ALL_KINDS) {
    const expected = scoped.filter((record) => record.kind === kind).length;
    const actual = db.prepare('SELECT COUNT(*) AS c FROM nodes WHERE kind = ?').get(kind).c;
    expectedTotal += expected;
    actualTotal += actual;
    const ok = expected === actual;
    if (!ok) problems.push(`${kind}: 快照 ${expected} / 库内 ${actual}`);
    console.log(`  ${kind.padEnd(10)} ${String(expected).padStart(3)} / ${String(actual).padStart(3)} / ${String(actual - expected).padStart(3)}  ${ok ? '✓' : '✖'}`);
  }
  console.log(`  ${'合计'.padEnd(10)} ${String(expectedTotal).padStart(3)} / ${String(actualTotal).padStart(3)}  ${expectedTotal === actualTotal ? '✓' : '✖'}`);
  const archive = db.prepare("SELECT COUNT(*) AS c FROM nodes WHERE kind = 'archive'").get().c;
  console.log(`  另有 archive 占位节点 ${archive} 个（不在快照内，预期 1）`);
  if (archive !== 1) problems.push(`archive 占位节点数 ${archive} ≠ 1`);
  console.log('');

  console.log('=== ② 抽样逐字段比对 ===');
  for (const kind of ALL_KINDS) {
    const sample = scoped.find((record) => record.kind === kind);
    if (!sample) continue;
    const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(sample.id);
    if (!row) {
      problems.push(`${kind} 样本 ${sample.id} 未入库`);
      console.log(`  ${kind.padEnd(10)} 未入库 ✖`);
      continue;
    }
    const expectedTitle = typeof sample.data?.title === 'string' ? sample.data.title : (sample.data?.name ?? '');
    const expectedBody = typeof sample.data?.body === 'string' ? sample.data.body : '';
    const checks = [
      ['title', row.title === expectedTitle],
      ['body_md', row.body_md === expectedBody],
      ['updated', row.updated === sample.updated],
      ['deleted', row.deleted === sample.deleted],
      ['version', row.version === sample.version],
      ['created<=updated', Date.parse(row.created) <= Date.parse(row.updated)],
    ];
    const bad = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (bad.length) problems.push(`${kind} ${sample.id} 字段不一致：${bad.join(',')}`);
    console.log(`  ${kind.padEnd(10)} ${String(sample.id).slice(0, 26).padEnd(28)} ${bad.length ? '✖ ' + bad.join(',') : '✓ 全部一致'}`);
  }
  console.log('');

  console.log('=== ③ created 可信度 ===');
  const metaOf = (id) => JSON.parse(db.prepare('SELECT meta FROM nodes WHERE id = ?').get(id)?.meta ?? '{}');
  const all = db.prepare("SELECT id FROM nodes WHERE kind <> 'archive'").all();
  const inferred = all.filter((row) => metaOf(row.id).createdInferred).length;
  console.log(`  已迁 ${all.length} 条：created 精确 ${all.length - inferred} 条（单 revision，从未编辑）/ 推断 ${inferred} 条`);
  const worse = db.prepare('SELECT COUNT(*) AS c FROM nodes WHERE created > updated').get().c;
  console.log(`  created > updated 的行：${worse} ${worse === 0 ? '✓' : '✖'}`);
  if (worse) problems.push(`${worse} 行 created > updated`);
  console.log('');

  console.log('=== ④ folder 层级与环检测 ===');
  const folders = db.prepare("SELECT id, parent_id, title FROM nodes WHERE kind = 'folder'").all();
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let deepest = {depth: 0, chain: []};
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
    if (chain.length > deepest.depth) deepest = {depth: chain.length, chain};
  }
  console.log(`  folder ${folders.length} 个；环 ${cycles} ${cycles === 0 ? '✓' : '✖'}`);
  console.log(`  最深链（深度 ${deepest.depth}）：${deepest.chain.join(' → ')}`);
  if (cycles) problems.push(`folder 存在 ${cycles} 个环`);
  console.log('');

  console.log('=== ⑤ edges 与悬空检查 ===');
  const edges = db.prepare('SELECT src, rel, dst FROM edges').all();
  const dangling = edges.filter((edge) => !db.prepare('SELECT 1 AS x FROM nodes WHERE id = ?').get(edge.src) || !db.prepare('SELECT 1 AS x FROM nodes WHERE id = ?').get(edge.dst));
  const byRel = {};
  for (const edge of edges) byRel[edge.rel] = (byRel[edge.rel] ?? 0) + 1;
  console.log(`  edges ${edges.length} 条：${Object.entries(byRel).map(([rel, count]) => `${rel}=${count}`).join('，')}`);
  console.log(`  悬空边 ${dangling.length} ${dangling.length === 0 ? '✓' : '✖'}`);
  for (const edge of dangling) console.log(`  ✖ ${edge.src} -${edge.rel}-> ${edge.dst}`);
  if (dangling.length) problems.push(`${dangling.length} 条边悬空`);
  const archivedEdges = db.prepare("SELECT COUNT(*) AS c FROM edges WHERE rel = ?").get(ARCHIVED_REF_REL).c;
  console.log(`  指向归档占位节点 ${ARCHIVED_REF_REL}：${archivedEdges} 条`);
  console.log('');

  console.log('=== ⑥ files 表 ===');
  const files = db.prepare('SELECT node_id, rel_path, size, mime, sha256 FROM files').all();
  console.log(`  files ${files.length} 行`);
  for (const file of files) console.log(`  ${file.node_id.slice(0, 20)}… rel_path=${file.rel_path} size=${file.size} mime=${file.mime} sha256=${String(file.sha256).slice(0, 12)}…`);
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
