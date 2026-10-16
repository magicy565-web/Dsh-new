# Codex Cloud 后端逐项验收（2026-10-16 UTC）

## 固定来源与环境

- 仓库：`magicy565-web/workspace-agent`；开发分支：`codex/omp-unified-cloud-build-20261016`。
- 固定起点：`16340ca0f7ef24cf61ea358534420e73a07b60a4`。`git ls-remote` 确认远端分支与该 SHA 一致后切换，未覆盖远端变化。
- 此环境最初实际位于 `work` / `b9546e1d7e6d7ac1381f84327a4f15cbfc60598f`，工作树无用户改动。没有根级 `AGENTS.md`；已读取全部 11 个插件的 `AGENTS.md` 及两份 OMP 验收文档。
- 选定的是本次已发布 Codex Cloud 环境，不能沿用旧 dot 环境结果。Node `24.19.0` / npm `11.9.0`，安装官方固定 Bun `1.3.14` 和 OMP `18.10.4`。Bun SHA256 与仓库 audit 一致：`a8f9ebd1770ddc8e55dab7a68d4ec1ec1eebf374bb97cc65cf2c3cb373fc6791`。
- 单个后端任务串行验收；前端暂停；没有启动旧 Workspace HTTP 服务器、恢复旧归档任务或访问真实企业资料。没有合入 PR94 Medusa 或 PR95 Brain，也没有退回 PR87 重做。

## 逐项结果与命令

在仓库根目录运行。所有测试使用 `env -i PATH="$PATH" HOME=/tmp NO_COLOR=1`，子进程再使用显式临时 HOME 和有限替身配置。测试不会继承当前进程的真实模型密钥。安装仅使用仓库固定依赖和受审计安装脚本，没有执行生命周期脚本或安装可选本地模型组件。

| 项目 | 结果 | 实际证据与边界 |
| --- | --- | --- |
| 固定依赖 | 通过 | `node scripts/setup-omp-runtime.mjs`、`node scripts/workspace-omp-install.mjs` 均返回 `installed-verified`；未修改锁文件 |
| 原生锁 acquire/release/reacquire | 通过 | `npm run workspace -- --check` 实际调用官方 `pi-utils/file-lock`，返回 `ready:true, scope:temporary-lock-only`；本环境未复现 EPERM。不是 stub 成功，不等同持久会话通过 |
| 原生持久 Session 创建 | 通过 | 原 local-entry 测试创建真实原生 JSONL；`originalSdkPersisted:true`，文件权限 `0600`；有限模型替身 |
| 指定合成产品读取及本地草稿保存 | 通过 | 原 local/local-entry 测试实际调用原生 read/write，核对磁盘内容、来源 SHA256、草稿 SHA256、未批准/未发送状态；没有真实企业输入 |
| 同 Session 两轮、退出后重开 | 通过 | 第一轮新进程读取并追问，退出后第二个新进程恢复同一 Session ID、恢复上一轮内容、重新核验来源，直接保存 `intro.md`。不是崩溃恢复证明 |
| 运行中取消 | 修复后通过 | 成功 read 后第二个有限替身响应等待中发送真实 SIGTERM。取消结果 stopped，无 write 工具执行、无 `forbidden.md`，侧锁清除，进程退出后 Session 字节稳定；新进程恢复同一 Session ID 并保存 `recovered.md` |
| 11 个插件发现/编译/注册/禁用/卸载 | 通过 | 官方 Bun 编译和 OMP loader；每个包在独立临时副本中启用、禁用、物理删除；显式启用缺失包 fail closed。没有执行外部业务工具 |

原始命令（每条等待前一条结束）：

```sh
node scripts/setup-omp-runtime.mjs
node scripts/workspace-omp-install.mjs
npm run workspace -- --check

env -i PATH="$PATH" HOME=/tmp NO_COLOR=1 npm run build:omp

env -i PATH="$PATH" HOME=/tmp NO_COLOR=1 node --test --test-concurrency=1 \
  test/workspace-omp-cloud-acceptance.test.mjs

env -i PATH="$PATH" HOME=/tmp NO_COLOR=1 node --test --test-concurrency=1 \
  test/workspace-omp-local-environment.test.mjs \
  test/workspace-omp-local-entry.test.mjs \
  test/workspace-omp-local.test.mjs \
  test/workspace-omp-plugin-uninstall.test.mjs \
  test/workspace-omp-plugins.test.mjs \
  test/workspace-local-references.test.mjs \
  test/workspace-omp-unified.test.mjs \
  test/workspace-omp-local-budget.test.mjs \
  test/workspace-omp-local-wire.test.mjs
```

