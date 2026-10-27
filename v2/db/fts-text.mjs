/**
 * 中文全文检索的二元组（bigram）展开工具。
 *
 * 为什么需要它：FTS5 的 `unicode61` 分词器把**一整段连续汉字当成一个 token**。
 * 例如「中文二元组」会被切成一个 token，因此 `MATCH '二元'` 命中不了它。
 * 这是分词器行为，不是配置错误。
 *
 * 解决办法（架构文档 §2.3.3 的设计）：写入时把标题与正文预先展开成二元组，
 * 存进 `nodes.search_text`；查询时对查询串做同样的展开。两侧规则一致，才能命中。
 *
 * 已知限制（刻意不处理，避免索引膨胀）：
 * - **单个汉字查询无法命中。** 二元组索引里不存在长度为 1 的中文 token。
 *   这是二元组方案的固有代价，不是配置错误；架构文档里"单字也能命中"的说法
 *   与实测不符，**以实测为准**。
 *   → **降级路径已经实现**：`db/search.mjs` 的 `searchNodes()` 在查询串少于
 *   2 个码点时改走 `LIKE '%q%'` 扫 `title` / `body_md`；MATCH 抛语法错误时
 *   （引号、星号等）也走同一条降级。**调用方一律用 `searchNodes()`，不要直接
 *   写 `nodes_fts MATCH`**，否则单字查询会静默返回空。
 * - 未做繁简/异体归一化。
 */

/** 单个 CJK 字符（汉字各扩展区 + 兼容表意文字 + 日文假名）。 */
const CJK_CHAR = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF]/;

/** 把文本切成「连续 CJK 片段」与「其它片段」两类。 */
const SEGMENTS = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF]+|[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF]+/gu;

/** 非 CJK 片段里，连续字母/数字/下划线算一个词。 */
const WORDS = /[\p{L}\p{N}_]+/gu;

/**
 * 把一段文本展开成用于索引/查询的 token 列表。
 *
 * - 连续汉字/假名：产出全部相邻二元组（片段长度 1 时产出该字本身）。
 * - 其它字符：按词切分并小写化。
 *
 * @param {string} text 原始文本。
 * @return {string[]} token 列表，已去重且保持首次出现的顺序。
 */
export function toTokens(text) {
  const tokens = [];
  const seen = new Set();

  /** 去重后追加一个 token。 */
  const push = (token) => {
    if (!token) return;
    const normalized = token.toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    tokens.push(normalized);
  };

  for (const [chunk] of String(text ?? '').matchAll(SEGMENTS)) {
    if (CJK_CHAR.test(chunk[0])) {
      if (chunk.length === 1) {
        push(chunk);
      } else {
        for (let index = 0; index + 1 < chunk.length; index += 1) {
          push(chunk.slice(index, index + 2));
        }
      }
    } else {
      for (const [word] of chunk.matchAll(WORDS)) push(word);
    }
  }

  return tokens;
}

/**
 * 把若干段文本合并成 `nodes.search_text` 的存储形态。
 *
 * 用换行连接各片段，保证跨段不会误生成一个跨边界的二元组。
 *
 * @param {...string} parts 需要索引的文本片段（标题、正文等）。
 * @return {string} 以空格分隔的 token 串。
 */
export function toSearchText(...parts) {
  return toTokens(parts.filter(Boolean).join('\n')).join(' ');
}

/**
 * 把用户查询串转成 FTS5 `MATCH` 表达式。
 *
 * 多个 token 之间用空格连接，FTS5 视作隐式 AND。
 *
 * @param {string} query 用户输入。
 * @return {string} FTS5 MATCH 表达式；无有效 token 时返回空串。
 */
export function toMatchQuery(query) {
  return toTokens(query).join(' ');
}
