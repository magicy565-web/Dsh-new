# 最新栈合并收敛（2026-10-23）

## 背景

`#132 → #137 → #139` 是一条堆叠 PR 链，每条分支以相邻分支为 base：

- #132 `codex/ai-work-lead-discovery-20261021` → base `codex/plugin-library-completion-20261020`
- #137 `codex/product-library-20261022` → base `codex/ai-work-lead-discovery-20261021`
- #139 `codex/business-memory-20261022` → base `codex/product-library-20261022`

问题出在 #139：它从 product-library 的 `6e64498` 切出，而 product-library 之后又前进了 11 个提交
（`6e64498..2aff595d`），于是 #139 与它声称的目标分支分叉，PR 一直不可合并。同时主干
`codex/plugin-library-completion-20261020` 停在这条链的下方，最新工作没有任何一条分支完整承载。

## 做了什么

1. **#139 收敛**：把 product-library 顶端 `2aff595d` 合并进 `codex/business-memory-20261022`
   （合并提交 `76031bee`），不改写已发布历史；`harness.local.yml` 同时保留
   `market` / `product-library` / `business-memory` 三行。
2. **按序合并三个 PR**（#139 先由 Draft 转 Ready）：

   | PR | 合并到 | 合并提交 |
   | --- | --- | --- |
   | #132 | `codex/plugin-library-completion-20261020` | `75133eb` |
   | #137 | `codex/ai-work-lead-discovery-20261021` | `5e7ae4f` |
   | #139 | `codex/product-library-20261022` | `45d7b8b` |

3. **主干收口**：把 product-library 顶端 `45d7b8b` 合并进主干
   （合并提交 `e7e9a710`）。现在主干一条分支同时承载 ai-work 线索发现、Medusa 产品资料库与
   企业经营记忆，三个插件行都在同一份 `harness.local.yml` 里。

## 验证（在合并后的主干上重跑，非开发会话记录）

| 项 | 结果 |
| --- | --- |
| 记忆单测（domain / plugin / DSH index / injection） | 45/45 通过 |
| 产品库插件 + proxy | 19/19 通过 |
| `wh doctor -c harness.local.yml` | 退出码 0，`status: ok`，三个插件全部挂载 |
| `tsc --noEmit`（主干） | 退出码 0 |
| `vite build`（收敛树） | 退出码 0 |
| `node scripts/business-memory-smoke.mjs`（真实 HTTP，收敛树） | 23/23 通过，0 失败 |
| 运行态探针（收敛树） | `/healthz` 200、`/api/business-memory/status` 200、`/api/product-library/status` 200、`/business-memory` 200（严格 CSP） |

未完成：后端全量套件（约 300 个测试文件）在本机跑到 access / audit 段出现大量端口与残留进程
冲突导致的失败，未作为本次合并判据。合并相对 product-library 只新增记忆插件文件与一行组合配置，
未改 `server/` 下 access 代码。

## 仍然欠着的

- **`main` 还是 2026-10-16 的快照**（15 个提交），与主干的分叉点在 `b9546e1d`。试合并主干到 `main`：
  3,093 个文件变更、4 个 add/add 冲突：
  - `apps/medusa-product-catalog/src/catalog.ts`
  - `apps/medusa-product-catalog/src/main.tsx`
  - `apps/medusa-product-catalog/src/styles.css`
  - `packages/medusa-enterprise-product-context/README.md`
  这四个冲突来自 `main` 上的 medusa-catalog 提交与主干同名路径，需要先决定以哪边为准。
- **107 个开放 PR** 仍是历史堆叠工作，需要逐条判断保留、收敛还是关闭。
- **#138**（`codex/enterprise-memory-task-context-20261022`）不在本次收敛范围，仍在独立 review base
  `1908a93` 上；它的任务上下文接线与 #139 里被标记为 prototype 的注入实现是两套东西，需要单独决策。

## 怎么继续

```powershell
$git = "C:\Program Files\Git\cmd\git.exe"
cd workspace-agent
& $git fetch origin
& $git checkout codex/plugin-library-completion-20261020   # 已含 #132/#137/#139
& $git log --oneline -5
```

主干合并到 `main` 之前，先解决上面四个 add/add 冲突并重跑 `wh doctor` 与对应插件测试。
