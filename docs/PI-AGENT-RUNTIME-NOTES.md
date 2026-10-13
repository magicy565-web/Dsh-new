# PR60 原 Pi Runtime / Agent 执行接入：兼容审查说明

> 2026-10-13 · 当前分支为 [PR60](https://github.com/magicy565-web/workspace-agent/pull/60) 草稿；本说明仅反映实际代码差异，不是上线验收。

## 原生组件与单一业务权威

- PR59 的 `server/index.mjs` 仍是唯一 HTTP 8787 入口，保留企业接入、Muse/Dot、原供应商 MCP、Shopify、GA4、微信原会话和通知。
- 新的 `server/agent/service.mjs` 只接受既有成员作用域的 `/api/agent/v1` 请求，产物和公开事件是可重建投影。
- 权限、预算、原 Runtime run、Pi Durable JSONL 执行和模型/工具调用均由原 `server/runtime.mjs` / `server/pi-provider.mjs` 持有；禁止再起 PR44 的独立 HTTP 模型引擎。
- PR59 `supplierDraftContext` 与 `server/pi-provider.mjs` 的 revision/cancellation 审核继续生效。仅新增 `agentPresetContext` 的 source-checked document stage。
- read-only `workspace_research` 仅在现有 Host 明确启用并配置来源后可用。没有工具回执就不能声称取得外部报价、供应商核验或真实市场销量。

## 仍需独立验收 P1：旧 Pi 会话指纹

**本轮已修复“普通 Pi 会话无条件被 V5 Agent 策略阻断”的源码问题，但尚未取得运行验收和独立审查签署。**

- **普通 Pi/Muse/供应商/Goal 任务，原始固定模型端点未变：** `server/pi-provider.mjs` 保留 PR59 逐字段相同的 POLICY v4，`permissionFingerprint` 与原 SHA-256 规范完全一致。`server/runtime.mjs` 创建和核对普通 run 时，不额外写入旧源码不存在的 `endpointFingerprint` 字段；因此具有**原 V4 执行范围的任务才可能**继续按原 submission 恢复。只是允许通过首层 scope 校验，不能豁免原输入、budget、权限、撤销、审批、租约及 Pi checkpoint 校验。
- **Agent 研究预设：** 只对 `agentPresetContext` 使用新的 V5 Agent tool/source/endpoint 策略指纹，并在**同一 Store 入队事务**里锁定执行范围，不能事后给普通 run 提权。研究 adapter 的 ID、revision 和 capability 继续纳入 V5 范围。关闭 Agent API 也不会创建第二套任务队列。
- **原始模型端点变更：** 不允许继续使用 V4。即使是普通聊天，也改用绑定 HTTPS endpoint 指纹的 V5 范围；原旧 run 的 hash 不匹配时返回 `EXECUTION_SCOPE_CHANGED`，保留旧 run、submission、预算及已批准业务回执，不创建替代请求。
- **已有早期 PR60 V5 普通 run：** 本轮不在后台执行隐式范围转换或重试；任何 mismatch 按原 fail-closed 行为保留并由独立审查确认后处理。

本轮已添加源码契约/普通 Pi 恢复/Agent V5 隔离/异端点拒绝/Agent 启用时普通任务不变的测试；它们仍需要**在 PR60 本次最新固定提交上实际运行**，不能把代码审阅、静态检查或 PR47/PR59 历史日志冒充通过。

审查与实测仍需：

1. 从旧 PR59 实际代码建立已有审批、排队、运行中、被中断的 Pi runs，备份原数据与 JSONL，然后在本版本启动同一个原 Workspace Store。
2. 比对原始 `executionHash` / `execution.permissionFingerprint` / `piSubmissionId`，核对原端点未变时**只接续原同一提交**，不增加模型调用次数或重置总预算。
3. 同一个 Store 中，分别变更端点、研究 adapter ID/revision、成员权限和供应商 revision，确认错误阻断、无新 run、无第二条 Shopify mutation。
4. 验证新 Agent 预设只能调用独立授权的 `workspace_complete_preset_stage` 与已配置研究工具，不能借普通 V4 scope 启动外部发布、通知或原 Muse Worker。
5. 与 PR59 供应商、Muse、WeChat、Dot、Shopify、GA4、通知及既有 Goal/Schedule 执行审批开展完整组合回归。

历史 source pin 不应由本开发者自签替换。所有超出上述精确范围的自动兼容都未获授权。

## Agent 协调器中断恢复安全门禁

本次发现并修复 `server/agent/engine.mjs` 的一个真实风险：原协调器在 Store 启动时遇到中断 Pi run，会直接调用 `runtime.recoverPiRun()`，从而在用户未发出当次恢复指令前产生模型调用。现已改为：启动只投影历史并将任务标记为 `interrupted`、`resumable`，以 `AGENT_EXPLICIT_RESUME_REQUIRED` 解释原因；只有该任务既有成员明确调用已鉴权的 `POST /api/agent/v1/tasks/{id}/resume`，协调器才为该原 run 开通本进程一次性恢复许可，使用稳定本次 requestId 接续原 Pi submission。

许可不写入第二个队列，也不作为持久授权跨重启生效。若再次断线或服务重启，需要再次显式授权；旧 event seq 和部分工件只追加不改写。对重复或并发 `/resume`，原 Workspace Store 事务进行重新读取与单次 attempt admission，再发放仅本进程有效的原 run 恢复许可，避免一次网络重试被记成两次恢复尝试。针对实际 Agent 协调器源码，以注入合成原 Store/Scheduler 的 V8 隔离验证了重启无模型恢复 (0 次)、明确恢复一次 (1 次) 且 runId/piSubmissionId 不变。完整 Node24/SQLite/HTTP、真实外部模型和生产测试仍未进行，必须独立验收。

## Agent 专属恢复与原 Workspace 旧接口隔离（新增安全修复）

原 `runtime.retryRun()` 曾先判断 Pi 中断并立即调用 `recoverPiRun()`，随后才检查 `agentPresetContext`；因此既有成员通过旧 `POST /api/runs/{runId}/retry` 有机会绕过 Agent Coordinator 的显式恢复门禁，尤其是重启后原业务任务尚未完成 `interrupted` 投影时。已调整为**首先检查原 run 的 `agentPresetContext` / `agentTaskId`**，立即返回 `AGENT_RECOVERY_REQUIRED`，不恢复 Pi、不创建新 run；普通 Pi/Goal 的既有中断恢复分支保持不变。

原 `Workspace` 的 Agent 会话仍可按现有成员权限**只读访问**历史 Pi 运行与产物，但不可从旧通用接口注入第二条业务执行流。原 Runtime 的事务内增加 Agent 会话绑定防护：拒绝普通 `messages`、并行 `createGoal`、`reset-session`、`input-context` 修改和 `deleteConversation`；只有带原审查版 `agentPresetContext` 的 Coordinator 阶段可通过 `sendMessage`。已有 `cancel` 路径未在本次重定义；没有新建队列、身份或额外恢复入口。

新增原有统一 Host 的 HTTP 回归断言：`/api/runs/:id/retry` 返回 `AGENT_RECOVERY_REQUIRED`；上述普通会话破坏性路径返回 `AGENT_TASK_ROUTE_REQUIRED`；检查没有第二次模型调用、新 messages/run 或历史 `piSubmissionId` 改动；随后原 `POST /api/agent/v1/tasks/:id/resume` 仍必须复用原 run。当前只有直接提取源码的 V8 隔离检查，真实 Node 24 / HTTP 回归未执行。

## 当前核对边界

本轮已恢复 Agent 测试缺少的 `scripts/agent-retention.mjs` 和 `test/fixtures/agent-service-child.mjs`，并新增单 Host/原 Store 的普通 HTTP 回归。在缺乏私有仓库的可运行 Node 24 工作树时，不能把静态语法、GitHub diff 或 PR47 旧版测试结果当作 PR60 的完整回归。GitHub Actions 目前仍在 `startup_failure` 阶段阻挡，无执行 job 回执。

继续开发以 [PR60 本轮验收](AGENT-ACCEPTANCE.md) 为准；没有独立审查签署、真实 Host/Muse 接入和经过批准的生产验证之前，保持 Draft / release blocked。
