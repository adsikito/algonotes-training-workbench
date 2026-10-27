# v2 重构行为对照基准（2026-10）

> 状态：**全绿**。10 个脚本全部可由一条命令运行，**202 / 202 条运行时断言通过，
> 0 失败 0 跳过**。原先 3 条失败已定位为实现缺口并在 `lib/study-model.ts` 补完（见 §7.1）。
> `pnpm lint` 的 635 条存量问题改为**差分门禁 + 存量观测**处理（见 §7.2）。

- 建立时间：2026-10-27
- 基线锚点：`e2692d6`「chore: snapshot before v2 rebuild」/ 标签 `pre-rebuild-2026-10-27`
- 全绿锚点：提交见 `git log`，标签 `p0-ci-green`
- 运行环境：Node v22.22.2、pnpm 11.25.0、Windows（Git Bash）
- 业务代码改动仅 1 处：`lib/study-model.ts` 的 `studyStats`（见 §7.1）；`app/`
  `components/` 零改动，103/202 条断言的断言逻辑零改动

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
pnpm test        # 跑全部 10 个断言脚本（202 条断言）
pnpm typecheck   # tsc --noEmit
pnpm verify      # typecheck → test → lint:diff（CI 的 verify job 用的就是这条）
pnpm lint        # 全量 eslint（存量观测用，当前 635 problems，不阻塞）
pnpm lint:diff   # 只查变更行（门禁）
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
| `study.test.ts` | 30 | `compareOutput` `textDiff` `budgetPlan` `studyStats` `validateStudy` `linkedRefs` `sourcePack` `MULTIPART_LIMIT` `CHUNK_BYTES` `validateUpload` `partSize` `searchSnippet` `matchesQuery` `folderRows` | ✅ 通过（§7.1 修复后 30 条全部执行） |
| `upload-resume.test.ts` | 7 | `uploadChunked` `CHUNK_BYTES` | ✅ 通过 |
| `workspace.test.ts` | 25 | `createId` `preferences` `descendantIds` `folderRows` `noteProblemIds` `searchIndex` `searchItems` `elapsedSeconds` `sameOutput` `fileMetadataChangeAllowed` `learningSuggestions` `validateEntry` | ✅ 通过 |
| **合计** | **202** | | **202 通过 / 0 失败 / 0 跳过** |

修复后重新逐文件计数（用临时 preload 包裹 `assert.*` 计数，未提交），
每文件数字与修复前完全一致、合计仍为 **202** —— 证明补的是实现，没有删改或跳过任何断言。
`study.test.ts` 从「执行 13 条就中止」变成「30 条全部执行」，多出来的 17 条原本被中止吞掉。

### 关于「103 条」这个数字

任务书给的 103 与实测不符，两个口径都对不上：

- 静态 `assert.*(` 调用点：**145**（`grep -o "assert\.[a-zA-Z]*(" | wc -l`）
- 运行时实际执行：**202**

原因是大量断言写在循环里（如 `delivery-files` 用 8 个路径名循环调用 `relativePath`，
静态 1 处、运行时 8 次）或被 `check()` / `eq()` 帮助函数包裹。
**建议以 202 作为 v2 对照基准的正式口径**，`145` 作为「断言站点数」参考。

---

## 7. 关键问题记录与处置

### 7.1 `study.test.ts` 统计口径 —— 已修复（实现缺口，非断言过时）

**判断依据**：三条并列证据，证明「是实现没写完」而不是「断言写错了」。

**① 注释原文**（`lib/domain.ts:11`）：

```
/** 归日统一口径：一次尝试在其活跃日（activityDays，缺省回退开始日）各计一次；总尝试数仍按记录行数 */
```

**② 当前实现**（`lib/domain.ts:12`，修复前）：

```js
export function attemptDays(data:any):string[]{
  const raw = Array.isArray(data?.activityDays) && data.activityDays.length
    ? data.activityDays
    : [data?.day].filter(Boolean);        // ← 只回退 day，注释承诺的「开始日」不存在
  return [...new Set(raw.filter(...))];
}
```

**③ 失败断言**（`tests/study.test.ts:13-14`）：

