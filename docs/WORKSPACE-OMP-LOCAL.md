# 一句话发起本地 OMP Agent 会话

将一句目标放在命令末尾即可。默认使用所选输出目录的 `factory-session.jsonl`，通过原生 OMP `SessionManager.open` 创建／继续会话；`--session FILE.jsonl` 可选其他私有路径，`--task "目标"` 写法仍兼容。模型可按需选 `read`、工厂字段工具和 `write`，可以先追问，不预设步骤或每轮文件。每条命令只提交一个目标然后退出；下一条命令保持同一资料、目录和模型，换一句目标即可继续。没有新增循环、会话数据库或旧 Host 依赖。

本集成分支应在仓库根目录使用 npm 入口；输入文件和输出目录必须已经存在，Session 放在用户选定的私有路径。下面的预检不调用模型，也不创建 Session 文件：

```sh
npm run factory:local -- --input ./product.md --output-dir ./out "先读资料并询问缺项，暂不生成报告" --check
```

已有安全模型配置及适用的价格/预算授权时，移除 `--check` 发起该目标。下一轮例如：

```sh
npm run factory:local -- --input ./product.md --output-dir ./out "保留尚未确认的交期，按已有资料保存一份 intro.md"
```

该命令复用 `./out/factory-session.jsonl`。换资料/模型需明确选择新的 `--session` 文件；原来源绑定、SHA、profile、锁和未知计费校验仍生效。未给目标时只询问目标，不再默认生成 report.md。JSONL 含所选资料和对话，权限为 0600；不要提交会话文件。本分支忽略默认会话文件名及其锁，其他自选路径仍需自行保持私有。此入口不需要旧 Host 或 WS URL/token。当前最终集成已纳入原生上下文投影与跨轮重复工具 ID 的按出现次序配对修复：不同选定来源不会因 ID 重复而被误裁剪，同一来源的旧读取仍可由原生 pruner 裁剪。投影不改写 JSONL、工具 ID、用户目标或已保存正文。既有提交 `09834c1` 已将本地会话上限从历史12,000 bytes调整为128KiB，独立短调用策略仍为12,000 bytes；持续增长的不同历史内容仍可能超限。本轮没有改动限额。[历史失败及已有修复](validation/local-context-budget-fix-20261016/README.md)、[当前两轮草稿版本续改回归](OMP-STAGE2-LOCAL-PREPARATION-20261017.md)均为可核对证据，后者是有限替身，真实两轮尚未通过。更早固定源码检查见 [最终集成检查](validation/final-native-context-integration-20261015/README.md)，更早的 [入口检查](validation/local-native-entry-20261015/README.md) 保留为历史。下文 `/workspace/deepseek-acceptance` 等绝对路径仅属于原真实验收工作区记录，不是当前安装要求。

以下是**当前验收环境可复制的一条完整命令**，使用已安全注入的密钥和已审非秘密模型配置；资料是明确标注为合成验收的小产品文件。它会发起真实付费请求，本轮没有再次执行此命令：

```sh
PI_PROVIDER=deepseek PI_MODEL=deepseek-flash WORKSPACE_OMP_PROVIDER_COST_JSON='{"input":0.3,"output":1.2,"cacheRead":0.006,"cacheWrite":0.3}' WORKSPACE_OMP_LIVE_BUDGET_VERIFIED=1 node /workspace/deepseek-acceptance/scripts/workspace-omp-local.mjs --session /workspace/local-deepseek-acceptance-round2-20261015/conversation.jsonl --input /workspace/local-deepseek-acceptance-round2-20261015/product.md --output-dir /workspace/local-deepseek-acceptance-round2-20261015/output --task '请先看产品资料，告诉我还缺哪些交期和合规信息；先不要生成报告。'
```

