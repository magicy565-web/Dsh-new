# 工厂本地资料入口

在本分支的仓库根目录、已有模型配置及已审价格／预算环境中，执行：

```sh
npm run factory:local -- --input ./product.md --output-dir .
```

这是一项有界的资料任务：官方 OMP 18.10.4 SDK 读取明确选择的文件，调用工厂 RFQ／匹配草稿工具，用原生 WriteTool 生成新报告，然后退出。不需要 Workspace 服务器、WS_AGENT_URL、WS_AGENT_TOKEN、企业 principal 或本地 HTTP Host。原 OMP SDK 持有模型／工具循环，没有新增 Agent Loop、数据库、账户或审批系统。

`--input` 可重复，最多四份 `.md/.txt/.csv/.json/.pdf`，总量最多 64 KiB。`--output-dir` 必须是已存在的真实目录。可选 `--task "具体目标"`；默认整理资料和缺项并保存 `report.md`。只允许新建平铺的 ASCII 文件名，例如 `report.md`、`rfq-2.txt`，不覆盖已有文件。每项任务最多四份输出（成功数加在途预留数共同计限，失败释放预留），每份模型正文最多 64 KB。输入不全时保留待确认；这不等于已核实产能、报价、接单或发货。

加 `--check` 只检查选定文件、输出目录、固定运行器和模型配置存在状态，不调用模型：

```sh
npm run factory:local -- --input ./product.md --output-dir . --check
```

模型未配置时预检返回 `model-unconfigured`，实际生成明确拒绝；不会生成示例报告或声称资料为空。使用已有 `PI_PROVIDER`／`PI_MODEL`、对应安全注入的密钥、`WORKSPACE_OMP_PROVIDER_COST_JSON` 和原 `WORKSPACE_OMP_LIVE_BUDGET_VERIFIED` 配置；不自动选账户、创建 key 或证明余额。DeepSeek 仍复用原固定官方 provider/模型配置。执行生成会把选定文件的提取内容交给该模型，运行前应有相应资料处理与费用授权；本次开发验收没有执行付费请求。密钥经原安全配置进入进程，在私有 fd 中传给 Bun，不进入工具参数、提示词、argv 或输出。

## DeepSeek 的非秘密配置与安全预检

仅存在 `DEEPSEEK_API_KEY` 不会自动选择 DeepSeek：原配置函数在没有 `PI_PROVIDER` 时默认 fastaitoken。沿用已有安全注入的 DeepSeek 密钥，明确指定以下非秘密配置；不要把密钥写进命令、提示词或版本库。

| 配置 | 原代码要求 |
|---|---|
| `PI_PROVIDER` | `deepseek` |
| `PI_MODEL` | `deepseek-flash`，必须显式选择 |
| `PI_BASE_URL` | 可省略，固定官方 `https://api.deepseek.com`；拒绝其他 DeepSeek 接收地址 |
| `WORKSPACE_OMP_PROVIDER_COST_JSON` | 完整提供 `input/output/cacheRead/cacheWrite` 四项，每百万 tokens 的 **美元**价格；不是人民币，也不是账户余额 |
| `WORKSPACE_OMP_LIVE_BUDGET_VERIFIED` | 仅当适用预算已核对时由可信运行环境设为 `1`；这是一项声明，不会自动核余额或形成金额硬上限 |

以下命令只做零模型请求的本地预检。价格示例复用仓库 `DEEPSEEK_PRICES.ompUsdPerMillion` 的 2026-10-15 已审 Flash 峰值快照，本轮没有完成重新在线核价，不将其当作新的实时价格／余额证明。命令不设置预算声明，不改变持久配置：

```sh
PI_PROVIDER=deepseek PI_MODEL=deepseek-flash \
WORKSPACE_OMP_PROVIDER_COST_JSON='{"input":0.3,"output":1.2,"cacheRead":0.006,"cacheWrite":0.3}' \
npm run factory:local -- --input ./product.md --output-dir . --check
```

