# 验证状态

2026-10-27（Asia/Shanghai），原生资料库与 ERP 统一后的累计验证状态：

| 检查 | 结果 |
| --- | --- |
| `npm run build` | 六个原生 bundle 入口、JavaScript 语法、资料库中英文字典通过；记忆／询盘字典与原生合约由核心测试验证 |
| `npm test` | 132/132 项通过，零跳过；新增原库阶梯报价、双修订、历史订单金额、缺价／归档拒绝、SKU 唯一归属、排队取消、v1 关联迁移、HTTP 边界及商品名额过滤分页检查 |
| 本地文档链接／JS 相对导入 | 未发现缺失目标 |
| 根目录 npm 锁文件 | 本地领域包／记忆插件 workspace 链接、锁定 zod 和 Client 测试依赖一致 |
| 原生 DSH 0.2.1-rc.2 | 六个 bundle 已挂载；五个面板的认证接口与 Client 资源通过，Sourcing 预设无 broken 诊断 |
| Sourcing 官方 skill 加载 | 七份方法均可原生注册、按需读取、卸载；标准文件发现也可独立加载，无需自建业务工具或专用预设 |
| Sourcing 真实模型 | 隔离原生会话完成单封询盘草稿，只调用 skill 与模板 read，工作目录为空，无项目／阶段或写入；初次将未知认证写成否定，补强方法及模板后独立复验保留待确认。仅验证该小任务 |
| 买手微刊模块 | 十种模块独立／选配／重排通过，利润计算、销售来源绑定、权益入口和重复文件保护通过；真实 Chromium 检查两种组合在 375/390/768/1440px 无页面横向溢出，目录与来源展开可用。预览为示意资料，未验真实数据接入、供应名额锁定或 WorkBuddy 客户端 |
| 简易 ERP | 官方 ToolRuntime 执行原库 SKU 绑定、买手／供货权益登记、预留、确认及重启读取通过；独立 SQLite 连接争抢最后库存或名额仅一次成功，取消／过期释放、幂等和工作区隔离通过。合成数据及夹具会话，无模型调用；不是付款、买手门户或多机服务验收 |
| ERP 经营后台 | 实际 DSH Web / Chromium 挂载，1440/390px 无页面或 ERP 容器横向溢出；商品列表及嵌入原库编辑器的主辅栏布局通过，创建／编辑留在 ERP 页内；见 [页面对照](docs/ERP-ADMIN-DESIGN.md)。买手登记和订单创建表单也通过桌面／窄屏检查。开发 profile 已通过原生 workspace/create 注册实际仓库目录；无商品、资料或交易，截图保留真实空状态，未创建业务演示数据。未验真实买手交易、桌面宿主或完整主题 |
| ERP → 微刊 | 官方 ToolRuntime 读取同一次供货快照，转换选中的商品／采购条件／权益块并编译 HTML，通过；读取不创建订单，原文件私有引用不进入公开块，权益显示已登记而非已核验，预留及取消后新快照反映变化。合成数据，无模型调用 |
| 官方工具／附件存储 | 固定旧版本 CSV 原字节与 SHA、工具渲染结果、哈希不符、取消均通过；临时数据，无模型调用 |
| Chromium 原生 Client | 隔离 profile：两面板挂载、引用按钮、旧版本芯片、刷新恢复、归档后发送 409 且保留草稿通过；模型 prompt 请求为 0 |
| 经营记忆原生存储／工具 | 官方 ToolRuntime、StorageDomain / JSON、附件存储的候选排除、人工审核、召回、旧来源 SHA、归档排除、重启持久化通过；Agent identity 为测试夹具 |
| 经营记忆 Chromium | 真实 Host 中文档来源提候选、人工通过、工作区隔离、来源归档标记、撤销、刷新后完整历史、未认证 401 通过 |
| 真实 DeepSeek 模型 | 三个独立原生会话、21 次有结果的工具调用；固定历史文件、批准偏好跨会话、归档／撤销后停止引用通过。使用合成数据，浏览器验收操作者批准候选；详见 [验收记录](docs/LIVE-ACCEPTANCE.md) |
| 产品上下文原生工具／Web | 官方 ToolRuntime、原生附件的确切版本读取、归档拒绝、修订保护和取消通过；实际 Web 未认证 401／旧修订拒绝通过 |
| 产品上下文真实模型 | 两个最终独立会话、5 次有结果的只读工具调用；按单产品和历史附件取材、归档后报告缺口。原始答复有个别文字偏差；详见 [范围与结果](docs/PRODUCT-CONTEXT.md) |
| 询盘恢复原生工具／存储 | 官方 ToolRuntime、StorageDomain / JSON、原生附件的原文件／规范化行校验、人工身份边界、Agent 文本候选、重启持久化与退订排除通过；Agent 身份为夹具 |
| 询盘恢复 Chromium | 实际原生面板文件导入、管理员身份判断、工作区隔离、刷新、草稿下载 SHA、原生来源对话跳转和新修订提示通过；合成数据由验收操作者核对，导入／审核阶段模型 prompt 为 0 |
| 询盘恢复真实模型 | 两个独立原生会话、7 次有结果的工具调用；核对询盘及产品后保存模型自己撰写的未发送候选，新修订退订后停止新候选并保留旧历史。工具数据验证通过，文字解释偏差保留在 Git 外验收报告 |
| 草稿内容审阅 | 核心／DOM／官方原生存储检查通过：确切草稿与来源绑定、管理员判断、幂等与冲突、身份／来源变化失效、重启保留、发送授权保持 false。实际 Chromium 验证失效候选禁止通过、记录需修改及刷新保留；本轮不新增模型调用 |
| 工作区检索 | 核心／官方 ToolRuntime 检查通过：三个来源、范围区分、旧版 pin 与读取器衔接、仅召回可用记忆、缺失／失败来源状态、原生取消与归属变化拦截；见 [检索说明](docs/WORKSPACE-SEARCH.md) |
| 工作区检索真实模型 | 隔离 profile 的一个原生会话完成 10 次有结果的只读工具调用；统一发现后使用既有读取器核对来源，全程无写入。合成数据，原始答复保留在 Git 外 |

