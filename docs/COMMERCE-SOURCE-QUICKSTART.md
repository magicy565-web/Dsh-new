# 当前源码与本地验证

当前工厂试用入口是 [工厂代运营快速开始](COMMERCE-PILOT-QUICKSTART.md)，按其中说明只安装 Commerce 与独立 Billing，不安装或升级 Mini ERP。旧的七插件通配安装命令不适用于本次试用。

源码包包含应用源码、测试、构建脚本和配置，目标宿主是官方 DeepSeek Harness 0.2.1-rc.3，要求 Node.js 24+。仓库为私有仓库，GitHub 下载或克隆需要相应账号权限。

```sh
npm ci --ignore-scripts
npm run check
npm run test:client
npm run package:business-services
```

前两类源码分别位于 `integrations/dsh/` 和 `packages/`。最后一条命令只构建 Commerce 与 Billing，输出至 `dist/business-services/`；安装与启动步骤参见快速开始。`npm start` 是只读引导，不是网页服务器。

纯源码 ZIP 不包含依赖或官方 DSH。若想直接安装已构建插件，请使用“源码与工厂试用包 ZIP”中的 `packages` 目录。

历史实现与验收仍保留在 docs。当前进展见 [工作台验收](COMMERCE-WORKBENCH-ACCEPTANCE.md)，独立费用规则见 [服务计费](SERVICE-BILLING-IMPLEMENTATION.md)。本地验证不代表真实邮件、支付、商业 Agent 或生产环境通过验收。
