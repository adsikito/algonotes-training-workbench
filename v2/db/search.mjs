/**
 * 节点检索入口：≥2 字符走 FTS5，单字符与非法 FTS 语法降级走 LIKE。
 *
 * 为什么需要降级：`nodes_fts` 用的是 `unicode61` 分词器 + 写入时二元组展开
 * （见 `fts-text.mjs`）。二元组索引里**不存在长度为 1 的中文 token**，所以
 * `MATCH '组'` 永远命中不了 —— 这不是配置错误，是二元组方案的固有代价。
 * 架构文档里"单字也能命中"的说法与实测不符，**以实测为准**：
 * 单字查询改走 `LIKE '%q%'` 扫 `title` / `body_md`。
 *
 * 三种执行模式（返回值里的 `mode`）：
 * - `fts`           正常全文检索，按相关性排序；
 * - `like`          单字符查询，走 LIKE；
 * - `like-fallback` MATCH 抛语法错误（引号、星号、连字符等）后退回 LIKE，
 *                   保证调用方永远拿不到 FTS 语法异常。
 */
import {toMatchQuery} from './fts-text.mjs';

/** LIKE 通配符转义：查询串里的 % _ \ 必须按字面匹配。 */
const LIKE_SPECIALS = /[\\%_]/g;

/** 默认返回条数上限。 */
const DEFAULT_LIMIT = 50;

/**
 * 判断查询串是否短到无法用二元组索引命中的程度。
 *
 * 用码点长度而不是 `length`，避免把 emoji 等代理对算成 2 个字符。
 *
 * @param {string} text 查询串。
 * @return {boolean} 少于 2 个码点时为 true。
 */
export function isSingleUnit(text) {
  return [...text].length < 2;
}

/**
 * LIKE 降级检索：扫 title 与 body_md。
 *
 * @param {import('node:sqlite').DatabaseSync} db 连接。
 * @param {string} query 已 trim 的查询串。
 * @param {number} limit 条数上限。
 * @return {Array<{id: string, kind: string, title: string}>} 命中行。
 */
function likeSearch(db, query, limit) {
  const pattern = `%${query.replace(LIKE_SPECIALS, (char) => `\\${char}`)}%`;
  return db
    .prepare(
      `SELECT n.id, n.kind, n.title
         FROM nodes n
        WHERE n.deleted = 0
          AND (n.title LIKE ? ESCAPE '\\' OR n.body_md LIKE ? ESCAPE '\\')
        ORDER BY n.updated DESC
        LIMIT ?`,
    )
    .all(pattern, pattern, limit);
}

/**
 * FTS5 全文检索。
 *
 * @param {import('node:sqlite').DatabaseSync} db 连接。
 * @param {string} query 已 trim 的查询串。
 * @param {number} limit 条数上限。
 * @return {Array<{id: string, kind: string, title: string}>} 命中行，按 rank 排序。
 */
function ftsSearch(db, query, limit) {
  return db
    .prepare(
      `SELECT n.id, n.kind, n.title
         FROM nodes_fts
         JOIN nodes n ON n.rowid = nodes_fts.rowid
        WHERE nodes_fts MATCH ? AND n.deleted = 0
        ORDER BY rank
        LIMIT ?`,
    )
    .all(toMatchQuery(query), limit);
}

/**
 * 检索节点。
 *
 * @param {import('node:sqlite').DatabaseSync} db 连接。
 * @param {string} query 用户输入。
 * @param {{limit?: number}} [options] 选项。
 * @return {{mode: 'empty'|'fts'|'like'|'like-fallback', rows: Array<object>, note?: string}}
 *     `mode` 说明走了哪条路径，便于调用方与测试断言。
 */
export function searchNodes(db, query, options = {}) {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const trimmed = String(query ?? '').trim();
  if (!trimmed) return {mode: 'empty', rows: []};

  if (isSingleUnit(trimmed)) {
    return {mode: 'like', rows: likeSearch(db, trimmed, limit), note: '单字符查询：二元组索引无法命中，已降级为 LIKE'};
  }

  try {
    return {mode: 'fts', rows: ftsSearch(db, trimmed, limit)};
  } catch (error) {
    // MATCH 语法错误（例如查询串里带 " 或 *）不应该把异常抛给 UI。
    return {
      mode: 'like-fallback',
      rows: likeSearch(db, trimmed, limit),
      note: `FTS 语法错误已降级为 LIKE：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
