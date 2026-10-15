# B 路监测薄适配验收 — 2026-10-15

基线 PR #68：`d82d35fd7213012ff6b0e5f2f24d765aba021a9e`。
环境：云端 `/workspace/workspace-agent`，Node.js `v24.19.0`。
只新增监测模块、独立测试和文档；未修改公共入口、A 路包或既有插件。

## 实际运行结果

```sh
node --test test/market-validation-monitor.test.mjs
# 19 tests, 19 pass, 0 fail, 0 skipped, exit 0

node --test test/market-validation-monitor.test.mjs test/supplier-monitoring.test.mjs test/capabilities.test.mjs test/store.test.mjs test/product-traffic-ga4.test.mjs
# 83 tests, 83 pass, 0 fail, 0 skipped, exit 0; 2360.468758 ms

git diff --check
# exit 0
```

以上范围重叠，不能把 19 与 83 相加。扩大回归首次因未安装
`@earendil-works/pi-ai` 无法加载旧监测测试；首次 `npm ci` 又因默认不可写 npm cache
失败。随后使用 `/tmp/workspace-market-monitor-npm-cache` 执行锁定 `npm ci
--ignore-scripts --no-audit --no-fund` 成功，才获得上述最终 83/83；没有更改锁文件。

源码 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| server/market-validation-monitor.mjs | 0644dd182bcea9fd192131e601ec11eb89fd34123482c18915fc84e2dab0dd98 |
| test/market-validation-monitor.test.mjs | b0d56bcff9b1f206078894195d0617be9e2203b89391a8e355abc379707e4385 |

## 证据范围与未验证项

- 使用真实仓库 Store 文件事务/单写者、Runtime、审批、Schedule 与 tick；重启实际关闭并重开私有临时目录。
- 直接使用真实仓库 Shopify/GA4 客户端源码与原商品数量计算；HTTP 响应和授权为合成替身，未访问真实商店/GA4。
- Host 投放回执解析器、B2B/支付来源是测试注入器。回执写 `evidenceKind:real` 仅用于测试分支，不是实际投放证据；生产必须由原 Host 解析真实审批及执行记录。
- 时间推进是虚拟时钟；七次日程与跨八天重启均为模拟，实际七天观测为零。
- 真实 OMP SDK 模型回合、真实模型、真实渠道、真实生产发布、广告投放、付费调用均未执行。
- 原公共入口尚未注册本服务；普通原 Goal/Schedule 测试通过不等于生产路由已接通。
- 原 businessAgentOwner 会话创建 Goal 被 Runtime 明确拒绝，已有独立测试证明；没有另开会话、绕过隔离或新建 Agent Loop。
- A 路保存的是未审核计划 Artifact，不是真实获客投放回执；不能从计划草案启动倒计时。
- B2B 合格询盘、支付转化、加购/结账真实来源、投放前基线尚未接通；缺项按 null/状态展示。
- 七天结束停止原日程；更长期周期须用户明确并沿原 Host 审批，本模块不默认延长。

接口、源口径、恢复行为和原启动方式见 [监测适配说明](../../MARKET-VALIDATION-MONITOR.md)。
CI、全应用构建、部署和真实业务验收没有由这组测试证明。
