# Mini ERP

Shopify Admin 风格的 DSH 经营后台与本地交易记录插件。三个 Agent 工具与 DSH 内的 ERP 经营后台共用同一服务；复用现有产品库和资料库，不另建独立应用。

## 已支持

- 商品：显式关联原产品库的 Product + SKU，实时读取名称、规格、MOQ、阶梯报价、图片和资料版本；ERP 单独维护可分配数量。
- 客户：姓名、邮箱、电话、内部备注创建／编辑、按客户读取订单；兼容旧 buyer 标识与联系方式。
- 旧供货权益：保留已有账本和兼容工具；已退出后台导航及新订单表单，冻结扩展。
- 订单：预留商品数量，确认订单，取消尚未确认的预留，按到期时间释放；旧工具仍兼容名额关联。
- SQLite 原子交易、重复请求去重、价格快照、版本冲突检查、工作区隔离和操作来源记录。

商品和资料编辑继续使用 dsh-workspace-library。ERP 以原 product.id + sku.id 关联，不复制附件，也不按名称自动合并；旧 Medusa 产品房间模型不接入。

## 安装和工具

Node 24+，使用内置 `node:sqlite`。商品绑定和报价需要同一宿主安装 dsh-workspace-library；已有订单读取不依赖资料库在线。

```text
plugin_manager install_bundle target=<checkout>/integrations/dsh/dsh-mini-erp
```

| 工具 | 操作 |
| --- | --- |
| mini_erp_read | 当前工作区 product / buyer / offer / order 列表或单条读取 |
| mini_erp_catalog | link_sku / update_stock / add_buyer / update_buyer / add_offer（旧权益） |
| mini_erp_order | reserve / confirm / cancel |

工作区由 DSH 会话归属决定，不接受模型传入另一个 workspaceId。所有写入都要求 requestId；发生不确定结果时用原 requestId 和完全相同的参数重试。返回的 receipt 是历史操作回执，current 才是当前状态，过期回执不会重新预留名额。

列表默认每页 50 条，最多 100 条。hasMore 表示后续仍有记录，将 nextCursor 作为下一次 afterId 继续读取；不把第一页当作全部数据。offer 列表可传 productId，只读取当前工作区指定商品的名额；过滤先于分页。order 列表可用 buyerId 读取该工作区客户的订单。buyer／order 列表支持 q（最多 200 字符），按字面文本搜索后分页。后台 GET /workspaces/:id/overview 返回同一 SQLite 快照中的实际记录数量，不返回虚构销售额。

这些是经营者使用的工具，不是买手公开 API。创建微刊和读取资料本身不授权创建订单或供应权益；写入需要当前用户已有的经营操作授权。原生 DSH 权限机制继续有效。本插件不验证供应合同的法律效力，也不把登记来源自动当作事实审计。

## 数量、价格和状态

`unitPriceMinor` 和 `totalMinor` 使用整数分，支持 USD/EUR/GBP/CNY，例如 1234 表示 12.34。订单 totalMinor 是商品小计（数量 × 单价），不自动加入运费、税费、折扣或付款记录。确认订单不表示收款或发货。

`stockTotal` 是这个 ERP 内商品的累计可分配总量，**包含已经确认销售的数量**，不是仓库现存量。available = stockTotal − 已确认数量 − 未过期预留数量。补充可供应数量时增加 stockTotal；不能把总量调低到已经占用的数量以下。本版不支持仓库盘点、出入库或退货回补。

reserve 按实际 quantity 选择原库阶梯单价并验证 MOQ，要求 expectedRevision 匹配 ERP 数量修订、expectedCatalogRevision 匹配原库商品修订。read 的 quantity 可预览相应报价；未传时按 MOQ 与最低价格档门槛取数量。缺价、询价模式、不支持的币种或非两位小数报价返回 null，禁止生成订单，不按零元处理。原库改价即时影响新的报价，已生成订单金额不变。预留默认为 60 分钟，可指定 1–10080 分钟，且不超过权益的 validUntil。confirm 将预留转为确认订单；cancel 只释放预留。确认后的撤单／退款不在第一版中，不允许静默回退交易。

