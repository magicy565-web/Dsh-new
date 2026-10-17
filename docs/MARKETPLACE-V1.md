> 上游设计/交接记录；其中的旧分支、完成状态和历史验证不代表本次验收。当前结论见 [统一插件验收](OMP-ALL-PLUGINS-INTEGRATION-20261017.md)。

# Marketplace V1 — 原 Workspace 增量实现

基线：PR81 `1d703db12089a5763d9856bce4284c8745130a6b`。
本增量不编辑 PR80/81 内置 Agent、PR66 主界面、原 Runtime、调度、Store、WorkerDesk 或 Shopify writer。
这是可挂接的源码实现，**不是已部署、已收费或已验证真实第三方执行的 Marketplace**。

## 已实现的范围

- 一个原企业 Workspace 内的多个第三方提供者；提供者具有独立身份，不能成为企业成员。
- 提供者档案、原已审核 Worker 连接查询、服务草稿、修订、独立上架审核、下架和暂停。
- 按任务、按有效时长、按输入/输出/缓存输入 Token 报价；价格和数据范围在下单时冻结。
- 使用原 WorkerDesk 的同一个订单 ID、原同步 attach 事务、原派发/回查/取消/验收。
- 在原 Store 写事务内再核对商业派发许可，阻止并发退款记录与派发之间的竞态；不新增写入引擎。
- 合同、资金及用量记录附在原 Store 的 `marketplace` 命名空间；没有第二个执行状态机。
- 完整任务输入必须由企业人工确认。提供者不能读取未付款的本地委托草稿。
- 支付成功必须从可信支付方读取，不能靠浏览器回跳、Worker 自报或模型 boolean。
- 原任务提交回执不确定时按原 ID 回查；取消请求不等于已停止；完成不等于验收或分账。
- 固定任务全额退款、计量预算余额退款、验收后分账、未知结果读回对账；不自动重发未知付款。
- 按调用前预留/使用后核销的可信计量接口；到预算上限拒绝新的计费预留。
- 内置 Agent 四个薄工具：状态、发现、草拟委托、读取指定任务。没有支付/批准/验收工具。
- Buyer 和 Provider 两个 React 面板，可放入现有抽屉，不新增 App 或主页。

## 原 Host 接线（显式启用，不读取/创建生产凭据）

在**现有可信 bootstrap** 调用原 `createApp` 后、原 `app.listen` 前：

```js
import { mountMarketplace } from './server/marketplace/host.mjs';

// app 来自现有 createApp(existingOptions)，不是另一个服务。
await mountMarketplace(app, {
  enabled: true,
  workspaceId: existingWorkspaceId,
  bindings: readExistingReviewedWorkerBinding,
  authenticateProvider: existingIndependentProviderAuth,
  reviewers: existingApprovedReviewerSubjects,
  payments: existingReviewedPaymentAdapter, // 未提供时不能真实收费/派发
  verifyMeter: existingIndependentUsageVerifier, // 未提供时计量价格不可购买
  feeBps: agreedPlatformFeeBps,
});
await app.listen(existingPort);
```

上面的 existing* 名称是需要从当前原 Host 注入的依赖，不是项目自动存在的变量。
默认 launcher 未自动开启 Marketplace；普通装包不授予企业资料、Worker 或支付权限。
模块只拦截自己的前缀，其他请求交回同一个原服务器监听器。
原业务 Workspace、内置 Agent 和公开/非商业旧任务继续使用原入口。

### bindings 的确切形状

可信 Host 对已存在的 `workerId` 返回：
`workerId, providerSubject, publicOnly:true, commercialOnly:true, verified:true,
ready, serviceIds, expiresAt, priceModes, legacyBudgetCredits, meterAuthority?,
payoutAccountRef?`。

它不能来自提供者表单；verified/ready 需要真实接入证据。legacyBudgetCredits 仍是
原执行协议的约束，不是人民币或支付凭证。`payoutAccountRef` 在创建委托时固定，
防止任务中切换收款账户。执行授权到期不必重新开放电脑权限才能结算已验收工作。

本版本**不动态创建原 WorkerDesk 的 adapter**。新提供者须先通过已有 A2A/Muse/Dot
审核接入并由原 Host 注册。市场服务表单不能上传任意端点、可执行代码或 API Key。
尚未实现真正的开放自助接入、通用 Personal Agent 远程启动器或新云电脑生命周期。

### 身份边界

Buyer API 在 `/api/worker-orders/marketplace` 下，逐请求走原 `access.begin`，使用
真实目标路径、原 Session、CSRF、签名 body 验证与审计。不是把路由伪装成其他路径。
Agent 内部工具固定 `human:false`；后台只允许本地草稿，人工仍须核对内容并付款。

Provider API 在 `/api/marketplace-provider/v1` 下，只接受独立的已有身份 resolver。
resolver 须校验原身份、精确 method/target/body、撤权、期限和限流；使用 cookie 时也须
校验 CSRF。不能把企业 Session 或模型给出的 subject 当作提供者身份。缺失时返回 503。

一个 Host 只支持一个买方企业空间，不宣称整个原 Workspace 已有多租户隔离。
全球开放平台仍需正式身份供应、跨企业数据库迁移、租户安全审查与运营控制台。

## HTTP 接口（响应为实体本身，不是旧 `{order: ...}` 包装）

Buyer 前缀 `/api/worker-orders/marketplace`：

