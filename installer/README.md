# Workspace Harness 一键安装包构建

产物：`dist/Workspace-Harness-Setup-<version>.exe`（单个 exe，双击安装）。
安装器是**每用户安装**（`%LOCALAPPDATA%\Programs\WorkspaceHarness`），不需要管理员权限。

## 安装后是什么

- 自带 Node 24 运行时（`runtime/node.exe`），机器上不需要预装 Node。
- 本地 Harness 工作台全栈：`/home`、`/chat`、`/goals`、`/schedules`、`/inbox`、`/ops`、
  `/market`、`/product-library`、`/business-memory`、`/files`、`/quotes`、`/purchases` 等。
- 启动器 `WorkspaceHarness.exe`：后台启动服务（无控制台窗口），等端口就绪后打开
  `http://127.0.0.1:8790/home`；再次双击只会打开页面，不会起第二个进程。
- 可变数据在 `%LOCALAPPDATA%\WorkspaceHarness\data`（升级/卸载保留），日志在
  `%LOCALAPPDATA%\WorkspaceHarness\logs`。

## 构建

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

## 验收

```powershell
$setup = "dist\Workspace-Harness-Setup-0.5.0-rc.2.exe"
Start-Process $setup -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/DIR=$env:TEMP\wh-install" -Wait
& "$env:TEMP\wh-install\WorkspaceHarness.exe" --no-browser
Invoke-WebRequest http://127.0.0.1:8790/home -UseBasicParsing     # 200
Invoke-WebRequest http://127.0.0.1:8790/healthz -UseBasicParsing  # 24 plugins ok
& "$env:TEMP\wh-install\WorkspaceHarness.exe" --stop
```

## 边界

- 安装包只含本地 Harness 工作台；`integrations/dsh/` 的 DeepSeek Harness 桌面插件不在里面，
  安装器也不读写 `~/.dsh`。
- 首次安装默认不配置模型：`llm-bridge` 保持 `enabled: false`。需要真实模型时按仓库
  `README.md` / `docs/` 的说明显式配置，安装器不创建任何凭据。
- 后端只监听 `127.0.0.1:8790`，没有鉴权时不要暴露到公网。
