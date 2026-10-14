# Pi 与现有 Personal Worker：下一轮接入边界

本轮只读核查源码，没有访问外部 Worker、发送消息、投递任务或检查真实凭据。`agent:dev` 当前是原 Workspace Agent 服务身份；它不能凭 `WS_AGENT_TOKEN` 获得原 Muse owner Session 的权限。这里记录下一轮可复用的接口，不表示外部 Muse/dot 已连接或已执行。

## 已存在的两类委派

| 路径 | 真实对象与权威来源 | 当前可证明的范围 |
| --- | --- | --- |
| 原 Pi `workspace_delegate` | 原 Pi Runtime 内部 child/sub-agent，受父任务范围约束 | 内部模型子任务；不是外部 Muse/dot，不能以 child 成功宣称 Personal Worker 执行 |
| Muse owner conversation delegation | 原 owner/conversation → `createPiMuseBinding` → `createNativeMuseBinding` → 原 WorkerDesk、Muse Session 与 pull bridge | 原订单、审批、入队、领取、文件/结果、人工接受的接口已存在；外部执行和唤醒须另行验证 |
| dot Worker REST/MCP | 固定 Worker 的独立 Bearer 通道 → 原 `createDotWorkerBridge` | 公开范围内的 pull/claim/return 协议；没有从 Pi 远程启动或冒充 dot 的入口 |

源码：[Pi Muse 绑定](../server/pi-muse-binding.mjs)、[原生 Muse 绑定](../server/muse-worker-native.mjs)、[会话委派](../server/muse-conversation-delegation.mjs)、[pull bridge](../server/dot-worker-bridge.mjs)。

## 身份与审批必须沿用

原 owner 入口通过 [`createNativeOwnerTransport`](../tui/owner-session-transport.mjs) 每次重新读取 `/api/session`，核对 enterprise、workspace、subject、admin 和 exact conversation；写操作需要原 CSRF。`createPiMuseBinding` 再检查 exact owner 与 conversation。原 Worker 使用单独固定的 token digest，拒绝 browser Cookie/Origin/Referer，所有任务读写都检查该 Worker 的归属。两条通道不能相互转换。

现有 owner 模型扩展 [`tui/extensions/workspace-agent.mjs`](../tui/extensions/workspace-agent.mjs) 已能在可见人工确认后准备公开 Muse draft；没有向模型注册 approve/dispatch/publish/schedule。原 owner 仍须分别 review、approve、dispatch。订单审批绑定 exact review hash、公开范围、预算、期限和 stable requestId；重复 requestId 不得变更内容或创建另一个订单。

## 下一轮最小复用方案

1. 先使用原 Host/Session 前台 owner 入口加载已存在 `workspace_muse_draft`，保留每次可见人工确认。若要让 `agent:dev` 显示该能力，先明确它仍是 Agent 服务 profile，不能自动插入 owner Session；只有原 Host 能提供已授权 owner binding，才可单独接入其原工具。缺该绑定时明确报缺口。
2. 复用 `/api/conversations/{conversationId}/muse-delegations` 的原 prepare/get/list，再通过原人工命令调用 `approve`、`dispatch`、`refresh`、`cancel`、`accept`。不要新建队列、业务存储、调度器或批准状态。刷新把已验证回执投影回原 Session，不是新模型 turn、唤醒或结果接受。
3. 外部 Worker 继续使用原 `/api/muse-worker/v1`（dot 为 `/api/dot-worker/v1`）的 identity/inbox/read/claim/status/heartbeat/upload-file/submit-result/report-blocked/confirm-stop，以及现有私有 MCP。入队后等待真实外部 pull；不把入队收据当作执行证明。
4. 结果读取复用原 Session exact artifact version + SHA，区分 submitted、receipt ready、durably returned 与 enterprise accepted。保留原人工接受和 WorkerDesk 结算。原 lease/fence/attemptId、幂等请求和撤权规则适用于每次写入；取消执行中的 Worker 可能只是 `cancel_requested`，只有原 stop 确认才证明 stopped。租约过期或不确定派发须 reconcile/cancel 同一订单，不能新建任务冒充恢复。

## 真实连接缺口与下一轮验收

- 本轮未验证是否存在安全配置的 exact native owner/conversation、已审查 Worker 身份、独立凭据、公开 scope 和 enforceable external budget。源码门槛 `enabled && scopeReviewed && externalBudgetVerified` 仅是配置门槛，不是在线证明；不要创建凭据或扩大权限来补齐。
- `createDotWorkerBridge.identity()` 返回 `connected: false`，连接信息保持 `onlineVerified: false`。会话委派 `wake.supported`/`wake.observed` 为 false，`executionStartedAt` 为 null，`independentlyVerified` 为 false。`lastSeenAt`、排队、claimed 或已提交回执分别说明不同事实，不能覆盖这些未知状态。
- 没有源码证明公共 inbound task-creation/wakeup 能远程启动 Personal Worker。下一轮真实连接验收必须由已授权外部 Muse/dot 主动 pull/claim，并返回其真实工具来源和原文件；任何合成 worker consumer 只验证协议，不能宣称实际 Personal Worker 已运行。
- 合成验收可先覆盖 MCP initialize/tools/list/tools/call、独立身份错误拒绝、跨 owner/Worker 404、stable requestId 重复、过期 lease/fence、取消后拒绝 upload/submit、重启保留 original order/attempt、exact SHA 下载以及人工接受不重复结算。真实外部任务投递仍需单独授权和已验证预算，本轮没有执行。

已有协议测试入口：[原 Pi Muse 绑定](../test/pi-muse-binding.test.mjs)、[原生绑定](../test/muse-worker.native-binding.test.mjs)、[会话委派](../test/muse-conversation-delegation.test.mjs)、[Muse HTTP](../test/muse-worker.http.test.mjs)、[dot bridge](../test/dot-worker-bridge.test.mjs)。本轮新增文档是源码核查，不是这些测试重新执行的声明。
