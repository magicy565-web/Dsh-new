# 工厂试用交付验收

> 历史批次记录。当前两插件集成交付范围以 [发布说明](COMMERCE-RELEASE.md) 为准；本记录中的旧安装清单和版本不作为当前发布入口。

日期：2026-10-29。目标环境：Linux / 已有官方 DSH。此次只修正交付入口、启动说明和演练材料，未修改业务插件或 Mini ERP。

## 本次实际检查

- Node.js 24、官方 DSH 0.2.1-rc.3，独立 DSH_HOME、独立工作目录。
- 用官方 CLI 全新安装 Commerce 1.4.0-rc.1 与 Service Billing 0.1.0-rc.1；未安装 Mini ERP。
- 已安装 Commerce 的 16 个文件、Billing 的 9 个文件，与交付 tgz 逐字节一致。
- Chromium 实际进入预览提示、工作目录选择器、原生会话和 Commerce 空画布。
- 用界面创建 `SYNTHETIC 首次试用` 项目，登记 `SYNTHETIC 首次演练工厂` 主体；只读检查 SQLite 确认两条记录已保存，主体仍为未核验。
- `node --check scripts/dsh-info.mjs`、`npm start`、`git diff --check` 通过。启动说明只打印信息，不安装或启动服务。

首次选择目录时，宿主可能提示无法创建默认工作区。快速开始已写明通过 Choose workspace、Add workspace…、Edit path、Open 手动选定目录，不把这个提示解释为业务插件安装失败。

## 交付内容与边界

组合 ZIP 包含当前源码、两个已构建插件、Linux 启动步骤、工厂演练提示词和明确标注的合成凭据。源码保留仓库内已有可选插件；本次安装仅使用 Commerce 与独立 Billing。源码不包含 node_modules、凭据、会话数据或历史 `docs/deliverables` 导出物。

预构建插件沿用工作台提交 `b3dadbb15eb6aed5a2d8bb1fd31e6e93601b4d10`，本次源码提交只更新说明与只读引导。包校验值：

| 包 | SHA-256 |
| --- | --- |
| dsh-commerce-network-1.4.0-rc.1.tgz | 86ed9beaf18bcc4de9267c97156352b660e89645dac3df08b8eca8662bd589a1 |
| dsh-service-billing-0.1.0-rc.1.tgz | 551e0e308874db569dddb3493d080c42a84fbb2a0837213e8644758ee0246ef3 |

本轮未重新执行完整业务回归；业务实现和上一轮验收见 [工作台验收](COMMERCE-WORKBENCH-ACCEPTANCE.md) 和 [服务计费说明](SERVICE-BILLING-IMPLEMENTATION.md)。本轮也未调用模型、联系真实渠道、发送邮件、收取款项或部署到用户服务器。完整工厂案例仍需用户配置宿主模型后，按 [快速开始](COMMERCE-PILOT-QUICKSTART.md) 在自己的服务器试用；Windows/macOS 未实测。
