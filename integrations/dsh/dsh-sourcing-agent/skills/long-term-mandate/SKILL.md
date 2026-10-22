---
name: long-term-mandate
description: 把项目变成长期委托：目标、成功标准、授权范围、检查节奏、运行日志；用 Host 定时任务唤醒冷会话继续推进，以及暂停/恢复/完成的协议。
whenToUse: 用户说「长期帮我做」「接下来几个月你盯着」「不用我每次催」；或已有项目需要持续运营、复盘与推进时。
---

# 长期委托

一次会话做完的是任务；跨周、跨月、没人盯着还能继续的是**委托**。委托不是把对话拉长，而是把「目标 + 授权 + 节奏 + 日志」写进项目，再用 Host 定时任务叫醒自己。

## 委托记录

`sourcing_mandate` 把委托存进项目：

- **目标**：一段话，说明委托要拿到什么结果。
- **成功标准**：1-8 条，可核对（例如「首月 50 单」「CAC < 8 美元」）。
- **授权**：`research`（研究）、`drafts`（起草）、`outreach`（approval / allowed / never）、`spendLimit`。
- **节奏**：每 N 天检查一次，最长委托周期 horizonDays。
- **日志**：每次 checkin 记 summary、actions、blockers、criteriaMet。

一个项目同时只能有一个生效中的委托。

## 建立委托（顺序不能反）

1. 项目已经在推进（至少 `sourcing_project create` 完成）。
2. 调 `schedule_create` 建一个唤醒任务，**prompt 用固定模板**：

   ```
   委托检查：项目 <projectId>（<title>）。
   先 sourcing_mandate read，然后按 nextActions 执行；对外发送或花钱前先确认。
   完成后 sourcing_mandate checkin，写清 summary / actions / criteriaMet / blockers。
   ```

   节奏与委托一致：`daily`、`weekly`、`cron` 或 `every_seconds`（≥60）。title 用「商机委托：<title>」。
3. 拿到 `schedule_create` 返回的 id，调 `sourcing_mandate activate`：
   `objective`、`successCriteria`、`scheduleId`、可选 `reviewCadenceDays`、`horizonDays`、`authority`。
4. 把「委托已生效、下次检查时间、授权边界」用三句话告诉用户。

## 每次被叫醒的协议

1. `sourcing_mandate read`：看目标、成功标准、上次阻塞、`nextActions`。
2. 按 `nextActions` 执行：先补闸门 blocker，再渲染产出物，再 `sourcing_stage advance`。
3. 只在授权内行动：`outreach=approval` 时只起草不发送；`spendLimit` 是上限，不是目标；研究/起草默认允许。
4. 完成后 `sourcing_mandate checkin`：summary（做了什么）、actions、criteriaMet（1-based 序号）、blockers。
5. 如果这次让某条成功标准达成，在 checkin 里标记；全部达成时委托自动 completed，**删除定时任务**并给用户一份交付总结。

## 暂停、恢复、完成

- **暂停**：`sourcing_mandate pause` + 用 `schedule_delete` 删掉返回的 `scheduleId`。暂停中的委托不能 checkin。
- **恢复**：重新 `schedule_create`，再 `sourcing_mandate resume`（带新 scheduleId）。
- **完成**：成功标准全中 → 自动 completed → 删定时任务 → `sourcing_render` 出 `09-mandate.md` 与 `dashboard.html`。
- **到期**：超过 `expiresAt` 仍未完成，提醒用户续期或收窄目标，不要默默继续。

## 边界

- Host 必须运行才会投递提醒；应用没开时，下一次启动只补最近一次错过的检查。
- 委托不会替用户注册主体、付款、发邮件或投放；这些仍是 `handoff.md` 里的用户动作。
- 不要把多个项目塞进一个委托；一个项目一个委托，目标与成功标准各自独立。
- 委派给子 agent 的会话不能用定时任务；唤醒任务必须属于主会话。
