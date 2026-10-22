# workspace-inbox

把自主发生的事汇到一处：计划触发、待批准。

## 规则

- **只有内部服务能推送**（`trustedService`）：人不能给自己的收件箱伪造通知；
- 推送到别的 workspace 的条目会被拒绝；
- `dedupeKey` 在 24 小时内只产生一条未读，避免定时器重复刷屏；
- 只存通知与**引用**（approvalId / runId / scheduleId），不复制 run、goal 或文件。

## 生产者

| 事件 | kind | 引用 |
| --- | --- | --- |
| 计划到期派发 | `schedule.dispatched` | `scheduleId`, `runId` |
| 计划派发失败 | `schedule.blocked` | `scheduleId` |
| 工具调用待批准 | `approval.pending` | `approvalId`, `runId`, `conversationId` |

## HTTP

```text
GET  /api/inbox/status
GET  /api/inbox?status=unread|read|all&limit=
POST /api/inbox/read-all
POST /api/inbox/:id/read
```

`GET /api/inbox` 返回 `{ total, unread, items }`，`unread` 是全部未读数（不受 `status` 过滤影响）。

## 页面

`/inbox` 是自包含收件箱页（严格 CSP）：未读/全部切换、未读计数、逐条「标记已读」、
「全部已读」；显示通知类型、时间、正文与引用（approvalId/runId/scheduleId 缩写）。
首页 `/home` 也有入口。
## 验证

```powershell
node --test plugins/workspace-inbox/test/inbox.test.mjs
node scripts/schedules-smoke.mjs   # 计划触发 → 收件箱
node scripts/guarded-smoke.mjs     # 待批准 → 收件箱
```
