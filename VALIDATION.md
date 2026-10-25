# 验证状态

2026-10-26，DSH 原生引用接入后：

| 检查 | 结果 |
| --- | --- |
| `npm run build` | 三个原生 bundle 入口、JavaScript 语法、资料库中英文字典通过 |
| `npm test` | 95/95 项通过，零跳过：三个原生插件及三个领域包 |
| 本地文档链接／JS 相对导入 | 未发现缺失目标 |
| 根目录 npm 锁文件 | 与仅含 React／React DOM／jsdom 的开发依赖一致，离线生成 |
| 原生 DSH 0.2.1-rc.2 | 三个 bundle 已挂载，资料库／Space 认证接口与 Client 资源通过，Sourcing 预设无 broken 诊断 |
| 官方工具／附件存储 | 固定旧版本 CSV 原字节与 SHA、工具渲染结果、哈希不符、取消均通过；临时数据，无模型调用 |
| Chromium 原生 Client | 隔离 profile：两面板挂载、引用按钮、旧版本芯片、刷新恢复、归档后发送 409 且保留草稿通过；模型 prompt 请求为 0 |

`npm run check` 顺序运行静态检查与核心测试，只使用 Node.js 24+ 内置模块。
领域测试使用临时存储、本地合成 HTTP 来源及模拟工具／附件，非真实业务数据。

`npm run test:client` 两个 DOM 冒烟通过，使用合成 Host 响应；测试中存在 React act 警告。
可用 `DSH_RUNTIME_DIR=/workspace/dsh-runtime node integrations/dsh/dsh-workspace-library/dev/native-reference-smoke.mjs`
重复官方工具／附件存储验收；它不验证模型实际引用或会话持久记录。
当前原生 Web 宿主已经实际安装并验证挂载；未验证桌面宿主、真实模型、完整视觉／主题或生产部署。
三个领域包尚未装配为新的 DSH 工具／页面；旧 HTTP 桥接的自动记忆注入已移除。
旧运行层的测试、截图和历史交付记录不作为当前版本的验收依据。
