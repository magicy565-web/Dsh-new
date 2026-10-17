# 部署入口及打包修正窗口

基线 `e1efd3f57b4244ad2ec41ecd8c007b63e65df6a1` 的现场部署发现两项阻断。本窗口仅处理同一 PR99 的部署文件，不修改业务、权限、来源 proof 或真实服务器。

## 打包输入遗漏

宿主锁期望插件 tarball `sha512-KOwnDpzIOGylIIdw7rJPIvfzG/h+PlXEe7FXLyIgj9or4dej4q2PIGA8eL0S+r9SzwEBBpMoW1u6fphe3WPRvg==`。npm 即使限制 `files` 为 `.medusa/server`，也会自动纳入根 `README.md`。原 Dockerfile 的 COPY 和对应 dockerignore 没包含 README，因此服务器产生的包无法通过现有锁完整性校验。

第二个确定原因是文件模式：锁对应本地包的所有文件均为0600，Git归档及Docker默认输入/编译产物为0644。npm tar包保留这些模式，因此正文相同也会改变压缩字节和完整性。原6字节差异已由该元数据差异解释。

本修正补齐该 tracked README 的两个构建入口，`COPY --chmod=0600` 固定根package/README模式，`umask 077` 固定全新编译产物模式，并输出 Node/npm 版本；不修改锁，不删除 integrity，不用 force。部署契约新增自动核对真实 `npm pack --dry-run` 的顶层输入是否同时进入 Docker COPY/allowlist，涵盖后续 README/LICENSE 等隐含输入变化，并保留模式固定要求。

复现及修复验证：

- 缺README且全部模式0644：25文件、12160字节，`sha512-eE4DaqCIelTA/PWIBDF34trktrAj8FsSDGgOX4gzUR3zAs23j1gFBTfHtGmJhcrg9rgIcOT5vmFmlNTB/Z/QpA==`，精确匹配父报告服务器失败包；本地原0600产物缺README仅12154字节，初始近似复现没有被误报为精确成功。
- 固定Node镜像内重新干净编译，包含README且显式固定0600：26文件、13212字节，完整性精确匹配不变宿主锁。固定镜像Node24.19.0/npm11.17.0，与本地npm11.9.0所得修复包一致；编译前后包内正文逐字节相同，差异位于模式及README有无。
- 容器为 `network=none`、非root、read-only、cap_drop ALL，读取现有固定SDK依赖，仅在私有临时区编译/打包；没有在此测试安装依赖或真实配置。一次测试挂载把node_modules重命名为/deps导致Node模块解析失败，改成/deps/node_modules后继续，未归咎业务源码。
- 最终部署契约6 passed、0 failed/cancelled/skipped。本地完整API镜像及服务器修复后构建仍待现场，不以这项离线编译/打包验证冒充通过。

若现场补丁后仍出现完整性错误，应保留失败并比较固定工具版本及包内文件SHA/模式，不盲改锁。

## internal-only 发布端口

父报告 Docker29.9.1 中 Docling 容器 healthy/0restart，但 `NetworkSettings.Ports=null`，宿主127.0.0.1:5001拒绝；宿主直连其精确 internal IP 的健康接口200。父另报告容器内/精确IP的合成675字节PDF解析200、正文匹配，引擎约2.47秒，总约6秒，未授权key401。上述是父转录，作者未操作服务器，不代表 loopback 或原 Host 绑定已经通过。

[Moby相同用户报告](https://github.com/moby/moby/discussions/53256)与[精确版本源码](https://github.com/moby/moby/blob/docker-v29.9.1/daemon/libnetwork/drivers/bridge/bridge_linux.go)支持该行为判断；[Docker官方文档](https://docs.docker.com/engine/network/port-publishing/#gateway-modes)确认非isolated internal bridge仍可由宿主访问。Compose静态解析通过不能证明发布端口实际存在，旧验收覆盖不足。

入口方案涉及权限选择，尚未应用：标准受限 nginx 入口需新增代理专用 bridge，只有代理得到该网络默认路由；Docling/API/PG/Redis继续只接 internal，数据库不转发。另一备选是原生 [systemd-socket-proxyd](https://github.com/systemd/systemd/blob/main/man/systemd-socket-proxyd.xml)，不增加容器外网，但需要宿主 socket/service 安装、精确容器身份解析及重建时停止旧目标/失败关闭，不能永久保存旧IP，也不能用 `PrivateNetwork=yes` 隔绝 host bridge。二者均需明确批准对应权限，作者不会自行改服务器或网络策略。
