# 阶段2下一次真实调用前：证据短交接

**DeepSeek 历史真实接入已证实，不能表述为从未接入。** [2026-10-16原生Session记录](validation/live-two-turn-20261016/README.md)确认原入口实际发送两次 DeepSeek 请求，read/write 成功且usage完整；第三个最终确认请求在发送前触发 `SHORT_INPUT_LIMIT`，首轮没有正常 stop，第二轮没有提交。这证明历史连接，不证明真实两轮通过。

本轮以 `b84adcb1cd0e5379143210aca952d73518e2425f` 为基线，只核对仓库脱敏记录和实际源码、增加有限替身回归。未读取密钥、当前环境配置、真实Session或服务器运行资料，未调用真实模型/服务、创建配置或接入服务器。产品代码和既有额度不变；固定五阶段顺序见 [开发计划](DEVELOPMENT-PLAN-HANDOFF.md)。阶段2仅完成无付费准备，真实两轮验收尚未执行。

| 下一次真实调用前的必要证据 | 仓库说明能证明什么 | 当前缺项与结论 |
| --- | --- | --- |
| 可用安全模型配置的脱敏元数据 | [原配置说明](FACTORY-START-AND-DEEPSEEK.md)列有 provider/model、固定目的地、计价与预算核对机制；[云端验收](OMP-CODEX-CLOUD-ACCEPTANCE.md)只记录当时某进程的变量存在性。不同时间/进程的存在性观察不能代表现在。 | 当前原Host的 provider/model/API、destination与受审recipient一致性、安全绑定存在性/可用性、有效计价四项及币种/日期/适用换算、核对来源与时间，均**未核实**。不要提供密钥值；模型选择、价格JSON或 budget flag 本身不足以证明可调用或余额充足。 |
| 原人民币5元预算的已用、未确认与剩余对账 | 上述历史组两次请求保守费用0.012894元；该检查点累计保守费用 **0.051610元**、剩余授权估算 **4.948390元**，两次均有完整usage，无未确认费用。[更早本地复核](validation/local-goal-recheck-20261016/README.md)的0.038716元和[另一资源复核](validation/local-resource-recheck-20261016/README.md)的0.074952元属于不同检查点/范围，均不是今天的账单或账户余额。 | 原授权适用范围/截止时点、覆盖所有测试线的请求标识、最终状态、实测usage/实际费用，以及 UNKNOWN/中断/超时请求的最终核销或保留额度、后续及并行消费、可核实累计账单与当前剩余额度，均**未核实**。不相加可能重叠的历史数值，不从5减某一历史数值推定当前可花余额；未确认请求不按0费用处理。 |
| 真实两轮所用的原入口与资料授权 | [询盘说明](FACTORY-INQUIRIES.md)记载独立 `factory-inquiries` / `omp:18.10.4:factory-inquiries-v1`：原资料工具读询盘/产品，唯一保存工具写未审核内部草稿。其既有工程验收为明确替身。 | 当前获准原Host/会话及该profile的脱敏绑定、真实资料选择/字段/revision/文档version与SHA/接收者/期限、原执行意图、同一原生Session两轮的Run及Artifact来源/版本/哈希、有效usage及费用证据，均**未核实**。没有当前真实两轮通过记录。 |

**预算口径：**原5元是既有累计测试预算，不是每条线或每次运行重新领取5元。旧[独立只读说明](DEEPSEEK-READONLY-ACCEPTANCE.md)中的当时CNY5授权/价格估算不替代当前累计核对；[后端验收](OMP-BACKEND-E2E.md)也明确未核销当前余额和在途请求。本次不新增预算、不把“声明总额5元/已核对=true”当实际剩余金额，当前可用额度只记**未核实**。

## 原入口与两轮验收口径

- 历史真实连接使用 `npm run factory:local` → `scripts/workspace-omp-local.mjs` → 原生OMP Session/provider。既有提交 `09834c10ec653678b76ed015184ecb31953d4b08` 已修复历史12,000-byte本地会话误限；当前本地 transport 为128KiB，独立短调用策略仍为12,000 bytes。本轮不再调整任何限额。完整原因、原离线重放与费用界限见 [既有修复](validation/local-context-budget-fix-20261016/README.md)。
- 当前分支的新增回归走同一原入口、Session、原生读写工具及HTTP/SSE路径：首轮保存并正常stop，第二句话继承首轮正文/回答/来源，修改数量并保存 `inquiry-v2.md` 后正常stop。原工具只允许新文件名，所以采用草稿版本续改，首版/JSONL前缀原样保留；没有新增覆盖权限、Library/Artifact权威、外发或业务写入。模型响应均为有限替身，当前安全配置可用性、最新扣费、真实两轮仍未验收。见 [本轮证据](OMP-STAGE2-LOCAL-PREPARATION-20261017.md)。
- 文档记载的现有候选是原认证 Host 的 `factory-inquiries` 会话及既有 Web/API；普通消息沿 `POST /api/conversations/{conversationId}/messages` 的原 Conversation/Run 处理。第一轮用 `workspace_factory_document`、`workspace_factory_materials` 读取已授权的原询盘/产品，由模型判断缺项并形成回复；用户原执行意图允许时，`workspace_factory_inquiry_save` 将正文及两份原 sources 写入原 Artifact。结果仍是 `saved-draft`、未人审、未发送。
- 第二轮应续接同一原生Session/profile，重新验证当前来源和授权，再修改/补充内部草稿；核对原conversation/Run、artifact ID/version/SHA与来源。来源哈希不证明回复语义或商业条款正确，仍须人工复核。这里只列已有能力及待验标准，没有执行首调或生成真实草稿。
- 当前[阶段1入口说明](OMP-STAGE1-TUI-20261017.md)优先：默认入口是离线预览；business TUI明确不支持，不能冒充询盘链。旧说明中的默认启动别名属于旧检查点，不作为本轮可执行启动命令。本次不启动服务；由原已获准Host提供当前入口元数据后才可评估。询盘profile与business/其他profile的历史不能擅自迁移，也不能用替身两轮替代真实两轮。

结论：历史真实连接已证实，历史失败也保留为失败；当前安全配置可用性、累计账单/剩额及真实完整两轮仍未核实。下一次真实调用继续阻塞，不自动重跑。本轮仅完成无付费回归准备与文档纠正。
