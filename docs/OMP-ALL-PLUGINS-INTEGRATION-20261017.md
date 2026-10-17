# 2026-10-17 插件源码整合验收

本次为私有开发分支源码验收，不是上线或真实服务验收。目标分支为 `codex/omp-all-plugins-integration-20261017`；明确交接基线为 `f436123bf199b0308708594cc5660ce98d981f5f`，继承 `codex/omp-structured-memory-integration-20261016`，没有从 main 重做。开始阶段只读；收到旧 writer 已退出、无未提交改动的交接确认后才切分支写入。截止为 2026-10-17 04:00 UTC / 北京时间 12:00。

当前范围：14 个 OMP 插件源码统一放在 `plugins/`，均经过固定版本原生 loader 发现、编译、注册和 pack 闭包检查。业务组合 profile 已使资料读取、七天、Shopify、Medusa Library 草稿预览、Brain 在同一原生 OMP Session 中使用原 Host 客户端。**没有宣称 14 个业务插件全部完成同会话真实服务接通**：其余原有隔离 profile 保留；Marketplace 的私有模型披露桥仍未接入。默认本地入口仍仅启用 local-materials。

## 源码来源与选择

| 来源 | 当前处理 |
| --- | --- |
| PR87/93 资料库、PR89 外贸 | 保留交接基线中的选择性整合、原 OMP/Session/来源 proof 与授权链。未重新覆盖。 |
| PR80 `6d1d1175` 七天 | 基线已包含最新插件源码；新增可信 Host 组合接入，保留原计划/监测服务。 |
| PR81 `f6fa3c5a` Shopify | 基线已包含最新业务源码；保留其后 variant-set、unitBasis、净支付/退款范围检查。新增同 Session 绑定。 |
| PR82 `5f79eeab` Muse | 选择性移植 cancel_requested inbox、过期 attempt 显式 operator quarantine、只读探针 owner pin。保留较新 agentKind、museTasks/dotTasks 分队列与桥协议，未整包覆盖。 |
| PR83 `062ead7a` Marketplace | 21 项增量中导入 17 项源码/测试/设计文件；4 项历史 validation 输出不作为本次证据、不导入运行资料。插件从 packages 移到 plugins 并修正源码引用。 |
| PR92 `09f356ed` Medusa Library 草稿 | 导入原 Library 受限投影服务、HTTP/UI、插件和测试；通过原材料客户端、授权选择、原 fd3 接入 OMP。未复制旧 Session/profile 实现。 |
| PR94 `e3109b0` Medusa 产品管理 | 导入独立产品管理前端、Product Context Medusa 插件、smoke 源码。修复 collection_id/sales_channels 无损编辑，未自动部署/连接。 |
| PR95 `49ac0834` Brain | 以较新核心、脉搏卡片、UI、Host/Artifact/HTTP 为主；保留基线 enterpriseDisclosure/enterpriseMemory/factoryDocumentForSession。修复原 Host 写操作分类及接收者匹配。 |
| PR90 `594b32a` Brain | 选择性补充 inquiry/product/composite 来源适配器及测试和操作级 Artifact admission。未覆盖 PR95 核心/UI；默认仍用 PR95 组合来源。可选 PR90 窗口按小时固定，避免每次 Date.now 使 list/read/current 自相矛盾。 |

上游说明中的“完成”“proof”“旧分支”是历史记录，不能替代本次实际源码和执行结果。

## 插件验收矩阵

下表所有 14 行都完成 manifest、原 OMP 18.10.4 编译/发现/注册、独立 pack 闭包；完整逐包 disable/物理 uninstall 回归另见执行结果。普通安装本身不会授予私有 Host 权限。“替身”仅指明确有限模型和合成业务传输，OMP SDK、Session、原 Store、原 Host 路由在相应集成测试中真实执行。

