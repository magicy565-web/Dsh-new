# 开发交接上下文

> GitHub 归档说明：用户于 2026-11-01 指定将此上下文提交到 `magicy565-web/Dsh-new` 的 `agent/harness-20261023` 分支。本目录保存本地开发状态快照；文中 H:/ 路径指原 Windows 电脑，代码、安装包、测试日志及运行数据不随本次文档提交上传。下文“本轮没有提交 Git”等表述描述保存快照时的状态。后续开发需同时核对仓库现状，不能将本地试用版状态当作当前远程源码的验收结论。

保存日期：2026-11-01（Asia/Shanghai）。用户已明确要求“先这样，后续开发定制 UI 外壳，先整理开发上下文保存”。因此本轮停止继续测试、修复和打包；下次按用户的新任务接续。

## 最重要的状态

- **最后完成 EXE 安装及主要桌面联测的版本是 0.1.0-trial.2。**
- **当前源码已推进到 0.1.0-trial.3，但它仍是未完成验收的候选版，没有生成 trial.3 对外交付 EXE。**
- `release-path.txt` 目前指向 trial.3 的 `dist`。不能把这个指针理解成已发布版本。
- 本轮已经写入磁盘的修改不应回退或丢弃；也不能把它们直接描述为已全部验证。
- 用户确定：Windows 独立桌面窗口、自己的图标、EXE 安装包；**执行内核必须使用官方 DeepSeek Harness**。
- 下一阶段用户打算开发**定制 UI 外壳**，目前尚未确定具体设计稿、页面范围或新的品牌名称。

## 工作区和职责

| 路径 | 用途 |
| --- | --- |
| `H:/dsh-enterprise-trial-work/` | 本次安装包、桌面壳、维护工具、验证脚本及交付文件 |
| `H:/dsh-native-platform-work/` | 原生 DSH 业务插件源码；改这里之前先读其 AGENTS.md |
| `H:/dsh-host-rc3-work/` | 官方 Harness 源码参考镜像，本轮未修改其内核 |
| `H:/dsh-rc3-isolated/node_modules/` | 已锁定的官方 Harness 运行依赖来源 |
| `H:/dsh-buyer-image-work/combined/package/` | 本发行采用的买手整合插件来源 |
| `H:/dsh-gpt-live-work/package/` | 语音插件来源 |

工作区存在其他聊天的开发结果。不要覆盖其他目录中的改动，不要停止所有 Node/Electron 进程，不要把测试安装目录当客户分发目录。本轮没有提交 Git，也没有创建新的聊天或子代理。

## 已确定的架构

```text
Windows Setup.exe（C# WinForms 安装向导）
  → DSH Enterprise.exe（自有图标的原生启动入口）
  → Electron 独立窗口
  → 本机官方 DeepSeek Harness
  → 原生会话、模型执行、工具、Agent 预设、工作区、资料库及业务插件
```

固定的运行环境：

- 官方 `@deepseek-ai/dsh`：`0.2.1-rc.3`。
- 随包 Node：`v24.22.1`。
- 桌面层 Electron：`45.2.1`，下载来自官方 GitHub，并已核对官方 SHASUMS256.txt。
- Harness 实际启动入口：`runtime/node_modules/@deepseek-ai/dsh/lib/bin.js`。
- Harness 使用 `--profile web --host 127.0.0.1 --port 0 --no-open`；桌面解析本机 Owner 入口并加载原生界面。
- `DSH_HOME` 固定到各安装的 `data`；工作文件在该安装的 `workspace`。
- 渲染器关闭 Node integration，开启 context isolation、sandbox 和 web security；没有向网页暴露通用 Node/文件系统 IPC。
- 当前是本机单企业试用模式。不是公网多租户服务，也不是开机运行的 Windows 服务安装包。

### 后续定制 UI 的边界

1. 可以定制品牌、导航、布局、窗口、状态反馈和业务工作台呈现。
2. 继续复用 Harness 的会话、执行、工具、权限、流式事件和工作区；不另写 Agent 循环或第二套执行服务。
3. 目前 Electron 加载的是 Harness 原生界面。启动页和错误页只是壳层状态页，不是完整业务 UI。
4. 新界面要沿用原生认证和 API 契约，不应为了换 UI 绕开现有权限策略或复制一套持久化业务数据。
5. 用户工作区不等于企业身份隔离。不要用 UI 改名、workspace ID 或全局 Owner 身份冒充多企业权限。
6. 经营大脑目前对未绑定的 profile 级企业资料工具保持拒绝。原服务器身份、成员映射和资料授权尚未接通，UI 定制不能把这项缺口描述为已完成。
7. 尚未确认具体定制 UI 风格与页面范围，不能把本轮临时 DSH 图标当成最终企业品牌设计。

