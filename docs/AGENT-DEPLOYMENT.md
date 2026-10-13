# Workspace 内置 Agent：统一 Pi 服务部署

Agent 随原 Cnsubscribe Workspace 的 **Pi Runtime、企业身份、审批、预算、供应商服务和 Muse/Dot 协议** 一起运行。只启动一个后端进程，默认监听 **127.0.0.1:8787**，只配置原 **WORKSPACE_DATA_DIR**。SQLite 保存事件与查询投影，业务任务和执行权威仍是原 Workspace Store/Pi。

本文件及 `deploy/agent.*.example` 为交付配置。**本轮未构建 Docker 镜像、安装 systemd、部署生产、调用真实模型/付费检索或写入真实 Shopify。** 旧 PR44 说明已原样保存在 [历史部署说明](validation/agent-service/pr44-documents/AGENT-DEPLOYMENT.md)，其中独立执行器的命令不可用于当前架构。

## 1. 安装与启动

服务需 Node.js 24 和 package-lock.json 锁定的原 Workspace/Pi npm 依赖；薄客户端需 Python 3.10 或更新版本。在已批准的固定提交上安装、构建：

```bash
npm ci
npm run build
npm start
```

前两步在构建环境执行，不能提前省略 TypeScript/Vite 等构建依赖。生产环境与凭据通过服务器安全配置注入。`npm run agent:start` 是原服务入口的兼容别名，同样启动完整 Workspace/Pi 服务，包括原 Muse/Dot 入口；不要和 `npm start` 同时运行。

`deploy/agent.service.example` 复用原 `workspace-agent` 用户、`/opt/workspace-agent` 代码目录、`/etc/workspace-agent/server.env` 配置与 `/var/lib/workspace-agent` 持久目录。将它合入现有 `workspace-agent.service`，先核对 Node 路径、配置可读性和目录归属，再由已授权运维执行常规启用/重启。不要同时启用旧 cnsubscribe-agent 和原 Workspace 两个 writer。

生产为 `NODE_ENV=production`、`WORKSPACE_ACCESS_MODE=enterprise`、`WORKSPACE_RUNTIME=pi`。企业配置不完整时拒绝启动；模型未配置时保存任务并明确 `unconfigured/blocked`。DSH CLI、Host 和源码包已退出运行依赖。原 Muse/Dot 的绑定、凭据摘要、权限、回执和文件协议继续使用原配置，升级不能清空或替换原身份。

## 2. 主机环境变量

`deploy/agent.env.example` 不含真实凭据。生产填写安全配置中心或仅管理员/服务身份可读的文件，不提交源码、镜像、客户端、命令参数、日志或聊天。

### 原 Workspace 与企业身份

| 变量 | 要求 |
| --- | --- |
| `NODE_ENV` | 生产为 `production` |
| `WORKSPACE_RUNTIME` | `pi`，原 Pi SDK 是模型和工具调用入口 |
| `WORKSPACE_DATA_DIR` | 唯一私有、持久、本地文件系统绝对根目录；示例 `/var/lib/workspace-agent` |
| `PORT` | 默认 `8787`；原服务只允许 loopback |
| `WORKSPACE_ACCESS_MODE` | 生产为 `enterprise` |
| `WORKSPACE_PUBLIC_ORIGIN` | 原 HTTPS origin，示例 `https://workspace.cnsubscribe.xyz` |
| `WORKSPACE_ID` | 原 Workspace 标识 |
| `WORKSPACE_INGRESS_ISSUER` / `WORKSPACE_INGRESS_KEY_ID` | 原受审身份入口的 issuer 与 Ed25519 公钥 ID |
| `WORKSPACE_INGRESS_PUBLIC_KEY_FILE` | 原公钥 PEM；签名私钥只属于身份入口 |
| `WORKSPACE_MEMBERS_FILE` | 原成员及角色 JSON，不建立 Agent 账号库 |

原生产访问和文件权限要求见 [原部署契约](DEPLOYMENT.md)。Agent token 不创建新账号或提升角色，`agent:submit` 还需原成员有业务写权限。原成员/角色或 Agent 授权撤销后，旧 token 不能继续新执行。

### Agent 接入

