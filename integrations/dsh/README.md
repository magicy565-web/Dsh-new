# DSH 插件源码（DeepSeek Harness 桌面宿主）

这里保存当前 DeepSeek Harness 桌面宿主的三个业务插件源码。它们与仓库根的
本地 Harness 工作台（`harness.local.yml` 组合，端口 8790）是**两条独立的产品线**：

| 目录 | 包名 | 版本 | 作用 |
| --- | --- | --- | --- |
| `dsh-workspace-library` | `dsh-workspace-library` | 1.2.0 | 产品库 + 企业资料库，文件/图片/版本审核 |
| `dsh-space-workspace` | `dsh-space-workspace` | 1.1.0 | ChatGPT 式空间、页面、文件、定时任务 |
| `dsh-sourcing-agent` | `@local/dsh-sourcing-agent` | 1.0.0 | DTC / B2B 获客流程 Agent，阶段门 + 产物渲染 |

## 与本地 Harness 的关系

- 本地 Harness 工作台（`packages/`、`plugins/`、`server/`、`harness.local.yml`）是
  本仓库的发布主线，安装包只打包这一套。
- `integrations/dsh/` 下的插件运行在 **DeepSeek Harness 桌面应用**里，通过
  `plugin_manager` 或 profile 的 bundle 列表装载，不参与 `harness.local.yml`。

两条线共享同一批业务语义（产品库、空间、获客阶段），但宿主接口不同，不要互相导入。

## 安装到本机 DSH（开发位）

本机 `~/.dsh/profiles/desktop` 当前用 `link:` 指向开发目录。换机器或重新安装时：

```text
plugin_manager install_bundle target=C:\...\integrations\dsh\dsh-workspace-library
plugin_manager install_bundle target=C:\...\integrations\dsh\dsh-space-workspace
plugin_manager install_bundle target=C:\...\integrations\dsh\dsh-sourcing-agent
```

Host 代码不会热更新；改完在插件管理器里禁用再启用对应行，页面需要强刷。
每个包自带测试与 `dev/` 辅助脚本，用法见各自的 `DEVELOPMENT.md` / `README.md`。

## 边界

- 插件不做自定义 token；HTTP 路由沿用宿主 `authorize`（同源 Cookie + Host/Origin 围栏）。
- 文件走宿主附件存储（内容寻址），单文件上限 12 MiB。
- 这份目录只是源码归档；安装包（`dist/Workspace-Harness-Setup-*.exe`）不包含 DSH 插件，
  也不修改 `~/.dsh`。
