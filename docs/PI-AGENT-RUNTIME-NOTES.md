# PR60 原 Pi Runtime / Agent 执行接入：兼容审查说明

> 2026-10-13 · 当前分支为 [PR60](https://github.com/magicy565-web/workspace-agent/pull/60) 草稿；本说明仅反映实际代码差异，不是上线验收。

## 原生组件与单一业务权威

- PR59 的 `server/index.mjs` 仍是唯一 HTTP 8787 入口，保留企业接入、Muse/Dot、原供应商 MCP、Shopify、GA4、微信原会话和通知。
- 新的 `server/agent/service.mjs` 只接受既有成员作用域的 `/api/agent/v1` 请求，产物和公开事件是可重建投影。
- 权限、预算、原 Runtime run、Pi Durable JSONL 执行和模型/工具调用均由原 `server/runtime.mjs` / `server/pi-provider.mjs` 持有；禁止再起 PR44 的独立 HTTP 模型引擎。
- PR59 `supplierDraftContext` 与 `server/pi-provider.mjs` 的 revision/cancellation 审核继续生效。仅新增 `agentPresetContext` 的 source-checked document stage。
- read-only `workspace_research` 仅在现有 Host 明确启用并配置来源后可用。没有工具回执就不能声称取得外部报价、供应商核验或真实市场销量。

## 阻断 P1：旧 Pi 会话指纹

**在 PR60 启用之前，必须审查原 Pi 长期任务兼容性。** PR59 原 Provider 的 POLICY v4 标明原有供应商与 Muse 工具；PR47 增加文书工具后使用 POLICY v5，同时将服务器 model endpoint 摘要及研究 adapter 描述纳入 `permissionFingerprint`。共享 `executionScope` 由该指纹派生，因此新代码即使默认关闭 Agent API，也可能将升级前保留的未结束 Pi run 判为 `EXECUTION_SCOPE_CHANGED`。

当前源码按 fail-closed 原则拒绝不匹配的自动恢复，不会根据提示词重建原订单或重试 Shopify mutation。这是**安全阻断，而非兼容通过**。未经独立审查不迁移 checkpoint、不重置预算、不修改历史 scope hash，也不把旧 runs 作为新 run 重放。

审查需要核对的测试包括：

1. 从旧 PR59 提交建立原始已排队、正在执行及已中断的 Pi runs，记录 `executionHash`、`piSubmissionId`、原输出和人工审批。
2. 用 PR60 的同一持久数据目录升级，确认旧业务读取可用且执行范围改变时不会误发起模型或对外写操作。
3. 明确接受 fail-closed 的操作处理流程，或在审查批准之后开发有可验证映射和预算守恒的兼容转换；不得直接将新旧指纹视为相同。
4. 验证纯新 PR60 会话的采购、寻源、机会预设都只调用原 Pi 工具；取消/重启/网络丢回执保持原同一 run/submission。
5. 与 PR59 供应商、Muse、WeChat、Dot、Shopify、GA4 和通知用例做单一组合回归。

## 当前核对边界

本轮已恢复 Agent 测试缺少的 `scripts/agent-retention.mjs` 和 `test/fixtures/agent-service-child.mjs`，并新增单 Host/原 Store 的普通 HTTP 回归。在缺乏私有仓库的可运行 Node 24 工作树时，不能把静态语法、GitHub diff 或 PR47 旧版测试结果当作 PR60 的完整回归。GitHub Actions 目前仍在 `startup_failure` 阶段阻挡，无执行 job 回执。

继续开发以 [PR60 本轮验收](AGENT-ACCEPTANCE.md) 为准；没有独立审查签署、真实 Host/Muse 接入和经过批准的生产验证之前，保持 Draft / release blocked。
