# 原 Store 结构化记忆并发修复（2026-10-17 UTC）

固定起点：`f22f8dd2e01765daacb05e770d81cc7a8dac756f`。开发分支：`codex/omp-structured-memory-integration-20261016`。本轮期限为 UTC 03:30（北京时间 11:30），复用 Node 24.19.0、Bun 1.3.14、OMP 18.10.4 和原插件依赖。开始前及推送前核对远端，未覆盖其他提交。只有一个写入任务；前端、旧服务器、旧归档任务均未启动。

## 修复前的真实失败

新增 `test/enterprise-memory-concurrency-real-store.test.mjs`，直接使用原 `openStore` 和 Library 创建合成产品，来源绑定原产品的完整规范 JSON SHA。没有同步 fake Store、模型、HTTP 或外部服务；并发由 `Promise.all` / `Promise.allSettled` 触发，不通过 sleep 猜测窗口。每个案例独立临时目录，实际读取 `workspace.json`，关闭 Store 后重开并比较完整 memory 行。

生产源码未改时，前五项测试 **0/5 通过**：

| 场景 | 修复前落盘/实际结果 | 必须满足的条件 |
| --- | --- | --- |
| 同一新 fact key、不同 requestId | 2 个 active，revision `[1,1]` | 单一 active，revision `[1,2]` |
| 已有 rev1，再并发更新 | 2 个 active，revision `[1,2,2]` | 单一 active，完整 `[1,2,3]` 链 |
| 相同 requestId、相同 payload | 2 行、不同 ID，两次 `idempotent:false` | 一行、一份稳定回执 |
| 相同 requestId、冲突 payload | 两次都 fulfilled，落盘 2 行 | 只允许一个 winner，另一个 409 |
| 来源归档先入 Store 队列，随后 remember | 旧来源检查通过，写入仍 fulfilled | 提交事务看到归档并拒绝 |

日志在忽略的 `evidence/memory-concurrency-before.tap`，不提交运行数据。错误并非 Store 没有串行化：原实现提前从 `store.read()` 取得 `priorRequest` 和 `previous`，之后事务只执行已计算的插入和 supersede，两次调用都带着同一个旧视图排队。

## 最小生产变更

仅修改 `server/enterprise-memory-ledger.mjs`，保持原 Store 的单写入锁、串行事务和持久化，不添加队列、锁、数据库或框架：

- 同一原事务内检查原 Run/Host 的 `assertCurrent`、原角色、全部来源依赖、requestId 的 fingerprint/actor、当前 fact head，然后分配 revision、supersede、插入并返回提交回执。
- 来源递归检查可显式使用该事务的 state，防止事务外旧快照放行已排队的撤源。没有放松 Node 证明、身份或来源边界。
- 以同一 fact 的最高 revision 延续历史，revoked/sync_error 也不重置编号；只把 active 前序改为 superseded，保留 revoked 状态。
- 幂等性以 requestId 为准。不同 requestId 即使文字相同，也各持有一条原 ledger 中的版本/回执；取消原来不落 requestId 回执的跨请求“同文即幂等”捷径。相同 requestId 重试返回其原 ID，冲突 payload 或 actor 返回 `MEMORY_IDEMPOTENCY_CONFLICT`。
- 客户授权是既有多阶段操作。前一 head 仍 pending 时，新 requestId 返回 `MEMORY_WRITE_PENDING`（409，可在完成后重试），不启动第二个授权；同 requestId 重试如实返回 pending，不声称已授权。未新增等待队列或后台恢复。
- 客户最终激活重新检查来源/原 commit guard，且只能激活仍 pending 的行。迟到授权不能覆盖 revoked/superseded，失败保留撤销状态并调用原 disclosure revoke 清理已返回的 grant。清理返回 `syncError` 时明确返回 `MEMORY_AUTHZ_CLEANUP_FAILED`，不声称外部已清理。

没有修改 Host/SDK、授权 policy、OpenFGA client、插件、依赖/锁文件、安全/网络设置。Mem0/向量检索保持关闭。

## 本轮验证

