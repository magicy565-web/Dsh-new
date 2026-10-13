# Workspace 内置 Agent：Pi 接入与兼容契约

当前接口版本为 `1.1.0-pi`。本功能运行在原 Workspace 服务内；三类研究预设、供应商领域和原 Muse / Dot 适配共享原企业身份、Store、Runtime、审批及计划。此文取代 PR44 的独立执行方案，原说明原样保存在 `docs/validation/agent-service/pr44-documents/`，不能把旧验收记录解释为本次结果。

## 1. 业务权威与执行边界

| 数据或执行 | 唯一权威与关联 |
| --- | --- |
| Agent 任务、阶段、输入快照、预算、请求键、公开事件 outbox、文书内容 | 原 `workspace.json` 中 `workspaceAgentTasks`，沿用原 Store 事务及写锁 |
| 模型、工具、排队、运行取消和检查点 | 原 `server/runtime.mjs` 的 `sendMessage` / `recoverPiRun`，通过原 `pi-provider.mjs` 使用 Pi SDK / Durable |
| 阶段到执行的关联 | `task.id → conversationId → steps[].requestId / runId / replyId / contextFingerprint`，原 run 反向保存 `agentTaskId` |
| SSE、文件下载索引 | `WORKSPACE_DATA_DIR/agent` 下 SQLite schema 2；可从原任务 outbox 重建，无独立任务写入口 |
| 商品、供应商记录、Shopify 操作、计划与通知 | 原 `workspaceSupplierServices`、产品库、capabilities、Goal / Schedule、会话消息 |
| 成员、角色、审计、授权范围 | 原 `access.mjs` 与企业成员配置；Agent token 只是一种既有成员的接入凭据 |

原 Store 先持久写任务、事件和文件内容，再同步 SQLite 和落地下载文件，最后唤醒 SSE 订阅者。文件写入、fsync 与哈希检查完成后才登记对应投影。SQLite 提交失败不会发送那条事件；下次同步可重试。投影签名和事件逐条校验防止把不同历史覆盖到已有 seq。删除或损坏投影不能被当作允许重做模型或 Shopify 操作的理由。

`server/agent/engine.mjs` 现在是业务阶段协调及 outbox 投影器，没有 Agent Loop、模型 HTTP 调用或执行队列。每阶段通过原 Runtime 接纳执行；原 run 和阶段关系在同一事务登记。`model.mjs` 仅保留纯内容校验兼容导出。DSH 没有重新进入运行依赖；原 Muse / Dot 协议与 worker 适配保留。

## 2. 既有接口

Base：`/api/agent/v1`。Agent 健康接口仅为 `/api/agent/v1/health`；原根路径 `/health` 由既有 Workspace Host 处理，不得被 Agent 接管。`/install` 和 `/plugin/*` 仍可使用根路径供旧版安装；其余 Agent 接口须 `Authorization: Bearer <用户 token>`。

| 方法与路径 | 保留契约 |
| --- | --- |
| `POST /tasks` | 请求 `{type,title,input}`，异步返回 201 `{taskId,status,events_url}`；新增字段只作兼容扩展 |
| `GET /tasks/{id}` | `{taskId,type,title,input,status,summary,created_at,finished_at,artifacts[]}` |
| `GET /tasks/{id}/events` | SSE；`?from=N` 返回 seq > N，支持 `Last-Event-ID`，查询参数优先 |
| `GET /tasks/{id}/events?format=json` | 返回事件数组；可与 `from` 组合 |
| `GET /tasks/{id}/artifacts` | `[{name,bytes,url}]` |
| `GET /tasks/{id}/artifacts/{name}` | 下载原任务登记文件；校验路径、归属、大小和内容摘要 |
| `GET /presets` | 三份服务端 JSON 预设的 id、名称、说明、必填/可选输入、交付物；阶段计划由 accepted.plan 返回 |
| `GET /health` | 公开服务状态、版本、mode、模型、预设；新增 readiness、runtime、authority、research_capabilities、projection |
| `GET /install` | 动态 Host 的纯文本五步安装说明 |
| `GET /plugin/manifest.json` | 原插件标识、鉴权说明、服务地址、客户端及预设 |
| `GET /plugin/client.py` | 标准库 Python 薄客户端源码 |

原 status 集合保持 `queued / running / done / failed / interrupted`，没有追加不兼容的顶层枚举。参数错误 400；缺少或错误 token 401；他人或不存在的任务、事件与文件 404。未知 type 的 400 响应仍附可用 presets。所有 Agent 错误仍包含字符串 `{error:"..."}`；可增加 `code`、`result` 或 `presets`。权限不足可为 403，冲突为 409，达到原访问速率或任务上限为 429。

### 2.1 幂等与回执丢失

新增可选请求头 `Idempotency-Key`，格式为 1–128 个 ASCII 字符，首位字母或数字，其余允许字母、数字、`.`、`_`、`:`、`-`。它不是凭据，可以由客户端 journal 持久保存。

