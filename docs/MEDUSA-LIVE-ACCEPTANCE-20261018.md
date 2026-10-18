# PR109 current-source protocol: real-service acceptance handoff

日期：2026-10-18 UTC。独立分支：`codex/medusa-live-acceptance-20261018`。
唯一父提交：`7008f5b66731edcd12cb62aa33eb3c4a19ce3218`。
这是验收驱动交付，**真实 Medusa / PostgreSQL 验收未执行**。不重复旧 PR109 的生产修复，不涉及 PR112 或旧 OMP receipt 恢复/迁移复审。

## 范围和入口

仅以下六个路径有变更：

- `scripts/medusa-catalog-live-smoke.mjs`
- `test/medusa-live-acceptance/config.mjs`
- `test/medusa-live-acceptance/postgres.mjs`
- `test/medusa-live-acceptance/review-suite.mjs`
- `test/medusa-live-acceptance/contracts.test.mjs`
- `docs/MEDUSA-LIVE-ACCEPTANCE-20261018.md`

复用原脚本 `call` / `admin` / `agent` / `create` / `check`、15 秒 HTTP 超时、最终 JSON 报告及脱敏方式。新模式只做 Product Context 验收：

```sh
node scripts/medusa-catalog-live-smoke.mjs --context-review-only < /operator-private/medusa-live-config.json
```

配置文件和输出须留在仓库外的操作者私有临时目录，权限建议 `0600`。也可由安全的本地配置提供器直接写标准输入；不要把凭据放进命令行参数、Git、PR 或运行记录。脚本不读取 `.env`，新模式不读取旧模式的凭据环境变量，不登录、建账号、生成访问凭据或调用模型。`pg` 只从已安装的官方依赖中解析，不自行安装。

完整配置形状如下；所有地址、名称和凭据均由唯一操作者按其真实临时实例填写，示意值不能作为隔离证明：

```json
{
  "backendUrl": "http://127.0.0.1:19000",
  "adminToken": "OPERATOR_SUPPLIED_TEMPORARY_ADMIN_BEARER",
  "agentToken": "OPERATOR_SUPPLIED_DISTINCT_AGENT_READ_TOKEN",
  "postgres": {
    "host": "127.0.0.1",
    "port": 15432,
    "database": "medusa_live_operator_unique_instance",
    "user": "OPERATOR_SUPPLIED_DB_ROLE",
    "password": "OPERATOR_SUPPLIED_DB_PASSWORD",
    "serverRole": "ACTUAL_MEDUSA_DB_ROLE"
  },
  "isolation": {
    "acknowledgement": "DISPOSABLE_ISOLATED_MEDUSA_ONLY",
    "backendUrl": "http://127.0.0.1:19000",
    "database": "medusa_live_operator_unique_instance",
    "instance": "medusa-live-operator-unique-instance",
    "cleanup": "operator-destroys-instance"
  }
}
```

仅允许显式 HTTP loopback origin 和 loopback PG host，URL 不得携带路径、账号、query 或 fragment。隔离声明中的 origin/数据库必须与连接配置完全相等；实例名必须匹配 `medusa-live-[a-z0-9-]{8,80}`，数据库名匹配 `medusa_live_[a-z0-9_]{8,80}`。密码必须显式且非空；PG 连接强制 `ssl:false`、`search_path=public`，不从 `PGPASSWORD` 等缺省值获取密码。命名与声明不能识别被转发到生产的 loopback 端口，操作者必须先验证实际目标确实是自有可销毁临时实例。

默认从 `apps/medusa-acceptance/package.json` 解析 `pg`。若官方依赖安装在独立临时目录，可额外提供 `pgRequireFrom`，值为该已审查依赖环境中 **绝对路径**的 `package.json`；脚本用 Node `createRequire(...)("pg")` 加载同一官方依赖。该路径属于操作者信任的可执行代码配置，不得指向替身驱动或未审查模块。

旧完整 catalog smoke 入口仍保留，原 Context 写入已补 `review_version=0`、GET hash、后续撤销实际 GET version/hash，两个批准读面核 marker/no-store。旧模式额外要求 `MEDUSA_LIVE_ISOLATED_INSTANCE=medusa-live-<unique-instance>`，以及原有 `MEDUSA_LIVE_ALLOW_WRITES=isolated`、loopback URL、显式临时管理员登录配置和 Agent token。它不运行下面的 PG 并发矩阵；本次同样未运行旧完整 smoke。

## 操作者执行前的服务和权限前提

