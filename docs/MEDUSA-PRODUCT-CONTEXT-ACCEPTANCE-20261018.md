# Medusa Product Context 独立验收与修复（2026-10-18）

## 固定来源与交付边界

- 固定基线：`da04f977535b724d2ea22077f80670f1962b4f39`。先通过 GitHub 及实际 `git fetch --depth=1 origin <SHA>` 核对对象，再创建 `codex/medusa-product-context-acceptance-20261018`；没有从默认检出的 main `9e18c469f48b71bf46dba628af446c8ea578c328` 重做。
- 首轮源码提交：`567f076da0fa1fce8a23fe713540e6de3248113b`，首轮交接 HEAD：`3e7ce8231217fc1862dfe365211ede72c7d4d9c7`。复审补修源码/测试/README 提交：`fab749bc98fccc07937e276ac5fbe0d548605383`；本说明随后更新。最终 HEAD 以专属分支及 Draft PR #109 为准。
- 固定基线没有根、packages 或本包 AGENTS.md；已检查跟踪文件并阅读根 README、包 README、全部原测试。薄工具边界另参考 `plugins/workspace-medusa-catalog/AGENTS.md` 与 README。
- 修改仅本包 13 文件及本说明。包和根的 package.json、package-lock.json 均与固定基线一致。未修改 server、共享 Host/loader、任何 UI、其他插件、Brain、ERPNext、Docker、部署或生产配置。没有启用功能、创建数据库/权限库/锁库/队列/Agent Loop。
- 本次保留的是后端权限、来源版本、审核状态和存储一致性约束；未增加产品分类、经营判断、模型选工具的固定流程或强制 DAG。测试中的固定调用顺序只用于确定性复现两种并发完成顺序。
- 当前已有整合分支 `codex/omp-all-plugins-integration-20261017` 的 `4cbae6fe3e2e3d6f25fae728b7c2f6f6b9229de7` 经 GitHub compare 核对，只比固定基线多一个 UI/文档/测试提交，未变更本包。Draft PR 以此已有整合分支作为评审目标，主会话决定选择性整合；不修改、合并或强推 main。

## 原缺陷的实际复现

使用 Node `v24.19.0`、npm `11.9.0` 和包锁定的官方 Medusa `2.21.2`；原包 `npm test` 构建成功且原 4/4 测试通过，仍可发生以下故障。数据、身份、token 和持久层全部明确合成；加载的是原 TypeScript 经官方 CLI 编译的真实路由。

1. 合成已有 `approved`、score 90、无缺证据、version 1 的记录。把当前原生 Product 的 title、description、Variant SKU 改成 `CHANGED…`，保留旧审核。原列表和单项 GET 都返回了更改后的三个字段；原代码没有查验 source_hash。
2. 两请求同时读取 `ready_for_review`、score 90、无缺证据的同一快照。A 批准；B 只写 `missing_evidence:['certificate']`。用可控持久层分别完成两种顺序：

| 保存顺序 | 原实际最终状态 | 原 Agent 单项读取 |
| --- | --- | --- |
| A → B | approved，missing_evidence 为 certificate | 200，错误放行缺证据记录 |
| B → A | approved，missing_evidence 被 A 旧快照清回 [] | 200，B 的改动被覆盖 |

复现脚本为 `packages/medusa-enterprise-product-context/test/reproduce-baseline.cjs`，只手动对指定原基线执行，不纳入修复后自动测试。它有断言，若上述原缺陷不出现会失败。可独立重做：

