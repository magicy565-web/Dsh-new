---
name: sourcing
description: 商机项目的工作流契约：两条路线（DTC 八道门、B2B beta 六道门）、状态来源、阶段工具与闸门被拒时的修法。
whenToUse: 任何新会话的第一条业务消息；不确定当前阶段或下一步该做什么；闸门被拒绝时。
---

# 工作流契约

这不是「写一份报告」，而是推进一个有状态的项目。流程由代码强制执行：

- **DTC 品牌线（当前主线）**：市场 → 产品与供应链 → 单位经济 → 品牌与店铺 → 上线与投放 → 履约与客服 → 增长与复购 → 复盘与补货 → done
- **B2B 供货线（beta，冻结在 v1）**：立项 → 市场 → 供给与对象 → 单位经济 → 资产生产 → 交接 → done

- **唯一事实来源是 `sourcing_*` 工具里的项目记录**，不是对话里的说法。
- **只有 `sourcing_stage advance` 能推进阶段**；闸门由代码从已存数据计算，未通过时给出全部 blocker。
- 每道 DTC 门还要求**本阶段产出物已渲染成文件**；不生成文件，闸门不过。
- **门槛和产出物清单来自 policy 快照**（`policies/dtc-default.json`），不是写死的代码常量。项目创建时快照，互不影响；买家或品类有特殊要求时用 `sourcing_policy override` 改一项阈值并写理由，不适用的阶段用 `skip`（例如数字产品跳过 `ops`），全部留痕。
- **跨周推进用长期委托**：`sourcing_mandate` 记录目标/成功标准/授权/节奏，`schedule_create` 负责到期叫醒冷会话；每次醒来读 `nextActions`、执行、`checkin`。协议见 `long-term-mandate` 技能。

## 开工（两条线都一样）

1. `sourcing_project` `action=create`：`mode`（dtc / b2b）、`title`、`goal`（可量化）、`targetMarkets` 或 `marketDecision=agent`、`workspaceDir`（会话工作目录的绝对路径）。
2. 读返回的 `gate.blockers`，当作开工清单。
3. 用 `sourcing_facts` 录事实：用户或来源明确说过的标 `confirmed`，自己的估算标 `assumed`。
4. 进入第一道门（dtc 是 `market`，b2b 是 `intake`）。

## DTC 八道门

| 阶段 | 工具 | 闸门要点 | 产出物 |
|---|---|---|---|
| 市场 | `sourcing_facts`、`sourcing_evidence`、`sourcing_markets` | budget 与 targetMarket 已确认；3 个市场、六维评分、每个有 A/B 证据；推荐理由 ≥24 字 | `01-market.md` |
| 产品与供应链 | `sourcing_dtc`（direction / product / suppliers / samples / qc） | ≥3 个方向并选定；规格 ≥40 字；≥3 家供应商；≥1 个样品 received；QC ≥10 项 | `02-product.md`、`02-suppliers.csv` |
| 单位经济 | `sourcing_economics` | 广告前毛利 ≥30%；盈亏平衡 ROAS 可算 | `03-economics.md`、`03-unit-economics.csv` |
| 品牌与店铺 | `sourcing_dtc`（store） | 域名/平台、≥5 页面、≥4 政策、支付、运费、像素已验证、邮件入口 | `04-store.md` |
| 上线与投放 | `sourcing_dtc`（launch） | ≥9 条素材、≥1 campaign（预算 + 止损规则）、trackingVerified | `05-launch.md` |
| 履约与客服 | `sourcing_dtc`（ops） | 3PL + SLA ≥95%、截单、退货地址、SKU 核对、测试订单 passed、≥3 模板、≤72h | `06-ops.md` |
| 增长与复购 | `sourcing_dtc`（growth） | 四类流程、评价、复购、≥10 达人 | `07-growth.md` |
| 复盘与补货 | `sourcing_dtc`（review）、`sourcing_handoff` | 六项指标、补货点、安全库存、下一轮计划、交接 ≥6 项 | `08-review.md` |

## B2B 六道门（beta）

| 阶段 | 工具 | 闸门要点 |
|---|---|---|
| 立项 | `sourcing_facts` | product / moq / priceBasis 已确认；目标市场已定或委托 |
| 市场 | `sourcing_markets` | ≥3 候选、六维评分、每个有 A/B 证据、推荐理由 |
| 供给与对象 | `sourcing_leads` | ≥20 条、A/B ≥8、核实 ≥60%、域名不重复 |
| 单位经济 | `sourcing_economics` | 毛利率 ≥15%（或记录风险接受） |
| 资产生产 | `sourcing_render` | economics / buyers / outreach 已生成 |
| 交接 | `sourcing_handoff` | ≥6 项、≥4 类、30/60/90 |

## 操作规则

- **先读后写**：写前用 `sourcing_project read` 拿 `revision`，带 `expectedRevision`；遇到 `REVISION_CONFLICT` 重读再写。
- **先查后引**：`sourcing_evidence` 只收真实打开过的链接；A 级必须有 publisher；同 URL + 主张只记一次。
- **先问后做**：只有用户自己的选择（市场、预算、名字、是否接受低毛利）、花钱、对外发送、注册主体才问；一次最多 5 个问题，能给默认值就给。
- **先渲染再推进**：每道 DTC 门推进前先 `sourcing_render` 生成该阶段产出物；`artifact` 未过就是没渲染。
- 用户改主意：`sourcing_project update` 改目标或市场；已录数据保留，闸门按新目标重算。

## 失败处理

- `advanced:false`：读 `gate.checklist`，只补 `ok:false` 的项。
- `INVALID_INPUT`：按消息里的字段修；不要编造缺失值来通过校验。
- 同一道门卡住超过两轮：把 blocker 原样告诉用户，说明需要他提供哪一项事实。

## 数据与产出物

- 记录：`$DSH_HOME/data/sourcing/projects/<projectId>.json`（原子写入、revision、操作日志）。
- 产出物：`<workspaceDir>/sourcing/<slug>/`，DTC 为 `00-brief.md`、`01-market.md`、`02-product.md`、`02-suppliers.csv`、`03-economics.md`、`04-store.md`、`05-launch.md`、`06-ops.md`、`07-growth.md`、`08-review.md`、`handoff.md`、`dashboard.html`。
- 最终回复：3 行摘要 + 文件列表；用 `present` 交付 `dashboard.html` 与当前阶段最重要的文件。
