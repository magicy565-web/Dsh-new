# 企业资料原 Host 集成验收

基于已复核 PR89 `cbbad133049747e3d28720ba885b3613eb7f5a34`，在 `codex/enterprise-context-host-integration-20261016` 选择性接收 PR87 `13cccff0df703e6471329cd0e1815aee3f6179a9` 的八文件增量。未复制旧 Host/PR79、未从 main 重做。唯一正式包为 `plugins/workspace-enterprise-context`0.2.0，适配器置于包内 `src/oss.mjs`，无第二个 ERPNext 客户端。

## 实现与边界

原 Node24 `createApp` 注入实际签名 Session/member/instance、原 Library 精确文档授权和原 Artifact 源文件。`factoryDocumentForSession` 直接复用原 `documentRef` 校验，不另做权限、客户或审批数据库。可信 Host 的客户/文档选择只缩小原 Library grant；模型不能设置客户身份、URL、权限或服务凭据。

原有 Node↔Bun fd3 通道加载新独立原生插件；OMP 仍负责模型、工具和 Session 循环。Docling 接收文件前，PR87 客户端已验证下载字节/SHA，并再次检查实际 Session、接收方、原文档当前 revision/version/asset。返回后、模型准备/发送/完成、worker 最终交付和 Node 最终交付均重验。私有解析和 status 元数据持有原生正文/来源/范围/Session 证明；压缩仍保留来源约束，重验缓存不会再次调用 Docling。

原始上传与 Docling API 凭据只留在 Node。限额为 5MiB 上传、2MiB HTTP 响应、48KiB 接受文本、每 worker 最多4次解析尝试、8份不同证明；超时/取消沿原 Run 传播，不重试。显式有限模型测试的 Bun 子进程禁止直接外网，避免共存检索工具意外请求真实 TED。默认启动不启用新包，缺原 Library selection 或安全审核连接返回 `unconfigured`。

**Workspace Library 仍是事实、版本和人工审核权威。Mem0 三个入口在此 Host 全部固定关闭，无批准开关或服务请求。** ERP 商业读取继续用 free-trade 的独立审核 Host；共存不合并私有授权。解析文本是未核验源数据，不是外部认证、批准事实或已保存成果。

## 实际命令与结果

```sh
node scripts/enterprise-context-preflight.mjs
node --test test/enterprise-context-host.test.mjs
node --test test/enterprise-context-oss.test.mjs test/enterprise-context-extension.test.mjs
npm run plugins:pack-check
npm run build
```

预检实测输出在 [preflight.json](preflight.json)：锁定 Bun1.3.14/OMP18.10.4 完整性通过，0凭据读取、0服务/模型请求，`productionReady:false`。普通 `npm start` 继续原配置，不自动赋予资料权限或配置 Docling。生产入口须由既有可信 `createApp` resolver 注入实际 Library 授权和 `app.enterpriseContextSessionBinding`；准确契约、字段与示例见插件 README，不能靠一个模型参数或环境开关启用。

| 检查组 | 结果 | 说明 |
| --- | --- | --- |
| 新资料 Host/SDK | 23/23 | 原签名 Session/Run/Library/Artifact/SDK、实际本机 HTTP，模型和 Docling 响应为替身 |
| 上游契约、原 Host/插件/来源/预算/启动 | 80/80 | 包含原14项契约、free-trade16次容量和所有披露阶段、禁用卸载/旧入口兼容 |
| 原 Library/素材/摄取包兼容 | 22/22 | 原服务/字段/版本/隔离策略及已有 Pi/OMP 包加载路径 |
| 最终 Skill 原 SDK 重查 | 1/1重复 | 不额外累加 |
| `npm run build` | 通过 | 十一包静态/打包闭包、TypeScript、Vite，已有 bundle 大小提示不变 |

共125个不同顶层 Node 用例，0失败/跳过/取消；嵌套 fixture 数量未再累加。命令与日志哈希见 [checks.json](checks.json)，源文件哈希见 [source.json](source.json)。未声称运行全仓或浏览器套件。

新增23项覆盖同一原生 Session 续跑、原上传发送前/返回后重验、真实 Session 登出、当前文档 revision/字节SHA变化、生成中改源、worker 退出后的 Node 最终守卫、正文/客户 status 篡改、真实原生压缩后的来源义务、客户切换与不同原 Host/成员/外部 Worker bearer 拒绝、缺配置、Mem0 固定关闭、本机 HTTP 超时/取消、开启/禁用/物理卸载/探针及 free-trade 共存。旧私有会话在缺插件时拒绝复用，新的无工具会话仍能结束。

## 真实组件与替身

真实运行组件是原 `createApp`、签名登录和成员边界、Conversation/Run/取消、原 Library/Store、原 Artifact 源文件、Node↔Bun 通道、固定 SDK loader/schema/工具/Session/compaction、披露守卫及真实 loopback HTTP。

所有企业/客户/原资料、授权选择、有限模型决策和解析返回都是明确合成。HTTP 服务仅模拟 Docling multipart 收文件及 JSON 返回，**没有安装或启动 Docling parser/OCR**；不能称作真实 Docling、真实模型推理或业务质量验收。没有真实 Mem0/ERPNext/模型请求，也没有重试 TED。运行资料、日志、会话、原文/解析正文和凭据均不推仓库。

## 明确阻塞与后续

1. **业务 Artifact 保存未接入**：原 readonly Session 在 Run admission 就对写入意图返回 HTTP403 `SESSION_READONLY_EXECUTION_REFUSED`，SDK与服务调用均为0。已移除不可用的保存入口；没有放宽门禁或自建成果账本。未来若已有原 Host 写授权绑定，可另行复用原 Artifact commit guard。当前仅原生私有 Session 持久化，不是业务成果保存。
2. **真实服务与生产授权未验**：没有真正 Docling 实例、安全生产连接、真实客户配置或外部模型，本轮不部署、不配置凭据。后续须在既有原授权链内提供实际审核来源和已存在的受信服务，再另行验服务版本、格式及输出质量。
3. **Mem0 保持关闭**：不调用其服务、不安装向量栈；上游低层假设批准的契约测试不代表当前 Host 的批准或启用。

本轮费用0元，历史保守模型累计0.074952元未变。未扩权、改网络、创建真实账号、修改/合并 main、强推或部署。PR87/Issue85 已读只表示本 writer 接收了源码交接，不代表其他会话或 Dot 已收到、确认或开始执行。
