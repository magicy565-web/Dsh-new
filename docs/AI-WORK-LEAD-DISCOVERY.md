# AI-WORK：客户线索挖掘（平台首个通用 AI-work）

> 状态：后端领域 + 产品库接入 + HTTP 测试已实现（2026-10-21）；UI 页面与线索发现执行器为下一步。
> 本文是本模块的契约说明，不是"已上线运营"的声明。

## 1. 定位

`lead-discovery` 是平台第一个**通用 AI-work 产品**：

- 它被**发布到平台 AI-work 产品库**（`state.aiWorks.products`），有 revision、contentHash、发布人/时间、审计事件；目录 API 只暴露已发布版本。
- 它的输入是 **企业产品库中的精确产品版本**（`productId` → 服务端解析 `revision` + 产品对象 SHA-256）、目标国家、采购客户类型，以及可选的目标数量/预算/周期。
- 它的输出是一份**开发计划** + 一个**开发计划委托**；计划书同时保存为不可变 Artifact（Markdown + SHA-256）。
- 它**不调用模型**、**不伪造线索**：自动搜索只使用已配置的公开 API，并把结果作为"待人工审核候选"；没有配置或没有导入时保持 `awaiting_source`。开发信只有在**服务端配置外发 provider + 管理员逐封确认 + 退订/抑制检查 + 合规同意记录**后才会发送；默认未配置，草稿保持未发送。

## 2. 产品库集成（唯一事实源）

| 接入点 | 规则 |
|---|---|
| 输入 | `inputSchema.fields` 中 `type: "product_ref"` 的字段（首个产品为 `productId`，必填） |
| 解析 | 服务创建时注入 `lookupProduct`（生产环境 = 原 `businessLibrary.getProduct`）；只有宿主可信函数能提供产品 |
| 钉住 | 委托保存 `productRefs: [{field, productId, revision, sha256}]`；`sha256 = SHA-256(canonical(产品库记录))` |
| 计划事实 | `plan.productFacts`：name/category/description/SKUs（code、specs、MOQ、交期、pricingMode）/supply（packaging、samplePolicy、paymentTerms、shippingTerms、capacityNote）/documents/images 数量/来源类型 |
| 缺项 | `productFacts.missingFields` 明确列出缺失字段；`factCompleteness = complete/partial/incomplete`；计划里写"需在产品库补齐"，**不猜测** |
| 归档/不存在 | 产品 `archived` → `PRODUCT_ARCHIVED`；不存在 → `PRODUCT_NOT_FOUND`；产品库未接入 → `PRODUCT_LIBRARY_UNAVAILABLE` |
| 版本漂移 | 产品库后续升级不会改变已有委托；新委托按当时读取的精确 revision 钉住 |

## 3. 输入 → 委托 → 计划

```
POST /api/ai-works/lead-discovery/delegations
{ requestId, productId, targetCountry, buyerType,
  productScope?, targetCount?, budgetCredits?, deadlineDays?, notes? }
```

生成计划内容（确定性 playbook `lead-discovery-playbook-v1`，不依赖模型）：

- **市场**：国家解析（46 个预置市场，中英文/ISO 输入；未知市场降级并标记）、语言/币种/区域、冷邮件合规策略（allowed / notice_and_objection / consent_required，德国等为 consent_required）。
- **买家画像**：10 类预置采购客户类型（进口商/分销商/经销商/批发商/连锁零售/品牌商/电商卖家/工程承包商/OEM 采购/贸易公司），含定义、决策角色、采购信号、排除条件；未知类型降级为通用模板并标记。
- **发现计划**：搜索 query（含国家域名扫描/展会/扩张新闻/人工 LinkedIn 辅助/可选海关数据）、数据源可用性（客户授权导入、公开搜索、企业登记、展会名录、付费海关数据、LinkedIn 仅人工）、去重键、质量闸门。
- **工作流**：受理 → 产品库精确版本核对 → 生成计划 → 人工计划审批 → 首批发现 → 背调取证 → 人工审核 → 开发信草稿 → 周报；每步有 owner（agent/human）与 D+天数。
- **交付物/验收/审批闸门/风险/开放问题/SLA/预算**。
- **产品事实**：见第 2 节；缺项写进 notes/risks。

