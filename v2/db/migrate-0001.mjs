#!/usr/bin/env node
/**
 * 迁移 0001：建立 AlgoNotes v2 数据库与全部表/索引/触发器。
 *
 * DDL 的唯一来源是 `v2/db/schema.sql`（可直接 `sqlite3 < schema.sql` 执行），
 * 本脚本只负责把它应用到目标库并做健康检查，避免 DDL 出现两份互相漂移的副本。
 *
 * 用法：
 *   node --experimental-sqlite v2/db/migrate-0001.mjs
 *   node --experimental-sqlite v2/db/migrate-0001.mjs --db v2/data/algonotes.sqlite
 *   node --experimental-sqlite v2/db/migrate-0001.mjs --self-test
 *
 * 幂等：全部语句使用 IF NOT EXISTS，重复执行不会报错也不会改变结构。
 * `--self-test` 会在保存点内插入/更新/删除一条中文节点并验证 FTS5 检索，
 * 结束时回滚，不会在库里留下任何自检数据。
 */
import {DatabaseSync} from 'node:sqlite';
import {existsSync, mkdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {toMatchQuery, toSearchText} from './fts-text.mjs';

/** 本文件所在目录（v2/db）。 */
const HERE = dirname(fileURLToPath(import.meta.url));

/** 默认库路径：v2/data/algonotes.sqlite（data/ 已进 .gitignore）。 */
const DEFAULT_DB = resolve(HERE, '..', 'data', 'algonotes.sqlite');

/** schema.sql 与本脚本同目录。 */
const SCHEMA_PATH = resolve(HERE, 'schema.sql');

/**
 * 解析命令行参数。
 *
 * @param {string[]} argv 脚本名之后的参数。
 * @return {{db: string, selfTest: boolean}} 解析结果。
 */
function parseArgs(argv) {
  const options = {db: DEFAULT_DB, selfTest: false};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--self-test') options.selfTest = true;
    else if (arg === '--db') options.db = resolve(argv[++index]);
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

/**
 * 打开（必要时创建）目标数据库。
 *
 * `node:sqlite` 的 `DatabaseSync` 在文件不存在时直接创建，因此外部 SQLite
 * 驱动不是必需的 —— 建库能力已由 Node 内置模块覆盖。
 *
 * @param {string} path 目标库路径。
 * @return {DatabaseSync} 可写连接。
 */
function openDatabase(path) {
  mkdirSync(dirname(path), {recursive: true});
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/**
 * 读取并执行 schema.sql。
 *
 * @param {DatabaseSync} db 目标连接。
 * @param {string} schemaPath DDL 文件路径。
 * @return {number} 执行的 DDL 语句数量的粗略计数（以分号行首断句）。
 */
function applySchema(db, schemaPath) {
  const sql = readFileSync(schemaPath, 'utf8');
  db.exec(sql);
  return (sql.match(/;\s*$/gm) ?? []).length;
}

/**
 * 收集库结构清单。
 *
 * @param {DatabaseSync} db 目标连接。
 * @return {{tables: string[], indexes: string[], triggers: string[]}} 结构清单。
 */
function inventory(db) {
  const namesOf = (type) =>
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all(type)
      .map((row) => row.name);
  return {tables: namesOf('table'), indexes: namesOf('index'), triggers: namesOf('trigger')};
}

/**
 * FTS5 内部影子表的名字特征。它们由 SQLite 自动维护，不属于业务表。
 *
 * @param {string} name 表名。
 * @return {boolean} 是否为 FTS5 影子表。
 */
function isFtsShadow(name) {
  return name.startsWith('nodes_fts_');
}

/**
 * 打印结构与重要性状。
 *
 * @param {DatabaseSync} db 目标连接。
 * @param {string} dbPath 库路径。
 */
function reportStructure(db, dbPath) {
  const {tables, indexes, triggers} = inventory(db);
  const businessTables = tables.filter((name) => !isFtsShadow(name));
  const shadowTables = tables.filter(isFtsShadow);

  console.log(`库文件        ${dbPath}`);
  console.log(`库大小        ${(statSync(dbPath).size / 1024).toFixed(1)} KB`);
  console.log(`journal_mode  ${db.prepare('PRAGMA journal_mode').get().journal_mode}`);
  console.log(`foreign_keys  ${db.prepare('PRAGMA foreign_keys').get().foreign_keys}`);
  console.log(`SQLite        ${db.prepare('SELECT sqlite_version() AS v').get().v}`);
  console.log('');
  console.log(`业务表 ${businessTables.length} 个：${businessTables.join(', ')}`);
  console.log(`FTS5 影子表 ${shadowTables.length} 个：${shadowTables.join(', ') || '（无）'}`);
  console.log(`索引 ${indexes.length} 个：${indexes.join(', ')}`);
  console.log(`触发器 ${triggers.length} 个：${triggers.join(', ')}`);
  console.log(`sqlite_master 中 type='table' 共 ${tables.length} 行（含影子表）`);
}

/**
 * 断言辅助：条件不成立就抛错。
 *
 * @param {boolean} condition 断言条件。
 * @param {string} message 失败信息。
 */
function check(condition, message) {
  if (!condition) throw new Error(`自检失败：${message}`);
}

/**
 * 在保存点内验证「写入即可检索」，结束后回滚，不留下任何数据。
 *
 * 覆盖四种情况：中文命中、英文命中、未命中、删除后索引同步。
 *
 * @param {DatabaseSync} db 目标连接。
 */
function selfTest(db) {
  const nodeId = 'selftest-zh-0001';
  const title = '中文二元组自检';
  const body = '用 monotonic stack 维护边界';

  /** 在 FTS 里查一个查询串，返回命中的 id 列表。 */
  const search = (keyword) => {
    const query = toMatchQuery(keyword);
    if (!query) return [];
    return db
      .prepare('SELECT n.id FROM nodes_fts JOIN nodes n ON n.rowid = nodes_fts.rowid WHERE nodes_fts MATCH ? ORDER BY rank')
      .all(query)
      .map((row) => row.id);
  };

  db.exec('SAVEPOINT selftest');
  try {
    db.prepare(
      `INSERT INTO nodes (id, kind, title, body_md, search_text, created, updated)
       VALUES (?, 'note', ?, ?, ?, '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z')`,
    ).run(nodeId, title, body, toSearchText(title, body));

    const zhHits = search('二元');
    console.log(`  中文查询 MATCH "${toMatchQuery('二元')}" → 命中 ${zhHits.length} 条 ${JSON.stringify(zhHits)}`);
    check(zhHits.length === 1 && zhHits[0] === nodeId, '中文二元组应命中 1 条');

    const enHits = search('stack');
    console.log(`  英文查询 MATCH "${toMatchQuery('stack')}" → 命中 ${enHits.length} 条`);
    check(enHits.length === 1, '英文 token 应命中 1 条');

    const missHits = search('不存在的关键词');
    console.log(`  未命中查询 → 命中 ${missHits.length} 条`);
    check(missHits.length === 0, '无关关键词不应命中');

    // 更新后旧 token 必须消失、新 token 必须出现（触发器 au 正确性）。
    db.prepare('UPDATE nodes SET title = ?, search_text = ? WHERE id = ?').run('边界单调栈', toSearchText('边界单调栈', body), nodeId);
    const afterUpdateOld = search('二元');
    const afterUpdateNew = search('单调');
    console.log(`  更新后旧词 "二元" → ${afterUpdateOld.length} 条；新词 "单调" → ${afterUpdateNew.length} 条`);
    check(afterUpdateOld.length === 0, '更新后旧 token 应不再命中');
    check(afterUpdateNew.length === 1, '更新后新 token 应命中');

    // 删除后索引必须同步清空（触发器 ad 正确性）。
    db.prepare('DELETE FROM nodes WHERE id = ?').run(nodeId);
    const afterDelete = search('单调');
    console.log(`  删除后查询 "单调" → ${afterDelete.length} 条`);
    check(afterDelete.length === 0, '删除后不应再命中');

    console.log('  自检通过：写入→检索→更新→删除 全链路一致');
  } finally {
    db.exec('ROLLBACK TO selftest; RELEASE selftest');
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(SCHEMA_PATH)) throw new Error(`找不到 DDL：${SCHEMA_PATH}`);

  const db = openDatabase(options.db);
  try {
    const statementCount = applySchema(db, SCHEMA_PATH);
    console.log(`已应用 schema.sql（约 ${statementCount} 条语句，幂等）`);
    console.log('');
    reportStructure(db, options.db);

    if (options.selfTest) {
      console.log('');
      console.log('FTS5 自检（保存点内，结束回滚）：');
      selfTest(db);
      const residue = db.prepare('SELECT COUNT(*) AS c FROM nodes').get().c;
      console.log(`  回滚后 nodes 行数 ${residue}（应为 0，自检数据未落库）`);
      check(residue === 0, '自检不应留下数据');
    }
    return 0;
  } finally {
    db.close();
  }
}

process.exitCode = main();
