# dsh-workspace-brand

可选的 Workspace 原生品牌插件，目标为官方 `@deepseek-ai/dsh@0.2.1-rc.2`。它直接装入 `dsh web`，不是独立网页或另一套 Harness。

品牌采用 Cursor / Grok 参考方向的黑白灰外壳：Workspace W 标识、侧栏名称、浅灰侧栏、分层中性色画布和单色操作按钮。浅色／深色／跟随系统仍由原生设置控制，用户字体与字号选择保留。

## 安装与卸载

通过原生插件管理器安装这个目录，或运行官方 CLI：

```sh
dsh plugin --profile web add link:/absolute/path/to/integrations/dsh/dsh-workspace-brand
dsh web --no-open
```

已运行的宿主按原生插件加载方式重载或重启，然后刷新客户端。停用后，原生槽位和主题层会恢复；原生设置偏好、工作区与会话不迁移、不清空。

```sh
dsh plugin --profile web remove dsh-workspace-brand
```

默认名称、描述、SVG 和深浅色 token 位于 `client.js`。修改后重新加载 Client；此初版没有新增品牌配置面板或第二套主题设置。

## 原生接入方式

- 通过 `ctx.theme.overrideTokens` 注册双模式颜色层，不调用 `setTheme`，不覆盖用户保存的浅色／深色／跟随系统选择。
- 通过 `sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark` 三个公开槽位注册标识。优先级 `-50` 覆盖默认优先级 `0` 的官方品牌项；卸载后默认项仍可呈现。
- 所有注册经 `ctx.effect` 管理，等待宿主声明槽位，并在停用、重载时释放。
- 保留原生页面结构、首页标题、浏览器标题、会话／工作区选择、输入框、权限、模型及插件管理入口；不伪造官方背书。
- Host 入口不注册工具、HTTP 接口、存储或模型调用，没有业务状态副本。

接口核对源码为官方标签 [`dsh-v0.2.1-rc.2`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.2)，提交 `687f282e8625c6b8d11ff58211a90524be2e4317`。版本声明仅覆盖本次匹配版本，不声称未来版本自动兼容。

## 验证

根目录 `npm run check` 包含此插件的语法、清单与生命周期测试。生命周期用例验证默认品牌遮蔽／恢复、其他主题层保留、延迟槽位声明前卸载，以及 Host 无能力注册；它们不替代官方宿主浏览器验证。

真实 `dsh web` 的本轮验收范围记录在 [原生品牌验收](../../../docs/DSH-NATIVE-BRAND.md)。插件清单出现在仓库中，不代表已安装到用户现有实例。
