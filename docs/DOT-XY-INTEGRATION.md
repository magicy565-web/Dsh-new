# ChatGPT dot「xy」→ Workspace 云 Worker 接入

本模块接入的是**已经存在的 ChatGPT 个人 dot「xy」通过受审核插件主动领取工作**，不是重新造一个 LLM Personal Agent，也不声称 OpenAI 公开了 dot 的外部 `POST /tasks` API。

## 真实接口依据

当前 dot「xy」已暴露的插件动作（在当前 ChatGPT 会话中可发现）：

- `workspace_worker_identity` — 查询 dot 邀请身份
- `workspace_worker_inbox` — 获取工作收件箱的公开任务引用
- `workspace_worker_read_task` — 读取经授权公开任务
- `workspace_worker_claim_task` — 原子领取，保持原始 requestId
- `workspace_worker_status` — 检查取消或是否仍具执行权
- `workspace_worker_heartbeat` — 续租原来的 attemptId/fence
- `workspace_worker_upload_file` — 保存原始工具生成文件（不超过 1 MiB）
- `workspace_worker_submit_result` — 提交摘要、公开来源和原始工具回执
- `workspace_worker_report_blocked` — 报告执行阻塞，不重新领取
- `workspace_worker_confirm_stop` — 实际停下后确认
- `workspace_worker_ack_event` — 只记录事件收到，不授予执行权限

本次连接中，直接调用 `workspace_worker_identity` 与 `workspace_worker_inbox` 均收到“内部工具错误”。这并不说明 dot 不存在，只说明**现有插件服务端不可用或未能完成调用**。不能把该错误改写成“xy 在线”。

OpenAI 的公开 dot 产品文档支持在 ChatGPT 中分配目标、使用插件及云电脑，但当前找不到向用户个人 dot 从第三方服务器直接推任务的公开端点。因此采用插件**主动拉取**方式。出处：

- https://openai.com/index/introducing-dots/
- https://help.openai.com/en/articles/20001530-getting-started-with-your-dot
- https://learn.chatgpt.com/docs/dots

## 实际源码

- `server/dot-worker-bridge.mjs`：11 个 dot 插件任务动作的持久状态机；单活领取、租约 fencing、禁止隐式重试、原始上传文件 SHA-256 验证、结果证据、取消确认
- `server/index.mjs`：与现有 Workspace HTTP/API 和单企业状态库集成，新增单独的 Dot 插件鉴权；外部 dot 不得到 Workspace 管理员会话
- `server/worker-desk.mjs`：新增真实 `queued` 状态，明确区分「已排队未领取」和「开始执行」
- `src/Workers.tsx`：`queued` 展示为「待 Dot 领取」而非虚构执行中
- `src/CloudExperts.tsx`：主页显示 dot「xy」受审核登记、最近握手、任务排队/领取/提交状态；不伪造在线或执行成果
- `docs/dot-worker-openapi.json`：可供实际 Workspace 插件实现/审阅的严格 API Contract，操作 ID 对应现有 11 个插件工具

## 受控部署（默认关闭）

须由企业和 dot 本人明确批准后才能在已授权的 HTTPS 部署主机启用。服务端只监听 loopback，由企业 TLS ingress 暴露极窄的 Dot 任务路由。该路由不共享企业浏览器的会话 Cookie、全局管理员权限或账号秘钥。

服务器配置只存已核准插件密钥的 **SHA-256**，明文仅存在可信插件服务端的 Secret Manager；不要在聊天、仓库、静态前端、文档或命令行中写明文。示例环境变量：

```text
WORKSPACE_DOT_WORKER_ID=chatgpt-dot-xy
WORKSPACE_DOT_OWNER_ID=xy
WORKSPACE_DOT_BRIDGE_TOKEN_SHA256=<64位小写 SHA-256>
WORKSPACE_DOT_ENABLED=0
WORKSPACE_DOT_SCOPE_REVIEWED=0
WORKSPACE_DOT_EXTERNAL_BUDGET_VERIFIED=0
```

