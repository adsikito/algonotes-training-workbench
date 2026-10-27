# v2 重构行为对照基准（2026-10）

> 状态：**可执行，非全绿**。10 个脚本全部可由一条命令运行，9 个文件、199 条断言通过；
> 3 条断言失败于 `tests/study.test.ts` 的统计口径，根因已定位到业务代码
> `lib/domain.ts`（见 §6）。另有一项**与本次改动无关的既有阻塞**：`pnpm lint`
> 在 `main` 上本来就是红的（见 §7）。

- 建立时间：2026-10-27
- 基线锚点：`e2692d6`「chore: snapshot before v2 rebuild」/ 标签 `pre-rebuild-2026-10-27`
- 运行环境：Node v22.22.2、pnpm 11.25.0、Windows（Git Bash）
- 本次改动不涉及任何业务代码（`app/` `components/` `lib/` 零改动）

---

## 1. 这套断言是什么

`tests/` 下 10 个文件**不是测试框架结构**，是脚本式断言：文件顶层直接写
`import assert from 'node:assert/strict'`，断言顺序执行，任一失败即整文件中止，末尾
`console.log(...)` 自报通过条数。全部文件 `describe` / `it` / `test` 出现次数为 **0**
（实测 `grep -oE '\b(describe|it|test)\s*\('` → 0）。

**因此这 10 个文件就是 v2 重构唯一的行为契约。** 它们覆盖了备份、恢复、投递、
上传续传、阅读同步、学习统计、参考资料完整性等核心不变量。v2 迁移后必须**逐条重跑
且语义一致**：断言条数不得减少，断言内容不得放宽，任何一处语义变化都要在 PR 里说明
理由。**不允许为了让 CI 变绿而删除、弱化或 skip 这些断言。**

---

## 2. 运行方式

```bash
pnpm test        # 跑全部 10 个断言脚本
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm verify      # typecheck && lint && test（CI 使用的门禁）
```

`pnpm test` 的实际命令：

```
node --experimental-strip-types --import ./tests/node-ts-resolve.mjs \
     --test --test-reporter=spec "tests/**/*.test.ts"
```

glob 用**引号**包裹，由 Node 自己展开（Node 22 的 `--test` 支持 glob 入参）。这样在
Windows `cmd.exe`（不展开 glob）和 Linux `bash`（展开 glob）下行为一致。

---

## 3. 运行器选型：为什么是 `node --test`（含实测记录）

两个候选都做了实测，不是凭记忆选的。

### 候选 A：vitest —— 排除

- **与 Vite 8 的兼容性实测通过**：`pnpm view vitest@latest` 返回
  `version = 5.0.5`，`peerDependencies` 中 `vite` 为 `^6.4.0 || ^7.0.0 || ^8.0.0`，
  本项目 `vite@8.0.13` 落在范围内，`@types/node` 要求 `^22.0.0 || >=24.0.0`，
  本项目 `22.19.19` 也满足。**所以「vitest 不支持 Vite 8」这个担心不成立。**
- **真正排除的原因是结构不匹配**：vitest 按 `describe` / `it` / `test` 收集用例。
  本项目 10 个文件用例数合计为 0。文件内一条断言都没有被登记为用例，vitest 会以
  *No test suite found in file* 报错。要让 vitest 跑通，只有两条路：
  1. 把这 10 个文件改写成 `it('...', () => {...})` 结构 —— 直接违反「不改 103 条断言的
     结构」的硬约束；
  2. 再写一层 shim，用 `it()` 包住对脚本的 `await import()` —— 这是在已有 runner 之上
     再叠一层元框架，比方案 B 更复杂、故障点更多。
- 次要因素：方案 B 的新增依赖数为 0，而 vitest 会引入一整套 `@vitest/*`、`chai`、
  `tinybench` 等传递依赖。

### 候选 B：`node --test` + `--experimental-strip-types` —— 采用

- 它天然就是**脚本式**模型：一个文件 = 一个用例，顶层断言抛出即该文件失败，退出码非 0。
  与现有 10 个文件的结构完全吻合，**不需要改一行断言**。
- 新增依赖：**0**。
- 报告可读性：`--test-reporter=spec` 给出每个文件的 ✔ / ✖ 与耗时，加上断言里自带的
  `console.log` 摘要，足够定位。

### 必须解释的一件事：`ERR_MODULE_NOT_FOUND` 到底是什么

任务书提到之前有人执行 `node --experimental-strip-types tests/domain.test.ts` 失败。
已复现，**根因不是测试文件的 `.ts` 后缀**：

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '...\algonotes-training-workbench\lib\domain'
  imported from ...\algonotes-training-workbench\lib\study-model.ts