新增验收测试 **2/2 通过**。完整首轮回归 **57/58 通过**，唯一失败是卸载后缺失包诊断顺序（下文），修复后该套件独立 **1/1 通过**。最终将上面两条测试命令的文件合并为一条串行命令，**60/60 通过、0 失败、0 跳过**，结果见 `evidence/codex-cloud-final.tap`；最终源码的 `npm run build:omp` 也通过，11 个包的静态打包闭包、编译、原生发现和注册均成功。原本因 dot 原生锁受阻的两轮、插件恢复、物理卸载及 references 路径都在这里实际执行，不能用旧环境结论替代。环境回归里的 EPERM 是显式负向 stub，不能误读成本环境原生锁失败。

配置检查仍返回 `preflightReady:false` / `model-unconfigured`；默认 `offline-preview-ready` 的零退出只代表固定运行时/插件清单。持久能力的通过来自以上独立 Session/文件测试，不能改写成真实模型已可运行。

## 取消失败定位及最小修复

修改前真实 SIGTERM 使子进程以 **143** 退出，未生成取消结果，而且 `conversation.jsonl.lock` 仍存在。重现测试明确在原生 read 成功之后才发信号；失败断言为侧锁应该已不存在。首轮只检查退出码的断言随后修正为允许官方 143，但侧锁断言仍独立失败。

原因：原本本地入口只有自己的 `process.once(SIGTERM/SIGINT)`，官方 `pi-utils/src/postmortem.ts` 另有全局信号处理器，等待其已注册清理后调用 `exitProcess(143/130)`。入口没有加入该清理链，所以异步 abort/flush/finally 可能被硬退出抢先截断。

修复仅在 `scripts/workspace-omp-local.mjs` 使用同一固定上游模块的 `postmortem.register(..., {exitOnly:true})`：停止当前执行并等待原有 finally 完成 Session flush、dispose、文件选择清理和侧锁删除。正常完成注销回调，清理失败也解除等待。保留上游退出语义及其 10 秒退出清理上限；未修改 vendor、信号处理器、原生锁、sandbox、安全或网络设置，没有内存 Session 替代。

取消回归使用真实原生 Session/read/write 和原生产 local runner；只有模型输出是明确有限、可取消的替身。SIGTERM 时第二个替身调用已开始，待返回 write 尚未执行。安全恢复只证明该有限无账单场景的合作取消；付费请求中断后的账单核销仍未经真实验证。

## 卸载后缺失包诊断顺序

首轮 58 项回归唯一失败位于 `workspace-omp-plugin-uninstall` 的最后附加断言。七个业务包逐个移除后的新进程 Session 恢复、实际文件保存均成功；但显式选择已卸载 `workspace-procurement` 时，先导入旧 `workspace-omp-public-profile.mjs`，因本环境未安装可选 `@earendil-works/pi-tui` 返回 `ERR_MODULE_NOT_FOUND`，遮蔽了应有的 `WORKSPACE_PLUGIN_REQUIRED`。该失败不是原生锁失败。

最小修复将 `server/workspace-omp-session.mjs` 中既有选定业务包的解析/导入块移到旧 profile 导入之前，保留原导入条件、工具和权限检查。没有安装旧 Host/前端依赖，没有接入旧服务器。fixture 还增加了明确的错误代码/包名诊断断言。修复后原卸载套件 1/1 通过，包括七个缺失 profile 的准确拒绝、零替身请求及同一 Session 的七次物理卸载恢复。

## 插件逐个状态

以下每行的发现、编译、原生注册、禁用不再发现、物理卸载不再发现、缺失却启用时拒绝均独立通过。注册工具名称不代表对应服务可用。