## 4. 状态机与不变量

| 对象 | 状态 | 说明 |
|---|---|---|
| 委托 | `draft → approved / cancelled` | approve 仅 admin；cancel 仅 draft；非法迁移 `INVALID_STATE` |
| 执行 | `not_started → awaiting_source / completed / failed` | 审批后可导入授权线索；无任何输入时执行返回 `awaiting_source` 并明确说明"不生成线索"；`completed` 表示线索已入库并完成规则评分 |
| 候选线索 | `needs_review → qualified / rejected` | 仅待审核可审核；必须人工理由；重复 requestId 幂等 |
| 开发信草稿 | `draft → approved / rejected`，approved 可 `sent` | 只有合格线索可生成；`sent` 只在 provider 接受后为 true；批准/拒绝均需理由或确认；发送需 admin + `confirmed:true` + 退订/抑制/占位符/同意检查 |
| 计划书 | Artifact（不可变） | 创建委托时生成；失败不阻断委托（计划正文已在委托内） |
| 产品 | `published → retired` | 版本化；目录只列 published 的最新 revision |

### 4.1 执行管线（P1：授权导入 + 自动搜索）

执行支持两类来源：**客户授权导入**（始终可用）与**自动搜索/企业登记**（配置 API key 后可用）。

```
approve 委托 → execute
  ├─ 有配置的 Serper / Companies House：按计划 query 自动搜索 → 结果转候选（来源 URL + 摘要 + 抓取时间）
  └─ 无自动源：只使用已导入的客户授权线索
→ 去重 + 规则 fit score → 待审核队列 → 人工 qualified/rejected
```

导入列（CSV 表头 / JSON 字段同名）：

| 列 | 必需 | 规则 |
|---|---|---|
| `companyName` | 是 | 2–180 字符 |
| `website` | 是 | 公开 http(s) 域名（拒绝 IP/localhost/凭证 URL） |
| `sourceUrl` | 是 | 公开 HTTPS 来源 |
| `sourceExcerpt` | 是 | ≥10 字符逐字摘录 |
| `sourceFetchedAt` | 是 | 明确日期/带时区 ISO；落库为 ISO |
| `country` / `buyerType` | 否 | 用于国家/采购类型匹配评分，缺项进入 missing |
| `contactName` / `contactTitle` / `contactEmail` | 否 | 邮箱做格式校验；缺邮箱降低评分 |
| `notes` | 否 | ≤1000 字符 |

- 逐行拒绝并返回行号与原因：未知字段、非法 URL、缺摘录、缺日期、非法邮箱、跨行/跨批次重复（域名或公司名去重）、超限。
- 单次最多 100 行 / 64 KiB；单委托最多 300 条候选；平台候选总量上限 5000。
- `fitScore`（0–100，规则透明）：产品相关 25 + 目标国家 20 + 采购类型 15 + 有邮箱 15 + 有官网 10 + 来源证据 15；缺项写入 `missingFields`，不使用黑盒模型。
- 执行器可用性：`GET /api/ai-work-sources` 返回 `authorized_import`（available）、`serper`/`companies_house`（`available`=已配置 key，`unconfigured`=未配置）。自动源未配置时不会产生任何线索。
- **自动搜索结果**：每个 query 最多 10 条；只保留 HTTPS 来源且摘要 ≥10 字符的结果；公司名/域名去重；自动结果 `source.kind=serper|companies_house`、证据包含来源 URL/摘要/抓取时间，进入 `needs_review`。Companies House 结果带登记编号，`country=英国`，不生成邮箱/联系人。
- **失败与部分失败**：全部 query 失败 → `execution.status=failed` + `lastError`（含 provider HTTP 状态），不写候选；部分成功 → `completed` 并保留 `lastError`；零结果 → `completed` + 原因，不伪造。
- 单次执行最多 3 个 query、每个源；人工审核仍是唯一合格判定。

