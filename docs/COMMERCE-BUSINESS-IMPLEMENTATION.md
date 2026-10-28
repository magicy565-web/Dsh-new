# DSH 交易插件实现与验收边界

日期：2026-10-28。代码目标为官方 DeepSeek Harness `0.2.1-rc.3`、Node 24+。本次按用户“完整开发和实现”请求实现实施书正文 PR-0 至 PR-6 的代码；附件末尾“只做 PR-0/PR-1”是可转交的首步任务示例，未将其当作本次用户请求。真实首单、真实邮件和生产发布尚未完成，后续模块的代码可检验不等于满足首单后的业务启用条件。

## 基线

从 PR #144 候选 HEAD `263e28b94ed9c3b89d73630c17c3a90f50e97f34` 建立独立开发分支 `codex/commerce-business-implementation-20261028`，不在落后的 main 或已有用户工作区直接修改。比较目标为 `agent/harness-20261023`。初始 `npm ci --ignore-scripts`、`npm run check`（327 项）和 `npm run test:client` 通过。

远端基线 GitHub Actions runs `40665072505`、`40664988174` 返回 `startup_failure`；前者没有可取的 job，故没有可证明的代码失败栈，也没有远端通过证据。不要用本地测试替代远端 CI 状态。更新分支后的 CI 状态以 PR 为准。

## 已实现范围

| 实施段 | 实现 | 数据所有者 |
| --- | --- | --- |
| PR-1 RFQ | 真实字节 SHA、来源键去重、精确字段证据、提取候选、缺口、Owner 身份/联系许可审核、未发送草稿、附件行导入、保留期清理 | RFQ SQLite，消息与提取分离 |
| PR-2 报价 | 固定 SKU/产品/政策修订、MOQ/币种/底价/贸易条款检查、确定性整数报价、不可变报价版本、审批摘要 | Mini ERP v4 |
| PR-3 邮件 | Resend 发送/查询适配器、独立 Svix 签名入站、持久化 outbox、未知结果核对、真实回复引用 | 发送事实在 ERP；来源在 RFQ |
| PR-4 画布 | RFQ/Quote/Buyer/ERP Order/Sample 版本化投影；来源、审批、单独发送及凭据 Inspector；兼容历史布局 | Commerce 仅保存引用/布局 |
| PR-5 样品 | 原生提议、费用审核、独立库存订单引用、带证据寄送/签收/反馈 | Mini ERP v4 |
| PR-6 代理/渠道 | 扩展现有 mandates 的版本条款和归属争议；按币种区分预算、费用、报价、订单、收款、佣金 | Commerce 原关系账本 + ERP 实际凭据 |

PartnerOS 扩展既有 Commerce 包，不创建另一套代理账本或登录系统。四个新增可选包为 RFQ Desk、QuoteGuard、SampleFlow、ChannelLedger；连同更新的 Commerce、Mini ERP、既有 Workspace Library，共七个独立安装包。

## 运行与权限契约

- 官方 `workspaceRegistry` 的唯一 session→workspace 归属确定当前作用域，模型不能传 workspace/role。`Tools.execute` 的 native session、callId、取消信号被保留；幂等身份以同一 session 的 requestId 为准，新 tool-call ID 不导致重复写入。
- Owner HTTP 采用官方 `Connection.requestRejection`，POST 要求 same-origin JSON。异步读取前后及提交前重查身份，撤权、切工作区、卸载后拒绝继续访问。
- 作用域对象仅供可信本地服务之间调用，不是可序列化用户身份。任意本地 Cordis 插件拥有宿主级信任，本项目不声称隔离恶意本地插件。
- `attachments` 使用官方 `saveFile` / `readFileStream`，按真实字节验证 SHA/长度。文件凭据只是 Owner 审核的来源，不伪称提供方真实性自动认证。
- Worker Gateway 与 Owner API、入站邮件 Gateway 分离；原 Worker `allowedActions` 白名单保持不变，没有通用发送、报价、审批或支付权限。
- 没有新 Agent loop、独立网站、备用 ERP、OAuth 代理或通用流程引擎。报价模板由确定性商业字段组成；模型回复草稿保持未发送。

