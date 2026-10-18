# Medusa official package reproducibility and host-lock closure

固定基线：`a819897d9212212afab8f12683d212971c982e8b`。独立分支：`codex/medusa-reproducible-package-20261018`。原 PR116/`codex/medusa-live-acceptance-20261018` 保留；不整合后来主线提交。

本次解决重新编译/pack 当前 Product Context 插件后，host 仍锁旧本地 archive integrity 的装配阻断。没有插件业务源码、依赖版本、Space、server、UI 或 Docker 配置修改；不忽略 integrity、不手工伪造 archive、不绕过 `npm ci`。所有包均由官方 `medusa plugin:build`、`npm pack` 产生。

## 实际结果和工具链

两个绝对路径不同的全新源目录：

- `/workspace/medusa-package-evidence-20261018/A`
- `/workspace/medusa-package-evidence-20261018/B`

每个目录独立从固定 Git commit 读取插件 package/lock/README/tsconfig/src；开始时没有 node_modules 或 .medusa，未复制任何旧编译产物。共用 npm 下载缓存，分别执行官方 `npm ci`，不是复制 node_modules。package.json、package-lock.json、README 置 `0600`；官方 plugin build 以 `umask 077` 执行，随后官方 npm pack。两个目录内的插件 manifest 和原插件锁逐字节保持不变。

| 项目 | A | B |
| --- | --- | --- |
| tgz bytes | 21012 | 21012 |
| SHA256 | `bc6d3584e3902914273f969517112ae89e2d2210a13b853679057110ada81b24` | 同左 |
| tar 成员数 | 30 | 30 |
| 成员权限 | 全部 `0600` | 全部 `0600` |

**完整 tgz Buffer、SHA512 SRI、逐成员 path/type/mode/size/uid/gid/mtime/content SHA256 均一致。** 没有仅比较解包后的源码，也没有忽略 gzip/tar 头差异。

新 SRI：

```text
sha512-wwmo0aJ+uU6UAnlJAQDPnVzRInVcYYzDmTyy+9IL8CCnlHzwddmrPnKJ3FNx2pT+17+bxwcoV0FIKCuyZhP8Aw==
```

旧 SRI：

```text
sha512-KOwnDpzIOGylIIdw7rJPIvfzG/h+PlXEe7FXLyIgj9or4dej4q2PIGA8eL0S+r9SzwEBBpMoW1u6fphe3WPRvg==
```

实际工具链：Node `v24.19.0`、npm `11.9.0`；插件和 host 都安装原锁中的 Medusa CLI/framework/medusa `2.21.2`、SWC `1.16.18`、TypeScript `6.0.3`。tar 清单仅用 Python 标准库 tarfile **读取**；没有用 Python 或自制 tar 写入/替换包。

**未运行 Docker**。本机 npm 11.9.0 与历史镜像 npm 11.17 有差异，本次不能声称 Docker 镜像或其精确工具链已通过。API/UI Dockerfile 和 dockerignore 只读；实际本机装配没有显示需要扩大修改这些文件。

## 包内协议与锁差异

从两个真实 archive 读取编译成员，核对当前内容并记录 SHA256：

- `modules/product-context/service.js`：nativeUpdate 条件包含 version 和旧 source_hash，受影响行数不为 1 则冲突。
- `product-context-validation.js`：integer 上限 `2147483647` 与 strict 字段校验。
- `product-context-review.js`：current-source policy marker、revision stamp 和 release gate。
- Admin context route：实际 GET version/hash 比较与 409。
- 两 Agent routes：`review_policy` 和 `isCurrentApprovedContext`。

这是包内容/编译来源证据，不是 HTTP/PG 并发验收结果。完整成员清单、编译成员内容 hash 和工具链在允许的 validation JSON 中。

双目录一致后，隔离 update host 用 A archive 与原 host 锁实际 `npm ci`，exit 1、明确 `EINTEGRITY`，复现旧 integrity 阻断。随后对真实本地 tgz 正常运行：

```sh
npm install --package-lock-only ./magicy565-medusa-enterprise-product-context-0.1.0.tgz \
  --registry=https://registry.npmjs.org --fetch-retries=1 --fetch-timeout=30000
```

