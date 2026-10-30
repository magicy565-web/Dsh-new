# AI Work：Grok Bot 与 Muse Agent

AI Work 是 DSH 右侧原生工作区。它读取当前会话的 Commerce Network 项目、已登记 Worker 和工单，使用现有审批、租约、交付及验收记录。空项目不会生成示例数据。提供商类型由登记时明确指定为 `grokbot`、`muse` 或 `other`；历史记录未标记时显示为其他 Worker，不按名称猜测身份。

右侧以嵌入式移动 App 呈现，视觉语言为「Worker 工牌」：底部“今天 / 招募 / 任务 / Worker”四个页面。今天页汇总需要你确认的事项（待审批、待验收、停止待确认、派送结果待核对）、进行中的任务和 Grok Bot / Muse Agent；Worker 页把当前项目已登记的每个 Worker 显示为工牌，包含工牌号、维护者、运行于哪个 Agent、真实记录、授予能力和固定的“不会做”清单。每个页面最多一个主按钮，且只用于打开协作画布；协作画布仍通过现有 DSH 标签打开。桌面保持手机宽度，窄屏占满容器，列表独立滚动，浅色 / 深色跟随宿主主题。它复用当前原生会话，不启动额外服务；开通入口按后续提供的方式接入。

工牌上的所有数字都来自 DSH 记录：工牌号是 Worker 记录 ID 的末四位；维护者是登记时指定的协作方（当前均为“未核验”）；已验收 / 已退回 / 进行中按该 Worker 的工单计数；验收率只在已验收与已退回合计不少于 5 条时显示，否则写“样本不足”。不显示“在线”，只显示最近一次网关活动时间。项目内没有声明的运行时（`providerType` 为 `other` 或历史未标记）用中性图标，不按名称猜测。

## 招募与维护者工作台

**招募页**列出本工作区可招募的 Worker 模板：内置三个（询盘汇总、外联文案起草、市场调研）加上维护者在本工作区发布的模板。模板是“岗位说明 + 技能 + 预置任务”的配方，不是已经在线的服务；只在本工作区内可见，不是跨用户的公开市场。支持按名称、简介、技能和维护者搜索，按分类筛选。每个模板如实显示价格提案、运行环境、固定的“不会做”清单和证据；验收率与“已验收 / 已退回”只在两者合计不少于 5 条时显示，否则写样本不足。

**招募**通过现有业主命令 `hire_worker` 完成：选择运行环境（Grok Bot / Muse / 其他）、逐项勾选授予的技能、需要时选择授权的产品资料，可同时带上一个预置任务，它只会作为“待审批”工单被起草，不会自动开始。招募后的 Worker 是普通的已登记 Worker，仍需在协作画布签发专用凭证并握手，审批、租约、交付和验收沿用既有流程。Worker 固定在招募时的版本，维护者发布新版本时只会出现升级提示，由业主通过 `upgrade_worker_hire` 自行升级；新版本新增的技能默认不授予，需要业主勾选。价格变化必须由业主明确确认。

**维护者工作台**从 Worker 页进入，维护者可以创建与保存草稿（`upsert_worker_template`）、把草稿作为试运行 Worker 招募到当前项目、发布版本（`publish_worker_template`），以及暂停接单或下架（`set_worker_template_status`）。发布前账本会检查必填项，并要求每项技能都已有一个真实验收通过的任务；试运行产生的真实任务就是这份证据。已发布版本不可修改，改动只会进入下一个版本。暂停接单或下架不影响已招募的 Worker。所有命令都带版本号校验，别处已更新数据时会提示刷新而不是覆盖。

**价格只是提案**：账本把每次招募的计费状态记为 `not_connected`，不接入任何支付伙伴，不收款也不托管付款；维护者核验状态目前均为“未核验”。因此界面不展示“已付款”“托管中”等无法兑现的状态。设计依据见 `ai-worker-design` 技能；实现位于 `src/AIWork.jsx`、`src/work/`，账本规则在 `worker-catalog.js`，覆盖测试为 `test/worker-catalog.test.mjs`、`test/catalog-view.test.mjs` 与 `dev/ai-work-market-smoke.mjs`。