| 插件 | 代码生命周期 | 本次业务连接 |
| --- | --- | --- |
| workspace-procurement | 全部通过 | 未配置 Host/业务客户端 |
| workspace-factory-materials | 全部通过 | 未配置 Library/成员授权/客户端 |
| workspace-factory-customers | 全部通过 | 未配置 Host/业务客户端 |
| workspace-factory-inquiries | 全部通过 | 未配置 Host/业务客户端 |
| workspace-factory-ingestion | 全部通过 | 未配置 Host/业务客户端；没有运行资料入库 |
| workspace-market-validation | 全部通过 | 未配置 Host/外部业务客户端 |
| workspace-shopify-product | 全部通过 | 未配置商店/授权/客户端；没有调用 Shopify |
| workspace-local-materials | 全部通过 | 仅明确选定合成文件和本地草稿；没有企业连接 |
| workspace-plugin-info | 全部通过 | 仅插件静态身份；不需要业务连接 |
| workspace-free-trade | 全部通过 | TED/SAM/ERPNext 未连接、未调用 |
| workspace-enterprise-context | 全部通过 | Host/Library/Docling/Mem0 未连接；Mem0 向量检索保持关闭 |

既有插件 suite 另外实际验证 Session 中禁用/重启用/共存/卸载；既有 uninstall suite 依次物理移除七个旧业务包并在新进程恢复同一 Session。编译/注册阶段业务工具执行为 0；合成文件验收只运行本地工具。其他回归使用有限进程内 HTTP/SSE 替身，没有新增外部 TED/SAM/ERPNext/Docling/Mem0/MCP/Muse/Shopify 调用。

## 真实模型、账单和未测项

只检查本次测试启动进程的变量**存在性**：`DEEPSEEK_API_KEY` 存在；`PI_PROVIDER`、`PI_MODEL`、`FASTAITOKEN_API_KEY`、`OPENAI_API_KEY`、`WORKSPACE_OMP_PROVIDER_COST_JSON`、`WORKSPACE_OMP_LIVE_BUDGET_VERIFIED` 不存在；项目 `.env` 不存在。没有读取密钥值、凭据文件或账户信息，没有从聊天索取 key、创建或配置凭据。此观察不代表其他进程或整个环境的配置状态。

- 真实模型请求 **0**，新增付费 **0**。有限模型及模拟 HTTP/SSE 结果不能称为真实模型或真实企业验收。
- 历史 DeepSeek 5 元不是当前授权。仍缺：原预算及核销截止时点、供应商余额和累计账单、每次历史请求（包括未知/中断请求）的请求标识/最终状态/实际 usage/费用、已用与剩余额度的完整对账。没有自动重试未知请求或以测试价格夹具替代真实账单。
- 未测：真实模型端到端、真实企业资料/客户隔离、真实外部服务业务、真实付费取消与核销、SIGKILL/掉电/崩溃恢复、跨进程原生锁争用安全。没有扩张为完整产品或生产验收。
- 没有 main 修改/合并、强推、部署、扩权、新 Agent Loop、数据库、队列、权限体系、资料入库或候选 Brain/Medusa 合入。

## 证据处理

完整安装输出、预检、配置存在性、修复前失败和修复后 TAP 保存在本地忽略目录 `evidence/codex-cloud-*`。Git 只包含本次最小源码修复、测试和说明；不包含 JSONL、合成产品、草稿、插件临时副本、运行日志或凭据。测试在临时目录实际写文件、核验后清理；磁盘写入与哈希断言保留在可复现测试中。

另用 `env -i PATH="$PATH" HOME=/tmp NO_COLOR=1 node evidence/codex-cloud-synthetic-run.mjs` 运行一次明确有限的两轮原生文件验收，保留可查看样本：`evidence/codex-cloud-synthetic/product.md`、`out/intro.md`、`out/factory-session.jsonl` 和 `receipt.json`。两轮各启动/退出一个新 Bun 子进程，Session ID 相同；共 4 个有限替身响应、0 真实请求。草稿 SHA256：`c44208424639ec0574f25ebbb9b19ca80f8870d78962e1b2b5af195deafa2115`。该目录和运行脚本均经 `git check-ignore` 确认不进入源码提交；不应在已存在目录上自动重跑覆盖。