- 同一既有 `subject + workspaceId`、同键、同一规范化请求内容，返回原任务及原响应字段，仍为 201。
- 同键但不同请求内容：409，明确冲突，不创建第二单。
- 响应携带 `Idempotency-Key`、`Idempotency-Replayed` 头及 `request_key`。旧客户端不传头仍兼容，由服务端生成键；要覆盖“响应完全丢失”必须在提交前由客户端保留键。
- `GET /tasks/by-request/{key}` 查询原任务，使用相同账号隔离；不存在或他人键都返回 404。
- `POST /tasks/{id}/resume`，请求 `{}`，仅在服务端认定可恢复时接续原任务。它不接受修改输入、换模型审批范围或重置预算。不可恢复返回明确冲突，原记录继续可读。

Python 客户端提交前将 request_key 写到 stderr 的 JSON 回执中，传输失败先按原键 GET 查询；不会自动生成新键或盲目重复 POST。需要重提时使用原键与原业务内容。

## 3. 七种事件与历史恢复

每条公开事件仍严格为 `{seq,kind,payload,ts}`，没有新增 envelope 字段。seq 从 1 单任务严格递增；SSE `id:` 等于 seq，`data:` 为这一 JSON。只使用以下七个 kind。

| kind | 保留 payload 与补充说明 |
| --- | --- |
| `accepted` | `{taskId,type,preset,title,mode,plan[]}`；可附 `result`；仅首次接单产生 |
| `stage` | `{stage,title}` |
| `thinking` | `{stage,text}`；简短公开执行摘要，描述实际读输入、调用、写入与缺项；不输出模型隐藏推理 |
| `progress` | `{stage,done:true}`；只在该阶段真实执行成功或明确演示阶段结束后产生 |
| `artifact` | `{name,bytes,url}`；已持久保存且可投影下载的文件 |
| `done` | `{summary,artifacts[],result}`；本次执行终态，含真实完成范围 |
| `error` | `{message,result}`；失败、阻挡或配置缺失有明确事件，已产出的文件继续保留 |

新订阅先从数据库重放，再等待新事件。多客户端各有游标和心跳；断线不会停止任务。实时流和 JSON 回放取自同一已提交事件序列。

当前任务终态时，历史重放后立即关闭连接。**恢复不会删除或修改旧 error；同一任务继续追加新 seq。** 因此一个恢复成功任务的全量历史可包含旧 error 和后来的 done。客户端应读到服务端 EOF 并核对最新 task/result；不能在第一条历史 error 处截断所有后续记录。`resume` 响应的 `result.resumeFrom` 指出本次恢复前最后一个旧 seq。

## 4. 完成度：执行结束与商业结果

任务、accepted、done / error 的扩展 `result.version=1` 用于表达真实结果。顶层 status 仅作旧传输兼容。

| result.state | 典型旧 status | 含义 |
| --- | --- | --- |
| `queued` / `running` / `recovering` | queued / running | 原任务等待、执行或检查点恢复中 |
| `unconfigured` | failed | 正式模式没有可用的原 Pi 模型配置；部分材料保留，可在补配置后恢复原任务 |
| `blocked` | failed | 缺已授权真实检索工具、权限、预算或运行条件，不能冒充完成 |
| `partial` | failed | 原执行失败但部分产物可下载；不会用模板替代业务成功 |
| `interrupted` | interrupted | 原执行需要按检查点或外部回执核对；不会盲目创建替代 run |
| `demo` | done | 仅显式 `WS_AGENT_DEMO=1`；`completion=demonstration_only` |
| `completed` | done | 本研究预设文书阶段完成；`completion=documents_ready` |
| `legacy_unverified` | 原历史终态 | 显式迁入的 PR44 历史；不能追认没有的 Pi 回执 |

所有研究结果的 `businessGoalAchieved` 均为 false：完成文书不代表成交、商品发布、七天经营验证或获得销量。demo 的 execution 为 `explicit-template-demo`；正式任务为 `original-pi-runtime`。缺项原因、是否有部分文件、是否可恢复、尝试次数随 result 提供。前端不能仅凭 done 显示“商业目标已完成”。

正式配置缺失时 health 保留 `mode=model`，另显式 `readiness=unconfigured`；仅凭环境变量齐全显示 `configured_unverified`，不宣称实际模型已通过联调。演示必须显式开启，产物与摘要带“演示模式：未接模型与真实数据源，内容为结构模板，数字为待确认”。失败保存的 `partial-<stage>-attempt-<n>.md` 明示部分交付，不使整单 done。

## 5. 预设、工具证据及预算

保留 `presets/agent/` 的三份 JSON，内容、阶段、提示词、模板、产物与摘要可通过修改配置并重启生效。已提交任务保存预设快照，不会被后来运营改稿静默改变。

| 预设 | 必填 | 阶段与产物 |
| --- | --- | --- |
| procurement | product、spec、quantity | 需求确认、询价包、比价、风险；inquiry-pack.md / comparison.md / procurement-brief.md |
| supplier-sourcing | product、spec | 需求解析、渠道检索、候选核验；suppliers.md |
| opportunity-discovery | product、market | 价格锚点、竞品与差评、结论；opportunity-report.md |

