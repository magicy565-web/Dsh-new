# Shopify 完整 SKU 映射与市场监测接线

基线：PR81 `f6fa3c5a08a33a96ae914574f186814208516ebe` 建新分支 `codex/shopify-receipt-market-scope-20261015`，合入 PR80 `6d1d1175f60802960b411ff751c6dad003d8570f`。旧 D 保持结束/UNKNOWN；没有恢复旧任务。只改 Shopify 映射消费者，writer、模型 provider、MCP、审批账本和调度器实现保持原样。共享 Host 的两个消费入口改动已在实施前报告。

## 当前真实结果与阻塞

[readonly-config.json](readonly-config.json) 是本执行环境的实际只读配置检查：只保存变量名/存在布尔及原 `createShopifyClient().status()` 的配置状态。`WORKSPACE_SHOPIFY_SHOP_DOMAIN`、`WORKSPACE_SHOPIFY_ADMIN_TOKEN`、`WORKSPACE_SUPPLIER_SHOPIFY_WRITES_ENABLED` 均未提供，三个常用 `.env` 文件及默认 `.data` 目录均不存在。目标域名匹配为 false，原 client 状态为 `unconfigured`。

**真实店铺身份/scope 尚未核验；本次真实 Shopify 请求为 0。** 此结论限本执行环境。没有可使用的原 Host 地址/管理员 Session，因此未调用真实 Host 的 commerce-status/verify。云浏览器登录与官方 Muse Connector 安装事实不能证明 Workspace 原 Admin API 的授权。未读取浏览器 Cookie、聊天凭据或远端主机密钥；未创建授权/凭据、扩权、发布真实商品、付费、部署、合并 main 或强推。

## 管理员安全手动配置与只读核验

1. 在原 Workspace Host 的部署管理界面检查已有 secret 引用。确认已有授权确属 `vubm17-ak.myshopify.com`。若已有授权不存在或没有所需 scope，本次保持阻塞，由原授权所有者另行处理；本说明不要求新建应用、OAuth 授权或扩权。
2. 仅将已有 secret 绑定到原 Host 进程环境中的 `WORKSPACE_SHOPIFY_ADMIN_TOKEN`；设置 `WORKSPACE_SHOPIFY_SHOP_DOMAIN=vubm17-ak.myshopify.com`。沿用原 secret manager/service 环境注入方式，不把值放进聊天、URL、命令参数、源码、测试文件或 Git。可使用权限为 0600 的部署私有环境文件，但不要提交该文件。本文不提供或提取 token。
3. `WORKSPACE_SUPPLIER_SHOPIFY_WRITES_ENABLED` 保持未设置或 `0`；本轮核验无需启用 supplier connector。API 继续固定 `2026-10`。实际原进程若需刷新环境，由管理员按原变更流程处理；本次没有重启或部署它。
4. 以原 Workspace 管理员登录原“产品托管”页面，读取原 `GET /api/commerce-status`，确认 `shopify.configured=true` 且 targetDomain 为上述精确域名，再点原 **验证授权** 按钮。它通过原 Session/CSRF 发送 `POST /api/commerce-shopify/verify`，body 为 `{}`；该入口只接受空对象或可选 UUID requestId，不接受 token。
5. 核验返回的 `shopify.shop.domain`、Shop GID、`scopes`、`readiness.readConfirmed`、`verifiedAt`。只读商品所需 `read_products`（原 client 也接受已有 `write_products`）；订单观察需已有 `read_orders` 或 `write_orders`。缺权限按不足报告，不申请扩大。本轮无需读取订单或历史；超过原 60 天窗口另有权限限制。失败/店铺不匹配/过期应保持未知或错误状态，不能报告通过。

该原核验只读 shop/currentAppInstallation。管理员可以回传去密后的布尔/错误码/已有 scopes，不回传任何 token、Cookie 或 Session。核验通过也不构成原 Library policy、原获客启动、人审、商品写入或付款授权。

## 接口与范围

原受信 `resolveLaunchReceipt` 继续负责真实的原计划人审及获客执行证据；默认仍为 null。B2C 启动回执现在还必须携带精确引用：

```json
{
  "shopifyPublication": {
    "serviceId": "original supplier service UUID",
    "operationId": "original successful publish operation UUID",
    "scopeHash": "original publication scope SHA-256"
  }
}
```

这是原 Host 注入接口，模型 monitor 请求 DTO 仍只接收原 plan/launch 引用。此引用不带映射分页、凭据或新授权。原 acquisition receipt 仍必须具有精确产品、Shop、完整 variantIds、渠道和真实 approved acquisition startedAt。发布回执的 `publishedAt` 不能补成获客时间。

