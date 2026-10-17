# ERPNext 企业资料独立适配包交接（2026-10-17）

## 精确基线、源码与分工

- 固定父提交：`016a2eaecad9b303fbb8c14b45b708c5edc83053`。开发分支：`codex/erpnext-enterprise-adapter-20261017`。源码/测试提交：`ed34e06981876bbc78f36b78e0cd06a05e01d307`。本说明随后单独提交。
- 已阅读该基线 `WORKSPACE-LIBRARY-TO-BRAIN-PRODUCT-HANDOFF-20261017.md`、`FREE-TRADE-HANDOFF.md`、原免费贸易插件 AGENTS/README、PR #86 内容及 Issue #85 全部 10 条分工评论。Library/Brain 主线仍由原唯一写入者持有。
- 不从 main 开发；未修改/推送 main 或整合分支。只新增本包、专属测试目录和本交接文件。默认共享注册清单未改，新包 `enabled:false`。
- 原客户端仅复用：`plugins/workspace-free-trade/src/free-trade.mjs`，基线与当前 blob 均为 `f43264585c6850643c1e4416bc0c0be773c4366e`；未请求或实施共用客户端改动。
- 考察过原插件独立子模块：现有 `check-plugins.mjs` 会递归校验每个包全部 JS 和打包闭包，嵌套包会破坏原包闭包。因此选择专属兄弟包 `plugins/workspace-erpnext-enterprise`，通过 exact peer `@workspace-agent/pi-free-trade:0.1.2` 公共导出复用，不复制网络实现。没有新增根依赖/锁。

## 可审核结果与集成契约

包为 native ESM，入口/Skill/README/AGENTS 完整。只有状态和一次固定投影读两个工具，参数必须 `{}`。宿主传入并冻结 `{doctype,name,fields}`，继承原四类商业单据/字段白名单；模型不能选择 URL、凭据、任意单据、额外字段、filter 或分页。没有全库扫描、报价准备、价格规则或任何商业写入。

全部允许字段一对一映射为 `erpnext.<doctype_namespace>.<field>`，保留原 null/false/0。每项引用 `sourceRef:{id,field}`，来源包含 ERP origin、精确过滤 URL、单据名、授权字段、读取时间、授权投影 SHA-256。只有宿主选了 `modified` 才引用它；投影 hash 不冒充完整文档版本/Library Artifact SHA。回执明确 `enterpriseFactAuthority:'workspace-library'`、`libraryMigration:'not_migrated'`、`persisted:false`、`externalWrites:false`。

只消费原 `createFreeTradeSessionBinding(...).open(actualNativeSessionId)` control 的 `erp.status/read`、`authorize`、`authorizeContext`、`seal`、`verifyBody`、`check`。读前后精确授权，复用原 scope/native-session/projection proof；配置和 admin 身份不等于字段授权。缓存回执使用原 `check(...,{refresh:true,phase})` 重读同一投影；撤权、换模型、源值变化、篡改、未知回执均拒绝。包只保留当前绑定内一个不可变投影，无持久化/第二套授权或记忆库。

可配置工厂：`createErpNextEnterpriseAdapter({enabled:true,control,selection})` 与 `erpNextEnterpriseExtension({adapter,host})`。工具私有激活另需原 `host.addDisclosureGuard` 和 `getModel`，原 Host 在每次模型发送、完成和最终交付前调用 gate。普通入口 disabled/unconfigured；缺 selection/control/connection/gate 也 unconfigured，不读环境/文件/真实凭据。

**主会话接线前必须知悉：** 本次未改宿主 profile、RPC、journal、Library/Brain 或 UI。原业务 journal 尚不准入本包映射回执，不能仅把工具加进 allowlist 就宣称生产接线完成。需要主线原授权控制与真实发送/交付门集成；本包不恢复旧私有回执，新实例拒绝它们。禁用/卸载不使历史私有内容获准再次发送。原 Host 现有有界读预算继续生效。完整方法签名、映射表与代码示例见包 README。

## 实际验收命令和结果

环境：本任务选定的 `/workspace/workspace-agent` Codex Cloud；Node `v24.19.0`，npm `11.9.0`。数据/身份/授权/模型全部合成，不调用真实 ERPNext/模型/付费接口；真实凭据未读取或配置。

| 实际命令 | 结果与范围 |
| --- | --- |
| `cd plugins/workspace-erpnext-enterprise && npm run build` | 退出 0；native ESM 语法与 import/manifest 闭包构建检查；无须转译，不声称官方 SDK 编译 |
| 同目录 `npm test` | 最终 27/27 通过，fail/cancel/skip/todo 均 0，退出 0；自动离线 pack 原客户端及新包到全新 `/tmp/erpnext-enterprise-*`，仓库外解包导入、每个打包文件字节对照、现有发现器启用/加载/禁用/重启选中/卸载 |
| `node --test test/free-trade.test.mjs` | 原共用客户端测试 77/77 通过，fail/cancel/skip/todo 均 0，退出 0；仅本机 HTTP/合成响应，无真实 TED/SAM/ERP 请求 |
| `npm run plugins:pack-check` | 最终退出 0；仓库 15 包静态 import/pack 闭包均通过，新包默认未启用；不是 SDK 加载或全仓测试 |
| `git diff --cached --check`（源码提交前） | 通过；变更仅 10 个专属源码/测试文件 |

