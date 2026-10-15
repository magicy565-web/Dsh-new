# Shopify 多规格上传：0.2.0 实施与验收

开发分支和 Draft PR81 沿用 `codex/shopify-product-plugin-20261015`；增量起点为 `1d703db12089a5763d9856bce4284c8745130a6b`，原整合基线仍是 PR80 `8eb33701bb5f70be74e5285c7c864b248d79be3b`。测试的运行代码检查点为 `71064c3`，随后提交只补文档/来源/证据。不是研究报告替代实现。

## 已实现的范围

原产品库已有 `skus[{id,code,specs,unit,moq,...}]`，原模型资料投影已有 `skuSpecifications`。本次直接引用原 SKU ID/code/specs 和原图片；没有新产品库、变体目录、Agent Loop、审批、调度、预算账本或 Shopify 连接器。源码增量包括原工具 DTO、原 supplier 预览映射、原 publisher 和纯字段比较助手 `server/shopify-variant-publication.mjs`。

- 原单规格 DTO、发布分支和旧 remoteContentHash 保持兼容；多规格是互斥的 `options + variants` 提案，2–100 个明确原 SKU、1–3 个规格维度、每 SKU 正数零售价，可选一张已选原图。原资料披露须显式含 `skuSpecifications` 与 `images`，不自动扩大授权。
- SKU ID/code 与规格值必须来自该原 SKU；重复/规范化后歧义的代码、维度或组合、未使用选项值、缺价格、假 SKU、未选图片均拒绝。只选部分真实组合可以；不计算笛卡尔积，不用批发阶梯价/产能补零售价或库存。SKU specs 缺失和未选字段有明确就绪状态。
- 完整预览包含每 SKU 的价格、规格、原图位置和原产品来源；写入原 supplier row/commands，版本及 sourceHash 继续绑定原 revision/权限。原精确 draft 人审涵盖整组组合和媒体，后续指定渠道 publish 另行人审，模型无批准工具。
- 原 productCreate 建 DRAFT、选项和原图；同一已批准原动作内调用 productVariantsBulkCreate，以 REMOVE_STANDALONE_VARIANT 删除**本次新建商品**的初始占位变体，只创建明确组合。媒体关联使用本次原 create 回执的 MediaImage ID，不新增文件传输链路。
- 原对账读取完整至多100变体/3维选项/图片关联，按组合匹配而非远端返回顺序；校验 SKU、价、原确认 ID 集、精确选项及媒体。错价、改 SKU、改选项或图片均阻止 publish。审批视图也把源修改标为 stale/canExecute:false。
- 批量响应丢失且远端完全一致可只读确认，仍保留原未确认写步骤；部分成功则 partial，首次 create 响应丢失导致媒体身份未确认也保留缺口。原单规格 repair 明确不能用于多规格；没有自动补齐、重试、重建商品或删除远端对象。
- 模型结果默认5 SKU一页、最多10，options 仅给维度名/值数量，完整原审批数据仍保留在原 Store/人类 Session。`result` 可指定 operationId，selectedOperation 对应精确旧操作，latest 保留真实最新状态。旧草稿的对账不会被后一次发布成功替换。原单规格无分页输入时保持既有结构。

库存一直标记 `unknown_not_written`；没有写 inventoryQuantities、quantityAdjustments、库存地点或跟踪配置。Shopify 默认库存行为与真实可售情况未验证，上架/发布不能证明有库存，也不启动外部获客或七天验证。售后、全库存管理、FastMoss/Amazon/其他外部 MCP 均未接入。

## 上游固定 API 依据与限制

在写代码前核对 2026-10 官方页面；具体 URL、读取日期和 schema 资产来源见 [upstream.json](upstream.json)。版本固定未升级为浮动 latest：

