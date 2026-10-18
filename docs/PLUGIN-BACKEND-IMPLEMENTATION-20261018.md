# 插件后端领域实现与生命周期

日期：2026-10-18。交付在 PR111；原第一步服务抽取为 `75957333`。
同步整合线 `7e88a780` 的文档 schema 修复，通过 PR113 合并到本开发分支 `570f48b4`，随后提交本实现。
未修改 main、生产部署、真实账号、秘密或业务数据库。

## 实际变化

1. 企业上下文原来源选择、Docling 编排、回执检查、结构化记忆编排与文档工具移到包内 `backend.mjs`/`document-tools.mjs`。Host 保留原品牌权威、通用协议注入与 RPC 兼容门面；不创建平行记忆库。
2. Medusa 原配置、预览、对账、已确认内部草稿写入移到包内 `backend.mjs`；原模型字段/披露适配移到 `product-client.mjs`。
3. Medusa 原 HTTP 路由归入包内 `module.mjs`。原 App 通过明确装配调用它，仍在原认证、签名 body、隐私与响应权限门之后执行。Agent 与 HTTP 共用底层服务；模型没有新增写入工具。
4. 增加原 Host 的两模块停用配置与环境入口。禁用不加载模块、不挂 Medusa 路由、不创建其 Agent client；企业 binding 明确拒绝。缺包不静默替换实现。
5. 关闭 Medusa 模块会拒绝新调用，传播取消，等待已有调用收敛。写入可能已提交时不返回成功、不重试、不假称回滚。默认保留所有原业务数据。
6. 保留旧 import 路径及错误类型；包公开 service/backend 接口，无新依赖或安装 hook。插件 `backend` 默认不读取环境秘密；兼容 server 工厂仍保持原默认环境语义。
7. 同步当前 PR99 的完整 oneOf 分支修复到 service；保留声明字段和元组关联，避免原 SDK strict schema 转换排除 statement。

当前完成的是这两个后端的代码归属、兼容接线和重启装卸实例，不表示其他 13 个插件都已迁移为完整业务模块。
企业事实库、资料/Artifact、Session、身份与预算仍由原权威负责。没有新增 UI、动态任务注册、热卸载或完整业务数据清理。
接口与使用步骤：[服务契约](plugins/BACKEND-SERVICE-CONTRACT.md)。

## 验证环境与结果

Node 24.19.0、npm 11.9.0；原 root 锁依赖；官方 Bun 1.3.14 二进制通过仓库 SHA256 校验；原 OMP18.10.4 锁依赖。
下载依赖使用 ignore-scripts。ERP 包声明的 `@workspace-agent/pi-free-trade@0.1.2` 通过本地实际包链接提供；没有模拟 SDK 或补丁锁实现。
本地是固定提交文件集合加相关完整依赖，不把它称为全仓 git checkout；完整源码由 GitHub 原 tree 加显式改动构建。

| 验证 | 结果 | 证据范围 |
| --- | --- | --- |
| 7 个包/服务/HTTP/schema 测试文件 | 47/47，fail/cancel/skip 0 | 实际包、原 App/Store/HTTP；外部 Medusa、模型、数据为合成替身 |
| 同样47项在实际 npm pack 解包的包上运行 | 47/47，fail/cancel/skip 0 | 包外目录运行；不重复计为94项 |
| 原企业 Host 守卫，按4个名字选择 | 4/4 | 原签名 Session/Host、Docling 外发前检查、只读边界、登出拒绝、Bearer 不替代签名身份；不能当作完整 SDK 成功 |
| 工具兼容比较 | 90/90 | 原首步基线与最终工具 schema/输出/调用顺序；合成 client；不含原生 capabilities schema 变化，该变化用10项当前 schema 测试单独验 |
| `node scripts/build-omp.mjs` | 通过 | 全15包静态/pack闭包、官方 Bun 编译与 OMP 发现/注册/加载；无业务工具执行、无模型调用 |
| 新模块生命周期测试 | 包含于47项中的5项 | 无副作用装配、关闭取消、可能提交后关闭不重试、禁用路由、物理删除两包后原 App 启动、原产品跨恢复保留 |
| 原持久 SDK 单场景 | **失败/环境阻断** | 原官方文件锁报 `Operation not permitted (os error 1)`；在迁移前固定源码副本也复现；未绕过原锁 |
| 原全套原生 Session/恢复/压缩/业务主链 | **未完成** | 尝试中同一锁问题导致失败；未将部分输出或其他 SHA 的历史通过算入本次 |
| 真实 Medusa/Docling/模型、浏览器、部署、独立审查 | **未执行** | 本地合成 HTTP 与加载测试不能替代这些验收 |

补充过程记录：原工具卸载大套件在本地文件集合中先遇到未取得的 local-entry 源文件，未通过，未计入上表的模块装卸证据。
模块装卸证据来自新的原 App 物理移除测试；它没有替换或跳过原测试中的 SDK 锁。
初次宿主测试在补齐 presets/依赖前也失败；最终计数仅来自上述完成环境后的明确测试集合。

## 可复现命令

```sh
node scripts/verify-plugin-backends.mjs
# 支持官方文件锁的验收环境，追加完整持久SDK与主链测试：
node scripts/verify-plugin-backends.mjs --sdk
```

默认 runner 显式输出 persistentSdk=not-run，不冒称全链路通过。`--sdk` 使用仓库原有限模型/服务替身套件，任何失败返回非零；不会改锁、换 runtime 或调用付费模型。
实际外部服务和 UI 验收另用既有真实服务验收方案与其明确授权，不隐式混入普通回归。

## 集成、停用与回退

保持 Draft：仍需支持原生文件锁的 Linux 环境完成当前提交的 `--sdk`，以及独立审查。
后端停用和 OMP 工具选择是两个已存在/明确新增的控制面，完整移除必须同时配置；不会把隐藏工具冒充后端已停止。
生产采用前还应检查原 UI 消费错误/停用状态及明确的真实服务范围。

回退代码时恢复原 server 实现和工具适配，去掉新装配参数/环境变量，停止并重启进程。没有 schema/data 迁移；业务数据和历史会话保留。
回退不撤销可能已提交的 Medusa 写入，必须按原 handle 对账。包版本未发布，使用精确 Git SHA 识别候选，不把开发版本号当作 npm 发布。
