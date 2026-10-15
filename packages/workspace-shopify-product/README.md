# Shopify product upload package

独立私有 Pi/OMP 包 `@workspace-agent/pi-shopify-product`，首版只处理**原产品库中的一个商品、单个零售变体和所选原图**。提供可组合工具和业务 Skill；模型按用户目标自行选择读取、检查、起草、申请原审批、执行已批准动作或查回执。包内没有模型循环、业务流水线、Store、调度器、审批器或新 Shopify 连接器。

普通安装只注册资源，九个工具均明确返回 `unconfigured`。安装不会扫描 token、建立授权、启动 Workspace、建产品库、联网操作店铺或启动七天验证。资料识别／建档仍由独立 E ingestion 能力负责。本包第一方许可证为 `UNLICENSED`，`private:true`，未发布 npm。

## 安装、禁用与卸载

在固定 PR80 基线上的实现分支安装已有锁定依赖（仅开发／合成验收）：

```sh
npm ci --ignore-scripts --no-audit --no-fund --cache=/tmp/shopify-product-npm-cache
node scripts/setup-omp-runtime.mjs
node scripts/workspace-omp-install.mjs
```

官方 OMP 18.10.4／Bun 1.3.14 本地链接，最后一项替换成该包的绝对路径：

```sh
support/omp-bun-linux-x64/node_modules/@oven/bun-linux-x64-baseline/bin/bun \
  support/omp-coding-agent/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js \
  plugin link /absolute/path/workspace-agent/packages/workspace-shopify-product
```

同一官方 CLI 支持 `plugin disable @workspace-agent/pi-shopify-product`、`plugin enable ...`、`plugin uninstall ...`。Pi 1.1.0 使用 `node node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js install /absolute/package/path`，卸载为 `remove /absolute/package/path`；其原 settings 包资源设置 `extensions:[], skills:[]` 可禁用，再恢复原包 source 可启用。

包无依赖／安装脚本，复制到仓库外也可加载。实际两种 CLI 的加载、Skill、九工具、与普通 read/bash 及另一扩展共存、禁用／启用／移除均有测试。OMP、Pi 是不同运行时，MCP 是可选通信协议，Skill 是方法文本；本包不引入 MCP 服务。

## 可组合工具

所有名称前缀为 `workspace_shopify_product_`；闭合 JSON Schema 与 TypeScript 输入在 `src/contracts.*`。

| 后缀 | 输入要点 | 原服务行为 |
| --- | --- | --- |
| `status` | `{}` | 原店铺／connector 配置状态；不核验或授予新权限 |
| `read` | `productId` | 原审核字段、精确 revision、原图片引用、来源 hash |
| `image` | `productId,imageId` | 原 artifact 固定版本／SHA 的真实图片字节，以原生 image block 交给已授权兼容模型 |
| `readiness` | `productId` | 检查原图可读性、原已核验店铺状态、原 connector；`verifiedWrite:false`；不写店铺 |
| `propose` | `productId,sourceHash,requestId,draft` | 将模型正文与显式零售条款保存成**原 supplier 预览**；不新建 Library 产品、不调用店铺 |
| `review` | `serviceId,requestId,action`，publish 另需 `publicationId` | 准备原 draft／publish 操作和原待人工审批，不能批准自己 |
| `execute` | `serviceId,operationId,expectedScopeHash,requestId` | 调用原发布服务，消费原精确人审授权；不确定结果不自动重试 |
| `reconcile` | 同 execute | 原操作的远端只读回查，保存原对账回执；不补写／重建商品 |
| `result` | `serviceId` | 当前原预览、原操作、审批和实际店铺回执；不从模型历史推测成功 |

`draft` 由模型提供 `title,description,targetMarket,currency,retailUnit,unitsPerPack,consumerPrice,handlingDays,shippingDays,skuCode,imageIds`。这是给人审核的商业提案，不是确认事实；不得由工厂 MOQ、批发价、产能推导消费者售价、库存或发货承诺。正文为不超过 4000 字符的单段纯文本，沿原 profile 不接受控制字符；HTML 字符转义后写入 `<p>`，适配器不生成固定销售段落。需要换正文时提交新 requestId 的新提案；本版没有任意富文本、SEO、多变体、旧商品编辑或库存写入工具。