| 官方依据 | 采用的语义 |
| --- | --- |
| [productCreate](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/productCreate) / [ProductCreateInput](https://shopify.dev/docs/api/admin-graphql/2026-10/input-objects/ProductCreateInput) | 只创建初始变体；productOptions 最多3维；商品创建与渠道发布分开 |
| [productVariantsBulkCreate](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/productVariantsBulkCreate) | 明确批量变体；官方商品默认上限2048，不是本包上限。原库100 SKU限制和本包有界读取继续生效 |
| [create strategy](https://shopify.dev/docs/api/admin-graphql/2026-10/enums/ProductVariantsBulkCreateStrategy) | DEFAULT 可保留自定义初始变体；本次明确 REMOVE_STANDALONE_VARIANT，避免残留未审占位 SKU |
| [ProductVariantsBulkInput](https://shopify.dev/docs/api/admin-graphql/2026-10/input-objects/ProductVariantsBulkInput) / [VariantOptionValueInput](https://shopify.dev/docs/api/admin-graphql/2026-10/input-objects/VariantOptionValueInput) | price、inventoryItem.sku、optionName/name、mediaId 分开显式传入；库存数量不传 |
| [ProductVariant](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ProductVariant) | selectedOptions 和 media 关系用于精确回读，不能按列表序号猜 SKU |
| [API limits](https://shopify.dev/docs/api/usage/limits) | 单次数组250是 API限制，本包仅100；原请求成本、节流、Store 大小、SDK上下文和回执限制不被放宽 |

操作权限仍按原已授 read_products/write_products 及 publish 所需 write_publications 检查，没有申请新权限。schema helper 对对象注解输出的范围并集（例如包含其他资源的 read scope）不作为最小 OAuth 清单，不据此扩大实际店铺授权。真实商店权限、方案限额/大目录 throttle 和库存行为仍需单独验收，不拿本地 fixture 当平台资格证明。

官方 Skill 文档搜索 helper 本轮网络失败，以官方网页核对。随后使用 Skill 1.17.1 的 validator 和 SHA-512 校验过的官方 `@shopify/ai-toolkit@2.1.2` 中 `admin_2026-10.json.br` 离线 schema；补齐其原 data/assets 布局后，四个实际查询/变更及一个变量字段样例均成功。早期缺 assets/data 的报错是工具分发布局问题，未报作 schema 通过。工具/资产只在 `/tmp` 用于开发验证，无安装脚本、无运行时依赖、无 instrumentation 或真实店铺请求。

## 最终完整受影响回归

实际执行命令（不是逐个局部通过后相加）：

```sh
node --test --test-concurrency=1 \
  test/shopify-product-client.test.mjs test/shopify-product-contracts.test.mjs \
  test/shopify-product-package.test.mjs test/workspace-omp-shopify-product.test.mjs \
  test/supplier-publication.test.mjs test/supplier-publication.http.test.mjs \
  test/shopify-readiness.test.mjs test/factory-materials-read.test.mjs \
  test/workspace-omp.test.mjs test/workspace-omp-factory-materials.test.mjs \
  test/market-validation-monitor-tools.test.mjs test/market-validation-plan.test.mjs
```

**125/125，0 fail/skip/cancel，exit0，162.076秒**，见 [full.log](full.log)、[checks.json](checks.json)。原单规格/发布/HTTP/资料/Host/市场工具均在同次范围内执行，不是全仓测试。另 `npm run build`（含 tsc）通过，保留原 bundle 大小提示；无凭据 launcher --check 明确 unconfigured，付费/真实模型调用0。Node 语法、最终 diff、源码哈希和五个官方 schema 结果见同目录证据。构建原始字节保存在 build.raw.json，build.log 只去行末空白。

实际组件与模拟边界：

- Node **24.19.0**、Pi **1.1.0**、OMP **18.10.4**、Bun **1.3.14**，原 app/Library/artifacts/Store/capabilities/publication 真正执行。真实模型选择/正文/图片判断均未验收；模型是显式有限脚本，原 Workspace 人工身份/审批是合成 Session，Shopify 是仅允许合成域名映射至 loopback 的 HTTP fixture。
- 实际 Pi SDK 分别执行单规格与多规格读/提案。实际 OMP Host 分别跑通1/4/100 SKU 的五轮原 Session→Run→fd3→SDK→原提案→原 HTTP 人审→DRAFT→另行人审→publish；9工具及 Skill 仍使用官方包加载/禁用/启用/卸载，普通工具/另一扩展共存。
- 100 SKU分页核对所有原 SKU、价格、原 variantId 和关联匹配；稀疏组合只保存实际两项。冷重开验证单/多规格仍是同一原产品与操作。重复请求不重复建商品、批量丢响应/部分成功/首次create丢响应保持真实缺口；原写步骤不伪装为 acknowledged。
- 实际覆盖重复 SKU/组合冲突/缺价格/假规格与库存输入、未选来源、源改变、写入中取消、connector撤权、核验期间 Run 撤销，以及远端 SKU/价格/options/media 被改后的发布拒绝。原 Goal/schedule/七天启动未创建。
- 原传输/限流未放宽。第一次100 SKU Host 验收发现长回执被官方 SDK 截断，缓存校验拒绝；分页投影修复后1/4/100实际Host均在最终125项中复验。原审核和状态仍完整持久化，不用删源校验规避截断。有限多轮测试仍推进原测试时钟模拟人工审核间隔，生产240/分钟限制不变。

## 启动和仍需真实授权的边界

```sh
WORKSPACE_OMP_PROFILE=shopify-product npm run workspace -- --check
WORKSPACE_OMP_PROFILE=shopify-product npm run workspace -- --serve
```

安装/卸载和 DTO 示例见 [独立包 README](../../../packages/workspace-shopify-product/README.md)。默认 CLI 不会注入原 Library 审核策略，未配置保持 unconfigured；真实 Host 须通过原 createApp 可信入口提供原企业 Session、精确 recipient、revision/字段（images/skuSpecifications）、原模型/预算与现有店铺授权。不能用测试许可代替生产审核。普通 Pi 安装不自动获得受控 Host 权限。

本轮没有尝试 Shopify 登录、绕过安全拦截、真实商店/付费模型/广告/外部数据 MCP 请求、创建或修改凭据/权限、合并 main 或部署。真实开发店 API 成功、图片媒体托管、真实模型自主判断、真实库存和商业质量均仍未验收。
