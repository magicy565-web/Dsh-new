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
| 目标 | 只导入状态可无歧义映射的：`draft→open`、`done→done`、`cancelled→cancelled`；其余（如 `running`）跳过并记 `GOAL_STATUS_*`，由人决定 |
| 记忆 | 一律导入为 `proposed`（`kind: observation`、`source.verified: false`），必须经人工审核才变成 `active`；`enabled:false` 的跳过 |
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

## 附件导入

```powershell
# 预览
node scripts/migrate-attachments.mjs --from C:\backup\attachments
# 写入（走真实 artifacts 服务）
node scripts/migrate-attachments.mjs --from C:\backup\attachments --to .harness-data --apply
```

- 通过**真实 artifacts seam** 写入（配额、sha256、状态结构都由服务负责，脚本不手写状态）；
- `requestId` 由相对路径派生：同一目录重复导入只报 `duplicates`，不会生成重复文件；
- 单文件 > 5 MiB 跳过（`TOO_LARGE`）；扩展名映射不到的类型按 `application/octet-stream` 存；
- 目录遍历有界（深度 4、最多 500 个文件）；
- 导入结束会释放 artifacts 写锁，因此可以连续多次运行。

验证：`node --test scripts/attachments-migration.test.mjs`（含 dry-run 不写、字节级往返、
二次运行全部 duplicate、超大文件跳过、目录遍历有界）。
## 尚未迁移

- 老应用的 `activity` 集合与业务库；
- 业务库（`businessLibrary`、产品/客户/询盘数据）；
- 附件二进制。
