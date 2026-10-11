# Muse 原会话委派契约（TT041 后端候选）

当前独立集成候选已接合 PR22 `78f15536`、PR25 `f662ac28` 与 PR26
`b117b808`，并验证原 v3 Store 在本机 NTFS 的重启持久化。下文原基线说明是
历史契约快照；当前接线、验证范围和 Supply V1 身份落盘阻点见
[TT041-MANAGED-WORKSPACE-INTEGRATION.md](TT041-MANAGED-WORKSPACE-INTEGRATION.md)。
Supply V1 已通过父任务授权的 Downloads 原始文件核验并局部接入；历史 Library
身份落盘失败未被绕过。原供给 HTTP 测试已在当前 NTFS Store 上通过 7/7。
真实 Harness/Muse 唤醒、Windows 私密 ACL 与 Linux 验收仍未完成。

基线为 PR15 `2ac171e4da46e44e0095fe9907c2f8b1339a56cb`，不是 PR22 合并版。
实现位于 `server/muse-conversation-delegation.mjs`，原插件 overlay 中有同字节副本。
仅使用已有单一 Muse 的 `WorkerDesk -> adapter.submit -> museTasks -> Session receipt`。
本机验证了离线契约，未验证原 Harness 启动、磁盘持久化或真实 PersonalMuse 执行。

## 最小 Web / 微信小程序调用顺序

原 BFF 为 `deploy/muse-native-overlay/server/workspace-plugin-frontend.mjs`；本任务未修改它。
原 Host `workspaceDotHost.submitQuestion` 显式分流 `provider: "muse"`，只准备待审批订单。
没有 provider 的消息继续走原 Dot。已明确配置原 museSessionActor 时，即使原 REST 后置挂载，
也保留该 Host 入口；挂载前拒绝提交。Muse 单独启用不启动 Dot timer。
客户端不得提供 subject、Worker ID、任意 URL、工具或凭据；Host 从原认证及固定绑定取身份。
微信小程序可消费相同 JSON，需统一集成任务接合适的原认证入口；本任务未放宽现有 admin 门禁。

1. `POST /api/conversations/{原 nativeAgentId}/messages`，沿用原身份认证及请求签名/CSRF 校验：

```json
{
  "provider": "muse",
  "conversationId": "原 nativeAgentId",
  "requestId": "由客户端保存并重复使用的稳定请求 ID",
  "content": "用户原始需求（本地保存）",
  "order": {
    "serviceId": "channel-validation",
    "product": "已确认可公开的产品信息",
    "market": "US",
    "objective": "明确的公开资料研究范围",
    "budgetCredits": 5,
    "deadlineAt": "明确的未来 ISO 时间",
    "publicDataConfirmed": true
  }
}
```

返回 `{ "task": { "delegation": { ... }, "duplicate": false } }`，尚未创建 Muse task。
`content` 最长 4000 字符；product 240、market 100、objective 2500。
requestId 为原 WorkerDesk ID 语法，最长 128；已有服务/预算/期限约束仍由 WorkerDesk 验证。
仅公开服务可用；私有 RFQ、附件、收件人、公开发布/外部写入等扩展字段被拒绝。
公开数据确认和预算审批仅批准所审查的公开服务范围，不产生额外外部联系或发布授权。

2. 显示返回的 `delegation.review` 和 `reviewHash`，由现有管理员准确批准：
   `POST /api/worker-orders/{orderId}/approve`
   body 为 `{ "confirmed": true, "expectedReviewHash": "返回的 hash" }`。
   hash 固定原会话、原消息摘要、requestId、订单/Worker、服务、范围、预算和期限。
   改变内容或范围必须重新审查；旧 hash 不可用于另一委派。
3. `POST /api/worker-orders/{orderId}/dispatch`，body `{}`，使用原已批准订单。
   返回的 `delegation` 给出队列状态。排队不能显示为已唤醒、执行或完成。
4. `GET /api/worker-orders/{orderId}` 返回 `{ "order": { ..., "conversationDelegation": { ... } } }`。
   `GET /api/worker-orders` 各映射订单也带该字段。当前这些读接口仍限原 admin。
   `POST /api/worker-orders/{orderId}/refresh` body `{}` 复用原状态/原 job 的核对；不重新提交。
5. `POST /api/worker-orders/{orderId}/cancel` body `{}` 沿用原管理员撤销机制。
   原领取方未确认停止时保留 `cancel_requested`，不能伪装已停止。
6. 原 Session relay 持久返回后，管理员审核准确结果：
   `POST /api/worker-orders/{orderId}/accept`
   body `{ "confirmed": true, "expectedReviewHash": "原 hash", "receiptHash": "准确结果 hash" }`。
   未完成原 Session flush/ack 时拒绝验收。
7. 按 `delegation.receipt.files` 的准确引用下载：
   `GET /api/muse-worker-files/{id}?version=1&sha256={原 SHA256}`。
   沿用原所有权、文件版本、实际 bytes SHA 检查；不猜新 ID/版本。
   Host 的 `bindConversation(actor).download(orderId, reference)` 还钉住该原订单。

登录/重连只执行读和原恢复；不得重新 prepare/dispatch 新 requestId。
相同请求即使期限已过也返回原订单；同 requestId 改内容/预算会冲突。
每个固定原 owner/Worker 只能有一项未结束委派。未验收结果也会阻止下一单。
`dispatching/dispatch_uncertain` 只能核对同一原订单和原 task ID，不能用替代 job ID 绕过恢复。