### RFQ

`rfq_read`、`rfq_propose_extraction`、`rfq_propose_reply` 复用原生会话。提取必须引用保留的原文 SHA 及逐字段 start/end/quote。候选与 Owner review 分离；`qualified` 不等于买手身份或联系许可验证。

来源唯一键为 workspace/channel/account/message ID。相同来源不同字节拒绝；同 requestId 不同内容拒绝。手动导入标记 `owner-import-not-independent-verification`；只有签名校验并从提供方取回的消息标记 `provider-signed-retrieved`。一个来源先进入一条 RFQ，再由 Owner 关联现有 ERP 买手与项目。

原文、候选证据和草稿在本地 SQLite 用 AES-256-GCM 加密，邻接 key 文件 0600，目录 0700；已有数据库缺 key 拒绝启动。保留期默认 30 天，可配置 1–365 天。过期原文立即不可读；启动/每小时维护清除原文、草稿正文和证据引用文字，保留哈希/审阅元数据。读取不修改事实。备份、WAL 和介质的物理擦除由运行者管理，不声称安全擦除。

### QuoteGuard / ERP v4

schema v4 增加 quotes、quote_versions、quote_events、quote_requests、quote_policies、quote_delivery_outbox、sample_requests/events/commands、channel_evidence；v1–v3 原 buyers、offers、orders、库存、请求回执仍保留。先备份 ERP DB/WAL 与 RFQ DB/key，再升级；旧 ERP 不支持读取 v4，回退需要恢复升级前完整备份，不能简单替换旧包。

`quote_preview` 和 `quote_propose` 从已审核 RFQ、已关联真实 SKU 和 Owner 政策计算。商品小计为数量×阶梯单价，采用整数最小货币单位，仅支持 USD/EUR/GBP/CNY。缺少来源、MOQ、贸易地点/单位、有效政策或低于审核底价均拒绝。没有可信成本、税费、运费时利润为 unknown；“最低售价”不是经过核验的利润率。

审批绑定报价版本、收件人、精确正文、政策、来源和发件账号。更改来源、政策、买手、发件人或账号后不能复用旧批准。发送是独立 Owner 操作。一个 quote/version 只允许一个 outbox，先提交意图再外部 I/O。超时、断线、非法提供方响应一律 unknown，重试相同请求只读取已有结果；换 requestId 不能重发同一版本。明确拒绝可建立并审核新版本。

已发送不等于送达。只有真实提供方 message ID/时间才登记 sent；未知结果需 Owner 提供 provider ID 并查询，核对 from/to/subject/text 后确认。没有可验证 ID 的不确定结果仍保持 unknown。买手接受须引用另一条经审核的、发送之后收到的原文，逐字圈定同意证据；这是 Owner 的业务判断，不是自动合同签署。接受报价不创建、预留或确认订单。

### SampleFlow / ChannelLedger

样品提议需要已接受且有发送凭据的报价。费用审核不收款；寄送需要独立已确认且匹配产品/买手/数量的 ERP 库存订单，以及单独的外部物流凭据。寄送、签收、反馈分开记录；不自动调用快递、不把 Worker 费用当库存。没有物流凭据时不展示已寄送；库存订单的来源 SKU/产品修订也必须与样品所依据的报价一致。

代理条款固定产品版本、市场、有效期、披露范围、客户归属规则、佣金比例/依据。更改条款生成下一版本并重置授权；历史审批保留。佣金逐单核对原始订单的 SKU/产品修订、已关联的不可变报价版本、协议产品范围及目的市场；目的市场按明确市场代码匹配，不猜测地理别名。一个订单只关联一个报价版本；旧数据缺少来源或存在冲突关联时保持待核对。竞争客户归属变为 disputed，Owner 有据决定后释放另一方。授权和法律签署分开；没有代理多企业账号或工商核验。

