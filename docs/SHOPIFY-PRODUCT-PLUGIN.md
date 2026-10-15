# Shopify 商品上传独立插件实施交付（2026-10-15）

基线：PR80 `8eb33701bb5f70be74e5285c7c864b248d79be3b`。分支：`codex/shopify-product-plugin-20261015`。首个单规格版本固定在 `1d703db12089a5763d9856bce4284c8745130a6b`；当前 **0.2.0 增加多规格上传，见 [更新说明与最新验收](validation/shopify-product-variants-20261015/README.md)**。这是上传工具包实现与合成工程验收，不是旧研究提交或完整代运营实现。未合并 main、部署、调用真实店铺／模型／Ads、创建或修改真实凭据／权限。

实现文件为 [独立包](../packages/workspace-shopify-product/README.md) 和 [原 Host client](../server/shopify-product-client.mjs)。依赖已有商品／图片；不重复 E 的资料识别或建档。九个工具可由模型自由选择，Skill 提供方法；没有新 Agent Loop、工作流引擎、任务注册表、审批系统或预算账本。

## 原服务唯一归属与必要共享改动

| 原位置 | 原上传包接线及必要性（多规格增量另见最新验收） |
| --- | --- |
| `factory-materials-read.mjs`、`workspace-procurement/src/workspace-factory-materials-client.mjs` | 增加 **opt-in** `images` 字段与闭合引用校验；原产品 revision／artifact version／SHA 不变，不扩大现有审核策略 |
| `library-model-read.mjs` | 进程内同步 authority fence，重用原 live Session、成员／workspace、模型接收方和期限；用于原 Store 提交时防止异步间隙越权 |
| `supplier-service.mjs` | 进程内 `proposeProduct` 将模型纯文本和零售提案保存到原 supplier row／commands。source/productReference 关联现有 Library 产品，不再保存一份产品目录；沿原限额／幂等 |
| `supplier-draft.mjs`、`supplier-publication.mjs`、`shopify-publication.mjs` | 仅 source-linked 新提案 opt-in 原产品 revision／图片 fence；旧 supplier 记录不迁移。原人审／执行及每个原写步骤核对原 source，变化则拒绝继续 |
| `pi-business-agent.mjs`、`index.mjs` | 原 Host 注入已有 supplier、publication、shopify 服务；检查原 Run 执行意图、原 owner 和 exact model。没原资料策略就明确未配置 |
| OMP bridge／worker／session | 新隔离 scope；fd3 映射九个薄方法＋refresh，原信号传递。OMP 持有工具循环和 journal；不开放 shell／public search／旧 generic business RPC |
| Host／launcher／terminal allowlists | 新 `shopify-product` 选项，防止历史其他 profile 的会话静默迁入；原端口／进程／Session 协议不变 |
| `test/fixtures/pi-task-helpers.mjs` | 仅测试注入原 createApp 的本地 synthetic Shopify fetch/environment，用于真实原应用验收；不改生产默认配置 |

商品创建、图片 staged upload、媒体就绪、单/多变体价／SKU、DRAFT／ACTIVE／Publication、写后回查都由原 publisher 实现；本包没有添加 GraphQL 连接器或新的 Admin 查询。原 API 固定 `2026-10`，没有自动换成 latest。执行仍需原 host 写入 flag、已启用的原 connector、已核验 scope 和精确已批准操作同时满足；本包不启用生产 connector。

## 配置、原审批和状态语义

包的安装／卸载与 Host 的授予权限是独立边界。安装步骤见 README。原 Host 显式 `createApp` 审核配置入口为必要依赖：成员、企业、接收模型、到期、产品 revision 和公开字段必须已有授权，图片字段必须显式选择。默认 CLI 不加载该策略，因此仅 `--serve` 不会变成可读私库。`--check` 验运行器／绑定配置，不证明 shop 或产品权限。无配置应看见 `unconfigured`，不能伪装为空目录或真实零销售。

模型只提交自己的 `draft`，不能确认自己的正文、报价、图片权利或发货承诺。sourceHash 包含实际原 product projection／sources／authorization；不代替原人审。原 service 中预览完整保留模型单段纯文本，转义 HTML，不再套用旧固定零售段落。模型可只读取后回答／追问，不必须保存；已存在的服务可直接查询或准备原审核。

`review` 只创建原待审批动作。人类经原 Session 路由 `/api/conversations/:cid/supplier-services/:sid/shopify-decision` 作决定；普通 generic approval 状态不取代 supplier operation 的原决定。创建 Shopify 草稿和发布指定渠道各有一次独立 scope／人审。`execute` 沿原 capabilities 执行，只消费对应原批准；原 requestId、operationId、scopeHash 保持。`result` 返回真实原状态；uncertain／partial 保留为错误状态，不能改报成功。`reconcile` 只回查同一个原操作，不隐含重试／修复。

每次模型披露前重新读取原状态，核对 source／authorization／图片 bytes，对 mutable 旧 view 重建。相同 selector 只在**当前一次披露边界**去重，不能跨模型调用缓存许可；未知 receipt 字段、伪造来源、错误原图或私有数据选择均拒绝。原操作的权威结果始终在原 Store，而不在模型 journal。

## 七天验证、E 与后续范围

E 管原资料进入 Library。本包消费原产品和图，不识别新产品。商品草稿／发布归原 supplier publication，七天验证包只能引用原对象与明确外部曝光证据。所有本包回执 `acquisition:{startedAt:null,launchEvidence:false}`；不启动 monitor／Goal／schedule，不生成 LaunchReceipt，不把上架冒充真实营销启动。外部数据 MCP 等用户日后提供再接入，本版不做连接。

当前版本已支持原 SKU 的明确多规格组合；不含库存、订单售后、营销发布、广告、价格批量维护、任意文件上传、富文本编辑器或持久通知。新提案是原 supplier row，而非对已发布商品的任意编辑工具。变更原资料会使旧 source-linked 提案不可执行；需原资料重审和新的提案／审批，不能覆盖原回执。

## 可复核验收与限制

完整命令、通过结果和环境版本见 [验收记录](validation/shopify-product-plugin-20261015/README.md)。测试运行真实 Pi 1.1.0、OMP 18.10.4／Bun 1.3.14、原 Node Host 和原业务服务。模型响应及选择是有限脚本，Shopify 是显式本地 HTTP fixture；这证明 dispatch、来源／权限／幂等／原审批／持久化接线，不证明真实模型理解能力、商品质量或真实店铺媒体托管。

测试在原每分钟 240 请求限制下快速执行多轮重授权会触及限额；端到端 fixture 在轮次之间推进原测试时钟 61 秒模拟人工审核间隔，没有修改生产限流或隐藏自动 retry。原限流错误仍可拒绝过快请求。原资料权限过期、店铺核验 TTL 过期以及 Session 失效仍按原机制处理。

真实验收尚未执行：经原管理员配置的企业 Session／Library policy、支持图片的精确真实模型及原预算、真实授权开发店；真实图片 READY、DRAFT 和指定 Publication 回读；真实断连与限流；人工内容、价格和媒体权利审查。后续需用户明确授权，不得把本次模拟 PNG／合成 token／脚本答案当真实业务结果。