继续时使用相同命令和同一个 `--session` 路径，只把 `--task` 改为下一句话，例如 `数量是200，交期仍待确认，请按已有资料写一份简短产品介绍并保存intro.md`。目标与文件名均可变，不会硬编码这份产品或报告模板。`--check` 可加在同一命令末尾，模型请求为零。`WORKSPACE_OMP_LIVE_BUDGET_VERIFIED=1` 表示本次适用预算已核对，不是自动查余额；此处旧检查点累计保守费用0.038716元、剩余授权估算4.961284元仅为历史；[随后真实记录](validation/live-two-turn-20261016/README.md)累计为0.051610元/估算4.948390元，均不是当前账单或可花余额，当前配置可用性及累计对账尚未核实。

资料选择继续沿用显式 `--input`／`--output-dir`。继续会话必须保持同一组源路径、名称、内容 SHA、输出目录和模型；变更则在模型请求前拒绝，避免旧上下文引用已撤销资料。会话 JSONL 含用户主动保存的对话和所选资料内容，以 0600 权限保留在用户指定路径；临时 AuthStorage／源快照仍清理。原生 SDK 负责历史树与恢复。符号链接、跨 profile、已有在途锁或未确认费用的中断会话拒绝继续，不自动重跑。命令退出后可用同一文件继续；本入口不是交互式 TUI。

**当前真实验收：已完成保存闭环。** 修复后新增获授权的一次真实执行，官方 Flash 自主选择 `read → write`，3 次实际 HTTP 请求、6.304 秒，保存 `missing-facts.md`（704 bytes），SHA256 `53ac3d85187991bd295fe09afdb49f2b566686921aca2e12a0e0853bdf14a047`。输入为明确合成公开材料，模型为真实 DeepSeek，未强制使用无关 RFQ／匹配工具。输出保留产能、库存、交期、认证、身份、价格与运输条款为待确认。原生会话及成果在 `/workspace/local-deepseek-acceptance-round2-20261015/`，未提交 Git。

3 个响应的输入总计 6,008 tokens：非缓存输入 2,296、缓存读取 3,712、缓存写入 0；输出 446，总计 6,454。全部输入仍按缓存未命中峰值 2 元／百万、输出 8 元／百万计保守费用 **0.015584 元**，无用量不明或自动重试。累计 **0.025080 元**、剩余授权估算 **4.974920 元**，没有查账户余额。本轮中文价格重取超时，沿用同日此前成功核对的官方人民币价格；英文页确认价格及 1M 上下文未变。

随后只在原生 JSONL 的隔离副本上无付费续接：原 SDK 恢复相同 Session ID 和上轮真实上下文，明确有限替身完成下一句追问；真实会话和报告 SHA 均未改变。该检查证明恢复合同，不能冒充又一次真实模型续聊。

历史上第一轮真实执行曾在 RFQ／匹配工具报错处停止（2 请求，0.009334 元），没有成果。之后 schema 收紧，并补充原 SDK 验证器＋真实工具执行的 13 组参数合同检查；纯空白字段现在保留待补充。该历史失败仍保留在验收说明中，未改写为成功。

**原 Session 的真实续聊已保存第二份成果，但回合尾部受限。** 在同一个原生 Session ID 中，目标换成英文询问邮件，模型自主 `read → write`，保存 `inquiry-email.md`（1,105 bytes，SHA256 `c04046e89d7cf3819858453ec4d867a3af5bea5bf55f773fcfc611c6d5dff4ed`），未发送。前轮6条真实消息记录原样保留，第一份说明的 SHA 未改变。本轮2次实际请求，输入5,466（非缓存2,906＋缓存读2,560）、输出338，总5,804 tokens，保守费用0.013636元，耗时5.883秒。第三个逻辑请求用于回合结束确认，但序列化请求体超过12,000 bytes，在实际发送前以 `SHORT_INPUT_LIMIT` 停止。没有第三次发送、未知计费或重跑；返回状态仍为 `stopped`，不会把保存文件等同于完整回合完成。这是历史源码的长度限制失败；既有 `09834c1` 离线修复已纳入当前分支，不能用修复后的替身证据改判该历史失败，仍不能宣称真实两轮或无限持续会话已验收。