新锁由该 npm 命令生成，未手改 hash。`assertLockDelta` 比较整个结构，冻结所有外部包路径和每条完整条目、根配置及插件版本/peers/engines，只允许新 archive 的实际 integrity，以及 **严格限定**的同一本地 archive `file:./name.tgz` → `file:name.tgz` 规范化。其他本地/外部漂移一律拒绝。

实际只有两处锁字段变化：

1. `packages["node_modules/@magicy565/medusa-enterprise-product-context"].integrity`
2. `packages[""].dependencies["@magicy565/medusa-enterprise-product-context"]` 的上述 file 路径规范化。

**1,147 条外部完整锁条目与路径全部不变**。其排序规范化结构 SHA256 在前后均为 `3dff10201588747c41204bbc628e77f9e6801c513ade99cbed3194b3e0013f21`。仓库 host package.json、原插件锁及其他锁全部未改。

host 锁 SHA256：旧 `c954cde35008b32d4c38b4022fccd2e8b0f5db1a69a17512a721bfffb96b150c` → 新 `1f03d6819c6aa0b052c8f92bafb77573ea065b3b922055634c3215c33d7cedd1`。

## 新 host、反例和实际构建

两个额外的全新 host 目录 `host-A/apps/medusa-acceptance`、`host-B/apps/medusa-acceptance`，均从原 host manifest 开始，使用同一新锁，分别复制 A/B archive：

- A：官方 `npm ci` exit 0；锁逐字节不变。
- B：官方 `npm ci` exit 0；锁逐字节不变。
- 独立 `tampered-host`：只改 archive 一个 gzip header byte，保留有效 tar 内容，使用**独立空 npm cache**执行同一官方 npm ci，exit 1、明确 `EINTEGRITY`。未让成功缓存代替读取被篡改 archive。
- A：原 config 的 `npm run build` exit 0，生成 `.medusa/server/medusa-config.js`。
- B：运行既有 `prepare-admin-static-config.mjs`，仅修改临时 build-stage config；`npm run build -- --admin-only` exit 0，生成非空 `.medusa/admin/index.html`。未改仓库 UI 或 config。

build 环境只含固定合成 build-only 字符串和 loopback 占位 URL，不连接 DB/Redis。安装使用隔离 HOME/cache 和官方 registry，不读取现有生产凭据、.env、云登录或业务服务。没有创建账号/token/容器，没有付费模型请求或部署。

## 新原生 closure 审核与历史边界

`audit-closure.cjs` 在实际 fresh host 安装目录用原 `medusa-config.ts` 的原生 defineConfig、实际 `getResolvedPlugins` 和 `resolveModuleExports` 解析所有模块/provider/plugin；不调用 SDK bootstrap 或 DB migration。

API 与转换后的 UI 均实际得到：27 modules + 7 providers + 1 plugin module = 35；`translation/rbac` disabled，默认必需 `event_bus/cache` 包含在内。两份完整 entries 一致，11 个原生 migration 路径缺少空目录，与只读 Dockerfile 原准备列表一致；**没有实跑 Docker 的建目录步骤或迁移**。API native admin path `/app`；UI 临时转换后 `/dashboard` 且 backendUrl 为空。

原 `omp-medusa-provider-closure-20261017.json` 全对象移至 `historical[0]`，包括旧 lock hash、旧 Docker/native-layout/7 项合同证据。顶层为本次真实 fresh-host 新审核，绑定新 host 锁、config、实际审计助手和只读装配输入；不把旧执行证据改 hash 后冒用。UI 转换 config 的新 hash 单列。

## 可重复运行与本次遇到的失败

纯打包脚本的两个阶段：

```sh
node scripts/medusa-package-acceptance.mjs /workspace/NEW-PRIVATE-MEDUSA-PACK-DIRECTORY
node scripts/medusa-package-acceptance.mjs --complete /workspace/NEW-PRIVATE-MEDUSA-PACK-DIRECTORY
```

目录必须新建、绝对路径且位于仓库外。两个入口现在首先共用只读 `validateWorkDirectory`：要求输入已等于 `path.resolve` 的规范路径，用 `path.relative` 对真实仓库路径核包含关系，拒绝仓库本身/内部/祖先；逐级 `lstat` 拒绝整个现有父链和末级目录上的 symlink、非目录及缺失父目录。`/./`、`..`、重复分隔符、末尾分隔符等别名直接拒绝。main 只接受末级尚未存在的目录，complete 要求末级已存在。校验发生在各入口任何 mkdir/写入/安装/删除之前，未新增清理权限。

