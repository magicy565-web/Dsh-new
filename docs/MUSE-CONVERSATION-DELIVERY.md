# TT041 Muse 原会话后端交付与验证

独立 worktree：`C:\Users\Administrator\Documents\Codex\2026-10-12\task-2\workspace`。
独立 Git object store：同任务目录 `.repo`。分支 `codex/muse-conversation-delegation-20261012`。
从授权 GitHub Connector 读取全部 216 个 PR15 文件（2,455,951 bytes），逐项核对 blob SHA，
重建准确 tree `6574190f0c56fdb55f9b3badb5171905075f1a82` 和原 commit，保留真实 shallow parent。
没有使用共享 index/reset，也未复制另一任务的未提交文件。

## 基线与原源码完整性

2026-10-11 UTC 核对：main `b9546e1d7e6d7ac1381f84327a4f15cbfc60598f`；
PR15 `2ac171e4da46e44e0095fe9907c2f8b1339a56cb`；PR22 `78f155367524b48381d79b2edebe0e5e2925e85d`；
PR24 `f50f77a31053910c0074ced1f679079c4d81e055`；PR25 `fa55f8d7` 已只读核对。
发布前再次核对 PR15 分支仍准确指向上述基线。
PR22 与 PR15 的原插件路径并未合并，本分支基于有真实 Muse native overlay 的 PR15。
PR24 多 Muse 预检限制未改，一人一 Worker 规则未改。

`backend/SOURCE-INFO.json` 标记 Harness `0.2.0-rc.2`、workingTree
`bccf02f2636f7213be321d487aa763eb51396584`、原 archive SHA
`f7ca9c1a8d4e5587be655868f7f21258bf9bee14ecee1eccf9b7853ed18ee421`，
并明确 archive/完整 manifest 未包含在仓库。SDK 与 overlay 不是完整原 Harness。
当前完整附件未由本任务物化或校验。本任务不复制缺失的 personal-worker、worker-identity、
Cordis runtime、原 Session/Agent 执行器，也不冒充原源代码。

## 实际独占改动

- `server/worker-desk.mjs`：Host-only 同步 attach hook，原订单/原用户消息同事务持久化。
- `server/muse-conversation-delegation.mjs`（新增）：精确原会话映射、范围 hash、幂等、
  单一未结束委派、原审批/派单/恢复、阶段投影和准确结果/文件验收。
- `server/muse-worker-native.mjs`：与基线已有较完整 overlay 同步原 Session 支持，
  添加原 scope 内 bindConversation、映射校验和读/批准/验收分流；无新 writer。
- `server/muse-worker-session.mjs`（新增）：从原 overlay 同步，修复派单确认丢失时
  remoteJobId null 的准确原 task 映射窗口，并提供原 taskUpdatedAt。
- `deploy/muse-native-overlay/server/{muse-conversation-delegation,muse-worker-native,muse-worker-session}.mjs`：
  与上述对应 backend 同字节。
- `deploy/muse-native-overlay/server/workspace-plugin-service.mjs`：原启动校验与 bindConversation。
- `deploy/muse-native-overlay/server/workspace-native-plugin.mjs`：原 submitQuestion 显式 Muse draft 路由；
  Muse 单独启用时复用该 Host，不启用 Dot timer。
- `test/fixtures/muse-conversation.mjs`、`test/muse-conversation-delegation.test.mjs`、
  `test/muse-conversation-host.test.mjs`：明确 synthetic writer/native依赖，实际业务链路契约。
- `scripts/check-muse-store-durability.mjs`：原 Store 无改动的准确 TT041 复现。
- 本文、`MUSE-CONVERSATION-API.md` 与 `docs/validation/muse-conversation/` 证据。

未改 `src/`、原 BFF/frontend 文件、Harness core、历史询盘 Skill、第三任务三个文件、
生产配置/数据/服务器。未部署、合并、强推、创建凭据、购买或创建任何计划任务/授权订阅。

## 本机验证及阻挡

Node `24.21.0`（现有 Codex bundle）；Windows `win32/x64`。
默认 test runner 子进程隔离失败 `spawn EPERM`；Node 原生 `--test-isolation=none` 同进程运行。
无需 npm 依赖安装或改变测试/持久化实现。

```sh
node --test --test-isolation=none test/muse-conversation-delegation.test.mjs test/muse-conversation-host.test.mjs test/muse-worker.native-binding.test.mjs test/muse-worker.contract.test.mjs test/dot-mcp-contract.test.mjs test/muse-worker.probe.test.mjs
```

