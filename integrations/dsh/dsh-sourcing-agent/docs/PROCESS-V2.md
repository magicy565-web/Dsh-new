# 流程 v2 设计：从「找商机」到「被采购方接入并完成首单」

> 依据：[真实流程研究](PROCESS-RESEARCH.md)。v2 的目标不是加字段，而是让 agent 走完采购方真正在走的链路：资料包 → RFI → RFQ → 样品 → 审核 → 合同 → 首单 → 交付 → 绩效。
>
> **实施状态（2026-10）**：DTC 八道门已完整落地（`workflow.js` 的 `DTC_STAGES`、`sourcing_dtc`、八个 stage 闸门与产出物）。B2B 十道门仍为设计稿，B2B 线暂时冻结在 v1 六道门。

## 一、设计原则

1. **双轨**：B2B 供货与 DTC 品牌是两条不同的阶段序列，不再共用六道门。
2. **单据驱动**：每个阶段必须留下采购方能收到的「单据」（资料包、报价单、样品确认单、审核整改、合同条款、验货报告、单证清单），而不是一段说明。
3. **闸门可核**：闸门检查的是记录字段、文件存在、数字阈值，不是模型说「已完成」。
4. **终点前移**：v1 的 handoff 只是中间点；v2 的终点是首单交付与绩效复盘。
5. **不越权**：验厂、签合同、收款、报关仍由用户执行；agent 负责准备、核对、跟踪与留痕。

## 二、B2B 阶段与闸门（10 道）

| # | 阶段 | 关键动作 | 闸门（代码判定） |
|---|---|---|---|
| 1 | **定位** `strategy` | ICP、细分、价值主张、价格带、目标市场 | ICP 5 字段齐全；≥2 个目标市场且各 ≥1 条 A/B 证据；价格带与 MOQ 已确认 |
| 2 | **名单** `pipeline` | 长名单、资格信号、联系人、渠道 | ≥30 家、≥10 家有联系人；域名去重；每个必须有来源链接；A/B ≥12 |
| 3 | **资料包** `profile` | 供应商档案、资质、体系、产能、QC 流程、案例 | 必填证件 ≥6 类（执照/开户/税号/体系或产品认证/组织架构/QC 流程图）；产能、MOQ、交期、打样周期齐全；≥2 个可公开案例 |
| 4 | **资格确认** `rfi` | 首触、供应商调查表、NDA、进入短名单 | ≥10 家已触达；≥3 家返回调查表/需求；≥1 份 NDA 或采购条款已记录；每家状态可追踪 |
| 5 | **报价** `rfq` | RFQ 回复、成本明细、贸易术语、有效期、付款方式 | ≥3 份正式报价；每份含阶梯价、Incoterms、有效期 ≥15 天、付款方式、交期；成本明细完整（材料/人工/包装/国内运费/港杂） |
| 6 | **样品** `sample` | 打样单、寄样、确认单、修改闭环 | ≥2 个样品已寄出且有待运单号；≥1 份书面确认（approved）；无未关闭的修改项 |
| 7 | **审核** `audit` | 文件审核、现场/社会责任审核、CAPA | 审核清单 100% 完成；若买家要求现场审核：审核类型/日期/结论已记录，不符合项全部有 CAPA 与关闭日期 |
| 8 | **合同** `contract` | 条款清单、质量异议、索赔、罚则、IP、独家 | 条款 8 项齐全（质量/索赔/罚则/IP/不可抗力/付款/交期/保密）；付款条件与 Incoterms 与报价一致；状态为 draft/signed 可追踪 |
| 9 | **首单** `order` | PO、排产、PPAP/FAI（如需）、产中与出货前验货 | PO 金额/币种/交期已录；定金到账或 L/C 已开；验货计划含 AQL 与 CR/MA/MI；出货前验货 CR=0 且 MA ≤ AQL；整改项关闭 |
| 10 | **交付与绩效** `delivery` | 订舱、报关、单证、放单、尾款、退税、绩效 | 单证 5 件齐（CI/PL/B/L/CO）；单单一致检查通过；尾款到账或放单条件满足；OTIF/批次合格率/回复时效已录；30/60/90 复购计划 |

> 说明：第 7 道「审核」在没有买家要求时可标记 `not_required` 并附理由；第 9 道 PPAP/FAI 仅对工业件强制，消费品可标 `not_required`。

## 三、DTC 阶段与闸门（8 道）

