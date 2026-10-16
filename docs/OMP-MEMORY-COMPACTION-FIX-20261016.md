# 模型前拒绝过期的 memory compaction（2026-10-16 UTC）

固定起点：`9e60b481c11c19ce02e61801ba7fe9ff62efccd6`。沿用 `codex/omp-structured-memory-integration-20261016` 和原隔离 worktree，不切换/覆盖其他分支，不合并 PR96/97/98。依赖、原生锁和安全配置不变。

## 真实 SDK 反例

使用原 Node Host、真实 `openStore`、官方 OMP 18.10.4 SessionManager/AgentSession 和合法 `appendCompaction`。A 经原记忆工具取得 Node 认证回执，摘要包含该回执的 statement 或 `found:false` 观察，并保留原 disclosure snapshot；确认恢复模型 context 中企业工具结果数为 0。B 在独立原生 Session、Conversation/Run 中经实际工具写相同 query；A 在新的原 Run 恢复。没有伪造 MAC、修改工具回执、删除证明或改写原 journal。

独立从 Git 导出纯 `9e60b481` 到临时目录，复用相同固定依赖并放入新 fixture，两个反例均失败（**0/2**）：

| 原代码场景 | 原 Store 状态 | 实际 SDK mock fetch / admitted calls | 摘要是否到达 mock |
| --- | --- | --- | --- |
| A 记忆 rev1 → 合法压缩 → B 写 rev2 → A 恢复 | rev2 为当前，rev1 superseded | 1 / 1 | 是，仍含 rev1 statement |
| A lookup found:false → 合法压缩 → B 新增同 query → A 恢复 | 新记录 rev1 为当前 | 1 / 1 | 是，仍含无记录观察 |

证据：`evidence/memory-compaction-before-both.tap`。更早单例保留在 `memory-compaction-before.tap` 和 `memory-empty-compaction-before.tap`。临时纯源码目录已清理；未恢复旧运行任务或启动旧服务器。

根因：旧 snapshot 的签名/来源仍可合法，但允许历史 superseded 的验证不是当前值验证；压缩后的 context 没有 toolResult，原刷新逻辑无对象可刷新。仅最终交付拒绝不能撤回已发出的模型请求。上一轮 306/19 结果不覆盖这两个反例。

## 最小修复

仅改两处生产文件：

- 原 SDK 的现有 `permit` 从同一 SessionManager 最新 disclosure snapshot 只读取得 memory proofs；每次模型前许可及实际 SDK body 读取后的许可都携带它们。没有创建、替换或补签 proof。
- 原 Node `assertDisclosureCurrent` 同步验证这些持久 memory obligations 和本次已观察的 memory proofs。记录必须仍 active 且完整内容/修订与签名 snapshot 相同；空观察必须仍无同 workspace/internal/query 的 active 记录。原始 memory 历史 query 还必须有本次持久证明覆盖，不能用空列表跳过旧义务。

历史验证继续允许 superseded，供**非压缩**回执的原模型投影刷新使用；它不再被当作压缩摘要可以继续披露的许可。过期摘要直接在 fetch 前拒绝，不仅更新 proof 而留下旧 summary，不调用模型清洗或重建摘要。

原 proof 签名域、Ledger/Store、RPC/取消、完整来源、text/details/配对、Docling recipient/purpose/transfer、SDK fetch guard、最终交付 fence 和合法 parse compaction 均保留。没有新增框架、数据库、队列、权限或密钥。

## 本轮验收边界

7 项真实 SDK compaction 场景均实际确认 summary 中没有工具结果：

| 场景 | SDK mock fetch |
| --- | --- |
| 当前 rev1 未变化，跨 Run 恢复 | 1，正常完成 |
| rev1 已被 B 的 rev2 替代 | 0，拒绝 |
| memory 已撤销 | 0，拒绝 |
| 读取 SDK body 期间 B 写 rev2 | 0，拒绝，断言窗口确实到达 |
| found:false 仍未变化，跨 Run 恢复 | 1，正常完成 |
| found:false 后 B 新增同 query | 0，拒绝 |
| 读取 SDK body 期间 B 新增同 query | 0，拒绝，断言窗口确实到达 |

