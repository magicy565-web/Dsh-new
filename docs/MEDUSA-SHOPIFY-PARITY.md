# Medusa 对标 Shopify：发布契约 1:1 复刻

状态：S0 规格、S1 目标抽象、S2 Medusa adapter（draft/publish，stub 验证）已完成；S2b 接线与真实实例验收待做。

## 0. 复刻边界

复刻对象是 **Workspace 与外部商城打交道的那一层契约**，也就是 `server/shopify-publication.mjs` 暴露的全部动作、回执、对账和守卫语义。同一个 `supplier-publication` 流程换一个 `adapter` 就能打 Medusa。

不复刻的是 Shopify 作为托管服务本身的东西：Checkout、支付、税费、运费、欺诈、CDN、应用市场、SLA。这些在 Medusa 侧对应的是 **provider 插件**（支付/物流/税费各自接真实供应商），不是 adapter 代码能变出来的。文档里单独列出，不混进"已完成"。

## 1. 两边的现状

| | Shopify | Medusa |
|---|---|---|
| 适配器 | `server/shopify-publication.mjs`（265 行，动作/回执/对账/修复齐全） | `plugins/workspace-medusa-catalog/src/backend.mjs`（仅 `GET /admin/products`、`POST /admin/products`） |
| 流程接线 | `server/supplier-publication.mjs` 硬编码 `workspace-supplier-shopify` | 无接入 |
| 连接器 | `供应商 Shopify 商品发布` + `WORKSPACE_SHOPIFY_ADMIN_TOKEN` | 无 |
| 动作 | `supplier.shopify.draft\|publish\|repair_draft` | 无 |

## 2. 概念映射

| Shopify | Medusa v2 | 说明 |
|---|---|---|
| Shop (`shopId`) | Store + `WORKSPACE_MEDUSA_BASE_URL` | 一实例一企业（文档已限定单租户） |
| Publication (`publicationId`) | Sales Channel (+ Publishable API Key) | Medusa 没有 publication 对象；`published` = status + 渠道关联 |
| Product status `DRAFT`/`ACTIVE` | `draft`/`published` | 直接对应 |
| ProductVariant + `inventoryItem.sku` | Variant + `options` + `sku` | 选项模型不同：Shopify 变体自带 optionValues，Medusa 是 product.options + variant.options |
| Variant price | Variant `prices[]` 或 Price List | 零售价直接挂变体；批发/阶梯走 Price List |
| MediaImage / stagedUploads | `/admin/uploads` + `images[]` | 没有 staged 两步；上传即入库（file provider 决定落 S3 还是本地） |
| Metafield `cnsubscribe_workspace.draft_intent` | Product `metadata` | 无类型化 metafield，用 metadata 存 marker 哈希 |
| Markets | Region + Price List + Sales Channel | 无 Catalog 层，"某市场可见哪些商品"要自建映射 |
| Orders | `/admin/orders` | 字段模型不同，需要 normalize |
| Webhook + HMAC | Event Bus subscriber | Medusa 没有对外 webhook 投递，需要自己发 |

## 3. 逐操作映射

`server/shopify-publication.mjs` 的每个外部调用，对应 Medusa 的：

| 动作 | Shopify | Medusa |
|---|---|---|
| 身份校验 | `query SupplierPublicationShop` | `GET /admin/stores` + `GET /admin/sales-channels` |
| 草稿对账 | `productByIdentifier` | `GET /admin/products?handle=…&fields=…` |
| 创建草稿 | `productCreate` + `media` | `POST /admin/products`（含 options/metadata/images） |
| 上传图片 | `stagedUploadsCreate` + 直传 → `resourceUrl` | `POST /admin/uploads`（multipart）→ `upload.url` |
| 单变体价格/SKU | `productVariantsBulkUpdate` | `POST /admin/products/:id/variants/:vid`（prices + sku） |
| 多变体 | `productVariantsBulkCreate` | `POST /admin/products/:id/variants` × N（无 bulk 端点，逐条或 workflow） |
| 激活 | `productUpdate(status: ACTIVE)` | `POST /admin/products/:id`（status: published） |
| 发布到渠道 | `publishablePublish(publicationId)` | `POST /admin/products/:id` + `sales_channels: [{id}]`（需在 2.21.2 上核验字段名） |
| 回执 | metafield marker | `product.metadata.workspace_draft_intent` / `publication_intent` |

**必须在 2.21.2 真实实例上核验的三处**（不能靠猜）：

1. `POST /admin/products` 是否接受内联 `options`/`variants`，还是必须先建产品再建变体；
2. `sales_channels` 是产品写入字段还是独立的渠道-商品关联端点；
3. `POST /admin/uploads` 的 multipart 字段名与返回结构。

## 4. 要动的代码（文件级）

| 文件 | 改动 |
|---|---|
| `server/supplier-publication.mjs` | 把 `SUPPLIER_SHOPIFY_ADAPTER`、`supplier.shopify.${action}`、`gid('Publication')`、`shopDomain/shopId/publicationId` 换成来自 adapter 的 target 描述；scope schema 升级 `v2`；Shopify 行为不变 |
| `server/supplier-profile.mjs` | `preview.shopifyProductId` → `preview.commerceProductId`（保留旧字段到迁移完成） |
| `server/shopify-publication.mjs` | 不改行为，补 `target: 'shopify'` 与 scope 字段声明 |
| `server/medusa-publication.mjs` | **新增**：与 Shopify 同形的 `status/fingerprint/reconcile/planRepair/execute` |
| `server/index.mjs` | 注册 `workspace-supplier-medusa` 连接器（沿用现有 connector/凭据机制） |
| `test/supplier-*.test.mjs` | 现有 Shopify 用例保持；新增 Medusa 等价用例（stub fetch） |

## 5. 切片

- **S1 目标抽象**：`supplier-publication` 不再认识 Shopify 专有字段，改由 adapter 声明 target；Shopify 全量回归必须不变。产出：`supplier.shopify.*` 行为零变化。
- **S2 Medusa 草稿**：`medusa-publication` 的 status/fingerprint/reconcile/draft（产品 + 单变体 + 价格 + 图片），marker 存 metadata。产出：`supplier.medusa.draft`。
- **S3 多变体 + 发布**：variants×N、price list、sales channel 发布、`repair_draft`。产出：`supplier.medusa.publish` / `repair_draft`。
- **S4 订单与事件**：`commerce.mjs` 增加 Medusa order normalize；事件出站（subscriber → 我们的 connector run）。

## 6. 不可复刻（provider 层，必须接真实服务）

- 支付：Stripe/Adyen 等 provider 插件，Medusa 不内置收单
- 税费：tax provider（如 Stripe Tax/Avalara）
- 运费：fulfillment provider + 自建计费规则
- Checkout：需要自己的 storefront 或托管 checkout
- 多租户：Medusa 无租户隔离，一企业一实例（现有文档已限定）

这几项在 Medusa adapter 里**显式 fail-closed**，不假装支持。

## 7. 验收

1. 同一份 supplier scope 能在 Shopify 与 Medusa 上产出结构等价的回执（字段名可不同，语义与不变量必须相同）。
2. Shopify 侧现有测试 100% 不变。
3. Medusa 侧：真实实例 + Postgres 上跑通 draft → publish → 回执 → 对账；失败路径（409/超时/不确定）与 Shopify 语义一致。
4. 平台缺口项在 UI 与回执里明确标记为 `unsupported_by_target`。