`shopify-market-scope.mjs` 从同 owner/workspace/conversation 的原 supplier row 读取原 operation 的**完整** receipt：成功 publish、complete/found/published、空 issues、原 consumed 人审绑定、当前 preview/service revision、原 Library product revision/source/image/SKU 都须相符。要求原 source.skus、原 reviewed variants、receipt.variantReceipts、receipt.variantIds、publish scope.variantIds、launch.variantIds 一一对应、完整且唯一。按 sourceSkuId 与显式选项/原 SKU 核对，无位置猜测；拒绝空、子集、partial、重复、跨店/产品或后续未确认的原操作。

`product_all_variants` 的集合是**本次原经审上市操作的全部变体**，可覆盖 Library 的已审选择；不扩大为 Library 中未选 SKU，也不使用模型分页结果拼接范围。原缺 sourceSkuId 映射的旧单规格回执仍可沿原发布路径使用，但无法自动升级为本次严格监测绑定；需要原来源/上市记录核实，本次不修改或补写旧回执。

原 launch reader 将规范化 `shopifyScope` 交给原 monitor：Library product/revision、source/source snapshot hash、service/revision、operation/publication scope hash、Shop/domain、Shopify product/publication、完整 variantIds/sourceSkuId→variantId 集合及销售单位均进入原 `scopeHash`。完整范围保留于原 Goal.marketValidationMonitor；Goal description 记录引用/hash，避免 100 SKU 重复文本超过原 20,000 字符边界。原 schedule 人审仍绑定该 scopeHash。

每次创建、观察前后重新解析原回执，原来源或映射变化拒绝旧 scope。原 Shopify 只读产品查询还核对完整唯一变体集合；新增、删除、分页未完成、重复或店铺身份变化在付费 outcomeAdapter 读取前阻断。这里复用原产品身份查询；持续远端价格/正文/媒体全字段审计不在此增量内，仍由原 publication 对账负责。

## packs / units 与结果

`shopifyScope.saleUnit={unit,unitsPerPack}` 保存原经审单位。Shopify cohort 的 gross/retained/refunded/cancelled quantities 都是行数量对应的 **sale_units**；例如每包 6 件，订单数量 2 是 2 个销售包。`retainedUnits` 继续是未取消行的 currentQuantity，已经扣除退款/移除，不再重复减退款。它不证明支付、渠道或净支付件数。单订单含多个匹配 SKU 只计一个订单；退款与取消重叠单列，重复 order ID 拒绝。

原已审 `outcomeAdapter.readOutcomes(scope)` 现在收到完整 `scope.shopifyScope`。它若返回 paidUnits/netPaidUnits/refundedUnits，必须确认下述单位绑定，否则保持 unavailable/null：

```js
unitBasis: {
  unit: 'physical_units',
  unitsPerPack: scope.shopifyScope.saleUnit.unitsPerPack,
  shopifyScopeHash: capabilityPayloadHash(scope.shopifyScope)
}
```

换算与净支付/取消/退款/原渠道证据属于既有受信 outcomeAdapter 的职责；本增量未配置真实 adapter，也未从 retainedUnits 自动生成 netPaidUnits。原付款证据、完整 168 小时窗口、原必选指标和服务目标/市场比较的独立评估继续生效。

## 可复核替身验收

[acceptance.log](acceptance.log)、[checks.json](checks.json)、[source.json](source.json) 记录当前源码的完整受影响回归：**190/190，0 fail/skip/cancel，exit0，115.399秒**；`npm run build`（含 tsc）和 `git diff --check` 通过，构建保留已有大 bundle 提示。三文件同时记录命令及源码哈希。测试运行原 Store/Library/Artifact/人审 API/原 publisher/monitor/scheduler 与固定 Pi/OMP；Shopify HTTP、模型选择、owner authority、人审、acquisition launch 和 payment 内容全部是显式有限本地替身，不能作为真实商业验收。新 4/100 SKU 用例真实走原创建与发布组件各一次；没有第二个 writer。

新用例覆盖乱序、模型仅 4 条分页、完整映射、空/子集/重复/partial/跨店拒绝、来源和 source hash 失效、远端变体增删/partial/重复阻断、pack 口径缺失拒绝，以及退款取消、多 SKU 同单去重；原 HTTP 冷重开/原调度人审亦回归。首次运行缺固定 OMP reader 导致旧 PDF 用例失败，安装原 support 锁定运行器后通过；测试迁移曾发现缺 role 的原调度身份及不完整合成 Library fixture，均修复，无放宽原 owner 权限。

本次未新增/修改 GraphQL 查询或 mutation。Shopify skill 文档 MCP 检索未返回后被中断，固定 skill 本地未预装，因此未声称新 GraphQL validator 运行；结束前经 skill resource 单独取回 feedback helper，以 `OPT_OUT_INSTRUMENTATION=true` 执行 exit0，未传输遥测。语义核对使用 Shopify 官方 [LineItem](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/LineItem) 与 [AppInstallation](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/AppInstallation) 文档；页面当时标注 2026-10 latest，代码仍固定 2026-10。真实店铺、真实已审原获客 receipt、真实 net payment adapter 及原 Host 只读核验仍待已有安全配置。
