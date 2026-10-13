# PR60 统一 Pi Agent 接入验收（2026-10-13）

## 当前状态

**开发代码已提交；组合运行和独立审查尚未完成。不得作为生产发布凭据。**

- 唯一集成 PR：[PR60](https://github.com/magicy565-web/workspace-agent/pull/60)。初始基线 PR59 `18cc80aca0f88a68fb96d2f1d960897f8a48dac2`，后通过双父提交 `9f808f202ce825a2ab647f11456eb5dbcf8fe76e` 同步 PR59 的原生 Host/Muse 新修复 `32c8ce98fe28cda1e22a16bf0d1088c768e081c8`，且未覆盖其源码；新组合仍未运行完整回归。
- 选择性来源：PR47 `1e0cc43d973b5d10861561f2cd4979065d5f33f6`。
- 本次的代码边界、唯一权威和部署限制见 [AGENT-UNIFIED-HANDOFF.md](AGENT-UNIFIED-HANDOFF.md)。
- 未重建商城/供应商库/计划/通知、模型循环、商业 Task Store 或另一个后端；PR59 是业务和界面权威。

## 本轮实际检查（不等于完整测试）

- 源码通过已连接 GitHub 进行修订，分支有远端固定提交和新文件。
- 关键共享 JavaScript 的源码锚点、语法及 GitHub 文件 SHA 已校验；保留原 Host Session、MCP、供应商 revision/取消、Shopify、GA4 和通知模块。
- 补入此前漏带的 `scripts/agent-retention.mjs` 和 `test/fixtures/agent-service-child.mjs`，解决 Agent 测试的确定性缺失依赖。
- 将旧用例的根 `/health` 预期改为**原 Workspace Host 根路径不被 Agent 接管**；Agent JSON health 位于 `/api/agent/v1/health`。
- 新增 `test/agent-unified-host.http.test.mjs`，明确要求 API 默认关闭；开启后只通过原单 Host、原企业成员 scope 和原 Workspace Store，且不会卸载已有供应商/通知服务。
- 增加 Agent Bearer 与原 Dot/Muse/采购 Worker token SHA-256 的跨范围碰撞拒绝规则及普通测试。对应 Node 回归仍待实际运行，不能以代码提交冒充通过。
- 新 `test/agent-service.acceptance.mjs` 只会运行当前源码的构建与回归，并将新原始日志写入临时隔离目录。无独立审查回执时无条件标记 `release_blocked`、退出非零。

- 本轮已按原 PR59 固定源码逐字段核验 POLICY v4，并在新 `pi-provider.mjs` 中区分：原始端点的普通 Pi/Muse/供应商/Goal 会话保持 V4；Agent 研究预设独立 V5；新模型端点不具备 V4 恢复资格。
- `server/runtime.mjs` 按每个 run 的准确类型计算新旧指纹，Agent 在**原 Store 入队事务**锁定 V5，恢复时仍检查原 run 的哈希；未添加第二个执行器或无审批重试。
- 新增静态及普通回归：`test/pi-runtime.test.mjs` 固定原始 V4 canonical hash，验证普通 checkpoint 不丢 scope、另一个 HTTPS 端点拒绝恢复、run/submission/模型请求不重复；`test/agent-pi-runtime.test.mjs` 验证 Agent 采用单独 V5/端点指纹及原预算；`test/agent-unified-host.http.test.mjs` 验证即使 Agent 启用，普通 run 不获得 V5 工具授权。
- 新发现并修复的中断重启风险：`server/agent/engine.mjs` 原来会在服务启动时直接 `recoverPiRun`。现在自动恢复被 fail-closed 门禁阻止，转为 `AGENT_EXPLICIT_RESUME_REQUIRED`，只允许经过原成员 HTTP `POST /tasks/{id}/resume` 后恢复同一 run/submission，且授权仅本进程有效。原 `test/agent-pi-service.http.test.mjs` 已同步要求重启后模型调用数为 0，用户明确操作后恰好一次恢复，历史文件与事件保留。
- 对实际当前 `server/agent/engine.mjs` 采用 V8 隔离依赖的 Store/Scheduler 注入：重启后未授权调用数 0、任务 interrupted/resumable 且部分文件保留；对原 Store 的并发写入模拟验证同一成员两次同时 `/resume` 时仅一次原任务尝试递增及一次 Pi 恢复，runId/submissionId 不变。另增加 `test/agent-coordinator-explicit-recovery.test.mjs`，并把实际 HTTP 场景改为并发的两次恢复请求。这些不是 Node24/HTTP/SDK 集成验收。
- 上述五个已修改源码/测试文件进行了独立 V8 静态解析，全部可解析；这是**源码语法检查，不是 Node 24 导入、SDK、SQLite 或业务回归通过**。

**所有新增的 Node 测试均尚未在此候选上实际运行**。静态语法检查不能替代 Node 24、Pi Durable、SQLite、HTTP 或微信运行时测试。

## 2026-10-13 安全与 CI 补充验证

- 本轮修复 `server/agent/store.mjs` 投影签名遗漏原 `conversationId`/`runId` 的问题，并新增 `test/agent-projection-linkage.test.mjs`；`npm run test:agent` 的准确列表目前是 **9 个测试文件**，包括原先遗漏的单 Host、显式恢复和投影关联用例。
- 复核发现原 `retryRun()` 在 Agent 权限检查前直接进入 Pi 中断恢复，已修复，并在 `test/agent-pi-service.http.test.mjs` 增加旧接口拦截检查；通用消息/Goal/重置/删除无法变更 Agent 所拥有的 Pi 会话。旧代码和修复代码的 `retryRun` 在 V8 合成范围中分别表现为 Agent 恢复 1 次 vs 0 次；普通 Pi 仍恢复 1 次。修复后 `sendMessage` 的独立合成作用域检查拒绝普通消息且不新增 messages/runs。这些都不是端到端 Node/Pi SDK 通过。
- **CI 是更早的跨分支阻断**：2026-10-09 的 `main` [运行 37965153325](https://github.com/magicy565-web/workspace-agent/actions/runs/37965153325)、PR59 的 `32c8ce9` [运行 38328913909](https://github.com/magicy565-web/workspace-agent/actions/runs/38328913909)、PR60 的最新提交均报告 `path=BuildFailed`、`conclusion=startup_failure`；已查询 PR60 运行的作业列表，**0 jobs**。实际失败发生在测试执行前；不能归因于本轮源码，也不能判断仓库 Actions 设置、计费、策略或 GitHub 平台的具体根因。
- 具备仓库管理权限的维护者需在 GitHub Actions 页面检查报错横幅、工作流有效性、组织/仓库 Actions 权限、Runner 和计费状态。只有出现真正的 job 执行回执后，才可按下述命令与原始 logs 记录新的结果；不要将 `startup_failure` 标为测试失败或测试通过。

## 当前 HEAD 的额外安全回归（仍未完成 Node 24 验收）

- `test/agent-pi-service.http.test.mjs` 现在要求原 `retry`、`resume`、`action-decision`、普通 `messages`、`createGoal`、`reset-session`、`PATCH input-context` 和 `DELETE conversation` 在受保护的 Agent Pi 执行上下文里拒绝，不增加 Run/模型调用。
- 新增“孤儿 Pi Run”回归：原任务 registry 丢失，但 `runs[].agentTaskId` 仍在时，原会话不得成为普通 chat 或 Goal。包括模拟历史已存在的 Goal 被错误指向 Agent 会话时，其 `action=start` 不得启动模型；已存在的原 Pi Run 和历史 messages 必须保留。
- 对当前 GitHub 源码的 `agentConversation` 执行 5 种 V8 合成场景：正常 Agent 任务、孤儿 `agentTaskId`、孤儿 `agentPresetContext`、普通 Pi 会话、无关会话，**5/5 与预期相符**。对 `updateGoal` 源码的隔离调用验证：孤儿 Agent 会话在输入预检前返回 `AGENT_TASK_ROUTE_REQUIRED`，普通 Goal 则继续走原有输入预检。以上不代表任何 Node24/HTTP/SDK 测试通过。

## 2026-10-13 Agent 只读投影完整性修复（未通过完整 Node 验收）

- 原 `AgentProjection._sync` 的内存签名只比较事件数量、状态、结果及少数链接字段。相同事件数下的历史 `kind/payload/ts` 被改写时可能跳过 SQLite 的 append-only 校验；标题与原任务输入更改时也可能继续读到旧视图。已改为对**整个 API 任务只读视图 + 所有已发布事件的序号/种类/内容/时间 + 原企业成员 + artifact SHA**计算 SHA-256 缓存签名。缓存命中前不再遗漏这些字段。
- 对同 taskId 的 `workspaceId` 或 `subject` 变化，SQLite 原有 UPSERT 不会更新 owner 字段，容易造成授权投影漂移。现在显式拒绝更换 owner，要求恢复一致备份，而不是静默将私有数据“转交”其他企业成员。
- artifact projection 额外检查已发布下载项的 `sha256`、`bytes`、`url` 不可变。原实现只检查 SHA，可能导致任务详情返回新 URL，但 `/artifacts` 列表仍返回旧 URL。现在任一冲突均回滚，不产生第二份工件或链接。
- `test/agent-projection-linkage.test.mjs` 增加 SQLite-backed 源码测试（仍待 Node24 执行），覆盖无事件的任务视图更新、同数量事件内容改写拒绝、冲突回滚、artifact URL 不可改写及所有权不可转移。
- 本次已在隔离 V8 中运行当前 GitHub 精确类源码，以 SQL/哈希/Buffer stub 验证 7/7 个相关行为。额外比较旧/新精确源码：旧实现可制造详情 URL 与工件列表 URL 不一致，新实现明确拒绝且保留旧视图。**以上验证均非真实 Node24/SQLite/HTTP/Pi Durable 回归；不会据此解除 `release_blocked`。**
- 当前工作容器只具备 Node 22.16.0，访问私有仓库的 git clone 因 `github.com` DNS 不通而失败；不能冒充已安装 Node24 或已通过全量 npm suites。GitHub Actions 仍由独立工单 [#16](https://github.com/magicy565-web/workspace-agent/issues/16) 追踪初始化前失败。

## 下一次真实测试必须运行

从 PR60 最新固定提交（不是 PR47 或 PR59 的旧源码包）在具备 Node 24 / Python 的授权工作区执行：

```bash
npm ci --ignore-scripts
npm run build
npm run build:mini
npm run test:agent
npm run test:agent:client
npm run test:all
npm run test:agent:acceptance
```

本次 `test:agent:acceptance` 即使其他命令都通过，也应在独立审查签署前以 `release_blocked` 退出 1。保留完整 stdout/stderr、准确 commit、单项退出码。无需为了令 runner 变绿而绕过源文件审查检查或删除历史失败。

## 必须逐项确认的集成断言

1. Agent 未启用时，原 Workspace `/api`、原 Host Session、Shopify 草稿、GA4 及通知不受影响。
2. 新 Agent 的任务必须属于原 Workspace Store，原 Runtime/Pi 是唯一模型/工具/队列及检查点权威；投影 SQLite 只保留可重建读视图。
3. 两个企业成员不能交叉读取彼此的任务、Pi runs、事件、文件和源会话。
4. 预设研究工具只读且需真实来源，不能直接创建/发布商品、激活七天计划、替人审批或发送通知。
5. 同键重复、失去 HTTP 响应后的只读找回、Pi 检查点恢复和半完成文件保存经真实 Node/本地 HTTP 验证。
6. **P1：** 已在源码中对普通 PR59 V4 旧 run 保留原模型端点下的指纹；Agent V5 与改动后的端点须单独范围。仍需在真实旧 checkpoint 上进行完整恢复、权限和预算审查；不允许偷偷重跑、重建或清除原任务。
7. 原 `managed-commerce` 旧源码校验已更为扩展源码范围保留历史证据，不能替代当前供应商/Shopify/通知/Agent 的独立安全批准。

## 尚未实测

- GitHub Actions 仍在初始化阶段 `startup_failure`，无 job、无服务器 CI 通过证据。
- 当前 PR60 没有实际最新 Node 24 / Python 全量回归完成回执。
- 没有真实认证 Host、真实 Muse/ChatGPT Dot task、生产 Pi 模型、Shopify、GA4、WeChat 设备或完整七天外部通知回执。
- 没有合并 main、发布 Shopify 产品、付费模型调用或生产部署。

PR47 历史测试数只是 PR47 的原始旧提交证据，不再写成 PR60 已通过。
