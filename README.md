# Workspace Harness · 本地工作台

2026-10-23 发布线：`release/harness-20261023`。产品主入口是**本地 Harness**：
一个 Node 进程 + 一组接缝 + 一组领域插件 + 自带页面，默认监听
`http://127.0.0.1:8790`。旧的 React 应用（`server/` + `src/`，8787）和 OMP TUI
保留为历史入口与迁移来源，不再是默认路径。

发布说明见 [本地 Harness 工作台发布线](docs/RELEASE-HARNESS-20261023.md)，
验证入口见 [发布闸门](docs/RELEASE-GATE-20261023.md)。

## 一键安装（Windows）

```text
dist/Workspace-Harness-Setup-0.5.0-rc.2.exe          # 浏览器版，24.9 MiB
dist/Workspace-Harness-Desktop-Setup-0.5.0-rc.2.exe  # 桌面版，约 111 MiB
```

- 每用户安装到 `%LOCALAPPDATA%\Programs\WorkspaceHarness`，不需要管理员权限；
- 浏览器版自带 Node 24，双击后打开 `http://127.0.0.1:8790/home`；
- 桌面版自带 Electron 45（Chromium 156 + Node 24.22），独立窗口 + 托盘，
  关窗只隐藏到托盘；
- 可变数据在 `%LOCALAPPDATA%\WorkspaceHarness\data`（升级/卸载保留），
  日志在 `%LOCALAPPDATA%\WorkspaceHarness\logs`；桌面版 Chromium 状态在
  `%LOCALAPPDATA%\WorkspaceHarness\chromium`；
- 安装包只含本地 Harness 工作台，不含 `integrations/dsh/` 的 DSH 桌面插件，
  也不读写 `~/.dsh`。

构建安装包：

```powershell
powershell -ExecutionPolicy Bypass -File installer\build.ps1          # 浏览器版
powershell -ExecutionPolicy Bypass -File installer\build-desktop.ps1  # 桌面版
```

细节与验收命令见 [installer/README.md](installer/README.md)。

## 从源码运行

要求 Node.js 24+，生产依赖只有 `cordis` 与 `yaml`：

```sh
npm install          # 或 pnpm install
node scripts/harness-serve.mjs
```

然后打开 `http://127.0.0.1:8790/home`。组合文件是 `harness.local.yml`，当前挂载
25 个插件：首页、聊天/运行、目标、计划任务、收件箱、运维、市场、产品库、经营记忆、
文件、报价、采购、审批、身份、技能与模型接缝。

模型默认关闭（`llm-bridge.enabled: false`）。需要真实模型时显式配置 provider 与
预算；安装器和默认组合都不创建凭据、不读取账号密钥。

## 验证

```powershell
node scripts/release-check.mjs
```

自动发现全部 `*.test.mjs`，按顺序跑 12 个端到端冒烟（chat、runner、guarded、
schedules、ops、access、factory、procurement、quotes、purchases、quote-tool、
purchase-tool），最后跑 `wh doctor`。详细约束见发布闸门文档。

## 目录

| 路径 | 内容 |
| --- | --- |
| `packages/harness-kernel` | Cordis 引导、组合加载、HTTP、`wh` CLI |
| `packages/harness-seams` | storage / approval / tools / artifacts / audit / skills / workspace / llm |
| `plugins/` | 领域插件与各自的测试、页面、技能 |
| `server/` | 旧应用与迁移来源；Harness 通过 `server/store.mjs` 复用单写者存储 |
| `scripts/` | 启动、冒烟、迁移、发布闸门 |
| `installer/` | 一键安装 exe 的 Inno Setup 脚本、启动器与构建脚本 |
| `integrations/dsh/` | DeepSeek Harness 桌面宿主的三个业务插件源码（独立产品线） |

## 边界

- 单企业、单工作空间、单写者 JSON + 事件表；没有数据库。
- 所有成员共享工作空间数据；写入必须经过明确的角色/审批边界。
- 未挂载的业务插件（Medusa、ERPNext、Shopify 写操作等）不会在默认组合里运行，
  也不宣称可用。
- 本地服务只监听 `127.0.0.1`；没有鉴权时不要暴露到公网。
- 应用不是官方 Muse 产品；真实模型、真实外部服务与生产部署都需要单独验收。

## 历史入口：原生 OMP TUI

以下内容描述 2026-10 早期的 OMP 18.10.4 / Bun 1.3.14 原生 TUI 路径，仅作历史记录，
默认产品已切到上面的本地 Harness：

- `npm run workspace` / `npm start` 仍保留旧的原生 TUI 入口与 `scripts/workspace-omp*.mjs`；
- 默认 TUI 是离线 no-model 预览，不读账号密钥、不调用模型、不保存会话；
- 原生持久会话、真实模型与预算、OMP 锁在云端曾被拒绝，均需单独验收；
- 旧服务只能通过 `npm run legacy:workspace -- --serve` 显式启动。

历史说明：[本轮范围](docs/OMP-UNIFIED-BUILD.md) ·
[插件说明](plugins/README.md) · [原本地会话](docs/WORKSPACE-OMP-LOCAL.md)。
