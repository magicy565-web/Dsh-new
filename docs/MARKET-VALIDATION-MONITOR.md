# 七天市场验证：B 路监测适配约定

基线：PR #68 `d82d35fd7213012ff6b0e5f2f24d765aba021a9e`；关联 Issue #75。
本路新增监测、原回执读取适配、HTTP 和测试，并按后续授权接线原 index/Runtime/隐私过滤；不改 A 路计划包、C 路 OMP 三文件或既有工厂插件。
基线中没有 `AGENTS.md` 或 `.agents/skills`；已读取仓库 handoff 及工厂询盘、客户 Skill。

## 与 A 路的最小约定

导出 `createMarketValidationMonitor({ store, runtime, capabilities, shopify,
resolveLaunchReceipt, authorizeOwner, clock, trafficAdapter, outcomeAdapter })`。

`forActor(actor).create({ requestId, planId, planRevision, launchReceiptId, confirmed:true })`
只接收原计划和回执引用，不接受调用方的批准标志、启动时间或回执正文。
`resolveLaunchReceipt({ actor, planId, planRevision, launchReceiptId })` 是 **Host 注入**
的只读解析器，必须读取原审批和执行记录，返回以下已核验的白名单字段：

```js
{
  id: 'original-execution-receipt-id', planId: 'original-plan-artifact-id', planRevision: 1,
  planSha256: '原Artifact版本SHA-256', planHash: '原计划内容hash',
  planAcquisitionId: '原计划所选获客条目id',
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

返回 `goalId / taskConversationId / conversationId（源会话）/ scheduleId / scopeHash /
startAt / endAt / status / goalStatus / scheduleEnabled`。
创建为 disabled Schedule，必须经原 `scheduleApprovalRequest → requestApproval →
decideApproval → enableSchedule`；本模块不代替人工批准。

其他入口：`get(goalId)`、`observe({ goalId, requestId, expectedScopeHash,
confirmed:true })`、`control({ goalId, action:'pause'|'resume'|'cancel',
expectedScopeHash, confirmed:true })` 和原调度的 `dispatch(args)`。
恢复只解除暂停，Schedule 仍需原审批；取消不可恢复。七天届满后不自动延长。
长期继续跟踪必须另行确定周期、来源授权和原任务审批，不默认永续跟踪。

## 原 Host、任务和调度接线

原 `server/index.mjs` 现已创建并关闭监测服务，公共 `dispatchGoal` 按原
`serviceTask.kind` 分派；原 supplier-monitor 和普通 Goal 分派保持原路径。
原 `listen()` 的 `setInterval → schedulerTick → capabilities.tick()` 是唯一自动调度器。
已通过真实 App 的原自动 timer 测试（虚拟业务时钟）验证，不只调用孤立模块。

企业 HTTP 路径复用原签名 ingress、Session、CSRF、角色与隐私过滤：

| 方法/路径 | 用途 |
| --- | --- |
| POST /api/conversations/:sourceId/market-validation-monitors | confirmed:true，传原 planId/planRevision/launchReceiptId/requestId 创建 |
| GET /api/conversations/:sourceId/market-validation-monitors | 从原 Goal 派生本源会话的任务列表，不另存任务索引 |
| GET /api/goals/:goalId/market-validation-monitor | 当前原 Goal 状态、范围、观测、能力缺口和总结 |
| POST /api/goals/:goalId/market-validation-monitor/observe | requestId/expectedScopeHash/confirmed:true，只读观测 |
| POST /api/goals/:goalId/market-validation-monitor/control | action:pause/resume/cancel、expectedScopeHash、confirmed:true |

创建只生成 disabled 原 Schedule；审批继续走原 Schedule/Approval HTTP，不开快捷批准口。
原 Goal PATCH pause/cancel 会立即禁用其原 Schedule；恢复走上述服务 control，随后必须
重新批准原 Schedule。泛用 Goal start/resume 不运行服务任务模型。

进展、冻结观测区间、去重和报告保存在原 Goal 的 `marketValidationMonitor` 检查点。
原 `serviceTask.scheduleId` 在首次审批前绑定，此后范围与路由元数据不变，避免每日
观测改变原审批哈希；原 ScheduleRun 是唯一调度回执。

### 合法业务会话关联

原 `Runtime.createGoal()` 对 businessAgentOwner 的
`BUSINESS_AGENT_CONVERSATION_ONLY` 检查保留。用户明确 confirmed 后，Host 用当前
真实成员调用原 `Runtime.createConversation/createGoal`，创建独立的服务任务上下文，
记录 `sourceConversationId`，不复制源聊天、私库或模型 Session。
新增 `serviceTaskContext/authorizeServiceTask` 只接受 Host 进程内参数，原浏览器 body
不能传入；在原 Store 提交时重新检查当前权限、真实源所有者和空输入。
新任务有原 createdBy/workspaceId/serviceTaskOwner，不能通过原 sendMessage 或通用
Goal 创建/启动接管成另一个模型循环。源 OMP 会话的 owner/engine 归属不改变。
原隐私过滤沿这些引用保护 Goal、Schedule、结果和列表，跨成员统一拒绝。

OMP 原 TaskTool 的子 AgentSession 是委派文本处理能力，不是七天调度器；本模块
没有注册 C 路 OMP 工具或修改 worker/bridge/session。统一 Host 工具注册仍由集成方
协调；当前已接通的是原企业 HTTP/任务和自动调度路径，不是模拟新的 Agent Loop。

### A 路计划与真实启动回执

A 路 PR77 `cea2b6727acedd0c44dce63fe24576e8c89ccf41` 的未审核计划 Artifact
提供 `artifactId/version/sha256/planHash`。本路 `planId=artifactId`、`planRevision=version`。
`createApp({marketValidationOptions:{resolveLaunchReceipt,outcomeAdapter}})` 为原 Host 的
进程内注入点；HTTP 不接收回执正文、权限或连接器配置。
原 `market-validation-launch-reader.mjs` 先下载该实际 Artifact，核验版本/字节 hash、
metadata 计划 hash、源会话 ownerHash，并在原回执解析期间再次核验版本/修订/所有者。
原获客服务必须返回对同一版本/hash/计划及所选获客条目的真实审批/执行回执；未经审核
计划的布尔字段不是批准，Shopify 上架不是获客投放。没有现成真实获客回执服务时，
默认解析器为空并阻塞创建，绝不凭计划启动倒计时。

计划路径的 metrics 与 salesRequirement 由 Host 从原 Artifact 读取，不能由调用方
改选。按实际 businessMode 隔离；双路径各自引用真实启动回执和原计划路径。

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
  // 可独立返回实际有来源的 visits / add_to_cart / checkouts / refunds，未测字段可省略
  // b2b 改为 qualifiedInquiries / quoteRequests / sampleRequests / orders
}
```