```js
const rows=[
  e('a','attempt',{problemId:'p',minutes:'',startedAt:'2026-10-23T17:00:00Z'}),  // 只有 startedAt
  e('b','attempt',{problemId:'q',minutes:'12.5'}),                              // 连 startedAt 都没有
  e('s','submission',{problemId:'p',result:'AC',help:'未知'}),
  e('s2','submission',{problemId:'q',result:'AC',help:'独立'})];
const stats=studyStats(rows,'2026-10-24','2026-10-24');
eq(stats.unknownTime,1); eq(stats.minutes,12.5); eq(stats.independent,1); eq(stats.uniqueProblems,2);
```

注释承诺 `startedAt` 回退 → 实现没有 → 记录 `'a'` 的 `attemptDays` 返回 `[]` →
被判为不在统计区间 → 整条记录被丢弃。**断言写的是注释承诺的语义，实现没兑现**，
所以是补实现，不是改断言。

`'b'` 更极端：只有 entry 级 `updated`，没有任何 `data` 内日期。`attemptDays` 只接收
`data`，**拿不到 `updated`**，所以回退必须发生在调用它的那一层 —— 这也说明「一行补丁」
不成立，需要选对改法。

**为什么线上没暴露**：`app/workbench.tsx:237` 新建尝试时同时写 `day: localDay()` 和
`activityDays: [localDay()]`，生产数据永远带 `day`，`activityDays` 分支永远命中，
`startedAt` 回退路径从未被执行。**属于潜伏缺陷**，只在导入/历史/异常数据上显形。

#### 采用的修法（团队批准的「最小改法」）

只改 `lib/study-model.ts` 的 `studyStats`，**不动 `attemptDays` 的签名与返回类型**，
新增文件内局部函数 `dayOf(e)`：

```ts
const dayOf=(e:Entry):string[]=>{
  const explicit=attemptDays(e.data);
  if(explicit.length)return explicit;
  const at=new Date(e.data?.startedAt??e.updated);
  return Number.isNaN(at.getTime())?[]:[localDay(at)];
};
```

回退链：`activityDays` / `day` → `startedAt`（注释承诺的「开始日」）→ entry 级 `updated`。
三级都取不到合法日期时返回空数组，该记录不计入统计（**不按「今天」或「0 分钟」硬算**，
避免把未知数据伪造成有效数据）。

`inRange` 与 `daily` 展开循环都改用 `dayOf(e)`。

#### 调用方影响面（已全仓 grep）

`attemptDays` 共 7 处出现，`studyStats` 共 3 处：

| 位置 | 用途 | 行为是否变化 |
| --- | --- | --- |
| `lib/domain.ts:12` | 定义 | ❌ 未改动 |
| `lib/study-model.ts:31` | `studyStats` 的 `inRange` | ✅ 改为 `dayOf(e)`（本次修复点） |
| `lib/study-model.ts:34` | `studyStats` 的 daily 展开 | ✅ 改为 `dayOf(e)`（本次修复点） |
| `app/workbench.tsx:382` | 题目列表按日期筛选 | ❌ 未变（仍直接调 `attemptDays`） |
| `app/workbench.tsx:421` | 今日小结进度环 | ❌ 未变 |
| `components/problem-panel.tsx:68` | 尝试历史日期展示 | ❌ 未变 |
| `components/study-hub.tsx:67` | 统计下钻筛选 | ❌ 未变 |

**结论：`attemptDays` 本身零改动，所以除 `studyStats` 外没有任何调用方的行为发生变化。**
`studyStats` 只有一个消费者（`components/study-hub.tsx:67` 的 `Statistics` 面板），
其可见变化是：缺少 `day`/`activityDays` 的历史尝试不再被统计静默漏掉。生产数据永远带
`day`，故对现有用户数据无可见变化。

#### 回归结果

`pnpm test` → **10/10 文件，202/202 断言通过，0 失败 0 跳过，exit 0**。
逐文件断言数与修复前完全一致（30/10/2/38/11/27/22/30/7/25），没有「修好 3 条、坏掉别的」。

