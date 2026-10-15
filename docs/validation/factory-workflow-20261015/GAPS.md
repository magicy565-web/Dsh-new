# #70–#74 验收缺口与证据边界

本页记录 2026-10-15 的收口状态。最新询盘语义见[未审核草稿修正](../factory-inquiry-review-boundary-20261015/README.md)，终端有界复现见[可靠性调查](../omp-reliability-20261015/README.md)。使用者是中国工厂，目标是整理本厂材料、研究海外买家／经销商候选来源、理解询盘并保存待人工审核的文书。工程组件通过、合成模型链通过、真实业务通过是三个不同结论。

交付位置为 [Draft PR68](https://github.com/magicy565-web/workspace-agent/pull/68)，分支 `codex/pi-business-thread-adapter-20261014`，基线 `1fe5bbbff9d7c1f1ceb9cf13c1f9da790b86e37d`。资料、公开研究与询盘三个检查点分别为 `5fd0cf80ab7f146b05d2ffe5c49539b2b1fa9eda`、`cd3c22d09710e7b8668d1bc00facb642c56423a8`、`c5858398f5232ea76ba34191d3d9fb2f2ceac9da`，均已推送并核对远端 SHA。PR57 的供应商测试不计入本页任何结果。

这里的“实际组件”指运行了原 HTTP／Session／Store／artifact 服务、官方 Pi／OMP SDK／CLI／InteractiveMode／原生工具或子进程；测试材料、企业身份、Session 和模型响应仍可能是明确合成的。有限 keyless 模型替身证明调用链及断言，不证明真实推理质量、生产企业授权、余额、买家身份或业务效果。

## 实测／合成／未做矩阵

| 范围 | 实际组件与已过验收 | 合成或只读证据的边界 | 真实验收缺口 |
| --- | --- | --- | --- |
| #70 单入口、原权限与生命周期 | 默认 Workspace 入口沿原 Conversation／Run；官方 OMP TUI、原 Host Session 内存 handoff、CSRF、审批决定与独立继续、取消、原 Pi checkpoint 和业务恢复均有组件验收。见[终端证据](../omp-terminal-fixes-20261015/README.md)、[核心检查](../workspace-omp-core-20261014/README.md)。 | 原服务与官方组件是真实运行；身份、输入和模型为测试 fixture。没有用 Agent Bearer 冒充 enterprise Session，也没有第二业务账本。 | 实际部署的企业既有 Session／成员绑定、安全真实模型与预算尚未验收。两次终端偶发失败的原因仍未知，详见下文。 |
| #71 本厂资料与文档 | 检查点 `5fd0cf8`。独立包 **5/5**；原 Library／签名 Session HTTP／原生文本及 PDF 提取 **7/7**；受控原 Run／OMP worker 等范围见[已保存验收](../factory-materials-20261015/README.md)。exact ID／revision／documentVersion／artifactVersion／SHA、接收方、期限、成员／企业、撤权和模型前缓存拒绝均有测试。 | 实际解析公开合成文字 PDF／扫描 PDF／截断／坏 PDF；不是读取真实企业材料。原生 PDF OCR 提示是启发式；无提示不证明每页已读。没有 OCR／vision，也不证明证书真实性。 | 未提供并实际验证真实企业材料的明确可用授权。普通安装仍 unconfigured；私库 profile 与公开研究 profile 隔离，不能迁移旧私库 transcript 或把资料授权当公开搜索许可。 |
| #72 公开客户来源 | 检查点 `cd3c22d`，远端 SHA 已核对。独立包 **4/4**，原 Host／OMP／原 `factory-export` **3/3**；来源 URL、时间、原工具、原 Task／四阶段／三文书 SHA 有链路验证。见[包证据](../factory-customers-20261015/README.md)、[原 Host 输出](../factory-customers-20261015/original-host.txt)。 | 正向来源 HTML 明确合成；模型有限 keyless。浏览器有原准入／拒绝与合成页面组件测试，不据此认定真实客户网页导航成功。命中只能是候选来源，匹配、采购意向、联系人及联系许可不自动成立。 | 唯一次本插件实际原生 DDG 请求为 **PROVIDER_REFUSED、零来源**，未解决。该 wrapper 未返回确切 HTTP code，不能把它写成已实测 HTTP403；合成403是另一项。没有真实候选来源或获客效果验收。 |
| #73 询盘与审核草稿 | 独立包 **7/7**。最新原 Library／artifact 服务与实际 OMP 路径 **9/9**：首次保存三原文件、同 cid 第二 Run 相同 requestId 不重复、partial 保存后真实 app／原 Store reload 再补齐原 ID、源变化在新模型调用前拒绝、实际 HTTP 取消至 save 前 gate 后零新文件且原输入保留。见[纯模块](../../../packages/workspace-factory-inquiries/src/drafts.mjs)、[原服务测试](../../../test/factory-inquiries.test.mjs)、[原 Host 测试](../../../test/workspace-omp-factory-inquiries.test.mjs)。 | 实际组件使用合成上传数据和有限 keyless 模型。literal substring、完整 draftHash 与原 artifact 保存验证通过；旧版本 confirmed 参数不是具体草稿经真人审核的证据，已改为仅保存未审核草稿，不等于真实客户询盘或已批准报价。模型输出、文书保存均没有外部发送。 | 未提供真实授权询盘／产品并完成真人文书复核。价格投影未开放，因此价格、币种、税、条款等全 pending；样品库存、费用、派样日及收件人未知。不能将这些草稿称为实际报价、派样或跟进成交。 |
| #74 真实工厂闭环 | 前述组件和合成链可作为手动验收基础，原身份、权限、Run、预算／审批和文书出处继续是唯一 authority。 | 本轮真实模型调用 **0**、付费调用 **0**。合成计数不证明真实账户此前消费为零，也不证明 CNY5 尚有余额。 | **blocked**：真实企业材料的明确授权、安全模型配置及原累计 CNY5 预算的可核实证据尚缺；#72 真实来源也仍 blocked。没有真实材料→真实候选→真实询盘→真人审核文书的完整验收。即使以后条件具备，也不自动扩大到联系、接单、付款或派样。 |

固定社区 cold-email v2.2.0 方法及 MIT 许可证已按 commit `55ff469422c3592dac45bcad08dfb40221981c02` 核对；[包根 sources.json](../../../packages/workspace-factory-inquiries/sources.json)记录固定 URL、资源 SHA 和许可证 SHA。仅作独立简短写作方法改编。读取 GitHub 软件源码／许可证不是检索海外客户来源，不计为 #72 或 #74 通过；未安装全集或执行账号、域名、发信、自动跟进指令。

## 综合结果与仍保留的稳定性风险

- 本轮相关整合 **25/25** 通过，原回归 **70/70** 通过。最新 inquiry 范围 **9/9** 中新增两项与这些阶段组合有重叠，不能相加宣称另跑了一套 27 项。各包测试与服务测试也不能简单相加为独立业务用例总数。
- 最后补充的普通 CLI 启动检查 **4/4** 通过，见 [startup-check.txt](startup-check.txt)。资料／询盘 profile 准确报告 `original-reviewed-session-policy-required` 和公开工具禁用；这仅表示需要原审核策略，不表示已获授权、已连接或已调用模型。子进程使用隔离环境与新建空 HOME，没有读取或注入真实凭据。
- 最新最终串行 OMP **43/43** 通过，耗时 **115.853 秒**。此前 #71 已保存的一次 [43/43 输出](../factory-materials-20261015/omp-43.txt)耗时 112.784 秒，是另一轮，不混写为同次结果。
- 更早有两次 **42/43**：并行组合中终端 shell 拒绝提示观察超时，串行组合中未配置 TUI 退出返回 exit1。单独终端及诊断重复随后通过，但偶发原因仍未定位。最新完整通过不能抹掉失败，也不能证明调整为串行已修复原因；最终工程回归通过与长期稳定性验证应分别表述。
- inquiry 重放曾命中原身份 HTTP 速率限制。现只在同一模型校验边界内按**完整回执** canonical hash 去重，下一模型边界重新校验；内层 Library 使用实时 Session／Run 与中央 scope 检查，外层工具／RPC／模型及保存／每 artifact 前后保留 fresh Agent-binding proof。未提高限额、自动重试或新增凭据；实际第二 Run 重放已通过。见[原服务实现](../../../server/factory-inquiries.mjs)、[受控会话 guard](../../../server/workspace-omp-session.mjs)。
- 已保存的 [CI 记录](../omp-terminal-fixes-20261015/ci.json)是创建 jobs 前 `startup_failure`、jobs=0，追踪于[既有 Issue 16](https://github.com/magicy565-web/workspace-agent/issues/16)。root已补查 `c585839` 的 Actions run `38674345185`：仍为 `startup_failure`、jobs=0；另保留 `cd3c22d` run `38672894110` 同状态。不把本地通过当 hosted Actions 成功，也不猜测账号原因或为此盲改应用。

## 真实验收所缺输入与原 Host 手动步骤

以下是后续需要由已授权操作者核实的条件，本页没有执行这些动作，也没有新增权限或凭据流程。

1. **先提供可核实材料授权。** 由原企业成员通过现有 Library 上传／审核流程选定产品、询盘与文档。需明确原 workspace／成员／现有 Session、允许字段、记录 revision、文档及 artifact version／SHA、期限、同一接收模型 provider／model／destination；只使用已批准范围。[现有资料接口与策略](../../FACTORY-MATERIALS.md)可复用。不能从普通安装、Agent Bearer、旧聊天或已有文件存在性推导授权。公开研究须另有明确可公开的短产品 brief，不能直接转发私库 DTO、内容或历史。
2. **由原 Host 核实安全模型与累计预算。** 维护者通过既有安全配置流程确认实际模型、目的地、有效计价及原累计 CNY5 的已消费／可用余额和停止边界，提供脱敏的可核对结果；不把密钥、Cookie 或完整配置粘贴进聊天。token 上限、价格 JSON 或 `LIVE_BUDGET_VERIFIED` 标志不是现金余额或累计消费硬上限证明。当前没有这些证据，真实调用继续拒绝；不扫描 HOME、环境、历史记录、账号或旧密钥来补齐。
3. **只核对原入口和 profile。** 可由操作者运行既有 `npm run workspace -- --check`，核对固定 runtime、配置状态及原 Host 身份绑定；check 不是模型付费测试。资料／询盘分别使用原审核的独立 profile；公开客户研究使用公共 profile，不跨 scope 继承历史。未配置准确停止，不用 faux、另一模型、另一账户或 Pi fallback 自动补跑。
4. **保留真实来源阻塞。** 当前原生搜索拒绝，没有候选证据。本任务不再次探测、不切 provider／代理／端点、不绕挑战、不用 raw HTTP 或另一个 web 工具冒充原生成功。以后只有在既有 Host 的网络可用性有可核实依据后，才由操作者另行手动验证原工具回执；没有 URL／时间／摘录就继续 blocked。用户明确提交的公开来源可标为“用户提供、未独立核验”，不能算原生检索通过。
5. **满足前置条件后才人工走原链。** 先以原只读 Run 检查授权状态、询盘原文及版本、缺项与抽取状态；收到 blocked／partial 时保留原因。原显式执行意图可保存三份未审核内部草稿；draftHash 只证明数据完整性，不能证明真人审核。具体文书／版本仍待真人复核，任何后续外部动作须走其原审批边界，本插件不签发审核结论。保存后核对原 conversation／creating Run、原 artifact ID／version／SHA、相同 requestId 重放及取消回执；不另造存储或执行循环。文书必须继续标为未发送与待人工审核，未知价格、库存、派样日和前次联系不能由模型补出。

七天未来通知的持续同意、持久 recipient 权限和撤销机制**未开发、未激活**；一次对话或草稿确认不是持续通知许可。本轮不扫描账号、不联系任何人、不执行真实店铺或外部 Worker 写操作，不创建真实凭据，不付费；禁止 main／merge／force push／部署／npm 发布。本页只记录缺口，不将真实闭环、外部业务或生产上线标为完成。

补充只读核对：GitHub #70–#74 均仍 open，原验收清单未改、未关闭任何未真实验收项。终端两项旧故障在六轮隔离及三轮双进程并发中均未复现；原因仍未定位，新增失败诊断不等于修复。新完整组合发现并修复的是公开 profile 拒绝文案契约回归，不能把它当作终端偶发故障根因。

最后完整并行 OMP 组合 **45/45**、exit0（65.752 秒）：在历史43项上加入两项启动状态检查。它覆盖相关终端范围但不消除旧偶发根因未知的风险。具体日志及失败的44/45前一轮均保留在可靠性调查目录。
