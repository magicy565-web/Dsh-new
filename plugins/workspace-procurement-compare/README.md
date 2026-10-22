# workspace-procurement-compare

把用户显式提供的供应商报价**对齐**，而不是替用户比价、换算或核验。

## 工具

`procurement_compare`（`readOnly: true`，`approval: 'never'`，无副作用）：

- 输入：`quotes`（≤20 条），每条只允许 canonical 字段
  `supplier / spec / unit_price / currency / trade_term / moq / sample_cost /`
  `sample_lead_time / lead_time / payment / certification / validity / source`；
- 输出：逐条 `rows`，每个字段一格：`provided-unverified`（带原值与来源路径）或 `pending`；
- `alignment`：`no-supplied-quotes` / `pending`（缺 spec/currency/trade_term）/
  `same-supplied-basis-unverified` / `different-supplied-basis`；
- 恒定声明：`ranked:false`、`priceConversion:false`、`independentVerification:false`、
  `persisted:false`、`submitted:false`；
- `suppliedSha256` 固定本次输入，便于事后核对“当时给的是这组数据”。

## 为什么不做排名

不同币种、不同贸易术语、不同 spec 的报价**不可直接比较**。工具只报告“是否同一基线”，
把判断留给人；需要换算或排名时，必须先由人给出统一口径（例如同一币种同一 trade term），
否则结果会假装精确。

## 验证

```powershell
node --test plugins/workspace-procurement-compare/test/compare.test.mjs
node scripts/procurement-smoke.mjs
```

端到端冒烟：离线 provider 让模型请求 `procurement_compare`（两条同基线报价），真实
tools seam 执行（只读、无票据），回答里带回 `alignment`、`ranked:false` 与 `pending` 单元格。
