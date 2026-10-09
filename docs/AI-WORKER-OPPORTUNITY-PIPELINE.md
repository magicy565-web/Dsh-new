# AI Worker → 企业商机池（V1）

AI Worker 不能仅凭一段“研究完成”的文字声称产生客户。核心业务链路：

企业目标 → 经审批的第三方 Worker → 带官网与来源的结构化候选名单 → 人工验收 → 版本化工件 → 显式导入商机池 → 人工资格判断。

## 已实现

- 未经人工验收、未在 Artifact 系统存档的经销商研究报告不可导入商机池。
- 每条商机保留来源任务 ID、原始行索引、工件 ID、公开官网、匹配理由和来源 URL。
- 按标准化公司名称 + 官网域名去重，同源或跨任务重复导入不会制造虚假独立线索。
- 导入请求 ID + 来源行集合构成幂等指纹；相同提交安全复用原记录，不同内容复用 ID 则拒绝。
- 单次最多导入 100 条，单企业最多保存 5,000 条，审核批次和备注都有上限。
- 管理员可标记 qualified/rejected、保存备注；其中 qualified 必须给出人工判断理由；资格判断仍保留“第三方声称，人工复核”的来源标识。
- 任何导入或资格判断都不会自动发信、联系客户、修改报价或生成实际订单。
- 复用已有 Workspace 单写者持久化存储、企业访问、CSRF 和审计框架。

## API

GET /api/worker-opportunities：列出企业商机。
GET /api/worker-opportunities/:id：查看商机。
POST /api/worker-orders/:id/promote：管理员导入已验收报告中指定 indices，要求 requestId 和 confirmed=true。
POST /api/worker-opportunities/:id/review：管理员执行 qualified/rejected，要求 confirmed=true，notes 不超过 1000 字。

## A2A SDK 网络安全

server/worker-a2a-host.mjs 使用官方 A2A JS SDK 的 JsonRpcTransportFactory。固定单个审核的 HTTPS JSONRPC 端点，明确拒绝 URL 变化、非 POST、HTTP 重定向、大请求和大响应。

应用层固定 URL 不能防止 DNS rebinding。生产端必须配置真正的网络出站限制和供应商身份鉴别。字符串形式的 reviewed budget reference 不能替代外部可强制的付款硬上限。

## 验证命令

node --test test/worker-opportunities.test.mjs test/worker-opportunities.http.test.mjs
node --test test/worker-a2a-network.test.mjs test/worker-a2a-host.test.mjs
npm run typecheck && npm run build && npm run test:all
node test/worker-opportunities.browser.mjs

上述 HTTP 测试使用隔离的模拟 Worker 适配器，不表示真实买手名单。桌面和移动端截图由浏览器测试写入 evidence/browser。GitHub Actions 当前存在 startup_failure，完整构建/视觉验收尚未确认。

首个真实合作方接入、供应商身份、预算硬上限、数据隔离仍然是正式上线的阻塞项。

## V2 客户选择与分批导入

- 在已验收的经销商工作单中，企业管理员可以逐条勾选要推进的候选公司；未勾选的数据仍留在交付成果中，并不会进入商机池。
- 每次导入保存精确的原始 `indices` 与 `requestId`，同一任务可以在不同批次导入不同客户，已导入的来源行会在任务详情中显示“已导入商机池”。
- 前端对网络超时后的同一批次保留相同请求 ID，以免重复扣账或重复导入。后端继续用单写者原子事务、幂等指纹与公司/官网去重保护真实商机数据。
- 此操作只变更本企业 Workspace 的内部商机记录，不会对外发送信息，也不是销售资格验证。
