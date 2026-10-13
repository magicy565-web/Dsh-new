# Workspace 开发验收与发布准备（2026-10-13）

本轮在原 Work 执行环境推进整个现有 Workspace。起点为 PR60 实际远端 `49d536007b18fa9f877ffcfe6280e28f2384c7d2`，保留原 PR59 基线 `32c8ce98fe28cda1e22a16bf0d1088c768e081c8`。版本仍为 `0.5.0-rc.2`；开发分支为 `codex/unified-pi-agent-api-20261013`，最终源码、构建和执行记录以本轮验证清单的精确 SHA 为准。

本轮可交付阶段是可复验的开发候选。生产状态仍为 **release_blocked**。用户报告华为服务器已重启；该报告不证明当前生产版本、服务可达、Identity 登录或授权接入已验证。父任务单独核查 Identity 和密码恢复。本轮没有生产登录、主机修改、部署或 main 合并。

## 现有产品可用范围

| 范围 | 已有实现与本轮验证边界 |
| --- | --- |
| 网页会话与移动入口 | 使用实际 App 构建、同源 HTTP 和原 Store；打开现有会话、目标/活动及互斥资源抽屉。真实 Chromium 发现手机抽屉被 CSS 隐藏、空会话原委托入口被挤成竖排。修复仅提高当前会话两处抽屉选择器优先级，并将空消息的现有直属内容纵向排列；短屏保留滚动。 |
| 企业资料与产品库 | 使用原私有产品/SKU、付款条件、版本化企业文档及固定文件版本引用；产品保持内部 draft/archived。资料引用选择不自动发送、执行或发布。 |
| 原企业业务 | 仍是单 Workspace、单业务 Store 和单 writer，复用原身份、批准、预算、供应商、Shopify/GA4、通知与恢复流程。 |
| 内置 Agent 与 Python | 可选 `/api/agent/v1` 复用原 Pi Runtime；SQLite 是查询/事件投影。原 Python 薄客户端与 SSE、幂等、显式恢复、下载通过本地合成 HTTP 验证。模型未配置保持准确阻断。 |
| Pi TUI、Muse/Dot | 原 Pi CLI、原 owner MCP、队列、领取/心跳/回执及文件校验有合成验证；实际 Cordis Host、真实 Muse/Dot 执行和账号连接仍需各自真实验收。 |
| 小程序 | 原 Page/Components、WXML/WXSS 和本地签名 HTTP 覆盖供应商、独立草稿/发布批准、部分失败核对、监测与通知。Chromium 有限渲染器的截图不等于微信工具或真机验收。 |

供应商 worker 继续只有两项租约内只读工具。Owner session MCP 和需原 host resolver 的 external owner binding 继续分别报告其接入状态。GA4 启动元数据不代表账户已连接；缺失值保留 null/unknown。真实发布时间须由原 shopify-observation 取得。七天未来通知的持续同意/持久收件人权限仍待批准，保留原手动审批。

## 实际检查和证据规则

原 Work 环境为 Node `24.19.0`、Python `3.12.14`。按用户要求，三个普通开发子代理均以 `gpt-6.1-sol / xhigh` 启动，分别负责产品界面、现有业务后端、Pi/Muse/Dot/Python；主任务唯一集成提交与推送。

基线完成锁定 root 依赖安装、网页/小程序构建；Agent 41、Python 27、Pi 11、全后端 750 通过且 7 项跳过、小程序协议 126、原小程序浏览器 10 个驱动、TUI 单元 9/3/2 与终端 8/7/8 检查点。实际 PR59 V4 持久检查点升级有 2 项合成验证。这些分母互有重叠，不累加成独立总数；此段记录基线结果，最终变更另以最终源码验收记录为准。

原首轮全后端与首次构建错误地并行，9 项在 dist 尚未生成时失败；构建完成后的顺序重跑通过。新网页驱动保留修复前手机抽屉 display:none 的实际截图和失败；后续截图复核又定位空会话继承 flex-row，原委托折叠入口被压到中文最小宽度，追加真实可读性和短屏滚动检查。历史旧入口 browser 断言的失败保留，不能据此恢复已退役页或删除安全检查来制造通过。

`npm run test:agent:acceptance` 是现有完整验收入口。它即使本地自动检查通过，仍退出 1 并明确 `overall: release_blocked`，因为独立审查和真实环境验收没有签署。`npm run check:launch` 仅清点现有证据；不启动真实调用或独立安全任务。当前历史独立安全审查曾被平台拒绝，该项没有重启、换人或改措辞绕过。

当前网页入口的 Chromium 回归为 `npm run test:conversation:browser`，使用原 `createApp`、真实本地 HTTP 与生产 App 构建；可传入独立截图目录。原历史 `test:browser` 和失败证据继续保留。Linux 容器需由测试环境提供其已安装的 Chromium 路径；这不是生产浏览器或生产账号配置。

本轮交付只选源码、测试、报告、日志和产品截图；不复制 Store、Pi checkpoint、运行数据库、Session、上传目录、node_modules、凭据或真实账户配置。合成临时运行目录也不作为用户交付。

## 部署前核对与回滚准备

遵循 [原部署契约](DEPLOYMENT.md)、[统一 Agent 部署说明](AGENT-DEPLOYMENT.md) 和 [GitHub 安装说明](GITHUB-DEPLOYMENT.md)。下列是待授权运维步骤，本轮没有执行：

1. 核对原华为主机、正式域名、现有 systemd 服务、正在运行的精确代码版本、Node 路径、唯一 WORKSPACE_DATA_DIR 及原身份入口；验证真实登录和角色，不能把配置模板或服务器重启当作通过。
2. 对照固定源码/构建清单在新代码目录安装；原 `npm start` 与 `agent:start` 是同一服务，不能同时运行两个 writer。保留原 Muse/Dot、成员、签名入口和既有凭据配置。
3. 切换前确认原 writer 已停止，备份同一时点的完整业务 Store、Pi 持久目录、Agent 投影/文件及审计；独立保留当前身份/OAuth 配置。核对停止、备份完整性与恢复位置，不能单独回滚 SQLite。
4. 代码回退先核对 checkpoint/数据版本兼容性。旧 V4 保持原执行范围；Agent V5 不能借旧普通 retry/resume 或 changed endpoint 恢复。需要恢复数据时使用完整一致快照和新的私有目录，保留当前身份/OAuth、租约和 fence，不能以旧数据库复活权限。
5. 授权切换后记录实际健康、登录/CSRF、单 writer、重启、固定产物 SHA、完整备份恢复及真实已批准业务回执。模型/商店/通知调用另需其原批准；最终开放生产流量由负责人决定。

当前缺口包括生产版本/登录与目标访问、受审完整 Cordis Host 源码及构建导出、真实 Host/Muse/Dot/模型、Shopify/GA4、微信/真机与实际七天、Windows 特定验证、独立安全门槛及未启动的 CI jobs。开发测试通过不能代填这些证据。