ChannelLedger 按币种分别输出 `plannedBudgetMinor`、`workerReportedCostMinor`、`approvedCostMinor`、`quotedValueMinor`、`confirmedOrderValueMinor`、`collectedRevenueMinor`、`commissionAccruedMinor`、`commissionPaidMinor`。付款/收款依实际原生附件及外部事件编号登记，重复事件拒绝；收款不得超匹配订单金额，佣金支付不得超有效归属与已核对收款产生的应计额。无证据的收款/支付为 null，ROI 为 null，settlement 为 not_connected。订单或协议不满足条件时不能据此生成新的佣金支付记录。

## 安装与验证

```sh
# 仓库，Node 24+
npm ci --ignore-scripts
npm run check
npm run test:client
npm run test:commerce-business
npm run package:commerce-business

# 官方 CLI；指向运行者选择的隔离目录
export DSH_HOME=/absolute/path/to/dsh-commerce-profile
dsh plugin --profile web add /absolute/path/to/dist/commerce-business/*.tgz
dsh --profile web --no-open --port 4187
```

打包脚本把内部 workspace 依赖编译进各自服务文件，不依赖未发布 npm 包；React 由宿主提供。每包包含说明文档，`commerce-business-packages.json` 记录 tarball SHA-256、字节数和文件表。可选插件卸载后保留事实；依赖调用明确返回 `DEPENDENCY_MISSING`，不建立旁路数据。

测试使用明确标识的合成记录，不放真实邮件、用户数据库或凭据进 Git。官方 Cordis/Tools 原生测试：

```sh
DSH_RUNTIME_DIR=/path/to/official/dsh-install node integrations/dsh/dsh-commerce-network/dev/native-smoke.mjs
DSH_RUNTIME_DIR=/path/to/official/dsh-install node integrations/dsh/dsh-quote-guard/dev/native-smoke.mjs
```

以上原生工具测试使用 fixture registry/session，必须与实际 Web 的 Connection/session/插件安装验收分别报告。浏览器专项测试验证精确文本展示、单独审批/发送、丢失响应后的原请求重试、unknown 不重新发送；本地 HTTP 测试验证认证/CSRF/跨工作区/签名/字节限制。迁移测试验证 v3 数据升级并重新打开后仍完整。

### 真实邮件配置

在原生 QuoteGuard 配置中设置环境变量名及已获授权的真实账户信息；示例不得直接用于发信：

```yaml
apiKeyEnv: COMMERCE_RESEND_API_KEY
from: authorized-sender@example.test
accountRef: resend-test-account
webhookSecretEnv: COMMERCE_RESEND_WEBHOOK_SECRET
inboundSessionId: session-actual-native-session
inboundProjectId: actual-commerce-project
inboundInbox: authorized-inbox@example.test
allowRemoteIngress: false
```

凭据由运行环境安全设置，不能写入 Git/聊天/归档。Resend API 固定 HTTPS 地址、禁止重定向、限时请求。公网仅路由 `POST /quote-guard-inbound/resend` 经受控 HTTPS 入口，签名/时间/速率/body 限制不能关闭；绝不公开 Owner API 或使用 Worker token。`allowRemoteIngress` 仅在明确受控 TLS 代理后启用。

### 未满足的发布条件

1. 尚未提供授权真实询盘、可核验真实 SKU、真实发件账号和明确同意的收件测试目标。本次没有调用真实提供方发信，也没有真实订单/收款/寄样。
2. 需在上述配置完成后实际发送一条已批准报价，记录 provider ID/时间/SHA，再接收真实回复，核对 RFQ/报价/画布及单独订单流程。未经该步骤不能宣称实施书首条商业闭环验收完成。
3. 样品与代理佣金仅完成代码和隔离验证；首单、物流、资金、法律签署、多企业身份、Meta WhatsApp、云端生产就绪未验收。
4. 远端 Actions 的启动失败仍是独立问题；需要仓库管理员可见的账单/配额/组织策略或进一步 runner 信息才能确定原因。

这是一份可安装、可审阅的候选实现，不自动发布到生产或替换用户现有数据。