## 最近一次用户遇到的“卡住”

用户截图显示“正在启动 DeepSeek Harness…”一直旋转，随后提供了实际地址：

`file:///H:/dsh-enterprise-trial-work/desktop/loading.html`

已确认用户在 Chrome 中单独打开了静态启动占位 HTML，而不是启动已安装的 EXE；该页面本身不会运行 Harness。这次现象不是已确认的 Harness 内核卡死。

正确入口是 Setup.exe 安装后的桌面快捷方式“DSH 企业工作台”，或者安装目录中的 `DSH Enterprise.exe`。

本轮已添加 `desktop/loading.js`：在普通浏览器单独打开 HTML 时停止转圈，并显示正确的 EXE 启动说明。该行为已通过真实 Edge 浏览器测试，证据为 `validation/trial3/standalone-html-guidance.png`。

## 最后可回溯的交付版 trial.2

文件：

- `delivery/DSH-Enterprise-Trial-0.1.0-trial.2-Setup.exe`
- `delivery/DSH-Enterprise-Trial-0.1.0-trial.2-Setup.exe.sha256`
- `delivery/企业桌面试用版-安装验收报告.md`

EXE：381,954,560 字节，约 382 MB。

SHA-256：

```text
ce4ba0670be3365203ea2b977ecdc940cad2db40edeb55eab8f2ec9de01723d2
```

该版在 Windows 10 Pro for Workstations 22H2（19045.6332）通过了实际 EXE 离线安装、29,943 个程序文件校验、2,862 个内部依赖链接校验、桌面启动、原生入口单实例、经营大脑工具、买手预设、备份恢复、重启及正常退出清理。

业务联测使用本机脚本模型，7 次本机请求，真实收费模型调用为 0。真实账号服务、真实麦克风、其他 Windows 系统和普通独立非管理员账号没有因此获得验收。

固定组件组合：

| 组件 | 版本 |
| --- | --- |
| dsh-commerce-network | 1.4.0-rc.2 |
| dsh-service-billing | 0.1.0-rc.2 |
| dsh-workspace-library | 1.4.1 |
| dsh-crossborder-knowledge-adapter | 0.2.4 |
| dsh-enterprise-brain | 0.3.0-trial.2 |
| dsh-gpt-live-voice | 0.2.2 |
| dsh-buyer-magazine | 0.9.0-trial.1 |

不包含 Mini ERP、实验性外部身份入口、真实密钥、客户资料或测试会话。组件保留独立版本，由发行清单锁定组合。

此前修复过安装后配置脚本内容异常的问题：安装器改为读取字节后写入目标，并在完成标记生成前校验全部安装文件。失败候选包已移至 `validation/rejected-artifacts/`，不应分发。

## trial.3 本轮已经落盘的改动

### 桌面启动与进程管理

- 新增 `desktop/HostSupervisor.cs`，编译为 `HarnessHost.exe`。
- 使用 Windows Job Object，设置 KILL_ON_JOB_CLOSE；子进程挂起创建、加入 Job 后再恢复运行。
- 监管进程监控 Electron 父进程退出，设计目标是桌面强退时同时终止 PowerShell、Node、Harness 及其后代。
- `desktop/main.cjs` 改为通过监管程序启动内核；不再根据运行锁随意强杀 PID。
- 新增 `desktop/startup.cjs`：过滤 ANSI 控制字符、等待完整 URL 行，避免截断 token 被当作启动地址；诊断文本脱敏。
- 启动超时保持到 UI 加载完成；新增错误页、启动日志入口和重新启动菜单。
- 原生标准日志只记录受控状态；启动错误有限长输出。日志轮转逻辑仍应在后续补专门验证。
- `launch.mjs` 在运行锁中记录 supervisorPid，并与维护锁互斥。

### 页面与权限

- 单独打开 loading.html 时显示 EXE 指引，已实测。
- 麦克风只有明确允许后才授予；摄像头不予授予。
- 预览内容在独立临时 session 中以 data URL 打开，避免共享主窗口的 Owner cookie。
- 预览读取限制为本机已授权内容、指定 MIME、20 MB；主渲染器没有 Node 权限。
- 外部链接显示目标 origin，经确认后才交给外部浏览器；危险协议不打开。
- 预览对相对资源、多种 PDF/图像以及真实买手产物的兼容性仍需进一步验证。

