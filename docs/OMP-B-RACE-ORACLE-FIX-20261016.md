# Request.text 竞态的 B 写入独立验证（2026-10-16 UTC）

固定起点：`fc8120a87b2c12f820d46da94811a12983097cf1`，同一开发分支 `codex/omp-structured-memory-integration-20261016`。本轮只改测试和说明，生产 Host/SDK 接线、插件、Store、依赖和锁均未修改。保持单写入任务，没有服务器操作、真实模型/服务调用、付费、真实凭据读取/创建/配置或权限变更。

## 原假阳性与最小修复

原 fixture 在 B 写完前置 `mutated=true`，B 的 SDK/tool/revision 断言位于 A 的预期失败 catch 范围内。独立从 Git 取出原 fixture 到忽略的 `evidence/fixtures/`，只在两个 Request.text 竞态点注入 B 写入前抛错：B 没有写入，两个旧 fixture 却都 **exit 0**，输出 `mutated:true`、A `mockFetches:0` 的成功记录。对应 Store 仍分别为 rev1、无记录。日志：`evidence/b-oracle-before-updated.log`、`evidence/b-oracle-before-empty.log`。未切换或覆盖分支。

现在 B helper 只执行、收集回执和完成状态、记录真实异常；所有 B 成功断言都在 A 的 catch **之外**执行：

- 恰好一次 B 尝试，B 未抛错，Session prompt/flush/close 完成，B native Session 与 A 不同。
- 真正 SDK toolResult `isError=false`、正确工具/operation/proof kind/native Session，text 与 details 相同；B journal 中的原生回执也一致。
- Store 精确 revision（更新为 2、从空新增为 1）、active/internal/workspace/query/statement；source 必须是 `conv-b/run-b/user-b`、固定原用户消息 SHA、两份原件的精确 revision/version/artifact/SHA。
- 回执完整 memory 与 Store 行相同，实际 `workspace.json` 中同 ID 的行必须存在且完整相同。不能用内存投影代替落盘证据。

只有以上全部通过才设置 `bMutation.verified` 与该竞态的 `mutated=true`。父 Node 测试还独立检查 B 完成、预期 revision、source 和落盘验证标志。所有成功 JSON 延迟到全部断言及 SDK/Store 清理完成后才输出。

非竞态的两个 B 前置写入用例复用同一独立 verifier，验证仍位于 A catch 外。没有添加业务能力或改变 A 的生产授权逻辑。

## 故障对照

两条竞态各执行下列四项，共 8 个故障子进程；父测试要求它们 **exit 1**、匹配指定 B 错误且 stdout 无成功记录：

| 故障 | 注入方式，仅限自动创建的临时 fixture | 必须失败的位置 |
| --- | --- | --- |
| B 错误工具回执 | 空 statement 触发真实 SDK/tool 输入拒绝 | `B_TOOL_FAILED` |
| B 抛异常 | B Session 建立后、写入前抛错；可被 A catch 接住 | catch 外的 `B_WRITE_FAILED` |
| 错误 revision | B 在同 Run 合法执行中间写入再最终写入，实际 revision 多 1 | `B_REVISION_MISMATCH` |
| 缺失落盘 | 保留真实成功回执和内存行，故意将本 fixture 的磁盘 memory 行恢复为 B 写入前的状态 | `B_PERSISTENCE_MISSING` |

最后一项是显式磁盘数据丢失注入，验证缺少当前持久数据时 oracle 必须拒绝；不是宣称真实 openStore 会假成功，也不作为持久能力通过。异常注入和磁盘操作只允许这两个测试模式、自动临时目录，结束后清理；不访问企业数据。

## 本轮实际结果与命令

Node `24.19.0`；原固定 Bun `1.3.14`、OMP `18.10.4`。实际组件为原 Host 模块、openStore、官方 SDK/工具调度、compaction、Request 和 journal；身份/Library 授权薄服务、原件字节、模型选择和 HTTP/SSE 均为明确的有限替身。SDK fetch 是进程内 mock，没有启动 HTTP 服务。

```sh
env -i PATH="$PATH" HOME=/tmp NO_COLOR=1 node --test --test-concurrency=1 \
  test/enterprise-context-unified-egress.test.mjs

env -i PATH="$PATH" HOME=/tmp NO_COLOR=1 \
  NPM_CONFIG_USERCONFIG="$PWD/.cache/integration-npm/user.npmrc" \
  NPM_CONFIG_GLOBALCONFIG="$PWD/.cache/integration-npm/global.npmrc" npm run build:omp
env -i PATH="$PATH" HOME=/tmp NO_COLOR=1 \
  NPM_CONFIG_USERCONFIG="$PWD/.cache/integration-npm/user.npmrc" \
  NPM_CONFIG_GLOBALCONFIG="$PWD/.cache/integration-npm/global.npmrc" npm run plugins:pack-check
```

最终 SDK 文件 **34/34 通过，0 失败、0 跳过**，包含原 26 项和 8 项故障对照；负例的子 fixture 失败是预期结果。两条正常竞态分别独立核对 B 的 rev2/rev1、完整 source、Store/磁盘成功后，A 的 mock fetch 和 admitted calls 均为 0。日志：`evidence/b-oracle-sdk-final.tap`。

Node24 `build:omp` 和独立 pack-check 均通过；11 包闭包、编译、原生发现/加载/注册及禁用卸载检查正常，构建阶段业务工具和模型请求为 0。日志：`evidence/b-oracle-build-final.log`、`evidence/b-oracle-pack-final.log`。npm 使用既有的两个独立空配置文件隔离用户/全局配置，本轮未配置凭据。

本轮验证范围为测试 oracle、现有出站 SDK 文件和原生构建/pack；生产源码未变，未重复无关的 317 项主回归，也不把历史 317 当本轮新结果。原始日志、临时 Store、journal、运行文件不提交 Git。完成后保存并停止，不扩新功能或新建并行任务；用户截止为北京时间 2026-10-17 08:00（UTC 2026-10-17 00:00）。真实业务、真实模型/付费验收及旧账单核销仍不在本轮通过范围内。
