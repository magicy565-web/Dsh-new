# Workspace · DeepSeek Harness 插件

本仓库只维护 **DeepSeek Harness（DSH）原生插件和可复用领域逻辑**。
Agent 执行、模型、会话、工具循环和取消由 DSH 宿主负责。

## 目录

```text
integrations/dsh/   五个可安装的原生插件
packages/          三个宿主无关的领域包
scripts/           安装位置提示、静态检查、回归测试
.github/           DSH 检查工作流
docs/              当前开发约定与清理记录
licenses/          第三方许可
```

| 插件 | 能力 |
| --- | --- |
| [dsh-workspace-library](integrations/dsh/dsh-workspace-library/README.md) | 企业／产品资料、版本审核、产品上下文与缺口、原生对话引用和确切版本读取 |
| [dsh-space-workspace](integrations/dsh/dsh-space-workspace/README.md) | Space 页面、分享、评论及任务设置记录 |
| [dsh-sourcing-agent](integrations/dsh/dsh-sourcing-agent/README.md) | 可选的获客业务方法、规则和交付物 |
| [dsh-workspace-memory](integrations/dsh/dsh-workspace-memory/README.md) | 经营记忆、人工审核、来源核验，以及跨已有资料／记忆／询盘的只读检索 |
| [dsh-inquiry-recovery](integrations/dsh/dsh-inquiry-recovery/README.md) | 可选历史询盘：原文件核验、人工身份判断、Agent 撰写的未发送草稿 |

在 DSH 中执行 `plugin_manager install_bundle target=<插件绝对目录>` 安装。
`npm start` 只显示当前 checkout 的五个安装位置，不启动服务或修改 profile。

## 验证

Node.js 24+。首次设置先安装锁定依赖和本地 workspace 领域包链接：

```sh
npm ci --ignore-scripts
npm run check
```

等价于 `npm run build`（入口／JS 语法／字典）和 `npm test`（原生插件及领域回归）。
可选 Client DOM 冒烟复用根目录锁定的开发依赖：

```sh
npm run test:client
```

React、React DOM、jsdom 只用于开发测试；插件运行时复用 DSH 提供的 React。
DOM 冒烟与本地 Host 测试均不能替代真实 DSH 挂载和浏览器验收。

## 领域包

| 包 | 当前用途 |
| --- | --- |
| [domain-business-memory](packages/domain-business-memory/README.md) | 记忆候选、人工审核、来源、召回与上下文 |
| [domain-product-library](packages/domain-product-library/README.md) | 产品上下文、引用、版本、Medusa 只读来源 |
| [domain-inquiry-recovery](packages/domain-inquiry-recovery/README.md) | 历史询盘的来源校验、人工判断和未发送草稿 |

经营记忆与询盘恢复已通过原生插件接入，复用 DSH 的 storageDomain、工作区、会话、附件和工具服务；
Medusa 产品领域包仍待接入，本地产品上下文已由资料库提供。没有自动读取或迁移旧工作台数据。
Sourcing 的业务阶段只属于可选业务插件，不是通用 Agent 的强制流程。

开发入口见 [开发约定](docs/DEVELOPMENT.md)，原生安装与接入见 [DSH 宿主](docs/DSH-HOST.md)，
验证边界见 [VALIDATION](VALIDATION.md)，指定场景的真实模型验收见 [验收记录](docs/LIVE-ACCEPTANCE.md)。
旧应用、其他执行器、独立 Medusa 项目和历史发布包已移出当前源码树；
需要旧实现时从 Git 历史查找，见 [清理记录](docs/DSH-MIGRATION-20261026.md)。
