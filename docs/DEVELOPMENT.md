# 开发约定

本仓库的执行宿主是 DeepSeek Harness。原生插件在 `integrations/dsh/`，
通用领域逻辑在 `packages/domain-*`，不另建 Agent Loop、模型网关、权限系统或工作台服务。

## 当前工作区

- `/workspace/wsa-dev`：`agent/harness-20261023`，当前云端开发目录。
- 其他 checkout 和分支不随本工作区清理而改变。
- 使用显式文件路径提交；发布分支只允许快进，不强推、不重写历史。

## 日常命令

- `npm start`：显示三个插件的真实安装目录，不启动另一套应用。
- `npm run build`：原生 bundle 入口、JS 语法、中英文字典。
- `npm test`：三个原生插件与三个领域包的回归。
- `npm run check`：顺序运行上述静态检查与回归，无模型、无依赖安装。
- `npm run test:client`：可选 DOM 冒烟，需要先安装根目录锁定的开发依赖。

Client 冒烟默认从本仓库 `node_modules/` 读取 React / React DOM / jsdom，
也可用 `DSH_CLIENT_TEST_MODULES` 指向已安装的测试依赖目录。它不依赖其他旧 checkout。

## 原生接入边界

由用户在 DSH 的 `plugin_manager` 中安装插件。源码更新后按插件 README 重载 Host／刷新界面。
仓库中的安装位置、配置模板和历史测试记录不代表本机插件已加载。
本云环境目前没有据此确认实际 DSH 桌面进程、profile 或真实模型运行。

三个领域包目前是待接入资产：经营记忆、产品资料库、询盘恢复。
存储、身份、附件、来源审核必须从 DSH 实际接口接入；保留数据键和来源证明，
不把 model 的建议当人工审核。产品资料库仅保留 Medusa 只读适配器，
不再在此仓库维护另一套电商应用。

下一项底座工作是资料选择／固定版本到原生对话的连接。先核实真实 DSH 宿主接口，
再实现与验收，不把仅存储的消息或固定业务阶段声称为通用 Agent 执行。

## 不进入源码树的内容

运行数据、真实附件／会话、凭据、构建包、历史截图及交付 ZIP 均留在 Git 外。
旧实现可以从清理前提交恢复，不在当前目录另建 archive 或第二套运行入口。
