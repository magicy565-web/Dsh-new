# 发布线：本地 Harness 工作台（2026-10-23）

分支：`release/harness-20261023`

本文说明这条发布线把目前为止的哪些开发合到了一起、安装包怎么来、验证到什么程度、
还欠什么。历史文档保持原样，本文件是当前发布线的入口。

## 1. 这条分支是什么

`release/harness-20261023` 以 `stack/trunk-20261023`（43 个 harness 迁移提交）为基线，
合入 `codex/business-memory-20261022` 的 4 个经营大脑（Brain）提交，并把 DeepSeek
Harness 桌面宿主的三个插件源码归档到 `integrations/dsh/`。

```text
stack/trunk-20261023                43 commits：kernel/chat/runner/goals/schedules/inbox/
                                    ops/access/artifacts/goals/quotes/purchases/migration
  + business-memory (195e69ad)      4 commits：观察窗口、去重通知、订阅推送
  = release/harness-20261023
      + integrations/dsh/           产品库 / 空间 / 获客 Agent 三个 DSH 插件源码
      + installer/                  一键安装 exe 的构建与启动器
      + docs/                       本文与 release gate 说明
```

合并时唯一的语义冲突在 `server/index.mjs`：主干在 `createRuntime` 上加了
`validateMemory` / `memoryWorkspaceId`，业务线加了 `occurrencePrecondition`
（分析目标只在观察确实变化时才启动）。解决方式是取并集，两边的约束都保留：

- `capabilities` 带 `occurrencePrecondition`；
- `runtime` 带 `validateMemory` 与 `memoryWorkspaceId`。

## 2. 一条命令跑完全部验证

```powershell
node scripts/release-check.mjs
```

它会自动发现全部 `*.test.mjs`，按顺序跑 12 个端到端冒烟（chat、runner、guarded、
schedules、ops、access、factory、procurement、quotes、purchases、quote-tool、
purchase-tool），最后跑 `wh doctor`。每一步继承 stdio，退出码 0 才算通过。
详见 [发布闸门](RELEASE-GATE-20261023.md)。

本分支上的实测结果见第 5 节；失败项会原样保留，不写成“通过”。

## 3. 一键安装包（两个版本）

| | 浏览器版 | 桌面版（完整） |
| --- | --- | --- |
| 产物 | `Workspace-Harness-Setup-0.5.0-rc.2.exe` | `Workspace-Harness-Desktop-Setup-0.5.0-rc.2.exe` |
| 安装包 | 24.9 MiB | 约 111 MiB |
| 安装后 | 约 100 MB | 约 368 MB |
| 界面 | 系统浏览器标签页 | 独立 Electron 窗口 + 托盘 |
| 自带内核 | Node 24（`runtime\node.exe`） | Electron 45（Chromium 156 + Node 24.22） |
| 适合 | 最轻量、机器已有浏览器 | 需要和 DeepSeek Harness 同类的桌面应用体验 |

两个版本共用同一个 `AppId`、安装目录和 `%LOCALAPPDATA%\WorkspaceHarness` 数据目录；
安装桌面版会替换浏览器版的顶层文件，`data` / `logs` 保留。

### 浏览器版

安装器行为：

| 项 | 值 |
| --- | --- |
| 安装位置 | `%LOCALAPPDATA%\Programs\WorkspaceHarness`（每用户，不需要管理员） |
| 运行时 | 自带 Node 24（`runtime\node.exe`），机器不必预装 Node |
| 依赖 | `cordis@4.0.0-rc.11`、`yaml@2.9.1`，pnpm hoisted 布局（真实文件，无符号链接） |
| 入口 | 开始菜单 / 桌面快捷方式 `WorkspaceHarness.exe` |
| 启动 | 后台起服务，等待 8790 就绪，打开 `http://127.0.0.1:8790/home` |
| 停止 | 开始菜单「停止 Workspace Harness 服务」，或 `WorkspaceHarness.exe --stop` |
| 数据 | `%LOCALAPPDATA%\WorkspaceHarness\data`（升级/卸载保留） |
| 日志 | `%LOCALAPPDATA%\WorkspaceHarness\logs\server.log`、`launcher.log` |
| 组合 | 启动时按安装目录 `harness.local.yml` 生成用户组合，仅把 storage 指向数据目录 |