| 变量 | 默认与用途 |
| --- | --- |
| `WS_AGENT_ENABLED` | `1` 显式启用同一服务的 Agent/安装入口 |
| `WS_AGENT_DEMO` | 默认 `0`，只有精确值 `1` 才启用演示 |
| `WS_AGENT_PRINCIPALS` | 原主体、Workspace、能力范围与 token SHA-256 的 JSON 数组；模板为 `[]`，不预置可用 token |
| `WS_AGENT_PRESETS_DIR` | 默认 `presets/agent`，JSON 改动重启加载 |
| `WS_AGENT_TRUST_PROXY` | 默认 `0`，仅受信同机入口覆盖 forwarded headers 时设 `1` |
| `WS_AGENT_ALLOWED_HOSTS` | 生产列出批准的 Host，示例 `workspace.cnsubscribe.xyz` |

安全主机页中的绑定结构如下，示例占位值不能作为真实授权：

```json
[
  {
    "subject": "existing-member-subject",
    "workspaceId": "existing-workspace-id",
    "tokenSha256": "replace-in-secure-host-settings-with-64-lowercase-hex",
    "scopes": ["agent:read", "agent:submit"]
  }
]
```

`subject` 必须是原成员，Workspace 必须一致；可添加精确 ISO `expiresAt`。需读取旧 PR44 记录时，管理员明确添加 `legacyAccountId`，建立旧账号与原成员的一一对应，不自动推断归属。

旧 `WS_AGENT_TOKENS` / `WS_AGENT_TOKEN_DIGESTS` 独立账号映射不再接受。原入口强制投影位于 **WORKSPACE_DATA_DIR/agent**；若 `WS_AGENT_DATA` 或程序参数指向其他目录，直接拒绝启动。正常部署不设置第二个 Agent 数据根、队列、并发执行器或独立模型变量。

### 原 Pi 模型与真实研究工具

| 变量 | 用途 |
| --- | --- |
| `PI_MODEL` | 原主机已批准的模型名 |
| `PI_BASE_URL` | 原已批准的模型端点，通过 Pi SDK 使用 |
| `FASTAITOKEN_API_KEY` | 原服务器安全凭据，客户端不可见 |
| `WS_AGENT_RESEARCH_ENABLED` | 默认 `0`；`1` 允许已授权原 Pi 阶段使用真实检索 adapter |
| `BRAVE_SEARCH_API_KEY` | 原主机授权的 Brave 凭据，需与研究开关同时具备 |

删除旧 `WS_MODEL_*` 配置。阶段通过原 Pi SDK 调用，不直接维护第二套 chat/completions 适配。原准入、额度、工具范围和 checkpoint 一并使用；服务账号的实际费用上限仍需通过其原安全配置管理。

当前实际研究 adapter 为受约束的 Brave Web Search，只读返回 URL、标题、摘录和观察时间。缺凭据、未启用、无有效证据或证据不足时保留缺项并阻挡/部分完成，不生成假供应商、价格或销量。启用前配置授权与费用限额；本轮只有离线验证，没有实际 Brave 付费调用。

## 3. 模式与健康回执

生产默认 `WS_AGENT_DEMO=0`。未配置模型时 `/api/agent/v1/health` 的 `mode` 仍表示生产选择 `model`，`readiness` 为 `unconfigured`。配置存在只代表 `configured_unverified`，不证明真实调用已通过。缺少必要模型/工具时有明确 error 和版本化 result 完成度；模板不能把业务目标标成达成。

只有显式 `WS_AGENT_DEMO=1` 才允许结构模板演示。摘要与产物标明“演示模式：未接模型与真实数据源，内容为结构模板，数字为待确认”。演示和正式成果以模式、完成度与证据记录区分，不能拿演示截图验收真实 Shopify 或供应商研究。

公开 `/api/agent/v1/health` 不做付费探测，可从正式 HTTPS 地址检查 Agent 版本、`runtime: pi-durable`、业务权威、配置状态与预设。原 Host 根路径 `/health` 保留其既有处理，不返回 Agent JSON；原 `/api/health` 继续受企业认证保护。失败和部分成果保留；SSE 七种事件名继续兼容，thinking 仅是简短执行摘要。

## 4. 同机 HTTPS 与流式反代

Agent、Workspace 网页、原业务 API 和 Muse/Dot 入口都转发到同一个 `127.0.0.1:8787`。将 `deploy/agent.nginx-location.example` 或 `deploy/agent.Caddyfile.example` 合入原反代，避免再开第二个 Agent 端口。

模板只处理传输，不实现企业登录。原网页/API 仍需现有受审身份入口验证员工、剥离客户端身份头，逐请求签发准确 Ed25519 `X-Workspace-Assertion`，保留原 method、target、body 字节及真实浏览器 Origin。普通 Nginx/Caddy、X-User 或 X-Email 不等于原企业认证；服务凭据入口继续分别使用原 Agent/Muse/Dot 协议。