过期预留立即从 available 和 availableSlots 的计算中排除，不依赖定时器；下一次写入把对应记录标为 expired。读取不会伪造一个尚未执行的交易操作。confirmed 名额持续占用，期限解释以已登记的供应条件为准；validUntil 是接受新预留的截止时间，不是自动撤销已确认合同的日期。

同一个 product / territory / channel 只能登记一个供货权益，区域转换为大写，渠道转换为小写；经营者需使用一致的标识，系统不自动判定 US 与 USA、全国与子区域等语义重叠。权益条款和总量在本版创建后不可编辑。同一买手不能同时持有同一权益的两个有效订单。它是有限供应权益账本，不是法律合同管理器。

## 微刊衔接

Agent 可读取 product 和 offer，将价格及带 asOf 的可用名额快照填入已选模块。source 由经营者提供，不等于系统已打开原文件。报价数据变化后重新读取；渲染 HTML 不触发写入。

用于微刊时，调用 `mini_erp_read`，传 `entity: "supply"`、`id: "商品ID"` 和可选 `offerId`。数量与指定权益来自同一只读 SQLite 快照；商品资料在同一宿主的原库队列中串行读取，避免与编辑交错；未指定权益时返回 offer: null，不自动选择或创建。

buyer-magazine 的 `scripts/from-erp.mjs` 可将该快照转换成明确选中的 product / procurement / exclusive 模块。内部 source 只保留在转换结果的 provenance，公开块引用 ERP 编号、修订和读取时间；只有 blocks 进入 HTML。ERP 登记权益使用 recorded 状态，不能自动当成原始供应方材料已核验。其余模块仍需对应的实际资料。

经营者从 DSH 侧栏 ERP 进入完整后台导航与 43 个页面入口。首页、商品、客户、订单、库存、文件和店铺设置接通已有能力；其他页面明确显示未接入。详见 [插件包](../../../docs/ERP-ADMIN-PACKAGE.md)。商品编辑复用原产品库组件。客户表单可创建和编辑姓名、邮箱、电话与内部备注；详情显示该客户的分页订单，可进入订单详情。订单创建只选择客户、商品、数量与预留时长，不再选择供货名额；详情可确认／取消预留。既有预留没有被重命名为 Shopify 草稿订单，付款／履约和真正的库存模型仍待实现。

客户 API 保留 entity=buyer、add_buyer、buyerId；update_buyer 必须携带 expectedRevision。省略字段保留原值，空字符串清除可选字段；邮箱、电话分别校验，note 最多 2000 字符。原 contact 文本在 legacyContact 中保留，兼容 contact 优先返回 email、phone，再回退原文本；不会自动猜测拆分旧值。备注只作内部数据，不表示营销授权。客户／订单支持当前工作区全量文字搜索后分页；其状态筛选／排序仍作用于当前结果页。商品／文件支持原库全量搜索、筛选、排序和分页，以及当前页所选记录 CSV 导出；库存搜索仅限当前页。详见 [复用设计](../../../docs/ERP-REUSE.md)。

已获授权的名额预留通过 mini_erp_order 完成，返回订单 ID、状态和到期时间。当前没有买手登录、交易网页或公开 URL，因此不要为微刊 actionUrl 编造 ERP 链接；经营者可通过工具或后台创建预留，后台可确认／取消已有预留。

后台仅将已尝试提交的完整命令和 requestId 保存到当前标签页的 sessionStorage，按工作区和操作区分，客户编辑再按客户 ID 区分。网络中断／回执不明时锁定参数，刷新后重新打开相同创建入口或该客户的编辑入口，可重试同一次提交；服务返回原订单的当前状态，不重复预留。明确拒绝后可修改再提交。未提交草稿不保存；关闭标签页或清理浏览器存储后需先核对已有订单，不能依赖该恢复机制。选择器每批读取 50 条并可继续加载。

