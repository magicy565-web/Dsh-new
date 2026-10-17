# 原生 business Session 的受控上下文继续

本轮从 `9aed6a7331da12f468f9bea4b54e6f2c44722592` 接续同一开发分支与 Draft PR99。完整相关补验源码 HEAD：`64df960e0aa785cfef299cbea4c2e49340eb0194`。后续仅保存说明和脱敏证据；没有从 main 重做，没有第二 Session、业务队列、AgentLoop、权限/预算框架或新数据库。

## 真实可用路径与工具盘点

“可用”指配置了各自原 Host、精确接收者及审核范围后可调用，不表示默认安装或真实外部服务已连接。默认入口仍只有 local-materials；business 清单的六类能力仍分别判定配置和授权。

| 能力 | business 中的实际工具 | 本轮路径及边界 |
| --- | --- | --- |
| 原 Library 资料 | materials_status / materials / document | 现有原签名 Session 与精确字段/版本选择；产品读取继续走原 materialsClient。任意私有文件、入库不在本轮开放。 |
| Shopify 产品 | product_read / image / readiness / propose / review / execute / reconcile / result | 组合路径实际读取受选产品；本轮无真实 Shopify 配置、发布或外部写入。模型可见工具名不等于具备执行许可。 |
| 七天 | market_validation_product / plan_save；market_monitor_request / status / control_request | 保留原计划/监测 Host；需要独立配置和人工执行门。未在新组合路径启动监测/广告。 |
| Brain | sources / context / context_save / diagnose / decision / decision_save / review_save / brief | 实际保存原 Artifact 中未人审、不可执行的经营决策；Goal 与来源审核使用显式替身。没有批准商业任务。 |
| Marketplace | status / find / propose / order | 实际发现原已审核 listing、准备一条未确认 draft，再下一轮读取原 owner 状态；不开放私有输入/交付正文、付款、批准、派单和远端轮询。 |
| Medusa | status / preview / reconcile | 原 Library 受限只读投影桥保留；真实 Medusa 未配置，原生产品管理与 Library 权威仍分开。 |
| 原 skill 读取 | workspace_skill | 只读取已选静态技能，不能调用人工控制或扩大身份/数据权限。 |

工具名均带其既有 workspace 前缀；详见各插件 manifest/extension。未声称全部14包或其他隔离 profile 已完成同会话真实业务连接。

组合正常控制使用同一个原 OMP Session：第一轮读产品、保存 context 和经营 decision；第二轮发现 Worker、准备内部 draft；下一轮查询 draft 状态。每轮仍受原4次模型调用上限，未引入自定义工具循环。随后通过原 Marketplace 的本地人工取消使 draft 合法变为 cancelled，未调用远端 Worker。

## 状态变化如何继续

旧状态对应的原 proof 仍失效。常规继续先返回 `OMP_CONTEXT_REFRESH_REQUIRED`，零新增模型请求；不会静默接受旧 proof、补签旧 journal 或自动替换旧 assistant 内容。

用户在原已认证 Web/API 人工控制入口明确确认清空模型上下文：

```http
POST /api/conversations/{conversationId}/terminal-controls
Content-Type: application/json
```

```json
{"operation":"resetContext","confirmed":true,"requestId":"unique-stable-human-request"}
```

继续使用应用现有 Session/CSRF 传输，不创建凭据或配置。202 响应给出原 Run ID；通过 `GET /api/conversations/{conversationId}/terminal-status?runId={runId}` 读取结果，成功后发普通下一轮消息，重新读取当前已授权产品、decision 和订单状态。`GET /api/conversations/runtime` 会报告 `contextReset: confirmed-original-human-control`。这次提供后端 API 操作说明，没有新增浏览器按钮或声称 UI-only TUI 支持 business profile。

- 必须是原会话拥有者及既有写角色，confirmed 必须为 true；普通消息新增 resetContext 参数被400拒绝，模型无此工具。
- 活动 Run 存在时409拒绝；先等结束或用原取消入口停止。没有既有原生 business Session 时409拒绝，不新建第二 Session。
- 复用原 SDK `resetSessionContext()`：保留同一 native Session ID、文件和旧 journal/proof 字节，追加原生 reset_boundary，丢弃全部旧模型消息并关闭旧 provider continuation。没有自动迁移或重签历史。
- 清空控制沿原 Runtime/Run 执行，模型请求和使用 token 均为0。取消仍能阻止最终交付；若原边界已落盘，取消不会伪造回滚。没有改原预算体系或承诺额外退款。
- 原 Run 幂等 hash 区分人工清空与普通消息；未知应答使用原 requestId 精确重试，不能用普通消息冒认清空结果。
- SDK 与原 Node 最终交付只验证原活动分支最新 reset_boundary 之后会进入模型的依赖；没有 reset 时保持原全部历史检查。按原 parent 链解析，不让旁支 reset 隐藏当前来源；断链/循环拒绝。原文件的 title/session 元数据不当成消息。
- 需要的原 disclosure guards 仍根据完整审计历史核对；插件禁用不能借清空绕过。重新读取时仍执行当前 Session/Run、owner/workspace、接收者、用途、字段/版本与撤权检查。