| 插件 | 默认加载 | Host 绑定与组合状态 | SDK/本地证据 | 真实外部状态 |
| --- | --- | --- | --- | --- |
| workspace-local-materials | 启用 | 保留原本地文件精确选择入口 | 原 SDK 本地 Session、预算、wire、来源回归 | 模型 unconfigured |
| workspace-plugin-info | 禁用 | 普通身份工具，无业务权限 | 原 loader/lifecycle | 不适用 |
| workspace-procurement | 禁用 | 保留原 Workspace Host/公开与人工执行门 | 原工具注册、现有包闭包 | 业务 Host 未配置 |
| workspace-factory-materials | 禁用 | 新 business profile 原签名 Session + Library 精确版本字段策略 | 同 Session 资料/七天/Shopify；来源变更与最终交付拒绝 | 原企业配置 unconfigured |
| workspace-factory-customers | 禁用 | 保留原 Host/profile，未塞进私有 business profile | 原 OMP 客户回归 | 搜索/企业服务 unconfigured |
| workspace-factory-inquiries | 禁用 | 保留原材料+询盘 Host/profile | 原 OMP 询盘回归 | 企业服务 unconfigured |
| workspace-factory-ingestion | 禁用 | 保留原 intake 选择和写入门，未与 business profile 混用 | loader/pack；本轮不作新增入库功能完成声明 | unconfigured；未运行真实资料入库 |
| workspace-enterprise-context | 禁用 | 原独立企业上下文 Host、Docling/来源 proof、结构化记忆 | 原 SDK、真实 Store、撤权/恢复/最终 wire 回归；Docling/FGA 替身 | Docling/FGA unconfigured；Mem0 向量关闭 |
| workspace-free-trade | 禁用 | 原隔离外贸 Host/原签名披露，未与私有 business profile 混用 | 原 loader/pack；继承已有实现，另列本轮聚焦回归 | ERPNext/真实招标服务 unconfigured |
| workspace-market-validation | 禁用 | business profile 使用原 plan/monitor 客户端，和 Shopify 并存 | 原 SDK 同会话；计划/监测/Shopify 范围替身测试 | Shopify/广告/投放 unconfigured |
| workspace-shopify-product | 禁用 | business profile 使用原来源、人工审批、Connector 和执行服务 | 原 SDK 1/4/100 规格、源变更、恢复、禁用；本地 Shopify 替身 | 真实 Shopify unconfigured |
| workspace-medusa-catalog | 禁用 | business profile 使用原材料选择+Medusa 客户端；模型工具只读 | 原 SDK preview；HTTP/投影替身；篡改回执阻断 | Medusa unconfigured；未运行 live smoke |
| workspace-goal-intelligence | 禁用 | business profile 原签名 Session/接收者/Library/Artifact，显式 goalBrainOptions 才绑定 | 原 SDK source catalog；来源变更/禁用/伪造 gap 阻断；Brain 来源与人审测试 | 业务模型/真实指标未连接；没有自动授权 Goal |
| workspace-marketplace | 禁用 | 原服务器 mount 源码与原 Store/WorkerDesk 接口；**尚无可信私有模型披露桥，不加入 business profile** | 原 Host、磁盘 Store、Artifact 字节、冷启动；支付/Worker 替身 | Stripe/外部 Worker/Provider 身份 unconfigured |

组合入口：`npm run workspace -- --profile business --check` 只检查固定运行时与清单，返回 unconfigured，零模型请求、零凭据读取、不开服务器。`--profile business --serve` 是显式进入原 Workspace Host 的启动路径，需要已有审核配置与签名 Session；本次没有执行此命令。测试中的 createApp 使用合成配置和临时目录，未创建实际业务配置。

## 授权和来源边界

没有增加 AgentLoop、业务数据库、队列或权限系统。模型/工具循环仍由原 OMP SDK 管理；业务写入仍走原 Run、Store、Artifact、Library 与人工审批。新 Host 能力通过原事件绑定和原私有 fd3 传输，模型参数不能指定身份、接收者或授权策略。

