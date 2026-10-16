# 七天验证计划：A 路组合能力

Issue #75；从 PR #68 精确 `d82d35fd7213012ff6b0e5f2f24d765aba021a9e` 开发。只新增包、独立服务、测试和本文，不改默认入口或既有工厂插件。该基线 git tree 没有 AGENTS.md 或 .agents/skills；已读 00_READ_FIRST_WORK_HANDOFF.md 及相邻包 Skill。

## 最小集成约定 v1

| 接口 | 输入 | 输出 |
| --- | --- | --- |
| `workspace_market_validation_product` / client.read | `{productId, documents:[{documentId, documentVersion}]}` | 原材料回执、文档回执、精确 sources、授权及抽取限制；无事实补全 |
| `workspace_market_validation_plan_save` / client.save | 同上 + `{sources, plan, requestId}` | `status:saved-draft`、`artifact:{artifactId,version,sha256,duplicate}`、planHash/sourceHash 与原来源 |
| client.revalidateReceipt | receipt, currentModel, signal | 重新检查原权限、源版本及回执完整性；不匹配抛错 |

`plan` 的完整 JSON Schema 和严格数据校验见 `plugins/workspace-market-validation/src/plan.mjs`。核心字段是 schemaVersion:1、goal、mode:b2b/b2c/dual、rationale、productState、supply:{dropshipping,oem,odm}、paths、timeZone、budget、commission、questions、assumptions。每条 path 独立包含受众、市场、offer、销量要求、选择的指标、获客来源、自由 steps 和成功/停止标准。没有固定营销流程或固定文书数量。

保存的是原 artifact JSON `workspace.market-validation-plan.v1`，包含 plan、sources、extraction、固定安全状态和 Shopify handoff。所有输出固定 `humanReviewRequired:true, humanReviewed:false, externalActions:false, startedAt:null`。JSON 的 execution 固定 `status:not_started, durationDays:7, actualStartedAt:null, baseline:null, endsAt:null`。B 路只需接 artifact 的精确版本/hash 和 planHash；它们不能作为生产批准或真实启动证据。后续批准/启动/采集应继续使用原任务/审批/预算服务，不写回新账本。编辑需新 requestId，原计划版本保留待审。

### 与 B 路 PR #76 的映射

已只读核对 B 路 `a8a73b19c07527007a6d103d18711e57cbb01191` 的 `docs/MARKET-VALIDATION-MONITOR.md`，最小约定兼容。Host 将 `savedReceipt.artifact.artifactId → planId`、`savedReceipt.artifact.version → planRevision`，同时保留 artifact.sha256、planHash；先按原权限读取和核验精确 bytes/version。`launchReceiptId` **只能**来自原获客渠道真实执行记录。Host 的只读 `resolveLaunchReceipt` 还需核验原人工批准、计划 hash、产品/变体/商店/渠道、真实启动时间、时区与基线状态，不能用本草案、模型字段、Shopify 仅上架回执或 synthetic 回执替代。A 的 `plan.timeZone` 对应 B 解析器的 `timezone`；实际七天窗口由 B 按真实启动后 168 小时计算。本模块不填写该回执或开启 Schedule。

| A 路计划指标 | B 路来源字段 | 集成注意 |
| --- | --- | --- |
| qualified_inquiries / quote_requests / sample_requests / b2b_orders | qualifiedInquiries / quoteRequests / sampleRequests / orders | 仅 B2B 路径；资格口径和重叠保持原来源说明 |
| net_paid_orders / net_paid_units | netPaidOrders / netPaidUnits | 需原已授权支付/转化来源；Shopify cohort 的 retainedUnits 不等于净支付 |
| visits | 暂无直接映射 | B 的 productDetailViews 是商品详情事件，不能冒称 sessions/访客 |
| add_to_cart / checkouts | 原来源未接通则 unavailable/unconfigured | 不能默认填零 |
| refunds | 无无条件映射 | B 的 refundedUnits 是退款件数，未明确计划单位前不能当退款订单数/事件数 |

