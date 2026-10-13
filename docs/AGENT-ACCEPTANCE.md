# PR60 统一 Pi Agent 接入验收（2026-10-13）

## 当前状态

**开发代码已提交；组合运行和独立审查尚未完成。不得作为生产发布凭据。**

- 唯一集成 PR：[PR60](https://github.com/magicy565-web/workspace-agent/pull/60)。初始基线 PR59 `18cc80aca0f88a68fb96d2f1d960897f8a48dac2`，后通过双父提交 `9f808f202ce825a2ab647f11456eb5dbcf8fe76e` 同步 PR59 的原生 Host/Muse 新修复 `32c8ce98fe28cda1e22a16bf0d1088c768e081c8`，且未覆盖其源码；新组合仍未运行完整回归。
- 选择性来源：PR47 `1e0cc43d973b5d10861561f2cd4979065d5f33f6`。
- 本次的代码边界、唯一权威和部署限制见 [AGENT-UNIFIED-HANDOFF.md](AGENT-UNIFIED-HANDOFF.md)。
- 未重建商城/供应商库/计划/通知、模型循环、商业 Task Store 或另一个后端；PR59 是业务和界面权威。

## 本轮实际检查（不等于完整测试）

- 源码通过已连接 GitHub 进行修订，分支有远端固定提交和新文件。
- 关键共享 JavaScript 的源码锚点、语法及 GitHub 文件 SHA 已校验；保留原 Host Session、MCP、供应商 revision/取消、Shopify、GA4 和通知模块。
- 补入此前漏带的 `scripts/agent-retention.mjs` 和 `test/fixtures/agent-service-child.mjs`，解决 Agent 测试的确定性缺失依赖。
- 将旧用例的根 `/health` 预期改为**原 Workspace Host 根路径不被 Agent 接管**；Agent JSON health 位于 `/api/agent/v1/health`。
- 新增 `test/agent-unified-host.http.test.mjs`，明确要求 API 默认关闭；开启后只通过原单 Host、原企业成员 scope 和原 Workspace Store，且不会卸载已有供应商/通知服务。
- 增加 Agent Bearer 与原 Dot/Muse/采购 Worker token SHA-256 的跨范围碰撞拒绝规则及普通测试。对应 Node 回归仍待实际运行，不能以代码提交冒充通过。
- 新 `test/agent-service.acceptance.mjs` 只会运行当前源码的构建与回归，并将新原始日志写入临时隔离目录。无独立审查回执时无条件标记 `release_blocked`、退出非零。

**所有新增的 Node 测试均尚未在此候选上实际运行**。静态语法检查不能替代 Node 24、Pi Durable、SQLite、HTTP 或微信运行时测试。

## 下一次真实测试必须运行

从 PR60 最新固定提交（不是 PR47 或 PR59 的旧源码包）在具备 Node 24 / Python 的授权工作区执行：

```bash
npm ci --ignore-scripts
npm run build
npm run build:mini
npm run test:agent
npm run test:agent:client
npm run test:all
npm run test:agent:acceptance
```

本次 `test:agent:acceptance` 即使其他命令都通过，也应在独立审查签署前以 `release_blocked` 退出 1。保留完整 stdout/stderr、准确 commit、单项退出码。无需为了令 runner 变绿而绕过源文件审查检查或删除历史失败。

## 必须逐项确认的集成断言

1. Agent 未启用时，原 Workspace `/api`、原 Host Session、Shopify 草稿、GA4 及通知不受影响。
2. 新 Agent 的任务必须属于原 Workspace Store，原 Runtime/Pi 是唯一模型/工具/队列及检查点权威；投影 SQLite 只保留可重建读视图。
3. 两个企业成员不能交叉读取彼此的任务、Pi runs、事件、文件和源会话。
4. 预设研究工具只读且需真实来源，不能直接创建/发布商品、激活七天计划、替人审批或发送通知。
5. 同键重复、失去 HTTP 响应后的只读找回、Pi 检查点恢复和半完成文件保存经真实 Node/本地 HTTP 验证。
6. **P1：** Pi 策略版本及 endpointFingerprint 变化可能使旧的未结束 run 无法恢复；先做兼容审查，不能偷偷重跑、重建或清除旧任务。
7. 原 `managed-commerce` 旧源码校验已更为扩展源码范围保留历史证据，不能替代当前供应商/Shopify/通知/Agent 的独立安全批准。

## 尚未实测

- GitHub Actions 仍在初始化阶段 `startup_failure`，无 job、无服务器 CI 通过证据。
- 当前 PR60 没有实际最新 Node 24 / Python 全量回归完成回执。
- 没有真实认证 Host、真实 Muse/ChatGPT Dot task、生产 Pi 模型、Shopify、GA4、WeChat 设备或完整七天外部通知回执。
- 没有合并 main、发布 Shopify 产品、付费模型调用或生产部署。

PR47 历史测试数只是 PR47 的原始旧提交证据，不再写成 PR60 已通过。