```sh
set -euo pipefail
repo_dir="$PWD"
baseline_dir=$(mktemp -d /tmp/medusa-fixed-baseline.XXXXXX)
git archive da04f977535b724d2ea22077f80670f1962b4f39 \
  packages/medusa-enterprise-product-context | tar -x -C "$baseline_dir"
baseline_package="$baseline_dir/packages/medusa-enterprise-product-context"
# 仅复用本包按相同未变锁文件安装的官方依赖。
ln -s "$repo_dir/packages/medusa-enterprise-product-context/node_modules" "$baseline_package/node_modules"
(cd "$baseline_package" && MEDUSA_DISABLE_TELEMETRY=1 npm run build)
MEDUSA_BASELINE_PACKAGE="$baseline_package" \
  node "$repo_dir/packages/medusa-enterprise-product-context/test/reproduce-baseline.cjs"
```

在此次环境实际重建并执行的退出码为 0，输出同时包含两个 `REPRO stale approval emitted changed product`，以及上表两种顺序的 approved/缺证据结果。复现脚本的持久层故意模拟原合并更新，不是数据库服务或替换 Medusa SDK。

## 修复后的契约与不变量

- 原字段 source_hash 改由服务端计算。SHA-256 绑定当前实际 Product/Variant 投影、上下文业务内容及 review_version；具体字段和规范化规则见包 README 及 `src/product-context-review.ts`。相同映射同时用于审核 hash 和 Agent 输出；Variant 按 ID 排序以避免图查询顺序变化造成假失效。
- Admin GET 返回独立 `review_source_hash`，不伪造数据库中已存的批准 hash。每次 POST 必传当前 review_version，无记录为 0；每次成功保存由服务器递增至原 integer 上界 2147483647，随后饱和并轮换存储 hash 中的修订标记，不回绕、不溢出。显式批准（以及上界处所有写入）还必须回传 GET 的审核指纹为 body.source_hash，校验后才计算新状态/新版本的存储 hash。随机旧 hash、旧版本不能恢复批准。reviewed_by 仅取原 authenticated actor。
- 普通保存清除批准 digest、reviewer、reviewed_at；在 integer 上界只保留不可放行的随机修订标记；原 approved 且未明确指定状态时变为 ready_for_review。incomplete、ready_for_review、blocked 均不进入 Agent 投影；缺证据或评分不达标的显式批准返回 422。
- 原生成 update 是读取后赋值，不能作为 CAS。新增本包方法使用原 repository 的 fresh MikroORM manager，真实 nativeUpdate 编译为一条带 `id = ? AND review_version = ? AND deleted_at IS NULL AND source_hash = <原存储值>`（原 hash 为 null 时使用 IS NULL） 的 UPDATE，同时写新版本及 updated_at。影响行数必须为 1，否则 409，不重试。首次创建仍用现有 unique product_id 约束；原始 23505 或 SDK 映射后的创建冲突均拒绝覆盖。
- 两 Agent GET 共用同一检查和投影：状态、score/缺证据、审核人/时间、正整数版本、product identity 和当前 hash 全部满足才返回。旧 hash 缺失、版本单独变更、上下文或映射源值变化均拒绝。单项 404；列表省略该项且 count 只计本次页面实际输出数量，不再泄露数据库总数。分页最多扫描原 bounded page，不额外扫描或补齐。
- 输出继续排除 notes、reviewer、evidence.source 和任意产品 metadata；商业政策按已有 schema 七字段白名单，避免历史 JSON 的附加字段穿透。保留证据 sha256/reviewed_at，并输出匹配的 source_hash/review_version，二者不冒充 Library 版本或授权证明。
- 旧批准不自动迁移、不自动重新批准；需主会话选择的实际授权调用方采用新的预期版本/审核指纹协议，重新明确审核。`apps/medusa-product-catalog/src/App.tsx:525` 的旧 contextPayload 未发 source_hash 且用 review_version || 1，新建需 0、批准需指纹后会 409；上界处编辑/撤销也需指纹。用户已选择官方 Medusa Admin，本次未改或重做旧 UI，真实调用入口适配仍由主会话决定。`apps/medusa-acceptance/medusa-config.ts` 已无条件注册本包，因此不能称本包天然默认 disabled；未部署新修复、未配置 Agent token 也不等于关闭注册。本次未改注册或部署。

