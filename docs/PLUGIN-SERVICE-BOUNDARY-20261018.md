# 插件服务边界：规范审查与首个代码增量

后续实现已进入包内领域后端和原 Host/HTTP 生命周期接线；最新范围及验证见 [后端实现记录](PLUGIN-BACKEND-IMPLEMENTATION-20261018.md)。下文保留首个增量的历史边界，不代表后续尚未完成迁移。

基线：`d12bab4d96fb5c92af6b9bbc25695764488e05b9`，PR99 开发分支。
用户目标：业务后端以插件存在，每个插件内置领域服务逻辑，宿主复用统一身份、运行、权限、预算和持久化基础。
本记录是实现提案与开发验收，不修订或自动批准长期标准 1.0.0。

## 对长期标准 1.0.0 的判断

审查用户提供的 33 页 PDF 与本基线 `docs/plugins/PLUGIN-STANDARD.md`、指南及模板相关内容。
总体适合作为工程、安全与交付标准；不能单独作为完整业务模块的可执行接入规格。

| 条款 / PDF 页 | 已符合目标的部分 | 建议补充，尚非已生效强制条款 |
| --- | --- | --- |
| §3 / p5 | 区分 tool、Host adapter、外部服务插件；完整模块声明要求服务、路由、任务、界面及数据生命周期 | 明确业务服务属于插件的领域实现，宿主只持有通用机制及被注入的窄能力；给一个真实服务模板 |
| §4 / p5 | 保留模型自主性，允许真实业务前置条件、事务及经批准准入政策 | 澄清禁止另建通用规则引擎不等于禁止插件内业务规则或必要状态机 |
| §5、§7 / p6–7 | 使用真实 loader，不把概念接口冒称已有 API；复用原权威与输入校验 | 提供服务工厂、方法输入输出、绑定时机及工具/界面复用示例；新接口先实现再写为当前能力 |
| §10、§13 / p7–9 | 不复制事实库，数据必须有权威、归属、保留与删除责任 | 澄清插件拥有自己的领域 schema/命名空间不等于重复数据库；现有数据迁移仍需单独设计 |
| §11、§14 / p8–9 | 已要求完整 Host 无模块启动、在途处置和回归；不冒称热卸载 | 增加完整模块最终准入时的“增删模块无需修改非装配类共享核心”检查；现有迁移逐项列例外，不追求一次重写 |
| §2、§14–15 / p4、9–10 | 有责任人、按风险选择测试、区分代码与生产发布 | 执行时按变更风险选适用项，不为纯文档或纯函数修订机械执行所有真实模型/服务测试 |

原规范已明确小工具与纯 Skill 可以缩小声明范围；不能误读为所有插件都要有数据库、UI或独立服务。
它也没有禁止受审的新接缝；禁止的是把尚不存在的 `registerPlugin` 等写成已支持 API。
本提案不新建通用 loader、权限 DSL、第二 Agent Loop 或跨插件全能服务定位器。

PDF 阅读版的中文使用未嵌入 `STSong-Light`；本环境 Poppler 渲染 p5 出现中文方框，文本提取可读。
阅读版需要嵌入可分发中文字体并重新逐页检查；这不影响 Markdown 内容判断，也不证明所有阅读器都会显示异常。

## 具体实现及接线

两个原 extension 中的受控操作移入各自 `src/service.mjs`，原 extension 直接调用。
这不是新增重复实现，也不是未被使用的服务样例。

| 包 | 工厂 | 返回接口 |
| --- | --- | --- |
| enterprise-context | `createEnterpriseContextService({client, authorize, enabledMethods, nativeCapabilities})` | 仅选中的原命名方法；参数 `(input, signal, model)`；返回原领域 receipt |
| medusa-catalog | `createMedusaCatalogService({client, authorize})` | `status/preview/reconcile(input, signal, model)`；返回原 Medusa receipt |

两包提供 tool definition 投影，extension 负责 `pi.registerTool` 与 content/details 包装。
旧 extension 的公开常量和验证函数保留 re-export，原 Host import 路径不变。
无新依赖，原 manifest 的 `files: [src, ...]` 包含新文件。开发包版本未发布，审查以 Git SHA 为准。

