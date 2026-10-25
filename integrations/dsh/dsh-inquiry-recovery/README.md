# dsh-inquiry-recovery

可选的 DSH 原生历史询盘插件：导入原文件、核对身份、读取逐字依据，以及保存 Agent 自己撰写的未发送草稿。
复用 `@workspace/domain-inquiry-recovery` 的数据键和业务规则，执行仍由原生 DSH Agent 决定。

## 安装与使用

保留完整 checkout，在根目录运行 `npm ci --ignore-scripts`，再安装本地 bundle：

```text
plugin_manager install_bundle target=<checkout>/integrations/dsh/dsh-inquiry-recovery
```

原生侧栏「询盘恢复」：

1. 选择原生工作区，选择有权使用的 UTF-8 CSV / JSON 文件并导入。每次最多 64 KiB、50 行。
2. 查看询盘、原始联系记录和逐字片段；人工核对身份并记录依据。判断绑定确切来源哈希和审核修订。
3. 在原生对话中要求 Agent 根据当前资料提出草稿。Agent 自主读取询盘、产品或记忆，不指定工具顺序。
4. 草稿保存在原生附件中，可从面板查看、下载或打开来源对话。
5. 管理员填写审阅说明，记录「内容审阅通过」或「需要修改」。审阅绑定草稿 SHA、询盘来源和身份审核修订，不授权发送。

原始候选的 `draft.humanReviewed: false` 保留创建时状态；当前人工内容判断另存于 `contentReview` 和 `contentReviews` 历史。
来源或身份审核变化后，已通过的内容审阅标为 `stale`。批准前重新读取原文件和草稿附件核验字节；
需要修改的记录可以针对已失效候选保存。每份草稿最多保留 100 次审阅，修订冲突返回 409。
没有注册模型内容审批工具，所有草稿仍为未发送。

搜索可按公司、产品或询盘标识缩小范围。列表默认返回 20 条，工具最多 50 条。
面板显示最近 10 份草稿；领域保留窗口更大，历史列表不代表全部记录。
当前 profile 视为单一管理员，可选择各原生工作区；这是数据分区和 Agent 作用域，不是企业成员或多租户授权系统。

## 导入格式与证据

CSV 必需列为 `leadId,sourceId,revision`；其余字段、JSON 格式和日期要求见
[领域包](../../../packages/domain-inquiry-recovery/README.md)。
JSON 沿用 `historical-inquiry.input.v1` 和显式授权数据标记的既有契约，标记本身不证明数据真实性。
没有自动导入、演示数据播种、邮箱抓取或外部研究。

原文件逐字节保存至 DSH 原生附件。`read` 会重读附件、校验 SHA / 字节数，
在原文件中寻找哈希匹配的规范化行，并比对当前有效字段。
`sourceHash` 是规范化导入行哈希；`source.sha256` 是原文件哈希，两者不能混用。
验证仅证明存储与来源对应，不能证明客户身份、历史说法或当前采购意向真实。

新修订可能沿用旧字段，读取时明确列出 `carriedForward`，并拒绝为这种不完整当前行生成新草稿。
重新导入完整当前行后可再次核对身份。导入新修订会重置身份判断。
事实片段必须逐字存在于导入历史；修订冲突、公司变化或来源冲突不静默覆盖，导入结果报告冲突／拒绝行。

## 原生工具

| 工具 | 能力 |
| --- | --- |
| `inquiry_recovery_read` | `list`：有界元数据；`read`：原文件核验、历史和逐字依据；`drafts`：未审核草稿历史，可按 leadId 过滤 |
| `inquiry_recovery_propose_draft` | 保存 Agent 提供的文本（最多 4000 字符），必须带 requestId、leadId、确切修订和来源哈希 |

模型不能传入身份、工作区、批准或发送标志。工具作用域从当前 Agent 的原生会话归属解析，返回前再次检查归属。
导入、身份判断仅在同源认证的管理员界面提供，不注册为模型工具。
模型工具不提供发送、内容审批或任务启用能力。

