# Workspace · 原生 OMP 单入口

默认应用是官方 OMP 18.10.4，运行于固定 Bun 1.3.14。npm start、npm run workspace、npm run dev 和桌面启动脚本都进入原生 TUI，不启动旧 Workspace HTTP 服务，不要求 WS_AGENT_URL/token。

## 当前可运行命令

Linux x64 / Node 24：

```sh
node scripts/setup-omp-runtime.mjs
WORKSPACE_OMP_AUDITED_NPM_CACHE="$PWD/.cache/npm-omp" node scripts/workspace-omp-install.mjs
npm run build:omp
npm run test:omp
npm run workspace -- --check
npm start
```

这条原生路径只安装 support 中两份锁文件的 Bun/OMP 依赖，无需先装旧网页的 React/Vite/Pi 依赖。安装禁用生命周期脚本并排除可选模型组件。npm run build 与 build:omp 相同，验证插件打包闭包、Bun 编译和官方 OMP 独立发现/注册。

默认 TUI 是明确的离线 no-model 预览：空的隔离 HOME、不读账号密钥、不调用模型、不保存会话、不执行 shell，加载 plugins/config.json 中显式启用的项目扩展。当前默认只启用 workspace-local-materials 的三个公开草稿工具；没有授予本地文件或企业资料访问。所有 11 个包可发现，不代表企业服务已经配置。模型与原生持久会话需另外验收。

## 已有本地会话

继续复用原有原生 Session、资料选择和权限边界：

```sh
npm run workspace -- --input /ABS/product.md --output-dir /ABS/existing-output "先看资料，问我缺项" --check
```

去掉 --check 的实际执行仍需原有显式模型、价格和预算配置。不得因为预览界面成功而推断真实模型或持久恢复已通过。本次云环境拒绝 OMP 原生持久文件锁，持久续聊/恢复回归尚未通过；未删除或替换锁安全机制。

## 插件与旧服务

- 原生插件唯一目录为 plugins/，沿用官方 manifest/extension/skill 加载，无新 AgentLoop、队列或数据库
- 外部/Host 绑定业务默认禁用并标记 unconfigured。Mem0 继续关闭，Docling 原件传出继续要求既有精确授权
- Shopify、工厂、询盘、客户、七天监测、免费贸易和企业资料插件复用基线，不重复 cherry-pick
- Brain/Medusa 等未完成审查的候选未接入共享 Host/Artifact
- 旧服务仅通过 npm run legacy:workspace -- --serve 显式启动；不属于默认原生入口，也不在此次云构建中启动

[本轮范围、命令与验收限制](docs/OMP-UNIFIED-BUILD.md) · [插件说明](plugins/README.md) · [原本地会话说明](docs/WORKSPACE-OMP-LOCAL.md)
