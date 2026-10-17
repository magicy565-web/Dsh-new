> 上游设计/交接记录；其中的旧分支、完成状态和历史验证不代表本次验收。当前结论见 [统一插件验收](OMP-ALL-PLUGINS-INTEGRATION-20261017.md)。

# 企业经营上下文大脑：源码交接 / 2026-10-16

## 基线和独立范围

用户授权开发独立经营大脑，每家企业拥有自己的经营上下文。
固定基线：`b8866e95f2c655603c7b55529b579f91c9626fa1`，来源
`codex/final-native-context-integration-20261015`。先读取该分支 RESUME.md。
不从 main 重做，不改/合并 main，不部署，不启动 Workspace 服务或外部 Worker。

本增量只拥有：

- `plugins/workspace-goal-intelligence/**`
- `test/goal-brain.test.mjs`、`test/fixtures/goal-brain-fixture.mjs`
- `scripts/goal-brain-offline-proof.mjs`
- 本交接及 `docs/validation/goal-brain-20261016/**`

按最新独立插件方向使用 `plugins/` 作为唯一包入口，没有再复制一份到 packages。
不修改公共入口/根锁文件/现有运行时/Store schema/资料库/产品库/任务引擎。
不导入其它分支成果冒充本轮测试。该基线还不是最新所有分支统一后的可发布版本。

## 与现有模块分工

原 Library 继续持有公司、产品、文档、版本和审核的权威；参考 PR87 修复
`13cccff0df703e6471329cd0e1815aee3f6179a9`。Mem0 默认关闭，无新增向量 RAG 授权。
不复制 PR86/89 的 TED、SAM、ERPNext 客户端；不开发 Medusa 产品库或 Docling 导入。
经营大脑读取这些模块的明确授权投影，并通过原 Artifact 保存认知和决策记录。

Dot/原集成工作继续持有 Session/Host 硬上下文门禁、公共入口、Library、产品库、
Shopify、WorkerDesk/Marketplace、移动端首页。请在原统一基线上接入本包，而不是
再建另一个 brain Store、审批器、任务队列或模型循环。

## 实際开发结果

- 企业绑定由可信 Host 注入；工具不能指定企业。原目标与预算只读；模型总结不自证政策。
- 一企业一上下文记录、跨受权会话读取；事实引用、假设、偏好主张、决策、复盘分离。
- 原 Artifact create/read/update 适配；CAS/重复请求/依赖版本/提交事务检查。
- 多方案决策、整数货币区间、预算/能力/币种限制、unknown 保留、无概率冒充成交率。
- 首页最多三条现有记录投影、去重、人类忽略/稍后；复盘不自动隐藏成已完成经营目标。
- 六工具+原生 manifest+一个业务 Skill；默认 unconfigured，必须原 Host 注入硬门禁。
- 无网络/模型/定时器/运行时 npm 依赖，无 Jev API、Mem0 读取或自动外部行动。

## 验收事实与边界

本地 Node22.16.0，直接执行该包/薄适配器和 SQLite 测试 Artifact facade；
真实文件持久化+关闭/重开在本地执行，企业/身份/授权/源/指标均为明确合成夹具。
不是原 Workspace Store/真实官方 SDK/LLM/客户/外部 Worker 的验收。
`checks.json` 记录最终测试数、版本、命令与缺口，`source.json` 记录本增量哈希。
完整 TAP 随下载源码包；初轮73与最终测试范围重叠，不能相加。

## 下一段原 Host 接线

按插件 README 的精确接口接入现有 Artifact/Store、当前原 Session/Run、授权来源投影、
原 Goal/预算读取器以及 provider 前/恢复后/压缩后/最终交付前硬门禁。不能用返回 true
的占位授权器、单纯 pi.on 事件或仅有 namespace 元数据作为生产授权。
在 Node24 / Pi1.1.0 / OMP18.10.4 原生环境上验证工具 Schema、同企业连续两轮、
真实跨企业/客户级权限、源撤销、上下文恢复、原 Artifact 重开和原接口不能绕过私库。

Jev 是可选未来语义判断适配器；本轮不连付费 API、不选替代模型、不扫描历史密钥。
没有本轮真实模型费用；历史五元预算余额未在本次重新查询，不能当零或满额。
当前任务没有修改或排查原 OMP EPERM 锁问题。

协作记录只代表已共享源码/分工，不代表 Dot 已读、接单或完成生产接线。
