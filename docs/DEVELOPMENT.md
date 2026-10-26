# 开发约定

当前优先级是范围收敛，依据 [收敛清单](SCOPE-REDUCTION.md) 做减法。
暂停新增业务模块、面板和审批链；既有功能及五插件环境记录不是继续扩建的要求。
Sourcing 试点已删除自建阶段引擎，六份方法改为可独立加载的 skill；资料读取工具与其他模块本轮保留。

本仓库的执行宿主是 DeepSeek Harness。原生插件在 `integrations/dsh/`，
通用领域逻辑在 `packages/domain-*`，不另建 Agent Loop、模型网关、权限系统或工作台服务。

## 当前工作区

- `/workspace/wsa-dev`：`agent/harness-20261023`，当前云端开发目录。
- 其他 checkout 和分支不随本工作区清理而改变。
- 使用显式文件路径提交；发布分支只允许快进，不强推、不重写历史。

## 日常命令

- `npm ci --ignore-scripts`：首次设置的依赖安装和本地 workspace 链接。
- `npm start`：显示八个候选插件的真实安装目录（含独立网站转杂志与可选品牌），不启动另一套应用。
- `npm run build`：原生 bundle 入口、JS 语法、中英文字典。
- `npm test`：原生业务／品牌插件与三个领域包的回归。
- `npm run check`：顺序运行上述静态检查与回归，无模型调用。
- `npm run test:client`：可选 DOM 冒烟，需要先安装根目录锁定的开发依赖。

Client 冒烟默认从本仓库 `node_modules/` 读取 React / React DOM / jsdom，
也可用 `DSH_CLIENT_TEST_MODULES` 指向已安装的测试依赖目录。它不依赖其他旧 checkout。

## 原生接入边界

由用户在 DSH 的 `plugin_manager` 中安装插件。源码更新后按插件 README 重载 Host／刷新界面。
仓库中的安装位置、配置模板和历史测试记录不代表本机插件已加载。
本云环境已安装官方 DSH 0.2.1-rc.2 Web 宿主，六个原生插件已实际挂载；
运行目录、接口与浏览器验收范围见 [DSH-HOST.md](DSH-HOST.md)。
隔离 profile 中的三个真实模型场景见 [LIVE-ACCEPTANCE.md](LIVE-ACCEPTANCE.md)；尚未验证桌面宿主。

经营记忆已通过 `dsh-workspace-memory` 接入原生 storageDomain / 工作区 / 会话和工具。
询盘恢复通过独立可选 bundle 接入同样的原生服务。Medusa 产品领域包仍是待接入资产。
存储、身份、附件、来源审核必须从 DSH 实际接口接入；保留数据键和来源证明，
不把 model 的建议当人工审核。产品资料库仅保留 Medusa 只读适配器，
不再在此仓库维护另一套电商应用。

资料选择／固定版本已接入原生对话：`inputTriggers` 管理引用芯片与发送序列化，
`workspace_library_references` 工具读取确切版本，附件字节由 DSH 原生存储提供。
经营记忆面板提供候选、审核、替换、撤销和来源可用性，模型工具只提供候选／有界召回。
原生对话指针由当前工具执行上下文构建；文档来源复用资料库读取器再次验证。
资料／记忆的三个真实模型场景已通过原生会话记录验收。
本地产品上下文已扩展现有资料库，返回 SKU、供货、固定版本与缺口；
正文仍复用已有原生读取器，见 [PRODUCT-CONTEXT.md](PRODUCT-CONTEXT.md)。
这与保留的 Medusa 产品领域包接入是两件事。
询盘恢复读取原始 CSV／JSON 和确切导入行，身份审核在原生面板进行，Agent 工具只读取和保存自己的未发送草稿。
来源更新会重置身份判断，退订、暂停及不完整证据不能创建新草稿；业务规则只属于此可选插件，
不改变 DSH 的通用执行方式。接口与验证见 [插件说明](../integrations/dsh/dsh-inquiry-recovery/README.md)。

只读 `workspace_context_search` 在经营记忆 bundle 内复用已加载服务，提供分来源的查找入口。
它不复制存储或调度任务；目录命中需要经现有读取器进一步核实，见 [工作区检索](WORKSPACE-SEARCH.md)。

## 不进入源码树的内容

运行数据、真实附件／会话、凭据、构建包、历史截图及交付 ZIP 均留在 Git 外。
旧实现可以从清理前提交恢复，不在当前目录另建 archive 或第二套运行入口。

## 买手微刊模块（用户指定的新范围）

后续开发遵循 [微刊架构边界](BUYER-MAGAZINE-ARCHITECTURE.md)：对话创建；读取用户实际可访问的工作区或工单上传资料；交易由 ERP 承担。无需可视化创建界面，用户随后授权开发本机 mini-erp；工单上传接口仍未接入。

`dsh-buyer-magazine` 是可单独安装的网站转杂志插件，自带 Agent 预设、一个 Skill、四种主题和统一编译器。原十模块 JSON 归一化为同一 Studio schema 的 composition: modules；ERP 提供可选只读输入。Sourcing 复用该包，旧 scripts 路径只转调，重复 Skill 与文档渲染器已移除。数组定义模块选择和顺序，同一类型可用于不同产品。来源读取仍由 Agent 按需使用原生工具完成。见 [统一与独立验收](DSH-MAGAZINE-UNIFICATION.md)。

`test/magazine.test.mjs` 覆盖独立与组合渲染、利润口径、销售来源绑定、权益入口边界、文本转义和重复输出保护。官方 skill 冒烟覆盖新增第七份 Skill。微刊本身不预留供应名额；可选 mini-erp 已提供本机预留和确认工具。外部数据服务和 WorkBuddy 客户端未接入。


## 简易 ERP（用户新增授权范围）

`integrations/dsh/dsh-mini-erp` 使用 Node 24 内置 SQLite 提供三个原生工具，交易记录按实际 DSH 工作区分区。当前后台按 Shopify Admin 收敛为订单、商品、客户和文件；客户支持创建、编辑与订单查看。原供货权益仅保留兼容账本及工具，不再出现在导航或新订单表单，范围见插件 README。单机数据库是本试点的唯一交易账本；内容 Skill 只引用快照，不保存库存或订单副本。

ERP 经营后台已按 [复用设计](ERP-REUSE.md) 关联原库 Product/SKU。商品资料实时读取，交易独立持久化，订单单价不随原库编辑变化。Agent 与认证 HTTP 共用服务，后台复用原有编辑器。开发 profile 无旧业务记录需迁移。supply 快照继续支持微刊模块选配，不新增商品或交易副本。

ERP Admin 完整 UI／UX 包已按用户追加授权完成导航／页面结构，接通已有能力并明确披露未接入服务。安装、版本、截图与打包命令见 [交付说明](ERP-ADMIN-PACKAGE.md)。
