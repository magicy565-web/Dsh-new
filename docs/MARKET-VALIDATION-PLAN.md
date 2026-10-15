# 七天验证计划：A 路组合能力

Issue #75；从 PR #68 精确 `d82d35fd7213012ff6b0e5f2f24d765aba021a9e` 开发。只新增包、独立服务、测试和本文，不改默认入口或既有工厂插件。该基线 git tree 没有 AGENTS.md 或 .agents/skills；已读 00_READ_FIRST_WORK_HANDOFF.md 及相邻包 Skill。

## 最小集成约定 v1

| 接口 | 输入 | 输出 |
| --- | --- | --- |
| `workspace_market_validation_product` / client.read | `{productId, documents:[{documentId, documentVersion}]}` | 原材料回执、文档回执、精确 sources、授权及抽取限制；无事实补全 |
| `workspace_market_validation_plan_save` / client.save | 同上 + `{sources, plan, requestId}` | `status:saved-draft`、`artifact:{artifactId,version,sha256,duplicate}`、planHash/sourceHash 与原来源 |
| client.revalidateReceipt | receipt, currentModel, signal | 重新检查原权限、源版本及回执完整性；不匹配抛错 |

`plan` 的完整 JSON Schema 和严格数据校验见 `packages/workspace-market-validation/src/plan.mjs`。核心字段是 schemaVersion:1、goal、mode:b2b/b2c/dual、rationale、productState、supply:{dropshipping,oem,odm}、paths、timeZone、budget、commission、questions、assumptions。每条 path 独立包含受众、市场、offer、销量要求、选择的指标、获客来源、自由 steps 和成功/停止标准。没有固定营销流程或固定文书数量。

保存的是原 artifact JSON `workspace.market-validation-plan.v1`，包含 plan、sources、extraction、固定安全状态和 Shopify handoff。所有输出固定 `humanReviewRequired:true, humanReviewed:false, externalActions:false, startedAt:null`。JSON 的 execution 固定 `status:not_started, durationDays:7, actualStartedAt:null, baseline:null, endsAt:null`。B 路只需接 artifact 的精确版本/hash 和 planHash；它们不能作为生产批准或真实启动证据。后续批准/启动/采集应继续使用原任务/审批/预算服务，不写回新账本。编辑需新 requestId，原计划版本保留待审。

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
node --test test/market-validation-plan.test.mjs
npm run typecheck
# 原 Host 的配置检查（没有接本包的新 profile）
npm run workspace -- --check
```

独立包的官方 CLI 加载（不调用模型）：

```sh
support/omp-bun-linux-x64/node_modules/@oven/bun-linux-x64-baseline/bin/bun \
  support/omp-coding-agent/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js \
  --no-extensions --no-skills -e ./packages/workspace-market-validation --help
```

更有意义的真实 SDK/Skill 加载及有限 keyless 替身工具选择验证随测试运行；具体运行结果见 `docs/validation/market-validation-plan-20261015/README.md`。该测试不能证明真实模型选择、真实企业授权、真实商店或真实七天观测。不得使用开发环境作真实发布或投放。
