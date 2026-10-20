---
name: historical-inquiry-recovery
description: 在 Workspace Harness 中盘点已授权导入的历史询盘，识别值得复联/待补证/暂缓的机会，并给出有证据的下一步。
---

# 历史询盘捞回（Harness 技能）

先读 `inquiry_recovery_status` 了解当前线索与冲突规模，再用 `inquiry_recovery_opportunities` 取回有界的机会清单。
工具只返回摘要卡片；完整历史、逐字证据与草稿正文在 HTTP 页面（`/recovery`）中查看。

## 判断规则（代码已经实现，不要自行改写）

- `follow_up`：身份已人工确认、最近联系超过阈值（默认 7 天）、且有联系人/官网/产品绑定。
- `need_evidence`：身份未确认或冲突、缺联系人通道、缺官网、缺产品绑定、最近联系日期未知。
- `nurture`：最近联系未超过阈值。
- `hold`：won / lost / opted_out / manual_hold。

## 表达纪律

- 只陈述工具与页面里出现的证据；`independentlyVerified` 恒为 false。
- 历史记录里的采购说法不是订单；不得推断客户当前意向。
- 草稿是**未发送**的内部文本；发送、报价、交期与认证承诺都需要单独的人工审批。
- 不得为了推进而复联 `hold` 的线索，也不得把 `need_evidence` 说成"值得跟进"。
