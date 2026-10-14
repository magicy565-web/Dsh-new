# Workspace · 中国工厂开发版

默认前端使用官方 OMP 18.10.4，Bun固定1.3.14；原Workspace身份、Session、Store、Runtime、业务任务、人工审批和Pi Durable阶段继续持有执行权威。工厂公开资料进入原四阶段文书流程，未知产能、客户来源和商业条件保留待核对。

```sh
npm ci --ignore-scripts
node scripts/setup-omp-runtime.mjs
node scripts/workspace-omp-install.mjs
npm run build
npm run workspace
```

本轮运行器安装适用于Linux x64。`npm start`、`npm run agent:dev`沿用同一网页入口；无模型／成员绑定／已审价格与剩余预算时可以保存工作，执行返回明确未配置，零模型调用。先用 `npm run workspace -- --check` 检查，配置存在不代表在线已验证。完整中文说明、配置边界及前端协作接口见 [Workspace OMP](docs/WORKSPACE-OMP.md)。

工厂包为 `@workspace-agent/pi-factory`，兼容目录 `packages/workspace-procurement`；普通模式五工具，受控宿主六工具只提交原 `factory-export`。原Pi1.1.0终端保留显式 `npm run agent:pi` 回退。默认入口不启动独立TUI或第二业务账本，不迁入旧Pi／私库缓存，不开放任意本机文件和命令工具。

[默认入口与原生命周期11项检查](docs/validation/workspace-omp-core-20261014/default-acceptance.json)覆盖真实HTTP／SDK、独立manifest加载、续聊、取消退出、重启恢复、原文书SHA、人工审批与分别继续。模型均为明确合成替身；原Pi／Library／包组合53项亦实际通过。另有 [工厂文书与重载检查](docs/validation/factory-export-20261014/README.md)、[内置搜索／浏览器诊断](docs/validation/omp-builtins-factory-20261014/README.md)、[内置子代理诊断](docs/validation/omp-builtin-task-20261014/README.md) 和 [固定社区候选检查](docs/validation/pi-community-20261014/README.md)。

真实DDG查询连接失败、零来源；默认受控入口未开放搜索、浏览器或子代理。真实余额／付费模型、真实获客与同伴分支的结果／恢复UI没有完成验收。文书完成不是供货承诺、发送或销售证明。付费调用零；没有真实私库访问、外部发送、商店写入、部署或main合并。七天未来通知的持续同意／持久收件人权限未开发。

[旧README完整历史](docs/archive/README-before-omp-20261014.md)、[旧选型记录](docs/PI-OPEN-SOURCE-SELECTION.md) 和 [PR60接线记录](docs/PI-AGENT-RUNTIME-NOTES.md) 已归档；[原Pi运行边界](docs/PI-RUNTIME.md)、[原Library契约](docs/PI-LIBRARY-MODEL-READ.md)、[微信客户端](docs/WECHAT-CLIENT.md)、源码、许可与既有验收保留。归档不授权历史部署或外部执行。清理范围见 [清理记录](docs/validation/omp-cleanup-20261014/inventory.json)。