SSE 关闭缓存和 buffering，保持长连接，不配置对业务 POST 的自动上游重试。反代覆盖 Host、X-Forwarded-Host、X-Forwarded-Proto；仅同机受信入口可达后端时才启用代理信任。Authorization 正常转发，但访问日志不能记录它、Cookie、签名断言、请求体或查询 token。

`/install` 和插件 manifest 按实际请求 Host 动态生成 origin，并经过 Host 白名单校验。新用户安装句：

```text
帮我安装 Workspace Agent 插件：https://workspace.cnsubscribe.xyz/install
```

用户仅在 Muse 安全凭据页填一次专属 token，之后由 Secure Vault 在进程内注入。地址使用 `WS_AGENT_URL`，令牌使用运行时 `WS_AGENT_TOKEN` 或可信内存适配；不写 Python 源码、token 配置文件或聊天。若真实 Muse 尚无安全注入能力，补原运行时适配，不能退回聊天传密钥。

## 5. Docker：同一个原服务

Dockerfile 多阶段构建执行 `npm ci`、`npm run build`，再保留生产依赖、实际网页、完整服务端、预设和 Python 客户端。没有独立的零 npm 依赖 Agent。明确 COPY 构建/运行目录，不把私有环境或数据装入镜像。

以下命令供目标环境获得授权后使用，本轮未执行。可从审阅后的固定提交归档构建，排除未跟踪配置：

```bash
git archive --format=tar HEAD | docker build -f deploy/agent.Dockerfile -t cnsubscribe-workspace:reviewed -
```

本服务只允许 loopback。简单容器方案为 **Linux Docker Engine host network 加同机 TLS/身份入口**；不要改成 0.0.0.0，普通 bridge 端口映射不能替代这个监听约束。

```bash
docker run --name workspace-agent --network host --restart unless-stopped \
  --env-file /etc/workspace-agent/server.env \
  --env WORKSPACE_DATA_DIR=/data \
  --mount type=bind,src=/var/lib/workspace-agent,dst=/data \
  --mount type=bind,src=/etc/workspace-agent,dst=/etc/workspace-agent,readonly \
  --stop-timeout 60 cnsubscribe-workspace:reviewed
```

