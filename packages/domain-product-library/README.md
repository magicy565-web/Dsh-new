# Product Library domain

从已删除的独立工作台中保留的领域逻辑：产品上下文固定、引用版本、页面与文件、
权限和幂等。`src/source.mjs` 保留受控 Medusa Product Context 只读来源。
没有独立服务、工具注册、凭据发现、模型调用或 Medusa 写入。

导入 `src/library.mjs` 的 `createProductLibraryService`，由宿主明确注入 storage、
source 和 artifacts。领域与既有状态键保持不变；当前尚未接成 DSH 工具／页面。

验证：`node --test packages/domain-product-library/test/domain.test.mjs`。
本地 source 用例使用合成只读服务，不代表已连接真实 Medusa。
