# 阶段2无付费准备：历史接入纠正与同Session草稿续改

DeepSeek历史真实连接已证实。2026-10-16原入口有两次实际请求，原生read/write成功、usage完整；最终确认请求在发送前触发 `SHORT_INPUT_LIMIT`，首轮未正常stop，第二轮未提交。[原记录](validation/live-two-turn-20261016/README.md)仍是失败验收，不能因后续修复改判。

历史该组保守费用0.012894元，累计0.051610元、剩余授权估算4.948390元。这些均为历史检查点的估算，不是今天账单、账户余额或本轮新授权。当前安全配置可用性、完整累计对账/剩额、真实完整两轮仍未核实；本轮零真实模型请求、零新增支出，不自动重跑。

## 实际源码结论

基线 `b84adcb1cd0e5379143210aca952d73518e2425f` 已包含既有修复 `09834c10ec653678b76ed015184ecb31953d4b08`。历史问题来自本地会话误用12,000-byte短调用上限；[既有修复与离线重放](validation/local-context-budget-fix-20261016/README.md)已将本地会话上限设为128KiB，独立短调用策略仍为12,000 bytes。

当前 `scripts/workspace-omp-local.mjs` → 原OMP Session/provider → 本地transport，仍在实际发送前检查现有上限。来源、会话绑定、原生锁、512输出tokens、每任务8次实际发送、有效usage、未知计费停止和费用预留均保留。没有发现需要再次实现的长度修复，因此本轮只增加测试和文档，不改Provider、限额或生产源码，不新增AgentLoop/账户DB/队列/权限。

## 当前分支补充证据

测试源码提交 `dad7a3334524dadfd9f63e669929df9b3a694141`（仅新增两个测试文件）；执行时内容与该提交一致，随后交付仅文档变化。Node24.19.0、审计Bun1.3.14、OMP18.10.4。测试子进程只继承PATH、临时HOME及NO_COLOR，不继承真实凭据；新夹具全局fetch明确拒绝并计数，仅显式fetchImpl返回有限SSE。

- 首轮：读取合成产品资料，保存 `inquiry.md`（数量100、交期/认证待确认），最终正常stop；3次替身HTTP。
- 第二句话：同一个原生Session ID/文件，保留首轮目标、保存正文、最终回答及来源SHA；数量改200，保存 `inquiry-v2.md` 后正常stop；2次替身HTTP。来源从原成功read回执恢复并重新核对，未强制重复读取。
- 原工具仅允许新文件名，所以这是草稿版本续改。首版文件及首轮原生JSONL前缀逐字节不变；两版回执均 `humanApproved:false`、`sent:false`，正文/来源SHA匹配实际合成文件。没有增加覆盖、外发或Library/Artifact业务写权限。
- 尝试覆盖首版：1次替身HTTP后原写工具拒绝；SDK下一次逻辑调用被既有停止门挡住，无第二次HTTP，原文件不变。逻辑调用数2与实际发送数1分别核对。
- 来源改变后续聊：原Session选择/计费绑定拒绝，逻辑调用和替身HTTP均0。新夹具共6次替身HTTP，真实请求/网络fallback/新增支出均0；最大请求7,761 bytes。跨12KB历史及现行边界另由既有context/budget回归覆盖。

| 本轮检查 | 结果 |
| --- | --- |
| 本地原入口、同Session续改、费用、上下文、环境、HTTP/SSE、来源/路径、插件原生装载/移除 | 56 passed，0 failed/cancelled/skipped |
| 独立短调用策略、发送/未知用量与只读边界 | 7 passed，0 failed/cancelled/skipped |
| `npm run plugins:check` | 14插件静态检查通过；不是14个真实服务连通 |
| 单独输出新夹具数值证据 | 通过；与上述测试有重叠，不累加独立数量 |

精确argv、源码tree、保护源码及本地日志SHA256、有限夹具摘要见 [数值证据](validation/omp-stage2-local-preparation-20261017-summary.json)。原始日志、合成资料、Session和草稿不提交；临时夹具自动删除。本轮未读取历史私有真实Session或运行文件，未重放实际业务资料。未重跑完整后端、阶段1广义业务/TUI矩阵或pack/build：生产源码未变化，既有阶段1证据仍仅对应其原检查点。

## 未完成与停止点

有限替身证明当前源码路径可正常完成两轮及保留保护，不能证明真实模型选择、真实完整usage或真实两轮成功。历史本地入口不需要Workspace Host；认证 `factory-inquiries` 的原Run/Artifact链是另一个待验边界，不能用本地文件回归冒充。默认入口仍是离线预览，business TUI仍明确不支持。

固定五阶段顺序不变，阶段2只完成本次无付费准备，阶段3–5不推进。当前模型配置/账单/资料授权缺项保留未核实；不读密钥、不创建配置、不付费、不操作真实服务器/服务、不改main、不合并/强推/部署、不扩权，Mem0向量关闭。仅提交推送同开发分支及更新Draft PR99后停止。
