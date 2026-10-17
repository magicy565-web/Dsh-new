# Medusa provider迁移目录闭包

基线 `6789079fe8578b205f2cbad10d21cf0f1d18d33b`。父报告Docling已通过宿主loopback health/ready200、无key401及合成PDF200正文匹配，原引擎未重启。API最后层构建成功，原8目录不再失败；单次恢复迁移停于 `locking-redis`、`file-local`、`caching-redis` 三个provider缺少目录。已执行迁移up-to-date，未重置；本作者未操作服务器。

本次不再仅依据报错补目录：在无.env的私有临时cwd、清空环境及明确虚构构建值下加载当前编译配置，使用实际Medusa2.21.2 `defineConfig`默认配置和原 `resolveModuleExports` 的discoveryPath规则，展开全部已配置provider和已安装插件模块。未bootstrap服务、连接DB或读取真实配置/凭据。

闭包为27个启用原生模块＋7个provider＋1个Product Context插件模块，共35项；24个迁移目录已存在，缺失11个，恰好为原8项加本次3项。已核查默认必需cache/event_bus、默认auth/fulfillment/notification/search providers和插件模块；search-postgres已有迁移目录，translation/rbac当前禁用。link模块由原生独立DB执行planner处理，不在普通模块迁移集合，不凭缺目录猜测补建。

逐项记录及配置/宿主锁SHA见 [闭包记录](validation/omp-medusa-provider-closure-20261017.json)。回归检查要求最后准备层清单精确等于原SDK解析所得的缺失项，配置或锁改变后必须重新核查。生产代码只改Dockerfile最后准备层的一个清单，增加这三个已安装provider；不触碰SDK源码、现有迁移、锁、业务、入口网络、卷、秘密或运行权限。仍先检查对应dist存在，再mkdir -p，缺包或创建失败即构建失败。

本地有限验证使用完整35路径及24组真实已有迁移内容，分别执行基线/修复后的原样最后RUN；随后在UID1000、read_only、network=none容器中调用实际MikroORM `ensureMigrationsDirExists`。基线只失败于这3个provider，修复后35项全部通过，已有迁移文件逐SHA保持。没有执行数据库迁移，不据此声称现场恢复已成功。

## 原服务器最小应用

在当前6789079源码根目录保留原 `WORKSPACE_SERVICES_STATE_DIR`，只应用本次patch；不要重新应用旧patch。Docling、其入口、DB和Redis保持现状，不重拉或重启其他服务。

```sh
git apply --check /path/to/provider.patch
git apply /path/to/provider.patch
docker compose -p workspace-pr99-medusa -f acceptance/medusa/compose.yaml build api
docker compose -p workspace-pr99-medusa -f acceptance/medusa/compose.yaml run --rm --no-deps --pull never api migrate
```

构建仅最后准备层应改变，依赖/编译层复用cache，不用--no-cache、不重新安装依赖。原DB记录及部分已成功迁移保留，依靠原生迁移记录恢复。单次迁移必须exit0才继续原API/UI启动步骤；失败就停并保留错误，不忽略、不循环、不清库或删卷。现场loopback/真实产品CRUD/持久重启及原Host绑定仍按各自证据验收。