> **遗留（未在本轮修，避免扩散改动面）**：§7.1 与 QA 报告的 S1-8「统计表把范围外日期也
> 列出来」相邻但**不同根因**——S1-8 是 `daily` 展开多日尝试时把区间外的活跃日也写进表格。
> `dayOf` 已可用于在 daily 循环里加 `d>=from&&d<=to` 过滤，但当前 202 条断言**没有一条**
> 覆盖该行为，无人约束的改动风险更高。建议随 S1-8 一起修，并**先补一条断言**再改。

### 7.2 全量 lint 存量债 —— 改差分门禁

#### 2a/2b/2c 的落地

存量债不再清（P1–P4 将重写数据层/服务端/组件，493 条 `any` 所在文件大多会被替换），
改为三件事：

1. **门禁只查变更行**：`pnpm lint:diff`（`scripts/lint-changed.mjs`）。CI 的 `verify`
   job 调用它，`base` 取 PR 的 `base.sha` 或 push 的 `github.event.before`，并用
   `git merge-base` 收敛到共同祖先，避免把 base 分支的改动算到本次 PR 头上。
2. **全量 lint 降级为观测**：CI 里另起 `lint-full` job，step 上挂 `continue-on-error: true`，
   只打印基线数字，不阻塞。
3. **基线记录**见下方 §7.2.1。

#### 为什么是「变更行」而不是「变更文件」

团队最初的 diff-lint 方案是「把变更文件整份交给 eslint」。**实测这条路立刻走不通**：
本轮必须修改的 `lib/study-model.ts` 自带 6 条存量 `no-explicit-any`，
整文件模式会让第一个合法改这个文件的人被别人的债挡住。

实测对比（同一个 probe `any` + 同一个 `study-model.ts`）：

```
# 整文件模式
npx eslint lib/study-model.ts components/__lintprobe.tsx
→ 7 problems (7 errors)          ← 6 条是存量，1 条是新引入

# 变更行过滤
LINT_BASE=HEAD pnpm lint:diff
→ 1 error（components/__lintprobe.tsx:1:30）
→ lint:diff — 失败（2 file(s) changed；变更行上 1 error）
```

所以实现为：解析 `git diff --unified=0` 得到每个文件的**新增行区间**，只保留落在
这些区间内的 eslint 消息（reviewdog / diff-cover 的同一思路）。新增文件视为全文件变更，
未跟踪文件（`git ls-files --others`）也当作全文件变更，避免本地跑漏掉新文件。

#### 实测：故意引入 `any` 会被拦住

```
$ LINT_BASE=HEAD pnpm lint:diff
components/__lintprobe.tsx
  1:30  error  Unexpected any. Specify a different type.  @typescript-eslint/no-explicit-any

lint:diff — 失败（2 file(s) changed；变更行上 1 error，0 warning）
exit 1
```

（probe 文件已删除，未提交。）

边界场景实测：push 区间无 TS 变更 → `无 TS/TSX 变更，跳过`，exit 0；
新分支（`LINT_BASE` 全 0）→ `没有可比对的基线提交`，exit 0。

#### 7.2.1 存量基线（只允许下降）

- **采集命令**：`npx eslint . --ignore-pattern dist --ignore-pattern .next`
- **采集日期**：2026-10-27
- **采集 commit**：`e2692d6`（`main` 原始快照，未叠加本轮任何改动）
- **结果**：`✖ 635 problems (532 errors, 103 warnings)`，exit 1
- **规则分布**：`no-explicit-any` 493、`no-unused-vars` 51、`no-unused-expressions` 30、
  `react-hooks/exhaustive-deps` 20
- **目录分布**：`components` 235、`app` 216、`lib` 117、`tests` 34、`.zcode` 33
  （合计 635，与 eslint 汇总行一致）

**该数字只允许下降，不允许上升。** 新增代码由 `lint:diff` 的变更行过滤保证不引入新问题；
本轮新增的 4 个 `.mjs`/`.ts` 产物本身 lint 问题数为 0（排除它们前后总数都是 635）。

> `tests` 的 34 条也属存量（10 个断言脚本本身大量使用 `any`）。本轮**没有**为了降这个数字
> 去改断言脚本 —— 那会违反「不改断言」的约束。

### 7.3 CI 结构

`.github/workflows/ci.yml` 两个 job：

