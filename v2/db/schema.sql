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