业务 profile 的旧 transcript 必须保留工具来源和当前授权。Brain 注册原 Session disclosure guard；禁用后不能恢复依赖其私有来源的旧会话。Medusa preview 必须重建为相同受限投影。Worker 正常退出后，Node 最终交付读取其原受控 journal 并再次用原客户端验证；这不是模型自报 citation 清单。伪造 Medusa view、伪造 Brain gap 附加正文、源变化、旧 guarded history 在插件禁用后恢复都拒绝进入下一次模型请求。无真实模型或外部业务请求。

结构化记忆增加两个原 Store 确定性回归：激活事务已更新 draft 但仍在落盘队列时发起撤权，必须以撤权事务中的最新 disclosureGrantId 清理外部 grant；历史 grant 替换清理返回 syncError 时必须使新记忆 sync_error 并撤销新 grant。首次回归在修复前可复现失败；修复使用原串行 Store 事务，不增加锁/队列/权限缓存。重复撤权可重试幂等外部清理。真实 OpenFGA 未连接。

## Medusa 数据权威与编辑

PR92：原 Library 是资料权威，Medusa 仅为内部 draft 的受限 title/description 投影。显式人工确认、精确 revision/sourceHash、单企业绑定后才可新建；远程已改写/已发布/外来归属拒绝盲覆盖。模型插件仅有 status/preview/reconcile，没有保存、发布或库存写工具。

PR94：Medusa 原生 Product/Variant/Option/Collection/SalesChannel/Inventory 是独立产品管理权威；Product Context 是它自身的扩展资料。没有自动反写 Library，没有双向同步。它的独立 Agent token 读取面**未映射成原 OMP 权限**，不能用该 token 证明原 Session 的模型披露授权。

`normalizeProduct` 保留 collection_id/sales_channels；`productEditPayload` 仅提交实际改动。读取投影缺少字段时省略写入；显式 null/[] 才代表清空。未修改规格不重写；单规格编辑仅发改动字段，不制造零价格或重置未读取的库存策略。smoke 的缺种子路径已改为 `ok:false` + `unconfigured`，不再将 skipped 计作 pass；本次未运行真实 smoke。

## 执行结果与复现

使用 Node 24.19.0、固定 Bun 1.3.14、OMP 18.10.4。依赖安装禁用 lifecycle scripts，测试清空业务环境，仅本地临时文件与 loopback 合成端点。执行日志保留在忽略的 `evidence/`，不把运行资料、真实凭据或会话落入源码。

截至 03:41 UTC 已完成（各套件有交集，不将它们相加冒充独立总数）：

| 执行组 | 结果 | 忽略目录中的本地日志 |
| --- | --- | --- |
| 原有 OMP/企业授权/Library/Store/结构化记忆 33 文件 | 339 passed，0 failed，0 skipped | integration-original-regression.tap |
| 新候选源码功能 + 统一入口 | 286 passed，0 failed，0 skipped；包含 HTTP 修正和两个时钟推进回归 | integration-candidates-source-final.tap |
| 七天/Shopify 专项 | 142 passed，0 failed，0 skipped | integration-shopify-seven-day.tap |
| 外贸/入库包/原采购包 | 122 passed，0 failed，0 skipped | integration-remaining-plugins.tap |
| 新同 Session 业务 Host | 8 passed，0 failed，0 skipped：7 项功能检查 + 1 项已知 Brain 连续写入阻塞复现；后者不是完成验收 | integration-business-host-final.tap |
| Marketplace 原 Host 冷启动 | 1 passed，0 failed，0 skipped | integration-marketplace-original-host.tap |
| 原会话/Muse/采购 DOM，含新增 Brain 无配置页 | 18 passed，0 failed，0 skipped | integration-conversation-dom-final.tap |
| Medusa 后端编译产物 + 实际 SDK 契约 | 4 passed，0 failed，0 skipped；持久层为明确单元替身 | integration-medusa-plugin-contracts.tap |
| OMP build/pack + native loader | 14 个插件通过，0 业务工具执行、0 模型调用 | integration-build-omp-final.log |
| 根前端、Medusa 独立前端、Medusa 后端插件 | 全部构建通过；根前端存在既有大 chunk 提示 | integration-build-web-final.log / integration-medusa-app-build-final.log / integration-medusa-plugin-contracts.tap |

