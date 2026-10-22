# 发布闸门（release gate）

一条命令跑完这个产品的**全部**验证：单元测试、每一个端到端冒烟、doctor。

```powershell
node scripts/release-check.mjs                        # 全量
node scripts/release-check.mjs --json release-report.json
node scripts/release-check.mjs --skip-smokes          # 只跑单测 + doctor
node scripts/release-check.mjs --skip-tests           # 只跑冒烟 + doctor
```

退出码：全部通过 `0`，任一步失败 `1`。

## 它跑什么

1. **单元测试**：自动发现 `plugins/**/test/*.test.mjs`、`scripts/*.test.mjs`、
   `packages/harness-kernel/test/*.test.mjs`，用一个 `node --test` 进程跑完；
2. **端到端冒烟**（按顺序）：chat、runner、guarded、schedules、ops、access、
   factory、procurement、quotes、purchases、quote-tool、purchase-tool；
3. **doctor**：`wh doctor -c harness.local.yml`（组合与 26 个插件的健康检查）。

每一步都**继承标准输入输出**，失败时你能直接看到原始报错，而不是被包装成一行摘要。

## 一个运维细节

闸门启动前会检查 `.harness-data/workspace.lock`：

- 锁的 owner pid 已经不在 → 自动清理并打印警告；
- owner 仍存活 → **绝不动**（返回 `owner-alive`，让真实冲突暴露出来）；
- 文件不可读 → 不动，交由人工判断。

这条规则来自一次真实事故：进程被强杀后残留的锁让后续冒烟“无输出地挂住”。

## 报告

`--json` 会写出：

```json
{
  "ok": false,
  "startedAt": "…", "finishedAt": "…", "node": "v24.x",
  "steps": [{ "name": "smoke quote-tool-smoke.mjs", "args": ["scripts/…"], "ok": true, "ms": 8123 }]
}
```

`ok` 是整体结论；`steps` 里能直接看出哪一步、耗时多少。

## 已知限制（本机验证到的事实）

- `--skip-tests` 路径（12 个冒烟 + doctor）在本机稳定通过：**13/13**。
- 完整路径（把 `node --test` 作为子进程拉起的单测步骤）在**当前沙箱**里会挂住：
  闸门自身打印了 `=== unit … ===` 之后，子进程不再产出、也不退出。同样的测试文件在
  前台直接运行时全部通过（153/153）。因此：**单测请在前台跑**，闸门先用 `--skip-tests`
  作为冒烟+医生的守门；等子进程问题定位后再打开完整路径。
## 边界

- 闸门只验证**本机**行为：不联网、不读真实 Medusa、不发外部请求；
- 它不替代人工验收（页面视觉、真实数据源连通性仍需人看）；
- 冒烟共享同一个 `.harness-data`，因此断言用增量或显式基线，而不是绝对数量。
