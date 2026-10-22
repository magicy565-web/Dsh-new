---
name: dtc-brand
description: 品牌出海（DTC）的八阶段操作手册：选题、产品与供应链、单位经济、店铺、投放、履约、增长、复盘；每阶段用 sourcing_dtc 落数据并渲染产出物。
whenToUse: 用户要做自己的海外品牌、独立站或 DTC 品牌时；已在 dtc 项目里，需要知道当前阶段做什么、闸门要什么。
---

# 模式：品牌出海（DTC）

八道门，顺序不能跳：

```
市场 market → 产品与供应链 product → 单位经济 economics → 品牌与店铺 store
→ 上线与投放 launch → 履约与客服 ops → 增长与复购 growth → 复盘与补货 review → done
```

每道门都要求两件事：**记录字段齐全** + **本阶段产出物已渲染**。只写结论不落数据、不生成文件，闸门不会过。

门槛不是死的：默认来自 `policies/dtc-default.json`（项目创建时快照）。买家要求四家比价、客单价高所以要更多素材、或是数字产品不需要 3PL 时，用 `sourcing_policy` 改阈值或跳过阶段，**必须写理由**；闸门会显示生效值和来源。

## 1. 市场 market

- 用 `sourcing_facts` 确认 `budget`、`targetMarket`（basis=confirmed）。
- 用 `sourcing_evidence` 录 3 条以上 A/B 级需求证据（搜索趋势、类目规模、竞品评价量）。
- 用 `sourcing_markets` 录 3 个市场（六维评分），给出推荐与理由。
- `sourcing_render` 生成 `01-market.md`，再 `sourcing_stage advance`。

打法：先看「需求是否真实」再看「能不能赚钱」。客单价低于 50 美元要谨慎，流量成本会吃掉毛利。

## 2. 产品与供应链 product

用 `sourcing_dtc` 分节写入：

1. `direction`：≥3 个方向，每个写人群、问题、价格带；`chosen` 给理由（≥24 字）。
2. `product`：名称、规格（≥40 字）、售价、包装、SKU、变体、保修。
3. `suppliers`：≥3 家，含链接、报价原文、口径（EXW/FOB/含税）、MOQ、交期、打样天数与费用。
4. `samples`：至少 1 个 `received`（收到样品），写反馈与问题。
5. `qc`：≥10 个检验项，每项写方法与标准（尺寸、外观、功能、包装、条码）。

`render` 出 `02-product.md` 与 `02-suppliers.csv` 后 advance。

打法：供应商只比价格一定翻车；先比「打样速度 + 问题响应 + 包装能力」。样品到手前不投广告。

## 3. 单位经济 economics

`sourcing_economics` 录入 dtc 输入：售价、采购、头程、关税率、平台费率、支付费率、履约费、退货率、广告成本（CAC）。

代码会算：到岸成本、广告前毛利、广告后贡献、盈亏平衡 ROAS、目标 ROAS。

- 广告前毛利 <30% 会被闸门拦住；低于门槛必须 `riskAccepted` + ≥20 字理由。
- 盈亏平衡 ROAS = 1 / 广告前毛利率；目标 ROAS = 1 /（广告前毛利率 − 目标利润率）。
- 三档敏感性自己算清楚：售价 −10%、广告 +30%、退货翻倍，哪个先击穿。

`render` 出 `03-economics.md` + `03-unit-economics.csv` 后 advance。

## 4. 品牌与店铺 store

`sourcing_dtc` 的 `store` 一次写全：

- 域名、平台（Shopify 等）。
- ≥5 个页面：首页、产品页、About、FAQ、联系。
- ≥4 份政策：物流、退换、隐私、条款。
- 支付 ≥1；运费 ≥1 条（区域/方式/价格/时效）。
- 像素事件 ≥1 个已验证（Purchase 必须）。
- 邮件订阅入口开启。

`render` 出 `04-store.md` 后 advance。

打法：先跑通「能下单、能退款、能联系」，再谈设计。政策页不是装饰，是拒付时的证据。

## 5. 上线与投放 launch

`sourcing_dtc` 的 `launch`：

- 素材 ≥9 条：3 个角度（痛点/对比/故事）× 3 个钩子。
- ≥1 个 campaign：平台、日预算、广告组数、止损规则（≥20 字）。
- `trackingVerified=true`（像素与转化事件已验证）。

`render` 出 `05-launch.md` 后 advance。

打法：先测素材再放量；预算从每天 30-50 美元起，3 天一个判断周期；花费超过 2 倍客单价仍无加购就关素材。

## 6. 履约与客服 ops

`sourcing_dtc` 的 `ops`：

- 3PL 名称、拣货准确率与准时率（各 ≥95%）、截单时间、退货地址。
- SKU 与条码已核对；测试订单 `passed`。
- 客服模板 ≥3 条；发货承诺 ≤72 小时。

`render` 出 `06-ops.md` 后 advance。

打法：3PL 上线五步——系统对接、库存转入、SKU/条码、测试订单、切换监控；合同看 SLA、最低消费、损耗责任、退出与库存取回。

## 7. 增长与复购 growth

`sourcing_dtc` 的 `growth`：

- 四类自动化流程全部完成：welcome、abandoned（1h/24h/72h）、post_purchase、winback。
- 评价机制、复购/订阅机制各写清。
- 达人名单 ≥10（平台、粉丝量、状态）。

`render` 出 `07-growth.md` 后 advance。

打法：复购是独立站唯一的结构性优势；先用邮件把首单客户拉回第二次，再谈会员。

## 8. 复盘与补货 review

`sourcing_dtc` 的 `review`：

- 指标：CVR、AOV、CAC、ROAS、退款率、库存周转。
- 补货点与安全库存：`补货点 = 日均销量 × 交期天数 + 安全库存`；`安全库存 = z × 销量标准差 × √交期`（95% 服务约 z=1.65）。
- 下一轮计划（≥20 字）。
- 用 `sourcing_handoff` 录 ≥6 项（≥4 类），写 30/60/90。

`render` 出 `08-review.md` 后 advance，项目自动 completed。

## 工具映射

| 动作 | 工具 |
|---|---|
| 项目、事实、证据、市场 | `sourcing_project` / `sourcing_facts` / `sourcing_evidence` / `sourcing_markets` |
| 方向、产品、供应商、样品、QC、店铺、投放、履约、增长、复盘 | `sourcing_dtc`（section 对应） |
| 成本与定价 | `sourcing_economics` |
| 交接与 90 天计划 | `sourcing_handoff` |
| 产出物 | `sourcing_render` |
| 闸门 | `sourcing_stage` |

## 被拦住时

读 `gate.checklist` 里 `ok:false` 的项，只补那一项；`artifact` 未过就先 `sourcing_render`。不要用文字解释绕过闸门，也不要编造缺失的供应商、样品或指标。
