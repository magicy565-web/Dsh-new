# A 路计划插件验收 · 2026-10-15

基线 PR #68：`d82d35fd7213012ff6b0e5f2f24d765aba021a9e`。开发分支 `codex/market-validation-plan-20261015`。早期接口检查点 `1960915` 已推送；最终实现源码 hash 见 source.json。源码只新增独立包/服务/测试/文档，公共入口、原工厂包和监测模块未修改。

## 实际结果

- 新增服务/包验收 **15/15，0 skip，exit 0，32.321 秒**：见 `new-15.txt`。真实原签名 HTTP Session、Library、Store、artifact 持久化/重载/文件；产品和资料均为合成。覆盖 B2B/B2C/dual、自由步骤、预算/佣金、缺项、原权限/模型接收方/源版本变化、撤权、精确源引用、提交时取消/漂移、幂等并发/重启和缓存篡改、原 PDF ReadTool 的部分抽取/OCR notice、无新任务/支出/发布。
- 同一组中的官方 **Pi 1.1.0 / OMP 18.10.4** AgentSession 工具循环和 OMP 包加载/Skill/禁用/启用/卸载实际执行。Bun 1.3.14 校验固定二进制。模型响应由有限 keyless 脚本生成、客户端回调为合成替身：两 SDK 各 17 次替身响应，3 次合成 save。它们只证明注册、schema、dispatch、前后授权与不固定工具调用次数，不证明真实模型意图识别、追问或计划写作质量。证据见 `package-facts.json`；其中 zeroToolClarificationTurn 指脚本允许无工具响应，不能解释为真实模型判断的评估。
- 相关原服务回归 **51/51，0 skip，exit 0，9.853 秒**：见 `shared-51.txt`。范围：factory-inquiries、factory-materials-read、supplier-publication、shopify-readiness。原 Shopify/GA4/外部响应由这些用例的合成 HTTP 替身提供；不能描述为真实商店接通。
- `npm run typecheck` 成功；原 `npm run workspace -- --check` exit 0，准确返回 unconfigured。见 `typecheck.txt`、`host-check.txt`。没有 .env、原成员绑定、模型密钥、已审价格和剩余预算，不尝试调用模型。原公共 profile 默认显示的 gpt-6-sol 仅是既有未配置设置，并非本任务已调用的模型。
- 固定 SDK 和 Bun 安装使用仓库锁文件、禁用 lifecycle scripts，未加依赖或改锁文件。初次根目录 npm ci 因默认 `/home/agent/.npm` 不可写失败，改为 `/tmp/market-validation-npm-cache` 后成功；不涉及权限扩张。

上述 15 与 51 是不同测试文件，不能同既有历史验收数字混加成真实商业验收。中间 SDK 检查曾因 nullable enum 缺少 null 失败，已修正并完整重跑通过；部分 SDK 多余字段处理也按实际行为修正断言：OMP 会移除后执行限定读取，Pi 拒绝。不是所有畸形原始参数均被 OMP 拒绝，生产仍靠原服务授权和版本校验。

## 复现与剩余项

```sh
node --test test/market-validation-plan.test.mjs test/market-validation-package.test.mjs
node --test test/factory-inquiries.test.mjs test/factory-materials-read.test.mjs test/supplier-publication.test.mjs test/shopify-readiness.test.mjs
npm run typecheck
npm run workspace -- --check
```

启动、工具注入和 B 路 planId/planRevision 映射见 [接口说明](../../MARKET-VALIDATION-PLAN.md)。这是待 Host 集成的可组合开发能力；未新增默认业务 profile 或网页路由。真实 owned journal 的每次模型请求前 revalidation、合法会话/Goal 关联、原计划批准与真实获客回执解析器仍待集成。B 路公共 dispatcher/业务 Agent 会话创建 Goal 的既有限制没有绕过。

真实企业材料授权、真实模型自主选择/正文质量、真实 Shopify/获客来源/支付/CRM/库存和 B2B RFQ 页面均未验证或接入；完整七天观测 **未执行**。没有以模拟时钟运行或宣称真实七天。付费模型、真实发布、广告、订单、支付、凭据创建、部署、main 修改/合并、强推均为零。本文与日志只含源码、合成测试说明及汇总，不含生产凭据或企业运行数据。