新增用例覆盖：缺配置/仅有配置但无授权、四类全部字段、精确 server-side fields/name filter、选择不可变、身份/字段/接收方撤销、HTTP 返回时撤权、缓存披露时撤权、源变化、原 proof/来源引用、非授权 modified、空参数越权、错误响应/无重试/密钥回显拦截、取消、缺 gate、启停卸载、拒绝旧私有历史、失败回执夹带私有字段、来源 URL/投影扩大。

保留初次失败，不覆写成一次成功：首次包测试 23/24 通过，畸形 JSON 测试错把原客户端 `REMOTE_NOT_JSON` 预期为 `REMOTE_SCHEMA_INVALID`；只修正测试预期。首次全仓 pack check 拒绝 build 脚本 `new URL('../',import.meta.url)` 目录表达式（检查器按文件资源检查）；改用 `path.dirname` 定位，未改共用检查器。随后最终结果如上。

本机合成验证日志未提交。以下哈希只用于辨认本次结果，不作为生产验收凭证：

| `/tmp` 输出 | SHA-256 |
| --- | --- |
| `erpnext-enterprise-build.txt` | `a96eb290f497bfde0e1ed692f68c9984d3d7bfe49a2c56a3ad64fe6c4a5585bf` |
| `erpnext-enterprise-test.txt` | `26b53f58ca3695811c9dbdf09c938c555471d31998bc95ca652c744d8f852dc8` |
| `erpnext-enterprise-packcheck.txt` | `fd30d18e4acd7f45651401a608918d6cee02b9cda8a57559b363d229898f0141` |

## 官方 SDK 单列：未实际运行

仓库固定 OMP `18.10.4` / Bun `1.3.14` 在本环境未安装。为验证可用性，只把 `support/omp-coding-agent`、`support/omp-bun-linux-x64` 的原 package/lock 复制到 `/tmp/erpnext-enterprise-sdk-zGjy4O/{omp-coding-agent,omp-bun-linux-x64}`；未改仓库依赖或创建替身 SDK。

在两个临时子目录分别实际执行（干净环境，只保留 PATH，HOME/npm cache/npmrc 均指定该临时目录，无凭据）：

```sh
npm ci --ignore-scripts --no-audit --no-fund --offline
npm ci --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=20000
```

离线均退出 1：OMP 缺 `zod-3.25.76.tgz`，Bun 缺 `bun-linux-x64-baseline-1.3.14.tgz`，`ENOTCACHED`。正常依赖获取亦失败：Bun `getaddrinfo EAI_AGAIN registry.npmjs.org`；OMP 日志显示同类 DNS 失败（string-width/sprintf-js），最后 npm `Exit handler never called!` 退出 1。未伪造成功、未安装 stub、未改网络策略、未用其他 SDK 替代。

因此 **官方 SDK 实际运行=false**。现有 projectPlugins + Node 模块加载是真实本地代码，但不冒充官方 native loader；字段读取的真实传输仅是 loopback HTTP。没有原完整会话/模型联调、付费调用、真实 ERP 实例、真实配置、真实企业授权、完整仓库/浏览器/服务器验收或部署。未触发 Actions。

## 精确文件清单与未完成项

源码提交新增 10 文件：

1. `plugins/workspace-erpnext-enterprise/package.json`
2. `plugins/workspace-erpnext-enterprise/AGENTS.md`
3. `plugins/workspace-erpnext-enterprise/README.md`
4. `plugins/workspace-erpnext-enterprise/src/adapter.mjs`
5. `plugins/workspace-erpnext-enterprise/src/extension.js`
6. `plugins/workspace-erpnext-enterprise/scripts/build.mjs`
7. `plugins/workspace-erpnext-enterprise/skills/erpnext-enterprise/SKILL.md`
8. `test/erpnext-enterprise-adapter/adapter.test.mjs`
9. `test/erpnext-enterprise-adapter/lifecycle.test.mjs`
10. `test/erpnext-enterprise-adapter/verify.mjs`

另新增本独立交接文件。没有删除或修改既有文件。主会话后续：在具备原固定 SDK 的授权环境复验真实 native discovery/工具 Schema；审核同一原 Host 的 journal/发送/最终交付准入后再接线；只有得到已有真实服务和精确只读授权，才另做真实 ERPNext 联调。缺这些条件保持 unconfigured，主会话决定整合与服务器验收。
