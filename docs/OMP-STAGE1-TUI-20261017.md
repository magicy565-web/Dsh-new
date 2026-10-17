# 阶段1：会话历史解析与 TUI 验收

同一开发分支与 Draft PR99，最终相关测试源码 `d0aba8c8e8f0cdf943d6bdf15a8fc0f21441aac1`；之后仅保存本文及脱敏交接证据。固定路线以 [开发计划交接](DEVELOPMENT-PLAN-HANDOFF.md) 为唯一当前计划。未接入其他 PR、未扩业务、未调用真实模型。

## 会话历史解析

此前已准确构造原 SDK 的合法 model_usage 捕获活动叶反例，移除自写分支选择，直接复用锁定 OMP18.10.4 的 buildSessionContext；live传原活动叶，Node最终交付通过有界只读Bun调用同一原函数。22项差分/畸形日志和当前来源真实Host拒绝、实际SDK发送、Node最终交付均在本轮同一源码重新验证。旧journal/proof不改写，不扩大授权；活动中的不透明摘要/notes仍拒绝。详见 [解析修复证据](OMP-NATIVE-BUSINESS-CONTEXT-20261017.md)，未确认自然生产触发或真实泄漏。

## TUI 超时的准确原因与修复

旧测试调用 `scripts/workspace-omp.mjs` 默认入口，却等待只属于原HTTP终端的 `terminal model disabled`。当前默认已是离线原生预览：它实际显示 `model unconfigured · no HTTP`，不会因 WS_AGENT_URL 自动选择HTTP。此处是入口/就绪判据错配，不能用此前基线同症来认定环境已定位或问题已解决。

另一个独立问题是 previewGate 对所有 input 返回 handled:true，连 `/quit` 也被吞掉。现仅放行精确 `/quit` 给原CLI处理，其余自然输入继续明确拒绝模型执行；before_agent_start和禁网络门保留。预览配置关闭原生启动动画，使就绪后输入稳定，不修改上游SDK。

旧HTTP用例改为显式 `scripts/workspace-omp-legacy.mjs --terminal`，原有read-only/人审/停止断言保持。legacy帮助文本与实际入口一致；无TTY和不支持的business TUI在启动终端或服务前明确拒绝。默认入口保持离线预览，没有恢复成隐式HTTP入口。

| 入口 | 本轮验收与限制 |
| --- | --- |
| 默认原生预览 | 真实POSIX PTY连续启动2次、正确就绪、自然输入unconfigured、/quit均退出0；WS_AGENT_URL指向本地探针仍0 HTTP请求。CLI使用--no-session，预览是临时界面，不声称恢复业务Session。 |
| 显式原HTTP UI | 真实原OMP InteractiveMode → 原HTTP/Run，显式有限模型替身；自然输入只读、人工执行确认/拒绝、未配置0 Run反馈、停止确认及退出通过。 |
| 原认证人工恢复 | approval/continue/cancel、原Pi checkpoint及原business-task恢复，保持原ID、预算与文档哈希；不是把OMP transcript当Pi checkpoint重放。 |
| 无TTY | 默认 NATIVE_OMP_TTY_REQUIRED；显式HTTP终端 OMP_TERMINAL_TTY_REQUIRED。 |
| business profile TUI | OMP_BUSINESS_TUI_UNAVAILABLE，启动前拒绝；继续使用已有认证business Web/API，不在阶段1新建该TUI桥。 |

根因证据基线为 `e3a8451873ad6d1d67760b6996c0d4402522a5c6`：git原文件中的旧入口调用/旧gate callback与当前gate逐项对照，摘要保存两个gate源码哈希及确切断言；实际PTY另验证当前入口/退出与原恢复。没有再将“等待字符串超时”笼统当成环境阻塞。

## 同一源码完整相关验收

| 组 | 结果 | 忽略目录日志 |
| --- | --- | --- |
| native | 20 passed，0 failed/cancelled/skipped | `stage1-d0aba8c-native.tap` |
| sdk | 22 passed，0 failed/cancelled/skipped | `stage1-d0aba8c-sdk.tap` |
| regression | 110 passed，0 failed/cancelled/skipped | `stage1-d0aba8c-regression.tap` |
| context | 22 passed，0 failed/cancelled/skipped | `stage1-d0aba8c-context.tap` |
| reset | 7 passed，0 failed/cancelled/skipped | `stage1-d0aba8c-reset.tap` |
| controls | 50 passed，0 failed/cancelled/skipped | `stage1-d0aba8c-controls.tap` |
| tui | 18 passed，0 failed/cancelled/skipped | `stage1-d0aba8c-tui.tap` |
| pack / build:omp | 14插件闭包、原生compile/discover/load及disable/uninstall通过 | `stage1-d0aba8c-pack.log` / `stage1-d0aba8c-build-omp.log` |

固定Node24.19.0、Bun1.3.14、OMP18.10.4，以清空业务环境的 `env -i PATH="$PATH" HOME=/tmp NO_COLOR=1` 执行。精确命令、源码tree、计数及SHA256见 [验收摘要](validation/omp-stage1-tui-20261017-summary.json)。各组有交集，不能累加为独立总数；不是全仓/真实服务通过声明。tui18项含新增默认预览4项与显式HTTP/恢复/启动14项，未删掉旧自然输入/人审安全用例。

所有模型与业务身份/授权、Worker/支付等均为明确替身；原SDK/Store/Host/PTY及原控制实际执行。默认预览0 HTTP，显式HTTP用例只访问本地合成Host，不能混称全程无HTTP。真实模型及外部业务调用0，Mem0向量关闭。原预算/权限/队列/AgentLoop未扩展。

## 本轮结束与后续门槛

阶段1本轮范围验收完成；不进入阶段2。真实模型、价格和剩余预算尚未核对，不调用真实模型、不读凭据或创建配置。business TUI、真实外部服务、私有交付正文、完整浏览器及既有Medusa等缺口保留。远程CI未重查/重触发。