服务是受信进程内接口，不可将其当成已认证 HTTP 路由或浏览器可传入的能力对象。
服务调用不构成最终披露许可；原 client/Session/Run/接收方、Docling 原文件外发、Store 提交、
provider 发送及最终交付检查继续由原权威执行。调用者不能用 `authorize: () => true` 替代生产权限。

兼容细节：企业 authorize 仍要求 true；Medusa authorize 仍使用原“成功返回/抛错拒绝”语义，
不统一成新布尔协议。保持原未配置、取消、错误及回执结果，不新增重试。
企业 enabledMethods 在工厂创建时复制，避免外部数组修改改变既有服务选择；运行时撤权仍由 Host 复核。
schema 每次生成独立副本，防止 SDK 或调用者修改展示 schema 时污染服务校验定义。
这些是本次两项明确的防御性调整，不能据此声称完成恶意代码隔离。

## 实际验证

Node 24.19.0 / npm 11.9.0。私有仓库直接 git clone 因本机无 Git 凭据失败，改用已连接 GitHub 按固定 SHA
获取两个包及指定测试；本地是部分源码快照，不是完整 checkout。

- 原企业 extension/OSS 套件：变更前 14/14，变更后包含在下述总数中，不累加。
- `node --test test/plugin-service-boundary.test.mjs test/enterprise-context-extension.test.mjs test/enterprise-context-oss.test.mjs`：26/26，失败/取消/跳过为 0。
- `node test/plugin-service-parity.mjs /path/to/trusted-baseline`：对精确基线执行 90 个 tool×scenario 比较；注册定义、序列化回执和调用顺序一致。使用合成 client，不是 SDK 运行。
- 原 `scripts/check-plugins.mjs --pack` 在仅含两包、显式全未选中的隔离目录运行通过；原 selector/checker 不改。这证明两包静态 import 与 pack dry-run 闭包，不是全仓15包检查。
- 两包实际 `npm pack --ignore-scripts` 后在仓库外解包，复跑相同26项通过；不重复累计为52项。不运行安装 hook，不安装 peer，不冒称 npm 安装/SDK 加载。
- `git diff --check` 及变更模块语法通过。无真实账号、外部服务、付费模型或生产部署。

新12项覆盖服务/工具同结果与原调用顺序、注册不执行、缺Host/非法额外字段/缺模型、取消、返回前撤权、
失败后的授权检查、错误脱敏与无重试、选中方法稳定、元组 schema 相关性、schema 副本隔离及错误回执拒绝。
原12项OSS测试用实际包逻辑及合成 transport 检查来源/撤权/Docling 发送约束，未连接真实 Docling/Mem0。
测试中少量实际内存 Response/FormData 不代表真实 HTTP 服务。

## 还不能声明的能力及集成门

尚未运行官方 Bun/OMP loader、完整签名 Host、Session 恢复/压缩、真实服务/模型、UI或全仓构建。
未提供完整业务模块卸载；原 `native-host.mjs`、共享 Host、RPC、存储、预算和配置未改。
现有页面也未接新的直调入口；目前复用者是原 OMP extension，后续 HTTP 接入仍须保留原身份/最终响应门。
新 service 没有复制企业资料或 Medusa 的全部服务端领域逻辑；现有原 Host/外部服务仍是权威。

独立审查待完成。本次作者验证不是独审，保持 Draft；在原完整环境先运行相关原 SDK/Host回归与两包生命周期，
通过后由 PR99 整合者选择性集成。不得把过去的186项或其他 SHA 的通过数归到本次。

回退：恢复这两个 extension 原文件，移除两个新 service 文件；README/测试/本记录一并回退。
没有持久字段、数据迁移、配置或外部副作用变更；仍需停止受影响进程并按原生命周期重新加载，不声称热回退。

下一步应先让同一受控服务成为原业务 HTTP 与 Agent 的复用入口，再逐模块移动领域实现与生命周期责任。
通用 Host 挂载契约必须从这些真实接线归纳，不能先造一个全能注册平台再要求所有模块重写。
