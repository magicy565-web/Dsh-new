# Cloud Workers · 云端专家团队 V1

这次产品调整将企业 Workspace 的默认入口从单一增长服务目录改为**云端 AI 专家中心**，参考 WorkBuddy 官方公开的「专家」「专家团」概念，但保持自身的独立执行器架构。

## 交互与信息架构

- /workers —— 云端专家中心（默认首页）；8 个经审核的企业岗位模板、3 套协作团队模板。
- /services —— 原来的标准增长任务单和商机池，保留为专家的执行场景。
- 专家市场：筛选领域、阅读岗位方法、职责与交付定义。
- 配置专家：岗位名称、责任边界、技能标签、允许的标准服务、已审核执行器、单任务 Credits 上限；不提供任何自由 URL/Token 输入。
- 我的专家：查看未绑定/已登记执行者，修改岗位并记录 revision，避免旧页面覆盖新配置。
- 组建团队：选择团长与 1–5 名不同角色成员、最高作战指令、项目总预算、单项任务费用上限。
- 查看分工：展示每个专家的拟执行服务、产物与额度，同时列出缺失的云执行器 / 原生 Harness DAG；此操作**只读、绝不启动任务**。
- 已绑定专家：可通过现有 /api/worker-orders 创建公开数据的单专家待审批任务单。第三方派发仍由已有管理员批准、预算核对和显式 dispatch 执行。

## 架构：Role ≠ Worker ≠ Skill ≠ Team

* Role / Expert = 业务岗位配置。它保存在企业 Workspace store 内，包含职责、技能标签、服务范围与单次 Credits 上限。
* Worker = 通过 server/worker-a2a-host.mjs 或已有可审核执行器注册表提供的真实执行身份；只有 workerDesk.catalog() 确定 ready 且 budgetEnforced 的执行者允许绑定。
* Skill = 已列明的专业能力标签。并不直接授权 MCP 工具或云电脑控制权。真实可执行工具仍由现有 connector/approval 控制面授权。
* Team = 经过配置的多个 Role 和一个 Leader，记录项目预算和静态拟定工作分工。**不是**已经创建并运行的并行任务 DAG。
* Service Order = 已有真实 Worker 业务任务状态机，保留租约、幂等、证据审查、远端不确定状态和取消确认。

**不要**将 Team 的草稿配置冒充已启动的多 Agent 云执行，也不要在这个模块自己重写 Native Harness DAG。

## 数据结构

V2 现有 Workspace STORE_VERSION 不变；新增两个可选的持久集合，旧有 v2 数据无需转换：

- cloudExperts[]：id、templateId、alias、mission、serviceId、workerId、skills[]、maxCredits、dataScope=public_only、revision、创建者/时间和 requestId 指纹。
- cloudTeams[]：id、templateId、leadId、memberIds[]、mission、budgetCredits、taskCeilingCredits、revision、创建者/时间和 requestId 指纹。

一切变更使用 store.update 原子持久化和已有单写者锁，基于 requestId 实现新增幂等，PATCH 更新要求 expectedRevision。所有配置操作仅开放给企业管理员。

## API

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | /api/cloud-expert-catalog | 公开的模板、团队组合、技能及审核执行器选项 |
| GET | /api/cloud-experts | 企业已配置专家 |
| POST | /api/cloud-experts | 聘请并配置专家（管理员） |
| GET | /api/cloud-experts/:id | 查看岗位和真实绑定状态 |
| PATCH | /api/cloud-experts/:id | 受版本保护的岗位修改（管理员） |
| POST | /api/cloud-experts/:id/delegate | 经绑定后通过 WorkerDesk 创建**待审批任务单**（管理员；不会派发） |
| GET | /api/cloud-teams | 企业已配置团队 |
| POST | /api/cloud-teams | 配置专家团（管理员） |
| GET | /api/cloud-teams/:id | 查看团队 |
| PATCH | /api/cloud-teams/:id | 受版本保护的团队调整（管理员） |
| GET | /api/cloud-teams/:id/plan | 只读拟定分工、费用上限、执行阻塞原因 |

