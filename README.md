# Workspace · DeepSeek Harness 插件

本仓库只维护 **DeepSeek Harness（DSH）原生插件和可复用领域逻辑**。
Agent 执行、模型、会话、工具循环和取消由 DSH 宿主负责。

当前集成交付范围见 [发布说明](docs/COMMERCE-RELEASE.md)。工厂试用重点是海外渠道代运营：沿用 Commerce 1.4.0-rc.2 和独立 Service Billing 0.1.0-rc.2，不扩展新模块，不安装或升级 Mini ERP。

**先看 [工厂试用快速开始](docs/COMMERCE-PILOT-QUICKSTART.md)**：包含 Windows / macOS / Linux 安装、启动、演练提示词和排错步骤。`npm start` 仅打印说明；运行界面由官方 DSH Web 提供。

已完成的业务委托、独立账单和业务推进工作台分别见 [委托验收](docs/COMMERCE-MVP-MANDATES-ACCEPTANCE.md)、[计费说明](docs/SERVICE-BILLING-IMPLEMENTATION.md)、[工作台说明](docs/COMMERCE-BUSINESS-WORKBENCH.md)。下方是已有可选资产，不要求全部安装；旧收敛历史见 [收敛清单](docs/SCOPE-REDUCTION.md)。

## 目录

```text
integrations/dsh/   可选原生业务插件与技能
packages/          宿主无关的领域逻辑与集成契约
scripts/           安装位置提示、静态检查、回归测试
.github/           DSH 检查工作流
docs/              当前开发约定与清理记录
licenses/          第三方许可
```

| 插件 | 能力 |
| --- | --- |
| [dsh-commerce-network](integrations/dsh/dsh-commerce-network/README.md) | 业务委托、画布、工厂业务推进与独立 Worker 委派 |
| [dsh-service-billing](integrations/dsh/dsh-service-billing/README.md) | 独立服务账单与人工收退款对账，不依赖 Mini ERP |
| [dsh-workspace-library](integrations/dsh/dsh-workspace-library/README.md) | 企业／产品资料、版本审核、产品上下文与缺口、原生对话引用和确切版本读取 |
| [dsh-space-workspace](integrations/dsh/dsh-space-workspace/README.md) | Space 页面、分享、评论及任务设置记录 |
| [dsh-sourcing-agent](integrations/dsh/dsh-sourcing-agent/README.md) | 按需市场／供货／品牌 skill；微刊复用独立杂志包 |
| [dsh-buyer-magazine](integrations/dsh/dsh-buyer-magazine/README.md) | 独立网站转杂志 Agent：来源研究、编辑、四种主题、十模块与原生 HTML 交付 |
| [dsh-workspace-memory](integrations/dsh/dsh-workspace-memory/README.md) | 经营记忆、人工审核、来源核验，以及跨已有资料／记忆／询盘的只读检索 |
| [dsh-workspace-brand](integrations/dsh/dsh-workspace-brand/README.md) | 可选原生品牌：侧栏／首页标识与双模式黑白灰主题，保留官方会话与布局 |
| [dsh-mini-erp](integrations/dsh/dsh-mini-erp/README.md) | ERP Admin：完整后台 UI／UX，复用原库与交易账本；[安装与截图](docs/ERP-ADMIN-PACKAGE.md) |
| [dsh-inquiry-recovery](integrations/dsh/dsh-inquiry-recovery/README.md) | 可选历史询盘：原文件核验、人工身份判断、Agent 撰写的未发送草稿 |

使用官方 CLI `dsh plugin --profile web add <安装包.tgz>` 安装到自己选定的 DSH_HOME。
本次只选 Commerce 和 Billing，完整步骤见上方快速开始；`npm start` 不启动服务或修改 profile。

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
Sourcing 已移除自建业务阶段引擎；保留的 skill 可按任务独立使用。

开发入口见 [开发约定](docs/DEVELOPMENT.md)，原生安装与接入见 [DSH 宿主](docs/DSH-HOST.md)，
验证边界见 [VALIDATION](VALIDATION.md)，指定场景的真实模型验收见 [验收记录](docs/LIVE-ACCEPTANCE.md)。
旧应用、其他执行器、独立 Medusa 项目和历史发布包已移出当前源码树；
需要旧实现时从 Git 历史查找，见 [清理记录](docs/DSH-MIGRATION-20261026.md)。