## 实际命令及证据范围

依赖安装使用隔离 `/tmp` HOME、npm cache、空 user/global npmrc，显式官方 registry，未读取、创建或配置业务凭据。所有依赖沿用原锁；禁用安装脚本和遥测。

| 命令 | 实际结果 |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org --fetch-retries=0 --fetch-timeout=30000` | 退出 0；1115 packages，约 23 秒；未改锁 |
| 固定基线 `MEDUSA_DISABLE_TELEMETRY=1 npm test` | 退出 0；官方 CLI 编译、原 4/4 测试通过；fail/cancel/skip/todo 均 0 |
| 独立解包基线 `npm run build` + 上述 reproduce-baseline 脚本 | 均退出 0；原来源泄露及两种并发顺序均复现 |
| 第一轮修复后 `MEDUSA_DISABLE_TELEMETRY=1 npm test`（作者当时结果，后续复审发现阻断，见下节） | 退出 0；真实 plugin:build 成功，最终 9/9 测试通过，fail/cancel/skip/todo 均 0，测试耗时 1050.942507ms |
| `node_modules/.bin/tsc --noEmit` | 退出 0，输出为空；独立检查实际编译类型 |
| `git diff --check` 和提交前 cached check | 退出 0 |
| 对根及包 package.json/package-lock.json 的固定基线 diff | 退出 0，无变化 |

原 4 个测试保留所有断言，只给请求夹具补充新协议版本/指纹及响应 setHeader。第一轮新增 5 个集中回归组：真实本机 HTTP 的 token/批准/来源失效/重新审核/私有字段边界；全部映射产品字段和版本失效；撤销及坏数据拒绝；两种并发完成顺序和首次创建冲突；官方 PostgreSQL ORM 的真实 SQL 编译。

HTTP 使用 Node 原生 loopback server 包裹真实编译路由，graph 与持久层为显式替身。并发测试真实调用编译服务的 CAS 方法，但影响行数由可控持久层模拟；SQL 测试另加载官方 MikroORM、真实 DML metadata 和 PostgreSQL query compiler，`connect:false`，仅在 transport execute 处截取 SQL/参数并返回合成 affectedRows。验证 SQL 有 id/version/deleted_at 条件、新版本及 hash，且 0 行触发 conflict。**没有执行 PostgreSQL，也没有启动真实 Medusa 应用。**

保留初次错误而不冒充一次成功：初次新增实现构建报 `TS2769: No overload matches this call`，原因是 nextStatus 被推断为 string 而非原 ProductContextStatus；改用原 enum 修复，未修改类型检查或断言。早期临时复现脚本用绝对路径 require SDK 子路径报 `Cannot find module '…/@medusajs/framework/utils'`；改用 Node createRequire(package.json) 正常遵循 SDK exports，未安装 stub。相关原错误见执行记录；最终官方依赖、构建及复现均实际完成。

只记录脱敏结果和可重复测试源，不提交 node_modules、编译产物、运行日志、数据或凭据。当地结果文件的 SHA-256 仅用于辨认本次执行，不能当作生产验收凭证：

| 临时结果 | SHA-256 |
| --- | --- |
| install.log | `3f2aadbe0b2334ca0f63396a9dd9c897be6ee51d9b1d2106c0f62d3c6386ef1a` |
| 原 baseline.log | `f1da934055cec511d9dd74744aada69cd57d28fd081fb6b3cb0dd53ca0c6909d` |
| baseline-reproduced.log | `95adb537c116dee56381ce2335711bc017bfeb791c81465997bc4ee8de1575ae` |
| final-test.log | `71adb04ce10ba54ec90b0916b6f62df3ab3a1bd1371eec7a6323e6205aefa7bb` |

## 尚未验证与主会话接线要求

1. 环境没有 postgres/psql；未新建数据库。真实 PostgreSQL CAS、唯一约束、事务隔离、连接池、Medusa 模块 DI、迁移/link sync、实际完整 HTTP middleware 栈和 Admin session/JWT/API-key 认证尚未运行。此次复审补充直接运行了真实请求验证 middleware，但没有认证会话或真实 Medusa HTTP 栈。合成本机 HTTP 不能替代这些验收。
2. nativeUpdate 不经过原生成服务的 mutation-event wrapper；本包没有新增或依赖事件订阅。主会话需核对其真实部署的 subscriber/event/cache 行为，不能据 SQL 编译通过宣称生产事件流程完整。
3. 保护的是读取时取得的当前图投影；没有跨 Product 模块与 Product Context 模块的分布式快照事务。源在读取后再次变化、读取缓存、历史 Agent 内容的后续模型发送/最终交付，均仍需原共享 Host 的当前授权/披露门。hash 不是新的权限系统。直接绕过该审核 API 的可信后端写入者也必须遵守既有审核约定。
4. `plugins/workspace-medusa-catalog` 保持薄只读工具与默认 unconfigured；未接线或恢复任何未知业务写入。共享 server 的私有回执恢复、原 Host/loader、Library/Brain 仍由主会话负责；本次未声称已发现或修复其中具体缺陷。
5. 未连接腾讯服务器、真实 Medusa/企业数据、ERPNext、模型或付费 API；未读取/创建/配置凭据、部署、扩权或调整网络安全；未做完整全仓、UI/浏览器、实际 AgentSession 验收或主动运行 Actions。

## 复审阻断补修：版本耗尽和历史 JSON（同日）

独立复审指出首轮 9/9 仍遗漏两个阻断，作者随后对已交付提交 `3e7ce8231217fc1862dfe365211ede72c7d4d9c7` 重新解包、官方编译并实际复现，未把首轮通过作为完整验收：

- version 99999 批准成功后存为 100000，撤销得到 409 且仍 approved；历史 version 100000 的批准和撤销均 409。原迁移及本次官方 ORM 无连接 schema SQL 均确认字段为 PostgreSQL integer。
- 合法记录的历史 evidence.label 改为 `{source:"SYNTHETIC PRIVATE"}`，或 commercial_policy.moq 改为 `{internal_note:"SYNTHETIC PRIVATE"}` 后，原编译 Admin POST 仍重新批准为 200；两个原 Agent GET 均输出嵌套私有标记。此为历史/可信后端的畸形 JSON 前提，不是未认证绕过。

手动证明脚本 `test/reproduce-review-blockers.cjs` 使用 `MEDUSA_REVIEWED_PACKAGE` 指向上述提交解包并编译的包；方法与前文 baseline archive/symlink/build 相同，只把 archive ref 换成 3e7ce823，并运行该脚本。此次实际退出 0，断言和输出确认上述四种结果。它不参与修复后的自动成功测试。

补修采用原字段内的饱和计数器与修订标记：数字最多 2147483647，达到上界的每次保存生成 128-bit 随机标记。批准存为 `rev:<stamp>:<digest>`，非批准存为 `rev:<stamp>:unreviewed`；digest 包含 stamp。上界的所有 POST 必须提供当前 GET 审核指纹；CAS 同时比较原 version 和原完整存储 source_hash。即使数字和业务内容不变、重新批准或先撤销再批准，旧指纹与旧 CAS 条件仍失效。未更改数据库类型、未迁移、未回绕，也未仅把锁死常数扩大。标记是存储修订证据，不是凭据或权限授予。

新增 `product-context-validation.ts` 提取原字段定义，批准对合并后的完整业务内容校验，两个 Agent 读取对相同内容及原生产品字段值校验。数组元素、证据所有字段、商业政策数值/字符串和嵌套未知字段均受约束；不再只认键名或 evidence.status。畸形旧值即使 hash 匹配也拒绝读取和重签；返回通用错误而不回显私有值。管理员必须显式替换坏字段（nullable 字段可明确置 null）后重新批准；不做静默剥离、自动迁移或自动批准。非批准保存可以保留待修正旧值，确保管理员可撤销，但该状态不能披露给 Agent。既有 readiness >= 80 和零 missing 政策保持不变。

在原 9 个组基础上只增加两个回归组，验证实际请求验证 middleware 的 0/99999/100000/2147483646/2147483647 接受及越界/缺失拒绝；边界批准、撤销、编辑、重新批准；上界旧 token/旧 expected version/缺失指纹、相同内容重签及两种并发完成顺序；历史嵌套私有标记在两个读取和重新批准时均拒绝，显式修正后恢复。原首次创建、源变化、HTTP、授权、SQL 编译回归继续运行。

本轮首次测试为 10/11：边界测试误把官方 defineMiddlewares 转换后的 methods 数组当作原输入 method 字段，报 `TypeError: Cannot read properties of undefined (reading 'middlewares')`。查验实际官方导出后改为查找 methods.includes('POST')；未替换 SDK、未放宽断言。随后最终命令与身份如下：

| 复审补修实际命令 | 结果 |
| --- | --- |
| 对 3e7ce823 解包 `MEDUSA_DISABLE_TELEMETRY=1 npm run build`；`MEDUSA_REVIEWED_PACKAGE=<解包目录> node test/reproduce-review-blockers.cjs` | 均退出 0；版本锁死及两种畸形 JSON 泄露均复现 |
| 本包 `MEDUSA_DISABLE_TELEMETRY=1 npm test` | 退出 0；官方 plugin:build 成功，11/11，fail/cancel/skip/todo=0，1458.37442ms |
| `node_modules/.bin/tsc --noEmit` | 退出 0，输出为空 |
| `git diff --check`、cached check、对固定基线的根/包 manifest 与 lock diff | 退出 0，manifest/lock 无变化 |

最新补修源码提交为 `fab749bc98fccc07937e276ac5fbe0d548605383`。临时最终测试日志 SHA-256：`a8d2473eafea6aa8060f398d485e41d3995dee86cdc9e8a24c4d078cb68b2715`；原补修前复现日志：`aff47139dd45cac340db0ae4dea2670161b4b08853c77360f214f0479d20fb1d`。这些仍只是作者在此环境的真实编译/合成验收，不冒充独立复审通过或真实数据库验收。

## 选择性集成清单

源码提交包含以下 13 个包内文件，另取本说明提交。审核协议、CAS 方法和两个读取门须一起取用，不能只拣其中一个路由。无需根依赖/锁或迁移变更。

1. `packages/medusa-enterprise-product-context/README.md`
2. `packages/medusa-enterprise-product-context/src/api/admin/products/[id]/context/route.ts`
3. `packages/medusa-enterprise-product-context/src/api/agent/product-contexts/route.ts`
4. `packages/medusa-enterprise-product-context/src/api/agent/product-contexts/[id]/route.ts`
5. `packages/medusa-enterprise-product-context/src/api/middlewares.ts`
6. `packages/medusa-enterprise-product-context/src/modules/product-context/service.ts`
7. `packages/medusa-enterprise-product-context/src/product-context-review.ts`
8. `packages/medusa-enterprise-product-context/test/compiled-contracts.test.cjs`
9. `packages/medusa-enterprise-product-context/test/acceptance-fixture.cjs`
10. `packages/medusa-enterprise-product-context/test/review-acceptance.test.cjs`
11. `packages/medusa-enterprise-product-context/test/reproduce-baseline.cjs`
12. `packages/medusa-enterprise-product-context/src/product-context-validation.ts`
13. `packages/medusa-enterprise-product-context/test/reproduce-review-blockers.cjs`

由主会话在其唯一整合工作区复核完整 14 文件差异、运行本包 build/test，再在已授权的真实 Medusa 测试环境验证上列未验证项。此分支交付后停止，不自行整合主分支。
