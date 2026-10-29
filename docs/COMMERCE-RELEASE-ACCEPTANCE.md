# 两插件集成交付验收

2026-10-29，Linux，Node.js 24，官方 DSH 0.2.1-rc.3。当前范围与历史模块处理见 [发布说明](COMMERCE-RELEASE.md)。

- `npm ci --ignore-scripts`：锁定依赖安装通过；移除不在本次范围内的历史 workspace 锁记录。
- `npm run check`：完整构建与 349 项测试通过，0 失败、0 跳过。与历史 383 项不同，当前套件不包含已从发布范围排除的报价、RFQ、样品和佣金账本测试；补充了所有交易依赖缺失时 Commerce 可用的测试。
- `npm run test:client`：全部客户端测试通过，包括目标主线上原有 Mini ERP 回归、业务委托、账单和业务推进。既有 Space 测试输出 React act 提示，但执行成功。
- 官方 Cordis/Tools 与原生附件：仅加载 Commerce/Billing，工厂固定费 USD 100、渠道月费 USD 29、进展修改后草稿仍可确认均通过；未加载 Mini ERP。
- 官方 CLI：在上一轮隔离试用目录中，将 Commerce/Billing 的 rc.1 安装包升级至 rc.2。全部 25 个已安装文件与交付 tgz 逐字节一致。
- 官方 Web + Chromium：升级后原有合成项目、工厂主体仍可见，新建委托表单正常打开。本轮没有重新进行完整七阶段业务演练；运行时代码未修改，历史验收另见工作台记录。
- `git diff <合并基线> -- integrations/dsh/dsh-mini-erp` 为空，确认不将历史 ERP 扩展带入目标开发主线。基线为 ed2a60c6279f6f1078465d8e3763e1196b9bf820。
- `git diff --check` 通过。所有测试均使用合成数据，没有模型调用、真实外联、付款或用户服务器部署。

安装包：Commerce 1.4.0-rc.2，SHA-256 `6afd1b0a129949ff38a828224d1343e808548f713452bcc5d80f74522a802dbb`；Billing 0.1.0-rc.2，SHA-256 `370a0abfba8fa9e35512d79a264aee64cf5380ee97075627e26236c140d63e3d`。

机器可读回执见 `acceptance/commerce-release/`。GitHub CI 和合并状态以 PR 153 的实际回执为准，不将本地检查结果标成远端 CI 成功。
