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
