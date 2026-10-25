# Business Memory domain

从已删除的独立工作台中保留的宿主无关领域逻辑：记忆候选、来源固定、版本与幂等、
人工审核、过期、召回和有界上下文。仅依赖 Node.js，没有 HTTP 服务、模型、工具注册或 UI。

导入 `src/domain.mjs` 的 `createBusinessMemoryService`，由宿主注入 `storage.read/update`、
身份解析及来源验证。[dsh-workspace-memory](../../integrations/dsh/dsh-workspace-memory/README.md)
已经提供原生存储、工作区和文档来源适配；本领域包本身不装载宿主服务。模型不得自行审核候选。
原数据键保持不变，不自动读取／迁移旧工作台数据。

验证：`node --test packages/domain-business-memory/test/domain.test.mjs`。