| # | 阶段 | 关键动作 | 闸门 |
|---|---|---|---|
| 1 | **市场与选题** `market` | 需求信号、竞品、价格带、毛利空间 | ≥3 个候选方向；每个有需求与竞品证据；选定 1 个并写明淘汰理由 |
| 2 | **产品与供应链** `supply` | 3 家报价、打样、QC 清单、MOQ/补货周期 | ≥3 家报价且含 MOQ/交期；样品已到并记录；QC 清单 ≥10 项 |
| 3 | **经济模型** `economics` | 到岸成本、费率、退货、CAC、盈亏平衡 ROAS | 成本项齐全；广告前毛利 ≥30%；盈亏平衡 ROAS 可算；三档敏感性 |
| 4 | **品牌与店铺** `brand` | 命名核查、定位、页面、支付、物流费率、政策 | 3 个命名核查；定位 ≥40 字；核心页面 5 个；政策 4 份；支付与物流费率已确认 |
| 5 | **上线与投放** `launch` | 素材 3 角度、campaign 结构、预算、止损线 | 素材 ≥9 条（3×3）；campaign 结构完整；预算与止损规则写入；像素事件验证 |
| 6 | **履约与客服** `fulfillment` | 3PL 上线 5 步、SLA、退货地址、客服模板 | 3PL 合同/SLA 已录；SKU 与条码核对；测试订单通过；退货与客服流程就绪 |
| 7 | **增长与复购** `growth` | 邮件/短信流程、会员、KOL、评价 | 4 条自动化流程；评价机制；复购或订阅方案；KOL 名单 ≥10 |
| 8 | **复盘与补货** `review` | P&L、CVR/AOV/CAC/ROAS、库存周转、补货点 | 指标齐全；补货点与安全库存已算；下一轮素材与预算计划 |

## 四、数据模型（新增）

```
project
  mode: b2b | dtc
  stage: <按轨道>
  profile:   { company, certs[], capacity, moq, leadTimeDays, sampleLeadDays,
               qcFlow, orgChart, references[], auditReadiness[] }
  buyers[]:  { id, company, domain, segment, country, size, contact, role, email,
               sourceUrl, tier, status: new→contacted→rfi→rfq→sample→audit→contracted→ordered→lost,
               lastTouchAt, nextStep }
  rfqs[]:    { id, buyerId, items[], incoterm, currency, validUntil, paymentTerms,
               leadTimeDays, tiers[], costBreakdown{ material, labor, packaging,
               inlandFreight, portHandling }, status: requested→quoted→negotiating→won→lost }
  samples[]: { id, buyerId, sku, sentAt, courier, tracking, approvedAt,
               approvedBy, feedback, revisions[] }
  audits[]:  { id, type: desk|site|social, standard, date, result,
               findings[], capa[{ issue, owner, dueAt, closedAt }] }
  contract:  { buyerId, status: draft|review|signed, terms{ quality, claim, penalty,
               ip, forceMajeure, payment, delivery, confidentiality },
               exclusivity, signedAt }
  orders[]:  { id, buyerId, poNumber, amount, currency, incoterm, depositReceivedAt,
               inspection{ date, aql, cr, ma, mi, result, reportFile },
               shipment{ etd, booking, bl, docs[] }, balanceReceivedAt,
               status: po→producing→inspected→shipped→delivered→paid }
  scorecard: { otif, batchPassRate, ppm, avgResponseHours,
               quoteWinRate, reorderPlan{ d30, d60, d90 } }
```

## 五、工具面（12 个）

保留：`sourcing_project`、`sourcing_facts`、`sourcing_evidence`、`sourcing_markets`、`sourcing_economics`、`sourcing_stage`、`sourcing_handoff`、`sourcing_render`。
新增/重命名：

| 工具 | 作用 |
|---|---|
| `sourcing_buyers` | 原 leads，增加采购阶段状态机（contacted → rfi → rfq → sample → audit → contracted → ordered） |
| `sourcing_profile` | 供应商资料包：证件、体系、产能、QC 流程、案例、验厂准备度 |
| `sourcing_deal` | 统一承载 `rfq` / `sample` / `audit` / `contract` / `order` / `scorecard` 六类记录，按 `kind` 校验 |
| `sourcing_brand` | DTC 品牌与店铺（保留，扩充页面/政策/费率） |

`sourcing_deal` 用 `kind` 区分六类记录，避免工具数量爆炸，同时保持每类字段的强校验。

## 六、产出物（新增）

```
profile.md            供应商资料包（可直接发给采购方）
quote.md / quote.csv  正式报价单 + 成本明细
sample.md             打样与样品确认单
audit.md              审核清单与 CAPA
contract.md           合同条款对照表
order.md              首单检查表（PO/验货/单证/放款）
scorecard.md          供应商绩效与复购计划
dashboard.html        增加「采购阶段漏斗」与「单据完备度」
```

## 七、迁移

- 线上还没有真实项目（只有测试与示例），v2 可以直接把 `schemaVersion` 升到 2。
- v1 项目文件：只读打开，提示「v1 项目，请新建 v2 项目」；不自动改写，避免丢数据。
- 阶段序列按 `mode` 取，`hybrid` 在 v2 先按 `b2b` 处理，品牌线作为 b2b 完成后的追加轨道（下一版）。

## 八、实施顺序

1. 数据模型与阶段序列（workflow.js）：10 + 8 阶段、门函数、迁移。
2. `sourcing_deal` 与 `sourcing_profile`：字段校验、状态机。
3. 渲染器：profile/quote/sample/audit/contract/order/scorecard + dashboard 漏斗。
4. 技能改写：每个阶段只讲该阶段的打法与调用顺序。
5. 测试：每道门的通过与拒绝、状态机、单据完备度、渲染哈希。
6. 示例与 README 更新。

## 九、需要你拍板的三件事

1. **阶段粒度**：接受 10 道 B2B 门，还是压到 8 道（合并「资格确认+报价」「审核+合同」）？
2. **hybrid**：先按 b2b 处理、品牌线后置，是否可以？
3. **审核与验厂**：没有真实审核报告时，允许 `not_required` + 理由，还是强制至少一次文件审核？