第一阶段独立完成 A/B 构建与比较；不同则停止，不更新锁。第二阶段复验 archive、生成隔离候选锁、完整漂移检查、两个 host ci、独立篡改反例、API/Admin-only build 和实际 native audits。脚本不会自动写仓库锁或 validation 文件；由作者在全部结果核对后，仅复制 npm 生成的新锁并整理脱敏证据。失败时保留自己的私有临时目录供排查，不 prune 或全局清理。

本次阶段命令使用 `/workspace/medusa-package-evidence-20261018`。两处探针失败如实保留边界：

1. 首次 lock-only 探针正常生成新 integrity，但 npm 同时规范化了临时 manifest 的本地 file spec。初版过严拒绝该临时 manifest 变化。独立 `--save=false` 探针没有更新锁，不采用。最终重建隔离 update host，使用正常 lock-only 输出，只允许已实证的精确 file spec 规范化；仓库及 fresh host manifest 保持原字节。
2. 两个 host ci 和 API/UI build 成功后，首个 audit 助手误通过未导出的 framework `package.json` 子路径读取版本而 exit 1。改为只读实际安装文件后，**单独重新执行两个真实 audit 命令**，均 exit 0。未重跑编译，也未把失败的完整 `--complete` 调用改称全程 exit 0。最终助手可供下一次全新目录完整复跑。

实际审计续跑命令由同一隔离构建环境启动，等效于：

```sh
node test/medusa-package-acceptance/audit-closure.cjs /workspace/medusa-package-evidence-20261018/host-A/apps/medusa-acceptance
node test/medusa-package-acceptance/audit-closure.cjs /workspace/medusa-package-evidence-20261018/host-B/apps/medusa-acceptance
```

没有网络访问拒绝或外部锁漂移阻断；没有 stub 或替换官方依赖。

### 已有原执行证据摘要（只读核对，无构建重跑）

以下均为首轮 `75d72bc81894f88a66c4602efb500dacb0c094b3` 交付所依据的原执行记录。本次仅读取 Git 外保留文件重新计算 SHA256，与原 `report.json` 记录核对；不上传原日志、归档或凭据。日志 hash 指原 subprocess 合并 stdout/stderr 文件字节；两个修后 audit 的 stderr 为空。

令 `W=/workspace/medusa-package-evidence-20261018`，A/B 的原命令分别使用 `$W/A`、`$W/B`：

```sh
npm ci --prefix "$W/A/packages/medusa-enterprise-product-context" --registry=https://registry.npmjs.org --fetch-retries=1 --fetch-timeout=30000
bash -c 'umask 077; exec "$@"' -- npm run build --prefix "$W/A/packages/medusa-enterprise-product-context"
npm pack "$W/A/packages/medusa-enterprise-product-context" --pack-destination "$W/A/apps/medusa-acceptance" --json
```

B 同样三条命令，只将 A 换为 B。两归档原始 bytes/SHA/SRI/成员一致证据见上文；下表的不同 build 输出 hash 不是归档差异。

| 原记录 | exit | 原输出文件 SHA256 |
| --- | --- | --- |
| A plugin ci | 0 | `38361bcafaf72af68978ea5d0a122f4bb78599cc6486f186d9ae0071b6085b19` |
| A official plugin build | 0 | `d40920f6407d2d8a0dc27cb7fd5aa976c254fb2a7b7bff3735b5d8b68437316b` |
| A npm pack | 0 | `3c856fea432f74c81a13e6261e06486d6355793daff98860203fba56a84e73fa` |
| B plugin ci | 0 | `04828015446ad6181acc0a665a3fb951a8a8bd20b2345ee3af61ec472d81cdca` |
| B official plugin build | 0 | `db98994440dad422f310625d44b7e6677ce8865773b96c2e823a19297613c373` |
| B npm pack | 0 | `3c856fea432f74c81a13e6261e06486d6355793daff98860203fba56a84e73fa` |
| fresh host A npm ci | 0 | `d6345be2293b5f2c428938b44c413898c1b11d22eb2cc1d8926950cd385f465d` |
| fresh host B npm ci | 0 | `6b4d6b4b9a25148fd487f2d260bfeb26c357287e0b6763079f46946e37fc3648` |
| independent-cache tampered npm ci | 1 / EINTEGRITY | `1c741f18ec3fdc0e4be4cbef22fdabeedd0111dba666f3a5b815e2e0ea457ac6` |
| API `npm run build` | 0 | `16a4942d959307def668c66f450f038c722deac1bb79fc0dcb27dcb5c245e714` |
| UI `npm run build -- --admin-only` | 0 | `d6ff503e632cb44b02f6292b65eba5a899418320d7da9f6bcbca89c398652355` |

