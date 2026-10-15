# 七天市场验证：B 路监测适配约定

基线：PR #68 `d82d35fd7213012ff6b0e5f2f24d765aba021a9e`；关联 Issue #75。
本路只新增监测模块、独立测试和此文档，不改 A 路计划包或公共入口。
基线中没有 `AGENTS.md` 或 `.agents/skills`；已读取仓库 handoff 及工厂询盘、客户 Skill。

## 与 A 路的最小约定

导出 `createMarketValidationMonitor({ store, runtime, capabilities, shopify,
resolveLaunchReceipt, authorizeOwner, clock, trafficAdapter, outcomeAdapter })`。

`forActor(actor).create({ requestId, planId, planRevision, launchReceiptId })`
只接收原计划和回执引用，不接受调用方的批准标志、启动时间或回执正文。
`resolveLaunchReceipt({ actor, planId, planRevision, launchReceiptId })` 是 **Host 注入**
的只读解析器，必须读取原审批和执行记录，返回以下已核验的白名单字段：

```js
{
  id: 'original-execution-receipt-id', planId: 'plan-id', planRevision: 1,
  approved: true, status: 'launched', evidenceKind: 'real',
  launchKind: 'acquisition', // 单独上架商品不构成获客投放
  startedAt: '2026-10-15T08:00:00.000Z', timezone: 'Asia/Shanghai',
  productId: 'gid://shopify/Product/123', variantIds: [],
  shopId: 'gid://shopify/Shop/1', channelId: 'approved-acquisition-channel',
  businessMode: 'b2c', // b2b / b2c；双路径各建独立任务和回执
  conversationId: 'original-conversation-id'
}
```

`authorizeOwner(state, actor)` 必须由 Host 核验当前成员权限；缺省拒绝。
解析器不是新回执账本，也不得用模型输出或客户端布尔值实现。
缺少原真实回执则无法创建监测；本次开发不创建真实回执或启动活动。

返回 `goalId / scheduleId / scopeHash / startAt / endAt / status / scheduleEnabled`。
创建为 disabled Schedule，必须经原 `scheduleApprovalRequest → requestApproval →
decideApproval → enableSchedule`；本模块不代替人工批准。

其他入口：`get(goalId)`、`observe({ goalId, requestId, expectedScopeHash,
confirmed:true })`、`control({ goalId, action:'pause'|'resume'|'cancel',
expectedScopeHash, confirmed:true })` 和原调度的 `dispatch(args)`。
恢复只解除暂停，Schedule 仍需原审批；取消不可恢复。七天届满后不自动延长。
长期继续跟踪必须另行确定周期、来源授权和原任务审批，不默认永续跟踪。

## 接线边界（不修改公共入口）

原 `server/index.mjs` 的 `createCapabilityService.dispatchGoal` 目前只将
`supplier-monitor` 分派给既有服务。集成方需增加
`goal.serviceTask.kind === 'market-validation-monitor'` 时调用本模块的 `dispatch`，
其余分派保持原逻辑；创建模块并在关机时 `close()`。
原 `listen()` 已有 `setInterval → schedulerTick → capabilities.tick()`；本模块
不新增 timer、队列、Agent Loop、预算或回执账本。
当前源码交付不声称上述生产入口已接通，测试将直接使用真实原持久 Store、Runtime、
CapabilityService 和 `tick()` 证明接口可分派。

进展、冻结观测区间、去重记录和报告只写入原 Goal 的
`marketValidationMonitor` 检查点；`serviceTask` 保持不可变，避免每日结果改变原调度
的审批哈希。原 ScheduleRun 继续承载调度回执。

### 当前 OMP 会话接通限制

已只读查看 A 路计划服务：它保存原 Artifact，返回 `artifactId / version / sha256 /
planHash`，并明确 `humanReviewed:false / startedAt:null`。未来 Host 可以把
`planId=artifactId`、`planRevision=version` 映射给解析器，但还必须核验对应版本/哈希、
当前所有者、原人工审批及真实获客渠道执行回执。**计划草案不是投放回执**。

`Runtime.createGoal()` 当前拒绝 `businessAgentOwner` 会话，错误为
`BUSINESS_AGENT_CONVERSATION_ONLY`（也保留原 Agent 专属会话的路由隔离）。本模块
不绕过此边界、不新开会话、不直接伪造 Goal。测试证明普通原 Goal/Schedule 路径可用，
并证明上述原业务 Agent 会话仍被拒绝。因此，把 A 路原 OMP 业务会话接到此持久任务，
仍需集成方在原 Host 中确定合法任务关联；本路没有声称已完成 OMP 会话端到端接通。
OMP 原 TaskTool 的子 AgentSession 是委派文本处理能力，本模块不把它当七天调度器。

## 读取复用与数据口径

没有新 Shopify 连接器。商品身份/变体核验和分页订单读取直接调用原
`createShopifyClient` 的 `verify / readProductPublication / readProductOrders`，
数量计算复用 `productCohortMetrics`。原查询不含财务支付状态，因此：

