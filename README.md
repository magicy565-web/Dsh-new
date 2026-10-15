# Workspace · 中国工厂开发版

默认前端使用官方 OMP 18.10.4，Bun固定1.3.14；原Workspace身份、Session、Store、Runtime、业务任务、人工审批和Pi Durable阶段继续持有执行权威。本地资料任务可直接通过原 OMP SDK 生成并保存本地草稿；显式服务模式仍保留原四阶段文书流程。未知产能、客户来源和商业条件保留待核对。


无需远程 Workspace 服务器的一句话会话入口：`npm run factory:local -- --input ./product.md --output-dir . --session /workspace/factory-session.jsonl --task "先看资料，问我缺项，不要生成报告"`。重复使用同一 `--session` 路径、替换下一句 `--task` 即可继续原生 OMP 会话；目标、工具顺序和是否保存均不固定。输入文件和输出目录必须明确选择；目录已存在，结果不覆盖已有文件。`--check` 只做本地预检，不调用模型。实际生成仍使用原已配置模型及已审价格／预算；不会自动创建凭据。见 [本地资料入口与验收](docs/WORKSPACE-OMP-LOCAL.md)。业务历史、企业共享资料、审批和远程 Worker 保留原服务边界。

```sh
npm ci --ignore-scripts
node scripts/setup-omp-runtime.mjs
node scripts/workspace-omp-install.mjs
npm run build
npm run workspace
```

本轮运行器安装适用于Linux x64。交互TTY下 `npm run workspace`／`npm run agent:dev` 自动打开官方OMP终端，自然输入沿原HTTP Conversation/Run；非TTY及 `npm start` 提供原网页服务。终端UI不另调用模型。无模型／成员绑定／已审价格与剩余预算时可启动，模型执行返回明确未配置；先用 `npm run workspace -- --check` 检查，配置存在不代表在线已验证。中文配置、授权边界与协作接口见 [Workspace OMP](docs/WORKSPACE-OMP.md)。

工厂包为 `@workspace-agent/pi-factory`，兼容目录 `packages/workspace-procurement`；普通模式五工具，受控模式增加原 `factory-export` 文书提交。宿主另显式提供固定公开搜索、已有浏览器检查、精确选定文件读与原生公开文字子代理审阅。原Pi1.1.0保留 `npm run agent:pi` 显式回退。旧Pi／私库缓存不迁入；任意本机文件和命令不开放，没有第二业务账本。

[默认入口与原生命周期11项检查](docs/validation/workspace-omp-core-20261014/default-acceptance.json)覆盖真实HTTP／SDK、独立manifest加载、续聊、取消退出、重启恢复、原文书SHA、人工审批与分别继续。模型均为明确合成替身；原Pi／Library／包组合53项亦实际通过。另有 [工厂文书与重载检查](docs/validation/factory-export-20261014/README.md)、[内置搜索／浏览器诊断](docs/validation/omp-builtins-factory-20261014/README.md)、[内置子代理诊断](docs/validation/omp-builtin-task-20261014/README.md) 和 [固定社区候选检查](docs/validation/pi-community-20261014/README.md)。

新[公开工具契约与检查](docs/validation/omp-public-tools-20261014/README.md)覆盖官方SDK工具、来源与原任务文书、撤销/变更资料缓存的模型前拒绝。真实DuckDuckGo和Startpage查询均不可用、零来源，不能写成已连接或已获客。真实余额、真实私密资料、真实获客与同伴结果／恢复UI尚未验收。本地路径修复后已由真实 DeepSeek 自主 read→write 保存带来源SHA的缺项说明，3次HTTP请求、6.304秒；原生JSONL会话恢复另有无付费合同验证。历史首轮工具错误仍保留记录。此前 [DeepSeek 基础连通](docs/validation/deepseek-model-live-20261015/README.md) 已单独完成，不代表本地业务链在线验收。文书只是待人工审核草稿。本次保守费用0.015584元，已知累计0.025080元、剩余授权估算4.974920元；没有真实私库访问、外部发送、商店写入、部署或main合并。七天未来通知的持续同意／持久收件人权限未开发。

[旧README完整历史](docs/archive/README-before-omp-20261014.md)、[旧选型记录](docs/PI-OPEN-SOURCE-SELECTION.md) 和 [PR60接线记录](docs/PI-AGENT-RUNTIME-NOTES.md) 已归档；[原Pi运行边界](docs/PI-RUNTIME.md)、[原Library契约](docs/PI-LIBRARY-MODEL-READ.md)、[微信客户端](docs/WECHAT-CLIENT.md)、源码、许可与既有验收保留。归档不授权历史部署或外部执行。清理范围见 [清理记录](docs/validation/omp-cleanup-20261014/inventory.json)。
