# Medusa v2 internal catalog extension

Zero-extra-license-cost optional Medusa v2 core integration using original Workspace Library + Pi/OMP. This package installs neither a second catalog nor a Medusa process.

Native read-only tools: `workspace_medusa_status`, `workspace_medusa_preview`, `workspace_medusa_reconcile`. Standalone installation is unconfigured; the trusted original Host must inject `client` and `authorize`. No secrets are in the Pi context.

The existing Workspace product detail UI provides a separate administrator-only review action for creating unpublished Medusa drafts. No model can self-approve a write. Products remain owned by Workspace. No MOQ, wholesale prices, documents, media, inventory or sales channels are copied. Existing Shopify plugin and approvals remain independent.

See [integration guide](../../docs/MEDUSA-CATALOG-INTERNAL.md) for configuration, tenant boundaries, admission requirements, tests and remaining production validations.

## 插件内服务接口（开发候选）

`src/service.mjs` 导出 `createMedusaCatalogService({ client, authorize })`。工厂返回冻结的命名方法集合；
每个方法签名为 `(input, signal, model) => Promise<原领域回执>`。提供 `status`、`preview`、`reconcile`；只读，不增加 Medusa CRUD、产品审核或远端写入。原 Host 负责身份、授权产品投影与当前来源。

原 `src/extension.js` 已直接调用该服务，只负责 OMP 注册和 content/details 展示。
旧工具名称、schema、回执格式及原导出保持兼容；原默认 extension 与 Host 注入入口保留。
服务工厂和工具注册均不发请求、不读取环境配置、不创建数据库或新 Session。

这是受信进程内的包内接口，**不是新 HTTP API、浏览器权限或可独立部署服务**。
调用者必须提供既有、当前有效、绑定身份/来源/模型的原 Host client 和 authorize，
不能把用户上传 JSON 或模型参数用作这些依赖。调用前后仍执行原授权，取消与原错误语义保持；
后置拒绝不能解释为已提交写入已回滚，重试和未知结果按原服务处理。
服务返回回执也不代表已经完成模型出站、页面响应或最终交付检查；这些继续由原 Host 负责。

当前完成的是服务调用与 OMP 注册分离。业务存储、路由、RPC、Host 装配、
受保护历史和最终披露仍有既有耦合；不声明完整业务模块可装卸或热卸载。
现有页面没有新增直接调用路径，原源文件/记忆/商品权限不变。

验证入口：`node --test test/plugin-service-boundary.test.mjs`（仓库根）；
源码与证据范围见 [本次开发说明](../../docs/PLUGIN-SERVICE-BOUNDARY-20261018.md)。
本次为源码提交，未发布 npm 版本；制品应固定 Git SHA，不按未变更的开发包版本宣称新发布。

## 后端领域实现与生命周期（2026-10-18）

本包现在包含 `src/backend.mjs` 的原领域实现；原 server 文件保留为 Host 契约注入与兼容入口。
原身份、Library/Store/Artifact、最终披露权威不变；不是复制数据库，也不是把浏览器请求直接传入模型工具。
详细接口、停用配置、缺包行为与数据保留见 [后端服务契约](../../docs/plugins/BACKEND-SERVICE-CONTRACT.md)。
前一节的“尚未迁移”描述属于首个工具服务抽取增量；本次已迁移的范围与剩余核心依赖以该契约及
[实现与验收记录](../../docs/PLUGIN-BACKEND-IMPLEMENTATION-20261018.md) 为准。
支持停止进程后装卸；不声明动态热卸载。未完成持久原生 Session 与真实服务验收，不称生产就绪。
