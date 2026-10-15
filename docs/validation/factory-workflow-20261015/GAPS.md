# #70–#74 当前缺口与历史证据边界

恢复开发后的[最新工程验收](../factory-thin-adapters-20261015/README.md)：相关完整回归 **118/118**、共享原服务 **34/34**、最终精确白名单与缓存校验 **12/12**、typecheck通过，均exit0／无skip。12项与118项重叠，不相加。普通CLI启动4项在118项内。下文34ebf77focused结果与停止说明均保留为历史；真实模型／来源／材料、预算、终端偶发及CI缺口未因此消失。2026-10-15 04:47 UTC只读核对#70–#74仍open，未关闭未验收项。

本页以恢复开发的 `34ebf77` 云端保全检查点为当前路径基准；后续主线程的审计和回归需另附实际结果。交付仍为 [Draft PR68](https://github.com/magicy565-web/workspace-agent/pull/68)，分支 `codex/pi-business-thread-adapter-20261014`。中国工厂的目标是读本厂授权资料、评估海外买家／经销商候选来源、理解询盘并保存待人工审核的文书。工程组件、有限合成模型链、真实模型质量和真实业务通过是不同结论。PR57／66 不属于本页验收。

当前实现已经精简：客户包只保留 `workspace_factory_customers_save`，官方模型工具循环直接选用原公开 search/browser／公开文本 review；不再由插件固定 research→browser→factory-export 四阶段。询盘包只保留 `workspace_factory_inquiry_save`，读原资料后由模型提供正文，可询问而不存文件，或保存 1–5 份文书；不再有 prepare、固定三模板、literal-substring requirements 或调用方 expectedDraftHash 确认。原 Host 保留权限、版本、取消、幂等与 artifact 持久化。保存不是内容正确性、真人审核或发送证明。

受控 profile 通过官方 `sdk.loadSkillsFromDir` 加载明确选定的 Skills；`workspace_skill` 只允许已加载名称，经官方 `skill://` resolver/native ReadTool 读取。客户／询盘 profile 不加载通用 factory-export Skill，也不再把完整 Skill 重复追加到提示词。Skill 是模型可选参考，不是另一套执行循环或必须遵循的步骤。主线程本轮再收紧客户／询盘 custom profile：移除旧通用 factory extension／工具和 worker business RPC；客户只留直接公开工具／原生公开文本子代理、save、Skill reader，询盘只留资料工具、save、Skill reader。独立 materials profile 保留原工具并加固定 Skill reader。询盘缓存回执的未知字段、篡改 extraction／input／artifactRef 也须闭合校验；相应新增负向测试及完整回归由主线程执行，本页不提前宣称新结果。

## 当前路径：组件／合成／真实缺口矩阵

| 范围 | 当前组件与证据 | 明确的合成边界 | 真实验收缺口 |
| --- | --- | --- | --- |
| #70 单入口与原生命周期 | 默认 Workspace 沿原 Conversation／Run。官方 OMP TUI、既有 Host Session handoff／CSRF、决定与继续、取消、原 Pi checkpoint／业务恢复已有[组件证据](../omp-terminal-fixes-20261015/README.md)。原模型循环与业务账本未复制。 | Session、企业身份和模型可为测试 fixture；Agent Bearer 不冒充 enterprise Session。新精简路径不自动继承历史完整回归结论。 | 真实部署的 Session／成员绑定、真实模型及预算尚未验收。历史终端偶发失败原因仍未知，见下文。 |
| #71 本厂资料 | 原 Library／Session exact ID、revision、documentVersion、artifactVersion、SHA、接收方、期限和撤权仍是 authority；私库缓存每次模型调用前重授权。见[资料检查点](../factory-materials-20261015/README.md)和[当前接口](../../FACTORY-MATERIALS.md)。 | 实际原生文本／PDF 组件读取的是公开合成材料。OCR 页提示是启发式；无提示不证明每页已读。无 OCR／vision，也不验证证书真伪。 | 未提供并实际验证真实企业材料的明确可用授权。普通包安装 unconfigured；资料授权不允许向搜索／浏览器披露或迁移旧私库 transcript。 |
| #72 公开客户来源与草稿 | 当前包 **4/4**；当前原 Host／OMP worker **4/4**，见[保全交接](../cloud-handoff-20261015/HANDOFF.md)、[包事实](../cloud-handoff-20261015/customer-package.json)、[worker 输出](../cloud-handoff-20261015/customer-worker-4.txt)。唯一 save 收模型正文和 sourceToolCallIds；Host 从原 owned journal 核验成功工具来源，沿原 artifacts 保存。无固定 backend Task／四阶段／三文书。 | 原工具／SDK／服务实际运行，但正向来源 HTML 和模型响应明确合成。包 SDK 的 save client 是替身，Host 测试另验原服务。脚本可直接搜索后结束或保存，不证明真实模型会自主做出正确选择。 | 唯一次该插件实际原生 DDG 请求仍是 **PROVIDER_REFUSED、零来源**；旧 wrapper 未给 exact HTTP code，不写成已实测403。没有真实客户来源／网页导航／获客质量验收；搜索命中不等于匹配、意向或联系许可。 |
| #73 询盘与未审核草稿 | 当前包 **5/5**、原 Library／artifact 服务 **5/5**、原 Host／OMP worker **7/7**，见[包输出](../cloud-handoff-20261015/inquiry-package-5.txt)、[服务输出](../cloud-handoff-20261015/inquiry-service-5.txt)、[worker 输出](../cloud-handoff-20261015/inquiry-worker-7.txt)。唯一 save 接原 selectors、两份 sources、documents 1–5、requestId；原服务新鲜读取来源，仅追加出处／抽取限度／未审核未发送标记。原幂等、partial→app／Store reload、源变化缓存拒绝、取消和 readonly 拒绝有验收。 | 实际服务、原生 Skill 读取和官方模型调度使用合成上传、身份与有限 keyless 响应。问询／一稿／两稿是预设脚本，不是不同真实输入触发智能选择的证明。来源哈希和成功保存不验证正文语义、报价或真人审核。历史日志中的 prepare/hash 名称不改变现 API。 | 未提供真实授权询盘／产品、真实模型质量及真人文书复核。价格、币种、税、条款、样品库存／费用／派样日、收件人及前次联系无依据则 pending。没有真实报价、派样或跟进成交验收。 |
| #74 真实工厂闭环 | 组件和合成链可作后续手动验收基础；原身份、权限、Run、预算／审批、文书出处仍是唯一 authority。 | 本轮真实模型 **0**、付费调用 **0**，精简轮未发真实公开来源网络请求。该计数不证明账户历史消费为零或原 CNY5 尚有余额。 | **blocked**：真实材料明确授权、安全真实模型配置／计价及原累计 CNY5 已消费／剩余额度的可核实证据缺失；#72 真实来源也 blocked。没有真实材料→真实候选→真实询盘→真人审核文书闭环。 |

当前来源：[询盘说明](../../FACTORY-INQUIRIES.md)、[客户说明](../../FACTORY-CUSTOMERS.md)、[询盘保存服务](../../../server/factory-inquiries.mjs)、[客户保存服务](../../../server/factory-customer-drafts.mjs)、[受控 OMP 会话](../../../server/workspace-omp-session.mjs)。完整回归与 typecheck 在 `34ebf77` 保全时尚未重跑；上表是已保存的 focused 结果，不代替主线程后续完整验证，也不将重叠范围相加为业务案例总数。客户原服务另外报告过 **5/5**（session51842，exit0），使用合成 journal／Run 关联和真实原 artifact／Store；原始输出仅在工具会话，见交接记录，不冒充 worker 或真实网站证据。

固定社区 cold-email v2.2.0 及 MIT 许可证保持 commit `55ff469422c3592dac45bcad08dfb40221981c02`；[sources.json](../../../packages/workspace-factory-inquiries/sources.json)记录 immutable URL、资源／许可证 SHA 和 Copyright © 2025 Corey Haines。仅独立简短改编证据相关性、简洁目的、一个低门槛问题和后续新信息，均为可选写作建议。没有安装全集或执行账号／域名／发信指令。读取 GitHub 软件／许可证不是客户来源，不算 #72／#74 通过。

## 历史检查点：保留原结果，不代表当前完整验收

- 资料 `5fd0cf80ab7f146b05d2ffe5c49539b2b1fa9eda`、客户 `cd3c22d09710e7b8668d1bc00facb642c56423a8`、询盘 `c5858398f5232ea76ba34191d3d9fb2f2ceac9da` 是此前推送核对过的检查点。旧总基线 `1fe5bbbff9d7c1f1ceb9cf13c1f9da790b86e37d` 不是本页当前路径。旧[客户证据](../factory-customers-20261015/README.md)的三工具、原 Task／四阶段／三文件，以及旧[询盘证据](../factory-inquiries-20261015/README.md)的 prepare／三模板／draftHash 均已退役；[未审核边界修正](../factory-inquiry-review-boundary-20261015/README.md)是中间历史检查点。历史文件不重写。
- 当时相关整合 **25/25**、原回归 **70/70**、询盘范围 **9/9** 通过；新增项和组合重叠，不能相加称另一套27项。历史包7/7和服务9/9不用于替换上表当前包5/5／服务5/5／worker7/7。
- 历史串行 OMP **43/43**，115.853 秒；资料检查点另有 [43/43](../factory-materials-20261015/omp-43.txt)，112.784 秒，是不同运行。后来历史完整并行组合 **45/45**，65.752 秒，含两项启动状态检查；其前一轮44/45和诊断见[可靠性调查](../omp-reliability-20261015/README.md)。这些都早于新精简路径，不称本轮完整回归。
- 更早两次 **42/43** 涉及终端 shell 拒绝提示观察超时、未配置 TUI exit1。六轮隔离和三轮双进程并发随后未复现，根因仍未知；新完整组合修复过的公开 profile 拒绝文案不是其已证实根因。后续通过和串行运行不证明偶发问题已修复。
- 历史[普通启动检查4/4](startup-check.txt)准确报告资料／询盘需原审核 Session 策略及禁用公开工具；check 不是授权／连接／付费证明。子进程用隔离环境和空 HOME，不取真实凭据。
- 历史询盘重放曾触发原 identity HTTP 限额；只按同一模型边界的**完整回执** canonical hash 去重，下一边界重查。内层 Library 用实时 Session／Run／中央 scope，外层工具／RPC／模型／保存／每 artifact 前后仍用 fresh Agent proof。限额未提高，无自动重试、新凭据或跨请求权限缓存；实际第二 Run 重放曾通过。
- 既有 [CI 记录](../omp-terminal-fixes-20261015/ci.json)在 jobs 创建前 `startup_failure`、jobs=0，追踪 [Issue16](https://github.com/magicy565-web/workspace-agent/issues/16)。此前 `c585839` run38674345185、`cd3c22d` run38672894110 同状态。这里不查新状态、不把本地通过当 hosted Actions 成功，也不猜测账号原因或盲改应用。
- 停止前保全的[初次／中间失败日志](../cloud-handoff-20261015/HANDOFF.md)仍保留；原 schema 引用字段、403与409预期、SDK blocked 回执断言的修正不等于真实模型／业务通过。该交接页的“停止、待更新文档”是当时状态，本页仅更新当前文档语义。

## 真实验收仍需的输入与原 Host 手动步骤

以下动作本页均未执行，也没有新增权限、凭据流程或自动探测。

1. **核实真实材料授权。** 已授权原企业成员通过现有 Library 上传／审核选定产品、询盘及文档，明确 workspace／成员／既有 Session、字段、revision、文档与 artifact version／SHA、期限及同一 receiver provider／model／destination。普通安装、Bearer、旧聊天和文件存在不构成授权。公开研究只用另行明确可公开的短 brief，不转发私库 DTO／正文／历史。
2. **由原 Host 核实模型与原累计 CNY5 额度。** 通过既有安全配置流程确认目的地、有效计价、已消费／剩余和停止边界，仅提供可核实脱敏结果。token 上限、价格 JSON 或一个 budget 标志不是现金余额／累计硬上限证明。不扫描 HOME、环境、旧聊天、账号或密钥补齐；条件缺失继续拒绝真实付费调用。
3. **检查原入口与分离 profile。** 操作者可用既有 `npm run workspace -- --check` 核对固定 runtime、状态和身份绑定。check 不调用或授权真实模型。私库资料／询盘用原审核 profile，客户研究用公共 profile；不跨 scope 迁移 transcript，不用另一模型、账户或 Pi fallback 偷偷补跑。
4. **保留真实来源阻塞。** 当前没有原生真实客户来源证据，不重试、换 provider／代理／端点、绕挑战或用 raw HTTP／另一 web 工具冒充成功。以后若有原网络可用性的可核实依据，再由操作者单独验证原工具 URL／时间／正文回执；用户提供来源只能标为用户提供、未独立核验。
5. **满足前置条件后人工验原链。** 只读查看询盘／产品和抽取缺口；由官方模型决定追问或起草适合目标的正文，而不是要求三模板。用户请求保存且原执行意图允许时，客户保存引用已验证原工具调用，询盘保存引用新鲜原文档／产品 sources，文件数1–5。核对原 conversation／creating Run／artifact ID／version／SHA、同 requestId 重放及取消。来源完整性不证明正文正确或真人审核，文书始终待人工审核、未发送；未知价格／库存／派样／前次联系不能补造。任何后续外部动作仍须原审批，本插件不签发审核结论。

七天通知的持续同意、持久 recipient 权限和撤销**未开发、未激活**；一次对话或保存不是持续通知许可。没有真实联系、接单、派样、店铺／Worker写入或新凭据。#70–#74 的真实验收项未因此关闭；这里不重新查询 issue 状态。禁止 main／merge／force push／部署／npm 发布。
