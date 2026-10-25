# DeepSeek Harness 原生插件

DSH 是当前唯一的后续 Agent 执行宿主。这里的三个插件由 DSH 的
`plugin_manager` / profile bundle 装载，不再需要独立 Workspace Harness 服务。

| 目录 | 包名 | 版本 | 作用 |
| --- | --- | --- | --- |
| `dsh-workspace-library` | `dsh-workspace-library` | 1.2.0 | 企业／产品资料、文件、图片、版本审核 |
| `dsh-space-workspace` | `dsh-space-workspace` | 1.1.0 | Space 页面、分享、评论及任务设置记录 |
| `dsh-sourcing-agent` | `@local/dsh-sourcing-agent` | 1.0.0 | 可选 DTC／B2B 业务方法、阶段规则与交付物 |

在 DSH 内分别执行：

```text
plugin_manager install_bundle target=<本机绝对路径>/integrations/dsh/dsh-workspace-library
plugin_manager install_bundle target=<本机绝对路径>/integrations/dsh/dsh-space-workspace
plugin_manager install_bundle target=<本机绝对路径>/integrations/dsh/dsh-sourcing-agent
```

Host 代码改动后按插件文档禁用／启用或重启 DSH，页面强刷。根目录 `npm start`
只显示真实安装目录，不启动服务，不写入 profile，不会自动安装插件。

验证：在仓库根目录执行 `npm run build` 和 `npm test`。
HTTP 认证仍复用 DSH 的 Connection；附件仍走 DSH 附件存储。

依赖已退役 8790 服务的 `dsh-business-memory` / `dsh-product-library` 桥接已删除。
如本机以前安装过这些桥接，请在 DSH 插件管理器中停用／卸载；本次仓库修改不会操作本机配置。
其领域逻辑保存在 `packages/domain-business-memory` 和 `packages/domain-product-library`，
尚未完成原生 DSH 接入。详见 [迁移记录](../../docs/DSH-MIGRATION-20261026.md)。
