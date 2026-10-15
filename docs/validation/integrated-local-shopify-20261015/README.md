# 本地资料入口与 Shopify 七天范围集成

独立开发分支：`codex/integrate-local-shopify-scope-20261015`。最终集成代码检查点：`0533f945457a0f95292e6554df29dbac9c9b4efb`；初次合并为 `bd1ea5d803f54ce754fb13250a633415c79ca130`。

初次 merge commit 的两个 parent 是本次指定的 `ad9952894a0ed6be7f17090af14185f5f2c85b42` 和 `f2eb0630372cf9b0a09a62d59005d6fcc5ad4072`。共同祖先为 PR80 `6d1d1175f60802960b411ff751c6dad003d8570f`。PR81 `f6fa3c5a08a33a96ae914574f186814208516ebe` 也完整包含于 ancestry；没有 cherry-pick 丢失来源。随后 merge `c02713c82d5b891a4d40c8966754c24817a6e661` 纳入新增原生 JSONL 会话/工具 schema 固定提交 `460240e335d76d6d00fc1942dfd59321770a742c`，其 ancestry 同时保留 f2eb063。最后 merge `0533f945457a0f95292e6554df29dbac9c9b4efb` 纳入 `b6603acf261e6653e0ed3df653531eed00b73d38` 的空白字段/参数结构摘要修复及原线程真实闭环记录。主分支未修改、未合并或强推，未部署。

## 冲突处理与能力归属

实际冲突为 `server/index.mjs`、`pi-business-agent.mjs`、`workspace-omp-bridge.mjs`、`workspace-omp-host.mjs`、`workspace-omp-session.mjs` 五个文件；460240e 增量另在同一 Session 文件产生一处 guard 冲突，保留原生 localSession 限制与既有 Shopify 隔离条件。实施前均已报告共享接线范围。

- 原 Host attach 同时保留 supplier/publication/shopify 与原 sessionReadonlyClient；执行、来源、人审、Store、Runtime、Session 继续归原服务。
- 原 OMP Session 参数、scope、skill/tool 注册合并两侧能力。本地 profile 仍只有 read/write 和三个纯字段工厂工具；新增跨分支校验拒绝本地/Session-read profile 混入 Shopify 标志或 productClient。
- bridge 同时保留 Shopify RPC 白名单与 public Session 只读白名单；Shopify/市场等专属 profile 不接受普通业务 RPC。
- Host 缺成员 transport 时，只有 public profile 可使用已授权的原 Session 只读 client；private remote profiles 明确返回未配置，不能把只读历史权限当成 Library/Shopify 执行许可。

原本地文件实现、JSONL 创建/继续、工厂字段 schema 与 DeepSeek 有界 HTTP/usage 门禁逐文件保持 `b6603ac` 原样；原 `deepseek-acceptance-policy.mjs` 费用规则保持 `f2eb063` 原样；本次没有重新设计模型 provider、预算或调用真实模型。Shopify 完整原 sourceSkuId→variantId 映射、launch reader、scopeHash、原 publisher 逐文件保持 `ad99528` 原样。PR80 的 `plan.mjs` 历史时间口径及 `market-validation-assessment.mjs` 保持 `6d1d117` 原样。没有第二套 writer、Agent loop、审批系统或七天调度器。

## 启动与预检

在仓库根目录安装原锁定依赖/运行器：

```sh
npm ci --ignore-scripts
node scripts/setup-omp-runtime.mjs
node scripts/workspace-omp-install.mjs
npm run build
```

本地资料入口只需要明确选择的文件与已存在的输出目录：

```sh
npm run factory:local -- --input ./product.md --output-dir . --session ../factory-session.jsonl --task "先读资料并询问缺项，暂不生成报告" --check
npm run factory:local -- --input ./product.md --output-dir . --session ../factory-session.jsonl --task "先读资料并询问缺项，暂不生成报告"
```

第一条是零模型请求预检，不创建 Session 文件。第二条沿用原已安全配置的模型及已审价格/预算，由原生 OMP JSONL 保存/继续同一目标会话；下一轮保持同一源、输出目录、模型和 Session 路径并替换 --task。可先追问，无需每轮生成报告。JSONL 含资料内容，应放在用户选定的私有路径，不加入版本库。本轮只检查/测试此路径，不执行真实生成。不要把凭据放进命令、聊天或版本库。无配置返回 `model-unconfigured` 或明确停止；不会用样本冒充资料/模型成功。本地 core 不依赖 Workspace 服务器、WS URL/token、企业 principal、远程 Library、Shopify、MCP 或 Muse。