### 4.2 开发信草稿与发送

合格线索 → `POST /api/ai-work-candidates/:id/drafts` 生成**未发送**开发信草稿：

- 语言：默认按目标市场语言（当前支持 `en`/`de`；其他市场回退英文并给出警告；也接受显式 `language`，非法值 400）。
- 内容只来自：产品库 `plan.productFacts`（MOQ/交期/包装/样品/付款/运输/产能）、候选线索的首条证据（来源 URL + 逐字摘录 + 观察日期）、已确认的买家/市场信息。
- 固定为 `sent:false`、`humanReviewRequired:true`、`externalSend:'not_implemented'`；签名/地址/退订为 `[...]` 占位符，必须人工填写。
- 合规：`compliance.consentRequired`（如德国 UWG §7）、`optOutRequired:true`；产品事实缺项写入 `warnings`，不猜测。
- 生命周期：`draft → approved`（admin，`confirmed:true`）/ `rejected`（operator/admin + 理由）；拒绝后可用新 requestId 重新生成（revision+1）。**只有 draft 状态可编辑**（`PATCH /api/ai-work-drafts/:id`，替换占位符后 revision+1，需要重新审批）。
- 一个线索同时只保留一个草稿；同 requestId 同内容幂等、不同内容 409；候选不再是 qualified 时禁止批准。

**发送（默认 fail-closed）**：`POST /api/ai-work-drafts/:id/send`，仅 admin：

- 服务端必须配置 `OUTREACH_PROVIDER`（`resend` / `postmark`）、对应 API key、`OUTREACH_FROM_EMAIL`（可选 `OUTREACH_FROM_NAME`、`OUTREACH_REPLY_TO`）；未配置 → 503 `OUTREACH_NOT_CONFIGURED`，草稿保持未发送。
- 发送前检查：草稿 approved、线索 qualified、候选有合法企业邮箱、邮箱/域名不在退订/抑制名单、正文无 `[...]` 占位符、正文含 HTTPS 退订/隐私链接；目标市场要求同意时必须 `consentConfirmed:true` + `consentBasis`（≥5 字）。
- provider 接受后才写入 `sent:true`、`sentAt`、`sendReceipt{provider,messageId,to,at,consentBasis}`、`externalSend='provider:<name>'`；同 requestId 重试幂等，已发送后换 requestId → 409 `ALREADY_SENT`。
- **双人审批（可选）**：`AI_WORK_DUAL_APPROVAL=true` 时，审批人与发送人必须是不同 admin；同一 admin 发送 → 403 `DUAL_APPROVAL_REQUIRED`；`GET /api/ai-work-outreach` 返回 `dualApproval`。
- provider 失败 → 502 `OUTREACH_PROVIDER_ERROR`，不写 sent、不改状态；失败写入 `sendAttempts`（最多 20 条）与 `lastSendError`，可用新 requestId 重试。
- `GET /api/ai-work-outreach` 同时返回 `stats`：`sent`、`attempts`、`failedAttempts`、`lastError`、`providers` 计数。
- 退订/抑制：`GET/POST /api/ai-work-suppressions`、`POST /api/ai-work-suppressions/:id/remove`（表单字段 `email` 或 `domain` + `reason`，仅 admin 可写）。

安全/正确性：

- 发布产品、审批委托：**仅 admin**；建立委托：operator/admin；viewer 只读。
- `requestId` 幂等：同内容重试返回原记录（`duplicate:true`）；同 ID 不同内容 `IDEMPOTENCY_CONFLICT`。
- 上限：产品 1000 条、委托 2000 条、审计事件 4000 条；输入严格 allowlist + 长度/范围校验。
- 持久化：沿用 `server/store.mjs` 单写者原子事务；`state.aiWorks` 缺失时旧快照仍合法，首次启动懒初始化。
- 不做：不调用模型、不伪造联系人、不写产品库、不修改产品事实；除显式管理员发送已批准草稿外不发生外发。

