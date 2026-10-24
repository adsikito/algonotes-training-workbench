# AlgoNotes · 算法训练工作台

面向个人算法练习、STL 参考、笔记和资料管理的 Web 工作台。当前公开快照对应站点 v1.4 源码。

## 技术组成

- Next.js/React 19 与 Vinext；TypeScript。
- Cloudflare Workers/Vite、D1 与 R2；Drizzle ORM。
- 题目、笔记和资料通过站点身份隔离；题目评测仍由洛谷、Codeforces、力扣等原站完成，应用不执行用户代码。

## 源码范围与数据边界

本仓库包含应用源码、数据库迁移、测试、STL 参考内容及当前技术说明。为避免公开个人学习计划，`content/seed.json` 在此快照中为空；`.openai/hosting.json`、D1/R2 实例数据、个人笔记、成绩、备份、密钥和部署凭据均未包含。需要示例题单时，请自行加入明确可公开的内容。

站点源码依赖 Sites 运行时提供的私有身份、D1/R2 绑定与部署边界。公开本仓库不会把线上站点改成公开访问，也不会包含能连接现有站点的数据或凭据。不要将 `/api/coach` 改为公开端点；公开部署前须重新设计并审查授权。

## 本地开发

要求 Node.js `>=22.13.0` 与 pnpm `11.x`。安装依赖后可尝试：

```sh
pnpm install
pnpm dev
```

本地运行需要合适的 Cloudflare/Sites 兼容环境及 D1/R2 配置。仓库不携带实例配置或凭据；只有完成平台绑定后，构建和数据库迁移才可完整运行。迁移请追加新文件，不要改写已应用迁移。

```sh
pnpm lint
node node_modules/typescript/bin/tsc --noEmit
pnpm db:generate
```

## 主要模块

- `app/`：页面与 API 路由。
- `components/`：训练、笔记、文件阅读、备份和 STL 界面。
- `lib/`：记录模型、文件/备份、内容交付、搜索及工作区逻辑。
- `db/`、`drizzle/`：D1 schema 与迁移。
- `tests/`：领域、读写、文件和备份验证。
- `content/stl-reference.json`：竞赛常用 STL 参考卡片。

## 许可

本仓库没有附加开源许可证。公开可见不等于授予复制、修改或再分发许可；如需开源，请由项目所有者另行选择并添加许可证。
