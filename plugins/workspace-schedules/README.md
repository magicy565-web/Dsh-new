# workspace-schedules

让目标自己动起来：到期把一次工作派发进对话，走既有的 chat → runner 管道。

## 模型

```text
disabled ──enable──► enabled ──due──► (at) done
                        │
                        └──(every)──► 下一次未来时刻，继续 enabled
```

派发失败（例如对话已满）会把计划置为 `blocked` 并记录 `DISPATCH_FAILED:<code>`，
不会无限重试。

## 派发语义

- 到期时向 `conversationId` 发一条消息（内容 `prompt`，可带 `goalId`），由 chat
  创建 run、runner 执行；
- 派发 ID **由（计划，到期时刻）确定性生成**：`schedule:<scheduleId>:<dueAt>`。
  重启或多 tick 只会重放同一个 run，不会重复派发；
- `every` 只补**最近一次**错过的时刻，然后跳到未来，不制造积压；
- 回执只记真正的派发（create 的幂等记录不算回执）。

## HTTP

```text
GET  /api/schedules/status
POST /api/schedules             { requestId, title, prompt, conversationId, goalId?, kind: at|every, at?, everySeconds? }
GET  /api/schedules?status=&limit=
GET  /api/schedules/:id         计划 + 最近派发回执
POST /api/schedules/:id/status  { status: enabled|disabled, note? }
```

新计划默认 `disabled`，必须由人启用。`everySeconds` 最少 60 秒。

## 页面

`/schedules` 是自包含计划页（严格 CSP）：列表显示状态、周期/一次性、下次触发；
一行内可启用/停用；点击某行看最近派发回执（到期时刻、派发时间、run）。右侧表单可
新建计划（选择对话、可选目标、周期或一次性）。新计划默认停用。
## 验证

```powershell
node --test plugins/workspace-schedules/test/schedules.test.mjs
node scripts/schedules-smoke.mjs
```

冒烟会真的等定时器触发：创建 → 启用 → 到期 → 对话里出现 prompt → run 由
`service:scheduler` 发起 → 回执指向该 run。
