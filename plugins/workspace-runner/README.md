# workspace-runner

执行 `workspace-chat` 里 prepared 状态的 run。

## 做什么

1. 订阅 `chat.onPrepared`，把新 run 放进有界队列（并发 1，单企业单写者）；
2. 把 run 推进到 `running`；
3. 装配上下文：系统指令 + 已确认的企业记忆块 + 最近对话历史（有字符与条数上限）；
4. 调用 `ctx.llm.complete`（可取消、有超时）；
5. 把回答写回会话，推进到 `completed` 并记录 usage/model；
6. 失败推进到 `failed`，只记录错误码和固定描述——**绝不保存 provider 的原始错误文本**。

## 不做什么

- 不暴露 HTTP 路由：外部只能取消 run，不能声称它完成了；
- 不直接写存储：所有状态变化都走 chat 服务的状态机与事件日志；
- 不执行工具、不审批、不生成文件（后续插件负责）；
- 没有 provider 时不编造回答：run 以 `LLM_NOT_CONFIGURED` 失败。

## 配置

```yaml
- id: runner
  name: workspace-runner
  config:
    workspaceId: local
    memory: true          # 组合里有 businessMemory 时注入记忆块
    model: deepseek-flash # 可选，交给 provider
    timeoutMs: 120000
    maxQueue: 100
    enabled: true
```


## 工具循环（guarded execution）

装配了 `ctx.tools` 时，runner 会把工具交给模型，并按调用逐个处理：

1. `approval: 'never'` 的只读工具直接执行；
2. 其余工具先向 `ctx.approval` 申请票据，再在 chat 里创建一条**人类可见**的审批
   （动作 + 资源 + 完整参数 + TTL），run 进入 `blocked`；
3. 批准后 runner 以**人类决策者的角色**确认票据，再用一次性票据执行工具；拒绝则
   run 以 `APPROVAL_DENIED` 失败，工具不会执行；
4. 工具结果回喂模型，最多 3 轮，最后写入一条 assistant 回答。

限制：工具模式下没有流式增量（工具调用必须先于回答确定），流式只在无工具时启用。
执行器以 `service:runner`（operator）身份运行，必须在 workspace 成员表里显式登记。
## 事件

| 事件 | 含义 |
| --- | --- |
| `run.running` | 开始调用模型 |
| `run.completed` | 回答已落库，带 usage/model |
| `run.failed` | 失败，`data.code` 是错误码 |
| `run.memory_unavailable` | 记忆读取失败，run 继续但记录告警 |

## 验证

```powershell
node --test plugins/workspace-runner/test/runner.test.mjs
node scripts/runner-smoke.mjs
```

`runner-smoke` 用离线 echo provider 走真实 HTTP + SSE：建会话 → 发消息 → run.running → run.completed → 读回回答。
