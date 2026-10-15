# 最小 OMP / DeepSeek 只读验收

独立分支 `codex/deepseek-readonly-acceptance-20261015`，基线为指定 PR80 提交 `6d1d1175f60802960b411ff751c6dad003d8570f`。用户最新已明确确认**剩余总测试预算 CNY5**，本版本采用此确认，不再要求历史对账 JSON、15 分钟期限、外部硬限额证明或永久文件 reservation。旧 1fe3a46 的 Pi/对账验收仅作历史，不再是当前入口。

## 安全输入后的一键检查与执行

在已有云端 secrets/environment 的安全设置中注入用户原有 `DEEPSEEK_API_KEY`。不要发送聊天 Key、放进命令参数、Git 或日志，不创建/轮换凭据。原业务服务的已有 `WS_AGENT_URL` 和 `WS_AGENT_TOKEN` 同样由原安全入口绑定；缺失时检查会明确等待，不新建 token、启动另一份业务服务或扩大权限。此次检查三个变量均为 false。

```sh
node scripts/acceptance-deepseek-readonly.mjs --check
```

该检查只报告上述变量的存在性和固定运行器完整性；零模型请求，不读凭据文件、不连接账户或业务 API。OMP/Bun 已按原审计安装。固定选择已有 `deepseek-flash`，使用 `https://api.deepseek.com`；不需要再填写 PI_PROVIDER、价格 JSON、预算布尔或另一套验收 JSON。未知/昂贵模型与自定义目的地不会从环境继承。

安全绑定齐全后，在同一获批剩余额度内执行一次：

```sh
node scripts/acceptance-deepseek-readonly.mjs --execute-paid-requests
```

先通过已有客户端只读检查原服务和一项成员任务；没有可引用的已有记录就停止，不为了验收创建任务。然后在临时、隔离、受限环境的 Bun 进程中调用原 `createWorkspaceOmpSession`。官方 OMP 18.10.4 的 provider、AgentSession、工具调度、usage 和生命周期实际执行。只有原 `workspace_business_tasks` 工具可用；HTTP 边界仅接受原 origin 的 health/presets/tasks GET。不会读私库、提交、批准、恢复或取消业务。

## 保留的限制和预算机制

- 使用原 `workspaceOmpConfiguration`、价格结构和 `remainingBudgetVerified` 机制，预算确认来自用户最新 CNY5 剩余额度；不新增资金授权系统。
- 最多 2 次模型请求、每次最多 512 输出 tokens、整个请求最多 12000 UTF-8 字节、非思考模式，整体 60 秒中止。保留原 OMP 的禁自动重试、禁模型回退、禁压缩和禁附带任务调用。
- 使用原 Session 现有扩展钩子提供简短只读提示。实际 provider 请求由固定目的地的传输限制检查并裁剪为 DeepSeek 支持的非思考 wire；官方 SDK 仍负责编解码和全部循环。没有另写 AgentLoop，不修改 OMP 公共 Session 或 Host。
- 每次继续前检查 SDK 上一回复的非零实测 usage；缺失/无效 usage、HTTP 失败、网络中断或工具失败立即停止，不继续产生下一笔费用。最终 usage 不明也不能报成功。不要重试收费不确定的请求，先核对账户；脚本不会自动补跑。
- CNY5 是各线合计剩余上限，不能每次运行或每条线重新领取 CNY5。只执行一次最小验收；任何后续测试要扣除本次和其他线已发生费用。没有永久 reservation 文件。

2026-10-15 核对[官方人民币价目](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)：Flash 高峰价输入 2 元、输出 8 元／百万 tokens，空闲减半。按原 Session 的 32000 context 上限和每次 512 输出、最多两次请求，保守估算为 `2 × (32000 × 2 + 512 × 8) / 1000000 = CNY0.136192`，低于本轮确认的 CNY5；实际短请求通常更少。usage 输出 `usageUpperCny` 是按高峰价估算，不冒充账户实扣。

[官方美元价目](https://api-docs.deepseek.com/quick_start/pricing/)中高峰输入/输出/缓存命中分别为 USD0.30/1.20/0.006 每百万 tokens，按原 OMP 的 USD 单位填入配置。人民币预算估算直接取人民币价目，不猜测汇率。价格可能变化；真正执行前若价目已变化、费用口径不明或其他线已耗用预算，应停止并更新已有配置/剩余额度，不能沿用过期估算。

## 输出与验证边界

成功输出最终回答、实际引用的任务 ID/API、usage 上界、模型请求数及 `sdk:omp@18.10.4`。已知绑定凭据和明显凭据格式不能出现在回答；原始会话和任务正文不公开输出，临时文件随进程退出清理。来源引用检查不等于全部语义正确或商业目标达成，最终内容仍需原成员审阅。

当前密钥未安全注入，因此仅完成代码和离线测试，真实模型请求 **0**、新增费用 **CNY0**。不把官方 SDK 的替身测试标为真实模型验收。当前 12 项聚焦测试真实运行 OMP SDK、provider wire、原 HTTP/Store；DeepSeek SSE/usage 和业务测试记录均为明确合成。Pi 仅作为原业务服务的测试后台 fixture，没有代替 OMP 前端模型路径。

```sh
node --test test/deepseek-acceptance-policy.test.mjs test/deepseek-readonly-wire.test.mjs
```

没有公共 Host、market-validation、Shopify、main、部署或权限变更。此前仅为 Pi 验收新增的 transport hook 已撤回至指定基线。
