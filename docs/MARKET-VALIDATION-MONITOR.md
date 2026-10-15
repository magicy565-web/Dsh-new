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
