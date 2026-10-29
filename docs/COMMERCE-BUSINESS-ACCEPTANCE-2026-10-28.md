# 交易插件候选版验收 — 2026-10-28

> 历史批次记录。当前两插件集成交付范围以 [发布说明](COMMERCE-RELEASE.md) 为准；本记录中的旧安装清单和版本不作为当前发布入口。

当前源码包含第二轮交易校验修复。源码获取和本地命令见 [源码说明](COMMERCE-SOURCE-QUICKSTART.md)，接口与数据边界见 [实现说明](COMMERCE-BUSINESS-IMPLEMENTATION.md)。所有测试业务数据均为合成记录。

| 验证层 | 结果与边界 |
| --- | --- |
| 基线 | PR #144 HEAD `263e28b94ed9c3b89d73630c17c3a90f50e97f34`，原基线 327 项通过 |
| 当前服务端与领域 | `npm run check` 365 项通过，0 失败、0 跳过；Node 24.19.0 |
| 业务专项 | 38 项通过；含产品/市场佣金范围、订单唯一报价关联、旧冲突引用、报价有效期、样品原始 SKU 版本、大响应中断及限流容量回归 |
| 客户端 | `npm run test:client` 全部通过；保留 ERP、Commerce 及交易审批/重试交互验证 |
| 工作流静态检查 | actionlint v1.7.7 通过；二进制下载核对官方 SHA-256 |
| 官方 Cordis / Tools | DSH 0.2.1-rc.3 实际服务/工具、SQLite、独立 Worker 进程；使用 fixture session/registry，0 模型调用 |
| 独立安装 | 七个当前 tarball 通过官方 CLI 安装；全部 66 个已安装文件与归档逐字节一致 |
| 官方 DSH Web | 当前安装包、实际 Connection 和原生 session；浏览器导入合成询盘、原文比对、来源去重、未绑定会话拒绝、权威投影、布局持久化、重启保留；无页面异常 |
| 实际浏览器尺寸 | 1600×1050 主界面、430×900 原生全屏面板；原文/SHA 可读、弹窗可关闭、表单可滚动 |
| 真实业务 | 依用户选择留待配置。实际发信、真实买手、成交、收款、寄样均为 0 |
| 远端 CI | 前序提交仍为 startup_failure，失败 workflow 元数据为 deleted / BuildFailed，未生成 jobs/check runs；管理员诊断接口返回 403。当前 PR 结果以 GitHub 为准，不声称远端通过 |

本轮修复使订单的 SKU/产品修订来自原始 ERP reserve 回执；与报价或样品版本不同则拒绝关联/寄送。佣金必须同时满足唯一客户归属、协议产品版本及明确目的市场。一个订单只能关联一个不可变报价版本；旧数据缺少来源或存在歧义时不猜测归属。过期报价退出当前报价总额，历史费用/凭据所在币种仍保留。

当前归档 SHA-256（源码可用 `npm run package:commerce-business` 重建）：

| 包 | 版本 | SHA-256 |
| --- | --- | --- |
| dsh-workspace-library | 1.4.1 | `cc93b5b388b95bff5ee95f4520f901688210ce3968dabc67191f59bccffa2ceb` |
| dsh-mini-erp | 0.6.0-rc.2 | `334c847d92dff224851e4a9b73a9d67390e9d9d1a0ce16efaee6373c15b61ae6` |
| dsh-rfq-desk | 1.0.0-rc.1 | `2d304ecf60c6e4db5376818ab57ff0ca18f31bdd78fc0d46022b27153dcf42d6` |
| dsh-quote-guard | 1.0.0-rc.2 | `3046496748c9c92028f555b42b55624c34639e88c69d64fa1fef26e4b964ebd4` |
| dsh-sample-flow | 1.0.0-rc.1 | `b6e8a01fa73d2130c2eb15d4c99e6ea8913e93605d5a9c9dd991c513478dc72b` |
| dsh-channel-ledger | 1.0.0-rc.2 | `c187af04bb0a39c64a4609b845164fef61ce6d7a90e84ebacb940ebd74c48348` |
| dsh-commerce-network | 1.1.0-rc.2 | `cfe41c5cd6f79b0fe0317445e64a3ce2e81fa99f16b80c75396e57e3da140cf8` |

安装验证使用不同绝对路径，并逐文件比对，避免同版本本地 tarball 缓存导致误验。没有删除用户数据库，ERP schema 仍为 v4，既有订单和回执保留。

**真实商业闭环未验收。** 邮件账号、真实询盘/SKU、同意收件的测试对象均留待后续配置，尚未合并或生产部署。本地源码和隔离验证可以交付，不能据此宣称真实成交、支付、物流或生产就绪。