图标来自 [Grok 官方网站](https://grok.com/images/favicon.svg)和 [Muse 官方网站](https://muse.ai/images/favicon/app-squiggle.svg)，品牌标识属于各自的权利人。muse.ai 是 Meta 个人 AI Agent「Muse」（2026-09-08 发布）的官方网站，标识为其官方图标。开通流程暂不放在本界面。

界面的“网关已认证”仅表示 Worker 凭证已成功访问 DSH，不能证明远端在线、能力合格或真实执行；最后活动时间也不等于在线状态。需要选中真实项目才能看到其 Worker 和任务。其他项目的任务不会混入当前视图。

## Grok Bot：按需 webhook 交接

实现依据旧仓库的 webhook/callback 描述；外部服务的真实地址、鉴权头和实际兼容性尚未核实。当前适配器只支持 `Authorization: Bearer` 出站鉴权，**并不支持**旧代码的自定义鉴权头。配置缺失或无效时禁用交接，不发送请求。准备工作：

1. 明确供应方身份和能力，在当前项目中登记 `providerType: "grokbot"`，由用户在画布签发该 Worker 专用凭证。凭证只显示一次，妥善保管；只保存其摘要。
2. 通过私有主机的安全配置向 DSH 进程提供以下变量，密钥不要写入仓库、日志或会话：
   - `GROKBOT_WEBHOOK_URL`：用户核验过的 HTTPS webhook 地址。
   - `GROKBOT_WEBHOOK_KEY`：webhook Bearer 密钥，16–256 个不含空格的可见 ASCII 字符。
   - `GROKBOT_PUBLIC_ORIGIN`：提供者可以访问的 HTTPS 公网来源，不包含路径或查询。
   - `GROKBOT_CALLBACK_TOKEN`：独立回调 Bearer 密钥，16–256 个不含空格的可见 ASCII 字符；应通过安全渠道交给 Grok Bot。
   - `GROKBOT_WORKER_TOKEN`：上一步签发的该项目 Grok Worker 凭证。轮换凭证后需更新私有配置并重启 DSH。
3. 受信任的 HTTPS 入口只将 `/commerce-grok-api/callback` 反向代理到 DSH 的 loopback；不要把整个本地 DSH 管理界面暴露到公网。当前云环���未配置此公网入口。代理必须限制访问并正确处理请求大小；本服务拒绝携带浏览器 Origin、Cookie 或 Referer 的回调。
4. 在实际原生会话中运行 `commerce_grok_connect`，它只验证配置的 DSH Worker 凭证。创建具体任务，由用户逐项审核权限、资源、预算和期限；然后在同一会话中运行 `commerce_network_dispatch`。只有用户明确要求交接时，才运行 `commerce_grok_handoff`，传入同项目的原工单 ID。

适配器仅将业主审批的任务和资源交给配置的 webhook，并在 `instructions` 中包含允许动作、预算、期限和禁止子委托、发送消息、支付及共享凭证等限制。它不能强制远端实际遵守这些限制；必须独立核验服务商。由于旧回调没有可核验的费用字段，当前仅支持预算为零的 Grok 任务；这不证明服务商不会在外部计费。Webhook 返回 2xx 只表示已接收 HTTP 请求；实际接单或结果需要带回调凭证的有效回调。HTTP 失败、超时或中途重启时交接结果可能未知，界面显示“派送结果待核对”；同一工单的再次调用不会重发。请核对原任务和远端状态，不要盲目新建任务重试。

回调 JSON 支持 `taskId`、`threadId`、`status` (`accepted`、`progress`、`done`、`failed`)、可选 `eventId`、`summary`、`artifacts` 和 `drafts`。`taskId` 使用原工单 ID，`threadId` 使用原生会话 ID。每个不同事件应提供稳定的 `eventId`：完全相同的重放会去重，相同 ID 的不同内容会拒绝；无 eventId 时用完整内容指纹去重，不会把不同的进度按状态合并。`done` 的文本、链接及草稿保存在单一交付中，待用户在画布验收；草稿不发送，链接不会下载。`failed` 仅代表远端报告失败，并不证明远端进程已停止。

**租约限制**：DSH Worker 租约最长 120 秒，且不超过任务截止时间。Grok 需持续在租约内发送有效 `accepted`/`progress` 回调，否则任务过期，迟到结果不能获得执行权限。取消后必须以可靠证据确认远端停止；网关不会假装远端已经停止。旧 Grok 文档没有保证回调频率或停止确认机制，实际接入前需要服务方确认；本代码不会自动续租或自动重派。

## Muse Agent：主动拉取适配器

`dsh-commerce-network/muse-adapter` 是供 Muse 运行环境调用的薄适配层，复用现有 DSH Worker SDK。它不启动进程、模型或轮询。Muse 需要由其自身运行环境主动调用 `connect`、`claim`、`heartbeat`、`status`、`resources`、`submitResult` 和 `confirmStopped`。需要通过安全渠道配置专用的 DSH HTTPS 网关地址与该项目 Muse Worker 凭证。`reportFailed` 记录失败报告，但不会确认远端停止。任务仅在用户审批且 DSH 会话派发后可领取；结果依然需要用户验收。

Muse 侧应保存领取结果中的 `order.id` 和 `order.leaseId`，以原租约发送心跳、读取授权资料、提���文本结果和确认停止。每个请求使用稳定的 `requestId`；网络结果未知时保留原 ID 并先核对，不要创建新执行。轮询及心跳必须符合网关的��速和 120 秒租约。适配器的 `submitResult` 接受文本与来源 URL；它不实现旧接口的文件上传或工具证据契约。

旧 `/api/muse-worker/v1/*` 及其 attempt/fence、upload-file 与 DSH 网关不是同一协议；本适配器不是透明兼容的旧服务。需要把适配器接入真实 Muse 客户端或根据实际协议另做受控映射，再核验真实轮询、取消及交付。目前这些仅经过本地合成测试，没有连接真实 Muse。