**上线门槛**：企业明确审核本人 dot 的身份与插件连接，部署公网 TLS 与网络控制，确认第三方计费/服务商可执行的硬预算限制，才可把三个值设为 1。ChatGPT Dot 产品计划配额不等同于可供第三方检验的资金硬上限。如果不能验证第三方硬限制，保持未启用，不能当作付费可执行 Worker。

**独立的数据权限限制**：该桥接只保证 Workspace 向 dot 发送的任务字段为经确认的公开范围，无法控制 ChatGPT dot 自己已有的记忆、其他插件或个人账号。企业生产接入前，dot 的拥有者必须单独检查并限制其可访问的个人/企业账户及工具权限；任何输出都要人工检查是否混入无权提交的资料。本模块不能把“公开任务”误称为“个人 dot 完全沙箱隔离”。

现有 `Workspace___xy` 插件必须指向实际部署的 `/api/dot-worker/v1` 入口，按 OpenAPI Contract 用**受保护的服务端 Bearer**提交，不允许将插件凭据放在前端或任务正文。现有插件调用返回内部错误，说明这一端到端绑定**尚未通过**。普通 Dot 聊天不会凭空接收到新任务；dot 必须调用它自己的收件箱和领取工具，或后续另外构建经过授权的事件触发。

## 业务闭环

1. 企业在 `/workers` 选择一个专业岗位，绑定经审核的 `chatgpt-dot-xy` 适配器；`/services` 可见真正的公开研究任务单。
2. 管理员确切批准产品、市场、目标、来源验收标准、期限、预算，然后按 `dispatch`。WorkerDesk 先写入 durable Dot 队列；状态为 `queued`，不谎称 dot 已开始。
3. dot「xy」在其云端会话中调用 `workspace_worker_inbox`，按 `taskRef` 读取，原子领取，得到 `attemptId / fence / leaseUntil`。仅允许一个未结束的个人 dot 任务，租约过期绝不静默换尝试。
4. 执行前和执行中主动检查 `workspace_worker_status`，续租 `heartbeat`。Dot 仅处理确认可外发的公开产品及市场研究，不能浏览企业私有 RFQ、直接发营销邮件或创建订单。
5. dot 用自身被授权的真实研究/设计工具做事，以原始回执 ID 与来源 URL 记录证据；用 `upload_file` 保存准确的报告 bytes/hash，并 `submit_result`。
6. WorkerDesk `refresh` 从受控存储读取文件和结构化结果，若为经销商开发，必须包含带官网与原始来源的 `prospects`；否则标记 `result_incomplete`。真实审核员再决定 `accept`，归档到 Workspace Artifact，必要时明确导入商机池。
7. 取消是两阶段确认。排队尚未执行可直接取消；已领取则 dot 见到取消信号后停止并调用 `confirm_stop`。普通 `cancel` 绝不虚构已停机。

### 结构化 buyer-discovery 文件

Dot 上传的 JSON 文件应具有 `schema: "workspace.worker.delivery.v1"`、与任务完全一致的 `orderId`，以及 `deliverables`、`evidence`、`prospects` 数组。每条 prospect 应有 `name`、`country`、`website`、`fitReason`、`sourceUrl`。未经独立核验的任何客户或数据均保留 `independentlyVerified=false`。工具回执为 dot 自报字段，只有经过真实底层工具校验后才能声称证据可信。

## 验证和限制

已增加 `test/dot-worker-bridge.test.mjs` 与 `test/dot-worker.http.test.mjs`，覆盖原子租约、重复尝试、文件 checksum、提交证据、真实 Workspace HTTP 生命周期及重启恢复。

**当前不能宣称真实 Dot 执行已通过**，因为既未获得可用的现有 `Workspace___xy` 插件响应，也没有经审查的 Dot 外部成本控制和已部署 TLS 服务。使用模拟测试 Worker 与本地 Node 验证不代表真实 ChatGPT dot 的云电脑已接受任务。
