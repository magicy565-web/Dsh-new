# Workspace 插件实现审计与证据

审查日期：2026-10-18  
固定源码：[`2376015b5749b621ee7ca0d673c2c499323e3976`](https://github.com/magicy565-web/workspace-agent/tree/2376015b5749b621ee7ca0d673c2c499323e3976)  
配套：[开发手册](PLUGIN-DEVELOPMENT-HANDBOOK.md) · [交付清单](PLUGIN-DELIVERY-CHECKLIST.md)

## 1. 审查方法与结论

本轮只读源码、manifest、测试实现和已提交验收文档，没有运行测试、安装依赖、操作服务器或调用模型／外部业务。相关 `server/`、`plugins/`、`src/`、`scripts/`、`test/` 及 Medusa 目标目录的 **847 个本地源码文件**与固定远端 Git blob 一致。此数字是文件版本核对，不是测试覆盖数。

结论分三层：

1. **工具／Skill 层已经真实插件化。** 15 包都有原生 extension、Skill 声明和实现，不能称为全部空壳。
2. **完整业务模块尚未全面插件化。** 宿主仍点名创建客户端、分派 RPC、组合 profile，React 页面也由主应用静态引入。
3. **生命周期证据不等于完整业务独立性。** 发现、加载、禁用、物理移除、完整 Host 无包启动、旧 Session 恢复和热卸载是不同验收对象。

“需要可信 Host”本身不违反插件独立性；权限／预算／持久化依赖合理。尚需收敛的是仓库内部直接依赖、按业务名的宿主分支和缺少统一的可选模块边界。

## 2. 15 包现状矩阵

所有路径都位于本固定 SHA。默认列指 `plugins/config.json`，不代表其他 profile。标准入口为 `src/extension.js`，Brain 为 `src/extension.mjs`；每包具体 Skill 路径在下表给出。

生命周期共性：通用 `projectPlugins` 能选择／禁用／忽略未选缺包；这不表示当前 business Host 允许任意组合，也不表示所有包已经在本 SHA 实跑装卸。验证证据另见第 6 节。

| 包／版本 | 当前入口、Skill | 默认与实际绑定 | 独立性结论／主要缺口 |
| --- | --- | --- | --- |
| [workspace-plugin-info 0.1.0](https://github.com/magicy565-web/workspace-agent/tree/2376015b5749b621ee7ca0d673c2c499323e3976/plugins/workspace-plugin-info) | `src/extension.js`；`skills/plugin-info` | 默认显式禁用；一个静态身份工具，无Host | 最清晰的独立探针；不证明任何业务能力。原生build生命周期只针对它 |
| [workspace-local-materials 0.2.1](https://github.com/magicy565-web/workspace-agent/tree/2376015b5749b621ee7ca0d673c2c499323e3976/plugins/workspace-local-materials) | `src/extension.js`；`skills/local-materials` | 默认启用；无Host仅公开草稿，有明确selection才有文件能力 | 有真实包内文件／草稿／reference实现；权限选择由Host提供。旧server兼容wrapper仍引用包内模块 |
| [workspace-procurement 0.1.0](https://github.com/magicy565-web/workspace-agent/tree/2376015b5749b621ee7ca0d673c2c499323e3976/plugins/workspace-procurement) | `src/extension.js`；`skills/factory`；包名`@workspace-agent/pi-factory` | 默认不选；existingBinding消费已有Workspace HTTP绑定 | 可独立原生加载的客户端／草稿包；宿主security、Library契约等直接import包内代码，完整Host不能据此保证可删包 |
| [workspace-factory-materials 0.2.0](https://github.com/magicy565-web/workspace-agent/tree/2376015b5749b621ee7ca0d673c2c499323e3976/plugins/workspace-factory-materials) | `src/extension.js`；`skills/factory-materials` | business选择；事件注入materialsClient／authorize；business允许禁用 | 工具层独立；原Library、字段选择和披露服务仍在Host |
| [workspace-factory-customers 0.2.0](https://github.com/magicy565-web/workspace-agent/tree/2376015b5749b621ee7ca0d673c2c499323e3976/plugins/workspace-factory-customers) | `src/extension.js`；`skills/factory-customers` | 默认不选；默认factory无client，功能经专门profile注入 | 一个保存工具；普通加载后unconfigured。原搜索与Artifact保存不是包内独立服务 |
| [workspace-factory-inquiries 0.2.0](https://github.com/magicy565-web/workspace-agent/tree/2376015b5749b621ee7ca0d673c2c499323e3976/plugins/workspace-factory-inquiries) | `src/extension.js`；`skills/factory-inquiries` | 默认不选；专门profile注入原资料／inquiryClient | 一个保存工具；不固定必须写几稿。完整来源复核／持久化依赖Host |
| [workspace-factory-ingestion 0.1.0](https://github.com/magicy565-web/workspace-agent/tree/2376015b5749b621ee7ca0d673c2c499323e3976/plugins/workspace-factory-ingestion) | `src/extension.js`；`skills/factory-ingestion` | 默认不选；独立ingestion profile注入 | 四工具；没有Host默认未配置。入库、原Artifact／Library和幂等在server |
| [workspace-enterprise-context 0.2.4](https://github.com/magicy565-web/workspace-agent/tree/2376015b5749b621ee7ca0d673c2c499323e3976/plugins/workspace-enterprise-context) | `src/extension.js`；`skills/enterprise-context` | 独立配置及Medusa只读组合；business文档能力另行注入选定方法／手册 | 是真实包。Docling／资料／记忆仍由可信Host提供；新schema／手册接线已入源码，完整SDK待验 |
| [workspace-free-trade 0.1.2](https://github.com/magicy565-web/workspace-agent/tree/2376015b5749b621ee7ca0d673c2c499323e3976/plugins/workspace-free-trade) | `src/extension.js`；`skills/free-trade` | 独立free-trade配置；公开／私有模式分开 | 四工具与真实包内客户端；公开招标／纯报价整理较独立，私有ERP受原Host控制。未通用组合到business |
| [workspace-market-validation 0.3.1](https://github.com/magicy565-web/workspace-agent/tree/2376015b5749b621ee7ca0d673c2c499323e3976/plugins/workspace-market-validation) | `src/extension.js`和其monitor模块；`skills/market-validation` | business选择；planClient／monitorClient；允许禁用 | 五工具；计划／监测业务服务仍宿主内建。关工具不删除七天服务 |
| [workspace-shopify-product 0.2.0](https://github.com/magicy565-web/workspace-agent/tree/2376015b5749b621ee7ca0d673c2c499323e3976/plugins/workspace-shopify-product) | `src/extension.js`；`skills/shopify-product` | business选择；productClient／authorize；允许禁用 | 九工具；Shopify连接／发布／审批执行在原服务，完整模块未可插拔 |
| [workspace-medusa-catalog 0.1.0](https://github.com/magicy565-web/workspace-agent/tree/2376015b5749b621ee7ca0d673c2c499323e3976/plugins/workspace-medusa-catalog) | `src/extension.js`；`skills/medusa-catalog` | business或Medusa-enterprise只读组合；medusaClient；business允许禁用 | 三只读工具。普通包无client为unconfigured；Medusa服务／UI不会随其禁用消失 |
| [workspace-goal-intelligence 0.4.0](https://github.com/magicy565-web/workspace-agent/tree/2376015b5749b621ee7ca0d673c2c499323e3976/plugins/workspace-goal-intelligence) | `src/extension.mjs`；`skills/business-brain` | business选择；brain与context guard；正常business配置不允许关闭 | 真实插件，但Host静态import深，当前business必需；不能称为完整可选模块 |
| [workspace-marketplace 0.1.0](https://github.com/magicy565-web/workspace-agent/tree/2376015b5749b621ee7ca0d673c2c499323e3976/plugins/workspace-marketplace) | `src/extension.js`；`skills/marketplace` | business选择；reviewed client及mandatory guard；允许禁用 | 四工具；可选包缺失核心import有专项测试。原Marketplace／WorkerDesk仍在server；完整导航未接通 |
| [workspace-erpnext-enterprise 0.1.0](https://github.com/magicy565-web/workspace-agent/tree/2376015b5749b621ee7ca0d673c2c499323e3976/plugins/workspace-erpnext-enterprise) | `src/extension.js`；`skills/erpnext-enterprise` | 所有现有共享配置均不选；两工具默认未绑定；peer free-trade0.1.2 | 独立包／schema／loader有分层证据；尚无私有Host/RPC/journal/UI/AgentSession集成。不是已接通ERP功能 |

### 2.1 重要包内入口证据

- local-materials `src/extension.js:9–39`：事件绑定、无selection返回公开草稿、受选文件工具。
- procurement `src/extension.js:13–42`：已有绑定与默认extension；不创建凭据。
- customers `src/extension.js:9–17,39`、inquiries `src/extension.js:3–11,36`、ingestion `src/extension.js:13–29,45`：默认工厂没有Host注入。
- materials `src/extension.js:64`、market-validation `src/extension.js:33`、Shopify `src/extension.js:41`、Medusa `src/extension.js:62`、Marketplace `src/extension.js:33`：真实事件绑定。
- free-trade `src/extension.js:10–25,61–63`、`src/native-host.mjs:37–63`：公共能力与私有Host模式。
- ERP `src/adapter.mjs:2,20–32`、`src/extension.js:62`：显式peer与原trusted capability前提。

各包 `README.md`、`AGENTS.md` 与上表Skill都存在。**AGENTS存在不等于自动加载成运行时手册。**

## 3. Loader与配置：已经成立的公共机制

源码：[server/workspace-plugin-config.mjs](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/server/workspace-plugin-config.mjs)。

- 20–28：受控root、config命名、固定配置键和禁用ID。
- 29–41：扫描目录，读取`omp || pi`，校验入口、Skill、README、AGENTS，再决定enabled。
- 45–54：启用缺包报错；禁用／不选缺包可接受；返回selected路径与Skill。
- 不导入业务factory、不管理账号，也不是安装商店。
- 即使disabled，仍会验证存在的包；损坏manifest不是被disabled自动隐藏。
- symlink／越界拒绝不构成恶意JS沙箱。

配置文件：

| 配置 | 当前选择 |
| --- | --- |
| `plugins/config.json` | local-materials生效；plugin-info列出但disabled |
| `plugins/config.business.json` | materials、market-validation、Shopify、Medusa、Brain、Marketplace |
| `plugins/config.enterprise-context.json` | enterprise-context |
| `plugins/config.free-trade.json` | free-trade |
| `plugins/config.medusa-enterprise-readonly.json` | Medusa＋enterprise-context |

没有共享配置选择ERP新包。默认清单也不等于企业全功能默认已开启。

## 4. 完整模块独立性仍受哪些宿主代码限制

### 4.1 profile、工具与RPC特判

- [server/workspace-omp-session.mjs](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/server/workspace-omp-session.mjs)：89起定义大量业务参数；118–136点名加载；189–218选择Skill；518起按业务注入Host；571附近直接传入具名extension工厂。
- [server/workspace-omp-bridge.mjs](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/server/workspace-omp-bridge.mjs)：25–42固定profile组合／互斥；按Marketplace、Medusa、Brain、Shopify、ingestion、marketValidation等方法分派RPC。
- [server/workspace-omp-host.mjs:19–34](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/server/workspace-omp-host.mjs#L19-L34)：business配置只允许disabled五包，Brain／Skill必需。

这些是现有组合和安全范围，不等同“固定业务步骤DAG”。演进时要减少按模块名硬接，但保留经审查的隔离与来源边界，不能直接开放任意组合。

### 4.2 静态依赖使“关工具”不等于“删完整包”

| 宿主文件 | 直接依赖／作用 |
| --- | --- |
| `server/pi-business-agent.mjs:9,14–21` | Brain extension、ingestion／market／Medusa／Shopify／inquiry／customer clients、procurement资料client |
| `server/index.mjs:38–60` | Brain、Library、Shopify、Medusa、Worker／专家服务直接引入 |
| `server/security.mjs:2`、`library-model-read-contract.mjs:2` | 从procurement包复用基础规则／契约 |
| `server/factory-customer-drafts.mjs:5`、`factory-inquiries.mjs:5` | 从对应包导入contracts |
| `server/factory-library-ingestion.mjs:13`、`library-model-read.mjs:5` | 从ingestion包导入contract |
| `server/market-validation-plan.mjs:7`、`market-validation-monitor-client.mjs:4–5` | 从market-validation包导入计划／工具schema |
| `server/shopify-product-client.mjs:7`、`shopify-variant-publication.mjs:4` | 从Shopify包导入contracts |
| `server/medusa-product-client.mjs:4` | 从Medusa工具包导入extension导出的契约 |
| `server/goal-brain-host.mjs:1–3`及多个Brain source adapter | 直接依赖Brain包内部 |

这是静态可核实的依赖链。本轮没有实际删包启动完整Host，故报告“存在导入耦合／尚无完整卸载证明”，不伪造本轮启动失败日志。

Marketplace已有较窄的可选处理：`workspace-omp-business-journal.mjs`按历史需求动态导入contract；`test/workspace-omp-marketplace-optional.test.mjs`验证核心Session和Marketplace model-host在包物理缺失时可import。该特例不能推广成所有模块均可删除。

### 4.3 UI与Worker

- `src/App.tsx:9–20`静态引入Workers／CloudExperts／Brain／Library等；35–56固定路由；293固定导航。
- `src/library/BusinessLibrary.tsx:4–12`固定企业资料／产品／笔记页签。
- `src/library/Products.tsx:3,42`静态挂载MedusaProductPanel。
- `src/marketplace/MarketplacePanel.tsx`有组件实现；未查到src中外部挂载入口，不能宣称Marketplace插件导航已完成。
- `server/worker-desk.mjs:8–37`固定四种服务；它不是15包之一。原Marketplace插件复用它，不把WorkerDesk变成独立可卸模块。

没有查到从OMP包manifest贡献React路由／页面的通用实现。当前前端暂停，本审计只记录事实，不要求本轮新造UI贡献系统。

## 5. 新增手册/schema与外部插件的精确状态

### 5.1 新文档能力发现：已接线，SDK未全验

提交 `fa73a875edda83739ba1a0cc73d968ccc26e65b2` 已纳入基线：

- `server/workspace-omp-session.mjs:48–82`准备／绑定手册pin；212–216交原Skill loader；478–489绑定原native Session ID和能力元组；504–515保留原`workspace_skill`／ReadTool。
- enterprise包构造所选完整资源tuple的schema；Host只披露选中元数据，不把上传正文放入规则。
- 仅加入包声明的enterprise Skill及选定文档方法，不等于启用整个enterprise插件／Mem0。
- 同次运行复验原手册、复制字节及manifest完整字节；同一Session后续恢复比较持久化的插件ID、包名／版本、Skill名称／相对路径／SHA和能力投影hash，不一致则fail closed。`packageSha256`仅是运行内pin，不承诺任意manifest字段修改都会在跨进程恢复时被拒绝；不自动迁移旧Session或旧回执。
- Brain原“先查context”指导已按问题条件化，模型可不调用工具而直接追问。

已有证据：8新本地契约／文件测试＋7原窄回归；2个Host测试因原依赖缺失未进入测试体；5个实际SDK场景待验。依据：[限定报告](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/docs/WORKSPACE-NATIVE-CAPABILITY-DISCOVERY-20261018.md)。不能描述为“模型已端到端按手册自主完成业务”。

### 5.2 PR110资料来源验收：测试交付，不新增权限

固定作者SHA `a8d6a52a9ef23493173cfb96db14eb78823505d0`，集成提交 `8cda1c106aa663c730de33f860cbd22cb6fe0381`。

13个adapter／Host契约＋2个当前跨文档契约用例有有限合成证据；完整runner仍exit1，upload-library的4个测试体未执行。它不被`npm test`递归收集。未改变生产跨文档综合权限；更严格同源规则仅是未决政策候选，不在默认runner。

依据：[整合说明](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/docs/DOCUMENT-PROVENANCE-INTEGRATION-20261018.md)。

### 5.3 PR109 Product Context：Medusa服务插件，不是OMP包

`packages/medusa-enterprise-product-context`依赖Medusa2.21.2；`apps/medusa-acceptance/medusa-config.ts:22`无条件注册它。因此不能称它“默认disabled”；OMP薄catalog插件未配置与这个服务注册是不同边界。

固定作者SHA `b0574b255916921f9f1a4c1c63f8b47d9df05f1a`，已源代码整合至本基线。原readiness80政策保持不变；新增当前产品／规格投影与批准指纹绑定、expected-version／source-hash更新检查、过期批准／畸形历史拒绝等。

证据分开：作者记录原锁构建与11组合成测试；独审记录Node24.19.0的6个helper/schema组，但用Zod4.4.3而包锁为4.2.0，未运行Medusa DI／HTTP／ORM／PG。集成方只做源文件核对与CJS语法检查，不冒充完整包重跑。

仍待：实际PG事务／CAS、DI／认证／事件缓存、真实Host最终披露门。旧自定义catalog UI缺新source hash，与新批准协议不兼容；用户已选择官方Admin，但本次没有交付已验收的Admin批准入口。当前前端暂停。

依据：[有限整合说明](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/docs/MEDUSA-PRODUCT-CONTEXT-INTEGRATION-20261018.md)。

Docling是原enterprise-context adapter调用的外部解析服务；不是新增OMP包、记忆数据库或Agent Runtime。

## 6. 生命周期与构建证据，哪些能说、哪些不能说

| 证据 | 实际范围 | 结论限制 |
| --- | --- | --- |
| 历史`OMP-CODEX-CLOUD-ACCEPTANCE.md` | 旧检查点11包逐个discover／compile／register／disable／delete；有限模型、本地文件 | 不覆盖后加Brain、Medusa、Marketplace、ERP；不代表当前SHA |
| 历史14包整合／Marketplace后续pack/build | 对应检查点14包编译、官方发现／注册、静态pack | 不是15包组合；build中完整启禁卸探针仅plugin-info |
| `scripts/build-omp-native.mjs:11–19` | 遍历全部installed包compile／discover／load | 调用factory但不执行业务工具；不证明Host功能 |
| 同文件21–33 | 只复制plugin-info，做enable／disabled／none／物理删除 | 不能说所有包已逐一完成生命周期 |
| `workspace-omp-plugin-uninstall` | 七旧业务包依次删除后，local-materials原Session仍可本地读写 | 不等于完整server／所有15包／热卸载 |
| ERP独立verify | 两包真实离线pack、字节比对、27项包测试；项目selector生命周期 | runner明确`actualPiOmpSdk:false`，不是官方SDK证明 |
| ERP后续独立kit记录 | 官方loader／schema／两默认定义、启禁卸载 | `modelAgentSession:false`、`privateHostIntegration:false` |
| 新15包组合静态pack | 当前相关说明记载15包静态闭包通过 | 不能合并上述证据声称15包SDK／业务全过 |

历史记录链接：[11包云验收](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/docs/OMP-CODEX-CLOUD-ACCEPTANCE.md)、[14包整合](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/docs/OMP-ALL-PLUGINS-INTEGRATION-20261017.md)、[ERP独立边界](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/docs/ERPNext-DEFAULT-DISABLED-INTEGRATION-20261017.md)。报告是已提交执行记录，本轮没有重新运行或读取其忽略目录中的原始业务日志。

### 6.1 陈旧“14包”断言

当前固定源码仍有：

```text
test/workspace-omp-plugins.test.mjs:10
test/fixtures/workspace-omp-plugins.mjs:47
test/workspace-omp-cloud-acceptance.test.mjs:65,67
test/fixtures/workspace-omp-cloud-acceptance.mjs:29
test/workspace-omp-unified.test.mjs:11
test/workspace-omp-local-environment.test.mjs:60,124,139
```

这些是源码发现的预期过期，不是本轮已运行失败日志。应从真实manifest／预期清单确认覆盖，更新后在同一最终SHA重跑。不要仅将常量14改为15就认为行为已验收。

### 6.2 ERP peer解析前提

ERP `src/adapter.mjs:2`静态import `@workspace-agent/pi-free-trade/adapters`，声明固定0.1.2 peer。根／support锁未为这个本地peer建立安装映射；`Bun.build({packages:'external'})`也不安装它。独立verify专门将free-trade与ERP同时解包到临时node_modules。

因此，全15包官方loader运行前应确认**真实peer解析布局**。静态闭包只验证依赖已声明，不能证明可解析。当前未跑build，不能把此源码前提写成已复现运行故障，更不能随意改锁／替代import来遮蔽。

### 6.3 总命令的范围陷阱

- `npm run build`＝`build:omp`，不是Web。
- `npm run build:web`＝TypeScript检查＋Vite；当前前端暂停，不列入本次默认工作。
- `npm run test:omp`仅统一入口测试。
- `npm test`只收集`test/`顶层`.test.mjs`并排除UI／DOM，**不递归ERP、PR110，不含Medusa包**。
- `npm run test:all`额外涉及UI／conversation／小程序；名字不保证全插件验收，也不覆盖所有独立包。
- package测试可能启动真实Pi／OMP子进程、在临时配置中本地安装／link／卸载；它们不是只读或纯单元测试。默认安全验收使用明确合成数据／有限模型，并单列此类副作用。

## 7. 专项测试索引

以下是定位入口，不是要求自动全部运行。测试授权、锁定环境和本项目旧receipt恢复禁测约束优先。`node --test`接对应文件；已列专用runner的应使用runner。

| 模块 | 真实文件／runner |
| --- | --- |
| procurement | `test/pi-procurement-package.test.mjs` |
| materials | `test/factory-materials-package.test.mjs`、`test/factory-materials-read.test.mjs`、`test/workspace-omp-factory-materials.test.mjs` |
| customers | `test/factory-customers-package.test.mjs`、`test/factory-customer-drafts.test.mjs`、`test/workspace-omp-factory-customers.test.mjs` |
| inquiries | `test/factory-inquiries-package.test.mjs`、`test/factory-inquiries.test.mjs`、`test/workspace-omp-factory-inquiries.test.mjs` |
| ingestion | `test/factory-ingestion-package.test.mjs`、`test/factory-library-ingestion.test.mjs` |
| market-validation | `test/market-validation-package.test.mjs`、`test/market-validation-plan.test.mjs`、`test/market-validation-monitor-tools.test.mjs`、`test/market-validation-pre-service.test.mjs` |
| Shopify | `test/shopify-product-package.test.mjs`、`test/shopify-product-contracts.test.mjs`、`test/shopify-product-client.test.mjs`、`test/workspace-omp-shopify-product.test.mjs` |
| local-materials／probe | `test/workspace-local-draft-parity.test.mjs`、`test/workspace-local-references.test.mjs`、`test/workspace-omp-plugins.test.mjs`及相关local测试 |
| free-trade | `test/free-trade.test.mjs`、`test/free-trade-host.test.mjs`、`test/free-trade-native.test.mjs` |
| enterprise-context | `test/enterprise-context-oss.test.mjs`、`test/enterprise-context-extension.test.mjs`、`test/enterprise-context-host.test.mjs`、`test/enterprise-context-unified-egress.test.mjs`、`test/workspace-omp-structured-memory.test.mjs` |
| Brain | `test/goal-brain-pi-extension.test.mjs`；其余`goal-brain*.test.mjs`含原Host／Store依赖，不能统称纯测试 |
| Marketplace | `test/marketplace-plugin.test.mjs`、`test/workspace-omp-marketplace.test.mjs`、`test/workspace-omp-marketplace-wire.test.mjs`、`test/workspace-omp-marketplace-optional.test.mjs` |
| Medusa catalog | `test/medusa-catalog.test.mjs`、`test/medusa-catalog-http.test.mjs`、`test/workspace-omp-medusa-enterprise.test.mjs`、`test/workspace-omp-business-integration.test.mjs` |
| ERP | `node plugins/workspace-erpnext-enterprise/scripts/build.mjs`；`node test/erpnext-enterprise-adapter/verify.mjs` |
| PR110 | `node test/document-provenance-acceptance/run.mjs` |
| Medusa Product Context | `MEDUSA_DISABLE_TELEMETRY=1 npm --prefix packages/medusa-enterprise-product-context test`；需其原独立锁依赖 |

不能为其余包统一杜撰“cd包目录 && npm test”：多数包没有该脚本。`test:provider-live`、`test:provider-native-live`、`test:medusa-live`是另有外部／模型／服务风险的入口，须独立范围与预算许可，不属于本手册默认步骤。`test:recovery`及既往被安全拒绝的旧receipt恢复也不由本文授权重跑。

## 8. 整改建议：沿已有接口逐步收敛

### P0：验收真实性与版本边界

- 修正陈旧14断言，确认15包的逐包行为覆盖；验证ERP peer实际解析。
- 明确`npm test`范围，独立列ERP／PR110／Medusa与新SDK5、Host2。
- 每个报告绑定最终SHA、锁版本、实际／替身组件及失败／未跑；不以统计合并代替验收。
- 不因此执行先前被拒的恢复测试，也不擅自修复共享代码；另行批准测试任务。

### P1：工具插件与Host模块边界

- 优先在现有loader／`workspace:plugin-host`／原fd3中渐进收敛点名client、RPC、profile分支。
- 公共基础契约不长期反向依赖可选业务包内部；需要移动时保留兼容exports并独审。
- 模块按需绑定原服务；“关闭工具”“不挂载业务服务”“物理移除包”分别定义。
- 保留原权限、预算、审批、事务、来源、最终披露与取消门，不把它们搬成可被普通文档覆盖的文字建议。

### P2：待恢复前端工作后的界面整合

- 用户偏向现成OMP GUI／宿主二次开发，当前前端暂停。恢复后依据选定现成宿主接口接入插件页面；现有React页面只作为现状和可复用资产，不预设继续自研前端。
- 现在不设计／实现UI注册协议；不能把建议中的UI manifest当成已实现接口。
- Worker服务目录可逐步成为模块贡献，原WorkerDesk继续掌管执行／审批。
- 当前不换DSH、不新建桌面壳、不新造Runtime、规则引擎或插件平台。

这些是分阶段建议，不属于本次文档交付已完成的代码。
