# AI Worker V1.1 · A2A 远程执行接入

本模块已经集成现有单企业 Workspace：服务前端、任务委托、审批、远端 SDK Client 接入和验收后持久化。没有重新开发 Harness、DAG 引擎或 Personal Agent。

## 接入结构

- server/worker-a2a-host.mjs：服务器启动时，读取并验证审核者维护的 Partner Registry；无配置即不加载 SDK、不读取密钥、不调用远程 API
- server/worker-a2a-adapter.mjs：官方 A2A JavaScript SDK v1 Task Client（发送/读取/取消），不自研协议
- server/worker-desk.mjs：业务委托、范围审批、幂等、预算检查、人工验收
- server/artifacts.mjs：人工验收时，把第三方报告作为不可执行且版本化的 JSON 回执保存并供下载

**此功能不代表 Muse / Grokbot / Dot 已经发布了可用 A2A API。** 只有供应商提供合法任务 Endpoint、账户授权及实际费用硬限额后，才能联调真实业务。

## 主机配置步骤（默认关闭）

1. 在受审核 Linux/POSIX Node.js 24 主机安装并锁定官方 A2A SDK v1：@a2a-js/sdk（https://github.com/a2aproject/a2a-js）。基础源码尚未把可选 SDK 依赖视为已经安装。
2. 从明确授权的第三方 Worker 获取并独立审核 Agent Card，保存至 /etc/workspace-agent/partner-agent-card.json；单个固定 HTTPS JSONRPC v1 URL，不接受 IP/localhost/非 HTTPS 或多端点切换。
3. 用权限 0600 保存 Partner Registry JSON，示例：

```json
{
  "version": 1,
  "workers": [{
    "id": "us-research-partner",
    "name": "经销商研究顾问",
    "serviceIds": ["buyer-discovery"],
    "endpoint": "https://reviewed-worker.example.com/a2a",
    "agentCardFile": "/etc/workspace-agent/partner-agent-card.json",
    "agentCardSha256": "INSERT_REAL_SHA256_64_LOWER_HEX",
    "tokenEnv": "WORKSPACE_WORKER_US_RESEARCH_TOKEN",
    "enabled": false,
    "review": {
      "partnerVerifiedRef": "verified-partner-reference",
      "budgetHardCapVerifiedRef": "verified-hard-cap-reference",
      "reviewedBy": "approved-operator"
    }
  }]
}
```

所有示例均保持 enabled=false；真实上线必须独立审核**Partner 身份与签名、出站网络白名单、账户端可强制执行的费用上限**。文字 reference 不是实际费用保证，不能把它们当成硬额度。

4. 在最终宿主机的安全凭据配置中设置：

```text
WORKSPACE_A2A_REGISTRY_FILE=/etc/workspace-agent/worker-registry.json
WORKSPACE_A2A_REGISTRY_SHA256=审核后的登记文件 SHA-256
WORKSPACE_WORKER_US_RESEARCH_TOKEN=宿主机私有凭据（不要写入仓库或聊天）
```

5. 只有独立验证以上事项之后，管理员才允许改为 enabled=true，重新计算 Registry SHA-256，重启应用。缺少任何校验将导致 fail-closed 阻断，用户页面无法安装任意外部执行代码或修改凭据。

## 已连接时任务如何执行

用户选择服务 → 输入产品/市场/目标 → 勾选允许共享的公开信息 → 管理员确认执行者、预算及期限 → A2A SDK 发送带身份信息的 Durable Task → 读取真实远端任务状态 → 回传带来源证据的 schema 校验成果 → 管理员验收 → 本地生成工件回执并允许下载。

**不会从远端无条件下载/执行文件。** JSON 回执含 workerOrderId 和 externalClaimsIndependentlyVerified=false；人工点击验收只表示审阅同意，不等于实质销售已经发生。

未知提交回执会进入 dispatch_uncertain，不自动补投；取消请求需对方真实确认；超支时阻止正常验收。企业私有历史 RFQ/询盘仍无法通过 public-only Worker 服务提交。

## 验收和已知阻塞

```sh
node --test test/worker-a2a-host.test.mjs test/worker-a2a-adapter.test.mjs test/worker-delivery-artifact.test.mjs test/worker-desk.test.mjs
npm run typecheck
npm run build
npm run test:all
npm run test:browser
```

在编写阶段运行的本地模拟 SDK 主机连接测试不能替代真实外部 Agent 调用。当前仍缺：真实供应商账号/密钥、账户侧可审计费用硬额度、Agent Card 签名及网络隔离验证、Node24 构建和实际浏览器回归；原 GitHub Actions 工作流曾报 startup_failure。

## Buyer discovery: structured prospect schema (not just a chat summary)

For buyer-discovery, a completed A2A Task may attach a DataPart using
schema = workspace.worker.delivery.v1 and matching orderId. Its
prospects array contains up to 100 independently reviewable entries:

```json
{
  "schema": "workspace.worker.delivery.v1",
  "orderId": "EXACT_APPROVED_ORDER_ID",
  "deliverables": [{"name":"Buyers","type":"table","summary":"Publicly sourced candidates"}],
  "evidence": [{"title":"Buyer web page","url":"https://buyer.example.com/about","detail":"Company overview"}],
  "prospects": [{
    "name": "Buyer Example",
    "country": "United States",
    "website": "https://buyer.example.com",
    "fitReason": "Company lists textile wholesale products",
    "sourceUrl": "https://buyer.example.com/about"
  }]
}
```

For buyer-discovery, summary-only reports **cannot** enter the review_required state: at least one source-backed structured prospect and supporting evidence are required. This is a minimum schema gate, not proof that a user's requested quantity (such as 20) has been fulfilled; the reviewer must check completeness.

Server validates field allowlists, public HTTPS domains, lengths and duplicate
company/domain entries. Records remain flagged independentlyVerified=false.
Reviewers can inspect these candidates in the Work Order and download the same
structured entries inside the accepted JSON artifact. There is no automatic
email sending, CRM mutation, invented revenue or hidden direct contact.
