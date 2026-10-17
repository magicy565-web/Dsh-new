# Medusa / Docling 部署源码准备

本轮按用户调整后的顺序暂停 DeepSeek，继续同一开发分支 `codex/omp-all-plugins-integration-20261017` / Draft PR99。基线 `bc2d453cff163ac51d0376ed16dae469e20ca004`，不从 main 重建，不覆盖此前产品无损编辑、原生 Host、Session、来源 proof、授权和撤权修复。仅提交源码、测试、锁和说明；没有本写入者的真实服务器操作、真实凭据生成、管理员创建、模型调用或实际 Library 文件解析。

## 本轮变更

- 选择性复用 PR94 固定 `04325f4ddc9e50d569b3696bc4627fd359263723` 的 acceptance 宿主、Product Context migration 和较严格 smoke。当前 UI、插件其余源码及其既有锁保持原样；新增宿主独立锁通过实际 `npm ci`，根脚本仅新增 `test:medusa-live`。
- 构建时使用 Node24.19.0、Medusa2.21.2、固定 npm 锁，编译并打包当前插件，再编译原生宿主。新 migration 在包内，重复打包完整性与宿主锁一致。运行时不挂载全仓库，不在启动时 npm install，不使用 root；native `db:migrate` 后运行原生 `medusa start`。
- PostgreSQL17 / Redis7.4 / API / nginx UI 使用独立 Compose 项目、私有网络、持久卷、只读容器、去除 capabilities 和受限日志。仅 loopback9000/4173；数据库和 Redis 不发布端口。Redis 只服务 Medusa 原生缓存、事件、工作流和锁，没有新建 Workspace 执行体系。
- 显式 bootstrap 要求持久、owner-only、非 tmpfs、仓库外目录及确认参数；服务文件已存在时不旋转，部分状态拒绝，启动检查缺项立即退出。测试只注入固定合成字节。原生管理员仅经交互终端手动创建，密码隐藏输入、私有 fd3 传给原生 user 函数，不经 argv/env/日志/文件，未实际创建管理员。
- Docling 使用官方 CPU v1.37.0 摘要固定镜像、一个 worker、两线程、3GiB 内存上限、私有只读 JSON 和 loopback5001；关闭远程服务/插件/UI/文档/管理接口及运行时模型下载。无 Redis、SQL、向量或 Mem0。
- 原 Host 仍使用 `http://127.0.0.1:5001`、审核连接和精确 `authorizeParserTransfer`；不放宽安全 URL 或文件传输授权。服务健康与真实 Host 解析分开验收。
- smoke 仅允许显式 isolated 意图及 HTTP loopback，创建自身 fixture、精确回读产品组织/variant/image/context/库存，检查认证、窄投影和撤销；只清理自己记录的 ID，失败或缺种子不能计为通过。禁止跳转，上传回读 URL 必须同源，最终报告筛除已知凭据值。

启动及人工操作见 [Medusa runbook](../acceptance/medusa/README.md) / [Docling runbook](../acceptance/docling/README.md)。镜像 index 和 amd64 manifest 摘要见 [镜像记录](../acceptance/deployment-images.json)，为只读注册表核验，不是镜像运行证明。

## 当前验证

| 检查 | 当前结果及边界 |
| --- | --- |
| Node24.19.0，原 Bun1.3.14 / OMP18.10.4 | 保留原固定工具链 |
| 新宿主 npm ci / 原生 backend build | 通过；仅 build-only 虚构配置，无数据库连接验收 |
| 当前 Medusa 插件 npm test | 4 passed；真实固定 SDK 与编译产物，不是 live DB |
| 部署契约＋Medusa catalog/edit/http＋Docling OSS | 28 passed，0 failed/cancelled/skipped；有限本地 HTTP 替身及实际 Compose 配置解析 |
| 原有 catalog UI build / 根 typecheck | 通过 |
| plugins:pack-check / build:omp | 14 包闭包及原生 discovery/load/disable/uninstall 通过，模型请求和业务调用均 0 |
| 当前插件重新 npm pack | 26 文件、13212 字节；migration 存在，sha512 完整性与新增宿主锁一致 |
| Docker UI image build | 未通过：本执行环境 build 容器的 registry.npmjs.org DNS EAI_AGAIN；宿主经基础设施代理安装和本地 UI build 通过，不冒充镜像通过 |
| Docker Docling pull | 未通过：failed to register layer: no space left on device；未清理其他镜像/卷/服务，未改 daemon/网络 |
| Medusa API image / 容器、DB migration、人工 admin、live smoke、持久重启 | 未验；不使用 SDK/静态检查替代 |
| Docling 健康、冷启动解析、Host 绑定与精确文件授权 | unconfigured / 未验；未上传真实 Library 资料 |

本轮宿主首次锁安装确有缺项失败；修复新宿主锁后重新实际 `npm ci` 与 build 通过，失败未洗成成功。Docker 环境与目标服务器不同，目标的 Docker 可用空间、私有网络 loopback 端口可达性、非 root 卷写入、迁移行为和所有服务重启仍需现场验证。镜像拉取/Compose config 不等于运行通过。

所有服务内存 caps 合计约5.7GiB，未包含 Docker/主机/构建峰值。父提供目标2CPU/8GB、约6.8GB空闲内存和39GB根盘信息仅为规划输入；Docling 镜像约4.4GB，加上解压、npm及构建缓存，实际峰值和剩余空间必须现场测量。现有 Host 30秒最大解析窗口保持，单 CPU 冷解析是否满足尚未验证。

## 交付与剩余工作

当前交付是可审查的部署源码准备，不是生产部署通过。父协调可在用户已批准的服务器准备完成后按 runbook 验证：构建 → DB/Redis/API/UI健康 → 手工管理员 → 隔离 strict smoke → 重启后持久性 → Docling健康和冷解析 → 原 Host 审核连接/精确传输。缺配置保持 unconfigured。不得自动导入业务资料、删卷、旋转凭据、开放公网或更改原权限。

原生 Medusa 产品与 Library 投影分别保持数据权威，禁双向盲写；其他真实 Worker / Shopify / Brain 商业执行及 DeepSeek 本轮没有推进。此前腾讯云限定矩阵仍只对应其原源码选集与单测试补丁，不能把本轮部署准备表述为该服务器已更新。
