# 三模式业务委托 MVP 第一批交付

日期：2026-10-28。Commerce 版本：`1.2.0-rc.1`。基于已实现交易插件提交 `aa8e10e77f0844d9a4286f1b8d9b765663e4ced6` 增量开发。

## 用户可操作的能力

在官方 DSH Web 中打开 **Commerce Network → 业务委托**，登记主体，创建工厂代运营、渠道订阅或采购中介委托，填写商业条款，关联已有产品／渠道／工单。保存后独立审核；修改保留旧版本并重新审核；撤销保留业务记录。画布的业务委托卡片打开同一份记录，可保存位置。已有交付继续由原工单持有，委托只显示引用。

安装包共七个；本批更新 Commerce，其余包维持已有业务能力。安装、升级和数据保留说明见 [实现说明](COMMERCE-BUSINESS-IMPLEMENTATION.md)。源码安装入口见 [快速开始](COMMERCE-SOURCE-QUICKSTART.md)。本批不是可收费上线版本：条款不会创建发票、续订、Credits 扣款或新模式佣金；多供应商拆单履约尚待后续开发。真实邮件按用户决定留待配置。

## 已完成验证

| 层次 | 结果 | 实际验证范围 |
| --- | --- | --- |
| `npm run check` | 370 通过，0 失败、0 跳过 | 原有回归及新增 5 项业务规则／服务专项 |
| `npm run test:client` | 全部通过 | 原生 UI 既有测试及业务委托表单、金额转换、不确定响应后的同请求恢复、锁定审阅版本 |
| 官方 Cordis / Tools | 通过 | 新工具创建真实 SQLite 草稿、Owner 审核；原独立 Worker 进程领取、交付、验收仍通过 |
| 官方 CLI 安装 | 七包通过，66 个文件逐字节一致 | 实际 standalone tarball 安装；见 [安装回执](acceptance/commerce-mvp/installed-packages.json) |
| 官方 Web / Chromium | 通过，无页面脚本异常 | 真实原生 session、Owner HTTP、三模式表单创建与审核、修改历史、重启保留、画布节点、布局、430px 窄屏；见 [浏览器回执](acceptance/commerce-mvp/browser.json) |

新增后端测试覆盖：三种模式的互斥费用、未知值和明确免费、有效期、审核完整性、产品版本变更、同项目引用、跨工作区拒绝、Agent 无审批权、修改历史与重审批、旧授权保持原样、幂等请求和重启恢复、新委托不进入旧佣金路径。没有真实模型、真实邮件、真实支付或生产部署。本地通过不代表远端 GitHub Actions 已通过。

## 复现

```sh
npm ci --ignore-scripts
npm run check
npm run test:client
npm run package:commerce-business
DSH_RUNTIME_DIR=/path/to/official/dsh-install node integrations/dsh/dsh-commerce-network/dev/native-smoke.mjs
```

真实浏览器用例位于 `integrations/dsh/dsh-commerce-network/dev/native-business-browser.mjs`，只允许 localhost，并创建明确标注 Synthetic 的隔离项目。先用官方 CLI 安装七包、在隔离 DSH_HOME 启动 Web、通过正常浏览器认证并保存 Playwright storageState。然后配置：

```sh
DSH_WEB_LOG=/absolute/path/to/private-host-launch.log \
DSH_BROWSER_STATE=/absolute/path/to/private-browser-state.json \
COMMERCE_ACCEPTANCE_DIR=/absolute/path/to/test-output \
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
CHROMIUM_EXECUTABLE=/absolute/path/to/chromium \
node integrations/dsh/dsh-commerce-network/dev/native-business-browser.mjs
```

测试输出目录需预先创建。重启同一隔离宿主后再次运行，自动核对上次委托版本和画布布局，再创建新的合成验收项目。启动日志、认证状态、fixture 会话引用仅留隔离测试目录，不提交源码和安装归档。回执不包含这些凭据。