dual 计划由 B 按 b2b/b2c 各自真实回执建立独立原任务，不相加。B 的公共 dispatcher 尚未注册，原 Runtime 仍拒绝 `businessAgentOwner` 会话创建 Goal（`BUSINESS_AGENT_CONVERSATION_ONLY`）；A 不绕过这个限制。合法原会话/任务关联、审批解析器和真实执行绑定由后续 Host 集成处理；此处不声称整条 OMP → 七天任务链已经接通。

## 原能力与缺口

读取复用 `createWorkspaceFactoryMaterialsClient` 及 `/api/library/model-read/factory/*`，保留同一原 Session、接收模型、字段/版本/过期范围。服务不直接从 Store 扩读业务字段；Store 只在原 artifact 提交检查源版本及会话所有者。现有材料投影有 SKU 规格/MOQ/交期、capacityNote、documentReferences/provenance；价格/成本/库存/物流/退换货及一件代发/OEM/ODM 不在当前投影内，按所选计划需要追问，不能默认扩大权限或把模型整理称为事实。

`createMarketValidationPlanClient({materialsClient,artifacts,store,identity,conversationId,runId?,authorize,canSave,clock?})` 只接原服务对象。`identity` 必须原认证角色/成员/租户；`authorize(signal,model)` 复核原 Session、当前接收方和执行上下文；同步 `canSave(state)` 必须在提交事务中复核原 Run 意图、取消和授权。不要接模型提供的 identity 或恒 true 的生产 guard。缓存回执需从原 owned journal 的真实工具 ID 提取并在**每次**模型请求前 `revalidateReceipt`，包括恢复/重载。默认入口未接线；不能将本独立 adapter 测试描述为现有网页已支持。

Shopify 继续复用 `server/supplier-service.mjs` 的原产品建档、供货就绪、明确公开字段 preview/preview-page 和 `server/supplier-publication.mjs` 的 shopify-review/decision/execute/reconcile；`server/shopify-publication.mjs` 仍是原 Connector 执行器。计划仅返回这些交接名称，不调用写入 API 或生成批准。原 `/shopify-draft` 本身仍是非写入阻塞入口。实际 draft、publish 各需精确原批准和执行回执。本计划没有新上传/订单/库存/指标连接器。当前 retail adapter 没有 B2B RFQ 页面能力；获客渠道、线索收集和真实归因另行接入并授权。Shopify 上架不是广告投放。

预算为提议的一个币种、总上限及分用途上限，使用十进制字符串，不换汇；以整数精确校验分项上限之和。佣金上限必须预留在总预算内，定义 payer/payee、basis、method、rateOrAmount、currency、settlement、refunds、cap/budgetLineId；这些文字均未批准，不能自动付费。旧模型 CNY5 不作为投放预算。

## 启动与验收

```sh
npm ci --ignore-scripts --cache=/tmp/workspace-market-validation-npm-cache
node scripts/setup-omp-runtime.mjs
node scripts/workspace-omp-install.mjs
node --test test/market-validation-plan.test.mjs test/market-validation-package.test.mjs
npm run typecheck
# 原 Host 的配置检查（没有接本包的新 profile）
npm run workspace -- --check
```

独立包的官方 CLI 加载（不调用模型）：

```sh
support/omp-bun-linux-x64/node_modules/@oven/bun-linux-x64-baseline/bin/bun \
  support/omp-coding-agent/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js \
  --no-extensions --no-skills -e ./plugins/workspace-market-validation --help
```

更有意义的真实 SDK/Skill 加载及有限 keyless 替身工具选择验证随测试运行；具体运行结果见 `docs/validation/market-validation-plan-20261015/README.md`。该测试不能证明真实模型选择、真实企业授权、真实商店或真实七天观测。不得使用开发环境作真实发布或投放。

OMP 18.10.4 会在调用工具前修复部分参数，包括移除不支持的字段；Pi 1.1.0 对测试中的多余字段直接拒绝。因此不能声称 SDK 会拒绝所有原始畸形调用。两者最终传给此工具/原服务的都是限定字段，原服务重新验证选定 ID、source、版本和权限；模型附带的字段不授予读取或执行权。JSON Schema 的 nullable enum 已同时包含 null，真实两套 SDK 均验收可用。
