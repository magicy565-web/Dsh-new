# Sourcing Agent（商机官）

DeepSeek Harness 的第一个业务型内置 Agent：把「已有的产品」和「还只是念头」的创意，变成海外销售收入。

它不是一套提示词技能，而是一条**有状态、有闸门的产品流程**：项目记录是唯一事实来源，阶段由代码推进，产出物由代码渲染。

> **当前版本：DTC 品牌线 v2 已完整落地（8 道门）；B2B 供货线冻结在 v1（6 道门，beta）。**
> 真实采购对接流程的研究见 [docs/PROCESS-RESEARCH.md](docs/PROCESS-RESEARCH.md)，v2 设计见 [docs/PROCESS-V2.md](docs/PROCESS-V2.md)。

## DTC 流程（主线）

```
市场 market → 产品与供应链 product → 单位经济 economics → 品牌与店铺 store
→ 上线与投放 launch → 履约与客服 ops → 增长与复购 growth → 复盘与补货 review → done
```

每道门校验两件事：**记录字段** + **本阶段产出物已渲染成文件**。只写结论、不落数据、不生成文件，闸门不会过。

| 阶段 | 闸门（代码判定） | 产出物 |
|---|---|---|
| **市场** | budget / targetMarket 已确认；3 个市场、六维评分、每个至少 1 条 A/B 证据；推荐理由 ≥24 字 | `01-market.md` |
| **产品与供应链** | ≥3 个方向并选定（理由 ≥24 字）；规格 ≥40 字；≥3 家供应商（MOQ/交期/打样）；≥1 个样品 received；QC ≥10 项 | `02-product.md`、`02-suppliers.csv` |
| **单位经济** | 成本项齐全；广告前毛利 ≥30%（或记录风险接受）；盈亏平衡 ROAS 可算 | `03-economics.md`、`03-unit-economics.csv` |
| **品牌与店铺** | 域名/平台；≥5 页面；≥4 政策；支付；运费；像素已验证；邮件入口 | `04-store.md` |
| **上线与投放** | ≥9 条素材（3 角度 × 3 钩子）；≥1 campaign（预算 + 止损规则）；trackingVerified | `05-launch.md` |
| **履约与客服** | 3PL + SLA ≥95%；截单；退货地址；SKU 核对；测试订单 passed；≥3 模板；发货承诺 ≤72h | `06-ops.md` |
| **增长与复购** | welcome/abandoned/post_purchase/winback 四类流程；评价；复购；≥10 达人 | `07-growth.md` |
| **复盘与补货** | CVR/AOV/CAC/ROAS/退款率/库存周转；补货点与安全库存；下一轮计划；交接 ≥6 项 | `08-review.md` |

被拦住时返回完整 blocker（例如「样品已到手：0 个已收到」「本阶段产出物已生成：缺少 02-product.md」），补齐再来。

## B2B 流程（beta，冻结在 v1）

```
立项 → 市场 → 供给与对象 → 单位经济 → 资产生产 → 交接 → done
```

闸门与 DTC 类似：立项需 product / moq / priceBasis；市场需 3 个候选 + 六维评分；供给需 ≥20 条线索、A/B ≥8、核实 ≥60%；单位经济毛利率 ≥15%；资产需 economics / buyers / outreach；交接 ≥6 项。B2B v2（资料包、RFI、RFQ、样品、验厂、合同、首单、交付）在 [docs/PROCESS-V2.md](docs/PROCESS-V2.md) 里，等 DTC 稳定后再上。

## 十三个工具（只对 Sourcing Agent 可见）

| 工具 | 作用 |
|---|---|
| `sourcing_project` | 建项目、列表、按 section 读、改目标与工作区 |
| `sourcing_facts` | 事实与假设（`confirmed` / `assumed`） |
| `sourcing_evidence` | 证据库：URL、主张、分级 A-D、发布方、访问日期；A 级必须有发布方；同 URL+主张去重 |
| `sourcing_markets` | 候选市场评分、证据关联、推荐结论 |
| `sourcing_dtc` | DTC 十类记录：direction / product / suppliers / samples / qc / store / launch / ops / growth / review |
| `sourcing_policy` | 读政策快照；按项目覆盖阈值（需理由）、跳过不适用阶段（需理由）、恢复默认 |
| `sourcing_mandate` | 长期委托：目标、成功标准、授权、节奏、checkin、暂停/恢复 |
| `sourcing_economics` | 单位经济：输入由模型给，到岸成本/毛利/盈亏平衡 ROAS 由代码算 |
| `sourcing_stage` | 读当前闸门，或尝试推进（拒绝时给 blocker） |
| `sourcing_handoff` | 交接项与 30/60/90 计划 |
| `sourcing_render` | 渲染产出物，记录 SHA-256 |
| `sourcing_brand` | B2B/DTC v1 品牌记录 |
| `sourcing_leads` | B2B 买家/渠道名单 |

## 长期委托（mandate）：让项目自己往前走

委托不是更长的对话，而是一份写进项目的契约：