### 安全规则

- 未绑定已审核 Worker 的专家允许保存设置，但不允许委托任务。
- 绑定执行器必须在固定服务 allowlist 中，后端独立核查，不信任前端选择。
- 历史询盘等私有数据专家可配置岗位，但由于企业私有资料隔离未接通，不能为它分配公开研究服务或执行私有任务。
- skill 标签不授予真实插件权限；外部消息、文件写入、支付、登录云电脑一律不在此模块静默授权。
- 项目总预算与单项上限目前用于配置/计划，不等于对多个云执行任务实施了总额资金预留。真正并行 DAG 执行之前必须接入已有 Native Harness / Budget control。
- Team 的 plan 显示 planningOnly=true、runnable=false，明确给出缺失条件。没有假进度、假在线状态或假已完成工作。

## 完整专家档案与实际工具状态

岗位模板现具有 8 种原生 SVG 角色图标与后端统一的专业作业规范，不再是首字母占位头像。每个专家都附带完整输入要求、工作步骤、3 类交付物、逐项验收标准、推荐工具类型、数据和外部动作限制。图标源文件：`src/expert-icons.tsx`，真实矢量总览：`docs/expert-icons-sheet.svg`。

`src/CloudExperts.tsx` 在管理员配置岗位时，读取企业现有的 `/api/skills` 和 `/api/connectors`，如实显示技能注册表和连接器的“已配置/未启用/状态未核验”，且能打开原有受权限保护的管理界面；不会把职位标签冒充可以自动执行的工具权限。

绑定已审核 Worker 的单专家委托，其创建的 Worker 任务单会明确包含角色作业步骤、可验收产物和数据外发边界（总长度受 WorkerDesk 上限约束）。

## 团队工作准备：真实任务，不重写 DAG

增加 `POST /api/cloud-teams/:id/stage`（管理员角色）。给每个已配置团队成员一项明确、可分享的公开数据任务，逐项提供目标、截止期限与 Credits 上限，并显式确认：

- **总预算锁定**：所有子任务 Credits 之和不能超过团队项目预算；单项不超过团队和该专家的上限，也不能低于对应的服务最低值。
- **可重试**：后台先持久保留准备计划，再依次调用已有 WorkerDesk 创建待审批任务。中途异常可用完全相同的请求 ID 重新核对；不重复派发或生成虚假执行记录。
- **任务权限**：所有子任务均为 draft，后续需要已有管理员审批 / dispatch；没有外部发送、付款、自动浏览器操作或收费模型调用。
- **配置围栏**：预留预算后不能撤销成员归属或将项目预算/单项限额降至承诺之下。
- **运行真实性**：即使任务草稿已经就绪，Team 仍然不宣称 Native Harness 的自动协作 DAG 已连接。当前只提供真实任务分派与人工审批，不虚构后台运行进度。

## 验证与未完成项

已添加：
- test/cloud-experts.test.mjs：模板、岗位管理、预算、允许的执行器绑定、版本保护、团队计划与单专家真实任务单接口。
- test/cloud-experts.http.test.mjs：现有 createApp/Workspace 数据存储的 HTTP/重启场景。
- test/ui.browser.mjs：默认专家中心与次级业务服务路由的视觉和交互回归。

运行需 Node.js 24+：npm ci && npm run build && npm run test:all && npm run test:browser。

当前连接环境没有完成最新 Node24 构建/真正的 React Chromium 回归。独立 HTML 预览是交互演示，不是云端运行截图。

**下一版待接：** 单租户隔离的企业私有资料审批、原生 Harness 团队 DAG 映射、具体 Runner 的持续心跳/租约/可用性、跨专家子任务预算预留和交付物整合。所有这些应复用项目现有 Harness / Worker 层，而非再造个人 Agent。
