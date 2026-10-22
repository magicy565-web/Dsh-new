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

## 3. 一键安装包

产物：`dist/Workspace-Harness-Setup-0.5.0-rc.2.exe`（24.9 MiB，单文件，双击安装）。

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

构建：

```powershell
powershell -ExecutionPolicy Bypass -File installer\build.ps1
```

脚本会缺什么补什么：Node 取本机 DSH 运行时（可用 `-NodeExe` 指定），pnpm 取 DSH
运行时，Inno Setup 6 未安装时按当前用户静默安装。产物和 SHA-256 打印在最后，
同时写 `dist/SHA256SUMS.txt`。

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
| `/api/artifacts/*` | 文本与二进制文件、元数据、下载（面板入口在 `/chat` 附件里） | `workspace-artifacts` |
| `/quotes`、`/purchases` | 报价与采购单，写操作必须人工审批 | `workspace-quotes`、`workspace-purchases` |
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
| 安装包构建 | 见 `dist/SHA256SUMS.txt` 与第 6 节 |
| 静默安装 + 启动 | 待第 6 节验收记录 |
| 发布闸门 | `scripts/release-check.mjs` 67/67 步通过（ok: true，约 140s：51 个测试文件 + 15 个冒烟 + doctor） |

## 6. 安装验收记录

2026-10-23 用 `dist/Workspace-Harness-Setup-0.5.0-rc.2.exe` 实测：

| 步骤 | 结果 |
| --- | --- |
| 静默安装（`/VERYSILENT /DIR=%TEMP%\wh-install`） | 退出码 0；`WorkspaceHarness.exe`、`runtime\node.exe`、`plugins\workspace-inquiry-recovery` 均在 |
| 首次启动（`--no-browser`） | 8790 就绪；数据写入 `%LOCALAPPDATA%\WorkspaceHarness\data` |
| 页面 | `/home`、`/chat`、`/goals`、`/schedules`、`/inbox`、`/ops`、`/market`、`/business-memory`、`/quotes`、`/purchases` 全部 200 |
| 健康检查 | `/healthz` 200，25/25 插件 `ok` |
| 二次启动 | 不新增进程（node 进程数 1 → 1），只复用已有服务 |
| `--stop` | 退出码 0，端口关闭；再次启动可从陈旧锁恢复 |
| 卸载 | 退出码 0，安装目录删除；`data` 与 `logs` 保留 |
| 安装包大小 | 24.9 MiB，SHA-256 `BA8DC045CB71D60E73D6A860FD96AD8218D362B1035BBB7AC0518CD0A00A2492` |

`/login` 在本地单用户模式下返回 404 属预期：它是企业模式入口。
`/inquiry-recovery` 没有独立页面，能力是模型工具 + HTTP 路由。

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
  `dist/SHA256SUMS.txt`。