预检只回报 provider/model 及 `apiKeyPresent/costPresent/remainingBudgetReviewed` 布尔。若预算声明未配置，返回 `model-unconfigured`，即使密钥已存在；不代表文件为空或密钥无效。四项配置就绪也只返回 `configured-unverified`，不会触发付费连通测试。`--check` 始终 `modelRequests:0`，不会自动将预算声明改为 `1`。

本轮在临时合成文件上实际执行了该 DeepSeek 预检：密钥存在为 true、临时已审价格配置存在为 true、原预算声明为 false，模型请求 0；只检查密钥存在布尔，未展示或检查原值；未读取聊天密钥、账户余额或用户业务资料，没有写入 `.env`。

首次安装仍用原固定依赖：`npm ci --ignore-scripts`、`node scripts/setup-omp-runtime.mjs`、`node scripts/workspace-omp-install.mjs`。当前固定运行器和目录 FD 发布方式仅验收 Linux x64、Bun 1.3.14；没有更换模型、Node 引擎或其他系统的隐式回退。

## 文件与服务边界

- 输入是显式文件选择，不扫描目录、聊天密钥、企业 Library 或旧会话。源文件与所有父级不得为符号链接；拒绝 `.git/.aws/.codex/.agents/.data` 和原 `workspace.json` 数据库。上游 ReadTool 只能读取受控快照，工具参数只能选 `input-1` 等已选 ID。
- 文件身份和 SHA 在模型／工具调用前后重新核对。源文件变化、被替换、权限撤销或输出目录被替换时停止；不能继承另一个 profile 的会话。PDF 使用上游提取结果与截断／OCR提示，不添加远程 OCR 或图像分析引擎。
- `write` 用上游 WriteTool 写入隔离暂存，最终通过已固定的输出目录 FD 和排他创建发布。拒绝绝对路径、`..`、子目录、URI／SQLite／配置目标、符号链接和覆盖。只有实际读取过来源后才可保存。
- 报告自动附加实际读取来源的文件名和 SHA，回执记录结果 SHA、`humanApproved:false`、`sent:false`。来源不等于真实性或语义正确性；后续失败时已保存文件会如实列出，不自动重试或覆盖。
- 临时 Session／AuthStorage／源快照在任务结束后清理；输出报告保留在用户选择目录。取消信号转交原 Session，超时有界停止。
- 本地 profile 只有 `read`、`write`、`workspace_factory_capabilities`、`workspace_factory_rfq_requirements`、`workspace_factory_match_prepare`。纯字段草稿不再调用 `businessPresets`。
- 企业共享数据、原业务历史／结果、原审批、远程 Worker 保留原服务授权，未替换为本地记录、空列表或样本。`npm start`／`npm run workspace` 仍是可选的原网页／服务入口。
- Shopify／MCP 连接不自动继承到此进程；本轮没有修改或验证这些连接，没有外部发送、商店写入、发布或部署。

## 无付费验收

```sh
node --test test/workspace-omp-local.test.mjs
npm run build
```

本地测试在隔离临时文件、无 Host、无 WS URL/token、无真实用户凭据环境中，使用原 OMP SDK/provider 注册路径与有限明确模型替身，真实调用上游 ReadTool/WriteTool。覆盖资料读取→RFQ／匹配缺项→带来源保存，以及原生路径、符号链接、源变更、覆盖和伪造远程工具拒绝。实际 npm 入口也执行了 `--check`，模型请求为零。测试代码通过私有参数传入替身；CLI、环境变量和生产选项没有替身开关。

[证据与限制](validation/omp-local-factory-20261015/README.md)。真实用户资料、这条新本地路径的真实付费模型执行、扫描 PDF／OCR、Shopify 和 MCP 尚未在线验收；此前独立 DeepSeek 连通记录不能代替这些验收。
