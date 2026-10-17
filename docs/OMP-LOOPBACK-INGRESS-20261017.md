# Loopback入口修复与单次迁移

基于 `6f41b0ce45334d2bba17ca0ef25ef0e928907541`，仅同一PR99部署源码修复。父转录用户2026-10-17 09:26 UTC批准“仅本机代理入口和专用网络”；授权不延伸到公网、后端外网、服务器操作或其他权限。

Docling新增固定摘要的nginx-unprivileged1.28入口；Medusa复用现有UI nginx，新增9000原生API入口。只有这两个代理分别加入项目专用NAT bridge，显式发布127.0.0.1:5001/4173/9000；Docling/API/Postgres/Redis仍仅接原internal网络。DB/Redis没有监听转发。代理新bridge有其正常默认路由，但仅配置固定上游服务和必要路径，不支持CONNECT或任意目标，不是通用正向代理。

Docling只开放GET/HEAD `/health`、`/ready` 和POST `/v1/convert/file`；未配置密钥值，原X-API-Key原样交给上游验证。同步超时30秒、不重试、6MiB总请求体限制（含multipart开销；原文件上限仍5MiB）、关闭磁盘体缓冲及access log。Medusa仅转发health及原admin/auth/store/agent/uploads/static前缀，保留认证、CRUD和上传。固定服务名由Docker DNS解析，nginx1.28原生resolve在容器重建后更新IP，无持久硬编码IP。配置通过只读Compose configs覆盖已构建nginx，入口本身无需重建API/UI；下述迁移目录修复另需API最后一层更新。

API另设置 `XDG_CONFIG_HOME=/tmp/medusa-config`、`XDG_CACHE_HOME=/tmp/medusa-cache`。真实CLI Configstore在导入package-manager时即写入首选包管理器配置，原只读/home/node路径导致迁移前失败。配置和缓存均在已有/tmp tmpfs内，不持久、不含服务秘密；仍为UID1000/read_only/cap_drop ALL，原/app/.cache、卷、秘密和全部现有限额不变。仅新增Docling nginx64MiB/0.25CPU上限，全部服务内存caps合计5.75GiB，不含主机及构建峰值。

父随后以临时XDG解除CLI阻断，迁移已部分成功，但8个没有迁移文件的模块因目录不存在而尝试在只读node_modules中mkdir失败：`auth-emailpass`、`fulfillment-manual`、`notification-local`、`cache-inmemory`、`event-bus-redis`、`locking`、`file`、`caching`。API Dockerfile只在原最后一个RUN准备层中检查这些已安装模块的dist存在并mkdir -p其migrations，不覆盖任何迁移文件，也不开放runtime写权限。保留已经成功的DB迁移记录，依靠原生记录恢复，禁止重置或清卷。

## 已有服务器的最小更新命令

在原持久源码根目录（e1efd3f最小包已应用6f41b0c）检查并应用本次patch；不要重复应用旧打包patch。保持原已批准的 `WORKSPACE_SERVICES_STATE_DIR`。以下仅是给已授权现场操作者的命令，本作者未在服务器执行。

```sh
git apply --check /path/to/entry.patch
git apply /path/to/entry.patch
chmod 0644 acceptance/docling/nginx.conf acceptance/medusa/nginx.conf
node acceptance/medusa/write-env.mjs --state-dir "$WORKSPACE_SERVICES_STATE_DIR" --check
docker compose -p workspace-pr99-library -f acceptance/docling/compose.yaml config --quiet
docker compose -p workspace-pr99-medusa -f acceptance/medusa/compose.yaml config --quiet
```

两份nginx配置是公开源码，0644用于UID101读取file-backed configs，不涉及私有服务文件；不要更改secrets权限。现在仅增加Docling入口，保留现有healthy引擎，不拉取或重建Docling：

```sh
docker compose -p workspace-pr99-library -f acceptance/docling/compose.yaml pull ingress
docker compose -p workspace-pr99-library -f acceptance/docling/compose.yaml up -d --no-deps --no-build --pull never ingress
docker compose -p workspace-pr99-library -f acceptance/docling/compose.yaml ps
curl --fail http://127.0.0.1:5001/health
curl --fail http://127.0.0.1:5001/ready
```