原图只接受原产品已选图片 ID，无 URL／文件路径／任意 artifact 参数。模型图片读取最多 900,000 字节，超限明确拒绝而不缩图；原发布服务自己的上传大小、类型和媒体 READY 检查仍生效。`readiness` 不主动调用 Shopify 核验；未核验／过期会使 `uploadReady:false`。原 `review` 会沿原服务核验店铺和权限。模型需真实支持图片输入；有限测试不证明真实模型视觉质量。

源 hash 证明版本／来源完整性，不证明内容正确、媒体权利或公开披露同意。人工须审查原完整预览及精确 scope。创建 DRAFT 和发布指定渠道分别人审；模型输入无 `approved/confirmed/token/credentials`。可信适配器传入原服务需要的 `confirmed:true` 仅表示将提案提交到原审核机制，不能产生人审决定。

## 原 Host 绑定与启动边界

独立安装不会获得私库或 Shopify 授权。受控原 Host 使用 `WORKSPACE_OMP_PROFILE=shopify-product` 和隔离 scope `omp:18.10.4:shopify-product-v1`。必要接线及完整验收见 [实现说明](../../docs/SHOPIFY-PRODUCT-PLUGIN.md)。

```sh
WORKSPACE_OMP_PROFILE=shopify-product npm run workspace -- --check
WORKSPACE_OMP_PROFILE=shopify-product npm run workspace -- --serve
```

`--check` 不调用模型；无真实配置返回 `unconfigured`。**这些命令本身不设置原资料披露策略。** 当前原企业 Host 必须通过已有 `createApp({libraryModelReadPolicy,businessAgentOptions,...})` 可信配置入口注入经审核的精确产品 revision、允许字段（须显式含 `images`）、成员／workspace、模型接收方与期限，以及原 Session／Agent 绑定。默认 CLI 的 `libraryModelReadPolicy:null` 保持未配置；本包未增加读取环境 JSON、自动审核或新授权页面。已有模型／原预算配置和原 Shopify 授权也必须由原管理设施提供，不能照抄测试凭据或示例许可。

进程内绑定为 `shopifyProductExtension({client,authorize})`。`client` 来自原 Host 的 `createShopifyProductClient`，显式注入原 Store／artifacts／supplierService／supplierPublication／shopify／materialsClient、原身份和 conversationId、逐次 `authorize(signal,model)`、同步拒绝式 `assertCurrent()`、严格布尔 `canSave()`。原 Host 在每次模型调用前对历史 receipt 执行 `client.refresh(receipt,model,signal,nativeImages)`；普通 Pi 安装不会自动建立这一受控 Host，Pi SDK 注入测试仅证明扩展执行契约。禁止在生产用空授权回调替代原服务校验。

实际原审批入口保持 `/api/conversations/:cid/supplier-services/:sid/shopify-decision`，由原已登录人类 Session／CSRF／签名入口提交原 operationId、scopeHash、decision、requestId。模型没有 decision 工具。原 published 回执始终伴随 `acquisition.startedAt:null,launchEvidence:false`，不作为获客、订单、七天开始或收入证据。本版没有售后、外部流量／Ads／MCP 数据源接入。

## 本地合成验收

```sh
node --test test/shopify-product-client.test.mjs test/shopify-product-contracts.test.mjs \
  test/shopify-product-package.test.mjs test/workspace-omp-shopify-product.test.mjs
npm run build
```

实际 SDK、原 Host／Session／Run、原 Library／artifact／Store／审批／发布代码均执行；模型为有限无密钥脚本，Shopify 为只映射至 loopback 的合成 HTTP 服务。真实产品、真实店铺权限、真实媒体托管和真实模型自主判断仍须单独获权验收；本次未执行。固定来源和许可证见 [sources.json](sources.json)。
