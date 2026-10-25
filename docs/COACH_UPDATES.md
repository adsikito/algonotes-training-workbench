# 训练内容维护协议

## v1.2执行卡与回读

已连接的算法训练工作台工具优先于手动服务访问。read_training_state返回覆盖共享修改后的生效目录及baseVersion。日卡文档ID为execution-YYYY-MM-DD，kind=document，data.kind=每日执行卡；题单executionDocId指向它。

批次采用daily-delivery-YYYY-MM-DD-v1，超时先查回执；重复执行保持同一完整payload，不重新生成时间戳。更正才使用新批次与新baseVersion。每日题单必须恰含7个互异且存在的题号。写入成功后回读版本、题单关联和持久化回执，再给用户入口。

2026-10-23主动触发通路测试已写入当天执行卡，重复同批回执一致。既有任务已保持启用并校准回北京时间每日01:00，未来首次定时执行仍须另有回读证据。没有创建第二个任务；没有把手动测试冒称定时触发。

工作空间：本仓库 hosting manifest 对应的私人站点。更新前以 get_site 确认仍owner-private，取得受支持服务访问；令牌只在调用内存中，不保存到本文件或任务提示。

1. 读取已发布更新和范围，读取当前MD来源/用户最新进度。
2. 已交付日期不另选第二套；更正保留版本与差异。
3. 新推荐核验官方题面、约束、样例、评级/无评级和入口；不编造通过率。
4. 构建内容项 `{id,kind,data,baseVersion}`；kind仅problem/list/document/knowledge。
5. 使用 `preview_content_update` 后应用同一个batchId和相同payload；超时先查 `get_update_status`。
6. 通过 `get_update_status` 和 `read_training_state` 回读版本、题量、样例及来源；成功后再发当日入口。
7. 不修改私人笔记、作答结果、帮助或自评。无反馈保持未知；七题是自选池，不增加补做债。
8. 继续复用原每日01:00 Asia/Shanghai任务；不创建第二份同内容自动化。

工具通道：站点 `/mcp`，也可在支持的私有服务访问下调用 `/api/coach` POST `{action,arguments}`。站点访问凭证不提供用户身份，所以服务通道只能写共享训练内容，不能读写私人记录。

定时任务接通与真实执行分别记录；没有实际执行证据不写“已自动更新”。来源读取失败时保留原内容，不覆盖为空，不用未经核验题目凑数。

文件原件：小型Markdown可调用 upload_markdown_resource；其他文件由受限服务访问POST /api/coach-files，multipart字段 file、id、baseVersion、operationId。只写共享训练资料，上传后GET /api/coach-files?id=...回读字节并校验。