1. 唯一操作者自行审查和建立临时容器、隔离 PG/Redis、迁移和已有测试账号。不得连接生产 PG、腾讯或正在部署的 `7008` 实例。仅使用回环/内部网络，不开公网端口。驱动不会建立容器或账号，也不会部署服务。
2. 服务必须运行固定源码的真实 Medusa 2.21.2 官方 Admin API、真实 HTTP 认证中间件、Product Context 插件、link/迁移及真实 PG integer 列。两个 Agent 成功读面必须返回 `review_policy=medusa-product-context-current-source-v1`。禁止用 `connect:false`、内存 repository、截取 transport 或修改 `service/nativeUpdate` 替代数据库。
3. API 管理员可建/改合成 Product 和 Variant、读写 Context；独立 Agent token 只能读 Agent 面。驱动创建九个合成产品（一个源变更场景，八个并发场景），无真实业务资料、文件上传或付费步骤。
4. PG 观察连接能读取该临时数据库 `public.product_context`，仅对自建 fixture 做 `review_version` 上界预置；专用锁连接能 `SELECT ... FOR UPDATE`。需能看见 `serverRole` 的 `pg_stat_activity.query` 和 `pg_blocking_pids`：同角色通常可直接观察；独立观察角色所需统计权限由操作者另审，不在脚本中授予。脚本核对 `current_database/current_user`，SQL 值均参数化。
5. Medusa 连接池须允许两个 HTTP UPDATE 同时进入数据库，另留两个验收连接。服务端锁/语句超时须允许屏障的短时等待；若代理、池、权限或查询形状不允许得到锁队列证据，脚本失败，不能把该失败直接认定为产品缺陷或改成按发送顺序断言。
6. **构建前置阻断**：现有 `acceptance/medusa/api.Dockerfile` 重新 pack 当前插件，而 app lock 仍含旧 tarball integrity，不能声称该 Dockerfile 已通过，也不能改锁、关 integrity、替换 SDK、用 `npm install` 覆盖锁或绕过 `npm ci`。主会话须先审查可用的现有官方依赖环境：原锁校验安装成功且版本/来源已核对，再用这些依赖把固定源码编译到独立临时容器，明确当前编译插件的加载路径和来源，防止误用旧 archive。该临时构建方案、认证、迁移/link、镜像和实际启动由唯一操作者另行处理。本交付不执行构建、容器或部署命令；前提不满足就保持真实验收未跑。

## 断言与确定性屏障

所有批准都使用展示给该次审核的 GET 快照：首次空 Context 使用 version `0`，随后携带实际 `product_context.review_version` 与 `review_source_hash`。不在 409 后自动重试或悄悄替换审核快照。

- 原 Admin API 创建合成产品；低 readiness、有 missing evidence 的批准为 422，正常首次批准为 version 1。
- Agent 列表和详情的成功响应均核 marker、`Cache-Control: no-store`，按已定义 envelope/product/variant/context/evidence/commercial_policy 字段白名单及 sentinel 检查投影；拒绝任意 `metadata`、`notes`、`reviewed_by`、`evidence.source` 及额外字段。核两个面的可见性和 DB 的 version/hash/status/missing_evidence；不要求当前实现的 404 详情带成功响应 marker/cache header。
- 分别通过 Admin API 改 title、Variant SKU，核两 Agent 面立即拒绝旧批准；用当前 version 加旧 GET hash 重批必须 409，再显式使用新 GET 快照批准。最后撤销立即拒绝。不存在缓存延时重试。
- 真实 `plugins/workspace-medusa-catalog/src/approved-source.mjs` reader 对真实 Agent 响应执行 list/read，核引用的 native ID/version/hash；源变更和撤销后 read 为 null。合成 actor/binding 只用于直接调用 reader，不声称通过真实 Host/Session 或 Space 认证。

并发矩阵共八项：普通版本/`2147483647` × 批准对 missing_evidence/批准对撤销 × 批准先完成/否定写入先完成。撤销场景先真实批准；missing_evidence 场景从 ready_for_review 开始。上界只在自己创建并记录的 fixture 行用参数化 SQL 预置 `review_version`，这是**测试准备**，不冒称业务写入路径。此后仍使用真实 GET 和两次真实 HTTP POST。

每组专用事务只锁定该 fixture 的 `(id, product_id, deleted_at IS NULL)`：

1. `BEGIN` → `SELECT ... FOR UPDATE`；记录 locker PID。
2. 发第一个 HTTP POST；用实际 `pg_stat_activity` 看到该角色的 `UPDATE product_context` 处于 Lock 等待，且 `pg_blocking_pids(first)` 包含 locker。
3. 才发第二个 HTTP POST；必须同时看到首个 UPDATE 仍被 locker 阻塞，以及第二个 UPDATE 被首个 PID 阻塞。两个 UPDATE 必须同时存在；仅共同等待 locker 或仅已发请求不够。
4. 将 PID、blocking PID、已观测次序写进本地报告，随后 `ROLLBACK` 释放屏障。严格核 first=200、second=409，最终 DB/GET/Agent 一致。上界每次写都轮换 revision hash，旧 GET hash 在同 numeric version 下不可复用。

