# Issue 72：独立工厂客户来源插件验收

包名 `@workspace-agent/pi-factory-customers@0.1.0`，private 本地包。只编排 Host 注入的原公开工具与原 `factory-export` 保存接口；没有新增搜索、浏览器、模型执行器、权限、存储、队列或账本。

最终命令：

```sh
FACTORY_CUSTOMERS_PACKAGE_FACTS=/tmp/factory-customers-package-20261015.json node --test test/factory-customers-package.test.mjs
```

结果：**4/4 通过，0 跳过，exit 0，32.309 秒**。源码 SHA、精炼事实及文书 SHA 见 [acceptance.json](./acceptance.json)。不包含原始 session、日志、密钥、企业文件或运行缓存。

| 实际检查 | 结果与范围 |
| --- | --- |
| 官方 Pi 1.1.0 / Node 24.19.0 | `/tmp` 复制包无 `node_modules`，按 `pi.extensions` / `pi.skills` 发现；install、禁用、重新启用、remove 通过，原包保留；与原 read/bash、其他插件共存。 |
| 官方 OMP 18.10.4 / Bun 1.3.14 | 同样的独立复制包，实际 plugin link、manifest/Skill 加载、disable、enable、uninstall 通过。 |
| 普通宿主缺能力 | 三工具准确 blocked；即使存在合成 Agent Bearer 也不自动获得原工具或私库权限，不读取环境配置。 |
| 正向公开来源链 | 真实 OMP SDK AgentSession，官方 DDG provider 解析**明确合成 HTML**；保留 URL、原工具名、观测时间和原摘录。不是实际经销商发现。 |
| 浏览器边界 | 原 browser wrapper 实际拒绝合成的私网 DNS，插件保留搜索来源并返回 partial；此项不证明公网页导航成功。正向 page receipt 的编排另有明确合成 client 测试。 |
| 原文书保存 | 用户明确请求后，同原 transcript 的 researchCallId、相同产品/市场和 stable requestId 才能调用原 businessSubmit；实际原 HTTP 1 Task、4 Run、4 成功 stage、3 文书逐份 SHA 验证。未新增通用 artifact 存储；下载使用原任务产物接口。 |
| 失败与权限 | 合成原生 HTTP403 保留 blocked、0 来源且无 fallback；缺工具、私库 receipt、asset、路径、凭据、伪造保存引用、原提交 gate 关闭、前后撤权、预取消均阻断；Host 异常内容不披露，后续恢复可用。 |
| 事实与结论 | 来源报告文字、推断、缺失分开；`matchedCustomer/verifiedBuyer/contactPermission` 均 false，不生成联系人或采购意向。原业务目标仍 false。 |

正向文书链使用 3 次前台、4 次原后台**有限 keyless 模型替身**。这验证工具与原业务链连接，不证明真实模型余额、市场研究完成或工厂获客结果。

另于 `2026-10-15T02:39:24.240Z` 仅做 **1 次实际原生 DDG 公开只读请求**：`unavailable / PROVIDER_REFUSED / sources=0`。没有重试、更换 provider、另造入口、付费回退或绕过 challenge。原 wrapper 没有返回确切 HTTP code，因此不能把这次结果标成已实测 HTTP403；合成403是另一项验收。原生公开搜索当前受阻，未得到真实候选来源，也未沿此请求验证真实公网页导航。

独立包不自动接入默认 Workspace。受控 Host 接线须保持原公共 profile、原 URL/DNS 限制、每 Run 配额、预算/审批与 `allowBusinessSubmit` gate。`factory-materials` 私库 profile 和其历史必须继续隔离；本包的窄文本校验不能识别任意保密自然语言，不能把私库授权等同公开搜索许可。Pi 的连接正向研究链没有在本项中验证，只验证了标准包生命周期与缺配置的真实阻断。

没有访问真实私库、创建真实凭据、付费调用、发送消息、接单、交易、写店铺、部署、npm 发布或自行提交推送。社区 Skill 的固定来源核对由 Issue 73 单独处理，本项未复制或扩装社区集合。

## 原 Host 接线检查点

Root已在原受控宿主接入独立 `factory-customers-v1` scope，配置方式及
隔离边界见 [FACTORY-CUSTOMERS.md](../../FACTORY-CUSTOMERS.md)。原生工具仍由
原 publicExtension 执行，写文书仍由原 businessSubmit/Run/task gate执行。
原 enterprise HTTP→worker→官方SDK→插件→原工具/原task 三项全部通过：
只读请求0task；人工确认的执行意图1task/4stage/3document；原生拒绝0来源/0task。
输出见 `original-host.txt`。资料配置/终端/启动回归8/8见 `profile-regression.txt`。
这些正向来源和模型仍是显式合成响应；真实公开来源阻挡未解除。