修复后的新文件有 11 项：上述五项、同文不同 requestId 的独立回执、撤销后延续 revision/history、客户 pending 并发拒绝及完成后重试、客户撤销战胜迟到 grant、授权期间撤源阻止激活、外部清理失败的明确拒绝。客户四个案例的 grant 服务是显式有限替身；Store、Library、磁盘、锁和 reopen 为实际组件，不能称为真实 OpenFGA 或企业验收。所有新测试读取实际磁盘并重开 Store。

最终定向命令 **32/32 通过**（11 项新测试、8 项原 ledger、13 项真实持久化），日志 `evidence/memory-concurrency-focused-final.tap`：

```sh
env -i PATH="$PATH" HOME=/tmp NO_COLOR=1 node --test --test-concurrency=1 \
  test/enterprise-memory-concurrency-real-store.test.mjs \
  test/enterprise-memory-ledger.test.mjs \
  test/enterprise-persistence-real-store.test.mjs
```

完整相关回归复用[整合报告的 32 文件命令](OMP-STRUCTURED-MEMORY-INTEGRATION-20261016.md#可复现命令)，在末尾追加 `test/enterprise-memory-concurrency-real-store.test.mjs`，实际脚本为忽略的 `evidence/run-memory-concurrency-regression.sh`。本轮实际 **336/336 通过，0 失败、0 跳过**，退出码 0，用时 385.6 秒；日志 `evidence/memory-concurrency-regression.tap`。包括原 Host/SDK、compaction/空查询竞态、B 写入独立 oracle、来源/撤权、取消、真实持久化及插件生命周期。定向测试与完整回归有重叠，不相加；没有套用历史结果。

构建与独立闭包检查使用既有两个空 npm 配置隔离用户/全局配置，未读取或配置真实凭据：

```sh
env -i PATH="$PATH" HOME=/tmp NO_COLOR=1 \
  NPM_CONFIG_USERCONFIG="$PWD/.cache/integration-npm/user.npmrc" \
  NPM_CONFIG_GLOBALCONFIG="$PWD/.cache/integration-npm/global.npmrc" npm run build:omp
env -i PATH="$PATH" HOME=/tmp NO_COLOR=1 \
  NPM_CONFIG_USERCONFIG="$PWD/.cache/integration-npm/user.npmrc" \
  NPM_CONFIG_GLOBALCONFIG="$PWD/.cache/integration-npm/global.npmrc" npm run plugins:pack-check
```

本轮 `build:omp` 与独立 `plugins:pack-check` 均退出 0。11 个现有插件编译、原生发现/加载/工具注册、禁用和物理卸载检查通过；构建阶段业务工具执行及模型请求为 0。日志 `evidence/memory-concurrency-build.log`、`evidence/memory-concurrency-pack.log`。这不表示 11 个真实业务连接可用，也不覆盖尚未移入的候选模块。只提交源码、测试和说明，原始 TAP、临时 Store、journal、合成文件、node_modules 链接和 `.cache/` 不入 Git。

## 剩余边界

新测试覆盖同一原 Store writer 的并发调用和正常关闭重开，不宣称进程崩溃/掉电恢复或修复历史已损坏的数据。pending 操作中断后不自动恢复，需沿原有管理撤销路径处理；没有建立恢复任务或重试循环。客户授权失败已发生的多阶段提交不自动回滚；原有真实持久化拒绝及 FGA 补删失败测试继续要求明确失败，不能称外部已清理。

真实模型、真实外部服务、真实企业资料、付费均为零；SDK 测试中的模型/fetch 为有限替身。旧 DeepSeek 5 元历史账仍缺请求 ID 与最终状态（含 UNKNOWN/中断）、usage/实际费用、累计账单、核销截止时点及余额对账。没有新增模型请求或凭据操作。Brain/Medusa 及其他候选 PR 未合入。main 和原 PR87 worktree/缓存未修改。

本轮结束时按最新指示停止扩大整合，保存这份已验证的最小修复，交给后续 Astra 任务继续全面源码验收。没有开始 Medusa/Brain 移植，也未新建 writer 或运行中的后台任务。下一任务的北京时间 12:00 截止及候选 PR 最新基线需沿最新用户指示继续核对，不以本报告代替候选验收。