原 `node scripts/medusa-package-acceptance.mjs --complete "$W"` 首次 exit 1 为 `HOST_MANIFEST_CHANGED`；其中正常 lock-only subprocess exit 0、原输出 SHA256 `4c2a0edc189edd72682ff8adda87e72f27972256071a3d6d6047b99e6aa11b40`。当时未另存整个入口调用的合并输出文件，不能提供或伪造其整体输出 hash。第二次同一入口在 ci/build 成功后因首个 native audit 助手错误 exit 1；该失败 audit 原输出为 184 bytes、SHA256 `4c7a152b2d7d23d800ec518594a33216d75fa00a62b2f20ddf634bb54b344b8c`。

修后单独续跑的**原命令**如下（cwd 分别为对应 host，使用前述隔离 HOME/cache 和合成 build 环境），本次未重新执行：

```sh
node /workspace/medusa-reproducible-package/test/medusa-package-acceptance/audit-closure.cjs /workspace/medusa-package-evidence-20261018/host-A/apps/medusa-acceptance
node /workspace/medusa-reproducible-package/test/medusa-package-acceptance/audit-closure.cjs /workspace/medusa-package-evidence-20261018/host-B/apps/medusa-acceptance
```

| 修后原 audit | exit | bytes | 原输出 SHA256 |
| --- | --- | --- | --- |
| API A | 0 | 12874 | `f019cd6fa1ecfbe0b2ef291fe01dba2323e548721dcf4a86d2849ebba430d03b` |
| UI B | 0 | 12879 | `ec3bed3ac7f988dae74306c6b647f9e9990729f5d3d9d8fd0a1c49200add0b51` |

## 无副作用合同和未运行项

```sh
node --test test/medusa-package-acceptance/contracts.test.mjs
node --test --test-name-pattern='^(final image preparation|strict Medusa smoke refuses|strict smoke fails)' test/deployment-source.test.mjs
node --check scripts/medusa-package-acceptance.mjs
node --check test/medusa-package-acceptance/audit-closure.cjs
node --check test/medusa-package-acceptance/contracts.test.mjs
node --check test/deployment-source.test.mjs
git diff --check
```

首轮纯打包合同 7/7；本次路径隔离补修后为 8/8，精确筛选的 deployment 合同 3/3，fail/cancel/skip/todo 均 0。新增负例仅在临时合成仓库/外部目录运行：计算旧谓词可绕过的案例，不执行旧破坏入口；两入口的实际 CLI 子进程把 mkdir/write/copy/rm 和 subprocess spawn 设为失败哨兵，确认规范化/包含关系/symlink 拒绝先于任何这些操作，合成 sentinel 和目录清单保持不变。正例只调用只读 guard，验证合法外部目录和同名前缀 sibling，未触发安装。没有对真实仓库进行破坏性验证，也未重跑已成功大构建。

HTTP 反例加入明确合成 `MEDUSA_LIVE_ISOLATED_INSTANCE`，保留真实 loopback 请求路径、503、失败状态及脱敏断言，没有删除隔离门。未运行 deployment 文件中的 Docker Compose、bootstrap secret 文件或管理员设置测试。未运行整个 deployment 文件，不复用历史 7/7 作为本次结果。

未运行 Docker/镜像精确 npm11.17、DB/Redis、真实 Medusa HTTP/PG、迁移/link 执行、PR116 live 验收、浏览器、服务器登录或生产部署。编译成功不能代替这些验收。

只推允许路径内的源码/合成测试/脱敏说明与指定 validation JSON。tgz、node_modules、.medusa、npm cache、原始运行日志全部留在仓库外，不入 Git。固定分支独立 Draft PR，根审后由主会话选择性整合；不合并、不强推、不修改 main/集成分支。
