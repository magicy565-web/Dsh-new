# 开发约定

本仓库的执行宿主是 DeepSeek Harness。原生插件在 `integrations/dsh/`，
通用领域逻辑在 `packages/domain-*`，不另建 Agent Loop、模型网关、权限系统或工作台服务。

## 当前工作区

- `/workspace/wsa-dev`：`agent/harness-20261023`，当前云端开发目录。
- 其他 checkout 和分支不随本工作区清理而改变。
- 使用显式文件路径提交；发布分支只允许快进，不强推、不重写历史。

## 日常命令

- `npm ci --ignore-scripts`：首次设置的依赖安装和本地 workspace 链接。
- `npm start`：显示四个插件的真实安装目录，不启动另一套应用。
- `npm run build`：原生 bundle 入口、JS 语法、中英文字典。
- `npm test`：四个原生插件与三个领域包的回归。
- `npm run check`：顺序运行上述静态检查与回归，无模型调用。
- `npm run test:client`：可选 DOM 冒烟，需要先安装根目录锁定的开发依赖。

Client 冒烟默认从本仓库 `node_modules/` 读取 React / React DOM / jsdom，
也可用 `DSH_CLIENT_TEST_MODULES` 指向已安装的测试依赖目录。它不依赖其他旧 checkout。

## 原生接入边界

由用户在 DSH 的 `plugin_manager` 中安装插件。源码更新后按插件 README 重载 Host／刷新界面。
仓库中的安装位置、配置模板和历史测试记录不代表本机插件已加载。
本云环境已安装官方 DSH 0.2.1-rc.2 Web 宿主，四个原生插件已实际挂载；
运行目录、接口与浏览器验收范围见 [DSH-HOST.md](DSH-HOST.md)。
隔离 profile 中的三个真实模型场景见 [LIVE-ACCEPTANCE.md](LIVE-ACCEPTANCE.md)；尚未验证桌面宿主。

经营记忆已通过 `dsh-workspace-memory` 接入原生 storageDomain / 工作区 / 会话和工具。
产品资料库、询盘恢复两个领域包仍是待接入资产。
存储、身份、附件、来源审核必须从 DSH 实际接口接入；保留数据键和来源证明，
不把 model 的建议当人工审核。产品资料库仅保留 Medusa 只读适配器，
不再在此仓库维护另一套电商应用。

资料选择／固定版本已接入原生对话：`inputTriggers` 管理引用芯片与发送序列化，
`workspace_library_references` 工具读取确切版本，附件字节由 DSH 原生存储提供。
经营记忆面板提供候选、审核、替换、撤销和来源可用性，模型工具只提供候选／有界召回。
原生对话指针由当前工具执行上下文构建；文档来源复用资料库读取器再次验证。
资料／记忆的三个真实模型场景已通过原生会话记录验收。
后续可接产品领域包或询盘恢复；业务阶段继续留在可选插件中。

## 不进入源码树的内容

运行数据、真实附件／会话、凭据、构建包、历史截图及交付 ZIP 均留在 Git 外。
旧实现可以从清理前提交恢复，不在当前目录另建 archive 或第二套运行入口。