可选的原 Workspace 服务入口：

```sh
npm run workspace -- --check
npm start
```

`npm start` 仍是原 `workspace-omp.mjs --serve`；TTY 的 `npm run workspace` 仍使用官方终端。原远程专业 profile 的预检示例：

```sh
WORKSPACE_OMP_PROFILE=shopify-product npm run workspace -- --check
WORKSPACE_OMP_PROFILE=market-validation npm run workspace -- --check
```

预检不会配置或授予权限。原 Library policy、原身份/transport、商店授权、原获客 receipt、净支付 adapter 等未配置时必须报告不可用。Shopify 发布仍不等于获客开始，retained sale units 仍不等于 net paid physical units；完整映射和包/件规则见 [Shopify 交付](../shopify-market-scope-20261015/README.md)。

## 本次验证及边界

最终结果、源码 hash、命令、退出码与失败说明见 [checks.json](checks.json)。定向测试覆盖本地工具/HTTP 替身、原 Session/npm 启动、Shopify 1/4/100 SKU 和完整 monitor 映射；它与完整 backend 范围重叠，不累加计数。完整 backend 按原 `scripts/test-backend.mjs` 相同文件选择器运行，主分区使用 `--test-concurrency=2`，唯一比较整个 /tmp 的 `factory-materials-read.test.mjs` 单独串行运行，以免其他合法测试临时目录干扰断言；两个分区覆盖相同完整文件集合，生产测试脚本未改。另运行原 DOM 套件和小程序构建。首轮整体检查暴露旧默认 pi 日志断言及 OMP/DOM 两处旧空映射 fixture；基线 ad99528 复现旧日志断言失败。修正为已有默认 omp，并将 fixture 迁移到完整原 Store publication/明确 workspace；保持原审批数量、取消/撤权和生产完整映射校验。首轮失败与最终复验分别记录，不混报为初次全绿。

实际 npm 预检使用临时合成文件与白名单环境：无 WS URL/token、无模型凭据、无原 Host。local files ready 且 `model-unconfigured`/modelRequests 0；public 与六个 remote profiles 均 `unconfigured`/modelCalls 0。原 npm start 的实际启动、签名登录、Session→OMP工具链与清理由原 keyless startup fixture 验证。

模型响应、HTTP/SSE、业务资料、Shopify、身份、人审、启动和支付内容都是明确有限替身。任何测试里启动的 Host 都是临时 fixture，任务结束后关闭，不是部署。没有调用真实模型、Shopify、MCP、Muse 或外部发送；当前真实模型验收由另一个任务负责。用户最新回报及纳入的 b6603ac 记录：原 OMP + 真实 DeepSeek 已对合成公开输入完成一次自主 read/write，实际保存文件并核对 SHA，本轮 3 请求、用量估算费用 0.015584 元，累计估算 0.025080 元。本任务没有执行或重复该付费请求，也未查账户账单；该最小单轮闭环不能外推真实多轮恢复续接、用户业务资料或业务效果。原生 Session 恢复续接仍只有无付费检查。之前两请求读文件后工具校验失败、无报告的历史仍保留于原记录，不能混为当前成功证据。

真实用户资料、本地入口真实付费生成、真实店铺/获客/净支付、浏览器视觉和人工业务质量不属于本次验收。只提交源码、测试、说明与去运行数据的检查摘要；新原始日志留在 `/tmp`，不提交密钥、用户文件、Session/journal、数据库、报告或其他运行目录。

## 最终结果（0533f94）

| 检查 | 结果 |
|---|---|
| 完整 backend，181 个原测试文件 | 1227 项：1217 通过，0 失败，10 跳过；两个分区均 exit0 |
| 原生产 bundle + HTTP/DOM | 20/20 通过 |
| 原会话 DOM，3 个文件 | 17/17 通过 |
| npm run build（含 tsc） | exit0，保留已有 chunk-size 提示 |
| 小程序构建 | exit0，未上传或部署 |
| 实际 npm 入口白名单预检 | 本地/JSONL/七个服务 profile 均零模型请求；缺配置明确不可用 |
| diff / 24 份源码哈希 / 6 个固定祖先 | 全部通过 |

这是一轮对最终 0533f94 源码的完整复验；首轮失败及中间 460240e 复验分别保留在 checks.json.history。跳过项逐条列在 checks.json.skippedTestNames，未当作通过。backend 约 453.64 秒，DOM 约 32.62 秒。最终文档提交只补交说明与检查摘要，不改变这些已测源码。
