-- AlgoNotes v2 数据层 schema —— 迁移 0001
--
-- 来源：project-docs/08-本轮方案-2026-10-27/06-架构重构方案-四章.md §2.3.3 DDL 骨架
-- 该文件可直接执行：sqlite3 v2/data/algonotes.sqlite < v2/db/schema.sql
-- 也可由 v2/db/migrate-0001.mjs 应用（两者用的是同一份文件，避免 DDL 双份漂移）。
--
-- 全部语句都是幂等的（IF NOT EXISTS），重复执行不会报错。

-- ① 单写多读 + 崩溃一致性。WAL 下 synchronous=NORMAL 已足够，无需 FULL。
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

-- ② 统一实体：一切皆 node（R1 统一入口的物理基础）
CREATE TABLE IF NOT EXISTS nodes (
  id          TEXT PRIMARY KEY,                 -- ULID；导入时保留旧 id 前缀映射
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  body_md     TEXT NOT NULL DEFAULT '',
  parent_id   TEXT REFERENCES nodes(id) ON DELETE SET NULL,   -- 文件夹树，R4 目录保真
  origin      TEXT NOT NULL DEFAULT 'user',     -- user | seed | import
  meta        TEXT NOT NULL DEFAULT '{}',       -- 仅稀疏字段，单行 ≤ 4KB
  search_text TEXT NOT NULL DEFAULT '',         -- 写入时展开的中文二元组（见 fts-text.mjs）
  created     TEXT NOT NULL,
  updated     TEXT NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS nodes_kind_updated ON nodes(kind, updated DESC) WHERE deleted = 0;
CREATE INDEX IF NOT EXISTS nodes_parent       ON nodes(parent_id, title);
CREATE INDEX IF NOT EXISTS nodes_updated      ON nodes(updated DESC, id);
-- 同一目录下标题唯一（软删除的行不参与）。根节点的 parent_id 走 NULL。
CREATE UNIQUE INDEX IF NOT EXISTS nodes_path  ON nodes(parent_id, title) WHERE deleted = 0;

-- ③ 边：relation 从"记录"降级为"边"（R3 的关键）
CREATE TABLE IF NOT EXISTS edges (
  src TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  rel TEXT NOT NULL,            -- about | part_of | derived_from | bookmark | mentions
  dst TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (src, rel, dst)
);
CREATE INDEX IF NOT EXISTS edges_dst ON edges(dst, rel);   -- 反查：一个题目/文件下的全部笔记

-- ④ 标签：taxonomy 从"记录"降级为"标签"（R2 的关键）
CREATE TABLE IF NOT EXISTS tags (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  parent_id TEXT REFERENCES tags(id),
  color     TEXT
);
CREATE TABLE IF NOT EXISTS node_tags (
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (node_id, tag_id)
);
CREATE INDEX IF NOT EXISTS node_tags_tag ON node_tags(tag_id, node_id);  -- 标签 → 内容列表

-- ⑤ 全文：FTS5 external content，不复制正文
--
-- 注意 tokenizer：unicode61 会把一整段连续汉字当成一个 token，因此中文检索
-- 依赖两件事同时成立 ——
--   a) 写入时把标题/正文展开成二元组存进 nodes.search_text（见 db/fts-text.mjs）；
--   b) 查询串也用同一套二元组规则展开。
-- 只靠 unicode61 无法对中文子串命中，这是刻意设计而不是遗漏。
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  title, body_md, search_text,
  content='nodes', content_rowid='rowid',
  tokenize="unicode61 remove_diacritics 2"
);

-- FTS5 external content 的三个同步触发器（架构文档标注"此处省略"，此处补齐）
CREATE TRIGGER IF NOT EXISTS nodes_fts_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO nodes_fts(rowid, title, body_md, search_text)
  VALUES (new.rowid, new.title, new.body_md, new.search_text);
END;

CREATE TRIGGER IF NOT EXISTS nodes_fts_ad AFTER DELETE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, title, body_md, search_text)
  VALUES ('delete', old.rowid, old.title, old.body_md, old.search_text);
END;

CREATE TRIGGER IF NOT EXISTS nodes_fts_au AFTER UPDATE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, title, body_md, search_text)
  VALUES ('delete', old.rowid, old.title, old.body_md, old.search_text);
  INSERT INTO nodes_fts(rowid, title, body_md, search_text)
  VALUES (new.rowid, new.title, new.body_md, new.search_text);
END;

