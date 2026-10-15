# OMP 入口修复与企业原控制验收

对应 [Issue70](https://github.com/magicy565-web/workspace-agent/issues/70)。本轮复用固定官方 OMP18.10.4、Bun1.3.14、原Workspace HTTP/Session/CSRF/ingress与Pi Durable账本，没有新登录、凭据、权限或任务引擎。

独立修复提交：`0c048e61694af8c910e4276af9c9692c8584c8ac` 使普通自然输入只读，`/ws-execute TEXT` 经可见人工确认才授予原任务提交意图；真实官方PTY中模型实际尝试工厂提交被拒绝，Escape不创建Run/任务，确认后恰一个原任务。此专项验证准入，不宣称其合成后台文书已经完成。见 [intent.json](intent.json)。

`5a5e37079fb0987d688335e5d90be1775e1346cb` 清理每Run自有公开资料副本：正常关闭、取消、初始化部分失败、后续缓存初始化拒绝均覆盖；worker强制结束后宿主按该原Run精确前缀兜底，保留原件及其他Run标记。实际ReadTool、worker abort/exit及PID消失已验证。见 [snapshot-cleanup.json](snapshot-cleanup.json)。

企业终端由已有认证Host调用 `launchWorkspaceOmpWithExistingSession`，经既有Session请求闭包和私fd3，仅转发当前原会话白名单。所有Session/CSRF/签名材料和成员Bearer留在原Host/服务；企业UI子进程不持这些材料或模型密钥。新窄控制路由核对原Session成员/角色/workspace与原Agent绑定/实例/接收方，复用原Pi API和预算、批准、继续、恢复检查。缺执行配置仍拒绝，状态和取消不把未知价格当零。未提供已有handoff的直接企业CLI仍拒绝，不提供取cookie或新登录办法。

真实官方InteractiveMode/PTY三种合成验收：原Pi checkpoint实际重启后 `/ws-resume`；精确proposal `/ws-approve` 决定与 `/ws-continue` 执行分开；原活动Run `/ws-cancel`；原工厂阶段实际重启后 `/ws-business-resume`。每项先Escape，确认无变更，再Enter，仅执行一次原操作。保留原Run/native task/预算/stage ID/文书SHA，恢复后的3份正式文书与1份原partial历史分别计数。原OMP前台本身不是Pi Durable checkpoint，没有被重放。企业恢复弹窗只显示必要原ID、状态、阶段和SHA，避免完整历史JSON把标题挤出屏幕。见 [enterprise-controls.json](enterprise-controls.json)。

最新整合43/43、零跳过；原Pi/Library/业务70/70、原Node RPC/Muse9/9、typecheck通过。官方SDK/TUI是真组件；模型是明确有限无密钥替身，不是真实模型或真实业务验收。真实模型调用0；现有安全模型配置和原累计5元预算均未可核实，保持阻塞。真实部署的企业Session连接也未宣称完成。

本机启动：`npm run workspace -- --check` 后 `npm run workspace`；所需固定安装器见 [入口说明](../../WORKSPACE-OMP.md)。企业启动复用该文档中的已有Host函数接线，不传签名密钥给终端。

真实公开网络另测：DDG HTTP403、IANA公开浏览器超时，来源均未成功；未改道或处理挑战，见 [public-network.json](public-network.json)。可复核脚本是 `scripts/omp-public-network-probe.mjs search|browser --confirm-public-network`，须使用固定Bun；普通离线测试不会执行它。

CI依旧 `BuildFailed/startup_failure` 且零jobs，见 [ci.json](ci.json) 和既有 [Issue16](https://github.com/magicy565-web/workspace-agent/issues/16)。没有runner、构建或测试日志；具体账户/注册原因当前授权接口不可得，没有归因于应用测试或猜测计费。以上本地通过均不是CI成功。无部署、main修改/合并、真实发送或生产动作。