## 只读 delegation 字段

| 字段 | 含义 |
| --- | --- |
| provider / conversationId / orderId / requestId | 固定原绑定和原请求映射 |
| reviewHash / review | 精确审批内容；只在原授权详情接口提供 |
| orderStatus / approvalRequired | 原 WorkerDesk 状态；草稿需审批 |
| phase | 产品展示阶段，下表解释；必须同时检查 orderStatus/blockerCode |
| taskRef / executionStatus | 原 Muse 队列 ID 和原执行状态 |
| attemptId / fence / leaseUntil / deadlineAt | 原单次尝试、租约及截止；不替换不重开 |
| createdAt / updatedAt / taskUpdatedAt | 原订单创建/更新和原 task 更新；不是活跃 heartbeat 或完成百分比 |
| blockerCode | 原订单可显示错误代码，未暴露原错误详情 |
| receipt / receiptHash / returnedHash / acceptedAt | 原成果、内容摘要、原 Session 返回确认和企业验收 |
| wake | 当前固定 `{supported:false, observed:false, reason:"original_muse_wakeup_not_verified"}` |
| executionStartedAt | 当前 null，没有原 Muse model turn 的执行实证 |
| independentlyVerified | false，原回执不提升成果真实性 |

| phase | 精确事实 |
| --- | --- |
| review_required | 新草稿待批准（不是成果待验收） |
| approved | 精确范围已批准，尚未派单 |
| dispatching | 原订单正在派单，未得到持久确认 |
| reconciliation_required | 原确认不确定，必须核对同一订单 |
| queued | 原 task pending，期限有效 |
| deadline_expired | pending task 已过期限；不自动创建新尝试 |
| claimed | 原 attempt/fence 已领取且租约有效；未证明 model turn 启动 |
| lease_expired | 原领取租约已过期；不自动重领 |
| result_ready | 原结果已记录和校验，尚未原 Session 持久返回 |
| result_returned | 原 Session flush 和业务回执持久确认；未企业验收 |
| enterprise_accepted | 原管理员验收准确已返回结果 |
| cancel_requested / cancelled / failed / input_required 等 | 原 WorkerDesk 的实际状态，保留处理/错误信息 |

不生成虚构进度百分比或已唤醒/执行标签。实际外部 Muse 工具权限、预算硬限额仍须原平台实证。

## 第三任务 PR25 控制面接线

已只读核对 `fa55f8d7` 的 `docs/DOT-CONTROL-PLANE.md` 和 `server/dot-control-plane.mjs`。
本任务没有修改这三个独占文件，也未增加第二个聚合器/journal/outbox/timer。
统一接线可直接复用 PR25 `projectControlSnapshot/advanceControlJournal/replayControlEvents`：

- 原插件持有的 `service.muse.bindDesk(actor).get/list()` 暴露 `conversationDelegation`；
  原 `bindSession(actor).view()` 同时提供 task/receipt/fence/lease 和新 `taskUpdatedAt`。
- 控制面 order 记录使用 `{kind:"order", domain:"muse", id:orderId, status:orderStatus,
  approvalRequired, ...原时间/attempt/fence/receiptHash/returnedHash/acceptedAt}`。
  task 记录使用原 taskRef/原 executionStatus。原 raw `review_required` 是成果审核；
  本任务产品 `phase:"review_required"` 是草稿审批，不能替代 raw status。
- Host 需在原认证/生命周期上下文获取原 writer 的一次一致 snapshot，使用真正
  `meta.sequence`、原 Store 更新时间及已验证源 epoch；不能把 read 次数或 Date.now 当 sequence。
  当前 DTO 不是一个持久排序/权限 source envelope，不声称 PR25 已接事件。
- PR25 private source 的 userId 必须是认证申请方，不是 Worker ownerId。
  workspace visibility/grants 必须来自原授权。总览只传其白名单引用与状态，
  不传本 DTO 的预算、review、原消息、完整 receipts/files。
- 已返回/验收用准确 receiptHash/returnedHash/acceptedAt；没有 native closedHash，
  不能伪造业务关闭或 completion。现有 Session return 使用 next-step,false，不启动模型。
- PR25 `claimed.active` 表示有效领取租约，不能将其渲染为本产品的已唤醒或已执行。
  当前没有 executionStartedAt/wake 实证。pending 已过期限在本详情是 deadline_expired，
  PR25 通用 pending 仍投影 queued；统一 UI 需保留此差异和期限，不替换原状态造 terminal。
- PR25 不直接保留 conversationId/requestId/wake/phase；原会话下钻需用授权详情接口
  解析 orderId -> 原 museConversation，不能依靠 DOM/localStorage 推测。
- 原 native IDs 允许 @ 和 /，PR25 projection ID 验证更窄；Host 需使用已验证业务身份键，
  保留原 native ID 的准确映射。不得改名一个原 native Session 来绕过校验。
- journal/consumer ack 只能由原 writer 在事务内持久提交。若订阅只提供 post-commit
  invalidation，应明确中间状态/replay 的缺口；禁止在 subscribe 中无条件写回引起递归。

本分支未注册新 Workspace MCP tools、官方 Events subscription、通知 outbox 或控制面 HTTP/SSE。
这些属于统一插件集成，仍须原 Store/完整 Host 与真实账户验证。
