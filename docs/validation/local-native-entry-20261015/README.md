# 自然语言本地入口：离线交付

代码 SHA：`4af0d21686f4388736cdf838731bb86ec4f5134e`。完整 parent 为集成基线 `0bda6c7879c5acc44bc87b84abd2346d8fcbb5ae` 与原生续聊来源修复 `cc732f2be93fd0667bb1b553d7f4762c25b2f8ee`。独立分支 `codex/local-native-entry-20261015`。

本轮自有生产改动限 `scripts/workspace-omp-local.mjs` 的参数解析/帮助和默认 Session 选择；默认 JSONL/锁文件加入 `.gitignore`。原执行函数、SDK Session、provider transport、12KB 闸门、上下文与来源复用实现保持合入 cc732f2 后的原样，没有新循环、Host、数据库或审批系统。

## 命令

在仓库根目录，先准备明确的输入文件和已存在的输出目录。以下预检零模型请求，不创建会话：

```sh
npm run factory:local -- --input ./product.md --output-dir ./out "先看资料，问我缺项，不要生成报告" --check
```

已有安全模型配置及适用的原价格/预算授权时，去掉 `--check` 提交一个目标：

```sh
npm run factory:local -- --input ./product.md --output-dir ./out "先看资料，问我缺项，不要生成报告"
```

默认使用 `./out/factory-session.jsonl`；下一次保持相同资料、目录和模型，换一句目标即可继续同一原生会话：

```sh
npm run factory:local -- --input ./product.md --output-dir ./out "保留未确认交期，按已有资料保存 intro.md"
```

`--session ../private-session.jsonl` 可显式选其他私有路径；`--task "一句话目标"` 继续兼容。位置目标与 --task 二选一，重复目标拒绝。没有目标只询问目标，不再默认 report.md。每条命令只提交一个目标后退出，不是交互式 TUI，也不保证模型理解或每轮输出文件。无 Workspace Host/WS URL/token 依赖；缺模型配置明确不可用。

原 SessionManager 管理 JSONL；会话含所选资料和对话，文件权限 0600，不应提交。默认文件名及锁已忽略，其他私有路径仍由用户显式选择。不同资料/模型应选择新的 Session；原 SHA、profile、锁、未知计费与写入限制继续适用。

## 实际离线结果

`node --test --test-concurrency=1 test/workspace-omp-local-entry.test.mjs test/workspace-omp-local.test.mjs test/workspace-omp-local-wire.test.mjs test/workspace-factory-field-contract.test.mjs test/workspace-omp-integration.test.mjs`：**36/36，0 fail/skip/cancel，exit0**。`npm run build`（含 tsc）及 diff 检查通过，保留已有 bundle 大小提示。

新入口测试通过实际原 OMP SDK 和有限模型替身验证：默认 Session 第一轮只追问、不生成报告；第二轮相同 Session ID 直接 write，复用经当前 SHA 重新校验的前轮 read 来源；实际保存 intro.md，未生成 report.md。另实际执行 npm 位置目标预检/帮助，无 Host、WS URL/token 或真实模型凭据，模型请求 0，未创建 JSONL。原 wire/mock HTTP、来源伪造/变更、未读取拒绝、跨 profile 与并发锁回归也通过。

这是离线合同检查，不是新增真实付费模型验收。本轮没有调用真实模型、Shopify、业务 MCP 或 Muse，没有查/改凭据、main、部署、用户资料或原运行文件。临时输入、JSONL、报告和原始日志不提交；只提交源码、测试、说明及 [检查摘要](checks.json)。历史整体回归仍对应 0bda6c7 所记录版本，本轮不冒充重跑全仓。

## 待主任务统一验收

cc732f2 的原线程记录显示：真实续聊已保存第二份文件，但写入后的结束确认在 12KB 发送前闸门被停止，状态仍为 stopped。入口改进不修复或掩盖该问题；本轮没有放大限制、丢弃历史、自动重试或改写 stopped。主任务正在处理 transport/context；待其固定补丁到达后再统一验收，当前不宣称长会话完整结束已通过。

本环境 Git CLI 认证不可用，使用现有 GitHub 连接取回/发布源码，未创建凭据。cc732f2 的 8 个 blob、完整 tree、原始 commit SHA 均逐项校验；代码发布 tree 与离线实测 tree 完全相同，SHA 为 `f1fba536892a55033a008477b9c4a8a1cec662d4`。仅 Git 提交元数据由现有连接生成，源码未被重写；检查摘要同时保留该对应关系。