## 5. API

| Method | Route | 说明 |
|---|---|---|
| GET | `/api/ai-works` | 已发布产品目录 + 注册表状态 |
| GET | `/api/ai-works/status` | 计数与产品库是否接入 |
| GET | `/api/ai-works/:id` | 产品定义 |
| POST | `/api/ai-works` | 发布/升级产品（admin） |
| POST | `/api/ai-works/:id/delegations` | 建立开发计划委托（operator/admin） |
| GET | `/api/ai-work-delegations` | 委托列表 |
| GET | `/api/ai-work-delegations/:id` | 委托详情 |
| GET | `/api/ai-work-sources` | 数据源可用性（授权导入 available；Serper/Companies House 配置 key 后 available） |
| POST | `/api/ai-work-delegations/:id/candidates` | 导入客户授权线索（CSV/JSON，逐行校验、去重、评分） |
| GET | `/api/ai-work-delegations/:id/candidates` | 候选线索列表（含证据、评分、审核状态） |
| POST | `/api/ai-work-delegations/:id/execute` | 执行规则评分；无输入时返回 `awaitingSource`，不生成线索 |
| POST | `/api/ai-work-candidates/:id/review` | 人工审核：qualified/rejected + 理由（operator/admin） |
| POST | `/api/ai-work-candidates/:id/drafts` | 生成未发送开发信草稿（合格线索；语言 en/de） |
| GET | `/api/ai-work-delegations/:id/drafts` | 委托下的草稿列表 |
| GET | `/api/ai-work-drafts/:id` | 草稿详情 |
| PATCH | `/api/ai-work-drafts/:id` | 编辑待审批草稿（替换占位符；revision+1，需重新审批） |
| POST | `/api/ai-work-drafts/:id/approve` | 审批草稿（admin，`sent:false` 不变） |
| POST | `/api/ai-work-drafts/:id/reject` | 拒绝草稿（operator/admin + 理由） |
| GET | `/api/ai-work-outreach` | 外发通道配置状态 + 抑制名单摘要 |
| POST | `/api/ai-work-drafts/:id/send` | 发送已批准草稿（admin；provider 接受后才 sent=true） |
| GET | `/api/ai-work-delegations/:id/export/candidates` | 候选 CSV（来源/摘录/评分/状态） |
| GET | `/api/ai-work-delegations/:id/export/drafts` | 草稿 CSV（语言/revision/状态/sent/回执） |
| GET | `/api/ai-work-delegations/:id/events` | 委托审计事件（最近 100 条，倒序，JSON） |
| GET | `/api/ai-work-delegations/:id/export/events` | 委托审计事件 CSV |
| GET | `/api/ai-work-suppressions` | 退订/抑制名单 |
| POST | `/api/ai-work-suppressions` | 新增抑制（email 或 domain + reason，admin） |
| POST | `/api/ai-work-suppressions/:id/remove` | 撤销抑制（admin） |
| POST | `/api/ai-work-delegations/:id/approve` | 审批（admin） |
| POST | `/api/ai-work-delegations/:id/cancel` | 取消 draft（operator/admin） |

## 6. 代码位置

| 文件 | 内容 |
|---|---|
| `server/ai-works.mjs` | 产品定义校验/发布、注册表校验、国家与买家类型 playbook、开发计划生成、委托与执行服务（授权导入/评分/审核）、HTTP 映射 |
| `server/store.mjs` | 可选 `state.aiWorks`（products/delegations/candidates/events）的 fail-closed 校验 |
| `server/index.mjs` | 创建服务（注入产品库 lookup + 数据源环境）、启动时发布首个产品、GET/POST 路由 |
| `server/access.mjs` | 路由审计标签与 operator 可写路径 |
| `test/ai-works.test.mjs` | 领域/持久化/权限/幂等/产品库绑定/合规/执行管线/自动搜索适配器/草稿/发送/抑制名单/双人审批/CSV 导出/损坏 fail-closed（22 个用例） |
| `test/ai-works.http.test.mjs` | 真实 createApp + HTTP + 重启 + 工件下载 + 执行管线 + 自动搜索 + 未发送草稿 + 外发发送 + 双人审批 + CSV 导出（9 个用例） |
| `test/ai-works-ui.dom.test.mjs` | 生产 bundle + 真实 HTTP + JSDOM：完整闭环（含草稿编辑/发送/导出）、产品库为空、自动源、产品发布、草稿发送（5 个用例） |

