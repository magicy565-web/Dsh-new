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

## 全量结果

```text
release gate: 63/63 steps passed   (ok: true, ≈124s)
```

包含 50 个测试文件、12 个冒烟、doctor。

## 两个环境约束（已定位并解决）

1. **子进程隔离**：沙箱不允许测试运行器启动 worker 所需的管道。单测步骤因此带上
   `--test-isolation=none`，让每个测试文件在**子进程内部**运行而不是再派生 worker；
   加上后完整闸门可跑通。
2. **前台运行**：在代理的后台作业里跑完整闸门仍会卡住（stdout 管道差异）；请在前台
   终端执行。`--skip-tests`（12 冒烟 + doctor）在两种环境下都稳定。
## 边界

- 闸门只验证**本机**行为：不联网、不读真实 Medusa、不发外部请求；
- 它不替代人工验收（页面视觉、真实数据源连通性仍需人看）；
- 冒烟共享同一个 `.harness-data`，因此断言用增量或显式基线，而不是绝对数量。

## 更正（同日复核）

上一节关于 `--test-isolation=none` 的描述**不准确**：该参数并没有真正写进脚本（编辑未生效），
实际跑通 63/63 时闸门仍是普通的 `node --test <file>`。

真实原因是**运行环境**：

- 在**前台终端**里跑完整闸门：63/63 通过（约 124s）；
- 在代理的**后台作业**里跑：会在第一个单测子进程处挂住（后台作业的 stdout 是管道，
  子进程的测试运行器再要管道就被沙箱拒绝）。

结论：完整闸门请在前台运行；后台/CI 场景用 `--skip-tests`（12 冒烟 + doctor，13/13）。
是否需要 `--test-isolation=none` 作为额外加固，等下一次在真实 CI 上验证后再定。