保存来源现可复用原生会话当前活动分支里成对的成功 read 调用／回执；先通过原 profile／输入路径与 SHA 绑定校验，并重新校验当前文件。缓存来源的 ID、名称、SHA、非私库标志都必须匹配；未读取、错误或未配对回执不能授权保存。SDK intent 元数据不产生任何授权。因而合法续聊可直接 `write`，不强制再次 `read`，跨源与源变更仍拒绝。该分支先完成无付费直接写续聊回归及真实JSONL副本恢复检查，才执行上述唯一一次真实续聊。两份成果全文会随验收结果返回；运行文件均留在Git外。

## 文件选择与显式保存

在本分支的仓库根目录、已有模型配置及已审价格／预算环境中，执行：

```sh
npm run factory:local -- --input ./product.md --output-dir ./out "请先询问我想达成的目标"
```

这是有界的本地目标：官方 OMP 18.10.4 SDK 根据目标选择工具，只有请求保存时才拟定新文件。命令结束后保留原生 JSONL，下一条命令可继续。不需要 Workspace 服务器、WS_AGENT_URL、WS_AGENT_TOKEN、企业 principal 或 HTTP Host。原 SDK 持有模型／工具循环，没有新增 Agent Loop、数据库、账户或审批系统。

`--input` 可重复，最多四份 `.md/.txt/.csv/.json/.pdf`，总量最多 64 KiB。`--output-dir` 必须是已存在的真实目录。位置目标与 `--task "具体目标"` 二选一，拒绝重复目标。模型保存时只允许平铺 ASCII 的新 `.md/.txt` 文件名，不覆盖已有文件；默认原生会话 JSONL 由 SDK 管理。每项目标最多四份成果（成功数加在途预留数共同计限，失败释放预留），每份正文最多 64 KB。输入不全时保留待确认；草稿不等于已核实产能、报价、接单或发货。

加 `--check` 只检查选定文件、输出目录、固定运行器和模型配置存在状态，不调用模型：

```sh
npm run factory:local -- --input ./product.md --output-dir . --check
```

模型未配置时预检返回 `model-unconfigured`，实际生成明确拒绝；不会生成示例报告或声称资料为空。使用已有 `PI_PROVIDER`／`PI_MODEL`、对应安全注入的密钥、`WORKSPACE_OMP_PROVIDER_COST_JSON` 和原 `WORKSPACE_OMP_LIVE_BUDGET_VERIFIED` 配置；不自动选账户、创建 key 或证明余额。DeepSeek 仍复用原固定官方 provider/模型配置。执行生成会把选定文件的提取内容交给该模型，运行前应有相应资料处理与费用授权；本地路径已经执行过一次真实验收，准确结果见上文；后续修复没有再次付费。密钥经原安全配置进入进程，在私有 fd 中传给 Bun，不进入工具参数、提示词、argv 或输出。

## DeepSeek 的非秘密配置与安全预检

仅存在 `DEEPSEEK_API_KEY` 不会自动选择 DeepSeek：原配置函数在没有 `PI_PROVIDER` 时默认 fastaitoken。沿用已有安全注入的 DeepSeek 密钥，明确指定以下非秘密配置；不要把密钥写进命令、提示词或版本库。

| 配置 | 原代码要求 |
|---|---|
| `PI_PROVIDER` | `deepseek` |
| `PI_MODEL` | `deepseek-flash`，必须显式选择 |
| `PI_BASE_URL` | 可省略，固定官方 `https://api.deepseek.com`；拒绝其他 DeepSeek 接收地址 |
| `WORKSPACE_OMP_PROVIDER_COST_JSON` | 完整提供 `input/output/cacheRead/cacheWrite` 四项，每百万 tokens 的 **美元**价格；不是人民币，也不是账户余额 |
| `WORKSPACE_OMP_LIVE_BUDGET_VERIFIED` | 仅当适用预算已核对时由可信运行环境设为 `1`；这是一项声明，不会自动核余额或形成金额硬上限 |

以下命令只做零模型请求的本地预检。价格示例复用仓库 `DEEPSEEK_PRICES.ompUsdPerMillion` 的 2026-10-15 已审 Flash 峰值快照，本次真实执行前已重新核对官方价格；价格不能用作账户余额证明。命令不设置预算声明，不改变持久配置：

