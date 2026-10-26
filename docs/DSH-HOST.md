# DSH 宿主与插件开发

本次云端开发使用官方 npm 运行包 `@deepseek-ai/dsh@0.2.1-rc.2`。
官方源码参考固定在 `dsh-v0.2.1-rc.2`（`687f282e`），与已安装运行包一致。
运行时和源码放在仓库外，不把宿主复制回插件源码树。

## 当前云环境

| 路径 | 用途 |
| --- | --- |
| `/workspace/dsh-runtime` | 官方 npm 运行包与依赖 |
| `/workspace/deepseek-harness` | 匹配版本的官方源码，供接口核对 |
| `/workspace/dsh-home` | 开发 profile、原生状态与附件，不进入 Git |
| `/workspace/dsh-setup` | 本机安装／启动／验证辅助，不含源码副本 |

`/workspace/dsh-setup/start.sh` 从插件 checkout 启动原生 `dsh web`，
使用 loopback 3080 端口；插件通过原生 `dsh plugin --profile web add link:<路径>` 安装。
本机 `dsh` 包装命令在 `/workspace/dsh-setup/bin/dsh`。
这只是原生 CLI 的调用方式，没有自建宿主或 Agent Loop。

开发启动不继承模型 Key；安装、挂载、客户端资源、认证和预设检查均无需模型调用。
日志中的启动 token 属于本机认证信息，不放入文档、截图、Git 或对外链接。
`verify.py` 在内存中交换该 token，只输出检查结果。

## 已实测

- 六个 bundle 均 installed／enabled，原生 Loader 对应行均 active。
- 资料库、Space、经营记忆和询盘恢复：认证请求 200，无会话请求 401。
- 四个插件的真实 Client 资源由宿主提供，Chromium 面板正常挂载。
  资料库和 Space 已修复等待 slot 声明的启动顺序问题。
- 隔离 profile 中，原生引用按钮、旧版本芯片、刷新恢复及归档后的发送拦截通过；
  失败发送保留草稿，无模型 prompt 请求。测试数据没有写入开发 profile。
- 资料库与 Space 数据目录遵循原生 `DSH_HOME`；显式 `config.dataDir` 仍优先。
- 原生 Agent preset 列表包含 `sourcing`，没有 broken 诊断。
- Sourcing 已移除自建阶段引擎；六份方法经官方 skill registry 实测注册、按需读取和卸载，
  也可由原生文件发现独立加载。修复注册时缺失 `source` 字段导致目录可见而正文读取失败的问题。
- 四个 Client DOM 冒烟通过；资料库和 Space 使用合成 Host 响应，
  记忆和询盘使用本地 HTTP 与合成 registry / storage。前两个存在 React act 测试警告。
- 官方 Cordis／ToolRuntime／LocalAttachmentStore 中，固定旧版 CSV 的字节、SHA、
  工具渲染输出、哈希错误与取消检查通过，使用临时目录，无模型调用。
- `dsh-workspace-memory` 使用官方 storageDomain / JSON；工具／持久化冒烟通过。
  Chromium 隔离 profile 中，候选、人工审核、跨工作区隔离、来源归档、撤销、刷新后历史通过。
- 隔离 profile 中三个真实模型场景通过：历史文件读取、批准偏好跨会话召回、归档／撤销后停止引用。
  使用合成数据；依据、修复和边界见 [LIVE-ACCEPTANCE.md](LIVE-ACCEPTANCE.md)。
- 产品上下文的官方工具／附件／Web 检查通过；另两个真实模型会话验证单产品历史取材与归档缺口，
  模型原答复仍有文字偏差，见 [PRODUCT-CONTEXT.md](PRODUCT-CONTEXT.md)。
- 询盘恢复的实际 Chromium 文件导入、身份审核、隔离、草稿附件和来源会话跳转通过；
  两个真实模型会话验证自己撰写候选和新修订退订后停止，详见 [插件说明](../integrations/dsh/dsh-inquiry-recovery/README.md)。
- Sourcing skill 化后，隔离真实模型会话只加载 export-supplier 和回复模板即可完成单封草稿，
  工作目录为空，无阶段或业务写入。首次答复曾把未知认证写成否定，修改方法及模板后独立复验保留待确认。
- 浏览器验收不代表完整视觉／主题验收；尚未验证桌面宿主。

Sourcing 的 `workspace-dependencies` 是可选桌面运行时工具。配置遵循官方 SDK
profile 的方式：仅在 `DSH_PRIMARY_RUNTIME` 或 `DSH_BUNDLED_PRIMARY_RUNTIME`
提供实际资源路径时启用。不伪造运行时资源，不把机器路径写死在插件里。

## 继续开发的方式

1. 先在匹配版本的官方源码中核实服务、事件、Client slot 与配置定义。
2. 领域逻辑放在插件或领域包中；工具经 `ctx.tools.register` 注册，贡献经 `ctx.effect` 管理。
3. HTTP 复用 DSH Connection 认证，文件复用原生附件服务，模型执行由原生 Agent 承担。
4. 修改 Host 代码后重载／重启相应插件；修改 Client 后刷新页面并核查资源版本。
5. 运行核心／DOM 回归，再通过原生插件管理器、认证接口及预设列表验收挂载。

资料引用使用原生 `inputTriggers`、`uiSession` 和 `conversation.input.left`，按钮在新对话和已有对话中共用。
发送前只校验版本元数据，正文由 `workspace_library_references` 通过原生附件服务读取。
原生输入框负责芯片、草稿恢复、序列化和取消；插件不另存一套会话或运行循环。
真实模型验收通过原生会话记录核实使用情况；开发启动不因此启用模型调用。

经营记忆的本地安装需要先在 checkout 根目录 `npm ci --ignore-scripts`，由 npm workspaces
连接 `@workspace/domain-business-memory`；然后安装 `integrations/dsh/dsh-workspace-memory`。
该 native bundle 的业务状态保存在宿主存储 domain 中，不创建独立 JSON 后端或服务。

官方参考：[CLI](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/apps/cli/README.md)、
[插件管理](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/boot/plugin-manager/README.md)。

简易 ERP 已作为第六个 bundle 安装并检查原生 Loader active。数据在 `$DSH_HOME/data/mini-erp/erp.sqlite`，开发 profile 不写入测试订单；官方 ToolRuntime 验收使用独立临时数据库和夹具会话。无需 Client 面板或单独服务。
