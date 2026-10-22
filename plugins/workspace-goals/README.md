# workspace-goals

把多次运行聚合成一个可追踪、可推进的目标。

## 模型

```text
open ──► active ──► blocked ──► active ──► done
  │         │           │
  └─────────┴───────────┴──► cancelled
```

`done` / `cancelled` 是终态，不能回退；越级转换返回 409 `GOAL_TRANSITION`。

## 数据

目标只保存意图与状态：`{ id, title, description, status, createdBy, createdAt,
updatedAt, closedAt, note }`。**不复制聊天数据**——某个目标下有哪些 run，是通过
`ctx.chat.listRunsByGoal()` 现查的，所以 run 的真相始终只有一份。

## HTTP

```text
GET  /api/goals/status
POST /api/goals                 { requestId, title, description? }
GET  /api/goals?status=&limit=
GET  /api/goals/:id             目标 + 该目标下的 run 摘要
POST /api/goals/:id/status      { status, note? }
```

创建要求 `requestId`（重放返回原目标）。viewer 可读，不能改状态。

## 与聊天页的关系

`/chat` 侧栏有「目标」列表：点一下把当前对话绑定到该目标，下一条消息自动带
`goalId`，并把目标从 `open` 推进到 `active`。新消息的目标关联写在 `run.goalId` 与
`run.snapshot.goalId`，因此目标详情能直接列出这些 run。

## 验证

```powershell
node --test plugins/workspace-goals/test/goals.test.mjs
node scripts/chat-smoke.mjs
```
