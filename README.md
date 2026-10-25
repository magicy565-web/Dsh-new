# Workspace · DeepSeek Harness 插件

本项目以 **DeepSeek Harness（DSH）为唯一的后续 Agent 执行宿主**。
会话、模型、工具循环、取消和定时唤醒复用 DSH；本仓库维护工作空间与业务插件。

2026-10-26 已移除独立 Workspace Harness 工作台，包括自建内核、能力接缝、
8790 服务、专属页面、安装器和依赖它的 HTTP 桥接。具体范围见
[删除记录](docs/DSH-MIGRATION-20261026.md)。

## 原生插件

| 目录 | 功能 |
| --- | --- |
| `integrations/dsh/dsh-workspace-library` | 企业／产品资料、文件、图片、固定版本及人工审核 |
| `integrations/dsh/dsh-space-workspace` | Space 页面、内容编辑、分享与评论记录 |
| `integrations/dsh/dsh-sourcing-agent` | 可选的获客业务 Agent、业务规则和交付物 |

在 DSH 中使用 `plugin_manager install_bundle target=<插件绝对目录>` 安装。
运行 `npm start` 可显示当前 checkout 的三个安装位置；该命令不会启动另一套服务。
原生宿主及其 profile 由 DSH 管理，不通过根目录的 npm 命令安装或修改。
安装后的重载与界面刷新方式见各插件 README。

## 本地验证

需要 Node.js 24+；以下验证不安装依赖、不读取模型凭据、不调用收费模型：

```sh
npm run build   # 原生 bundle 入口、JS 语法、资料库中英文字典
npm test        # 三个原生插件及保留的领域逻辑回归
```

插件的浏览器交互与真实 DSH 挂载需要单独验证；本地测试不能替代它们。
Sourcing 的固定业务阶段只是可选业务插件，不是通用 Agent 的底座要求。

## 可复用领域与历史代码

- `packages/domain-business-memory`：记忆候选、人工审核、来源与上下文编译。
- `packages/domain-product-library`：产品上下文固定、引用、版本与 Medusa 只读来源。
- `packages/domain-inquiry-recovery`：已有询盘领域逻辑。

前两个领域保留原数据键与回归测试，**尚未接成新的 DSH 工具或页面**。
旧的经营记忆／产品库 HTTP 桥接已删除，不能继续依赖已退役的 8790 服务。

`server/`、`src/`、`pi/`、`tui/`、其他既有业务插件和 Medusa 项目保留为既有代码及迁移来源，
不作为新的默认 Agent 宿主。它们的历史验证与部署记录不代表当前 DSH 版本已验收。
本次不删除用户的本机资料、会话、附件、已安装应用或服务器数据，也不改写 Git 历史。