首次设置运行 `npm ci --ignore-scripts`。`npm run check` 顺序运行静态检查与核心测试。
领域测试使用临时存储、本地合成 HTTP 来源及模拟工具／附件，非真实业务数据。

`npm run test:client` 五个 DOM 冒烟通过；资料库／Space 使用合成 Host 响应，
记忆／询盘使用本地真实 HTTP 与合成 registry / storage；ERP 使用真实临时 SQLite、资料库与 HTTP，验证关联 SKU、报价、嵌入原编辑器修改并保存、未保存时拒绝丢弃、状态筛选／搜索、买手登记、按数量报价与 MOQ／库存拦截、旧报价拒绝、名额预留、回执丢失后刷新恢复同一次请求、确认订单和切换工作区。前两个测试仍存在 React act 警告。
可用 `DSH_RUNTIME_DIR=/workspace/dsh-runtime node integrations/dsh/dsh-workspace-library/dev/native-reference-smoke.mjs`
重复官方工具／附件存储验收；它不验证模型实际引用或会话持久记录。
当前原生 Web 宿主已经实际安装并验证挂载；未验证桌面宿主、完整视觉／主题或生产部署。
`DSH_RUNTIME_DIR=/workspace/dsh-runtime node integrations/dsh/dsh-workspace-memory/dev/native-smoke.mjs`
可重复原生记忆工具／存储验收。
`DSH_RUNTIME_DIR=/workspace/dsh-runtime node integrations/dsh/dsh-inquiry-recovery/dev/native-smoke.mjs`
可重复原生询盘工具／存储验收。记忆与询盘领域已接入，Medusa 产品领域仍待接入。
询盘插件的规则属于可选业务能力，不驱动通用宿主或自动发送；详细边界见 [插件说明](integrations/dsh/dsh-inquiry-recovery/README.md)。
旧 HTTP 桥接的自动记忆注入已移除，当前使用原生工具按需召回。
旧运行层的测试、截图和历史交付记录不作为当前版本的验收依据。

Sourcing 原生 skill 冒烟可重复运行：
`DSH_RUNTIME_DIR=/workspace/dsh-runtime node integrations/dsh/dsh-sourcing-agent/dev/native-smoke.mjs`。
