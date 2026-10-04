# 从 GitHub 源码启动与部署

当前版本是 `0.5.0-rc.2` 开发候选版，尚未完成生产上线验收。
本仓库提供可编辑源代码、锁定依赖、测试和配置模板；创建 GitHub 仓库不等于部署服务。

## 1. 本地体验：先构建，再启动

前提：Node.js 24 或更新版本，以及允许访问 npm 官方 registry 的开发环境。
在该仓库页面使用 Code → Clone 下载，或下载并解压源码 ZIP，进入项目根目录后运行：

```sh
npm ci
npm run build
npm start
```

打开 `http://127.0.0.1:8787`。后端只监听回环地址。
本仓库不提交 `node_modules/`、`dist/`、运行数据或凭据，首次启动前必须构建。

需要配置时，把 `.env.example` 复制为本机私有的 `.env`。
没有新授权的模型 Key 时界面可启动，但模型请求会明确阻塞；不要在源码、聊天、
提交记录或前端放入 Key。应在目标主机的安全配置界面录入。

这份部署说明没有代替最终干净安装验证。上一轮离线安装缺少
`xmlchars-2.2.0.tgz` 缓存；请在获得授权的依赖环境中完成安装与验证，
不得绕过网络或审核限制。

## 2. 企业部署：长期运行的 Node 服务

需要一台经过授权、支持 Node.js 24、子进程及持久本地磁盘的 Linux 主机或容器。
仅部署前端、GitHub Pages、无持久存储的函数实例，均不能运行当前完整应用。

建议的落地顺序：

1. 先确定主机、域名、员工身份系统和运维负责人
2. 在构建环境从锁文件安装并构建，把应用放入只读目录，例如 `/opt/workspace-agent`
3. 准备专用低权限服务账户，以及私有持久数据目录 `/var/lib/workspace-agent`
4. 实现并审核 TLS、员工登录和逐请求 Ed25519 签名入口，严格按照
   [部署协议](DEPLOYMENT.md)；普通 Nginx 转发或 `X-User` 请求头不够
5. 在主机私有配置中设置真实 origin、workspace、issuer、公钥、成员映射和供应商配置
6. 审核并适配 [systemd 模板](../deploy/workspace.service.example)，确认路径、权限和持久卷
7. 完成目标主机的登录/角色/CSRF、重启、备份恢复、浏览器和模型验收，再开放给真实成员

生产模式要求 `NODE_ENV=production` 和 `WORKSPACE_ACCESS_MODE=enterprise`，
缺少签名入口配置会拒绝启动。不要把默认无登录的 local 模式转发到公网。
一个企业共享空间只能有一个后端写进程；不能直接横向扩容或让多副本写同一 JSON 数据库。
所有成员共享工作区数据，不提供多租户或成员间的私密聊天隔离。

## 3. 可选原生 Harness

文本模式不需要完整 Harness 源码。原生模式还需要单独取得并审核完整运行时、
构建 CLI/SDK、选择工具权限 profile、配置持久存储和恢复范围，见
[原生接入说明](../NATIVE-HARNESS.md)。本仓库包含 MIT SDK 客户端，不包含完整原生
源码归档、其内部文件索引或私有交付标识；已有分卷的校验说明保留在
[NATIVE-SOURCE-PARTS.md](NATIVE-SOURCE-PARTS.md)。

## 4. 验证与上线边界

```sh
npm run typecheck
npm test
npm run test:ui
npm run test:recovery
node scripts/check-launch-gates.mjs
```

仅在已获授权、依赖完整的环境运行。原生夹具还需要独立的已审核源码及依赖；
缺少源码时相关测试会跳过，不能当成全套通过。严格的 `npm run test:offline-evidence`
会拒绝缺少原生夹具或任何跳过的报告。

上线门槛检查因缺少真实验收证据而非零退出是正确结果，不能删除或弱化门槛。
最新准确验证范围见 [VALIDATION.md](../VALIDATION.md)。

已有 release 打包脚本还依赖单独交付的原生源码归档和完整索引，不能仅凭 GitHub
源码直接运行 `test:release`。常规本地体验使用上面的 `npm ci / npm run build / npm start`。

仓库发布不授权购买主机、部署公网、开通持久访问或付费模型测试；这些步骤需按实际目标确认。