- `cohort.quantities` 是产品（及所选变体）的全渠道订单数量证据，包括取消/退款；
  `retainedUnits` 不能叫付费销量，更不能称该获客渠道归因销量。收入仍不可用。
- `cohort.paidStatus=unsupported`。只有 Host 注入的已有授权转化来源才能提供付费指标。
- 流量复用已有 `createGa4ProductTrafficAdapter` v2 及其校验器，指标仍为
  `itemViewEvents → productDetailViews`，不是店铺流量、sessions 或唯一访客。
  未知时效、分钟覆盖、`partial / no_data / unsupported / unconfigured` 均保留。
  sessions 标 unsupported，加购及结账来源未接通则标 unconfigured/null。
- Shopify 数据延迟未知记 null；未配置和读取失败分别记 unconfigured 和 unavailable，
  失败另附来源错误码。空且完整的已确认 Shopify 队列允许实际零值；缺数据不填零。
  基线没有可核验来源时明确记 unavailable，不编造投放前数据。

可选 `outcomeAdapter={ id, authorizationReviewed:true, readOutcomes(scope) }` 是原渠道/
Commerce/CRM 服务的 Host 读取适配，不新增获取授权、归因或资格判定算法。输入含原
产品、排序后的变体、店铺、渠道、业务路径、`from/to`、原任务引用和 AbortSignal。
输出仅聚合白名单字段，原始买家数据和凭据不得写入任务：

```js
{
  productId, variantIds, shopId, channelId, businessMode, from, to,
  sourceId: 'same-host-reviewed-adapter-id',
  status: 'available', // partial / delayed / unconfigured / unavailable / no_data
  sampledAt: '2026-10-15T09:00:00.000Z', dataLagSeconds: 0,
  definition: '该来源实际的支付、退款/取消、归因或询盘资格判定口径',
  metrics: { paidOrders: 0, paidUnits: 0, netPaidOrders: 0, netPaidUnits: 0, refundedUnits: 0 }
  // b2b 改为 qualifiedInquiries / quoteRequests / sampleRequests / orders
}
```

B2B 询盘、报价请求、样品请求和订单可重叠，不能相加当销量；B2C 净支付订单、净
支付数量与退款分开。`available` 要求完整非负计数、无已知延迟且采样时间不早于请求
截止点；延迟或部分来源必须保留对应状态。不同产品/变体/渠道/窗口的响应拒绝。
没有已有来源时返回 unconfigured，不把测试注入器宣称已接通真实 CRM 或支付接口。

## 时间、恢复和总结

七天为真实获客启动后 168 小时；原 IANA 时区保留用于本地日期展示，跨夏令时不偷偷
延长窗口。原 Schedule 每 86400 秒触发，暂停不重置启动时间，取消不可恢复。
漏跑时沿用原调度器“最新一次”语义：一次累积读取，记录 missedDays，不补造每天数据。
正常七次触发和跨重启后的追赶都走原 ScheduleRun，未创建额外定时器。

同一启动回执映射一个任务/计划；同 requestId 观测复用原结果。中断观测可用原 requestId
恢复冻结区间；已完成但源失败的观测仍保留事实，使用新 requestId 显式重读或等待下次
原日程。不会覆写失败为零，也不会重放未确认的原调度 claim。恢复暂停后必须重新审批
原 Schedule；原 Goal 取消、权限撤销或旧 claim 都阻止写回。

七天截止生成同一原会话消息，晚到数据更正同一总结。只改变采样时间/样本标识不会增加
总结修订。缺转化来源时建议先修复测量，否则输出“按证据对照已批准计划评审”的交接，
由原模型结合用户目标选择继续、调整或停止，不硬编码漏斗或销量承诺。总结包含样本量、
数据状态、缺失日期及限制；零订单不自动判为无市场，不承诺盈利或统计显著性。
本模块不对外发送总结，不创建任何通知订阅；原通知若需要须独立审批。

## 可复现验证与启动

Node.js 24+。独立验收无需依赖安装：

```sh
node --test test/market-validation-monitor.test.mjs
```

它初始化临时私有 Store、原 Runtime/CapabilityService 和本模块，直接执行原 `tick()`，
结束即关闭和删除临时数据；不启动真实七天活动。当前公共 App 没有本模块路由，不能
声称 `npm start` 已提供七天业务入口。

扩大回归先安装锁定依赖（不执行安装脚本），再执行：

```sh
npm ci --cache /tmp/workspace-market-monitor-npm-cache --ignore-scripts --no-audit --no-fund
node --test test/market-validation-monitor.test.mjs test/supplier-monitoring.test.mjs test/capabilities.test.mjs test/store.test.mjs test/product-traffic-ga4.test.mjs
```

本路验证分层：真实原 Store 文件持久化/Runtime/审批/Schedule 服务和真实仓库 Shopify/
GA4 HTTP 客户端源码；Shopify/GA4 网络响应、Host 投放回执、付费/B2B来源和时钟均为
合成替身。没有运行真实 OMP SDK 模型回合、真实模型、真实商店/GA4/广告、真实七天，
也没有实际投放/生产发布/部署/付费调用。这些是剩余验收项，不由本地测试替代。
