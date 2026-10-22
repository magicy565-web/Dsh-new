# workspace-chat

会话、运行与事件流的 Harness 插件。它是聊天产品的底座：只持有**会话、消息、run、事件**，
不调用模型、不执行工具、不审批任何东西。

## 为什么先有它

聊天产品的一切都挂在 run 上：上下文快照、审批票据、产物、恢复、取消。先把 run 的身份和
状态机定下来，后续能力都只是往 run 上挂数据，而不是各自再存一份会话。

## 数据

| 集合 | 说明 |
| --- | --- |
| `conversations` | 一个会话：标题、状态（open/closed）、创建者、时间 |
| `messages` | 一条消息：`user` / `assistant` / `system`，带 `runId` |
| `runs` | 一次执行：状态、发起人、时间、`snapshot`、取消时间、错误、用量 |
| `events` | 只追加的事件日志，`seq` 全局单调，供 SSE 重放与审计 |

所有数据按 `state.workspaces.<workspaceId>.harnessChat` 分区；跨工作空间读写返回 404。

## run 状态机

```
prepared ──► running ──► blocked ──► running ──► completed
    │           │           │
    └───────────┴───────────┴──► cancelled / failed
```

终态是 `completed` / `failed` / `cancelled`；任何越级转换返回 409 `CHAT_RUN_TRANSITION`。

## HTTP

```text
GET  /api/chat/status
POST /api/chat/conversations                 { requestId, title? }
GET  /api/chat/conversations?status=&limit=
GET  /api/chat/conversations/:id?messageLimit=
POST /api/chat/conversations/:id/messages    { requestId, content, selection? }
GET  /api/chat/runs/:id
POST /api/chat/runs/:id/cancel               { reason? }
GET  /api/chat/runs/:id/events?after=<seq>   text/event-stream
```

所有写操作要求 `requestId`：同 id 同内容重放原结果，不会重复建会话/消息/run。

## 事件流

- 帧格式：`id: <seq>` + `event: <type>` + `data: <json>`；
- `?after=<seq>` 只重放更新的历史，客户端断线重连不会丢事件也不会重复；
- 订阅先重放、再跟随；同一条事件即使重放与实时推送同时命中，也只发一次（按 `seq` 去重）；
- 终态事件（`run.completed` / `run.failed` / `run.cancelled`）之后连接关闭；
- 每 15 秒发一行 `: keep-alive` 注释帧，避免中间层掐断；
- 客户端断开时停止订阅，不会泄漏监听器。

## 与 runner 的关系

runner（后续的 `workspace-runner`）通过插件提供的 `chat` 服务推进 run：

```js
chat.advance({ actor }, runId, 'running');
chat.appendMessage({ actor }, runId, { content: '…' });
chat.advance({ actor }, runId, 'completed', { usage: { outputTokens: 12 } });
```

这些方法不在 HTTP 面上暴露：外部调用者只能取消，不能假装一个 run 已经完成。

## 页面 `/chat`

自包含 HTML（严格 CSP、无外部资源、无构建）：左侧会话列表，右侧消息流与输入框。

- 发送后订阅该 run 的 SSE，把 `run.delta` 追加到当前回答气泡；
- 顶部显示状态（准备 / 生成中 / 已完成 / 失败），失败显示错误码；
- 「停止」调用 cancel；断线用 `after=<lastSeq>` 重连，最多两次；
- 未配置模型时提示设置 `DEEPSEEK_API_KEY` 并打开 `llm-bridge.enabled`。


## 审批（guarded execution 的底座）

模型要执行有副作用的动作时，run 不能自己继续：它会进入 `blocked`，把**确切的
action / resource / payload** 交给一个人决定。

- 只有 runner（`trustedService: true` 的进程内服务）能创建审批；HTTP 上没有任何
  "请求批准"的入口，模型无法自己批准自己；
- `GET /api/chat/conversations/:id/approvals` 列出待决审批；
- `POST /api/chat/approvals/:id` `{ decision: 'approve' | 'deny' }`：批准把 run 从
  `blocked` 恢复为 `running`，拒绝把 run 置为 `failed(APPROVAL_DENIED)`；
- 审批有 TTL（30–3600 秒，默认 300）；过期后不能再批准，也不会悄悄放行；
- 每次请求/决定都写事件（`run.approval_requested` / `run.approval_decided`）与 audit；
- `/chat` 页面把待决审批渲染成卡片，显示动作、资源与完整参数，批准/拒绝即时生效。

注意：审批由 `workspace-runner` 消费——模型请求工具 → run 阻塞 → 人在页面批准 →
runner 用人类角色换取一次性票据 → 工具执行 → 回答。`scripts/guarded-smoke.mjs` 覆盖整条链路。

## 消息选择

页面上的「附文件」按钮会把文本文件上传到 `/api/artifacts`，并以 chip 显示；发送时
自动带上 `selection.artifacts`。附文件上限 512 KiB，只支持 UTF-8 文本。
## 消息选择

`selection: { skills: [name], artifacts: [fileId] }`：最多 8 个技能、4 个文本文件。
选择随 run 保存；runner 解析成固定版本（技能正文哈希、文件版本 + SHA-256）后写进
`run.snapshot`，缺一不可、不会静默降级。

## 验证

```powershell
node --test plugins/workspace-chat/test/domain.test.mjs plugins/workspace-chat/test/plugin.test.mjs
node scripts/chat-smoke.mjs
```

覆盖：幂等创建、状态机、取消、跨工作空间隔离、损坏数据 fail closed、SSE 重放/跟随/重连/去重。
