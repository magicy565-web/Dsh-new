# 分支与工作区约定（2026-10-23）

这个仓库目前同时存在**两个 checkout** 和一个发布分支。为了避免互相踩踏，约定如下。

## 工作区

| 路径 | 分支 | 用途 |
| --- | --- | --- |
| `wsa-trunk/` | `release/harness-20261023` | 发布线所在 checkout；另一个会话可能在这里操作 |
| `wsa-dev/` | `agent/harness-20261023` | 固定开发 worktree（本轮建立的隔离环境） |
| `workspace-agent/` | `codex/business-memory-20261022` | 历史 worktree，别在此处开发 |

`wsa-dev` 的 `node_modules` 通过目录联接指向 `wsa-trunk/node_modules`，不需要重新安装依赖：

```powershell
cmd /c mklink /J wsa-dev\node_modules wsa-trunk\node_modules
```

## 分支规则

1. 功能改动只在 **`agent/harness-20261023`** 上做（在 `wsa-dev` 里）；
2. 提交用**显式路径**（`git add <file>`），不用 `git add -A`——避免把别的会话的未跟踪文件带进来；
3. 每个小功能完成即提交并推送，不留长时间未提交的改动；
4. 发布分支**只能快进**：`git push origin HEAD:release/harness-20261023`，从 agent 分支推送；
   如果出现分叉（release 上有 agent 没有的提交），先 `git merge release/harness-20261023`
   解决冲突、跑闸门，再推送；
5. 合并/推送前必须跑完整闸门：`node scripts/release-check.mjs`（当前 68 步）。

## 本轮快进记录

```text
95ec88e3..de43c1b3  HEAD -> release/harness-20261023
```

agent 分支领先 3 个提交（files 页、files 冒烟、会话管理），release 无独立提交，因此是纯快进。

## 遗留

- `wsa-trunk` 本地仍停在 `95ec88e3`，需要时 `git -C wsa-trunk pull --ff-only` 即可同步；
- 若两个会话同时在 `wsa-dev` 之外提交，先 `git fetch` + 对比再合并，不要强推。
