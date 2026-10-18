# Space Medusa CLI 装配：真实 Host / SDK 合成验收

日期：2026-10-18。此说明记录独立只读 Work 的三轮实际结果。验收使用官方运行器、原项目 Host/SDK 和合成数据；没有生产部署、真实 Medusa 数据访问或付费模型调用。

## 源码身份与范围

- 首两轮固定完整源码：`d72fac52f41420fc39d571fc79c3a65f3f8d3bfc`，2916 个源码文件。该版本包含默认关闭的 CLI Medusa approved-source 装配。
- 最后一轮：同一 d72 完整源码，**仅**取 `367441670970324aca07c1e4d69aadcaccfdc0fe` 的 `test/space-medusa-startup.http.test.mjs`，Git blob 为 `6db6eefbe2e15f1921db48df64bcef37550424dc`。
- 该测试修订只向原 `signWorkspaceRequest` 补充遗漏的 `publicOrigin: origin`；生产签名器和原 HTTP 断言未变。最后一轮不是完整 367 源树，也不包含中间 PR118 打包整合的验收。
- 最后组合源仍为 2916 文件。源码/依赖前后校验通过；没有通过改变锁、替换依赖、放宽断言或生产权限来通过测试。
- 原安装生产版本 `7008f5b66731edcd12cb62aa33eb3c4a19ce3218` 没有被此次验收更新。

## 三轮经过

### 1. 原锁依赖未装齐：测试体 0 执行

实际 Node 24.19.0 可用，但首轮安装误用了测试阶段的 `env -i`，清掉平台已有网络/证书配置，官方 registry 安装出现 DNS / `EAI_AGAIN`；所需 Bun 1.3.14、OMP 18.10.4 和 pi-ai 1.1.0 尚未齐备。只读诊断没有发现工具访问拒绝。纠正仅在安装阶段恢复平台已有网络配置；实际测试仍使用空环境和显式白名单，未继承真实服务凭据。五组、七个文件在导入阶段失败，计划 27 个产品测试体均未执行。

这轮属于依赖准备失败，不能计成产品断言失败，也不能借用其他环境的通过结果。完整源码与锁保持不变；原失败记录保留。

### 2. 正常安装恢复后：26 通过、1 失败

原固定版本依赖正常安装后，独立 Work 在同一 d72 源码实际执行全部选定 27 项：26 pass、1 fail、0 skip。

| 选定范围 | 实际结果 |
| --- | --- |
| 新 CLI 原启动器签名 HTTP | 1 通过、1 失败 |
| 原 Space signed Host / approved source / sources Host | 17 通过 |
| 原资料主链 SDK，明确排除 diagnostic-only 场景 | 5 通过 |
| 原持续预算 SDK | 2 通过 |
| 原 Goal owner HTTP | 1 通过 |

唯一失败为新 CLI 正向 HTTP fixture：首次签名调用遗漏 `publicOrigin`，原签名器执行 `new URL(undefined)` 抛出 `ERR_INVALID_URL`，还没有完成签名登录流程。默认禁用 Medusa backend 的另一个新用例通过。该轮不能写作 27/27 或整体成功。

### 3. 单 fixture 修正后：只复验受影响用例，1 通过

本地首先用准确的原 fixture headers 声明和未修改的原签名器做合成参数红绿：旧调用重现 `ERR_INVALID_URL`；补字段后 POST/GET 的 audience、精确 body hash 和真实 Ed25519 签名验证通过。这是有限参数检查，不替代 HTTP 验收。

随后独立 Work 仅执行原首用例：

`CLI reviewed source reaches original signed Space HTTP without model disclosure or copied product records`

实际 1 pass、0 fail、0 skip，exit 0，wall 1.276 秒。其余已通过的 26 项未重跑。此单项实际覆盖：

- 原 `startWorkspaceServer` 显式可信配置与临时合成私有文件。
- 原 signed login、Session 和 CSRF 请求链。
- 原 HTTP 创建 Space、发现 approved-source 元数据、写入精确页面引用及 page GET/current 解析。
- 另一未共享成员收到 404，且不产生额外 Medusa responder 请求。
- `businessLibrary.products.length === 0`、`runs.length === 0`、`externalAttempts === 0`；返回仍为 metadata reference，`modelAccess: false`。

因此，选定的 27 项均已有对应通过记录，来源是第二轮 26 项加第三轮修后 1 项。**没有一次单次 27/27 的运行记录。**

## 运行器与替身边界

实际运行器为 Node 24.19.0、Bun 1.3.14、OMP 18.10.4、根项目 `@earendil-works/pi-ai` 1.1.0。SDK 测试执行原官方 AgentSession；模型响应由有限合成 provider 提供，Docling 为有限合成 parser，Medusa 为有限 loopback HTTP responder。测试使用原权限、Session/current、来源版本、持久预算和原 Store。

- 原资料 SDK 断言覆盖实际上传、模型从 schema 发现参数并选工具、写带依赖的结构化记忆、Brain Decision、同 Session 续句和页面 GET。它证明官方 SDK 与原 Host 的合成闭环，不证明真实模型理解或真实 Docling 文档解析效果。
- 原持续预算 SDK 覆盖连续三 Run 和未知 usage 的保守预留；没有真实计费。
- 新 CLI HTTP 测试没有模型 Run，既有 SDK 用例存在合成模型调用。准确表述是“零真实/付费模型调用”，不能说所有测试没有模型调用。
- Medusa reader 只处理当前批准的精确来源引用。页面选择引用不等于向模型披露正文或自动授权。
- 未执行旧受阻 OMP receipt 恢复审查或 PR112 权限复审；没有以本轮结果替代这些未完成事项。

## 固定校验证据

以下摘要来自独立 Work 最终报告。本说明只保存方法、结果和 hash，不提交原运行日志、运行 JSON、凭据或实际运行目录。

| 项目 | SHA256 |
| --- | --- |
| 最后组合 2916 源码清单 | `fc5d9465b0eb085beba289bd7c01a38ee05e91da72d2bcb7148ed920465b759b` |
| 46744 个依赖/运行器文件清单，前后相同 | `a8d1a9a15c69c88195ddb224e31d2f9b9aad3b2175b9a44fd7999819ca493a7b` |
| 修后单项 TAP | `3dbfa2a917d9587f09f8625f05889b4e37f9f60b4fe7934bc6768e9546d076d1` |
| 最终 Work 报告 | `1c82a7eefbeda95a0ff84933ba4e3800543321d83962d352a839f9e9f9e6b6ea` |
| 最终 Work 安全证据 | `eb3de0eaefaf1612fb7a1b3de780adebfd737d779295a3deabacd9b0ae444fd7` |

## 尚未覆盖的上线事项

真实 Medusa PostgreSQL/DI/迁移、真实 approved-source 审核 API、专用 read-token 创建与配置、真实商品数据、生产服务接线均未由本轮执行或证明。仍需分别授权和验收。原 CLI 默认关闭，不使用 Admin key，不因这些合成测试自动开启或扩大当前模型接收范围。
