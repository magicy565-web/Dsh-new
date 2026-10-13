# PR60 统一 Pi Agent 接入验收（2026-10-13）

## 当前状态

**原 Work 环境的组合基线已通过；当前产品增量 `017cf20` 的构建、后端与会话回归及真实浏览器验证也已完成。整体仍为 release_blocked，独立审查与真实生产验收未完成。**

- 唯一集成 PR：[PR60](https://github.com/magicy565-web/workspace-agent/pull/60)。初始基线 PR59 `18cc80aca0f88a68fb96d2f1d960897f8a48dac2`，后通过双父提交 `9f808f202ce825a2ab647f11456eb5dbcf8fe76e` 同步 PR59 的原生 Host/Muse 新修复 `32c8ce98fe28cda1e22a16bf0d1088c768e081c8`，且未覆盖其源码。下列历史段落记录源码接口阶段；组合基线 `13b268edebbc3a26dd7e4197dfecb2dde37d3164` 及其文档交付 `3f84eb0103db8b3e41e8cebdee8d1f37095c9ac5` 保留原身份。最新源码和实际运行在下一节单列。
- 选择性来源：PR47 `1e0cc43d973b5d10861561f2cd4979065d5f33f6`。
- 本次的代码边界、唯一权威和部署限制见 [AGENT-UNIFIED-HANDOFF.md](AGENT-UNIFIED-HANDOFF.md)。
- 未重建商城/供应商库/计划/通知、模型循环、商业 Task Store 或另一个后端；PR59 是业务和界面权威。

## 当前产品增量：固定资料检查、原准备事务及可看前端

最新测试源码 S2 为 **`017cf2030836398513319a7c910c6ad732e43b16`**，tree `9829e53955063f5a4a321e14ae71d880b85276f8`。已修复点击会话固定资料 v1 却预览/下载当前 v2 的真实缺陷；缺失版本明确拒绝，旧产品 r1 检查当前 r2 时说明实际版本并要求显式重选。Muse 原准备意图在 Store 事务内重检同一 pinned input，普通删除竞态拒绝落单。没有另一个业务引擎或权限升级。

在干净 S2、Node24.19 上实际执行 `npm run build` exit0、`npm test` 758总/751通过/0失败/7条件跳过，以及原会话三文件加新引用 DOM 19/19。固定资料/手填公共范围浏览器5流程通过、8截图、零模型/页面错误，仅生成一份 review_required 原订单、taskRef=null。原 SDK intake 与准备服务事务的不同测试边界在记录中明确，不虚称 prepare HTTP 或生产测试。

按用户“完成前端构建让我看到”另补当前 App 的真实 Chromium 页面：主入口/资料库13流程29截图、待审委托10截图、本地 Pi 成果4截图，含390px/1440px及逐图状态。成果由原 Runtime/已安装 Pi SDK 的本地合成 provider 实际生成，1次本地 SDK 请求、0真实模型/Muse调用；真实浏览器预览/下载的原文件字节/SHA匹配，重开同 run/file 且不重放。截图期间只有新验证资料未跟踪，代码/测试/锁文件与 S2 一致；不把整个工作区写成干净。

[本次源码与验收索引](validation/product-reference-closure-017cf20/README.md)、[逐图来源和状态](validation/product-reference-closure-017cf20/visible/VISIBLE-SCREENS-INDEX.json)、[当前实际前端构建包](../deliverables/frontend-visible-017cf20/Workspace-Frontend-Build-017cf20.zip)。构建包仅包含3个当前dist文件和构建回执，依赖原同源API，不能双击当成已连接的完整应用。当前没有已核实的用户可访问预览URL，未把localhost作为预览交付，也未创建部署。

S2的 [CI38367556687](https://github.com/magicy565-web/workspace-agent/actions/runs/38367556687) 仍为 startup_failure、jobs=[]。Library保存助手在读取工具阶段报network错误，没有confirmed library_file_id；仓库截图/构建包与hash可供父会话准备原生附件。文档/证据/包在之后独立提交；代码、测试、锁及构建指纹继续与S2一致。本次不重跑未受影响的全TUI/小程序；新增原Pi专项的八文件复用范围有明确证明。

## 保留：原 Work 组合基线实际执行（固定源码 S，不等于上线）

源码 S 为 **`13b268edebbc3a26dd7e4197dfecb2dde37d3164`**，tree `3b45b5e34c13ee9d6deba594240961a213ee526c`，Node24.19/Python3.12。文档和证据属于之后的独立提交 D；D 未改变执行代码、测试或锁文件，源码包和每条新运行记录继续指向 S，不能把 D 声称为另一次测试。代码/构建指纹与逐文件例外清单见随附证明。

| S 上实际运行 | 结果 |
| --- | --- |
| 原 `test:agent:acceptance` | 五子命令全 exit0，localAutomatedResult=passed；整体 release_blocked / runner exit1 |
| 网页 / 小程序构建 | 通过 / 通过 |
| 全后端 | 757总、750通过、0失败、7条件跳过 |
| Agent / Python | 41/41、27/27 |
| DOM | 19原UI+17会话+6当前Library+7退役组件契约，49通过；当前生产入口42项 |
| 当前网页 Chromium | 13流程、29截图、0页面错误/0模型调用；真实原HTTP/Store与合成数据 |
| 源码包与干净重建 | 1244原Git文件/模式/blob/SHA/tree匹配；新目录锁定离线安装后3网页+39小程序文件逐字节一致 |
| CI / 上线清点 | CI38358123602 startup_failure、jobs=[]；check:launch ready=false / exit1 |

[最终验收索引](validation/workspace-release-prep-13b268e/README.md)、[原runner完整报告](validation/workspace-release-prep-13b268e/final/acceptance/report.json)、[当前网页截图与测量](validation/workspace-release-prep-13b268e/final/web/VERIFICATION.json)。所有日志保留命令、原SHA、状态、退出码和hash；分母互有重叠，PTY/浏览器流程也不与Node tests相加。

未重跑的 `49d5360` 基线小程序协议126、mini browser10、TUI9/3/2和PTY8/7/8、PR59 checkpoint升级2、Muse客户端40保留其原SHA；[11文件证明](validation/workspace-release-prep-13b268e/reused/pi-client/SOURCE-EQUIVALENCE-13b268e.json)与[原服务/mini tree及39编译文件证明](validation/workspace-release-prep-13b268e/final/MINI-SOURCE-EQUIVALENCE.json)明确其与S的字节一致范围，没有重标为S的新运行。

历史独立安全任务曾被平台拒绝，本轮没有重启、换人或改措辞绕过。真实Host/Muse/Dot/模型/Shopify/GA4/微信/七天、生产Identity登录/版本/部署及独立安全门槛仍未签署。用户报告华为主机重启不等于本任务验证。没有生产写入、部署/main合并、付费或凭据/运行数据交付。

## 历史：GitHub 源码接口阶段检查（截至 49d5360，当时未运行组合测试）

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

**上述源码接口阶段的新增 Node 测试当时尚未运行**。本轮已在下述固定源码执行 Node24/SQLite/HTTP/Pi 回归；这些历史 V8 检查不单独替代当前记录，也不证明微信运行时或生产验收。

## 历史：2026-10-13 源码接口阶段权限回归与 CI 记录

- 本轮修复 `server/agent/store.mjs` 投影签名遗漏原 `conversationId`/`runId` 的问题，并新增 `test/agent-projection-linkage.test.mjs`；`npm run test:agent` 的准确列表目前是 **9 个测试文件**，包括原先遗漏的单 Host、显式恢复和投影关联用例。
- 复核发现原 `retryRun()` 在 Agent 权限检查前直接进入 Pi 中断恢复，已修复，并在 `test/agent-pi-service.http.test.mjs` 增加旧接口拦截检查；通用消息/Goal/重置/删除无法变更 Agent 所拥有的 Pi 会话。旧代码和修复代码的 `retryRun` 在 V8 合成范围中分别表现为 Agent 恢复 1 次 vs 0 次；普通 Pi 仍恢复 1 次。修复后 `sendMessage` 的独立合成作用域检查拒绝普通消息且不新增 messages/runs。这些都不是端到端 Node/Pi SDK 通过。
- **CI 是更早的跨分支阻断**：2026-10-09 的 `main` [运行 37965153325](https://github.com/magicy565-web/workspace-agent/actions/runs/37965153325)、PR59 的 `32c8ce9` [运行 38328913909](https://github.com/magicy565-web/workspace-agent/actions/runs/38328913909)、PR60 的最新提交均报告 `path=BuildFailed`、`conclusion=startup_failure`；已查询 PR60 运行的作业列表，**0 jobs**。实际失败发生在测试执行前；不能归因于本轮源码，也不能判断仓库 Actions 设置、计费、策略或 GitHub 平台的具体根因。
- 具备仓库管理权限的维护者需在 GitHub Actions 页面检查报错横幅、工作流有效性、组织/仓库 Actions 权限、Runner 和计费状态。只有出现真正的 job 执行回执后，才可按下述命令与原始 logs 记录新的结果；不要将 `startup_failure` 标为测试失败或测试通过。

## 历史：额外权限回归（源码接口阶段尚无 Node24 执行记录）

- `test/agent-pi-service.http.test.mjs` 现在要求原 `retry`、`resume`、`action-decision`、普通 `messages`、`createGoal`、`reset-session`、`PATCH input-context` 和 `DELETE conversation` 在受保护的 Agent Pi 执行上下文里拒绝，不增加 Run/模型调用。
- 新增“孤儿 Pi Run”回归：原任务 registry 丢失，但 `runs[].agentTaskId` 仍在时，原会话不得成为普通 chat 或 Goal。包括模拟历史已存在的 Goal 被错误指向 Agent 会话时，其 `action=start` 不得启动模型；已存在的原 Pi Run 和历史 messages 必须保留。
- 对当前 GitHub 源码的 `agentConversation` 执行 5 种 V8 合成场景：正常 Agent 任务、孤儿 `agentTaskId`、孤儿 `agentPresetContext`、普通 Pi 会话、无关会话，**5/5 与预期相符**。对 `updateGoal` 源码的隔离调用验证：孤儿 Agent 会话在输入预检前返回 `AGENT_TASK_ROUTE_REQUIRED`，普通 Goal 则继续走原有输入预检。以上不代表任何 Node24/HTTP/SDK 测试通过。

## 历史：Agent 只读投影完整性修复（源码接口阶段）

- 原 `AgentProjection._sync` 的内存签名只比较事件数量、状态、结果及少数链接字段。相同事件数下的历史 `kind/payload/ts` 被改写时可能跳过 SQLite 的 append-only 校验；标题与原任务输入更改时也可能继续读到旧视图。已改为对**整个 API 任务只读视图 + 所有已发布事件的序号/种类/内容/时间 + 原企业成员 + artifact SHA**计算 SHA-256 缓存签名。缓存命中前不再遗漏这些字段。
- 对同 taskId 的 `workspaceId` 或 `subject` 变化，SQLite 原有 UPSERT 不会更新 owner 字段，容易造成授权投影漂移。现在显式拒绝更换 owner，要求恢复一致备份，而不是静默将私有数据“转交”其他企业成员。
- artifact projection 额外检查已发布下载项的 `sha256`、`bytes`、`url` 不可变。原实现只检查 SHA，可能导致任务详情返回新 URL，但 `/artifacts` 列表仍返回旧 URL。现在任一冲突均回滚，不产生第二份工件或链接。
- `test/agent-projection-linkage.test.mjs` 增加 SQLite-backed 源码测试（仍待 Node24 执行），覆盖无事件的任务视图更新、同数量事件内容改写拒绝、冲突回滚、artifact URL 不可改写及所有权不可转移。
- 本次已在隔离 V8 中运行当前 GitHub 精确类源码，以 SQL/哈希/Buffer stub 验证 7/7 个相关行为。额外比较旧/新精确源码：旧实现可制造详情 URL 与工件列表 URL 不一致，新实现明确拒绝且保留旧视图。**以上验证均非真实 Node24/SQLite/HTTP/Pi Durable 回归；不会据此解除 `release_blocked`。**
- 此前源码接口阶段的工作容器仅有 Node22.16，私有仓库 clone 曾因 DNS 受阻；该历史限制不能描述现在的原 Work 环境。本轮已实际核对 Node24.19/Python3.12、fetch 最新仓库并执行下述固定源码回归。GitHub Actions 的初始化前失败仍由 [#16](https://github.com/magicy565-web/workspace-agent/issues/16) 追踪。

## 历史：投影两阶段验证与旧 Workspace 备份回归（49d5360）

修复前在 `AgentProjection._sync` 中，工件文件 `materialize()` 先于 SQLite 中的历史事件连续性、企业成员归属、工件元信息校验发生。若某个已发布事件被改动，虽然 SQLite 会回滚，新增未登记的工件文件仍可能出现在磁盘上。并且原投影没有检测恢复的 Workspace `meta.sequence` 低于已投影 `authority_sequence` 的情况。

现已复用同一个 SQLite 投影和原企业 Store，不增加任何第二套队列或状态：

- 工件落盘**前**执行 `assertContinuity()`，检查原 owner、已发布的事件逐项不变、已发布工件元信息不变及历史 `authority_sequence` 单调性。
- 即使内存签名命中，依旧验证来自较旧 Workspace 备份的回退，避免缓存隐藏回退。
- 工件落盘后在 SQLite `BEGIN IMMEDIATE` 事务内再次执行相同校验，再追加新的事件和下载记录；校验失败不会提交新投影视图。
- 新增 `test/agent-projection-linkage.test.mjs` 针对先前真实漏洞的回归：被修改的旧事件与同时新增的工件必须在新工件写盘前拒绝、旧 Store sequence 被拒绝、企业 owner 错误时不留下新文件。

隔离 V8 对旧版 `206bf8c` 与修复 `f236140` 的**真实 AgentProjection 类源码**注入同一组模拟 SQLite/文件依赖：旧版可在回滚前调用新文件写入，修复版无该调用；旧版不检查序列回退，新版按预期拒绝。**当时没有 Node24 的真实 SQLite/文件系统组合记录**；本轮固定源码 Agent41项已实际运行并通过这些投影回归。当前 GitHub Actions 的 `startup_failure` 仍不是测试通过的证据。完整验收前请保持 Draft/`release_blocked`，并保留原 Workspace/Pi/Shopify/Muse/Dot 现有权限和预算门禁。

## 保留：组合基线 13b268e 已实际运行的命令

原 Work 环境使用固定源码 `13b268edebbc3a26dd7e4197dfecb2dde37d3164`。文档与证据后续单独提交，代码/测试/锁文件保持该源码，关联证明见 [SOURCE-PRESERVATION.json](validation/workspace-release-prep-13b268e/SOURCE-PRESERVATION.json)。实际原 runner 已执行以下构建与组合回归；依赖由原锁文件安装，源码包还完成干净离线重建：

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
6. **P1：** 普通 PR59 V4 保留原端点指纹，Agent V5/改动端点保持独立范围。本轮实际原 PR59 `32c8ce9` 的合成持久 checkpoint 升级到 `49d5360` 两项通过，执行源码与最终固定源码的 11 文件字节证明随附；没有自动重放、第二次 SDK 调用或 ID 替换。生产原 checkpoint、真实权限/预算及独立审查仍需其原验收，不由本地数据替代。
7. 原 `managed-commerce` 旧源码校验已更为扩展源码范围保留历史证据，不能替代当前供应商/Shopify/通知/Agent 的独立安全批准。

## 当前仍未通过的门槛

- GitHub Actions 仍在初始化阶段 `startup_failure`，无 job、无服务器 CI 通过证据。
- 固定源码已有实际 Node24/Python 全量本地完成回执；受审完整 Cordis Host 源码/构建导出仍缺，六个相应检查跳过；一个 Windows 专用检查在 Linux 跳过。直接 overlay 两文件因原 Host 模块缺失在导入阶段失败，原记录保留。
- 没有真实认证 Host、真实 Muse/ChatGPT Dot task、生产 Pi 模型、Shopify、GA4、WeChat 设备或完整七天外部通知回执。
- 没有合并 main、发布 Shopify 产品、付费模型调用或生产部署。

PR47 历史测试数只是 PR47 的原始旧提交证据，不再写成 PR60 已通过。
