# Workspace Harness 一键安装包构建

同一份本地 Harness 有两个安装器：

| | 浏览器版 | 桌面版（完整） |
| --- | --- | --- |
| 产物 | `dist/Workspace-Harness-Setup-<version>.exe` | `dist/Workspace-Harness-Desktop-Setup-<version>.exe` |
| 构建脚本 | `build.ps1` | `build-desktop.ps1` |
| 安装包 | 24.9 MiB | 约 111 MiB |
| 安装后 | 约 100 MB | 约 368 MB |
| 界面 | 系统浏览器 | Electron 45 独立窗口 + 托盘 |
| 内核 | 自带 Node 24 | Electron 45 自带 Chromium 156 + Node 24.22 |

两者都是**每用户安装**（`%LOCALAPPDATA%\Programs\WorkspaceHarness`），不需要管理员权限，
共用同一个 `AppId` 和数据目录；装桌面版会替换浏览器版的文件，`data` / `logs` 保留。

## 安装后是什么

- 本地 Harness 工作台全栈：`/home`、`/chat`、`/goals`、`/schedules`、`/inbox`、`/ops`、
  `/market`、`/product-library`、`/business-memory`、`/quotes`、`/purchases` 等。
- 浏览器版启动器 `WorkspaceHarness.exe`：后台起服务，等端口就绪后打开
  `http://127.0.0.1:8790/home`；再次双击只打开页面，不会起第二个进程。
- 桌面版 `WorkspaceHarness.exe`：独立窗口，托盘菜单提供打开 / 浏览器打开 / 停止服务 / 退出；
  关窗只隐藏到托盘。服务跑在 Electron 内嵌 Node 24.22（`ELECTRON_RUN_AS_NODE`），
  不再附带第二份 `node.exe`。
- 可变数据在 `%LOCALAPPDATA%\WorkspaceHarness\data`（升级/卸载保留），日志在
  `%LOCALAPPDATA%\WorkspaceHarness\logs`；桌面版 Chromium 状态在
  `%LOCALAPPDATA%\WorkspaceHarness\chromium`。

## 构建（浏览器版）

前置：Windows 10+、PowerShell 5.1+、可访问 npm registry（安装 `cordis` + `yaml`）。
Inno Setup 6 未安装时脚本会自动下载并按当前用户静默安装。

```powershell
cd wsa-trunk
powershell -ExecutionPolicy Bypass -File installer\build.ps1
# 指定版本或已有 node.exe：
powershell -ExecutionPolicy Bypass -File installer\build.ps1 -Version 0.5.0-rc.2 -NodeExe "C:\...\node.exe"
```

脚本步骤：

1. 复制 `packages/`、`plugins/`、`server/`、`scripts/`、`harness.local.yml` 到临时 payload；
2. 用 pnpm 以 hoisted 布局安装生产依赖（`cordis@4.0.0-rc.11`、`yaml@2.9.1`），
   目录是真实文件而不是符号链接，便于打包；
3. 复制 Node 运行时（默认取本机 DSH 自带 node，可用 `-NodeExe` 覆盖）；
4. 用 .NET Framework 的 `csc.exe` 编译 `launcher/WorkspaceHarness.cs`；
5. 调用 ISCC 编译 `workspace-harness.iss`，输出到 `dist/`，并打印 SHA-256。

## 构建（桌面版）

```powershell
powershell -ExecutionPolicy Bypass -File installer\build-desktop.ps1
# 指定 Electron 版本或离线 zip：
powershell -ExecutionPolicy Bypass -File installer\build-desktop.ps1 -ElectronVersion 45.0.0 -ElectronZip "C:\...\electron-v45.0.0-win32-x64.zip"
```

脚本步骤：

1. 下载并缓存 Electron 45 win32-x64（GitHub release 失败时自动切 npmmirror 镜像）；
2. 解压到 payload，删除 `resources/default_app.asar`，写入 `resources/app`（`main.js`、
   `package.json`、`icon.ico`）和 `resources/app/harness`（完整 Harness + 依赖）；
3. 把 `electron.exe` 改名为 `WorkspaceHarness.exe`，用 `rcedit` 写入图标与版本信息；
4. 调用 ISCC 编译 `workspace-harness-desktop.iss`，输出到 `dist/`，并打印 SHA-256。

`rcedit` 会从 GitHub 下载到 `%TEMP%\rcedit-x64.exe`；Electron zip 缓存在
`%TEMP%\electron-v<version>-win32-x64.zip`，重复构建不再下载。

## 验收

浏览器版：

```powershell
$setup = "dist\Workspace-Harness-Setup-0.5.0-rc.2.exe"
Start-Process $setup -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/DIR=$env:TEMP\wh-install" -Wait
& "$env:TEMP\wh-install\WorkspaceHarness.exe" --no-browser
Invoke-WebRequest http://127.0.0.1:8790/home -UseBasicParsing     # 200
Invoke-WebRequest http://127.0.0.1:8790/healthz -UseBasicParsing  # 25 plugins ok
& "$env:TEMP\wh-install\WorkspaceHarness.exe" --stop
```

桌面版：

```powershell
$setup = "dist\Workspace-Harness-Desktop-Setup-0.5.0-rc.2.exe"
Start-Process $setup -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/DIR=$env:TEMP\wh-desktop" -Wait
& "$env:TEMP\wh-desktop\WorkspaceHarness.exe" --smoke   # 写 %TEMP%\workspace-harness-smoke.json，退出码 0
& "$env:TEMP\wh-desktop\WorkspaceHarness.exe" --stop
```

> 测试桌面版时不要在当前 shell 里设置 `ELECTRON_RUN_AS_NODE`，否则 Windows 会让
> `WorkspaceHarness.exe` 按 Node 解释参数，报 `bad option: --smoke`。从开始菜单/桌面
> 快捷方式启动不会遇到这个问题。

## 边界

- 安装包只含本地 Harness 工作台；`integrations/dsh/` 的 DeepSeek Harness 桌面插件不在里面，
  安装器也不读写 `~/.dsh`。
- 首次安装默认不配置模型：`llm-bridge` 保持 `enabled: false`。需要真实模型时按仓库
  `README.md` / `docs/` 的说明显式配置，安装器不创建任何凭据。
- 后端只监听 `127.0.0.1:8790`，没有鉴权时不要暴露到公网。
- 两个安装器都没有代码签名，Windows SmartScreen 可能提示“未知发布者”；以
  `dist/SHA256SUMS*.txt` 为准。
