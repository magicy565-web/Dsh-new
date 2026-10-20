# AI-work 部署与运营手册（客户线索挖掘）

> 适用版本：`server/ai-works.mjs` / `src/AiWorks.tsx`（2026-10-21 迭代）。
> 本文只描述**已验证**的能力与 fail-closed 行为；标 L3 的条目尚未用真实外部账号验收。

## 1. 运行前提

- Node.js **24**（仓库其他部分要求；本机验证版本 v24.21.0）。
- 单写者工作区数据目录（`dataDirectory`，默认 `.data/`），由 `server/store.mjs` 原子事务维护；不要多进程写同一目录。
- 静态前端构建：`npm run build`（或 `node node_modules/vite/bin/vite.js build`），产物 `dist/`。
- 启动：`npm start`（`node scripts/workspace-omp.mjs`）。默认不配置任何外部 key，全部外部能力 fail-closed。

## 2. 外部能力与环境变量

| 变量 | 作用 | 未配置时行为 |
|---|---|---|
| `SERPER_API_KEY` | Serper 搜索 API（自动搜索公开网页） | `execution.status=awaiting_source`（若无可导入线索）；不生成候选 |
| `COMPANIES_HOUSE_API_KEY` | UK Companies House 搜索（企业登记） | 同上 |
| `OUTREACH_PROVIDER` | `resend` 或 `postmark` | `GET /api/ai-work-outreach` 显示 `configured:false`；`send` 返回 503 `OUTREACH_NOT_CONFIGURED` |
| `RESEND_API_KEY` / `POSTMARK_SERVER_TOKEN` | 对应 provider 凭据 | 未配置不能发送 |
| `OUTREACH_FROM_EMAIL` | 发件邮箱（必填，需邮箱格式） | 不能发送 |
| `OUTREACH_FROM_NAME` | 发件人显示名（可选） | 仅使用邮箱 |
| `OUTREACH_REPLY_TO` | Reply-To（可选） | 不设置 |
| `AI_WORK_DUAL_APPROVAL` | `true` 时审批人与发送人必须是不同 admin | 默认关闭（单 admin 可审批+发送） |

> 密钥只放在服务端进程环境；不写入前端、不写入 `state.aiWorks`、不进入产品库/草稿正文。

## 3. 验证步骤（部署后 smoke）

```bash
# 1) 健康/目录
curl -s http://127.0.0.1:<port>/api/ai-works
curl -s http://127.0.0.1:<port>/api/ai-work-sources
curl -s http://127.0.0.1:<port>/api/ai-work-outreach

# 2) 产品库产品 -> 委托（需要 admin/operator 会话，见平台访问模型）
# 3) 导入 1 条带来源 URL/日期/摘录的授权线索 -> execute -> review qualified
# 4) 生成草稿 -> PATCH 替换占位符（含 HTTPS 退订链接）-> approve -> send（需 provider 已配置）
# 5) 查看 /api/ai-work-delegations/:id/events 与 export/*.csv
```

本机自动验证（无外部账号）：

```bash
node --test test/ai-works.test.mjs test/ai-works.http.test.mjs test/ai-works-ui.dom.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
node scratch/aiworks-ui-probe.mjs   # 真实 Edge/Chromium 探针（390/1440）
```

预期：36/36 pass、tsc/vite exit 0、探针 390/1440 无横向溢出。

> 2026-10-21 本机复核：36/36 pass（`evidence/aiworks-tests.log`）、`tsc --noEmit` exit 0、`vite build` exit 0、探针 `LAYOUT 390 overflow=0` / `LAYOUT 1440 overflow=0`（`evidence/aiworks-ui-probe.log`）。以上为 L2（无真实外部账号）。

## 4. L3 外部验收清单（尚未执行）

- [ ] Serper 真实 key：单次 execute 的 query 数/结果数/去重/失败率；核对 provider 条款与配额。
- [ ] Companies House 真实 key：英国公司检索字段与来源 URL 可打开。
- [ ] Resend/Postmark 真实账号：发件域验证、SPF/DKIM/DMARC、退订链接可访问、退信/投诉处理。
- [ ] 真实收件人送达测试（内部邮箱）；确认 `sent:true` 仅在 provider 接受后发生。
- [ ] 德国市场：事先同意记录（UWG §7）与 consentBasis 存档；退订请求进入抑制名单。
- [ ] 审计事件/CSV 导出的留存周期与访问权限。

## 5. 数据、备份与保留

- 全部 AI-work 数据在 `state.aiWorks`（产品/委托/候选/草稿/抑制/事件）；随工作区 `store` 快照备份/恢复。
- 审计事件上限 4000 条（超出丢弃最旧）；草稿发送尝试每草稿最多 20 条；抑制名单上限 5000。
- 导出接口只读，不改变数据；导出文件可能含个人邮箱，需按企业隐私政策保管。

## 6. 安全与权限

| 动作 | 角色 |
|---|---|
| 查看产品/委托/候选/草稿/事件/导出 | member |
| 建立委托、导入线索、审核候选、编辑/拒绝草稿、撤销抑制 | operator/admin |
| 发布 AI-work 产品、审批委托、审批草稿、发送、抑制名单写入、双人审批 | admin |
| viewer | 只读（不能建立/审批/编辑/发送） |

- 发送是逐封管理员确认，不是批量群发；发送前强制：占位符替换、HTTPS 退订链接、抑制名单、目标市场同意记录。
- 双人审批开启时，同一 admin 不能既审批又发送（403 `DUAL_APPROVAL_REQUIRED`）。

## 7. 已知边界

- 自动搜索/发送为 L2（注入式验收），真实外部账号未验收（L3）。
- 产品库为 Workspace 自有 `state.businessLibrary`，不是 Medusa API；Medusa 只读目录插件与本产品库无双向同步。
- 单工作区，非多租户 SaaS。
- 发送统计/失败列表已提供；独立统计页、批量重试、成员管理 UI 未做。