### 桌面版（完整）

| 项 | 值 |
| --- | --- |
| 界面 | Electron 45 独立窗口，默认 1440×920，自带 Chromium 156 |
| 服务 | 同一个 Harness 跑在 Electron 内嵌 Node 24.22（`ELECTRON_RUN_AS_NODE`），不再附带第二份 Node |
| 托盘 | 打开 / 浏览器打开 / 停止本地服务 / 退出；关窗只隐藏，不退出 |
| 停止 | 托盘「停止本地服务」，或 `WorkspaceHarness.exe --stop` |
| 数据 | 同浏览器版；Chromium 状态在 `%LOCALAPPDATA%\WorkspaceHarness\chromium` |
| 卸载 | 先杀窗口进程，再按 `server.pid` 精确停服务，不会误杀其他 `node.exe` |

构建：

```powershell
powershell -ExecutionPolicy Bypass -File installer\build.ps1          # 浏览器版
powershell -ExecutionPolicy Bypass -File installer\build-desktop.ps1  # 桌面版
```

脚本会缺什么补什么：Node/pnpm 取本机 DSH 运行时（可用参数覆盖），Electron 从官方
release 或 npmmirror 镜像下载并缓存，Inno Setup 6 未安装时按当前用户静默安装。
产物和 SHA-256 打印在最后，同时写 `dist\SHA256SUMS.txt` / `dist\SHA256SUMS-desktop.txt`。

## 4. 包含的能力（安装后可见）

| 页面 / 接口 | 能力 | 来源 |
| --- | --- | --- |
| `/home` | 工作台首页、各区域入口 | `workspace-home` |
| `/chat` | 会话、消息、SSE 流式、人工审批卡片、附件 | `workspace-chat` + `workspace-runner` |
| `/goals` | 目标聚合运行、状态机、恢复 | `workspace-goals` |
| `/schedules` | 计划任务、确定性派发、回执 | `workspace-schedules` |
| `/inbox` | 未读/全部、审批与运行汇聚 | `workspace-inbox` |
| `/ops` | 状态、计数、备份与恢复 | `workspace-ops` |
| `/market` | Worker 市场（demo 数据） | `workspace-market` |
| `/product-library` | 产品空间（未配置 Medusa 时只读空态） | `workspace-product-library` |
| `/business-memory` | 企业经营记忆：候选/审核/事实 | `workspace-business-memory` |
| `/files` | 文件上传、列表、文本预览、二进制下载 | `workspace-artifacts` |
| `/api/artifacts/*` | 文件元数据与下载接口（供页面和工具调用） | `workspace-artifacts` |
| `/quotes`、`/purchases` | 报价与采购单：CSV 导出、打印页、报价转采购；写操作必须人工审批 | `workspace-quotes`、`workspace-purchases` |
| `/login` | 企业模式的会话入口（本地单用户模式返回 404） | `workspace-access` |
| `/api/healthz` | 25 个插件健康检查 | kernel + seams |

模型默认关闭（`llm-bridge.enabled: false`）。安装器不创建凭据、不读取账号密钥；
需要真实模型时按仓库 `README.md` / `docs/` 显式配置。

## 5. 实测结果

本节只记录在本机真实跑过的结果，不把 fixture 或预览当验收。

| 项 | 结果 |
| --- | --- |
| 合并冲突 | `server/index.mjs` 1 处，已取并集并 `node --check` 通过 |
| 经营大脑相关单测 | 7 个文件 127/127 通过（`workspace-brain-read-http-compat` 在本机因 `/tmp` 路径不可用而跳过，非合并回归） |
| Harness kernel | 106/106 通过 |
| 安装包构建 | 浏览器版 24.9 MiB、桌面版 111.3 MiB（见第 6 节） |
| 静默安装 + 启动 | 两个版本均通过（见第 6 节） |
| 发布闸门 | `scripts/release-check.mjs` 70/70 步通过（ok: true：52 个测试文件 + 17 个冒烟 + doctor） |

## 6. 安装验收记录

2026-10-23 用 `dist/Workspace-Harness-Setup-0.5.0-rc.2.exe` 实测：

