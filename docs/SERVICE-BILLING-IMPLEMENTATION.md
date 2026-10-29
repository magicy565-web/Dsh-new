# 独立服务计费插件

本批延续三模式业务委托，新增可选的 `dsh-service-billing@0.1.0-rc.1`；画布入口由 `dsh-commerce-network@1.3.0-rc.1` 提供。按照用户要求，服务账单不加入 Mini ERP：不依赖其服务，不打开其数据库，不更改其源码、版本、迁移或安装包。

## 数据与运行边界

- Commerce 保存委托和商业条款；Billing 只引用委托 ID，保存已经核对的条款与批准回执快照。
- Billing 独立 SQLite 保存内部服务对账单、逐笔事件和请求回执。没有第二套商品订单、库存、客户或产品主数据。
- 身份、会话、工具、Connection 和附件均由原生 DSH 提供；收费权限不会因为画布连线而扩大。
- Mini ERP 仍保留原有商品交易能力；本批代码和安装命令不涉及该包。未安装 Billing 时，画布显示未安装状态，不建旁路存储。

## 已实现业务规则

工厂模式从已审核条款生成固定委托费，渠道模式生成完整服务月账单；金额和币种不可由调用者另填。纯佣金委托不能生成固定费或月费，AI Credits 计量和佣金不混入服务费账单。

固定费同一委托只允许一张未作废账单，不因条款换版重复生成。月账期以合同开始日为锚点，月末夹到目标月末，之后恢复原锚点：1 月 31 日 → 2 月 28 日 → 3 月 31 日。账期使用 UTC，右边界不包含当天；不支持未开始或不足整月的自动收费。新旧条款之间的重叠账期同样拒绝。已过服务期但仍保留有效批准的委托可以补记已发生完整账期。

草稿经过单独 Owner 确认才形成待收记录。确认时重查原委托条款、修订和批准回执；发生变更，需作废草稿后重新生成。已确认账单固定原条款，不被后续委托修订或撤销改写。未产生收退款的草稿或账单可以注明原因作废；已有资金事件的账单不可删除或作废。

收款／退款必须上传实际凭据，通过原生附件保存并核对 SHA-256 与字节数，再由 Owner 核对金额、币种、机构账号、外部交易号和发生时间。本模块内同工作区、同 provider、同 externalEventId 不得重复登记；不声称已与其他账本或银行形成全局对账。凭据完整性不代表独立银行认证。

收款不得超过未收余额；退款必须引用本账单原收款，且不得超过该笔尚未退回的金额。累计收款、累计退款、净收款和未收余额分别展示。退款冲回收款、恢复未收余额，**不自动减免服务费**；账单减免、税务红字发票和预付款抵扣尚未实现。本版本只支持账单确认后发生的收退款，未来时间拒绝。

写入在本模块数据库事务内完成，并保留幂等回执。UI 未知响应在 sessionStorage 保留原请求、原版本及证据引用，重新打开同一会话和委托后可用原请求核对；不能用新请求号冒险重复记账。交易唯一键跨本模块账单与操作者生效，账期重复检查跨条款版本生效。

## 安装和备份

```sh
npm ci --ignore-scripts
npm run check
npm run test:client
npm run package:business-services

# 使用运行者选定的 DSH_HOME，安装两个可选原生包
DSH_HOME=/absolute/path/to/dsh-home dsh plugin --profile web add \
  /absolute/path/to/dist/business-services/dsh-commerce-network-1.3.0-rc.1.tgz \
  /absolute/path/to/dist/business-services/dsh-service-billing-0.1.0-rc.1.tgz
```

不需要安装或升级 Mini ERP。首次使用仍须有官方 DSH workspace/session；进入 Commerce Network → 业务委托，选择委托后打开“服务账单与对账”。

默认数据路径为 DSH_HOME/service-billing/billing.sqlite（也支持独立 dataDir）。备份此目录中的 SQLite/WAL，并同时备份实际原生附件数据；备份文件名不代替附件正文。卸载插件保留数据。不要把 Billing 的数据库指向 ERP 目录。

原生工具 `service_billing_read` 只读，`service_billing_propose` 仅提议草稿。确认、作废、收退款只能通过已认证 Owner 接口。无自动扣款、自动续订、支付网关、法律签署、发信或税务开票；没有真实提供方或生产验收声明。

## 验证入口

- `integrations/dsh/dsh-service-billing/test`：独立数据库、账期、修订、实际字节凭据、幂等重启、并发、会话撤销、Owner HTTP。
- `integrations/dsh/dsh-commerce-network/dev/service-billing-smoke.mjs`：真实本地服务/SQLite 驱动的 UI 草稿、确认、未知结果恢复、凭据上传和部分收款。
- `DSH_RUNTIME_DIR=/path/to/dsh node integrations/dsh/dsh-service-billing/dev/native-smoke.mjs`：官方 Cordis/Tools 仅挂载 Commerce 和 Billing，断言没有 Mini ERP 服务。

所有自动化业务记录使用明确标注的合成数据。真实邮件继续按用户要求留待配置；费用规则验证不等于真实银行收款或支付验收。
