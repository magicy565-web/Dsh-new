# 旧 context 历史来源最终读取竞态修复

本轮仅修复 `revalidatePriorContext` 的最终历史依赖复核，从 `75cc3af6656ffdc81f11385eb609c92cc21f4b68` 继续，仍为 PR99 同一开发分支。Marketplace 未扩展。源码提交：`374b0c1e61e61c3076759702ccb1169a830b58da`。

## 准确复现

原签名 Host、原磁盘 Store/Library/Artifact/Access 和原 OMP Session 保存 context v1，其中选择一个合成产品来源；随后保存 v2，移除该来源。旧 journal 和 v1 回执保留。

校验旧回执的 Artifact 读取序列精确为 `[v2, v2, v1, v2]`：初始当前 context、继承检查的当前 context、不可变旧版本、历史 capture 之后的最后当前版本读取。测试只在第四次读取返回时注入变化，并核对 mutation 已完成、Store 磁盘结果正确。

| 注入变化 | 使用的真实机制 / 替身界限 | 修复前原 validator | 修复前实际 SDK 的有限 SSE fetch | 修复后 fetch |
| --- | --- | --- | --- | --- |
| 正常控制 | 来源不变，原来源权限持续有效 | 通过 | 1 | 1 |
| 原产品版本变化 | 原 Library.updateProduct 提交 Store，磁盘 revision=2 | 错误通过 | 1 | 0 |
| 旧来源选择撤回 | 真实 Library 返回给可信 Host 的选择 scope 移除该产品；这是明确的合成授权投影撤回，原 Session 仍有效，不是真实 FGA/外部授权服务调用 | 错误通过 | 1 | 0 |
| 原产品删除 | 在原 Store.update 中注入合成资料删除并核对磁盘缺失；原产品没有删除 API，不宣称执行了这样的生产 API | 错误通过 | 1 | 0 |

修复前两组各 4 项测试，正常控制通过、3 项应拒绝的负例失败；日志保留为真实反例，不计作验收通过。采集修复前日志时仅注册四个竞态场景，正常连续 context/decision 正例在随后补入。

SDK 测试使用官方 Bun/OMP provider transport，在实际 `Request.text()` 完成后启用注入，并选中 `permit(body)` 第二次、也就是发送前最后一次 Brain 权限复核。每次验证仍读取原 Host/Store；注入只在该次旧 context validator 的第四次 Artifact 读取发生。修复前完整请求体含旧产品名称并到达一次本地有限 SSE 替身，随后才可能被完成阶段拒绝；这不是“恢复时早早拒绝”的假阳性。真实外部模型请求始终为零。

## 最小修复

在最终 `repository.get('context')` 和 `gate('context.validate')` 之后，对 **历史行的 sourceRefs/goalIds 与刚才 capture 的历史投影** 再次调用现有 `assertCurrent`，并检查取消信号。生产源码仅新增 5 行，不增加缓存、状态机、授权体系或来源签名。

历史来源从当前 context 移除也不能解除旧正文的授权依赖。空历史 context 使用空依赖数组；已有原 Gate、来源字段/版本、Goal、接收者、Session 和继承链约束继续执行。测试逐字节比较原 journal 前缀，validator 自身执行前后 journal 完全相同，不修改或补签旧回执。

## 正常路径与执行结果

原 Host 正例：context 连续保存 v1/v2 后，同一原生 Session 保存 decision v1/v2，并以相同 requestId 精确重试；保持同一个 context Artifact 的两个版本、同一个 decision Artifact 的两个版本，旧 journal/proof 前缀不变。原有连续 context/decision、撤权、取消、未知写入和最终交付检查另做相关回归。

固定 Node 24.19.0、Bun 1.3.14、OMP 18.10.4。业务输入和授权撤回注入是合成测试数据；SDK/Store/Host/Library/Artifact/Access 在相应测试真实执行。SDK 的测试只读 loopback RPC 转接不作为新生产入口；有限 SSE 是模型替身。真实外部服务未连接或调用，Mem0 向量关闭。

执行时使用 `env -i PATH="$PATH" HOME=/tmp NO_COLOR=1` 清空业务环境：

```sh
# 修复前：两组各 1 passed / 3 failed，是缺失拒绝的反例
node --test test/goal-brain-context-real-store-race.test.mjs
node --test test/workspace-omp-context-final-read.test.mjs

# 修复后：源码与原 Store/Host 正负例，以及实际 SDK 发送
node --test test/goal-brain*.test.mjs test/business-brain*.test.mjs test/business-signals.test.mjs test/decision-planner.test.mjs
node --test test/workspace-omp-context-final-read.test.mjs
node --test test/workspace-omp-business-integration.test.mjs test/workspace-omp-brain-decision.test.mjs
npm run plugins:pack-check
npm run build:omp
```

| 修复后执行组 | 结果 | 本地忽略日志 |
| --- | --- | --- |
| Brain 全部来源/权限/决策回归，含真实 Store/Host 4 项竞态与连续 context/decision 正例 | 185 passed，0 failed，0 skipped | brain-context-source-final.tap |
| 实际 SDK 最后发送前四种情况 | 4 passed，0 failed，0 skipped | brain-context-sdk-final.tap |
| 原业务组合 Host 与 decision Host 回归 | 17 passed，0 failed，0 skipped | brain-context-host-regression-final.tap |
| pack 闭包及固定 OMP 原生发现/编译/加载 | 14 插件通过 | brain-context-pack-final.log / brain-context-build-omp-final.log |

源码提交、最终计数和所有相关日志的 SHA256 见 [本轮验证摘要](validation/omp-context-final-source-20261017-summary.json)。日志位于忽略的 `evidence/`，不提交临时 Store、运行资料、会话正文或凭据。不同组有交集，不相加作独立总数。

本轮不改变此前列出的 Marketplace、跨 context decision 迁移、真实服务、实例/迁移、完整浏览器和全部隔离 profile 组合等未完成状态。既有远程 Actions `startup_failure` 报告也未被本地通过覆盖；本轮未独立查询或重触发远程 CI。
