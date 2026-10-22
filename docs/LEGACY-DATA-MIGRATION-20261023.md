# 老应用数据迁移（2026-10-23）

把老单工作区存储（`server/store.mjs` 的 v1–v3 状态文件）里的**会话与消息**导入
Harness 的 `.harness-data/workspace.json`。

## 用法

```powershell
# 1) 先看会导入什么（默认 dry-run，不写任何文件）
node scripts/migrate-legacy.mjs --from C:\backup\legacy-state.json

# 2) 写入（建议先做一次运维备份）
node scripts/migrate-legacy.mjs --from C:\backup\legacy-state.json --to .harness-data --apply
```

输出是一份 JSON 报告：`dryRun`、`conversations`、`messages`、`skipped`、
`skippedReasons`、`samples`，写入时还有 `bytes`。

## 规则

| 项 | 规则 |
| --- | --- |
| 输入 | 只读；`version` 必须是 1/2/3，否则拒绝（`MIGRATION_VERSION`） |
| 上限 | 单个集合超过 5000 条拒绝（`MIGRATION_TOO_LARGE`） |
| 会话 | 需要 `id`、非空 `title`、合法 `createdAt`；`updatedAt` 缺失时回落 `createdAt` |
| 消息 | 需要能映射到已导入会话、`role` 为 user/assistant、非空 `content`、合法 `createdAt` |
| 不猜 | 每条被跳过的记录都带原因，绝不修补、不补时间、不补角色 |
| 幂等 | 会话/消息 id 由 `sha256("legacy:<类型>:<老 id>")` 确定性生成，映射写入 `harnessLegacy`；重复执行导入 0 条 |
| 不伪造 | 不导入 run、事件、审批——历史消息本来就没有这些 |
| 附件 | 不迁移（二进制附件仍在老应用目录） |

## 迁移后的验证

```powershell
node --test scripts/legacy-migration.test.mjs
```

测试里有一项关键断言：迁移后的状态能被**真实的 `workspace-chat` 服务**读取
（`listConversations` / `readConversation`），而不是只“看起来像”正确结构。

## 回滚

迁移只写 `workspaces.local.harnessChat` 与 `workspaces.local.harnessLegacy`，不删除任何
既有数据。要回滚：先用 `POST /api/ops/backups` 备份，再用
`POST /api/ops/restore` 恢复即可；也可以直接恢复到迁移前的 `workspace.json`。

## 尚未迁移

- 老应用的 `goals`、`activity`、`memories` 集合；
- 业务库（`businessLibrary`、产品/客户/询盘数据）；
- 附件二进制。
