# 插件后端服务接入契约

适用规范：Workspace Plugin Standard 1.0.0。本文记录已实现接口与迁移边界，不定义新的 OMP API。
本次两个实例：企业上下文、Medusa 商品连接器。其他插件不因本文自动获得完整模块合规声明。

## 所有权

- 插件拥有领域校验、业务 DTO、连接器协议、来源回执及领域服务实现。工具与 HTTP 是调用这些服务的不同适配层。
- Host 注入原身份、权限、Library、Store、Artifact、错误类型与传输能力，保留最终发送和交付检查。默认安装不授予业务权限。
- 插件可以拥有领域 schema 和迁移，但不得另建与现有事实权威竞争的数据库。本次没有持久字段、迁移或业务数据复制。
- 业务规则、事务和状态机可以属于插件；不要为每个插件另建 Agent Loop、通用审批框架或固定任务 DAG。
- 完整模块新增业务行为应修改自己的包；共享核心只维护通用权威和明确装配入口。已有例外列出后逐步迁移。

## 当前可执行接口

| 包内入口 | 职责 | Host 注入 |
| --- | --- | --- |
| enterprise-context `./service` | 原工具的受控调用接口 | client、authorize、enabledMethods、nativeCapabilities |
| enterprise-context `./backend` | `createEnterpriseContextBackend`，提供原 Session binding、来源/回执/记忆读取与写入编排 | 原 hash/recipient/凭据检测函数、原 Host 的 WeakSet 品牌；实际 binding 再接收原身份/Library/Store 等 |
| enterprise-context `./document-tools` | 原文档工具与历史配对校验 | 原 native control |
| medusa-catalog `./backend` | `createMedusaCatalogBackend({ApiError})`，提供配置、预览、对账、确认后保存内部草稿 | 原 Library、workspaceId、显式 environment、fetchImpl |
| medusa-catalog `./product-client` | `createMedusaProductClientFactory({ApiError})`，绑定模型资料字段与最终披露 | 原 materialsClient、identity、authorize、assertCurrent、同一 Medusa service |
| medusa-catalog `./module` | `createMedusaBackendModule`，装配上述服务、原 HTTP 路由、取消与关闭 | 原 ApiError 和 backend 依赖；handle 接收已认证 context、已验证 body、原 respond |

所有接口都是受信进程内接口；不能把浏览器/模型提交的对象当作依赖注入。`ApiError` 由 Host 提供，保持既有 HTTP 错误类型，不复制通用错误框架。
企业 Host 保留原品牌权威与 RPC 门面。原 `server/medusa-catalog.mjs`、`server/medusa-product-client.mjs`、`server/workspace-native-document-tools.mjs` 保留兼容入口。

Medusa HTTP 与 Agent 共用同一底层服务实例，但授权适配不同：HTTP 使用原 member/body/响应门，Agent 额外限制原模型接收者与选中字段。
不能为了复用而把 HTTP 用户调用伪装成模型调用，或向模型开放 HTTP 写接口。Agent 仍只有 status/preview/reconcile。

## 装配与生命周期

原 `createApp` 新增 `backendPlugins: { disabled: [...] }`，仅接受以下两个已知 ID：

```js
{ disabled: ['workspace-medusa-catalog', 'workspace-enterprise-context'] }
```

原环境启动入口也接受：

```sh
WORKSPACE_BACKEND_DISABLED_PLUGINS_JSON='["workspace-medusa-catalog","workspace-enterprise-context"]'
```

这是**后端停用配置**，独立于原 `plugins/config*.json` 的工具发现配置。完整移除时，两处都必须显式禁用对应插件并重启；受保护会话不能自动换 profile 或抹去历史。若保留工具选择却停用后端，工具仍可能被发现，但没有受控 client，不会自动获得服务能力；不要把此状态称为工具已卸载。

- 默认保留既有选择：Medusa 仅装配服务，不自动配置远端；企业 binding 仍按需创建。新环境没有秘密/授权时无外部操作。
- Medusa 后端禁用：不导入模块，不创建服务，不挂原路由，也不为 Agent 创建 Medusa client。
- 企业后端禁用：原 `enterpriseContextSessionBinding` 明确拒绝。原企业事实存储与其他资料库功能保留。
- 已选中但缺失：Medusa 在启动时、企业上下文在请求绑定时返回 `BACKEND_PLUGIN_REQUIRED`，不切换实现。
- 原 Host 关闭会停止 Medusa 接收新调用、取消在途网络请求并等待收敛。已可能提交的远端写入不重试，不宣称回滚；重新启用后先做原 handle 对账。
- 支持停进程后重新选择、移除和恢复；**不提供运行中动态卸载/重新加载**。已经拿到的企业 binding 随原进程/Session 生命周期结束，不是跨进程永久能力。
- 默认保留业务资料、产品、记忆、Session 和审计；无删除数据的安装/卸载 hook。
- 现有 UI 与这些兼容 HTTP 地址保持不变；未增加插件市场管理页面、动态 UI manifest 或后台任务注册器。本次两个包没有新增定时任务。

## 验收与集成

必须区分服务代码、原 Host、原 SDK 加载、持久 Session、真实外部服务和真实用户流程。
本次证据和未验项见 [后端实现记录](../PLUGIN-BACKEND-IMPLEMENTATION-20261018.md)。
源码提交不是部署完成；独立审查和持久 Session 回归通过前保持 Draft。
