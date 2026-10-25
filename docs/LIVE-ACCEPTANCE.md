# 原生真实模型验收

2026-10-26（Asia/Shanghai），使用官方 `@deepseek-ai/dsh@0.2.1-rc.2` Web 宿主，
`deepseek-official` / `deepseek-flash`（模型列表显示 DeepSeek-V4.1-Flash）完成三个场景。
依据是原生 `session/page` 事件中的模型来源、工具调用／结果及 `turn/end`，不以界面文字代替执行记录。

## 本次结果

所有资料和记忆均为合成验收数据，置于隔离 profile 和空工作区；未发送客户消息。
原生 Agent 自行选择工具，没有额外 Agent Loop、业务状态机或指定工具调用顺序。
三个场景使用三个独立原生会话，共 21 次有对应结果的工具调用。

| 场景 | 结果 |
| --- | --- |
| 原生输入框选择历史 v1，已有不同条款的 v2 | 实际提交携带 v1 id／版本／SHA；模型从原生文件附件读出 v1，SHA 一致，没有换成 v2。能读取已批准样品政策，不召回待审核折扣；提出的偏好仍为候选 |
| 批准偏好后新建会话 | 浏览器验收操作者打开候选的原生来源会话，再经原生面板批准。新用户消息未重复“中文表格”偏好；模型自行召回后按该偏好输出，引用记忆 id，并明确条款来自历史版本 |
| 归档文档、撤销两条记忆后新建会话 | 指定引用得到预期归档错误，未改读 v2；记忆召回为空。模型区分附件存在与无内联正文，也区分 1 条待审核候选与 0 条可用记忆；没有拿旧事实或待审核折扣补全答复 |

前两个场景无工具错误；第三个场景的归档读取拒绝符合预期。
候选审批是浏览器验收操作者执行的管理动作，模型没有审批工具，也未自行批准。

## 验收发现与修复

- 引用按钮原先插入 `@` 后光标仍停在前面，输入文字无法正常搜索。
  现在通过原生 `uiSession` / `inputTriggers` 打开来源菜单，保留原生插入位置和草稿版本。
- 候选工具的来源 schema 曾允许服务不接受的对话 label，导致模型重试。
  现在区分对话／文档 schema；接受有界 label，但存储的对话指针、label 和身份仍由宿主生成。
- 模型曾把历史条款称为现行，并加入原文未说明的解释。
  读取结果现在显式给出 `isCurrentVersion`，工具说明要求区分历史与当前、原文与推断。
  后续严格引用任务通过；这不证明任意草稿都无需复核。
- 失效场景曾把“无可用召回”解释成“无候选”，把“无内联正文”解释成“附件为空”。
  现在分别返回生命周期计数及 `hasFile` / `hasInlineText`，保持待审核内容不外泄。
  在新会话重复同一失效任务后，解释正确。

## 重复验收的方式

真实模型验收显式启用；日常开发启动、`npm run check` 和 CI 均不调用模型。
使用已配置凭据的环境，另建临时 `DSH_HOME`，在 `web` profile 中链接四个本地 bundle。
不要把真实 Key、启动 token、原生会话或附件放入 Git，也不要修改日常 profile 来装验收数据。

本次使用原生 CLI patch 限制输出、关闭推理、遥测和错误重试；patch 内 id 使用原生配置 id：

```yaml
- id: llm-deepseek
  config:
    maxTokens: 4096
    thinking: disabled
    reasoningEffort: off
    streamIdleTimeoutMs: 45000
    retryPolicy: {mode: normal, maxRetries: 0}
- id: session-log-deepseek
  disabled: true
```

```sh
DSH_HOME=/tmp/dsh-live-memory/home-clean DSH_TELEMETRY_MODE=DISABLED \
  /workspace/dsh-runtime/node_modules/.bin/dsh web \
  --patch /tmp/dsh-live-memory/acceptance.patch.yml \
  --no-open --host 127.0.0.1 --port 3084
```

Key 只从已配置环境继承，不写入命令或 patch。正常开发启动仍不继承 Key。
通过原生 `workspace/create`、`session/create`、`session/selectModel` 创建独立会话，
第一场景必须从真实原生输入框选择旧版本并发送；其余场景通过原生 `session/prompt` 发送目标。
使用 `session/projections` 和 `session/page` 观察完成状态与事件；观察程序不执行模型或工具。

本机证据目录为 `/tmp/dsh-live-memory`，含 `fixture.json`、三个 session id 命名的 page JSON、
`source-document.json`、`submitted.json`、`operator-approval.json`、`operator-revocations.json`。
这些是本次捕获结果，不是仓库夹具。原始记录留在 Git 外。
仓库提供离线一致性检查器，可在仍保有上述证据的环境重验：

```sh
node integrations/dsh/dsh-workspace-memory/dev/verify-live-evidence.mjs \
  /tmp/dsh-live-memory /workspace/artifacts/dsh-live-acceptance
```

检查器关联工具调用与结果、验证实际附件 SHA、审核前后状态、独立会话召回和失效行为，
输出 `report.json` / `report.md`。检查器本身不请求模型，也不把本机记录作为可移植测试夹具。
没有这些原始记录时，需要重新执行上述场景再检查。

本次只证明这些指定场景。桌面宿主、生产部署、完整主题／视觉和任意模型输出的事实准确性仍不在验收范围内。