## 存储与运行范围

默认文件为 `$DSH_HOME/data/mini-erp/erp.sqlite`；兼容 DSH_PROFILE_DIR，未设置时使用 `~/.dsh/data/mini-erp`。config.dataDir 可指定本地目录。SQLite WAL 和 BEGIN IMMEDIATE 保证同一文件的多个本机连接不会超卖。数据库按工作区分区，审计记录绑定宿主会话及 tool-call ID。

资料库为 profile 级单企业数据，ERP 交易按 workspace 分区。经营者显式把 SKU 绑定到某个工作区；同一个原库 SKU 只允许一份 ERP 分配，避免重复计量。工具只读取当前工作区已绑定商品；浏览器的来源选择器对已认证经营者显示企业商品。

数据库 v3 在同一事务内为客户增加 email、phone、note、revision 与客户订单索引，保留原 contact、客户 ID、订单和幂等回执。此前 v1 升级至 v2 只增加关联表，保留订单、回执和原始商品。旧记录标记 legacy-unlinked；用 link_sku 指定原 ledger id、当前 expectedRevision 与不变 stockTotal 才能关联，不自动猜测身份。新业务接口不再提供 add_product / update_product；底层保留其兼容旧记录逻辑，绑定后的交易不能使用旧缓存单价。

仅适用于可信经营者管理的单机、单 DSH Host 进程。原资料库是进程内缓存与串行写入，不支持多个宿主进程共同修改同一 JSON；不要把 SQLite 的跨连接交易保证扩展为跨进程商品资料同步。不同电脑上的数据库不自动同步；不是工单服务器共享账本或多租户买手服务。数据库及 WAL/SHM 是运行数据，不进入 Git。备份应在停止写入并关闭插件后进行；不要在写入时只复制主数据库文件。

尚未接入：用户电脑远程文件、工单上传、支付、财务、物流、买手门户及公网交易链接。

## 验证

```sh
node --test integrations/dsh/dsh-mini-erp/test/*.test.mjs
node integrations/dsh/dsh-mini-erp/dev/client-smoke.mjs
node integrations/dsh/dsh-mini-erp/dev/admin-smoke.mjs
DSH_RUNTIME_DIR=/workspace/dsh-runtime node integrations/dsh/dsh-mini-erp/dev/native-smoke.mjs
```

核心测试包含独立 SQLite 连接并发争抢最后库存／名额、过期释放、幂等、跨工作区拒绝、版本变化和金额计算。官方 ToolRuntime 冒烟通过原生工具登记合成资料、预留、确认及重启读取；会话身份为夹具，不代表真实模型或买手公网验收。

### 界面字体

Admin 使用共享的标题／正文／说明／数字字号角色。Inter Latin variable（Fontsource 5.3.0，原始 WOFF2 子集）内嵌在 Client 中，离线可用；中文由本地系统字体提供。字体授权见 [INTER-OFL.txt](INTER-OFL.txt)，完整层级与验证范围见 [界面设计](../../../docs/ERP-ADMIN-DESIGN.md)。

### Radix UI 开发

界面组件使用 Radix Themes 3.3.0，图标使用 Lucide React 1.61.0。源文件位于 `src/client.js`、`src/theme.css` 与 `src/fonts.css`；不要手改生成的 `client.js`。在仓库根目录执行 `npm ci --ignore-scripts` 后，用 `npm run build:erp-client` 构建原生 Client factory，或执行会自动构建的 `npm run check`。没有独立网页服务器。安装包包含编译后的组件与许可证，运行时不需要 npm 下载或 CDN。

主题 CSS 限定在 ERP 节点；React / ReactDOM 及资料库沿用宿主模块。表单控件通过资料库 1.4.0 的可选 `ui` 适配器传入，保存仍由原编辑器处理。第三方许可见 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。
