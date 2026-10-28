# 完整源码与本地验证

本分支包含完整仓库源码，主实现位于 `integrations/dsh/` 和 `packages/`，不是仅有变更文件的补丁。目标宿主为官方 DeepSeek Harness 0.2.1-rc.3，Node 24+。

## 取得源码

可以从 GitHub 下载当前提交的 ZIP，解压后在根目录执行下列命令；也可以克隆开发分支：

```sh
git clone --branch codex/commerce-business-implementation-20261028 https://github.com/magicy565-web/workspace-agent.git
cd workspace-agent
npm ci --ignore-scripts
npm run check
npm run test:client
npm run package:commerce-business
```

仓库为私有仓库，下载或克隆需要具有访问权限的 GitHub 账号。Node 24 以下的版本不能运行这里使用的 SQLite 接口。

## 目录

| 路径 | 职责 |
| --- | --- |
| `packages/domain-rfq` | 询盘状态、字段缺口与原文证据规则 |
| `packages/domain-quote` | 整数报价、最低售价、披露与有效期规则 |
| `packages/domain-commerce-network` | 委托、代理协议、产品/市场归属规则 |
| `packages/dsh-commerce-contracts` | 原生会话作用域、Owner HTTP 和共同验证 |
| `integrations/dsh/dsh-rfq-desk` | 来源入库、提取候选、人工审核、未发送回复草稿 |
| `integrations/dsh/dsh-mini-erp` | 唯一交易账本、报价版本/outbox、订单、样品与收款凭据 |
| `integrations/dsh/dsh-quote-guard` | 报价审核与单独发送、Resend 适配器、签名入站 |
| `integrations/dsh/dsh-commerce-network` | DSH 右侧画布、交易投影与审批 UI |
| `integrations/dsh/dsh-sample-flow` | 原生样品提议及凭据操作入口 |
| `integrations/dsh/dsh-channel-ledger` | 费用、报价、订单、收款与佣金的分项只读汇总 |

## 安装到隔离 DSH profile

构建后的七个独立安装包位于 `dist/commerce-business/`，附 SHA-256 manifest。先安装官方 DSH，再选择一个独立数据目录：

```sh
npm install -g @deepseek-ai/dsh@0.2.1-rc.3
export DSH_HOME=/absolute/path/to/isolated-dsh-commerce
dsh plugin --profile web add ./dist/commerce-business/*.tgz
dsh --profile web --no-open --port 4187
```

打开 DSH 输出的本地链接，创建原生工作区和会话，从右侧工具打开 Commerce Network。沿用原生会话、权限和模型配置。不是另一个独立网页应用。

真实邮件配置按用户选择留待后续完成。未配置通道时显示 UNCONFIGURED；测试仅使用合成数据，不会自动发送邮件或创建成交。

已有数据请先备份再升级。完整契约、配置和迁移边界见 [实现说明](COMMERCE-BUSINESS-IMPLEMENTATION.md)，实际验证结果见 [验收记录](COMMERCE-BUSINESS-ACCEPTANCE-2026-10-28.md)。远端 CI 的启动失败不影响按上述步骤执行本地验证，但不能视作远端 CI 已通过。