| 步骤 | 结果 |
| --- | --- |
| 静默安装（`/VERYSILENT /DIR=%TEMP%\wh-install`） | 退出码 0；`WorkspaceHarness.exe`、`runtime\node.exe`、`plugins\workspace-inquiry-recovery` 均在 |
| 首次启动（`--no-browser`） | 8790 就绪；数据写入 `%LOCALAPPDATA%\WorkspaceHarness\data` |
| 页面 | `/home`、`/chat`、`/files`、`/goals`、`/schedules`、`/inbox`、`/ops`、`/market`、`/business-memory`、`/quotes`、`/purchases` 全部 200 |
| 健康检查 | `/healthz` 200，25/25 插件 `ok` |
| 二次启动 | 不新增进程（node 进程数 1 → 1），只复用已有服务 |
| `--stop` | 退出码 0，端口关闭；再次启动可从陈旧锁恢复 |
| 卸载 | 退出码 0，安装目录删除；`data` 与 `logs` 保留 |
| 安装包大小 | 24.9 MiB，SHA-256 `C840A53E193605922DEFFEFA9D213AC017C534F78489A9F28D875F53D0305336` |

`/login` 在本地单用户模式下返回 404 属预期：它是企业模式入口。
`/inquiry-recovery` 没有独立页面，能力是模型工具 + HTTP 路由。

### 桌面版（Electron）

2026-10-23 用 `dist/Workspace-Harness-Desktop-Setup-0.5.0-rc.2.exe` 实测：

| 步骤 | 结果 |
| --- | --- |
| 静默安装（`/VERYSILENT /DIR=%TEMP%\wh-desktop`） | 退出码 0；367.8 MB / 1045 文件；`electron.exe` 已改名 `WorkspaceHarness.exe`，`resources\app\harness` 完整 |
| `--smoke` | 退出码 0；`/healthz` 200，25/25 插件 `ok`，服务进程已回收 |
| 正常启动 | 窗口标题「工作台」，`/home` 200；CDP 截图确认首页 8 张入口卡片 |
| `--stop` | 退出码 0，8790 关闭；窗口进程仍在（按设计，停止服务不等于退出界面） |
| 卸载 | 退出码 0，安装目录删除；`data` / `logs` / `chromium` 保留 |
| 安装包大小 | 111.3 MiB，SHA-256 `B3D1DF0FFB161917CD8FD7161F96EFA3A902C7398DCB184948607E23BAE82428` |

Electron 45 自带 Node 24.22，服务通过 `ELECTRON_RUN_AS_NODE` 跑在同一个可执行文件上，
所以桌面版没有第二份 `node.exe`；这 111 MiB 主要就是 Chromium 本身。

## 7. 已知边界

- 安装包只含本地 Harness 工作台；`integrations/dsh/` 的 DSH 插件不打包、不写 `~/.dsh`。
- 老应用（`server/index.mjs` + `src/`，8787）仍在仓库里，作为历史与迁移来源；
  新入口是 8790 的 Harness。老应用退休条件见
  [老应用退休评估](LEGACY-APP-RETIREMENT-20261023.md)。
- 业务插件（Medusa、ERPNext、Shopify 写操作等）大多未挂进默认组合；未挂载就不在
  安装包里运行，也不宣称可用。
- 本机单测受 Windows 路径与端口影响，个别测试（如 `/tmp` 用例）不适用于本机；
  以发布闸门的实际输出为准。
- 安装器未做代码签名，Windows SmartScreen 可能提示“未知发布者”；SHA-256 见
  `dist/SHA256SUMS.txt` 与 `dist/SHA256SUMS-desktop.txt`。

## 8. 源码保存

- 发布分支与开发分支都停在 `b027fd85`，已推送到 GitHub：
  `release/harness-20261023` 和 `agent/harness-20261023`。
- 全量源码快照：`dist/Workspace-Harness-Source-b027fd85.zip`（143 MiB，
  `git archive HEAD`，含全部跟踪文件；不含 `node_modules` 与运行时）。
  SHA-256 `8BED09C73CBC40B82525948DB61A362557841F941BFA5F050B5455BEDD4D8D7C`。
- 另一个会话在 `wsa-dev` worktree 里的未提交工作（报价/采购的 CSV 导出与打印页）
  已由本会话跑过 18 个单测、quotes 9/9、purchases 13/13 后提交并合入；
  `wsa-dev` 当前工作树干净。
