# P1 迁移分析：把企业应用改为 harness composition 装配

> 状态：**只读分析 + 已验证的迁移基元**（`packages/harness-kernel/src/legacy-adapter.mjs`）。
> `server/index.mjs` 仍由并行工作流修改（未提交），因此本轮**不改该文件**。

## 已确认的兼容事实（读代码得到，不是推测）

| 事实 | 位置 |
| --- | --- |
| `createApp` 直接 `openStore(dataDirectory)` 建唯一 store | `server/index.mjs:119,127` |
| artifacts 由 `createArtifactService({ store, directory: <data>/artifacts })` 建 | `server/index.mjs:136` |
| `createApp` 返回 `{ server, runtime, store, artifacts, … }`，`close()` 关服务器与资源 | `server/index.mjs:660,807` |
| harness storage seam **复用同一个** `server/store.mjs openStore` | `packages/harness-seams/src/storage.mjs:28,93` |
| harness artifacts seam 复用 `server/artifacts.mjs` | `packages/harness-seams/src/artifacts.mjs` |
| 领域服务与宿主无关（`store + artifacts + actor`） | `packages/domain-inquiry-recovery/src/index.mjs:278` |

结论：**storage 层是同一种 `workspace.json` 格式**，所以"企业应用改用 harness 装配"不需要数据迁移；难点只在服务构造顺序、actor 来源和生命周期。

## 已完成的本轮基元（有测试）

`createLegacyServices(harness)` 用 legacy 形状返回 `{ store, artifacts, approval, tools, audit, workspace }`，其中 `store` 就是 `ctx.storage` 本体（同一实例，不是拷贝）；`createLegacyInquiryRecovery(harness)` 让**未修改的领域代码**直接跑在 harness seams 上。

证据：`packages/harness-kernel/test/legacy-adapter.test.mjs`
- legacy 服务 === 活动 ctx 服务（单 store）；
- 真实询盘领域服务在 harness 上导入/统计成功，数据经 harness storage 可见；
- approval/tools 也经同一 adapter 可用；
- 缺 storage 时 fail closed（`HARNESS_PLUGIN_MISSING_DEPENDENCY`），可选 seam 缺失为 `null`。

## 等并行流落定后的最小改动（拟定 ~20 行 + 1 个新组合文件）

1. 新增 `harness.legacy.yml`（不用于 dev/测试），只装企业应用真正需要的 seam：
   ```yaml
   version: 1
   name: enterprise
   server: { host: 127.0.0.1, port: 8792 }
   plugins:
     - id: storage
       name: '@workspace-harness/seams/storage'
       config: { directory: .data }      # 复用现有数据目录，路径与 createApp 默认一致
     - id: artifacts
       name: '@workspace-harness/seams/artifacts'
     - id: approval
       name: '@workspace-harness/seams/approval'
     - id: audit
       name: '@workspace-harness/seams/audit'
     - id: workspace
       name: '@workspace-harness/seams/workspace'
       config: { defaultWorkspaceId: local, workspaces: [{ id: local, name: 本地空间, members: [{ subject: local-operator, role: admin }] }] }
   ```
   注意：**不**装 `inquiries` 插件（企业应用已有自己的路由）、**不**装 `llm-bridge`（模型仍由 `server/provider.mjs` 提供）。

2. `server/index.mjs` 改动点：
   - 顶部 `import { createHarness } from '../packages/harness-kernel/src/app.mjs'`、`import { createLegacyServices } from '../packages/harness-kernel/src/legacy-adapter.mjs'`；
   - `const store = await openStore(dataDirectory)` → 由 harness 装配：
     ```js
     const harness = await createHarness({ compositionPath: path.join(root, 'harness.legacy.yml'), root });
     const services = createLegacyServices(harness);
     const store = services.store;   // 同一 workspace.json
     ```
   - `artifacts` 改为 `services.artifacts`（缺省时保留现有 `createArtifactService` 回退）；
   - `close()` 追加 `await harness.stop()`（释放 Cordis fiber 与 store 锁），放在最前/最后都可，但必须一次且幂等；
   - `createApp({ dataDirectory })` 的签名保持不变（测试与调用方零改动）；`compositionPath` 作为可选参数，默认不启用 composition（feature flag），便于回滚。

3. 验收（必须全部通过才算 P1 完成）：
   - `wh doctor --composition harness.legacy.yml` → ok；
   - 现有 `test/*.dom.test.mjs`（13 个，需 `--test-concurrency=1`）与 `test/harness-inquiry-recovery.test.mjs` 全绿；
   - **同一文件兼容性**：先由 legacy 路径写入一条记录，停止，再以 harness 组合读取 → 数据一致（证明没有双格式）；
   - `createApp` 的 `close()` 之后 lock 释放，可再次 `openStore`；
   - 企业会话 → actor 映射：**绝不信任 `x-harness-*` 头**，必须由 `server/access.mjs` 的 session 派生 `{subject, role, workspaceId}` 后注入 harness 服务调用。

## 风险与对策

| 风险 | 对策 |
| --- | --- |
| actor 伪造（企业模式下 HTTP 头不可信） | 只在 harness 独立运行（dev）时使用头；企业路径由 session 派生 actor，测试覆盖"伪造头无效" |
| 端口/双服务器 | `createHarness` 只 mount，不 `start()`；企业仍用自己的 `node:http` server |
| 数据目录不一致 | composition 的 storage `directory` 必须等于 `createApp` 的 `dataDirectory`；测试断言两者同文件 |
| 与并行工作流冲突 | `server/index.mjs`、`access.mjs`、`store.mjs` 保持不动，直到该流提交；本轮只新增 `legacy-adapter.mjs` 与本文档 |
| 生命周期/锁 | `close()` 只调用一次 `harness.stop()`；增加"停止后可重新 openStore"测试 |
| 回滚 | 保留现有 `openStore` 路径，feature flag 关闭即回到旧装配 |

## 为什么现在不能直接做

`server/index.mjs`、`server/access.mjs`、`server/store.mjs` 当前都是未提交的并行改动（`+85/−10`），且 `access.mjs` 曾被原子替换到短暂缺失，直接改同文件会产生互相覆盖的提交。本轮以"adapter + 分析 + 验收标准"把不可逆风险降到只剩最后的接线。
