# Shopify product plugin: implementation acceptance

基线 PR80 `8eb33701bb5f70be74e5285c7c864b248d79be3b`。分支 `codex/shopify-product-plugin-20261015`。本目录记录实现后的实际工程测试，替代“只交旧研究”的错误答复；研究提交 `cd492a95` 不是本次实现结果。

环境：Linux x64，Node **24.19.0**，npm **11.9.0**，Pi **1.1.0**，OMP **18.10.4**，Bun **1.3.14**。依赖按原锁文件安装，不改锁文件；安装脚本和可选模型组件未启用。首次 npm 默认 cache 不可写，换成 `/tmp/shopify-product-npm-cache` 后安装成功。

## 最终执行结果

| 检查 | 实际结果 | 原始证据 |
| --- | --- | --- |
| 新包／DTO／原服务／Pi SDK／OMP Host 全范围 | **22/22，0 fail/skip/cancel，exit0** | [acceptance.log](acceptance.log) |
| 原发布／HTTP／readiness／资料／OMP／市场工具回归 | **86/86，0 fail/skip/cancel，exit0** | [compatibility.log](compatibility.log) |
| 最后取消事务 fence 的直接与原发布／HTTP 回归 | **52/52，exit0**；与以上计数重叠 | [fence.log](fence.log) |
| `npm run build` | **exit0**，含 `tsc --noEmit` 和 Vite；保留现有大 bundle 提示 | [build.log](build.log) |
| 无凭据 launcher `--check` | **exit0**，固定运行器校验通过，业务/模型明确 `unconfigured`，model/paid calls0 | [unconfigured-check.json](unconfigured-check.json) |
| copied-package 两官方 CLI | manifest／Skill／九工具／其他扩展／disable-enable-remove 均实际通过 | [package-facts.json](package-facts.json) |
| 变更源码 | Node 语法、`git diff --check`、文件 SHA-256 校验通过 | [checks.json](checks.json)、[source.json](source.json) |

最终命令：

```sh
SHOPIFY_PRODUCT_PACKAGE_FACTS=/tmp/shopify-product-package-facts.json \
node --test --test-concurrency=1 \
  test/shopify-product-client.test.mjs test/shopify-product-contracts.test.mjs \
  test/shopify-product-package.test.mjs test/workspace-omp-shopify-product.test.mjs

node --test --test-concurrency=1 \
  test/supplier-publication.test.mjs test/supplier-publication.http.test.mjs \
  test/shopify-readiness.test.mjs test/factory-materials-read.test.mjs \
  test/workspace-omp.test.mjs test/workspace-omp-factory-materials.test.mjs \
  test/market-validation-monitor-tools.test.mjs test/market-validation-plan.test.mjs

npm run build
WORKSPACE_OMP_PROFILE=shopify-product node scripts/workspace-omp.mjs --check
git diff --check
```

`--check` 本轮用清空凭据的 `env -i` 执行，精确命令在 checks.json。新工具 DTO 还各运行真实 Pi／OMP JSON Schema validator **58 例**，另校验3个跨字段商业约束；这不是 Shopify schema 的真实店铺校验，没有新增 GraphQL 操作。

## 实际串通与模拟边界

- 两官方 CLI 在仓库外拷贝包、独立空用户目录安装、读 manifest／Skill、调用九个未配置工具，再禁用、启用、卸载。普通 `read/bash` 与另一扩展保留；无注入私库权限。
- 实际 Pi SDK 的有限模型从真实原产品 receipt 选择原读取，再传入模型正文提案，落原 supplier row；**该测试的进程内 authority 是明确模拟绑定**，不声称已有普通 Pi 自动企业授权。
- 实际 OMP worker 使用原企业签名登录、Session／CSRF、原前台 Conversation／Run、fd3、实际 OMP AgentSession。五轮分别组合读产品/原图/提案、申请 DRAFT 审批、执行草稿/查询、申请 publish 审批、执行发布。人工决定通过原 `shopify-decision` HTTP 入口提交，分别消费两次原授权。只创建一个远端合成商品／上传一次原图；原产品库仍只有一个产品，创建 Run ID 保存在原 supplier version。
- 店铺/Scope/readiness、图片 staging/form transfer、DRAFT、变体价/SKU、ACTIVE、Publication 和远端回查**全走原 publisher**；HTTP fixture 只将允许的合成域名映射到 loopback，服务端响应是模拟 Shopify，不是真实 Shopify。
- 原 Store 冷关闭／重开、响应丢失后的原 operation 对账实际执行，未再次创建商品。unapproved、只读 Run、未知图片、取消、撤销、源版本变化、变更中途撤销 Run、无图字段授权均拒绝。故意篡改 journal 的状态／正文被原状态重建，源变化在下一次 provider request 前阻断。
- `acquisition.startedAt:null, launchEvidence:false`；原 Goal／schedule／monitor／额外 business task 未创建。没有外部营销、邮件、Ads 或数据 MCP 请求。

这些有限脚本证明 SDK／Host／原业务服务的工程接线与授权边界。它们**不证明真实模型自由选择的质量、产品描述事实准确性、图片权利或真实店铺 API 成功**；真实店铺、模型、预算及外部引流仍须另外授权验收。本次真实/付费模型调用、真实店铺请求、广告/对外消息、凭据或权限变更、部署均0。

## 历史失败及最后复验

早期 Host 测试揭示原材料薄客户端未接受 opt-in images，已经补齐闭合校验；Pi SDK 测试错误地传 `tools:[]` 导致扩展未激活，修正测试配置后实际 SDK 注入通过；原限流240/分钟拒绝了高速多轮模拟，测试在轮次间推进61秒模拟人审耗时，生产限流和授权检查未变。

首轮并发回归85/86，唯一旧 PDF cleanup 用例比较整个 `/tmp`，受另一个测试的合法临时目录影响。没有删断言或修改生产清理；最终整组86项串行复跑通过。最后还补充原核验返回前取消／source/Run变化的事务 fence，52项直接回归通过后，上述22项及86项均对最终实现再次完整执行成功。日志中的最终通过不含 skip、伪造模型成功或仅局部复测充当完整范围。

此处没有运行全仓所有测试或视觉浏览器验收。源码 hash 清单可将本次测试范围对应到最终提交内容；提交 SHA 以 Draft PR 的 head 为准，不用事先未存在的 SHA 标记测试。