另以真正 signed Host、原 Library/Artifact 两原件和 Node24→Bun worker 路径验证 3 项：当前 compacted memory 的新 Run 正常；B 更新后 A 拒绝；空观察后 B 新增时 A 拒绝。断言实际 Run ID 不同、A/B native Session 不同、成功工具回执与磁盘相同、旧 A journal 字节前缀不变；负向 `pi.agent-session.request` 为 0。

该定向组合还包含原非压缩四 Run、status、SDK 旧凭据/伪造 proof/重试与跨进程恢复边界，共 **31/31 通过**。这不是完整回归计数。

合成 fixture 中，身份、Library 授权薄服务、原件字节、Docling transport 和模型选择/HTTP/SSE 是明确替身；真实组件是原 Host 模块、持久 Store、SDK、工具调度、compaction、Request 和 journal。signed Host 组合另实际复用原身份、Library/Artifact 和 Run 服务，身份/原件仍是合成数据。真实模型、企业服务、付费均为 **0**。

## 命令和证据

```sh
# 9e60 纯源码反例及本次回归共用入口；原代码应失败
env -i PATH="$PATH" HOME=/tmp NO_COLOR=1 node --test \
  --test-name-pattern='compact-(updated|empty-added)$' \
  test/enterprise-context-unified-egress.test.mjs

# 本次定向组合：31/31
env -i PATH="$PATH" HOME=/tmp NO_COLOR=1 node --test --test-concurrency=1 \
  test/workspace-omp-structured-memory.test.mjs \
  test/enterprise-context-unified-egress.test.mjs

# 原 PR93 compaction 也在完整 Host 套件内重跑
env -i PATH="$PATH" HOME=/tmp NO_COLOR=1 node --test --test-concurrency=1 \
  test/enterprise-context-host.test.mjs
```

完整相关回归重新执行[整合报告](OMP-STRUCTURED-MEMORY-INTEGRATION-20261016.md)的 32 文件串行命令，使用本次最终源码和新增用例，结果以 `evidence/memory-compaction-regression-final.tap` 为准，不沿用 306。原生构建和独立 pack 检查仍使用该报告的隔离空 npm 配置命令，日志为 `evidence/memory-compaction-build-final.log`、`evidence/memory-compaction-pack-final.log`。定向日志为 `evidence/memory-compaction-native-final.tap`。

本轮最终完整回归 **317/317 通过，0 失败、0 跳过**；原非压缩四 Run、status、跨进程恢复边界、合法 parse compaction、安全拒绝、Store/FGA 撤权、统一入口/取消/插件禁用卸载均重新执行。Node24 `build:omp` 与独立 `plugins:pack-check` 均通过，11 包闭包/编译/官方加载正常；构建阶段业务工具和模型请求为 0。定向 31 与完整 317 重叠，不相加。

本轮在此收尾，不扩新功能或另建任务；昂贵步骤已通过，不因接续重复执行。推送后的固定提交可在本地独立 worktree 接续：先 fetch 本开发分支，再以交付 SHA 创建 detached worktree；不要覆盖已有工作区或使用强制 checkout。运行本地验收前仍需按仓库说明准备相同锁定的 Node24/Bun1.3.14/OMP18.10.4，不继承真实模型环境或开启业务连接。

仍不承诺无可信配置恢复、生产 Host 换实例自动采用旧私有 journal、真实模型/付费核销、浏览器或企业业务验收。相同显式合成绑定的全新进程恢复和缺配置/轮换/换实例拒绝继续测试；旧 journal 不自动补签。旧 DeepSeek 账单及 UNKNOWN 请求核销仍未补足。Mem0 向量检索保持关闭。
