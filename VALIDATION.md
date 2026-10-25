# 验证状态

2026-10-26，DSH 原生经营记忆接入后：

| 检查 | 结果 |
| --- | --- |
| `npm run build` | 四个原生 bundle 入口、JavaScript 语法、资料库中英文字典通过；记忆字典／slot 合约由核心测试验证 |
| `npm test` | 106/106 项通过，零跳过：四个原生插件及三个领域包 |
| 本地文档链接／JS 相对导入 | 未发现缺失目标 |
| 根目录 npm 锁文件 | 本地领域包／记忆插件 workspace 链接、锁定 zod 和 Client 测试依赖一致 |
| 原生 DSH 0.2.1-rc.2 | 四个 bundle 已挂载；三个面板的认证接口与 Client 资源通过，Sourcing 预设无 broken 诊断 |
| 官方工具／附件存储 | 固定旧版本 CSV 原字节与 SHA、工具渲染结果、哈希不符、取消均通过；临时数据，无模型调用 |
| Chromium 原生 Client | 隔离 profile：两面板挂载、引用按钮、旧版本芯片、刷新恢复、归档后发送 409 且保留草稿通过；模型 prompt 请求为 0 |
| 经营记忆原生存储／工具 | 官方 ToolRuntime、StorageDomain / JSON、附件存储的候选排除、人工审核、召回、旧来源 SHA、归档排除、重启持久化通过；Agent identity 为测试夹具 |
| 经营记忆 Chromium | 真实 Host 中文档来源提候选、人工通过、工作区隔离、来源归档标记、撤销、刷新后完整历史、未认证 401 通过 |

首次设置运行 `npm ci --ignore-scripts`。`npm run check` 顺序运行静态检查与核心测试。
领域测试使用临时存储、本地合成 HTTP 来源及模拟工具／附件，非真实业务数据。

`npm run test:client` 三个 DOM 冒烟通过；资料库／Space 使用合成 Host 响应，
记忆使用本地真实 HTTP 与合成 registry / storage；前两个测试仍存在 React act 警告。
可用 `DSH_RUNTIME_DIR=/workspace/dsh-runtime node integrations/dsh/dsh-workspace-library/dev/native-reference-smoke.mjs`
重复官方工具／附件存储验收；它不验证模型实际引用或会话持久记录。
当前原生 Web 宿主已经实际安装并验证挂载；未验证桌面宿主、真实模型、完整视觉／主题或生产部署。
`DSH_RUNTIME_DIR=/workspace/dsh-runtime node integrations/dsh/dsh-workspace-memory/dev/native-smoke.mjs`
可重复原生记忆工具／存储验收。记忆领域已通过原生适配接入，另外两个领域包仍待接入。
旧 HTTP 桥接的自动记忆注入已移除，当前使用原生工具按需召回。
旧运行层的测试、截图和历史交付记录不作为当前版本的验收依据。
