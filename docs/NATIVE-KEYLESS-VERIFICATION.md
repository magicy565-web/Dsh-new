# 原生 Harness 无费用验证记录

本轮对实际 DeepSeek Harness `0.2.0-rc.2` 源码与编译后的公开导出执行了本地验证。未提供真实 API Key，未请求模型服务、部署服务器或创建云电脑。结果证明应用适配的会话、工具与恢复协议可以运行；不证明生产运行环境已经就绪。

## 源码与构建范围

输入与 `backend/SOURCE-INFO.json` 一致：工作树 `bccf02f2636f7213be321d487aa763eb51396584`，14,285 个文件；源码归档 SHA-256 为 `f7ca9c1a8d4e5587be655868f7f21258bf9bee14ecee1eccf9b7853ed18ee421`。归档不在 GitHub 仓库内，本轮没有修改原生源码。

- 按源码锁定的 pnpm `11.7.0` 安装依赖，使用 `--frozen-lockfile --ignore-scripts`。
- 正式 `build:lib:host` **失败**：`packages/experimental/muse-worker/tests/queue-native.spec.ts:70` 的 `agent/error` 比较触发 `TS2367`。这项问题保留，未删测试或改为成功。
- 原生构建脚本的 `tsx` CLI 在本环境因 Unix socket 限制失败。使用规定的 `node --import tsx/esm` 可运行脚本，但 Node 安装不附带开发头文件。
- 为协议诊断，使用 Node.js 官方 `node-api-headers@1.9.0` 与原脚本相同的 Node-API v8 编译参数，编译主机 glibc flock 绑定；`native/system` TypeScript 构建通过。
- 使用原仓库 `tsdown.config.ts` 和生成的 Host JavaScript 完成诊断打包，供真实公开导出测试使用。此步骤不等于正式完整构建通过，未打包 DSH Web 页面，未发布运行包。

## 已验证的原生行为

| 检查 | 实际执行范围 |
| --- | --- |
| AgentLoop 与 JSONL | 原生循环、脚本化模型响应、同一会话跨重启保留 |
| 模型路由与工具循环 | 原生 SDK server 与 `llm-pi-ai`，本地截获的流与工具回执，同一会话恢复 |
| 完整原生恢复 | 原生会话、工具历史、附件与存储备份，权限隔离；恢复不重放旧任务 |
| 恢复导出加载 | 从明确的已编译 base manifest 加载公开包；验证原生历史与锁 |
| 原生 Muse Worker | 实际已编译导出，审核范围、领取身份、结果不可信标记、重启与停止确认 |

上述六项原来缺少源码/构建依赖而跳过的检查，本轮全部运行通过。工具执行与模型响应是明示的本地测试夹具；不得将其记录为真实海外研究或模型服务在线。

复现入口：在具备已审核原生依赖的机器设置 `DSH_TEST_SOURCE_ROOT` 后运行 `npm test`。单独检查可运行：

```sh
DSH_TEST_SOURCE_ROOT=/absolute/reviewed/deepseek-harness \
  node --test test/harness-provider.test.mjs test/native-relay.test.mjs \
  test/native-recovery.test.mjs test/worker-provider.test.mjs
```

## 尚未通过的上线条件

正式原生 Host 构建、目标主机执行档案与沙箱、真实模型路由及工具回执、持久云电脑会话与实际 Shopify 写入，仍须各自验收。当前不能标记为自动经营上线，也未启用按结果自动扣费。
