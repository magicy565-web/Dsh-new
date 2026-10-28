# 交易插件候选版验收 — 2026-10-28

本记录是实现验证，合成数据不代表真实询盘、成交或收入。安装和权限边界见 [实现说明](COMMERCE-BUSINESS-IMPLEMENTATION.md)。

| 验证层 | 结果与边界 |
| --- | --- |
| 候选基线 | PR #144 HEAD `263e28b94ed9c3b89d73630c17c3a90f50e97f34`；原基线 327 项通过 |
| 最终服务端与领域 | `npm run check` 358 项通过，0 失败、0 跳过；Node 24.19.0 |
| 客户端 | `npm run test:client` 全部通过；最终弹窗调整后重新运行 Commerce 客户端、Inspector、Artifact 和 Trade Inspector 检查 |
| 新业务专项 | 31 项，包含迁移、源证据、并发/幂等、撤权、outbox 重启、代理争议、金融凭据及保留期 |
| 官方 Cordis / Tools | DSH 0.2.1-rc.3 实际服务/工具、SQLite、独立 Worker 进程、无审批工具、撤权拒绝；使用 fixture session/registry，0 模型调用 |
| 官方 CLI 独立安装 | 七个 tarball，无开发链接；最终安装的 66 个文件逐字节匹配归档（含各包说明文件） |
| 官方 DSH Web | 实际 Connection 和原生 session；浏览器导入合成询盘、原文比对、来源去重、未绑定会话拒绝、权威投影、布局持久化、重启保留；无页面异常 |
| 实际浏览器尺寸 | 1600×1050 主会话并排画布；430×900 原生全屏面板；原文/来源 SHA 可读，弹窗可关闭，表单可滚动 |
| 外部业务 | 实际发送 0，真实买手 0，真实订单/收款/寄样 0；Resend 未配置 |
| 远端基线 CI | `startup_failure`；run 40664988174 / check suite 110220676667 无 jobs、check runs 或诊断日志；Actions permissions API 返回 403，当前集成无法查询管理员设置 |

独立安装验证对每个归档文件读取已安装文件进行逐字节比较，避免同版本本地 tarball 被包管理器缓存而误验旧构建。更新测试包时使用不同绝对路径，未删除用户数据库。

最终归档 SHA-256：

| 包 | 版本 | SHA-256 |
| --- | --- | --- |
| Workspace Library | 1.4.1 | `9b20fb6091919867070bfbf63db0433e27afa07f7214ea0213609ed3ee414a78` |
| Mini ERP | 0.6.0-rc.1 | `1d39c6bcaebb647b1d8799438d76e77179f7f15975d71d933c6ff2fb2fb92134` |
| RFQ Desk | 1.0.0-rc.1 | `d02703789837fb4194d275e1d92e0e2d15d20c7218c078f5490bcd5fe4d4ce3b` |
| QuoteGuard | 1.0.0-rc.1 | `aa9932ed5bbd6fb6e09d746e448166aca0a7379c8ed12cff5b9547a550ae60ea` |
| SampleFlow | 1.0.0-rc.1 | `2b5098934cc1485bc373cc7356e8171b87e4ab75d62336c93cf6be4ef8476485` |
| ChannelLedger | 1.0.0-rc.1 | `7010a68122d14669d0de85a307d12b5d2c1d8130afd3bc596e1cb0004dfa88fe` |
| Commerce Network | 1.1.0-rc.1 | `64aae410727c311f21dbaf511863b026f12f0e877c370c878e29dd0c398fa12d` |

**尚不能宣布首条商业闭环验收完成。** 还需要授权真实源数据、核验 SKU、发件账号及同意收件的测试对象，实际执行审批→发送→入站回复→来源审阅→画布更新。真实首单后的样品和代理佣金业务也未验收。没有自动发布、生产部署或合并。