B2B 询盘、报价请求、样品请求和订单可重叠，不能相加当销量；B2C 净支付订单、净
支付数量与退款分开。`available` 要求完整非负计数、无已知延迟且采样时间不早于请求
截止点；延迟或部分来源必须保留对应状态。不同产品/变体/渠道/窗口的响应拒绝。
没有已有来源时返回 unconfigured，不把测试注入器宣称已接通真实 CRM 或支付接口。

`sample.measurement.metrics` 与总结按原计划 id 返回 value/status/definition/sourceDefinition/
sourceId/dataLagSeconds：qualified_inquiries、quote_requests、sample_requests、b2b_orders、
visits、add_to_cart、checkouts、net_paid_orders、net_paid_units、refunds。
views 不代替 visits，refundedUnits 不代替定义可能不同的 refunds。来源省略必要指标时
标 unsupported 或原 unconfigured/unavailable；延迟/partial 也列入 gaps。
任何必要指标缺失都输出 insufficient_evidence，数据足够也只到 observed_not_adjudicated，
`goalVerified:false`，不自动判目标或市场已验证；成功/停止仍由原模型结合批准目标评审。

可选回执 baseline 只接受原服务可核实的投放前快照：status:available、sourceId、
evidenceRef、observedAt、精确 productId/variantIds/shopId/channelId/businessMode、
coverage:{from,to} 及 metrics:{原计划指标id:{value,definition}}。coverage.to 必须不晚于
实际 startedAt，observedAt 不早于覆盖截止，不接受错产品/渠道/变体或未来区间。
只保存白名单聚合字段。没有来源明确记 unavailable，并在总结保留缺口；观察不等于验证。