-- ⑥ 自定义类型：只给"用户自定义类型"用，内置 kind 走 nodes 列
CREATE TABLE IF NOT EXISTS content_types (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  schema    TEXT NOT NULL,
  templates TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS node_fields (
  node_id  TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  key      TEXT NOT NULL,
  kind     TEXT NOT NULL,        -- text | num | date | json | ref
  val_text TEXT,
  val_num  REAL,
  val_json TEXT,
  PRIMARY KEY (node_id, key)
);
CREATE INDEX IF NOT EXISTS node_fields_text ON node_fields(key, val_text);
CREATE INDEX IF NOT EXISTS node_fields_num  ON node_fields(key, val_num);

-- ⑦ 版本：保留最近 20 版 + 其余压成归档（H7 的解）
CREATE TABLE IF NOT EXISTS node_revisions (
  node_id  TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  version  INTEGER NOT NULL,
  body_md  TEXT NOT NULL,
  meta     TEXT,
  updated  TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (node_id, version)
);

-- ⑧ 文件字节元数据出 payload（H9 的解：额度查询变成一次 SUM 索引扫描）
CREATE TABLE IF NOT EXISTS files (
  node_id    TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  rel_path   TEXT NOT NULL,      -- 磁盘相对路径，保留目录结构（R4）
  size       INTEGER NOT NULL,
  mime       TEXT,
  sha256     TEXT,
  text_bytes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS files_size ON files(size);

-- ⑨ 幂等（沿用旧机制，键换成全局 key）
CREATE TABLE IF NOT EXISTS operations (
  key      TEXT PRIMARY KEY,
  hash     TEXT NOT NULL,
  response TEXT NOT NULL,
  created  TEXT NOT NULL
);

-- ⑩ 布局/阅读偏好：承接旧 `preference` kind（§2.3.4 映射 → setting）
--
-- 刻意**不用** §4.8 写的"单行 KV"，改为按 key 分行，理由：
--   1) 偏好有 13 项且相互独立。单行整存时，"改字号"的写入会覆盖同一时刻改的
--      侧栏宽度（read-modify-write 的丢失更新）；分行后每次只写自己那个 key。
--   2) 服务端常常只需要其中几项，分行可以只读需要的 key，不必每次取整份。
--   3) 单个值损坏不影响其余键。
-- 每行的 value 存 JSON（标量/数组/对象都能表达），updated 供增量同步用。
CREATE TABLE IF NOT EXISTS settings (
  key     TEXT PRIMARY KEY,
  value   TEXT NOT NULL,     -- JSON 编码的单个值
  updated TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS settings_updated ON settings(updated);

-- ⑪ 内容批次：承接旧 `update` kind（§4.8：`update` → drop，改由本表管理）
--
-- **刻意不把状态塞进一个字段。** 这里有两个正交概念：
--   a) 内容包的生命周期（这份内容作为资产存在多久）
--        `status`: draft → validated → published → archived
--   b) 一次应用操作的结果（这批内容有没有成功写进库）
--        `applied_at IS NULL` = 未应用；`error IS NOT NULL` = 失败
--        成功时 `applied_count` 记录实际写入条数。
--
-- `status` **不加 CHECK**：生命周期还会演进（比如增加 reviewing），用 CHECK 锁死
-- 取值等于每次状态机升级都要做一次表迁移，而单用户场景下应用层校验足够。
-- 代价是 DB 层不再拦脏值——所以写入路径必须经 `v2/` 的 service 层，不要裸写 SQL。
--
-- `digest` 存整批内容摘要：同 id 但 digest 不同 = 同名批次内容被改过，写入前必须拒绝。
-- `item_count` 是"批次声明了多少条"，`applied_count` 是"这次实际写进多少条"，
-- 两者可能不同（部分失败、去重跳过），不能合并成一个字段。
CREATE TABLE IF NOT EXISTS content_packs (
  id            TEXT PRIMARY KEY,
  digest        TEXT NOT NULL,
  status        TEXT NOT NULL,              -- draft | validated | published | archived（应用层校验）
  item_count    INTEGER NOT NULL DEFAULT 0, -- 批次声明的条目数
  applied_count INTEGER NOT NULL DEFAULT 0, -- 实际写入的条目数
  created       TEXT NOT NULL,
  applied_at    TEXT,                       -- NULL = 未应用
  error         TEXT                        -- 非 NULL = 失败原因
);
CREATE INDEX IF NOT EXISTS content_packs_status ON content_packs(status, created DESC);