旧Docling容器忽略的端口请求可以留至其下一次正常维护重建；本次不重启它。实际映射必须出现在ingress容器的NetworkSettings.Ports，不能只看HostConfig或Compose配置。然后更新API最后一个准备层，保留原构建缓存（不要--no-cache或重新安装依赖），进行一次迁移恢复：

```sh
docker image inspect workspace-pr99-medusa-api:2.21.2 >/dev/null
docker compose -p workspace-pr99-medusa -f acceptance/medusa/compose.yaml build api
docker compose -p workspace-pr99-medusa -f acceptance/medusa/compose.yaml up -d --no-build --pull never --wait postgres redis
docker compose -p workspace-pr99-medusa -f acceptance/medusa/compose.yaml run --rm --no-deps --pull never api migrate
```

只有上条迁移exit0后才启动API；失败就保留错误并停止，不重试循环、不清卷。CLI配置在临时/tmp消失是预期，运行容器会重新在自己的tmpfs中生成非秘密首选项。

```sh
docker compose -p workspace-pr99-medusa -f acceptance/medusa/compose.yaml up -d --no-deps --no-build --pull never --wait api
docker image inspect workspace-pr99-medusa-ui:0.1.0 >/dev/null
docker compose -p workspace-pr99-medusa -f acceptance/medusa/compose.yaml up -d --no-deps --no-build --pull never ui
docker compose -p workspace-pr99-medusa -f acceptance/medusa/compose.yaml ps
curl --fail http://127.0.0.1:9000/health
curl --fail http://127.0.0.1:4173/ >/dev/null
```

API既有entrypoint启动前还会执行一次原生迁移检查，本补丁未改变它。若UI镜像尚未首次构建，应由原操作者完成已计划的首次构建；本补丁不要求重建UI或重拉Docling。API只需最后一个RUN准备层改变，其依赖和编译层应显示CACHED。以上没有down、删卷、凭据轮换、管理员自动创建、公网监听、宿主防火墙/daemon修改或真实业务调用。

## 有限本地验证与现场边界

`node acceptance/medusa/check-ingress.mjs`是显式独立Docker检查，要求已有两份固定Node/nginx镜像，缺镜像就失败，不自动pull/build。它使用原nginx配置、原网络属性和非root/read_only/cap_drop约束，只创建带唯一名称的测试项目；后端是有限Node HTTP替身，无数据库、真实解析器、服务秘密或外部调用。实际检查NetworkSettings.Ports的loopback绑定、后端仅一张internal网且无默认路由、原认证拒绝/转发、路径/方法和超大体拒绝、API CRUD前缀及代理重启、日志无测试凭据；最后只移除自己测试项目的容器/网络，无卷操作。测试UI静态页面来自nginx基础镜像，不冒充真实产品UI验收。

首次重启检查因测试published=0被Docker重新分配端口、测试仍使用旧地址而失败；已改成重启后重新读取实际映射，最终通过，没有改变生产固定端口。另以固定Node镜像+实际Medusa2.21.2 CLI在network=none、UID1000、read_only和tmpfs下复现默认路径exit1，XDG修复后exit0，生成偏好文件UID1000/0600。未执行真实DB迁移。

迁移目录另用实际8个已安装模块dist树的副本执行Dockerfile最后一个原样RUN，构建成功；UID1000/read_only/network=none容器中8目录均可读、原有迁移哨兵文件不变、对node_modules新写入精确EROFS。该验证没有安装依赖或连接DB，也不是服务器完整镜像验收。相关6项部署契约及结构化验证哈希见 `docs/validation/omp-loopback-ingress-20261017-summary.json`。

本地Docker28.4.0上的有限入口验证不代表现场Docker29.9.1已通过。父报告现场API镜像构建exit0、58/58源码匹配且打包完整性恢复，原首迁移exit1由CLI配置路径阻断；Docling精确internal IP的合成PDF测试通过。上述现场结果是父转录，作者未操作服务器。修复后实际loopback、迁移、产品CRUD、持久重启、真实UI及原Host授权绑定仍须现场验证；原Host URL/精确传输授权、Mem0关闭及数据权威边界保持。
