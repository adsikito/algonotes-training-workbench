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

/**
 * 21 种有真实数据的 kind，按 §2.3.4 的映射分成四类落点。
 * 注意：**不是所有 kind 都变成 node**，所以对账必须按落点算，否则永远对不上 112。
 */
const NODE_KINDS = [
  'problem', 'note', 'folder', 'file', 'knowledge',
  // 练习链路
  'selection', 'attempt', 'submission', 'state',
  // 其余内容与状态
  'review', 'list', 'document', 'view', 'snippet', 'mistake', 'feedback', 'bookmark',
];
/** §2.3.4：relation 从"记录"降级为"边"，不落 node。 */
const EDGE_ONLY_KINDS = ['relation'];
/** §2.3.4：taxonomy 从"记录"降级为"标签"，落 tags / node_tags。 */
const TAG_KINDS = ['taxonomy'];
/** §2.3.4：preference → setting，落 settings 表。 */
const SETTING_KINDS = ['preference'];
/** §4.8：update → drop，内容批次改由 content_packs 管理；本条是测试残留。 */
const DROPPED_KINDS = ['update'];

/** 由四类落点求并集，即全部有数据的 kind。 */
const IN_SCOPE = [...NODE_KINDS, ...EDGE_ONLY_KINDS, ...TAG_KINDS, ...SETTING_KINDS, ...DROPPED_KINDS];

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
  let deleted = record.deleted;

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
  } else if (kind === 'state') {
    // problemId 必须进 meta：nodes_state_problem 这个唯一索引就建在
    // json_extract(meta,'$.problemId') 上，靠它保证「一题一份状态」。
    meta = {
      problemId: data.problemId ?? null,
      progress: data.progress ?? null,
      mastery: data.mastery ?? null,
      favorite: data.favorite ?? null,
    };
  } else if (kind === 'selection') {
    // `day` 是"我哪天选了这道题"。实测 18/18 都有值（只有 2026-10-25/26 两天），
    // 没有 `date` 字段，所以不需要回退到 updated。
    meta = {
      day: data.day ?? null,
      problemId: data.problemId ?? null,
    };
  } else if (kind === 'attempt') {
    // minutes 实测 4/4 是空字符串。**空串不能写成 0**，否则统计里
    // "未记录用时" 会变成 "用时 0 分钟"。空串 → null + minutesUnknown。
    const rawMinutes = data.minutes;
    const hasMinutes = rawMinutes !== '' && rawMinutes != null && Number.isFinite(Number(rawMinutes)) && Number(rawMinutes) >= 0;
    meta = {
      problemId: data.problemId ?? null,
      status: data.status ?? null,
      day: data.day ?? null,
      activityDays: Array.isArray(data.activityDays) ? data.activityDays : [],
      startedAt: data.startedAt ?? null,
      endedAt: data.endedAt ?? null,
      minutes: hasMinutes ? Number(rawMinutes) : null,
      minutesUnknown: !hasMinutes,
      help: data.help ?? null,
      tool: data.tool ?? null,
      code: data.code ?? null,
      blocker: data.blocker ?? null,
      reflection: data.reflection ?? null,
      resultDraft: data.resultDraft ?? null,
    };
  } else if (kind === 'submission') {
    meta = {
      problemId: data.problemId ?? null,
      attemptId: data.attemptId ?? null,
      result: data.result ?? null,
      help: data.help ?? null,
      tool: data.tool ?? null,
      code: data.code ?? null,
      source: data.source ?? null,
      tests: Array.isArray(data.tests) ? data.tests : [],
      at: data.at ?? null,
    };
  } else if (kind === 'review') {
    // due 保持 YYYY-MM-DD 原样（新架构要按 `due <= today` 查到期，字符串可直接比较）。
    // 状态含「取消」：取消不是删除，但也不该出现在待办里 —— 保留节点、置 deleted=1，历史仍可查。
    if (data.status === '取消') deleted = 1;
    meta = {
      due: data.due ?? null,
      status: data.status ?? null,
      completedAt: data.completedAt ?? null,
      problemId: data.problemId ?? null,
    };
  } else if (kind === 'list') {
    // 题单本身是 node；items[] 落 edges(rel='contains')，见下方边构建。
    meta = {
      date: data.date ?? null,
      itemCount: Array.isArray(data.items) ? data.items.length : 0,
    };
  } else if (kind === 'document') {
    // 实测 5 条全部 kind='STL专题' 且正文 1307–1757 字符，是有独立价值的讲义，
    // **不是**接口列表的复制品。用户要删的是"接口速查功能"，不是讲义本身，
    // 所以正文完整保留，只用一条 references-archived 边标注"相关速查已归档"。
    meta = {
      category: data.kind ?? null,   // 旧 payload 用 kind 字段表示"STL专题"
      date: data.date ?? null,
    };
  } else if (kind === 'view') {
    meta = {
      filters: data.filters ?? null,
      query: data.query ?? null,
      smart: data.smart ?? null,
    };
  } else if (kind === 'snippet') {
    // 代码放 body_md，标准放 meta。其余字段是 study 表单残留，按白名单丢弃。
    meta = {standard: data.standard ?? null};
  } else if (kind === 'mistake') {
    meta = {
      status: data.status ?? null,
      problemId: data.problemId || null,
    };
  } else if (kind === 'feedback') {
    meta = {
      category: data.category ?? null,
      due: data.due ?? null,
      status: data.status ?? null,
      problemId: data.problemId || null,
    };
  } else if (kind === 'bookmark') {
    // targetId 实测是 stl-reference.json 的 guideId（而 targetType 写的是 document，
    // 二者不自洽）。STL 已归档，原值留在 meta，边指向归档占位节点。
    meta = {
      targetId: data.targetId ?? null,
      targetType: data.targetType ?? null,
      markKind: data.markKind ?? null,
      comment: data.comment ?? null,
      location: data.location ?? null,
      sourceVersion: data.sourceVersion ?? null,
    };
  }

  meta.createdInferred = created.inferred;

  const title = typeof data.title === 'string' ? data.title : (data.name ?? '');
  // snippet 的正文是 code 字段，不是 body。
  const bodyMd = kind === 'snippet'
    ? (typeof data.code === 'string' ? data.code : '')
    : (typeof data.body === 'string' ? data.body : '');

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
    deleted,
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
    // 只有 NODE_KINDS 会成为 node；relation/taxonomy/preference/update 各有别的落点。
    const nodeRecords = scoped.filter((record) => NODE_KINDS.includes(record.kind));

    // ── 第一遍：nodes。folder 先父后子，其余顺序无关。 ──
    const folders = nodeRecords.filter((record) => record.kind === 'folder');
    const {ordered: orderedFolders, cycles} = orderFolders(folders);
    const rest = nodeRecords.filter((record) => record.kind !== 'folder');

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
    const refs = {total: 0, edges: 0, duplicates: 0, broken: [], byRel: {}, archivedDetail: [], archivedFolded: 0, skippedRelations: []};

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
    const addTypedRef = (src, targetId, expectedKind, rel, ord = 0) => {
      // 空引用不是"断链"，是"没有引用"，不计入对账总数。
      if (!targetId) return;
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
      addEdge(src, rel, targetId, ord);
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

      // ── 练习链路：state / selection / attempt / submission 都挂在 problem 上 ──
      if (record.kind === 'state' || record.kind === 'selection' || record.kind === 'attempt') {
        addTypedRef(record.id, String(data.problemId ?? ''), 'problem', 'about');
      }

      if (record.kind === 'submission') {
        addTypedRef(record.id, String(data.problemId ?? ''), 'problem', 'about');
        // submission 是 attempt 的下属：一次提交属于某一次练习记录。
        // 目标不存在时进断链清单，不造边。
        addTypedRef(record.id, String(data.attemptId ?? ''), 'attempt', 'derived_from');
      }

      // 题单条目：list → problem，rel='contains'，ord 保序
      if (record.kind === 'list') {
        const items = Array.isArray(data.items) ? data.items : [];
        items.forEach((targetId, ord) => addTypedRef(record.id, targetId, 'problem', 'contains', ord));
      }

      // STL 专题讲义：正文保留为 document 节点，另加一条"相关速查已归档"的标注边
      if (record.kind === 'document' && data.kind === 'STL专题') {
        addEdge(record.id, ARCHIVED_REF_REL, ARCHIVE_NODE.id);
      }

      // 书签的 targetId 是 guideId（targetType 却写 document，二者不自洽），同样指向归档占位
      if (record.kind === 'bookmark' && typeof data.targetId === 'string' && data.targetId) {
        const insertedEdge = addEdge(record.id, ARCHIVED_REF_REL, ARCHIVE_NODE.id);
        refs.archivedDetail.push({src: record.id, field: 'targetId', original: data.targetId, insertedEdge});
      }

      // relation 落边，不落 node。rel 用 payload 原值，不改名。
      if (record.kind === 'relation') {
        const fromId = data.from?.id;
        const toId = data.to?.id;
        const rel = typeof data.relation === 'string' && data.relation ? data.relation : null;
        if (record.deleted) {
          // edges 表没有 deleted 列：建边会让用户已删除的关系复活，所以只能跳过并记录。
          refs.skippedRelations.push({id: record.id, from: fromId, to: toId, rel, reason: '记录已软删除，edges 无 deleted 列可承接'});
        } else if (!rel) {
          refs.total += 1;
          refs.broken.push({src: record.id, targetId: `${fromId}→${toId}`, reason: 'relation 类型为空'});
        } else if (!kindIndex.has(fromId) || !kindIndex.has(toId)) {
          refs.total += 1;
          refs.broken.push({src: record.id, targetId: `${fromId}→${toId}`, reason: 'relation 端点不存在'});
        } else {
          addEdge(fromId, rel, toId);
        }
      }
    }

    // ── 非 node 落点：taxonomy → tags，preference → settings ──
    let tagsInserted = 0;
    const insertTag = db.prepare('INSERT INTO tags (id, name, parent_id, color) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING');
    for (const record of scoped.filter((item) => TAG_KINDS.includes(item.kind))) {
      const data = record.data ?? {};
      tagsInserted += insertTag.run(record.id, data.title ?? '', data.parentId || null, null).changes;
    }

    let settingsInserted = 0;
    const insertSetting = db.prepare('INSERT INTO settings (key, value, updated) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING');
    for (const record of scoped.filter((item) => SETTING_KINDS.includes(item.kind))) {
      for (const [key, value] of Object.entries(record.data ?? {})) {
        settingsInserted += insertSetting.run(key, JSON.stringify(value ?? null), record.updated).changes;
      }
    }

    const dropped = scoped.filter((item) => DROPPED_KINDS.includes(item.kind));

    report({
      scoped, rows, inserted, fileRows, archiveInserted, refs,
      unresolvedParents, pathConflicts, cycles, db,
      tagsInserted, settingsInserted, dropped,
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
  const {scoped, rows, inserted, fileRows, archiveInserted, refs, unresolvedParents, pathConflicts, cycles, db, tagsInserted, settingsInserted, dropped} = result;

  console.log('=== 迁移范围（按落点分组） ===');
  const groups = [
    ['→ nodes', NODE_KINDS],
    ['→ edges（不落 node）', EDGE_ONLY_KINDS],
    ['→ tags', TAG_KINDS],
    ['→ settings', SETTING_KINDS],
    ['→ drop（§4.8）', DROPPED_KINDS],
  ];
  let grand = 0;
  for (const [label, kinds] of groups) {
    const count = scoped.filter((record) => kinds.includes(record.kind)).length;
    grand += count;
    console.log(`  ${label.padEnd(22)} ${String(count).padStart(3)} 条  ${kinds.filter((k) => scoped.some((r) => r.kind === k)).join(' / ')}`);
  }
  console.log(`  ${'合计'.padEnd(22)} ${String(grand).padStart(3)} 条`);
  const softDeleted = scoped.filter((record) => record.deleted).length;
  console.log(`  其中软删除 ${softDeleted} 条（节点保留 deleted=1，不是抹除）`);
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

  console.log('=== 非 node 落点 ===');
  console.log(`  tags 新插入 ${tagsInserted}（taxonomy → 标签）`);
  console.log(`  settings 新插入 ${settingsInserted} 行（preference → 按 key 分行）`);
  console.log(`  drop 跳过 ${dropped.length} 条：${dropped.map((record) => `${record.id}（batchId=${record.data?.batchId}，测试残留）`).join('，') || '无'}`);
  console.log('');

  console.log('=== 被跳过的 relation（edges 无 deleted 列） ===');
  if (!refs.skippedRelations.length) console.log('  无');
  for (const item of refs.skippedRelations) console.log(`  ${item.id.slice(0, 8)} ${item.from} -${item.rel}-> ${item.to}：${item.reason}`);
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
  const ALL_KINDS = IN_SCOPE;
  const scoped = snapshot.records.filter((record) => ALL_KINDS.includes(record.kind));

  console.log('=== ① 全量对账（21 种 kind / 112 条，按落点算） ===');
  console.log('  kind        快照  落点        已落  差');
  let recordTotal = 0;
  for (const kind of IN_SCOPE) {
    const expected = scoped.filter((record) => record.kind === kind).length;
    if (!expected) continue;
    recordTotal += expected;

    let destination = 'nodes';
    let actual;
    let note = '';
    if (NODE_KINDS.includes(kind)) {
      actual = db.prepare('SELECT COUNT(*) AS c FROM nodes WHERE kind = ?').get(kind).c;
    } else if (TAG_KINDS.includes(kind)) {
      destination = 'tags';
      actual = db.prepare('SELECT COUNT(*) AS c FROM tags WHERE id = ?').get(scoped.find((r) => r.kind === kind).id).c;
    } else if (SETTING_KINDS.includes(kind)) {
      destination = 'settings';
      actual = db.prepare('SELECT COUNT(*) AS c FROM settings').get().c;
      note = '（1 条记录拆成多行 key）';
    } else if (EDGE_ONLY_KINDS.includes(kind)) {
      destination = 'edges';
      const live = scoped.filter((record) => record.kind === kind && !record.deleted).length;
      actual = live;
      note = `（${expected - live} 条软删除已跳过：edges 无 deleted 列）`;
    } else {
      destination = 'drop';
      actual = 0;
      note = '（§4.8 故意丢弃：测试残留）';
    }

    // settings（1 记录拆多行）、edges（软删除的跳过）、drop（故意丢弃）都属"按设计不等"，
    // 差列显示 —，不当作失败；它们的偏离原因写在备注里，仍逐条可见。
    const isSetting = SETTING_KINDS.includes(kind);
    const explained = isSetting || EDGE_ONLY_KINDS.includes(kind) || DROPPED_KINDS.includes(kind);
    const diff = explained ? '—' : String(actual - expected);
    const ok = explained || actual === expected;
    if (!ok) problems.push(`${kind}: 快照 ${expected} / 落点 ${actual}`);
    console.log(`  ${kind.padEnd(11)} ${String(expected).padStart(3)}  ${destination.padEnd(11)} ${String(actual).padStart(3)}  ${diff.padStart(3)}  ${ok ? '✓' : '✖'} ${note}`);
  }
  console.log(`  合计快照记录 ${recordTotal} 条`);
  const nodeTotal = db.prepare("SELECT COUNT(*) AS c FROM nodes WHERE kind <> 'archive'").get().c;
  console.log(`  → 其中落成 nodes 的 ${nodeTotal} 条（不含 archive 占位），其余 ${recordTotal - nodeTotal} 条落到 tags/settings/edges/drop`);
  if (recordTotal !== snapshot.records.length) problems.push(`快照总数 ${recordTotal} ≠ ${snapshot.records.length}`);
  const archive = db.prepare("SELECT COUNT(*) AS c FROM nodes WHERE kind = 'archive'").get().c;
  console.log(`  另有 archive 占位节点 ${archive} 个（不在快照内，预期 1）`);
  if (archive !== 1) problems.push(`archive 占位节点数 ${archive} ≠ 1`);
  console.log('');

  console.log('=== ② 抽样逐字段比对（仅 node 类 kind） ===');
  for (const kind of NODE_KINDS) {
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

  console.log('=== ⑦ state：about 边与「一题一份状态」唯一约束 ===');
  const stateEdges = db.prepare("SELECT COUNT(*) AS c FROM edges WHERE rel = 'about' AND src IN (SELECT id FROM nodes WHERE kind = 'state')").get().c;
  const stateNodes = db.prepare("SELECT COUNT(*) AS c FROM nodes WHERE kind = 'state'").get().c;
  console.log(`  state 节点 ${stateNodes} 个；state→problem 的 about 边 ${stateEdges} 条 ${stateEdges === stateNodes ? '✓' : '✖'}`);
  if (stateEdges !== stateNodes) problems.push(`state 边数 ${stateEdges} ≠ state 节点数 ${stateNodes}`);

  const dupState = db
    .prepare("SELECT json_extract(meta,'$.problemId') AS pid, COUNT(*) AS c FROM nodes WHERE kind='state' AND deleted=0 GROUP BY pid HAVING c > 1")
    .all();
  console.log(`  同一 problemId 出现多份 state：${dupState.length} 组 ${dupState.length === 0 ? '✓' : '✖'}`);
  if (dupState.length) problems.push(`${dupState.length} 组 state 重复`);

  // 真的去撞一下唯一索引，证明它是生效的（而不是只存在于 DDL 里）
  const anyState = db.prepare("SELECT meta FROM nodes WHERE kind='state' AND deleted=0 LIMIT 1").get();
  if (anyState) {
    const {problemId} = JSON.parse(anyState.meta);
    let blocked = false;
    try {
      db.prepare(
        `INSERT INTO nodes (id, kind, title, body_md, origin, meta, search_text, created, updated)
         VALUES ('__dup_state_probe__','state','','','user',?,'','2026-10-28T00:00:00.000Z','2026-10-28T00:00:00.000Z')`,
      ).run(JSON.stringify({problemId}));
    } catch {
      blocked = true;
    } finally {
      db.prepare("DELETE FROM nodes WHERE id='__dup_state_probe__'").run();
    }
    console.log(`  对 ${problemId} 再插一份 state 被唯一索引拒绝：${blocked ? '是 ✓' : '否 ✖'}`);
    if (!blocked) problems.push('nodes_state_problem 唯一索引没挡住重复 state');
  }
  console.log('');

  console.log('=== ⑧ selection：日期分组 ===');
  const selectionDays = db
    .prepare("SELECT json_extract(meta,'$.day') AS day, COUNT(*) AS c FROM nodes WHERE kind='selection' GROUP BY day ORDER BY day")
    .all();
  console.log(`  selection ${db.prepare("SELECT COUNT(*) AS c FROM nodes WHERE kind='selection'").get().c} 条，按日期分组 ${selectionDays.length} 组`);
  for (const row of selectionDays) console.log(`    ${row.day ?? '(空日期)'} → ${row.c} 条`);
  if (selectionDays.length === 0 || selectionDays.some((row) => !row.day)) problems.push('selection 存在空日期或无法分组');
  console.log('');

  console.log('=== ⑨ attempt：minutes 为空必须存 NULL 而非 0 ===');
  const attempts = db.prepare("SELECT id, meta FROM nodes WHERE kind='attempt'").all().map((row) => ({id: row.id, meta: JSON.parse(row.meta)}));
  const nullMinutes = attempts.filter((item) => item.meta.minutes === null).length;
  const zeroMinutes = attempts.filter((item) => item.meta.minutes === 0).length;
  const unknownFlag = attempts.filter((item) => item.meta.minutesUnknown === true).length;
  console.log(`  attempt ${attempts.length} 条：minutes=null ${nullMinutes} 条，minutes=0 ${zeroMinutes} 条，minutesUnknown=true ${unknownFlag} 条`);
  const minutesOk = nullMinutes === attempts.length && zeroMinutes === 0 && unknownFlag === attempts.length;
  console.log(`  判定：${minutesOk ? '✓ 全部 NULL 且标记未知，没有把"没记"写成"0 分钟"' : '✖ 存在 0 或标记不一致'}`);
  if (!minutesOk) problems.push('attempt.minutes 存值不符合「空即 NULL」要求');
  console.log('');

  console.log('=== ⑩ submission → attempt ===');
  const submissionCount = db.prepare("SELECT COUNT(*) AS c FROM nodes WHERE kind='submission'").get().c;
  const submissionAttemptEdges = db.prepare("SELECT dst FROM edges WHERE rel='derived_from' AND src IN (SELECT id FROM nodes WHERE kind='submission')").all();
  console.log(`  submission ${submissionCount} 条；derived_from → attempt 边 ${submissionAttemptEdges.length} 条`);
  for (const edge of submissionAttemptEdges) {
    const targetKind = db.prepare('SELECT kind FROM nodes WHERE id = ?').get(edge.dst)?.kind;
    console.log(`    → ${edge.dst}（kind=${targetKind ?? '不存在'}）${targetKind === 'attempt' ? '✓' : '✖'}`);
    if (targetKind !== 'attempt') problems.push(`submission→attempt 边目标 kind=${targetKind}`);
  }
  console.log('');

  console.log('=== ⑪ document：kind 分布与归档标注边 ===');
  const documents = db.prepare("SELECT id, meta, length(body_md) AS len FROM nodes WHERE kind='document'").all();
  const docCategories = {};
  let stlEdges = 0;
  for (const doc of documents) {
    const category = JSON.parse(doc.meta).category ?? '(无)';
    docCategories[category] = (docCategories[category] ?? 0) + 1;
    const edge = db.prepare("SELECT 1 AS x FROM edges WHERE src=? AND rel=?").get(doc.id, ARCHIVED_REF_REL);
    if (edge) stlEdges += 1;
  }
  console.log(`  document ${documents.length} 条；分类分布 ${JSON.stringify(docCategories)}`);
  console.log(`  正文长度 ${documents.map((doc) => doc.len).join(' / ')} 字符（都有实质内容，非接口列表副本）`);
  console.log(`  指向归档占位的 ${ARCHIVED_REF_REL} 边 ${stlEdges} 条 ${stlEdges === documents.length ? '✓' : '✖'}`);
  if (stlEdges !== documents.length) problems.push(`document 归档标注边 ${stlEdges} ≠ ${documents.length}`);
  console.log('');

  console.log('=== ⑫ review：状态分布与 due 可比较性 ===');
  const reviews = db.prepare("SELECT id, meta, deleted FROM nodes WHERE kind='review'").all().map((row) => ({id: row.id, deleted: row.deleted, meta: JSON.parse(row.meta)}));
  const statusDist = {};
  for (const review of reviews) statusDist[`${review.meta.status}${review.deleted ? '(已删除)' : ''}`] = (statusDist[`${review.meta.status}${review.deleted ? '(已删除)' : ''}`] ?? 0) + 1;
  console.log(`  review ${reviews.length} 条；状态分布 ${JSON.stringify(statusDist)}`);
  const dueFormatOk = reviews.every((review) => /^\d{4}-\d{2}-\d{2}$/.test(String(review.meta.due)));
  console.log(`  due 全部为 YYYY-MM-DD（可直接字符串比较）：${dueFormatOk ? '是 ✓' : '否 ✖'}`);
  if (!dueFormatOk) problems.push('review.due 存在非 YYYY-MM-DD 值');
  const dueQueryAll = db.prepare("SELECT COUNT(*) AS c FROM nodes WHERE kind='review' AND json_extract(meta,'$.due') <= '2026-10-28'").get().c;
  const dueQueryLive = db.prepare("SELECT COUNT(*) AS c FROM nodes WHERE kind='review' AND deleted=0 AND json_extract(meta,'$.due') <= '2026-10-28'").get().c;
  console.log(`  WHERE due <= '2026-10-28'（含已删除）→ ${dueQueryAll} 条；再加 deleted=0 → ${dueQueryLive} 条`);
  console.log(`  索引 nodes_review_due 存在：${db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='index' AND name='nodes_review_due'").get() ? '是 ✓' : '否 ✖'}`);
  console.log('');

  console.log('=== ⑬ list → problem 的 contains 边 ===');
  const lists = db.prepare("SELECT id, meta FROM nodes WHERE kind='list'").all().map((row) => ({id: row.id, meta: JSON.parse(row.meta)}));
  const containsEdges = db.prepare("SELECT src, dst FROM edges WHERE rel='contains'").all();
  const expectedItems = lists.reduce((sum, list) => sum + (list.meta.itemCount ?? 0), 0);
  console.log(`  list ${lists.length} 条，声明条目合计 ${expectedItems}；实际 contains 边 ${containsEdges.length} 条`);
  console.log(`  例：${lists[0]?.id}（${lists[0]?.meta.date}）→ ${lists[0]?.meta.itemCount} 条`);
  const badContains = containsEdges.filter((edge) => db.prepare('SELECT kind FROM nodes WHERE id=?').get(edge.dst)?.kind !== 'problem');
  console.log(`  dst 不是 problem 的边：${badContains.length} ${badContains.length === 0 ? '✓' : '✖'}`);
  console.log('');

  console.log('=== ⑭ relation → edges（rel 用原值） ===');
  const relEdges = db.prepare("SELECT src, rel, dst FROM edges WHERE rel NOT IN ('about','mentions','part_of','contains','derived_from',?)").all(ARCHIVED_REF_REL);
  console.log(`  非标准 rel 的边 ${relEdges.length} 条（应来自 relation）`);
  for (const edge of relEdges) {
    const srcKind = db.prepare('SELECT kind FROM nodes WHERE id=?').get(edge.src)?.kind;
    const dstKind = db.prepare('SELECT kind FROM nodes WHERE id=?').get(edge.dst)?.kind;
    console.log(`    ${edge.src}(${srcKind}) -${edge.rel}-> ${edge.dst}(${dstKind})`);
  }
  const relationNodes = db.prepare("SELECT COUNT(*) AS c FROM nodes WHERE kind='relation'").get().c;
  console.log(`  nodes 里是否有 kind='relation'：${relationNodes} 条 ${relationNodes === 0 ? '✓ 正确（relation 不落 node）' : '✖ 不该有'}`);
  if (relationNodes) problems.push(`relation 被错误落成 node（${relationNodes} 条）`);
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