```sh
PI_PROVIDER=deepseek PI_MODEL=deepseek-flash \
WORKSPACE_OMP_PROVIDER_COST_JSON='{"input":0.3,"output":1.2,"cacheRead":0.006,"cacheWrite":0.3}' \
npm run factory:local -- --input ./product.md --output-dir . --check
```

预检回报发送限制、provider/model 及 `apiKeyPresent/costPresent/remainingBudgetReviewed` 布尔。若预算声明未配置，返回 `model-unconfigured`，即使密钥已存在；不代表文件为空或密钥无效。固定官方 DeepSeek Flash 的四项配置就绪也只返回 `configured-unverified`；其他已配置模型返回 `provider-unsupported`，实际生成在发送前拒绝。不会触发付费连通测试。`--check` 始终 `modelRequests:0`，不会自动将预算声明改为 `1`。

本轮在临时合成文件上实际执行了该 DeepSeek 预检：密钥存在为 true、临时已审价格配置存在为 true、原预算声明为 false，模型请求 0；只检查密钥存在布尔，未展示或检查原值；未读取聊天密钥、账户余额或用户业务资料，没有写入 `.env`。

首次安装仍用原固定依赖：`npm ci --ignore-scripts`、`node scripts/setup-omp-runtime.mjs`、`node scripts/workspace-omp-install.mjs`。当前固定运行器和目录 FD 发布方式仅验收 Linux x64、Bun 1.3.14；没有更换模型、Node 引擎或其他系统的隐式回退。

## 实际 HTTP 限制与费用边界

本地付费入口只接受原官方 DeepSeek Flash provider，通过原 `createWorkspaceOmpSession`、`sdk.streamSimple`、OpenAI completions provider 和 SDK SSE 回调执行。复用只读验收的 `boundedDeepseekFetch`，没有另建模型循环或持久预算系统。

- 每项任务最多 **8 次实际 HTTP 发送**；最终序列化请求体最多 **128KiB（131,072 bytes）**，默认本地profile仅文本消息和五个本地工具，固定官方地址，禁止重定向。
- 每次请求固定 `max_tokens:512`、关闭 thinking。完整响应必须报告不超过 32,000 输入 tokens、512 输出 tokens；32k 是收到 usage 后的接续条件，SDK 的 context 元数据与请求字节数都不能证明输入 token 硬上限。
- 前一请求的原始 SSE usage 与 SDK 完整 usage 一致、非空有效且在界内，才允许下一次发送。HTTP／流／工具错误、断流、空响应、缺失或不一致 usage、输入超限均停止。底层 SDK 内部仍有重试实现；共享 abort 信号和发送门禁确保其重试或空响应 replay 不会产生下一次 HTTP 发送。`maxRetries:0` 不是唯一依据。
- 返回 `actualProviderRequests` 与逻辑 `modelRequests`，并区分已确认费用与未确认预留。用量不明不记为免费：保留一个完整未确认请求的预留，并标记 `billingUncertain:true`、不自动重试。任务超时／进程中断而未取得完整回执时同样不可按零扣款处理。

费用按仓库 2026-10-15 已审[官方人民币峰值价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)快照计算：输入全部按缓存未命中 **2 元/百万 tokens**，输出 **8 元/百万 tokens**。USD 配置仅用于原 SDK 元数据，不做汇率换算或余额推断。HTTP 限制开发阶段重取页面曾超时；本次真实执行前已重新成功核对官方中英文页面，峰值价格与 1M 上下文未变。

全部响应已确认时：`8 × (32,000×2 + 512×8) / 1,000,000 = 0.544768 元`。

错误／用量不明时最多有七个已确认前缀和一个未确认发送。已审 Flash 文本上下文为 1M；未确认输入按 **1,100,000 tokens** 预留，覆盖十进制／二进制 1M，而不是以 12KB 猜测 token 数。因此保守上界为：`[7×(32,000×2+512×8) + 1,100,000×2+512×8] / 1,000,000 = 2.680768 元`，低于固定单任务预留 **2.70 元**；首次执行前剩余授权估算 **4.999838 元**、旧后续检查点 **4.961284 元**及随后 **4.948390 元**均为历史估算，当前余额未核实。这不是新增账户预算系统，跨任务不会自动累计余额；每次真实执行仍须使用适用的原预算授权。

