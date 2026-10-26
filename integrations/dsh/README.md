# DeepSeek Harness 原生插件

DSH 是当前唯一的后续 Agent 执行宿主。这里的可选 bundle 由 DSH 的
`plugin_manager` / profile bundle 装载，不再需要独立 Workspace Harness 服务。

| 目录 | 包名 | 版本 | 作用 |
| --- | --- | --- | --- |
| `dsh-workspace-library` | `dsh-workspace-library` | 1.4.1 | 企业／产品资料、文件、图片、版本审核 |
| `dsh-space-workspace` | `dsh-space-workspace` | 1.1.0 | Space 页面、分享、评论及任务设置记录 |
| `dsh-sourcing-agent` | `@local/dsh-sourcing-agent` | 1.0.0 | 按需业务 skill 与模板，无自建阶段引擎 |
| `dsh-workspace-memory` | `dsh-workspace-memory` | 0.1.0 | 经营记忆候选、人工审核、原生工作区隔离与来源召回 |
| `dsh-mini-erp` | `dsh-mini-erp` | 0.5.0 | Agentive 模块助理、原生会话交接；复用原库与现有账本 |
| `dsh-inquiry-recovery` | `dsh-inquiry-recovery` | 0.1.0 | 可选询盘来源、身份及未发送草稿 |
| `dsh-buyer-magazine` | `dsh-buyer-magazine` | 0.2.0 | 独立网站转杂志 Agent、完整 Skill、统一编译器与可选模块／ERP 适配 |

这些既有实现不是通用底座的默认必备范围，收敛方向见 [清单](../../docs/SCOPE-REDUCTION.md)。

可选的 [dsh-workspace-brand](dsh-workspace-brand/README.md) 通过原生主题与品牌槽位定制外观，不增加业务面板或执行宿主。它须单独安装；本轮独立预览 profile 的验证见 [原生品牌验收](../../docs/DSH-NATIVE-BRAND.md)。

六个业务插件与品牌插件共同加载后的原生界面见 [完整插件预览](../../docs/DSH-PLUGIN-PREVIEW.md)。其中五个业务插件提供侧栏面板，Sourcing Agent 通过原生模式选择器提供预设与七个按需 Skill。

后续新增的独立 [网站转杂志](dsh-buyer-magazine/README.md) 自带原生 Agent 预设，无需 Sourcing 或 ERP。Sourcing 中的微刊入口复用它的同一份 Skill 和编译器。联合与独立安装检查见 [杂志统一记录](../../docs/DSH-MAGAZINE-UNIFICATION.md)。

按需在 DSH 内安装：

```text
plugin_manager install_bundle target=<本机绝对路径>/integrations/dsh/dsh-workspace-library
plugin_manager install_bundle target=<本机绝对路径>/integrations/dsh/dsh-space-workspace
plugin_manager install_bundle target=<本机绝对路径>/integrations/dsh/dsh-sourcing-agent
plugin_manager install_bundle target=<本机绝对路径>/integrations/dsh/dsh-workspace-memory
plugin_manager install_bundle target=<本机绝对路径>/integrations/dsh/dsh-inquiry-recovery
plugin_manager install_bundle target=<本机绝对路径>/integrations/dsh/dsh-mini-erp
plugin_manager install_bundle target=<本机绝对路径>/integrations/dsh/dsh-buyer-magazine
```

Host 代码改动后按插件文档禁用／启用或重启 DSH，页面强刷。根目录 `npm start`
只显示真实安装目录，不启动服务，不写入 profile，不会自动安装插件。

首次设置先在仓库根目录执行 `npm ci --ignore-scripts`，连接经营记忆的本地领域依赖；
验证执行 `npm run build` 和 `npm test`。
HTTP 认证仍复用 DSH 的 Connection；附件仍走 DSH 附件存储。

依赖已退役 8790 服务的 `dsh-business-memory` / `dsh-product-library` 桥接已删除。
如本机以前安装过这些桥接，请在 DSH 插件管理器中停用／卸载；本次仓库修改不会操作本机配置。
其领域逻辑保存在 `packages/domain-business-memory` 和 `packages/domain-product-library`，
经营记忆现在由新的 `dsh-workspace-memory` 原生 bundle 适配，旧桥接不恢复；
产品领域包仍待接入。详见 [迁移记录](../../docs/DSH-MIGRATION-20261026.md)。