`follow_up` / `need_evidence` / `nurture` / `hold` 来自可选业务规则，默认以 7 天未联系作为候选阈值
（`config.staleDays` 可设置为 1–365）。这些判断不是发送许可或通用 Agent 的强制流程。
客户退订、暂停、来源缺失、未核对身份、未知日期或缺少逐字证据等情形会阻止新草稿。
草稿内容由 Agent 提供，不使用旧领域模板替代模型撰写；内容仍需人工复核。

`drafts` 只比较当前修订及规则条件，在该历史调用中不重读附件；这不否定 `read` 或保存草稿时已进行的字节核验。
`sourceRevisionMatches` / `ruleEligibleNow` 也不证明旧草稿已获人工审核或当前原文件可读。
新来源使旧草稿标为需重新核查，历史和原始出处保留。

## 存储与接口

原生 storageDomain `workspace_inquiry_recovery`，global 中按 `workspaces[原生 id].inquiryRecovery` 分区。
保留领域数据键；原文件引用写入导入记录，草稿写入 native attachment 并记录真实 session / callId。
旧领域的禁用 Goal 数据不暴露为原生任务或执行入口。不自动迁移旧工作台文件。
单工作区状态上限 8 MiB，超限拒绝写入。损坏数据加载失败，不清空重建。

认证接口前缀 `/inquiry-recovery-api`，写入检查同源，未认证返回 401：

- `GET /workspaces`、`GET /workspaces/:id/status`。
- `GET /workspaces/:id/leads?q=&limit=`、`GET /workspaces/:id/leads/:leadId`。
- `POST /workspaces/:id/import`：原文件 base64、格式、名称、requestId 和授权确认。
- `POST /workspaces/:id/leads/:leadId/identity`：来源哈希、审核修订、判断和依据。
- `GET /workspaces/:id/drafts`、`GET /workspaces/:id/drafts/:draftId/file`。
- `POST /workspaces/:id/drafts/:draftId/review`：稳定 requestId、审阅修订、草稿 SHA、询盘来源哈希、决定及说明；仅管理员界面使用。
- `GET /workspaces/:id/imports/:importId/file`：已校验的原文件。

写入使用稳定 UUID requestId。相同命令重试复用它，改动对象或内容必须换新 UUID。
身份判断另有精确审核修订，冲突返回 409。草稿先持久提交再保存附件，附件失败时相同请求可修复，避免重复候选。

## 验证

```sh
npm run check
node integrations/dsh/dsh-inquiry-recovery/dev/client-smoke.mjs
DSH_RUNTIME_DIR=/workspace/dsh-runtime node integrations/dsh/dsh-inquiry-recovery/dev/native-smoke.mjs
```

核心测试覆盖原文件和行匹配、身份／原生作用域、退订和来源变更、幂等重试、失败修复、取消、并发和持久化。
DOM 冒烟使用真实本地 HTTP，registry / storage / Agent 为合成夹具。
官方原生冒烟覆盖 ToolRuntime、StorageDomain / JSON、附件及重启恢复，无模型调用。
本轮浏览器／真实模型验收见根目录 [VALIDATION](../../../VALIDATION.md)。

2026-10-26（Asia/Shanghai），官方 DSH 0.2.1-rc.2 与 DeepSeek Flash 的两个独立会话完成 7 次有结果的工具调用：
核对询盘与产品后保存模型撰写的草稿，新修订退订后停止提出新草稿。
Chromium 实测原文件导入、管理员身份判断、隔离、刷新、原生草稿下载 SHA 和来源会话跳转；数据均为合成夹具。
模型曾混淆草稿历史列表的验证范围，以及原文件哈希与行哈希。工具字段区分这些范围，
原始答复仍保留供复核，不把文字输出判为已核验事实。
本机报告在 `/workspace/artifacts/dsh-inquiry-acceptance`，原生事件在 `/tmp/dsh-live-inquiry`，均不进入 Git。