## 7. 验证命令

```powershell
$node = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
cd G:\workspaceV1\repo
& $node --test test/ai-works.test.mjs test/ai-works.http.test.mjs test/ai-works-ui.dom.test.mjs
& $node node_modules/typescript/bin/tsc --noEmit
& $node node_modules/vite/bin/vite.js build
```

## 8. 未完成 / 下一步

1. **自动搜索与真实外发 L3 验收**：代码与注入式测试已通过；真实 Serper / Companies House / Resend / Postmark 账号、网络白名单与 provider 条款尚未执行（L3 not-run）。
2. **发件域名与合规**：生产环境仍需配置发件域 SPF/DKIM/DMARC、退订处理与隐私政策；德国市场需事先同意记录。
3. **产品库联动展示**：委托详情显示产品库 readiness；产品库升级时提示"有新版本可用"；缺口一键跳产品库补齐。
4. **产品发布 UI**：目前首个 AI-work 由服务启动发布，后续产品/版本发布走 admin API；运营台可补发布表单。
5. **多运营成员审批流**：可选双人审批（`AI_WORK_DUAL_APPROVAL=true`）已支持；成员管理 UI、审批历史导出的表格视图仍未做（原始事件可通过 CSV 导出）。

## 9. UI（已实现，2026-10-21）

部署/环境变量/L3 验收清单见 [AI-WORK-DEPLOYMENT.md](./AI-WORK-DEPLOYMENT.md)。
- 路由 `/aiworks`（导航「AI 工作」）：产品库产品选择器（显示 revision/品类）→ 目标国家 + 采购客户类型 + 目标数量/周期/备注 → 生成开发计划委托 → 计划书预览（产品事实/SHA-256/市场合规/买家画像/搜索 query/数据源/工作流/交付物/验收/风险）→ 审批 → **导入客户授权线索 → 逐行校验/评分 → 人工审核合格/剔除 → 生成未发送开发信草稿 → 审批草稿 → 执行** → 委托列表。
- 真实状态：loading skeleton / 加载失败重试 / 产品库为空（明确提示先建产品，不造假）/ viewer 只读 / **AI-work 产品选择器（平台产品库中已发布产品，含 revision）** / **委托列表搜索（产品/国家/买家类型/状态）** / **委托状态筛选（全部/待审批/已批准/已取消）** / 待审批→已批准/已取消 / 执行 `未开始→等待数据源→已完成/失败` / 候选 `待审核→已合格/已剔除` / 草稿 `待审批→已批准→已发送/已拒绝` / **数据源就绪徽标（授权导入、Serper、Companies House）** / **外发运营概览（已发送/尝试/失败/抑制/通道/Provider 调用 + 失败草稿一键打开）** / **产品库 readiness 与"新版本可用→用新版本新建委托"** / **候选/草稿/审计事件 CSV 导出** / **委托审计事件时间线（按审批/执行/草稿与发送筛选）**。
- 测试：`test/ai-works-ui.dom.test.mjs`（生产 bundle + 真实 HTTP + JSDOM，2 用例）；真实浏览器探针 `scratch/aiworks-ui-probe.mjs`（Edge/Chromium，390/1440 无横向溢出，截图 `evidence/aiworks-page-390.png`、`aiworks-plan-390.png`、`aiworks-execution-390.png`、`aiworks-candidates-390.png`、`aiworks-draft-390.png`、`aiworks-page-1440.png`）。