Medusa 后端真实编译检查暴露并修复了缺失 tsconfig/构建依赖、CJS 输出兼容、Service 注入类型、JSON evidence 数组类型和 linkable 命名；补充双向**只读关系查询**，不是双向写入同步。已用实际 Medusa 2.21.2 SDK 加载 link 注册并核对 `product_id -> product.id`，没有启动服务或数据库。

Brain UI 保留 `/home` 独立经营页和导航；默认 `/` 仍进入原会话。移除上游首页自动建会话行为，无配置时明确展示尚未配置，不制造建议或执行。

复现命令示例（在隔离测试环境中运行）：

```sh
npm ci --ignore-scripts
npm run build:omp
npm run build:web
node --test --test-concurrency=1 test/workspace-omp-business-integration.test.mjs
node --test acceptance/marketplace-original-host.mjs
node --test --test-concurrency=1 test/goal-brain*.test.mjs test/business-brain*.test.mjs test/business-signals.test.mjs test/decision-planner.test.mjs test/dot-worker-bridge.test.mjs test/muse-worker.probe.test.mjs test/muse-worker.http.test.mjs test/marketplace*.test.mjs test/medusa-catalog*.test.mjs test/workspace-omp-unified.test.mjs
node --test --test-isolation=none test/conversation-integration.dom.test.mjs test/muse-conversation-ui.dom.test.mjs test/procurement-conversation-ui.dom.test.mjs
npm --prefix apps/medusa-product-catalog ci --ignore-scripts
npm --prefix apps/medusa-product-catalog run build
npm --prefix packages/medusa-enterprise-product-context ci --ignore-scripts
MEDUSA_DISABLE_TELEMETRY=1 npm --prefix packages/medusa-enterprise-product-context test
```

OMP/Bun 的固定 support 包也须按各自 lockfile `npm ci --ignore-scripts`。没有运行 live smoke；不能把 loader 成功、SDK 替身或 skipped 当作真实连接成功。

源码保存提交：`a996339c79956d14763219b7fd563f0949ee4eed`；[Draft PR #99](https://github.com/magicy565-web/workspace-agent/pull/99) 指向原开发基线分支，无 main 修改。后续收尾提交只补测试和验收说明。无运行正文的测试计数与原日志 SHA256 见 [验证摘要](validation/omp-all-plugins-20261017-summary.json)。

## 仍未完成

- 14 个插件全部同一个私有业务 Session 的可信 Host/披露组合尚未完成；现有 enterprise/free-trade/local/intake 等隔离边界保留。
- Marketplace 私有模型披露桥、统一 UI 导航与原企业 Provider 身份配置未接通；只有显式 mount 源码及原 Host 替身验收。
- Medusa Product Context 后端实际实例、数据库迁移、Agent 读取面与 OMP 授权映射未验收；没有创建或连接实例。
- 真实模型、Docling、FGA、ERPNext、Shopify、Medusa、Stripe、外部 Muse/Worker 全部未配置或未调用。浏览器端完整交互验收未完成；DOM 回归不能替代真实浏览器和真实服务验收。Brain context 连续写入在新 business OMP profile 中存在已复现阻塞：首次原 Artifact 保存成功；第二次修改可已提交到同一 Artifact v2，但原 journal 的旧 context 回执随后失效，Run 拒绝交付。复现用例通过只证明此拒绝和不重复建记录，不能算连续写入完成；不得用新 requestId 自动重试。decision 连续写入仍未完成端到端验收。
- 不修改/合并 main，不强推，不部署，不操作服务器，不付费，不读取/创建真实凭据，不扩大权限，不导入运行资料。