| job | 内容 | 是否阻塞 |
| --- | --- | --- |
| `verify` | checkout(`fetch-depth: 0`) → 读 `engines` → pnpm 11.25.0 → Node `${major}.x` → `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test` → `pnpm lint:diff` | ✅ 阻塞 |
| `lint-full` | 同上准备 → 打印基线数字 → `pnpm lint`（`continue-on-error: true`） | ❌ 仅观测 |

顺序刻意是 `typecheck` → `test` → `lint:diff`：测试是 P0 的目的，不能被历史 lint 债挡住；
`typecheck` 仍在最前，因为它是零成本硬门禁且当前是绿的。

**不跑 `pnpm build`**：构建需要 Cloudflare 凭据，跑起来只会是失败或空转，属于假门禁。

> 说明：本地无法真正运行 GitHub Actions。本文件只做了 YAML 解析校验（用 `yaml` 解析器
> 读出 `on` / `jobs` / 每个 step 及其 `continue-on-error`、`env`）和逐步骤人工核对，
> **没有声称「CI 一定能跑通」**。`actionlint` 本机未安装。

---

## 8. 实际执行输出（原样粘贴）

### `pnpm test` → exit 0

```
✔ tests\backup-manager.test.ts (296.684ms)
✔ tests\backup.test.ts (304.7723ms)
✔ tests\course-folders.test.ts (235.3933ms)
✔ tests\delivery-files.test.ts (313.024ms)
✔ tests\domain.test.ts (239.6209ms)
✔ tests\reading-sync.test.ts (267.4922ms)
✔ tests\stream-backup.test.ts (1363.56ms)
✔ tests\study.test.ts (334.9392ms)
✔ tests\upload-resume.test.ts (343.0392ms)
✔ tests\workspace.test.ts (267.2183ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

`ALGONOTES_ASYNC_HOOKS=1 pnpm test`（异步钩子回退路径，覆盖 Node 22.13–22.14）
结果**完全一致**：`tests 10 / pass 10 / fail 0`，exit 0。

### `pnpm typecheck` → exit 0

```
> tsc --noEmit
（无输出，exit 0）
```

### `pnpm verify` → exit 0

```
> pnpm typecheck && pnpm test && pnpm lint:diff
（typecheck 无输出）
（test：tests 10 / pass 10 / fail 0 / skipped 0）
30 study, reference and upload-policy assertions passed
✔ tests\study.test.ts (269.5965ms)
25 workspace assertions passed
✔ tests\workspace.test.ts (235.4031ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ skipped 0

$ node scripts/lint-changed.mjs
lint:diff — 通过（1 file(s) changed, base e2692d6 (working tree)；变更行上 0 error，0 warning）。存量问题不计入本门禁。
```

### 全量 `pnpm lint`（观测，非门禁）

```
> eslint . --ignore-pattern dist --ignore-pattern .next
✖ 635 problems (532 errors, 103 warnings)
```

与 §7.2.1 基线**完全一致**，未新增任何问题（修复 `study-model.ts` 是在既有错误行之外
插入代码，未触及那 6 条存量 error 所在行）。

### 跳过项

**无。** `skipped 0`，没有任何文件被标记 skip，没有任何断言被删除或弱化；
修复前后运行时断言数均为 202。

---

## 9. v2 重构验收要求（写进 v2 的 DoD）

1. `pnpm test` 中 10 个文件全部为 ✔，且**运行时断言数仍为 202**（可增不可减）。
2. 逐条对照本文件的「覆盖的函数 / 常量」列，确认迁移后同名行为语义一致；
   函数被重命名或拆分时，必须在 PR 描述里给出「旧名 → 新名 → 对应断言」的映射表。
3. `pnpm typecheck` 保持 exit 0。
4. `pnpm verify` 保持 exit 0（= typecheck + test + `lint:diff`）。
5. **新增/修改的代码必须让 `pnpm lint:diff` 保持 exit 0**；全量 `pnpm lint` 的
   635 / 532 只允许下降（见 §7.2.1），不得因为「反正是存量」而在变更行上引入新 error。
6. 不得以「v2 重新设计了」为由删减断言；需要变更契约时，先改本文档并留 review 记录。
7. S1-8（统计表列出范围外日期）修复时，**先补断言再改代码**（见 §7.1 末尾遗留说明）。