没有 `sleep`、发起顺序猜测、mutation hook 或业务 service 补丁。观察轮询只等待真实 SQL 返回；每阶段最多 2000 次且 6 秒。HTTP 每次 15 秒，响应最多 2 MiB；标准输入 32 KiB/10 秒。PG connect/query/statement 各 3 秒，锁获取 3 秒，事务空闲 12 秒保险。HTTP 总取消信号 240 秒，SIGINT/SIGTERM 也触发取消；reader 保留其 10 秒超时和 1 MiB 上限。请求 drain 最多 16 秒；PG 结束最多每连接 3.5 秒。所有异常路径 finally 回滚、drain、关闭连接；超时后仍失败，不降级为通过。进程被强杀时还依靠 PG 事务空闲超时，不能声称 finally 一定运行。

## 清理与报告

新模式配置只接受 `operator-destroys-instance`：驱动不删除任何数据，最终报告显式保留 `cleanup_status=operator-required`。成功/失败均由唯一操作者销毁整个**已声明临时实例**；`ok:true` 仅表示验收断言通过，不能表示清理完成。报告记录自建 product/context IDs，供同一次隔离实例复核；禁止将实际运行 JSON、PID、账号信息或凭据提交仓库。

旧 catalog 模式仅 DELETE 自己创建且记录的精确 ID，沿用原清理规则。两个模式都没有全局 prune、生产清理或任意 SQL 配置入口。报告先对结构化键和值脱敏，再以 `JSON.stringify` 安全序列化：包含显式密码、管理员/Agent token 字面值、JSON 转义或常见编码值的键被移除，受污染的整项值置为 null，不用可能再次包含短秘密的替换字符串。单字符引号/反斜杠/控制字符密码不会改写 JSON 语法；凭据缺席按解析后的键/值检查，JSON 必需的定界引号不属于凭据数据。脱敏不是允许发布整个运行报告的理由。

退出码：0=该模式断言通过（新模式的操作者清理仍待完成）；1=断言/连接/清理失败；2=配置或隔离声明拒绝。PG 模块或服务不可用会阻断，不会返回 mock 成功结果。

## 本次实际验证

Node `v24.19.0`，独立 worktree，无依赖/锁修改、无安装、无容器/账号/服务创建：

```sh
node --test test/medusa-live-acceptance/contracts.test.mjs
for file in scripts/medusa-catalog-live-smoke.mjs test/medusa-live-acceptance/*.mjs; do
  node --check "$file" || exit
done
git diff --check
```

原交付合同测试 15/15。独立复核后，在原 `f819b7cf350ed90b4c23a6fc43f5d7ce5d7e20e9` 实际复现两项驱动缺口：合成 `product.metadata` 被接受，单个双引号 PG 密码令脱敏 JSON 解析失败。随后仅补验收投影白名单和结构化脱敏，加入 list/detail metadata/额外字段拒绝，以及引号、反斜杠、控制字符、孤立 surrogate、嵌套值/键和凭据编码缺席合同。

修复后合同测试 18/18，fail/cancel/skip/todo=0；全部五个 MJS 文件语法检查和 diff 检查通过。合同测试的 PG rows、连接和 HTTP 结果是明确的替身，仅验证驱动合同与异常释放；CLI 拒绝测试在任何网络/PG 加载前退出。新增密码为单个双引号的 CLI 报告合同在模块加载处注入合成失败，验证真实入口输出可解析的结构化 blocked 报告，未连接 PG/HTTP。actual reader 的 marker 拒绝测试同样使用合成 transport。它们不是真实 PG 结果，也不与旧 PR109 的 11 组 `connect:false` 计数相加。

本次未运行：真实 Medusa/PG 八项屏障、真实认证/DI/迁移/link、真实 reader 消费、旧完整 catalog smoke、Docker build、生产 TypeScript/Web/UI 构建、Host/Session/Space 全链路。未加可选的首次创建并发屏障或历史畸形 JSON SQL 注入场景。当前交付仅补必需协议及确定性 UPDATE 竞争验收；不宣称真实服务或发布验收通过。

Draft PR 的提交 SHA 和命令结果以 PR 描述及 Git 为准；分支起点及首个交付的父提交保持上面的固定 SHA，复核修复在原交付后追加提交。只推原独立开发分支，不强推、不合并、不覆盖 main/主集成分支。
