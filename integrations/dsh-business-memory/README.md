# dsh-business-memory

DSH 侧适配器：把 `workspace-agent` 仓库里的 `workspace-business-memory`
Harness 插件接到当前 DeepSeek Harness，让对话中的 Agent 可以**召回企业经营记忆**
并**提出待审核候选**。

它不保存记忆、不做审核、不写外部系统，也不替代插件的人工审核边界：

- 只读工具：`business_memory_status` / `business_memory_map` /
  `business_memory_brief` / `business_memory_recall` / `business_memory_read`；
- 写入工具只有 `business_memory_propose`：创建 `proposed` 候选，永远不会自动生效；
- **故意不暴露** approve / reject / revoke 工具——审核必须由人在记忆区域完成。

## 工具

| 工具 | 后端 |
| --- | --- |
| `business_memory_status` | `GET /api/business-memory/status` |
| `business_memory_map` | `GET /api/business-memory/map` |
| `business_memory_brief` | `GET /api/business-memory/brief` |
| `business_memory_recall` | `GET /api/business-memory/records?…` |
| `business_memory_read` | `GET /api/business-memory/records/:id` |
| `business_memory_propose` | `POST /api/business-memory/records` |

`business_memory_propose` 的 `requestId` 由参数规范化后哈希得到：同样的候选重试
会重放原提案，不会产生重复记录。工具不返回审核/撤回能力。

## 启动后端

在 `workspace-agent`（或本次 `workspace-agent-memory` worktree）：

```powershell
$node = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node scripts/harness-serve.mjs
```

默认监听 `http://127.0.0.1:8790`，记忆区域页面在
`http://127.0.0.1:8790/business-memory`。需要其他地址时，在启动 DSH 的进程环境里设置：

```text
BUSINESS_MEMORY_BASE_URL=https://your-harness.example
```

必须是精确的 HTTP(S) origin（不带路径）。

## 未配置/未启动时

- Harness 未启动：工具返回 `BUSINESS_MEMORY_UNAVAILABLE`，不会编造数据；
- `product-page` 来源未绑定产品资料库：插件返回
  `BUSINESS_MEMORY_SOURCE_UNCONFIGURED`；
- 没有审核的候选：`recall` 默认只返回 active 事实，候选不会进入回答依据。

## 安装与验证

```powershell
$node = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node --test integrations/dsh-business-memory/test/index.test.mjs
```

安装由 `plugin_manager install_bundle` 完成；安装后工具出现在当前 profile 的所有会话中。