所有正式阶段走原 Pi 工具调用；`workspace_complete_preset_stage` 接收经过结构与来源校验的最终阶段文书。采购可整理用户已提供的 quotes，但未回收写待回收，不用外部搜索假装取得真实报价。寻源和机会任务有代码层面的最低检索能力要求；JSON 配置不能用空 `required_capabilities` 关闭它。真实 `workspace_research` 回执和被引用来源是完成研究阶段的必要条件，模型自称“已搜索”无效。

提供可选 `server/agent/research.mjs` 只读 Brave Search adapter，由原 Pi `workspace_research` 工具执行。必须同时显式启用 `WS_AGENT_RESEARCH_ENABLED=1` 并由服务端注入 `BRAVE_SEARCH_API_KEY`。不启用、不返回来源、来源格式不合格或请求失败时，任务明确 blocked / partial；结果中没有虚构供应商、价格、销量。检索返回网页片段仅是线索，不能自动把供应商分为已核验 A 级，也不能把平台展示价当作成交价。

预算使用原 Runtime 的执行准入与持久记录：当前研究单默认总上限 4 步、6400 输出 token，每阶段最多 1 步 / 1600 输出 token，使用既有原 run 用量或保守预留累计；恢复不能重置总预算。它不是美元账单保证，真实服务提供方的计费限制仍使用原部署及供应商配额。供应商发布和定时读取没有额外模型调用，不以 Pi 提示词保存商业记录。

模型端点通过现有 `PI_BASE_URL`、`PI_MODEL` 和原服务端密钥配置；自定义端点限制为无凭据、query、fragment 的 HTTPS 地址。端点摘要加入原执行权限指纹。端点、输入、授权范围或预算不匹配时不能重放旧检查点。详细执行记录见 [Pi 接线说明](PI-AGENT-RUNTIME-NOTES.md)。

## 6. 恢复与旧数据迁移

原 Store 启动恢复标记中断的 run 后，Agent **只保留并投影原 task/step/run 与 Pi checkpoint，不自动调用 `recoverPiRun` 或再次触发模型**。当前中断任务以 `AGENT_EXPLICIT_RESUME_REQUIRED` 和可恢复状态保留历史事件、部分文件；同一企业成员必须明确调用 `POST /api/agent/v1/tasks/{id}/resume`，才能为本进程的这一原 run 授予一次性恢复权限。权限不会跨进程重启自动继承。随后才在原 Runtime 中复核范围、预算、权限、审批和 submission，接续同一个 run；请求键对本次明确恢复尝试固定，旧事件仅追加不改写。若恢复前再次重启，必须再次明确授权。丢失原 run、检查点不匹配、预算耗尽或工具副作用未知时停止并保留记录。研究预设无发布权限；Shopify 副作用未知时仅只读 reconcile。

旧 PR44 的 SQLite 不作为第二个执行权威保留。升级前停服备份整个原数据；在同一 `WORKSPACE_DATA_DIR/agent` 放入旧档案，通过 `WS_AGENT_PRINCIPALS[].legacyAccountId` 显式绑定原账号到真实既有成员，才能迁入原 Store。未映射档案不暴露。旧已完成任务保留事件、文件及来源标识；旧 queued/running 没有 Pi 检查点，标明无法自动恢复并保留原事件，不伪造恢复能力。数据迁移不是允许自动重做发布或重新收费的授权。

当前保留期为永久。schema 2 的清理工具只提供只读候选统计，`--apply` 明确拒绝单删投影；任务归档必须通过完整业务 Store 的受审运维流程。备份必须覆盖整个 `WORKSPACE_DATA_DIR`，包括原业务记录、Pi 检查点、全部原文件与 Agent 投影，不能仅复制 SQLite。详见 [部署说明](AGENT-DEPLOYMENT.md)。

## 7. 供应商闭环与验收边界

供应商商品流直接消费原 `/api/conversations/{id}/supplier-services` 契约和原小程序 journal，不再复制到研究任务数据库。商品预览、Shopify DRAFT、指定渠道正式发布分开记录和批准。批准绑定 subject、workspace、service revision、preview hash、店铺配置、具体渠道、图片版本和外部草稿。预览或配置变化会使旧批准失效；通用 connector / approval API 不能绕过业务绑定。

七天使用确认发布或用户指定的真实起点、精确商品范围和半开区间，沿原 Goal / Schedule 持久调度。无商品流量 adapter 时保留 unknown / null；不替换为全店 sessions，也不写零。总结复用原会话消息，重复检查更新同一条；`available_in_conversation` 表示服务端可读，外部推送和已读回执没有则保持未配置 / null。

详见 [供应商原契约](SUPPLIER-SERVICE-CONTRACT.md)、[Shopify 发布](SUPPLIER-PUBLICATION-CONTRACT.md)、[小程序接线与源码截图](../miniprogram/SUPPLIER-CLIENT-CONSUMPTION.md)。本轮本地代码、实际 Pi SDK faux transport 和本地 Shopify HTTP 测试不等于真实模型、真实店铺、七个自然日、Muse Vault、微信实机或生产验收。原独立审查源码门禁仍失败，详见 [验收记录](AGENT-ACCEPTANCE.md)。
