# AI Worker 产品架构

## 1. 角色

| 角色 | 能做 | 看不到 |
|---|---|---|
| 业主 | 招募、选择运行在哪个 Agent、审批任务、验收、付款、解约 | 维护者的私有资料与密钥 |
| 维护者（真人） | 发布 / 更新工作包、复核交付、回复升级、暂停接单、查看收入 | 任务授权范围之外的项目数据 |
| 个人 Agent | 领取任务、执行、回传进度与交付 | 未授权资源；不能子委托、对外发消息、支付 |
| DSH | 凭证、限权、版本推送、记账、托管、真实统计 | — |

## 2. 对象

```
Worker（跨项目，一张「工牌」）
  id, no(工牌号), name, tagline, category
  maintainerPartyId, maintainerVerification: email | company | identity
  runsOn[]: grokbot | muse | other        支持的运行时
  mode: install | hosted                  A 装到我的 Agent / B 维护者托管
  package: instructions, skills[], toolScopes[]   skills ⊆ DSH 动作枚举
  inputs[]: product | document | url | text
  outputs[]: text | link | draft
  starters[3–4]: {title, brief, defaultSkills}
  review: none | optional | required      是否维护者复核
  pricing: free | subscription{monthly} | per_acceptance{price}
  declared: {responseTime, hours}         自述
  status: draft | in_review | published | paused | retired
  versions[]: {version, changelog, publishedAt, widensScope}

Hire（项目内一次招募）
  projectId, workerId, pinnedVersion, runtime, agentServiceId(现有)
  grantedSkills[], billing{plan, nextChargeAt}

WorkOrder（现有 + 字段）
  workerVersion, starterId?, maintainerReview?: pending|passed|returned
  escrow?: {amountMinor, state: held|released|refunded}

WorkerStats（只读投影）acceptedCount, acceptanceRate, medianTurnaround, sampleSize
```

不变量：任务允许动作 ⊆ `grantedSkills` ⊆ `package.skills`；版本默认固定；扩大权限的新版本需要业主重新授权；暂停 / 下架不影响进行中的任务。

## 3. 信息架构（移动端）

```
今天          招募            任务            我的
├ 需要你确认   ├ 搜索           ├ 进行中        ├ 我的 Agent：Grok Bot / Muse / 其他（连接状态）
├ 进行中       ├ 分类           ├ 待验收        ├ 已招募的 Worker
├ 我的 Agent   ├ 精选工牌       ├ 已完成        ├ 账单与托管
└ 已招募       └ Worker 工牌详情 └ 任务详情      └ 维护者工作台（仅维护者）
                  └ 招募面板        ├ 时间线          ├ 待复核 / 升级
                                    ├ 交付            ├ 我的 Worker 与版本
                                    └ 联系维护者      └ 收入
```

桌面端：协作画布 + Worker Studio（右侧检查器的编辑模式）。

## 4. 核心流程

**A. 发布（维护者）**：新建工牌 → 选择支持的运行时与模式 → 声明能力 / 输入 / 输出 / 复核要求 → 写预置任务 → 定价 → 试运行（沙盒项目跑一次真实任务并验收）→ 审核 → 发布 v1 → 迭代版本（扩大权限须重新试运行）。

**B. 招募（业主）**：招募页 → 工牌详情 → 「招募到 {项目}」→ 面板：选运行在哪（只列出已连接且被支持的 Agent）→ 勾选授予能力 → 确认维护者可见范围 → 确认计费 → 完成。直接点预置任务 = 招募 + 新任务草稿。

**C. 执行**：草稿 → 审批（动作、资料、预算、期限；按验收计费时冻结金额）→ 派发到所选 Agent → 进度 → 交付 → 〔维护者复核〕→ 验收（放款）/ 退回（必填原因，维护者重做或退款）。

**D. 升级**：失败、待核对或被退回时出现「联系维护者」；沟通只在任务线程内。

## 5. 协作画布

| 节点 | kind | 显示 |
|---|---|---|
| Worker | `personal_agent` | 迷你工牌：挂孔 + 工牌号 + 名称 + 维护者 + 运行时图标 + 版本 |
| 个人 Agent | `runtime`（新视觉，沿用连接数据） | Grok Bot / Muse 官方图标 + 连接状态 |
| 维护者 | `provider` 协作方 | 头像 + 认证级别 |
| 任务 | `service_order` | 状态、预置任务来源、托管金额 |
| 交付 | `evidence` | 复核印记、验收状态 |

关系：维护者 ─维护→ Worker ─运行于→ 个人 Agent；资料 → Worker 生成任务草稿；已验收任务 → Worker 生成后续任务；Worker → Worker 禁止。

添加菜单新增「招募 Worker」，从节点端口发起时按 `inputs` 过滤。Worker 检查器标签：概览 · 任务 · 权限 · 账单 · 活动。

## 6. 交互规范

- 列表 → 详情推入；招募、审批、验收用底部面板（50% / 92%），关闭保留草稿。
- 同屏一个主按钮，固定在底部安全区之上。
- 破坏性操作（解约、下架、暂停接单）二次确认并说明对进行中任务与托管资金的影响。
- 下拉刷新；可见时 6 秒静默刷新；不可见时停止。
- 返回恢复来源页滚动与筛选。

| 异常 | 表现 |
|---|---|
| 没有已连接的 Agent | 招募面板引导到「我的 → 我的 Agent」连接，不能提交 |
| 工牌不支持你的 Agent | 运行时选项置灰并写原因 |
| 维护者暂停接单 | 工牌显示「暂停接单」，草稿可存不可提交 |
| 已下架 | 详情可读，招募禁用；已招募的继续服务到本期结束 |
| 托管失败 | 审批停在待付款，不派发 |