- **目标 + 1-8 条成功标准**，全部可核对（如「首月 50 单」「CAC < 8 美元」）。
- **授权范围**：研究 / 起草 / 对外联系（approval / allowed / never）/ 支出上限。
- **节奏**：每 N 天检查一次，最长 horizonDays。
- **日志**：每次 checkin 记录 summary、actions、blockers、已达成的标准。

机制是 Harness 的 Host 定时任务：`schedule_create` 建一个唤醒任务，`sourcing_mandate activate` 绑定它。到期时 Host **恢复冷会话**并投递提醒，agent 按 `nextActions` 继续干；应用没开时，下次启动补最近一次错过的检查。

```
schedule_create（固定 prompt 模板） → sourcing_mandate activate（绑定 scheduleId）
→ 到期唤醒 → sourcing_mandate read → 执行 nextActions → checkin → 下一次
```

暂停 = `pause` + 删除定时任务；恢复 = 重新建任务 + `resume`；成功标准全部达成时自动 completed，并删任务、出 `09-mandate.md`。

## 策略（policy）：阈值是数据，不是代码

`policies/dtc-default.json` 定义阶段、阈值（供应商数、QC 项数、毛利下限、素材数、SLA、达人数量、交接项数等）、必需产出物与中文标签。项目创建时把整份策略**快照**进记录，之后升级插件不会悄悄改掉一个在跑的项目。

- 买家要求四家比价、客单价高需要更多素材、或数字产品不需要 3PL：用 `sourcing_policy override` 改一项阈值，或用 `skip` 跳过 `ops`，**必须写 ≥10 字理由**。
- 每次改动进 `policyOverrideLog`（旧值、新值、理由、时间）；闸门显示的是生效值，例如「供应商报价（≥4）3/4」。
- 新品类/新平台可以加一个 policy 包（如 `dtc-digital.json`），创建项目时传 `policyId`，不改代码。

## 产出物

渲染到 `<workspaceDir>/sourcing/<slug>/`：

```
00-brief.md            项目简报（事实、假设、目标）
01-market.md           市场评分、推荐、证据表
02-product.md          方向、产品、样品、QC
02-suppliers.csv       供应商报价对比
03-economics.md        单位经济（输入 + 计算 + 风险）
03-unit-economics.csv  成本模型表
04-store.md            店铺、页面、政策、支付、物流、像素
05-launch.md           素材、投放结构、止损规则
06-ops.md              3PL、SLA、测试订单、客服
07-growth.md           自动化流程、评价、复购、达人
08-review.md           指标、补货点、下一轮计划
09-mandate.md          长期委托：目标、授权、成功标准、运行日志
handoff.md             只能由用户完成的动作
dashboard.html         阶段轨、闸门、漏斗、单位经济的一页视图
data.json              项目记录快照
```

叙事由模型写，表格与金额由记录生成；重复渲染覆盖并更新哈希。

## 数据与状态机

- 项目：`$DSH_HOME/data/sourcing/projects/<projectId>.json`
- 原子写入（临时文件 + rename）、`revision` 乐观锁、操作日志（最近 200 条）、同项目写入串行化
- 并发修改返回 `REVISION_CONFLICT`，要求重读再写
- 阶段序列按 `mode` 取：`b2b` 六道，`dtc` 八道；`done` 后项目自动 completed

## 安装与更新

在 DSH 中通过 `plugin_manager install_bundle target=<本插件绝对目录>` 安装；实际 profile 与启用状态由宿主管理，本仓库不宣称当前机器已安装或在线。

- 改技能、工具、引擎代码：链接目录，重启应用后生效（模块有缓存，热重载不保证换新版本）。
- 改 `cordis.patch.yml`（增减 preset 子行）：关掉再打开 bundle，或重启。
- 已经在跑的会话保留旧组合，新会话才用新组合。

## 验证

- 单元与集成测试 **25/25**：DTC 八道门从 market 到 completed、市场门/产品门/运维门的拒绝、B2B 六道门回归、公式数值、渲染哈希、工具层（含 `sourcing_dtc`、`sourcing_policy`、`sourcing_mandate`）端到端、策略快照/覆盖/跳过阶段、委托激活/checkin/暂停恢复。
- 离线自检 `dev/validate.mjs`：patch 结构、24 个插件包、6 个技能格式、13 个工具定义与注册、策略文件与阈值、公式漂移、manifest/locale。
- 端到端挂载：全新 profile 用相同安装方式启动，preset 挂载成功并注册工具。
- 示例产出：[examples/dashboard-demo.html](examples/dashboard-demo.html)（B2B 示例）。

## 命令

```powershell
$exe = "C:\...\DeepSeek Harness.exe"
$env:ELECTRON_RUN_AS_NODE = "1"
& $exe --expose-internals dev\validate.mjs
& $exe --expose-internals --test test\workflow.test.mjs
```

## 已知边界

- 需要联网检索；来源不可用时只产出「检索计划 + 缺口」，不编造数据。
- 公司主体、支付、广告账户、认证送检等对外动作无法代做，进入 `handoff.md`。
- 单位经济按固定公式计算，不适用于特殊税务结构（进口 VAT 抵扣、多级分销返点）。
- DTC 闸门里的「样品 received」「测试订单 passed」是用户执行结果的记录，不是 agent 代做。