数据目录只供单实例使用，需允许镜像实际 node 身份读写且保持私有。公钥、成员文件和原 Muse/Dot 绑定按原绝对路径只读挂载；签名私钥不挂入后端。host network 共享主机网络，-p 映射不适用，见 [Docker 官方说明](https://docs.docker.com/engine/network/drivers/host/)。

运行镜像启动原 server/index.mjs，与已配置的 npm start 相同；演示、研究和供应商写入默认关闭。**本轮只做配置/路径静态检查，未拉取基础镜像、构建或启动容器，也未验收目标 TLS、身份和文件权限。**

## 6. Shopify 与七天闭环

沿用原 `WORKSPACE_SHOPIFY_SHOP_DOMAIN` 和 `WORKSPACE_SHOPIFY_ADMIN_TOKEN`。新 `WORKSPACE_SUPPLIER_SHOPIFY_WRITES_ENABLED` 默认 `0`。真正写入还需原连接器启用、准确预览版本批准及独立明确执行。

productCreate 只建 DRAFT；正式发布另一次审批，绑定主体、Workspace、服务修订、previewHash、实际店铺、publication 与配置。写前写后核对实际内容、媒体和标记。未知结果先查原 `/shopify-reconcile`，不自动重复写。完整契约见 [供应商发布说明](SUPPLIER-PUBLICATION-CONTRACT.md)。

七天监测复用原 Goal/Schedule、审批和 Store，从可核对的实际 Online Store 发布时间或用户指定 startAt 开始。商品销量不能和全店流量混用，无数据保留 null。原会话汇总记录可读取性、修订和尝试；本轮没有外部推送 transport，available_in_conversation 不等于手机已送达，外部状态为 not_configured。

供应商澄清用原 Pi，模型不能直接绕过发布批准。生产期、处理/发货期、运输期，以及批发 MOQ/价格与消费者购买单位/售价继续分别保存。

## 7. 整个 Workspace 的备份与恢复

**默认永久保留，不自动删除任务、事件、失败记录、checkpoint 或文件。** 在完整业务归档策略审阅前，不删 Agent 投影模拟删除业务任务。

一致备份先停止同一 Workspace 服务并确认退出，再备份整个 WORKSPACE_DATA_DIR，包括：

- workspace.json：原任务、业务事件/outbox、供应商、预算、审批、计划和商业记录；
- pi/：原 Pi JSONL、提交/调用记录和 checkpoint；
- 原 artifacts/、agent/agent.sqlite、可能存在的 WAL/SHM 和 agent/artifacts/；
- 原访问审计、安全域及其他持久记录，已启用 Muse/Dot 的原数据与绑定。

停服整目录备份的运维示例，本轮没有执行：

```bash
sudo systemctl stop workspace-agent
sudo tar -C /var/lib -czf /secure-backup/workspace-agent-YYYYMMDD.tar.gz workspace-agent
sudo systemctl start workspace-agent
```

备份位置需受限访问、容量和完整性核验。凭据、ingress 私钥由原安全系统独立备份，不进入用户下载包。若已有 Muse/Dot 数据在原根外，沿其原协议取得一致快照并记录绑定，不只备份此次新增目录。

恢复到新私有目录，核对原 Workspace、Pi、事件、文件和账号映射一致，再设置同一个 WORKSPACE_DATA_DIR、启动一个 writer。不能单独回滚 SQLite，或拼接不同时间的 workspace.json/Pi checkpoint；未确认原进程退出不能删除锁。

原任务可查询恢复：同主体相同 Idempotency-Key/内容返回原任务；响应丢失后 GET /api/agent/v1/tasks/by-request/{key} 找回。POST /api/agent/v1/tasks/{id}/resume 用空对象恢复原任务，原执行范围、预算和 Pi checkpoint 决定可恢复性，不能借恢复改输入。历史事件和部分产物可读；发布等副作用按原外部回执核对，不由 Pi 自动重做。

旧 PR44 数据与失败验收继续保留。旧 agent/ 数据只在明确 legacyAccountId 成员映射后关联；旧终态记录保留 legacy_unverified；旧 queued/running 保留原记录并标记 interrupted，原因 LEGACY_CHECKPOINT_UNAVAILABLE，resumable=false，不冒充拥有 Pi checkpoint 或原生续跑。独立旧目录先只读备份，管理员核对归属与迁移位置，不能覆盖原 Workspace 记录。

### 保留期核对工具

`scripts/agent-retention.mjs` 对 v2 Pi 集成数据库仅 dry run。先停服，用原根派生的 agent 路径核对候选数量：

```bash
WS_AGENT_DATA=/var/lib/workspace-agent/agent node scripts/agent-retention.mjs --days 90
```

这里 WS_AGENT_DATA 只定位维护脚本的原投影子目录，不是第二个服务根。v2 返回 authority 为 workspace-store、removed 为 0。**--apply 明确拒绝执行**，因为只删 SQLite/产物会破坏原任务、checkpoint、批准和审计一致性。不能用旧版脚本、直接 SQL 或删目录绕过；未来实际归档必须覆盖完整业务权威和恢复链，并保留失败记录。

## 8. 最少待授权操作与验收边界

1. 运维选定原持久主机、原企业入口、HTTPS、公钥和成员文件，配置一个数据根，复用原 Muse/Dot 绑定。
2. 在服务器安全页填写原已批准 Pi 模型/端点及凭据；需要研究时再启用有授权和费用限额的 Brave。
3. 通过安全渠道签发/绑定 Agent token，用户仅在 Muse 安全页填写一次，记录真实 health/presets、幂等提交、SSE 和下载。
4. 需要发布时，在 Shopify 安全管理页完成授权，选实际 publication，启用原连接器，对具体版本分别批准草稿/发布，核对七天真实数据源及通知可用性。
5. 在目标主机完成重启、完整备份恢复、真实模型和真实 Shopify 验收，再由负责人决定是否开放生产流量。

普通本地测试、Pi faux transport、小程序实际源码截图、真实模型、真实 Shopify 与生产验收分别记录。本轮保存失败记录，没有删除或重试被阻挡的独立审查；fixture 和配置文件不能替代尚未完成的生产条件。

参考：[原 Pi 运行时](PI-RUNTIME.md)、[原身份/部署协议](DEPLOYMENT.md)、[供应商原契约](SUPPLIER-SERVICE-CONTRACT.md)、[npm ci 官方说明](https://docs.npmjs.com/cli/commands/npm-ci/)、[npm prune 官方说明](https://docs.npmjs.com/cli-commands/prune.html/)。
