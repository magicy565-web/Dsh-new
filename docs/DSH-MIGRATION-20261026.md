# 退役独立 Workspace Harness

2026-10-26，用户明确选择 DeepSeek Harness（DSH）为后续执行宿主，要求从仓库
删除独立 Workspace Harness。此变更基于 `release/harness-20261023` 的 `9887d2a`，
在开发分支 `agent/harness-20261023` 实施。

## 删除

- `packages/harness-kernel`、`harness-seams`、`harness-contracts`、`harness-client`。
- 根目录独立组合、`harness.mjs`、独立工作台启动／迁移／冒烟／发布检查脚本。
- 19 个独立工作台插件及其页面／测试，旧 React 客户端的独立工作台插槽与控制台。
- Windows／Electron 工作台安装器源码；专属发布、蓝图与验证说明。
- 依赖 8790 服务的两项 DSH HTTP 桥接、旧应用的产品资料库代理及相关界面。
- 仅独立内核使用的直接依赖 `cordis` 与 `yaml`（其余工具的间接依赖保持原锁定）。

本次从当前源码树删除，不改写分支历史；先前发布提交和其他 checkout 不会被清除。
已安装软件、服务端或本机 `.dsh` / 运行数据不在此仓库清理范围内。

## 保留与迁移

三个原生 DSH 插件完整保留：资料库、Space、可选 Sourcing Agent。
经营记忆领域从旧插件迁至 `packages/domain-business-memory`，产品资料库领域与
Medusa 只读来源迁至 `packages/domain-product-library`。原数据键不变，领域校验、
版本、幂等、人工审核、来源核对和对应回归测试保留。两者没有启动器／监听端口。

这两个领域包尚未接为原生 DSH 插件。不能把保留领域逻辑等同于工具或页面已经上线，
也不能声称旧记忆自动注入仍在工作。下一阶段应复用 DSH 接口完成接入。
如果本机之前安装过旧 HTTP 桥接，应在原生插件管理器中停用／卸载它们。

其他既有应用、OMP、Medusa、企业业务代码保留为迁移来源，本次不扩大删除范围。
原生 SDK 和旧原生 DSH 接入也保留，不能按文件名含 harness 就一并删除。

## 验证

- `npm run build`：原生插件入口／JS 语法／中英文字典。
- `npm test`：原生插件与保留领域回归，使用临时文件和本地测试服务。
- 检查保留代码不再导入已删除的内核、接缝、契约和客户端。

本次静态检查通过，77/77 项测试通过（零跳过），保留代码未发现导入已删除文件。
不调用模型、不安装插件、不修改 profile，不把本地测试作为真实 DSH 挂载验收。