| 方法/相对路径 | 作用 |
| --- | --- |
| GET /status、/catalog?q=、/orders | 配置、真实目录、本人委托 |
| POST /orders | 创建原订单及报价关联 |
| GET /orders/:id | 原任务状态、实际输入、冻结价格和交付 |
| POST /orders/:id/confirm | `{confirmed:true,termsHash}`，只确认准确版本 |
| POST /orders/:id/checkout | 创建一次支付流程；不确定时不重建 |
| POST /orders/:id/reconcile-checkout | 查询原支付流程，不另建 |
| POST /orders/:id/sync-payment | 核对原支付方；已授权已付款才派发 |
| POST /orders/:id/start、refresh、cancel | 原任务启动、回查与取消 |
| POST /orders/:id/accept | `{confirmed:true,deliveryDigest}`，验收准确交付版本 |
| POST /orders/:id/dispute | `{reason}`，登记争议并阻止后续结算 |
| GET /orders/:id/receipt | 下载原 Artifact 第一版本验收 JSON 回执 |
| GET /review/queue、/review/orders | 仅显式配置的 reviewer |
| POST /review/listing、/review/provider | 上架审核、暂停/恢复提供者 |
| POST /review/orders/:id/settle、refund | 独立人工资金操作 |
| POST /review/orders/:id/reconcile-movement | `{kind}`，只查询原资金操作 |

Provider 前缀 `/api/marketplace-provider/v1`：
GET `/bindings`、`/listings`、`/orders`、`/orders/:id`；
POST `/profile`、`/listings`、`/unpublish`。

Stripe webhook 为 POST `/api/marketplace-payments/stripe`，保留原始请求字节，交官方
SDK constructEvent 核验。只处理已认识的 Checkout；最终状态再次向原支付方读取。

## 支付与计量

`createStripeMarketplacePayments` 接收已安装并审核的**官方 Stripe SDK 实例**，不
自行实现签名算法或搜寻密钥。显式初始化核对原平台账户。未配置时不能假付款。

固定价买方对约定交付负责验收，不代表保证销量或获客收入。计量价是预算内尽力执行；
预算用尽不等于完成。输入 Token 数不含另外计价的缓存输入，避免重复收费。
用量先累计后按最小币种单位向上取整；不对每个事件重复取整。平台费使用整数基点。

可信计量需要独立 gateway/供应商记录验证，不接受 A 自报“消耗多少”。verifyMeter
返回带 orderId、workerId、authority、id、kind 的核实事件；reserve、commit、release、
close 幂等处理。付款上限约束 B 的可结算金额，不能神奇地阻止 A 在自己电脑上另行花费。
调用进行中断网或取消，必须核对剩余 reservation，不能当作零成本。

资金适配是 separate charges and transfers，**不是法律托管服务**。
目前必须人工 reviewer 结算，不自动从验收直接转账。地区收款资格、税费、KYC、争议款
和平台责任须由正式账户及支付方案核验。

重要未覆盖：已分账后的 transfer reversal/退款争议、计量失败订单的人工金额调整、
拒付后追偿、异步争议 webhook 全覆盖、退款失败后的人工恢复和全球提现。
这些情况明确阻断，不会冒充自动解决。未知 Checkout/退款/转账结果保留原 operationId，
独立读回；对账发现重复记录或扫描不完整必须人工核对，不自动新付。

官方接口参考（实现时核对）：
- https://docs.stripe.com/connect/separate-charges-and-transfers
- https://docs.stripe.com/api/checkout/sessions
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/api/transfer_reversals

## 前端与内置 Agent

`src/marketplace/MarketplacePanel.tsx` 导出 Buyer/Provider 面板，使用原 React。
Buyer 的 request 必须复用原 Session/CSRF 网络客户端；Provider 必须用其独立身份
客户端。以已认证 Session 的 identity 作为 React key，换账号时卸载旧面板；request
使用稳定引用。onCheckout 是明确跳转，onDownloadReceipt 复用原认证文件下载。
不另写 App.tsx、不更换 UI 组件库、不修改 PR66。

请在原聊天的“委托 Worker”入口打开 Buyer 面板；不要接旧 hire/onboarding/instances。
回跳 `marketplaceOrder` 只作为 initialOrderId，**不能当作付款成功**。回跳后需要调用
原 sync-payment 或经签名 webhook 获取支付状态。页面显示持久记录，不伪造实时进度。

提供者 UI 当前可以建档、选择已核验连接、新建三种报价服务和下架；完整修订 UI、平台
reviewer 资金控制台、任务图持久绑定、云电脑画面、任意附件扫描/安全预览仍待整合。
Buyer 下载的是原验收回执，不冒充通用远端二进制文件下载。既有 Muse/Dot 的实际上传
继续走原文件协议；后续将准确文件关联映射到同一面板，不接受任意 URL 下载。

内置 Agent 包普通安装为 unconfigured；见 `packages/workspace-marketplace/README.md`。
需要原 Host 绑定真实 buyer 后加载，不能将模型 API 替代选定的个人 Agent。

## 验证与上线门槛

本会话：Node22.16.0，实际原 WorkerDesk + 明确合成事务 Store、身份、支付/Worker/
计量；真实 Node HTTP、官方 SDK 形状替身、Pi 注册合同替身。React 仅语法转译检查。
**未运行整仓 build、官方 SDK 真模型、Node24 原 Host 全集成、浏览器视觉或部署验收。**

完整 PR81 checkout 还必须运行：

```sh
node --test test/marketplace.test.mjs test/marketplace-http.test.mjs test/marketplace-stripe.test.mjs test/marketplace-plugin.test.mjs
node --test acceptance/marketplace-original-host.mjs
npm run build
npm test
```

后一个原 Host 用例真实读取原磁盘 Store/Artifact 并冷重启，但外部账户仍为测试替身；
它在本会话未执行，不能计入已通过数。真实两名提供者各一次交付、真实付款/退款/分账、
移动浏览器和独立权限审查，仍是商业发布前的独立门槛。
