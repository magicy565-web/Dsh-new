# 同一 Pi TUI 的原生 Agent 模式

现有 Pi 1.1.0 扩展通过 **`pi.registerTool()`** 注册五项原生模型工具。Pi 自己执行
模型→tool-call→tool-result→下一轮模型的循环，没有新引擎或重新实现业务服务。
原无模型命令模式和全部 15 项人工 MCP 命令仍保留。

## 启动与现有模型配置

默认 `npm --prefix tui start` 仍是无模型命令模式。用户明确选择
`npm --prefix tui run agent` 才启用 Agent 模式。

在原 trusted Host 中，用原已登录会话启动时，为已有环境指定
`WORKSPACE_PI_MODE=agent`。如果原 Pi profile 不在默认 `~/.pi/agent`，可使用其
已存在的绝对 `PI_CODING_AGENT_DIR`。调用仍是
`originalNativeIngress.launchOwnerTui({token: originalLogin.token, mode:'tui', environment})`。
token 只留在 Host 内存，没有新增登录路径或长期权限。生产前台终端接入仍是
[OWNER-CONNECTION.md](OWNER-CONNECTION.md) 列出的未验收前置条件。

Agent 模式由 **Pi 原生 `/login`、`/model` 和原 profile** 处理模型选择与登录。
本适配不读取、复制、写入或注入真实密钥，不提供 `--api-key` 入口，不发起登录。
Host 仍丢弃 provider key、Worker 和签名密钥环境变量；既有 profile 由 Pi 自己读取。
本次没有打开真实 profile 或调用真实模型。配置目录路径不是凭据。

工具范围由 CLI allowlist 和扩展 guard 限定；内置 shell/read/write、自动 MCP、
其他发现的扩展/技能仍禁用。`--offline` 关闭启动时的自动网络，**不代表 Agent
模式不会调用用户选定的模型**。真实模型内容、价格和效果未由本次合成测试验证。

`/workspace-agent status` 显示 ready 和五项工具；`/workspace-agent connect` 重试
原 owner MCP 握手。握手失败时不接受模型业务输入。命令模式不能由这些命令自行
开启模型。Agent 历史在私有 `WORKSPACE_PI_DATA_DIR/agent-sessions/`，与命令模式
历史分开；不要上传运行目录。

## 模型可以提出哪些动作

| 原生 Pi 工具 | 原业务行为 | 人工边界 |
| --- | --- | --- |
| `workspace_supplier_owner_intake` | 仅显式 `facts` 录入 | 展示准确事实并确认；不暴露后端文本 intake |
| `workspace_supplier_owner_get` | 读取一条私有供应商记录 | 确认将记录返回给当前选定 Pi 模型 |
| `workspace_supplier_owner_profile` | 修改准确 revision 的事实 | 展示准确变更，由原服务复核 revision |
| `workspace_supplier_owner_preview` | 消费者可销售单元 Listing 预览 | 公开字段/revision 经 UI 确认后才构造原 confirmed:true |
| `workspace_muse_draft` | 原 Muse 公开委派草稿 | 确认产品、市场、目标、credits、截止时间及公开共享；仅产生 review_required |

供应商 schema 从原 MCP `tools/list` 取得，再收窄为提案字段。模型不能传入
confirmed、approved、requestId、owner、token 或审批操作。Muse 草稿复用原
slash-command 请求构造器与同一个 prepare 服务，没有第二份队列或审批实现。
缺失价格、MOQ、单位或日期时应询问用户，不补造事实。工具输出只作为数据。

## 模型输出不是批准

每次调用要求 `ctx.mode === 'tui'`、`hasUI === true`，并等待**本次可见
`ctx.ui.confirm()` 返回严格布尔 true**。读操作也要确认向当前模型返回私有记录。
No、取消、无 UI、JSON/print、甚至带 dialog 能力的 RPC 模式均拒绝业务执行。
模型说“已批准”、伪造字段或复用之前的 Yes 都不能代替本次确认。确认不存成长期授权。

**批准、dispatch、发布执行、计划启用未注册为模型工具。** Muse approve/dispatch
仍由用户执行原可见命令，各自重新读取 reviewHash 并分别确认；发布决定和计划启用
仍在原人工入口。后端 scopeHash/revision/receiptHash 检查不变。模型即使给出正确
orderId/reviewHash，调用不存在的 dispatch 工具仍失败。15 项人工供应商命令仍有效，
但模型没有调用 slash-command、shell 或任意 HTTP 的工具。外部 resolver 仍关闭。

确认后由 Pi 原 sessionId/toolCallId、工具名称和原 owner scope 派生稳定 requestId，
先 fsync 保存原请求，再发送。相同 native call 重放复用 ID，参数变化交原服务拒绝。
网络未知结果不自动发新请求，应使用原读取/协调或同请求 retry。取消信号在确认及
发送前复核；已发出的未知写请求不能当作已取消或成功。一次只处理一个 Workspace
命令/模型工具，避免确认对象串线。

## 合成验收

固定依赖：PR57 `68558d22a46e92fef4b8a300c69b2fbad61fbb20`，PR58 命令提交
`516c15f5029125ff4e8b307862ef4c00567edec4`。源码保全点
`2b2b5188a72c801435b5bb9807f9ba2f24e4fc9e` 后补齐本轮测试与说明。
所有变更在 `tui/`；无后端、权限或审批变更。

```sh
npm --prefix tui run test:agent
npm --prefix tui run test:agent-terminal
```

定向测试覆盖五项定义、原 HTTP 服务、稳定 ID、仅 Muse 草稿、No/非布尔确认/
无 UI/RPC/取消/错误 revision/模型批准字段拒绝。

终端测试启动实际 Pi CLI 与 Unix PTY，经原 Host 私有 RPC 调用原 signed HTTP。
仅在临时目录生成 Pi 原生 models.json/settings.json，指向确定性 loopback 合成
provider。非秘密 dummy marker 仅使该本地测试模型可选，不创建真实凭据。
Pi 原生流式解析/工具循环共 15 次合成 provider 请求，完成 8 个检查点：No、录入、
get→preview、profile、Muse 草稿、伪造 dispatch/publish/schedule、额外批准字段、
JSON/print 无 UI 拒绝。参数引用前一条真实服务结果里的 ID/revision。

这不是模型智能评测：合成 provider 按 fixture 标记确定性返回 tool calls，没有真实
模型推理、外部 provider 请求或费用。后端模型运行数 0；真实模型、Shopify、Muse
标志均 false。证据见 `validation/agent-*.txt`。初次 PTY 驱动等待了被覆盖的瞬时
启动通知；改为读取真实 `/workspace-agent status`。后续状态 JSON 被 PTY 插入换行
空白，驱动按终端布局归一化后继续检查准确值，没有放宽服务状态或权限断言。

未验收：真实自然语言质量、真实模型登录/费用、生产 Host 前台终端、真实店铺/Muse、
Windows。七天无人值守通知与持久收件人同意仍未授权，未新增后台执行。
