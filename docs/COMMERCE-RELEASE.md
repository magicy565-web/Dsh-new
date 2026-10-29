# Commerce 与独立 Billing 集成交付

2026-10-29。本次沿用 PR 153 收拢已有开发，合入仓库指定开发主线 `agent/harness-20261023`，不另建 Draft。候选安装版本：Commerce 1.4.0-rc.2、Service Billing 0.1.0-rc.2；官方宿主 DSH 0.2.1-rc.3，Node.js 24+。

## 本次范围

- 三种业务委托模式、条款审核、工厂业务推进与历史、原生业务画布。
- 独立固定服务费／月度服务账单、人工收款与退款记录、原生附件凭据。
- 复用 DSH 会话、工具、权限及已有 Worker 委派接口，不引入另一套 Agent 执行器。
- 只打包 Commerce 与 Billing。`npm run package:business-services` 为当前入口，旧 `package:commerce-business` 兼容命令也指向这两个插件。

Mini ERP 与合并基线 `ed2a60c6279f6f1078465d8e3763e1196b9bf820` 的目录内容完全一致。早期 PR 148 的 ERP 报价／交易扩展、RFQ Desk、Quote Guard、Sample Flow、Channel Ledger 和对应领域包不进入本次集成交付；实现保留在 `codex/commerce-business-implementation-20261028` 与 Git 历史，不删除或迁移任何运行数据。

Commerce 对可选交易服务的读取适配仍保留。服务不存在时明确显示未连接，不产生报价、订单、样品或销售佣金账目。相关测试使用服务契约夹具，不表示当前交付包含实际 ERP/RFQ 集成。

## 安装与验证

安装、SSH 转发和工厂演练见 [快速开始](COMMERCE-PILOT-QUICKSTART.md)。已有服务器使用独立 DSH_HOME，先试用再决定接入方式。本次不修改用户服务器。

```sh
npm ci --ignore-scripts
npm run check
npm run test:client
npm run package:business-services
```

CI 使用相同构建、测试和两插件打包步骤，产物名为 `commerce-business-services`。历史七插件包和历史验收不是当前发布清单。rc.2 用于标识收拢后的交付与文档边界；没有新增运行时业务功能。

实际测试结果和合并回执以 PR 153 为准。历史功能验收见 [工作台验收](COMMERCE-WORKBENCH-ACCEPTANCE.md) 与 [计费验收](SERVICE-BILLING-ACCEPTANCE.md)。代码合入开发主线不代表生产部署，实际邮件、支付、AI Credits 计费、销售佣金结算和具体第三方 Personal Agent 的商业运行仍未验收。