```

失败点在 `lib/study-model.ts`，它写的是 `import {attemptDays} from './domain';` ——
**无扩展名**。`lib/**` 里这样的相对导入共 **31 处**（实测
`grep -rn "from '\.\{1,2\}/" lib/*.ts | grep -v "\.ts'"`）。测试文件本身写的
`'../lib/domain.ts'` 带后缀，反而是正确的。Node 原生 ESM 解析要求完整扩展名，所以
问题在 `lib/` 的打包器风格导入，不在 `tests/`。

**这是「命令写法/环境缺失」问题，不是能力缺失** —— 加一个只处理「相对 + 无扩展名」
的 resolve 钩子即可，见 §4。

---

## 4. `.ts` 后缀 import 的处理

**没有**批量去掉测试文件里的 `.ts` 后缀（那要改 10 个文件的 import 行，违反最小变更原则）。

新增 2 个文件，只做解析、不碰任何源码：

| 文件 | 作用 |
| --- | --- |
| `tests/ts-resolve-hooks.mjs` | 解析规则本体：仅当 specifier 是 `./` 或 `../` 开头**且**没有 JS/TS 扩展名时，依次尝试 `.ts` → `.mts` → `/index.ts`，命中即返回；否则交回 Node 默认解析器 |
| `tests/node-ts-resolve.mjs` | 通过 `--import` 预加载的注册入口 |

`node --test` 的进程内钩子选型（关系到能否覆盖 `engines.node` 下限）：

- `module.registerHooks()`（同步，Node **>=22.15.0**）为默认路径；
- `module.register()`（异步隔离线程，Node **>=20.6.0**）作为回退，覆盖
  Node 22.13–22.14（`package.json` 声明 `engines.node: >=22.13.0`，若只用同步钩子，
  在声明支持的下限版本上会直接崩，那是假门禁）。

两条路径**都在本机实测通过**（同步为默认；`ALGONOTES_ASYNC_HOOKS=1` 强制走回退）：

```
SYNC  path → 11 domain assertions passed   exit 0
ASYNC path → 11 domain assertions passed   exit 0
```

全量套件在两条路径下结果完全一致（均为 `tests 10 / pass 9 / fail 1`）。

`bare` specifier（`fflate`、`@noble/hashes/sha2.js`）与带后缀的 specifier 一律不拦截。

---

## 5. `upload-resume.test.ts` 的环境依赖：无需任何 stub

任务书预期该文件依赖浏览器 API 需要 polyfill。**实测不需要**：
`lib/upload-client.ts` 只用到 `fetch` / `File` / `Response` / `FormData`，
在 Node 22 上**全部是原生的全局对象**（`File` 自 Node 20 起为全局）。

实测确认：

```
File: function  Response.json: function  structuredClone: function
```

文件顶部原本就有 `const oldFetch = globalThis.fetch` + `finally { globalThis.fetch = oldFetch }`
的注入/还原，测试自己就把 `fetch` mock 掉了。结果：**该文件 7 条断言全部通过，
零 stub、零 skip、未改动 `lib/upload-client.ts` 一个字。**

结论：任务书里「可能需要 stub 或单独 skip」的兜底方案**没有启用**。

---

## 6. 断言清单与运行结果

「断言数」= 运行时实际执行的 `assert.*` 调用次数（循环与 `check()` / `eq()` 帮助函数
会放大静态调用点数，所以与静态计数不同）。

| 文件 | 断言数 | 覆盖的函数 / 常量 | 运行结果 |
| --- | ---: | --- | --- |
| `backup-manager.test.ts` | 30 | `backupBundles` `requireCompleteBackup` `deleteBackup` `BackupStore` | ✅ 通过 |
| `backup.test.ts` | 10 | `createBackup` `previewRestore` `checkBackupRecords` | ✅ 通过 |
| `course-folders.test.ts` | 2 | `expandCourseZip` | ✅ 通过 |
| `delivery-files.test.ts` | 38 | `fileCapability` `relativePath` `decodeSource` `sourceIndex` `checkBatch` `FILE_LIMIT` `mergedContent` `validateDelivery` `expandCourseZip` `postRecord` `mergeEntries` | ✅ 通过 |
| `domain.test.ts` | 11 | `independentAC` `validateEntry` `safePath` `escapeCSV` | ✅ 通过 |
| `reading-sync.test.ts` | 27 | `byteRange` `matchesETag` `cleanLocation` `marksFor` `locateQuote` `readRecordCursor` `nextRecordCursor` `preferences` `searchIndex` `searchItems` | ✅ 通过 |
| `stream-backup.test.ts` | 22 | `createStreamBackup` `previewStreamRestore` `restoreStreamBackup` `CHUNK_BYTES` | ✅ 通过 |
| `study.test.ts` | 30 | `compareOutput` `textDiff` `budgetPlan` `studyStats` `validateStudy` `linkedRefs` `sourcePack` `MULTIPART_LIMIT` `CHUNK_BYTES` `validateUpload` `partSize` `searchSnippet` `matchesQuery` `folderRows` | ❌ **失败**（26 通过 / 3 失败 / 文件在第 13 条中止，后续 17 条未执行） |
| `upload-resume.test.ts` | 7 | `uploadChunked` `CHUNK_BYTES` | ✅ 通过 |
| `workspace.test.ts` | 25 | `createId` `preferences` `descendantIds` `folderRows` `noteProblemIds` `searchIndex` `searchItems` `elapsedSeconds` `sameOutput` `fileMetadataChangeAllowed` `learningSuggestions` `validateEntry` | ✅ 通过 |
| **合计** | **202** | | **199 通过 / 3 失败** |

实际单次运行中，因为 `study.test.ts` 在第 13 条中止，本次执行了 **185** 条。
为确认中止之后的部分没有问题，已用临时副本（跳过失败的那一行，未提交）单独验证：
剩下 **26 条全部通过**，`26 + 4 = 30` 与静态统计吻合 —— **失败被精确收敛到那 4 条**。

### 关于「103 条」这个数字

任务书给的 103 与实测不符，两个口径都对不上：

- 静态 `assert.*(` 调用点：**145**（`grep -o "assert\.[a-zA-Z]*(" | wc -l`）
- 运行时实际执行：**202**

原因是大量断言写在循环里（如 `delivery-files` 用 8 个路径名循环调用 `relativePath`，
静态 1 处、运行时 8 次）或被 `check()` / `eq()` 帮助函数包裹。
**建议以 202 作为 v2 对照基准的正式口径**，`145` 作为「断言站点数」参考。

---

## 7. 已知问题（P0 不修，仅记录）

### 7.1 `study.test.ts` 统计口径失败 —— 3 条断言（业务代码问题）

失败位置：`tests/study.test.ts:14`

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  actual: 0,
  expected: 1,
  operator: 'deepStrictEqual'
```

该行 4 条断言：`unknownTime`（0 vs 1，**失败**）、`minutes`（0 vs 12.5，**失败**）、
`independent`（1 vs 1，本可通过）、`uniqueProblems`（0 vs 2，**失败**）。
因为 `unknownTime` 先抛，后 3 条从未执行。

**根因**（已定位到行，非猜测）：

1. `lib/domain.ts:12` 的 `attemptDays(data)` 只用 `data.activityDays`，缺省回退
   `data.day`，**没有**回退 `data.startedAt`。
2. 而它上方的文档注释明确写着「一次尝试在其活跃日（activityDays，**缺省回退开始日**）各计一次」。
   → **注释承诺的 `startedAt` 回退，实现里不存在。**
3. 测试数据 `e('a','attempt',{problemId:'p',minutes:'',startedAt:'2026-10-23T17:00:00Z'})`
   只给了 `startedAt`，没有 `day` / `activityDays`，于是 `attemptDays` 返回 `[]`，
   该尝试被 `studyStats` 的 `inRange` 判为不在区间内，整条记录被丢弃。
4. `e('b','attempt',{problemId:'q',minutes:'12.5'})` 更极端：连 `startedAt` 都没有，
   只有 `updated: '2026-10-24T01:00:00Z'`。要让它计入 `minutes: 12.5`，
   `attemptDays` 必须能回退到 **entry 级别的 `updated`**；但它只接收 `data`，
   **根本拿不到 `updated`**。所以这不是一行能补的洞，要么改签名，要么让
   `studyStats` 自己拼 day 列表。

**为什么线上没暴露**：`app/workbench.tsx:237` 新建尝试时同时写入
`day: localDay()` 和 `activityDays: [localDay()]`，生产数据永远带 `day`，
`activityDays` 分支永远命中，`startedAt` 回退路径从未被执行。**属于潜伏缺陷。**

**P0 处置：不改。** 业务代码禁止改动，且这不是「测试预期过时」—— 断言写的正是
代码注释承诺的语义，改断言等于把 bug 写进契约。留待 P0.1 决策。
**两个可选修法**（都需要授权后另行提交）：
- (a) 给 `attemptDays` 增加 entry 级回退：`attemptDays(data)` → 在 `studyStats` 内
  用 `attemptDays(e.data).length ? ... : [localDay(new Date(e.data.startedAt ?? e.updated))]`
  拼出 day 列表（不动 `attemptDays` 签名，影响面最小）；
- (b) 改 `attemptDays(data, fallback?)` 签名，同步改 5 处调用方
  （`study-model.ts:31/34`、`app/workbench.tsx:382/421`、`components/problem-panel.tsx`、
  `components/study-hub.tsx`）。影响面大，不建议在 P0 做。

### 7.2 `pnpm lint` 在 `main` 上本来就是红的 —— 与本次改动无关

这是**独立于测试的第二个阻塞**，必须在报告里说清，否则会误以为 CI 门禁是本轮弄红的。

在**未做任何改动的 `e2692d6` 上**实测（工作区除新增的 `tests/*.mjs` 外干净）：

```
npx eslint . --ignore-pattern dist --ignore-pattern .next
→ exit 1，✖ 635 problems (532 errors, 103 warnings)
```

分布（解析 lint 报告得到，合计 635，与 eslint 汇总行一致）：`components` 235、
`app` 216、`lib` 117、`tests` 34、`.zcode` 33。
按规则：`no-explicit-any` 493 条、`no-unused-vars` 51 条、
`no-unused-expressions` 30 条、`react-hooks/exhaustive-deps` 20 条……

即绝大部分是既有代码，`tests` 只占 34 条（5.4%）。**新增的 2 个 `.mjs` 文件 lint 问题数为 0**
（单独扫描 exit 0；把这两个文件从扫描里排除后总数仍是 635，前后一致，本轮没有新增任何
lint 问题）。

**P0 处置：不改。** 修 532 个 error 必然要动 `app/` `components/` `lib/`，违反本轮硬约束；
关掉规则则等于假门禁。因此 `pnpm verify` 目前**必然为红**，且先在 lint 步就失败
（`typecheck` 已通过，`test` 不会被执行）。

**这就是「`p0-ci-green` 无法达成」的直接原因**，不是本轮工作没做完。

### 7.3 因此：CI 已按要求接好，但当前是红的

`.github/workflows/ci.yml` 严格按 5 步真实执行（不做 `continue-on-error` 这类降级），
现状会在 lint 步失败。等 7.1 + 7.2 处理完即自然转绿。**不建议为了拿绿色标记去关规则或
skip 断言。**

---

## 8. 实际执行输出（原样粘贴）

### `pnpm test` → exit 1

```
✔ tests\backup-manager.test.ts (216.5463ms)
✔ tests\backup.test.ts (284.9667ms)
✔ tests\course-folders.test.ts (233.5982ms)
✔ tests\delivery-files.test.ts (300.7826ms)
✔ tests\domain.test.ts (252.99ms)
✔ tests\reading-sync.test.ts (262.9038ms)
✔ tests\stream-backup.test.ts (1231.7379ms)
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  actual: 0,
  expected: 1,
  operator: 'deepStrictEqual',
✖ tests\study.test.ts (298.8085ms)
✔ tests\upload-resume.test.ts (302.7717ms)
✔ tests\workspace.test.ts (267.8566ms)
ℹ tests 10
ℹ suites 0
ℹ pass 9
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
✖ failing tests:
✖ tests\study.test.ts (298.8085ms)
  'test failed'
```

`ALGONOTES_ASYNC_HOOKS=1 pnpm test`（异步钩子回退路径）结果**完全一致**：
`tests 10 / pass 9 / fail 1`，exit 1。

### `pnpm typecheck` → exit 0

```
> tsc --noEmit
（无输出，exit 0）
```

### `pnpm verify` → exit 1

```
> pnpm typecheck && pnpm lint && pnpm test
（typecheck 通过）
（lint 失败）
✖ 635 problems (532 errors, 103 warnings)
  4 errors and 0 warnings potentially fixable with the `--fix` option.
[ELIFECYCLE] Command failed with exit code 1.
```

失败点是 lint（§7.2），因此 `pnpm test` 未被执行。

### 跳过项

**无。** `skipped 0`，没有任何文件被标记 skip，没有任何断言被删除或弱化。

---

## 9. v2 重构验收要求（写进 v2 的 DoD）

1. `pnpm test` 中 10 个文件全部为 ✔，且**运行时断言数仍为 202**（可增不可减）。
2. 逐条对照本文件的「覆盖的函数 / 常量」列，确认迁移后同名行为语义一致；
   函数被重命名或拆分时，必须在 PR 描述里给出「旧名 → 新名 → 对应断言」的映射表。
3. `pnpm typecheck` 保持 exit 0。
4. `pnpm lint` 达到 exit 0（需先清掉 §7.2 的 532 个既有 error，作为独立任务）。
5. 不得以「v2 重新设计了」为由删减断言；需要变更契约时，先改本文档并留 review 记录。