34/34 通过，零跳过：两次/并发相同消息一单；只 draft 不自动派单；原 Dot 分流；
无 Dot 的 Muse 入口；范围/原会话拒绝；丢失派单持久确认后核对同一 task；
领取/租约/截止/取消/迟到；原 Session flush 失败与重连去重；成果返回与验收分开；
下载准确 ID/version/SHA bytes；原 lifecycle 与 Worker 边界、原 REST/OpenAPI 和只读 probe。
新增 fixture 的 writer 是串行 copy-on-write 内存；restart 是 JSON round trip，文件 bytes
仍为内存映射。原 relay 源码仅将不可用 Harness error helper 明确替换为 fixture；
routing 测试仅替换 Cordis/SDK 依赖。本机这些通过不证明磁盘重启、原 Host 或真实 Muse。

原磁盘回归命令：

```sh
node --test --test-isolation=none test/dot-worker-bridge.test.mjs test/worker-desk.test.mjs test/muse-worker.recovery.test.mjs
node scripts/check-muse-store-durability.mjs
node --test --test-isolation=none deploy/muse-native-overlay/test/muse-worker.session.test.mjs
```

磁盘组实际 18 项，1 项纯认证通过、17 项失败，均为原 `openStore` 写锁初始化的
`syncDirectory -> fsync EPERM`，后续原 promise 错误也保留在 log；不是通过的旧 Dot 回归。
独立原 Store probe 退出 1，`EPERM: operation not permitted, fsync`。
`server/store.mjs:86-88` 对 directory handle 执行 sync，写锁初始化调用该逻辑。
Probe 在本任务自己的 `.data/muse-durability-probe-*` 建目录，没有重用生产数据。
未 swallow 原 fsync/ACL 错误、改 Store 或创建替代 storage。
原 overlay Session 测试退出 1，首先缺少 overlay 内 `muse-worker-host.mjs` 原 dependency；
这是 overlay 尚未装配到完整原 runtime，不能用本机 synthetic 测试代替其验收。

Syntax check 和 `git diff --check` 另行记录。原持久化阻挡需统一集成处理；本任务未擅自
改执行环境。相匹配 Linux 验证由父任务在用户选择后安排。

## 官方唤醒能力与账户证据

2026-10-11 查阅官方资料：

- 认证 MCP 插件使用 OAuth 2.1 原用户授权与 token 校验。网页登录或本机 Codex 登录
  不证明外部 PersonalMuse 已绑定该插件。[官方 Authentication](https://developers.openai.com/plugins/build/auth)
- MCP Events 文档列出 Work web/cloud/dots 支持，要求 MCP 2.0 `2026-07-28`、
  持久 subscription 与 outbound HTTPS。先原用户订阅，再验证 callback，签名事件用固定
  eventId 重试；2xx 仅代表接收，后续异步处理。[官方 MCP Events](https://developers.openai.com/plugins/build/mcp-events)
- 官方计划任务可使用当前聊天已授权插件，并可保持原聊天上下文；支持范围依产品/账号。
  应先手动验证准确 prompt/tools/identity，再核对实际后台运行。
  [官方 Scheduled tasks](https://learn.chatgpt.com/docs/automations)

这些是可核对的文档契约，不是本账号或原 PersonalMuse 已唤醒的证据。
本机仅无害读取 `codex login status` 得到 Logged in using ChatGPT；没有调用另一个
模型/提取 cookie 或凭据。父任务已报告 cloudMuse 当时 EW_API_HOST unset，
custom.enterprise_workspace 未注册；本任务未改变这些事实。
未创建 connector/schedule/subscription/密钥，也未尝试常驻浏览器发送任务。
当前没有原会话的账号级订阅、scheduled run、领取及 model-turn 实证，
因此 API 的 wake false、executionStartedAt null 必须保留。

## 统一集成尚需完成

将本分支原插件 backend、任务一 UI 和 PR25 控制面协调装配到准确原版本。
复用原 writer 的 journal/outbox/调度接点，先通过实际 durability/startup/restart，
再以原已审查单 Muse 绑定核对登录、准确批准、排队、官方唤醒/领取、执行、原 Session
持久返回、下载及企业验收；进程失联及迟到 callback 不重开原任务。
新增持久授权仍需父任务与用户确认准确流程。买方采购画像、明确共享、商家询盘/回复
是独立业务垂直验收，本任务未完成或发送任何真实询盘。