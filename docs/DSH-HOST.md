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

- 三个 bundle 均 installed／enabled，原生 Loader 对应行均 active。
- 资料库和 Space：认证请求 200，无会话请求 401。
- 两个插件的真实 Client 资源由宿主提供。
- 真实 Chromium 中两个 Client 面板正常挂载；已修复等待 slot 声明的启动顺序问题。
- 隔离 profile 中，原生引用按钮、旧版本芯片、刷新恢复及归档后的发送拦截通过；
  失败发送保留草稿，无模型 prompt 请求。测试数据没有写入开发 profile。
- 资料库与 Space 数据目录遵循原生 `DSH_HOME`；显式 `config.dataDir` 仍优先。
- 原生 Agent preset 列表包含 `sourcing`，没有 broken 诊断。
- 两个 Client DOM 冒烟通过，使用合成 Host 响应；存在 React act 测试警告。
- 官方 Cordis／ToolRuntime／LocalAttachmentStore 中，固定旧版 CSV 的字节、SHA、
  工具渲染输出、哈希错误与取消检查通过，使用临时目录，无模型调用。
- 没有运行真实模型任务；浏览器验收仅覆盖实际操作，不代表完整视觉／主题验收。

Sourcing 的 `workspace-dependencies` 是可选桌面运行时工具。配置遵循官方 SDK
profile 的方式：仅在 `DSH_PRIMARY_RUNTIME` 或 `DSH_BUNDLED_PRIMARY_RUNTIME`
提供实际资源路径时启用。不伪造运行时资源，不把机器路径写死在插件里。

## 继续开发的方式

1. 先在匹配版本的官方源码中核实服务、事件、Client slot 与配置定义。
2. 领域逻辑放在插件或领域包中；工具经 `ctx.tools.register` 注册，贡献经 `ctx.effect` 管理。
3. HTTP 复用 DSH Connection 认证，文件复用原生附件服务，模型执行由原生 Agent 承担。
4. 修改 Host 代码后重载／重启相应插件；修改 Client 后刷新页面并核查资源版本。
5. 运行核心／DOM 回归，再通过原生插件管理器、认证接口及预设列表验收挂载。

资料引用使用原生 `inputTriggers` 和 `conversation.input.left`，按钮在新对话和已有对话中共用。
发送前只校验版本元数据，正文由 `workspace_library_references` 通过原生附件服务读取。
原生输入框负责芯片、草稿恢复、序列化和取消；插件不另存一套会话或运行循环。
下一步是在已配置模型的 profile 中验收实际资料使用及原生会话日志。

官方参考：[CLI](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/apps/cli/README.md)、
[插件管理](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/boot/plugin-manager/README.md)。