baseline 缺失不阻止基于有效原获客回执创建任务；经过原调度批准或显式人工观察控制后，
可以开始观测。传入了 baseline 却不满足上述来源/范围/时间要求时仍拒绝。七天结束的
`window_ended` 只表示时间窗口结束。必要指标缺失时保留 null/gaps 和
`insufficient_evidence`；即使必要指标都有实测数据，也只返回
`observed_not_adjudicated`、`goalVerified:false`。此时 `provisional:false` 只说明必要指标
无缺口，不说明目标达标。没有 baseline 不能当作投放前为零，也不能据此计算提升或因果效果。

## 时间、恢复和总结

七天为真实获客启动后 168 小时；原 IANA 时区保留用于本地日期展示，跨夏令时不偷偷
延长窗口。原 Schedule 每 86400 秒触发，暂停不重置启动时间，取消不可恢复。
漏跑时沿用原调度器“最新一次”语义：一次累积读取，记录 missedDays，不补造每天数据。
正常七次触发和跨重启后的追赶都走原 ScheduleRun，未创建额外定时器。

同一启动回执映射一个任务/计划；同 requestId 观测复用原结果。中断观测可用原 requestId
恢复冻结区间；已完成但源失败的观测仍保留事实，使用新 requestId 显式重读或等待下次
原日程。不会覆写失败为零，也不会重放未确认的原调度 claim。恢复暂停后必须重新审批
原 Schedule；原 Goal 取消、权限撤销或旧 claim 都阻止写回。

七天截止在同一原服务任务会话生成总结，原 Goal 为 review_required；晚到数据更正同一总结。只改变采样时间/样本标识不会增加
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
结束即关闭和删除临时数据；不启动真实七天活动。
HTTP/自动调度验收：`node --test test/market-validation-monitor.http.test.mjs`。

扩大回归先安装锁定依赖（不执行安装脚本），再执行：

```sh
npm ci --cache /tmp/workspace-market-monitor-npm-cache --ignore-scripts --no-audit --no-fund
npm run build
node --test test/market-validation-monitor.test.mjs test/market-validation-monitor.http.test.mjs test/supplier-monitoring.test.mjs test/capabilities.test.mjs test/store.test.mjs test/product-traffic-ga4.test.mjs test/runtime-v2.test.mjs test/agent-owner-policy.test.mjs test/access.test.mjs test/pi-business-conversation.native.test.mjs test/pi-task.http.test.mjs
```

本路验证分层：真实原 Store 文件持久化/Runtime/审批/Schedule 服务和真实仓库 Shopify/
GA4 HTTP 客户端源码；Shopify/GA4 网络响应、Host 投放回执、付费/B2B来源和时钟均为
合成替身。原 Pi SDK/AgentSession keyless 替身回归已运行；新增 HTTP 测试的 OMP
engineAdapter 是禁止模型调用的替身，没有运行真实 OMP SDK 模型回合、真实模型、
真实商店/GA4/广告、真实七天，
也没有实际投放/生产发布/部署/付费调用。这些是剩余验收项，不由本地测试替代。


原 App API 的源码启动沿 `npm run dev:server`，构建后回环地址 8787；原 OMP 统一
启动仍是 `npm run workspace -- --serve`，需要既有已审核运行时/绑定，不由本模块安装。
这些命令不自动批准日程或投放。默认 Host 无真实获客回执读源，所以创建会准确阻塞；
本轮只在临时测试 App 上运行签名 HTTP 与调度，不部署生产环境。