上述人民币上界以价格快照和 provider 遵守已发布上下文／输出协议为前提，不是实际账户扣款保证。若 usage 报告超过物理预留或 512 输出，立即停止并返回 `chargeUpperCny:null`，不再声称有限费用。`accountChargedCny` 始终为空，因为本入口不访问账户账单。这条路径第二次获授权的真实付费执行已完成读取／保存，费用和 SHA 见上文；没有在本轮内自动重跑。

## 文件与服务边界

- 输入是显式文件选择，不扫描目录、聊天密钥、企业 Library 或旧会话。源文件与所有父级不得为符号链接；拒绝 `.git/.aws/.codex/.agents/.data` 和原 `workspace.json` 数据库。上游 ReadTool 只能读取受控快照，工具参数只能选 `input-1` 等已选 ID。
- 文件身份和 SHA 在模型／工具调用前后重新核对。源文件变化、被替换、权限撤销或输出目录被替换时停止；不能继承另一个 profile 的会话。PDF 使用上游提取结果与截断／OCR提示，不添加远程 OCR 或图像分析引擎。
- `write` 用上游 WriteTool 写入隔离暂存，最终通过已固定的输出目录 FD 和排他创建发布。拒绝绝对路径、`..`、子目录、URI／SQLite／配置目标、符号链接和覆盖。只有实际读取过来源后才可保存。
- 报告自动附加实际读取来源的文件名和 SHA，回执记录结果 SHA、`humanApproved:false`、`sent:false`。来源不等于真实性或语义正确性；后续失败时已保存文件会如实列出，不自动重试或覆盖。
- 临时 Session／AuthStorage／源快照在任务结束后清理；输出报告保留在用户选择目录。取消信号转交原 Session，超时有界停止。
- 本地 profile 只有 `read`、`write`、`workspace_factory_capabilities`、`workspace_factory_rfq_requirements`、`workspace_factory_match_prepare`。纯字段草稿不再调用 `businessPresets`。
- 企业共享数据、原业务历史／结果、原审批、远程 Worker 保留原服务授权，未替换为本地记录、空列表或样本。当前 `npm start`／`npm run workspace` 是离线原生预览；原网页／服务须显式选择legacy入口，见 [阶段1入口说明](OMP-STAGE1-TUI-20261017.md)。
- Shopify／MCP 连接不自动继承到此进程；本轮没有修改或验证这些连接，没有外部发送、商店写入、发布或部署。

## 无付费验收

```sh
node --test test/workspace-omp-local.test.mjs test/workspace-omp-local-wire.test.mjs
npm run build
```

本地测试在隔离临时文件、无 Host、无 WS URL/token、无真实用户凭据环境中，使用原 OMP SDK/provider 注册路径与有限明确模型替身，真实调用上游 ReadTool/WriteTool。覆盖资料读取→RFQ／匹配缺项→带来源保存，以及原生路径、符号链接、源变更、覆盖和伪造远程工具拒绝。实际 npm 入口也执行了 `--check`，模型请求为零。测试代码通过私有参数传入替身；CLI、环境变量和生产选项没有替身开关。

新增 wire 测试直接走原官方 provider 的 HTTP/SSE 路径，仅替换 fetch 返回明确合成报文；断言实际发送数、请求 bytes、thinking／输出限制，以及 500、连接／流错误、截断、缺失／部分／不一致／超限用量、空响应、工具失败、上下文增长和八次耗尽。该证据明确标为 `mocked-http`，不能证明真实付费成功。

[证据与限制](validation/omp-local-factory-20261015/README.md)。真实用户私密资料、更长续聊的上下文控制、扫描 PDF／OCR、Shopify 和 MCP 尚未完成在线验收；此前独立 DeepSeek 连通记录不能代替这些验收。