### 安装、备份、恢复和卸载

- 新增 `runtime-safety.cjs`，统一大小写无关路径边界、目录链接拒绝、进程存活及维护锁。
- 修复备份目标可落进 workspace 的递归复制风险。
- 备份先检查来源，拒绝目录链接，写入后校验；恢复只接受清单内文件，拒绝损坏或额外文件。
- 启动和维护操作互斥；恢复继续保留恢复前数据。
- 安装器增加参数及清单校验、目录链接保护、同包中断续装。
- 新增 `uninstall.mjs` 和 `desktop/Uninstall.cs`：设计为移除程序、保留企业资料和备份；同版重装复用保留数据。被修改过的程序文件保留而不强删。
- `exe/Setup.cs` 新增当前用户卸载注册、专用目录前置检查、持久化安装日志；修复成功后编辑路径导致“启动”按钮打开错误目录的问题。
- 重复快捷方式增加版本/安装 ID 区分。
- **真实完整安装的 C# 卸载入口、注册表清理、卸载后实际重装尚未跑完；只有合成小型安装的 Node 工作逻辑已通过回归。**

### 凭据配置

- 新增 `credentials.ps1`，由 configure.ps1 和 start.ps1 复用。
- Windows 当前用户 DPAPI；临时文件加原子替换；保留未更新的密钥。
- JSON 损坏、未知字段或不可解密密文会拒绝继续，保留原文件。
- 已用合成凭据完成加密往返、无明文落盘、增量更新、损坏配置保留和无效密文拒绝测试。
- 用户对真实账号配置回答“不确定”。没有获得可用于真实模型/语音验证的账号路径；不要扫描或使用不明来源的密钥。

## 当前验证结果：不能混淆通过与未完成

| 检查 | 当前结果 |
| --- | --- |
| installer.test.mjs + hardening.test.mjs | 19/19 通过，0 失败 |
| credentials-test.ps1 | 合成 DPAPI、原子保存与损坏保护通过 |
| trial.3 候选独立安装 | 安装前后校验通过，已安装到 `validation/trial3/桌面候选` |
| 无账号启动 | trial.2、trial.3 均曾在真实 Electron 中成功进入 Harness |
| FORCE_COLOR 环境 | trial.3 启动通过 |
| 合成麦克风拒绝/允许、摄像头拒绝 | trial.3 真实 Electron 权限处理通过；不是实际麦克风硬件验收 |
| 预览隔离 | 独立 session、无 Owner cookie、资料库请求返回 401，已通过 |
| 外部/危险导航 | 已通过 |
| 下载 | 实际生成了 16 字节测试文件，但测试等待了不适用/未收到的 Playwright download 事件，导致超时；不能计为整套生命周期通过 |
| 桌面强制退出、渲染器崩溃、崩溃后重启 | 已写测试，但位于上述下载测试之后，本轮尚未执行到 |
| trial.3 正常退出 | 失败测试的 finally 已关闭客户端，日志出现 Harness stopped |
| trial.3 完整业务联测 | 尚未重跑 |
| trial.3 EXE、GUI 安装事件、卸载重装 | 尚未完成 |
| Windows Server、独立标准用户、真实模型和服务 | 尚未验证 |

### 下载测试阻塞的具体位置

`desktop/lifecycle-test.mjs` 第 22 行附近使用 `page.waitForEvent('download')` 等待 Electron 下载事件，30 秒后超时。

实际文件已落盘：`validation/trial3/synthetic-download-1793487078999.txt`（16 字节）。初步判断为测试适配问题，尚未完成修复和复测。

下一步应改为观察 Electron session 的 `will-download` 和 DownloadItem 的 `done` 状态，并核验落盘文件内容，而不是仅靠 Playwright 页面事件。修完后继续执行后面的强退、渲染器崩溃、恢复及正常退出测试。

## 重要文件和证据

