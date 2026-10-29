# 工厂代运营试用 从安装到第一份委托

2026-10-29。目标是打开当前系统并试跑一份演练委托。本轮不增加业务模块；沿用 Commerce 1.4.0-rc.2 和独立 Service Billing 0.1.0-rc.2，不安装或升级 Mini ERP。

## 1 选择交付包

推荐下载“源码与工厂试用包 ZIP”，解压后进入包含 `packages` 和 `source` 的 `DSH-Commerce-pilot` 目录。`packages` 是已经构建的两个原生插件；`source` 是源码。试用无需先编译源码。

如果拿到的是纯源码 ZIP，在解压后的源码根目录执行：

```sh
npm ci --ignore-scripts
npm run package:business-services
```

这只构建 Commerce 与 Billing，不打包 Mini ERP。输出位于 `dist/business-services`。下文安装路径中的 `./packages/` 相应改为 `./dist/business-services/`。`npm start` 只打印说明，不会启动网站；这是 DSH 插件仓库。

## 2 检查 Linux 服务器上的官方宿主

本次试用目标是已有 DSH 的 Linux 服务器。先运行 `node --version` 和 `dsh --version`；下文实际验证的组合是 Node.js 24 与 DSH 0.2.1-rc.3。已有这个版本时直接进入第 3 步，不要重新安装全局宿主。其他版本请先核对兼容性，不要直接覆盖正在使用的服务器环境。

仅在尚未安装宿主的独立环境中，安装 Node.js 24 或更高版本，再安装官方 DSH：

```sh
node --version
npm install -g @deepseek-ai/dsh@0.2.1-rc.3
dsh --version
```

已有这个版本的 DSH 可跳过安装。首次安装官方宿主和插件需要联网。不要把 API 密钥写入命令示例、截图或聊天记录。

## 3 使用独立试用目录

以下命令均在解压后的 `DSH-Commerce-pilot` 目录执行。继续使用同一个终端；环境变量只对该终端及其子进程有效。

Linux（bash），也适用于 macOS zsh：

```sh
export DSH_HOME="$PWD/pilot-data"
mkdir -p pilot-workspace
dsh plugin --profile web add ./packages/dsh-commerce-network-1.4.0-rc.2.tgz ./packages/dsh-service-billing-0.1.0-rc.2.tgz
cd pilot-workspace
dsh --profile web --host 127.0.0.1 --port 4187 --no-open
```

这会在解压目录下建立试用数据，和服务器原有 DSH_HOME 分开。若 4187 已占用，安装命令不变，启动时改为 `--port 4188`，SSH 转发也使用相同端口。不要在同一数据目录同时启动两个宿主。

Windows PowerShell 备用说明：

```powershell
$env:DSH_HOME = Join-Path $PWD 'pilot-data'
New-Item -ItemType Directory -Force 'pilot-workspace' | Out-Null
dsh plugin --profile web add ./packages/dsh-commerce-network-1.4.0-rc.2.tgz ./packages/dsh-service-billing-0.1.0-rc.2.tgz
Set-Location 'pilot-workspace'
dsh --profile web --host 127.0.0.1 --port 4187 --no-open
```

Windows 如因 PowerShell 执行策略拦截 npm/dsh 的 `.ps1`，可使用 `npm.cmd`、`dsh.cmd`，无需放宽整机执行策略。Linux 的命令在隔离环境实际验证；Windows/macOS 命令按对应 shell 语法提供，未在对应主机实测。

若在远程服务器运行，`127.0.0.1` 是服务器本机。应使用已有的 SSH 本地端口转发访问，不能把云端 localhost 当作自己电脑可打开的网址。示例：在自己电脑另开终端执行 `ssh -L 4187:127.0.0.1:4187 用户名@服务器`，再打开宿主输出的完整本地链接。不要为了试用把带身份的宿主端口直接开放到公网。

## 4 打开真实页面

在自己的浏览器打开终端打印的完整本地 URL，保留 URL 中宿主附带的身份参数，不要把它分享或提交到 Git。首次预览提示出现时点击 Continue。若出现 Choose workspace，点击后选择刚才建立的 pilot-workspace 文件夹；已有工作区时，菜单内选 Add workspace… 可添加另一目录。文件夹选择器的 Edit path 可填写绝对路径，进入目标目录后点击 Open。确认会话的工作区名称正确，再在右侧栏打开 Commerce Network。第一次应看到空画布；本产品不会自动建立工厂、产品或成交记录。