当前 scope 被撤回后，清空只删除上下文，不能恢复授权；随后私有订单工具返回明确 unconfigured，没有 view。跨企业绑定在真实活动原 Run 上仍以 MARKETPLACE_SCOPE_REQUIRED 拒绝。已授权 Library 产品/Goal 来源本身变化，需要原审核入口重新选择/确认；此操作不能自动修复旧 decision 的依赖，也不迁移 context。

## 本轮验证与替身边界

原签名 Host、磁盘 Store/Library/Artifact、WorkerDesk、原 fd3、官方 OMP 18.10.4 以及原 SDK reset 实际执行。身份、审核回调/Goal 断言、listing/报价、Worker/支付和模型/SSE 均明确为合成替身。未进行真实外部模型或业务调用，Mem0 向量关闭。

| 执行组 | 结果 | 本地忽略日志 |
| --- | --- | --- |
| native | 20 passed，0 failed/cancelled/skipped | `business-reset-64df960-native.tap` |
| sdk | 21 passed，0 failed/cancelled/skipped | `business-reset-64df960-sdk.tap` |
| regression | 110 passed，0 failed/cancelled/skipped | `business-reset-64df960-regression.tap` |
| reset | 10 passed，0 failed/cancelled/skipped | `business-reset-64df960-reset.tap` |
| controls | 50 passed，0 failed/cancelled/skipped | `business-reset-64df960-controls-backend.tap` |
| pack / build:omp | 14插件闭包、原生 compile/discover/load 与 disable/uninstall 通过 | `business-reset-64df960-pack.log` / `business-reset-64df960-build-omp.log` |

全部命令均使用 Node24.19.0、审计过的 Bun1.3.14 和 OMP18.10.4，以 `env -i PATH="$PATH" HOME=/tmp NO_COLOR=1` 清空业务环境。命令、精确计数、SHA256、源码 tree、受控继续布尔证据见 [验证摘要](validation/omp-business-context-reset-20261017-summary.json)。这些是有交集的相关回归组，不能相加冒充独立总数，也不是当前全仓测试声明。

SDK 21项由原14项与清空后7项组成：两组正常控制各进入一次本地有限 SSE 替身，其余13及6个拒绝场景入口计数均为0。清空后覆盖 hook 与实际 Request.text 后的 scope/source 变化、取消和插件禁用；正常控制实际出站体含当前 cancelled 状态，不含旧模型消息或未审核私有输入。原forged仍精确检查 Host 的 MARKETPLACE_SOURCE_CHANGED。最终发送验证使用真实活动 Run 和同一个原客户端的只读 loopback 探针；生产 fd3 另由前置正常回合实际执行。

fetch 入口计数保持第一步，内容断言不被吞掉。本轮复验局部 revalidateReceipt 绕过变异：进入一次合成 fetch，测试以1!=0失败，随后恢复并校验 fixture/父测试哈希；预期失败不计为通过项。这证明测试对绕过敏感，不是生产已越权的证据。

旧 context 最终读取竞态、Brain decision 实际 SDK、原 Runtime/人工控制及幂等也在 controls 组执行。额外首次扩展组51项为50通过、1失败：既有 public TUI 的30秒初始化等待失败，未到达业务断言。单独在当前源码重跑仍失败；在同一环境的原交付基线 `9aed6a7` 临时只读工作树上，复用相同固定依赖也复现同症，基线源码无改动且临时树已移除。本轮没有修TUI或将失败计为通过；后端相关6文件单独串行完整复验50项通过。三个失败日志及哈希在摘要的 additionalTuiDiagnostics 中保留。这不是完整TUI/浏览器验收。历史更大回归属于各自旧检查点，远程 CI 的既有 startup_failure 报告未在本轮重查或重触发。

## 剩余缺口

既有 public TUI 初始化测试在交付基线及当前源码均失败，单列为未解决阻塞。仍未连接真实企业审核源、模型/Provider/Worker/支付；未验收私有交付正文/Artifact 的模型披露、Marketplace 完整浏览器体验、其他隔离 profile 全部组合，以及既有 Medusa 实例/迁移/权限映射等。合法变化后的自动快照刷新没有实现；用户明确清空整个模型上下文后，须在原权限下重新读取。不存在权限的来源继续拒绝。
