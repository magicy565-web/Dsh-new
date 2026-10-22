# workspace-ops

运维面：这个 Harness 现在是什么状态，以及怎么安全地备份/恢复。

## 状态

`GET /api/ops/status`（仅管理员）：

```json
{
  "version": "0.1.0",
  "node": "v24.x",
  "pid": 1234,
  "uptimeSeconds": 3600,
  "storage": {
    "directory": "…/.harness-data",
    "bytes": 459308,
    "counts": { "workspaces": 1, "conversations": 77, "runs": 105, "goals": 8, "schedules": 4, "inbox": 10, "sessions": 0 }
  }
}
```

计数直接来自 durable state，不猜业务键；未知键一律忽略。

## 备份

```text
POST /api/ops/backups      写一份 JSON 快照到 <storage>/backups/backup-<时间>.json
GET  /api/ops/backups      列出备份（id / bytes / createdAt）
POST /api/ops/restore      { backupId, confirm }  confirm 必须原样重复 backupId
```

恢复规则：

- 只有管理员；
- 备份必须是 `{ workspaces: {…} }` 形状，否则 400；
- 大小上限 8 MiB；
- **confirm 必须等于 backupId**，否则 409——恢复永远是显式动作；
- 恢复会整体替换 durable state，并写入 audit（`ops.restore`）。

## 验证

```powershell
node --test plugins/workspace-ops/test/ops.test.mjs
node scripts/ops-smoke.mjs
```

冒烟：真实进程读状态 → 写备份 → 列表 → 按 ID 恢复成功 → 错误确认 409 → 未知备份 404。
