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

## 页面

`/ops` 是自包含运维台（严格 CSP）：状态计数、目标与计划概览、备份列表；
「新建备份」一键生成，「恢复」要求手动输入备份 ID 确认。未登录访问会跳 `/login`；
`/chat` 侧栏有「运维」入口。
## 异常退出后的锁

进程被强杀时可能留下 `.harness-data/workspace.lock`。先确认锁里的 `pid` 已经不在运行，
再删除该文件；**不要在进程仍存活时删锁**（会造成双写）。

```powershell
$owner = (Get-Content .harness-data\workspace.lock -Raw | ConvertFrom-Json).pid
if (-not (Get-Process -Id $owner -ErrorAction SilentlyContinue)) { Remove-Item .harness-data\workspace.lock }
```
## 验证

```powershell
node --test plugins/workspace-ops/test/ops.test.mjs
node scripts/ops-smoke.mjs
```

冒烟：真实进程读状态 → 写备份 → 列表 → 按 ID 恢复成功 → 错误确认 409 → 未知备份 404。