| 文件 | 用途 |
| --- | --- |
| `desktop/main.cjs` | 桌面主进程、启动、权限、预览、生命周期 |
| `desktop/Launcher.cs` | 用户启动的原生 EXE |
| `desktop/HostSupervisor.cs` | Windows Job 监管 |
| `desktop/Uninstall.cs`、`uninstall.mjs` | 卸载入口与文件清理 |
| `installer.mjs`、`runtime-safety.cjs` | 安装及路径/维护保护 |
| `manage.mjs` | 备份恢复 |
| `credentials.ps1`、`configure.ps1`、`start.ps1` | 凭据保存与启动注入 |
| `exe/Setup.cs`、`exe/build.ps1` | EXE 安装向导与构建 |
| `installation-test.mjs` | 真实 Harness、Electron、工具、业务与备份恢复联测 |
| `desktop/lifecycle-test.mjs` | 桌面权限与异常生命周期验证，当前下载事件处超时 |
| `test/hardening.test.mjs` | 本轮新增的路径、安装恢复、维护、备份与卸载保护回归 |
| `test/credentials-test.ps1` | 合成 DPAPI 测试 |
| `validation/trial3/hardening-tests.log` | 19/19 通过证据 |
| `validation/trial3/credentials-test.log` | 凭据保护结果 |
| `validation/trial3/candidate-install.log` | trial.3 候选实际安装 |
| `validation/trial3/lifecycle-test.log` | 部分通过及下载事件超时证据 |
| `desktop/final-exe-test.log` | trial.2 最终业务联测，不能冒充 trial.3 证据 |

## 下次构建前必须注意

1. `dist/DSH-Enterprise-Trial-0.1.0-trial.3-win-x64/` 是候选，不是冻结交付。
2. `validation/trial3/桌面候选` 的 `main.cjs` 和 `startup.cjs` 曾手工同步用于调试，其安装清单不一定对应当前文件；不能当最终包验收目录。
3. `refresh-release.mjs` 会覆盖当前 release-path 指向的源码模板、重新编译原生 EXE 并更新摘要。运行前确认指向 trial.3，不能回写已交付 trial.2。
4. `desktop/prepare-trial3.mjs` 已成功运行，目标已存在；不要盲目重跑。
5. `desktop/build-desktop.mjs` 仍是早期 trial.2 的构建脚本，不是新候选的通用入口。
6. `README.zh-CN.md`、`desktop/finalize.mjs` 和若干旧验收脚本仍含 trial.2 的说明/固定路径，尚未统一更新。尤其 finalize.mjs 的验证安装路径是旧版路径，必须修改并严格验证 result.version、实际安装路径及最终包摘要后才能生成新报告。
7. `validation/result.json` 仍可能是 trial.2 最终验收结果；不要用它证明 trial.3。
8. 新版必须完成代码冻结、刷新清单、重新打包、从最终 EXE 安装到新目录，再运行验收。不要分发测试目录或临时复制后的程序。
9. 交付包不应包含 data、workspace、测试会话、真实配置、临时诊断或测试产物。
10. 本轮没有企业代码签名；不要使用自签名冒充企业签名或关闭 Windows 安全设置。

## 环境与工具注意

- Shell 为 PowerShell，工作目录 `H:/`，时区 Asia/Shanghai。
- 可用 Node：`C:/Users/Administrator/Downloads/StorelessUpdater/versions/26.1027.3384.0/resources/cua_node/bin/node.exe`。
- C# 编译器：`C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe`，使用旧版 C# 语法；传入源码路径时使用 Windows 反斜杠格式。
- Electron 在受限执行环境曾出现 renderer launch-failed。正常 Windows 进程环境下已通过，未关闭 Chromium sandbox。运行真实桌面测试需要相应正常执行权限。
- Windows 图形自动化的 node_repl/sky 曾连续失败：`windows sandbox failed: permission path cannot be represented losslessly`。未完成真实鼠标逐项点击安装向导的自动验收，不应伪称已完成。
- 普通文件和编程操作可继续使用 PowerShell/Node；不要通过 UI 自动化操作终端、Windows 安全设置或绕过系统提示。
- 删除/移动目录前先核验绝对路径边界；保留用户资料。不要清理整个 H 盘、所有 Node 进程或不属于本次测试的窗口。

## 后续建议顺序（待用户选择继续方向）

若先继续安装加固：修下载测试 → 完成异常生命周期 → 真实完整卸载/重装与安装 UI 事件验证 → 更新文档/版本 → 最终 EXE 重打包与重新安装验收。

若先做定制 UI：先确认页面范围和视觉方向 → 梳理原生 Harness API/事件与权限契约 → 在现有 Electron/Harness 架构上实现展示层 → 将新界面纳入同一套安装与运行验收。

不要把上述建议当作用户已经批准继续执行；本轮停在“保存开发上下文”。