绘制画布、填写条款、审核、业务推进和账单登记都使用原生会话身份。使用 Assistant 建立计划或分析下一步时，需要在 DSH 配置可用模型，并会产生提供方的模型用量。密钥通过宿主安全配置提供。本次交付不包含密钥，不自动发起模型请求。

## 5 建立一个明确标注的演练案例

复制 [工厂试用提示词](../examples/factory-pilot/PROMPT.zh-CN.txt) 到当前 DSH 会话，核对后发送。它要求 Assistant 创建带 SYNTHETIC 标识的项目、双方主体、一个产品上下文、一个渠道计划，以及固定费 USD 100 的委托草稿。它不注册真实外部账号、不发信、不执行 Worker，也不代表实际产品资料已核验。

检查工具回执，确认草稿实际保存后，在画布选择演练项目。进入“业务委托”，核对以下条款，再由你审核：

| 项目 | 演练值 |
| --- | --- |
| 模式 | 工厂海外渠道代运营 |
| 市场 | US |
| 固定委托费 | USD 100.00，仅用于演练 |
| AI 约定 | 委托方承担，需另行明确真实额度；演练不计费 |
| 销售佣金 | 净商品实收的 5%，核实收款触发，退款按比例冲回；只保存约定 |
| 协议依据 | SYNTHETIC 演练协议，不是实际合同 |

如果工具没有回执、产品未关联或条款未完整，请先让 Assistant 读取当前记录补齐草稿，不要把文字回复当成已创建成功。未配置模型时可先打开 UI、创建项目和主体；工厂审核所需产品上下文仍需通过已有原生计划工具建立，不承诺无模型的一键完整演练。

## 6 亲手完成四项操作

1. **记录进展**：打开“业务推进”，选择演练委托，记录“产品准备”、负责主体、下一步和更新依据，再核对保存。
2. **记录阻碍**：改为“有阻碍”，填写“待补产品尺寸”，保存后查看两条历史。阶段可以回退，不需要画执行节点。
3. **确认账单**：打开“条款与服务账单”，生成 USD 100 草稿，核对后确认。此时只形成内部待收记录，没有扣款。
4. **核对记录与重启**：如要演练收款，创建内容明确写着“合成凭据，无真实付款”的文本文件，上传后登记 USD 40，再关联原收款登记 USD 10 退款。预期净收 USD 30、未收 USD 70。实际发生时间须晚于账单确认时间，按界面 UTC 字段填写。停止并重新启动同一 DSH_HOME 后，选择原会话、原项目，核对历史仍在。

样例凭据文件见 [synthetic-receipt.txt](../examples/factory-pilot/synthetic-receipt.txt)。此文件不能作为真实财务凭据。若只查看系统，可跳过收退款演练。

## 7 重开与反馈

关闭宿主后，在解压目录重新设置同一个 DSH_HOME，进入同一个 `pilot-workspace` 再执行启动命令。不要改用默认目录，否则可能看到另一份空数据。

请记录：实际操作步骤、你期待看到什么、页面实际显示什么。错误反馈不要包含宿主启动令牌、API 密钥、浏览器身份文件或真实客户资料。界面上的模型建议、运营阶段、交付验收、成交事实和收款事实分别判断。

| 现象 | 先检查 |
| --- | --- |
| `npm start` 后没有网页 | 它是说明命令；用官方 `dsh --profile web ...` 启动 |
| 提示 Node / SQLite 不支持 | `node --version` 必须为 24+ |
| 4187 端口占用 | 改用 `--port 4188`，并打开本次终端新链接 |
| 没有 Commerce 入口 | 安装与启动是否使用同一个 DSH_HOME 和 web profile；安装后重启宿主 |
| 当前会话无工作区 | 新建与工作目录关联的原生会话，再从该会话打开右侧画布 |
| 服务账单未连接 | 是否安装独立 Billing，并重启同一个 profile |
| 看不到之前的进展 | 原 DSH_HOME、原会话、原项目是否一致 |
| 提交结果未知 | 回原会话、原项目使用“原请求核对”，不要换请求号重复创建 |

已有业务数据的升级与备份见 [工作台说明](COMMERCE-BUSINESS-WORKBENCH.md)。历史七插件安装方案不适用于本次独立试用。
