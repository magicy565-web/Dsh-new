# Medusa／企业资料原生 Session 只读组合

源码接线提交：`902c694b875a9ba9c2e6499d41ffc5df64386675`。本轮从 PR99 的 `1b21521c4af81518d0b0347417e720aad8ce2a20` 接续，新增既有 engine adapter 的显式 `medusaEnterprise: true` 选项。版本化 scope 为 `omp:18.10.4:medusa-enterprise-readonly-v1`；只有已有受信任 Node Host 能提供原 signed Session readonly client、当前产品 client 和 enterpriseContextHost。没有新的 runtime、权限模型、队列、数据库或部署入口；默认入口及原 business/enterprise 独立 profile 不变。

`plugins/config.medusa-enterprise-readonly.json` 只控制两插件的发现。Host 限定启用这两个包，并逐项限定五个原工具：Medusa status/preview/reconcile，以及企业资料 status/parse_upload。其他业务工具、Mem0、structured-memory 写入和普通 shell/HTTP 工具不暴露；Node RPC 同时拒绝 memory 方法。原 readonly Session 对 `workspaceExecution: true` 的拒绝继续生效。企业资料包版本为 0.2.4，Medusa 包仍为 0.1.0。

| 边界 | 复用及组合方式 | 实跑证据 |
| --- | --- | --- |
| 身份与新绑定 | 原 signed Session、成员/实例/接收方检查；原 Store 的 Session mapping 增加 sourceBindingFingerprint，固定 enterpriseContextHost 原 scopeHash；旧 engine scope 或变化的来源绑定必须拒绝续用 | 同一 nativeSessionId 连续两插件与后续轮次通过；旧 scope、换接收方/客户来源绑定、缺绑定均拒绝 |
| 产品来源 | 既有 MedusaProductClient / factory Library policy；组合 scope 保守复核该原 policy 内全部产品 revision，最终同步检查当前 sourceHash | 产品改版、archive、恢复前及实际 wire 前变化均拒绝；未配置 Medusa 仍明确 configured=false |
| 资料来源 | 原 enterpriseContextHost 的 document revision/version、artifactId/version/SHA、接收方、Node credential screening 和 live complete-file parser transfer 授权 | 文档改版/撤销、artifact SHA 变化、缺 parser/transfer 授权、原 Session 恢复及取消均检查；缺外发专门授权的 parser 请求数 0 |
| receipt / 压缩 | 只接受五个工具对应的两类原 receipt，核对调用名、参数和完整正文。模型上下文/compaction 仍由原 SDK 构造；只读来源门重验原 journal 的完整 audit messages，覆盖压缩前两类来源义务。原 business 的 opaque-summary 拒绝策略未放开 | 跨插件调换 receipt、任一插件禁用或物理卸载、压缩后撤权/缺绑定均在下一模型前拒绝；原生 compaction 后同 ID 续接通过 |
| 实际模型 wire | 原 SDK 序列化后、fetch 前，在原 Node disclosure 调用中复核两类来源；实际 tool name/args/body 必须匹配原 journal。完整 payload 仍经原 Node screening | 本机 HTTPS/SSE 替身确认两类数据在同一 wire 中；序列化后的产品/文件变化使最终 HTTP 请求数停在 2，而非发送第 3 次 |
| 最终交付 | 等待实际 worker exit；完成异步原授权后，在同一个同步门检查两个原来源，再沿原交付链返回 | worker 已退出、最后 awaited authorization 内再改产品或 artifact SHA，仍为 OMP_DISCLOSURE_REFUSED；同阶段原 Run 取消也不交付 |

模型端没有新授权来源。profile、工具列表、聊天、cached parse 或 SDK summary 都不产生 Library 权限、完整文件外发同意或写权限。只读组合的完整 audit 校验用于来源义务，未建立另一个 Session leaf/compaction 算法，也不重写原 journal。任何来源变化均需人工处理；不会通过改 summary、重新签 proof 或自动迁移旧 scope 来继续。

Medusa 预览来自原授权 Library 产品投影；reconcile 保留原只读远端状态回读及 remote.product=null 规则。Library 投影与 Medusa 原生产品仍有各自数据权威，不进行双向写回。测试中的 configured=true 仅指明确的本机 Medusa HTTP 替身配置，connection 仍是 configured_unverified，远端结果为 missing；不是原生 Medusa 数据库或真实产品验收。

验证环境为 Node 24.19.0、原固定 Bun 1.3.14、OMP 18.10.4。合计 **186 passed、0 failed/cancelled/skipped**，只计独立测试：组合 33、原 Host 105、原核心 48。组合证据由 32 项主体运行和新增 configured-HTTP 1 项定向运行组成；以下第一条可一次重放当前 33 项。早期定向重复检查未重复计数。

```sh
# 33 个组合用例；真实模型为有限本机 HTTPS/SSE 替身
# TLS 使用临时合成测试 CA 沿已有 infrastructure 传递，未关闭证书校验。
env -i PATH="$PATH" HOME=/tmp node --test test/workspace-omp-medusa-enterprise.test.mjs
# 105 个原 Host / 原 Session / source-proof 兼容用例
env -i PATH="$PATH" HOME=/tmp node --test test/enterprise-context-host.test.mjs test/enterprise-context-unified-egress.test.mjs test/workspace-omp-business-integration.test.mjs
# 48 个原核心、默认入口、发现及结构解析回归
env -i PATH="$PATH" HOME=/tmp node --test test/workspace-omp-unified.test.mjs test/workspace-omp-plugins.test.mjs test/medusa-catalog.test.mjs test/workspace-omp-business-context.test.mjs test/workspace-omp-session-startup.test.mjs test/enterprise-context-extension.test.mjs test/enterprise-context-oss.test.mjs
# 静态包闭包 dry-run、14 包编译/原 loader 发现加载；业务工具/模型请求 0
env -i PATH="$PATH" HOME=/tmp node scripts/build-omp.mjs
```

本机 HTTP Docling 和 Medusa 服务、产品/文档、成员/签名配置、模型决策与测试 CA 均为临时合成替身；实际 OMP SDK、原 Node Host、原 Store/Artifact、signed Session、fd3 和取消链是真实执行。没有真实业务服务调用、付费调用、真实凭据读取、网络/服务器配置、部署、main 修改或运行数据入 Git。pack 检查是 dry-run 闭包检查；未验收从安装 tarball 新装的路径。

尚未验收真实 Medusa、Docling、模型、真实完整文件传输、真实账户及持久化服务重启。本轮未接入默认 CLI/UI 或自动生产配置：只提供既有受信任 Host factory 的显式组合接线，缺原绑定/原专门外发授权时必须保持 unconfigured/blocked。原 Medusa 管理 CRUD、商品发布、库存和写操作不属于该只读 scope。交互输入脚本未修改，也未安装到任何服务器。
