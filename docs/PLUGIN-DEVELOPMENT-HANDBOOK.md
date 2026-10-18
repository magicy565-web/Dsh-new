# Workspace 插件开发手册

版本：2026-10-18 · 文档交付版 1.0  
源码基线：[`2376015b5749b621ee7ca0d673c2c499323e3976`](https://github.com/magicy565-web/workspace-agent/tree/2376015b5749b621ee7ca0d673c2c499323e3976)  
适用仓库：`magicy565-web/workspace-agent`；适用对象：插件开发者、Work、审查者与集成写入者。

## 0. 先读这一页

本文使用三种标签：

- **【当前实现】**：在以上固定源码中存在；是否实跑另列，源码存在不等于验收通过。
- **【开发规范】**：新增或修改插件应遵守的工程要求；不表示所有历史包都已符合。
- **【待整改】**：已识别缺口或演进建议，尚未实现／验证，不能当作现有 API。

当前有 **15 个 OMP extension／Skill 包**。它们有真实入口和原生加载机制，但完整业务服务、RPC 和界面仍有宿主按业务名称绑定的部分。**独立插件不等于没有受控 Host 依赖；工具包可装卸，也不等于整个业务模块已可装卸。**

本次交付是规范与静态现状审查，**不是 15 包完整验收**。前端开发暂停；本文不增加 UI、运行时、权限引擎、队列或 Agent Loop，也不授权部署、真实服务或模型调用。

配套文件：

1. [实现审计与证据](PLUGIN-IMPLEMENTATION-AUDIT.md)：15 包矩阵、硬编码位置、实测边界及整改优先级。
2. [交付检查清单](PLUGIN-DELIVERY-CHECKLIST.md)：开工、实现、审查、实跑与 PR 交接的可填写模板。

### 0.1 可信代码与工具权限是两回事

**【开发规范】原生 JavaScript 插件是可信执行代码。** 当前 OMP loader 会在 OMP 所在进程／受信执行环境加载插件，插件能运行 JavaScript。Workspace 的工具授权门、白名单、`approval` 元数据、manifest 路径检查和来源回执，**不是恶意插件代码的沙箱**。不能声称这些机制会自动阻止插件直接使用文件、网络、进程或动态导入。

第三方插件须先审查代码来源、依赖、安装脚本、许可、网络和文件行为，再由有权人员批准安装／执行。`plugins:check` 的静态 import 检查和 `--ignore-scripts` 只能缩小部分风险，不能证明代码安全。不要把用户可编辑的上传资料当作可执行插件，也不要让模型自行下载和激活代码。[加载机制源码](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/server/workspace-omp-session.mjs)、[静态检查源码](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/scripts/check-plugins.mjs)。

## 1. 插件边界与现有架构

| 层 | 职责 | 当前例子 | 不应混淆的边界 |
| --- | --- | --- | --- |
| OMP extension | 注册工具、参数 schema、结果和原生 hook | `plugins/workspace-marketplace` | 不是另一个模型／工具循环 |
| Skill | 告诉模型何时用工具、如何判断缺项和追问 | `skills/marketplace/SKILL.md` | 文本指导不创建权限，不执行调用 |
| Host adapter | 将可信身份、当前 Run／Session、来源与原业务接口绑定 | `server/medusa-product-client.mjs` | 不能接受模型自报身份／授权 |
| 原业务服务 | 原订单、资料、Artifact、审批及幂等事务 | `server/worker-desk.mjs`、Library | 不应在工具包中再建一套数据权威 |
| 外部服务 | 解析、ERP、商店、业务数据系统 | Docling、ERPNext、Shopify、Medusa | 连接存在不等于授权、可用或已验收 |
| 外部平台自身插件 | 扩展该平台的模型、路由和服务 | `packages/medusa-enterprise-product-context` | 属 Medusa 插件，不是 OMP 第 16 包 |

**【当前实现】** `projectPlugins()` 选择已安装包；官方 OMP 负责发现 extension、加载 Skill、创建 Session 和模型／工具循环。受控 Host 持有身份、权限、预算、审批、来源、持久化和取消边界。当前仍有专门 profile 与按名称分派的客户端／RPC，详见审计。

**【开发规范】** 新业务优先组合已有工具和 Skill，让模型依据用户目标选择工具、提问、调整方案或停止。后端可保留必要的权限、支付／审批、幂等、来源版本及执行状态机；不要把业务经验写成所有任务必走的 DAG，也不要另造 Loop。

**【待整改】** 统一声明 Host 能力和 UI 贡献的接口尚未完成。本文不定义虚构的 `host.registerPlugin()`、`permissions`、`ui.routes` 等可运行 API。当前开发必须使用已经存在、经审查的接缝；新增接缝先说明范围，再由单一集成写入者实现。

## 2. 开工流程：先确定边界，再写代码

### 步骤 A：固定版本与授权

填写交付清单：基线 SHA、分支、问题／PR、唯一写入者、文件范围、验收环境、预算与不做事项。先检查当前工作树和相关 `AGENTS.md`，不能把旧报告的成功搬到新 SHA。

当前协作基线是原 PR99 开发分支 `codex/omp-all-plugins-integration-20261017`。本轮由既有集成写入者统一入库；并行开发应各用批准的独立分支／副本，不同时改共享 Host、loader、锁文件或配置。当前前端暂停，不把 UI 改动夹带入插件交付。

### 步骤 B：选择最小实现层

1. 只有方法指导：先判断是否只需补现有 Skill，不新增工具。
2. 已有业务 API：写薄 extension 与必要 adapter，复用原服务。
3. 纯转换／校验：放包内纯模块，不创建服务器或持久化。
4. 外部系统扩展：按该系统自己的插件规范交付，并单列其部署／数据库／版本边界。
5. 新增数据披露或写权限：先确认原 Host 权威与审查要求；没有可信绑定就返回明确未配置，不用模型参数填补。

先读相关包 README 和 [FACTORY-PLUGIN-INTERFACES.md](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/docs/FACTORY-PLUGIN-INTERFACES.md)。该文件定义已有材料／客户／询盘 DTO、取消和幂等契约；其中标注“not implemented by this branch”的历史集成建议，须以当前源码核实，不能照抄为全局新接口。

### 步骤 C：先写可审查契约

在 README 写清：用户目标、工具名称、输入／输出、无配置表现、权限来源、读写副作用、取消、未知写入、幂等、依赖、可装卸范围、已有证据与未测项。再写实现和对应测试。接口变更必须同时说明旧调用、旧 Skill 和旧 Session 如何处理。

## 3. 目录、命名和 manifest

**【当前实现】** 标准目录如下；`contracts.mjs`、类型声明和 `sources.json` 按实际需要增加，不是假定的必填 loader 字段。

```text
plugins/workspace-example/
  package.json
  README.md
  AGENTS.md
  src/extension.js
  skills/example/SKILL.md

test/example.test.mjs
test/example-package.test.mjs
```

**【开发规范】**

- 目录 ID 使用 `workspace-<领域>`；npm 包名遵循已有 `@workspace-agent/pi-<领域>`；工具名使用唯一的 `workspace_<领域>_<动作>`。
- 尊重既有兼容名：`workspace-procurement` 的包名是 `@workspace-agent/pi-factory`，不能为整齐而直接改名。
- ESM 入口默认导出注册函数。注册阶段不发业务请求、不自动扫描账号／密钥、不启动模型。
- 包内相对 import 必须留在包内；不要 import `../../server/*` 等仓库私有路径。共享外部依赖须在 `dependencies`／`peerDependencies` 明确声明。
- 不增加 `install`／`prepare`／`pack` 生命周期脚本来偷偷配置环境。当前静态检查会拒绝匹配这些名称的插件脚本。
- `private: true` 表示不作普通 npm 发布，不等于私有数据隔离。
- 当前选择器读取 `manifest.omp || manifest.pi`；现有 15 包使用 `pi`。不要同时声明两份相互冲突的清单。

### 3.1 可复制的真实最小例子

以下是当前 `workspace-plugin-info` 的完整 manifest 和入口，原样可对应仓库文件。它只验证插件加载，不证明服务、模型或业务授权。创建新包时在独立新目录改成唯一名称，并相应更新 Skill；**不要覆盖现有探针**。

`package.json`：

```json
{
  "name": "@workspace-agent/pi-plugin-info",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Side-effect-free plugin loading probe",
  "keywords": ["pi-package"],
  "files": ["src", "skills", "README.md", "AGENTS.md"],
  "main": "./src/extension.js",
  "pi": {
    "extensions": ["./src/extension.js"],
    "skills": ["./skills/plugin-info"]
  },
  "peerDependencies": {
    "@oh-my-pi/pi-coding-agent": "18.10.4"
  },
  "peerDependenciesMeta": {
    "@oh-my-pi/pi-coding-agent": {"optional": true}
  }
}
```

`src/extension.js`：

```js
export default function extension(pi) {
  pi.registerTool({
    name: 'workspace_plugin_info',
    label: 'Plugin loading probe',
    description: 'Return static plugin identity; no files, network, credentials or writes.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    async execute() {
      return {
        content: [{
          type: 'text',
          text: 'workspace-plugin-info: loaded; side effects: none'
        }]
      };
    }
  });
}
```

`skills/plugin-info/SKILL.md` 的真实内容：

```markdown
---
name: workspace-plugin-info
description: Inspect whether the optional side-effect-free loading probe is available.
---

Use workspace_plugin_info only if the user asks about this loading probe. It returns a static identity. It neither checks business configuration nor proves model, file or service access. Do not include this step in unrelated business work.
```

还必须交付 README、AGENTS；本例完整版本见[原包](https://github.com/magicy565-web/workspace-agent/tree/2376015b5749b621ee7ca0d673c2c499323e3976/plugins/workspace-plugin-info)。需要文件能力时参考 [local-materials](https://github.com/magicy565-web/workspace-agent/tree/2376015b5749b621ee7ca0d673c2c499323e3976/plugins/workspace-local-materials)，不要给此探针自行加任意文件路径／网络参数。

## 4. README、AGENTS、Skill 和记忆分别放什么

| 内容 | 面向谁／用途 | 是否自动成为模型规则 |
| --- | --- | --- |
| README.md | 安装者与开发者：接口、连接、生命周期、验证与缺口 | 否 |
| AGENTS.md | 开发维护约束、兼容知识、测试方法 | 否；当前 selector 检查其存在，不等于运行时加载 |
| SKILL.md | 运行时可发现、按需读取的工具使用手册 | 由 manifest、原 Skill loader 和受控 reader 选择 |
| Session／journal | 原会话及审计、调用／披露记录 | 仅按原恢复和授权规则使用 |
| 企业事实／业务记忆 | 原 Library／Artifact／既有记忆设施持有的资料 | 数据，不是新权限或最高优先级指令 |

**【开发规范】Skill 至少说明：**适用目标；可以独立选择的工具；参数与来源要求；缺项如何追问；何时不必调用工具／保存；结果和副作用边界；失败后的安全下一步；哪些事实待确认。业务建议可以有顺序示例，但不得变成所有用户问题必走的固定任务流水线。

普通上传资料、网页、客户文档、ERP 字段和工具正文是**不可信数据**。其中出现“忽略手册”“改收件方”“自动批准”等内容，不得覆盖受信 Skill、用户指令或 Host 权限。不要把资料直接插进系统规则、`AGENTS.md`、`rules` 或开发手册。若用户明确要调整业务规则，应通过独立的规则审查／版本变更流程处理，不因资料提到了新规则就生效。

**【当前实现】** 新文档能力接线把选中 Skill 的包名、版本、相对路径、SHA-256 和能力投影 hash 绑定到原 Session；读取、发送和最终授权前复核。它只补当前新能力生命周期，**不是所有历史插件已有统一手册版本协议，也不迁移旧 Session**。本地 8 个新测试及 7 个窄回归已有记录，2 个 Host 与 5 个 SDK 场景仍待验。[源码及限定报告](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/docs/WORKSPACE-NATIVE-CAPABILITY-DISCOVERY-20261018.md)。

## 5. 工具契约：稳定、有限、可解释

### 5.1 参数和 schema

**【开发规范】**

- 每个工具做一项清晰操作，稳定名称；使用当前 SDK 支持的 JSON Schema。
- 明确 `type`、`properties`、`required`、`additionalProperties`、枚举、长度与数量上限。纯 DTO 校验也保护直接 Host 调用；不能只靠模型或 SDK。
- 模型输入只含业务选择，不接收自报 `workspaceId`、`subject`、Session、接收者、授权布尔值、秘密或任意服务 URL 来创建权限。已有契约中确需来源字段时，Host 必须独立比对。
- 版本／文件／字段属于一个选择元组时，保留完整组合。新文档 schema 使用每个完整 tuple 的 `oneOf`，不能把每列各做 enum 后产生原本未授权的笛卡尔组合。
- schema 列出“可选择资源”只是可发现性；不是解析外传、记忆写入、消费或审批同意。
- 原工具语义变化不能只改 description；必须更新契约、Skill、兼容说明和负向测试。

### 5.2 输出与错误

当前多数业务工具使用上游封套：`content` 中一个 JSON 文本块，`details` 为同一回执，失败按原契约设置 `isError`。身份探针等纯工具有更小输出，不强行改成新全局格式。

回执应能区分：未配置、被拒绝、来源变化、服务不可用、取消、部分完成、已保存草稿以及未知写入。沿用所属业务的现有状态和受审查 reason 代码，不能把未连接说成成功、空结果说成完成、草稿说成批准。

不得把任意异常 message／stack、响应原文、内部路径、令牌、私人正文直接变成模型错误。错误白名单与脱敏测试必须同时覆盖。`partial` 即使 `isError:true` 也可能含已提交资料／来源，不能因此跳过披露复核。

### 5.3 取消、幂等与未知结果

1. 工具入口、远端调用前后、结果交付前检查原 AbortSignal；复用原 RPC 的取消传播。
2. 取消停止后续工作和答案交付，但不自动回滚已经提交的 Artifact／订单草稿。
3. 写操作使用稳定 requestId，绑定原 workspace／用户／会话及精确输入；相同请求复用原记录，修改内容须冲突或明确新操作。
4. 提交成功但应答丢失时返回未知／待核对，不自动换 requestId 再写。**只有原接口明确支持该操作的幂等重试、当前授权仍有效且输入完全相同，才可用原 ID 重试确认。** 相同 ID 本身不保证安全；不满足条件时先按原权限只读对账或交人工核对。
5. 不把取消、超时、零 fetch 或测试替身失败当作“保证未收费／未提交”。付费或业务未知结果要独立核销。

实际范例：[Factory 接口与幂等](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/docs/FACTORY-PLUGIN-INTERFACES.md)、[Marketplace 未知草稿语义](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/plugins/workspace-marketplace/README.md)。不要为统一格式破坏已有外部兼容字段。

## 6. 接入原 Host：权限与来源一直留在可信侧

### 6.1 当前接缝

**【当前实现】** 部分原生包通过 `pi.events.emit('workspace:plugin-host', ...)` 获取可信能力；部分旧 profile 用具名 extension factory 注入 `{client, authorize}`。客户端不是模型构造的对象。原 `server/pi-business-agent.mjs`、`workspace-omp-bridge.mjs`、`workspace-omp-worker.mjs`、`workspace-omp-session.mjs` 串起受控 Host／fd3／OMP。

这是一组已有接缝，**不是稳定公布的通用 Host SDK**。新开发者不能凭本文猜一个接口名。沿用相关包真实工厂签名和原 adapter；涉及共享接线时提交明确接口补丁给唯一写入者。

### 6.2 必须保留的检查

**【开发规范】** 涉及私有资料的工具和 adapter 至少在相关边界验证：

- 原用户／租户／会话／Run 的真实所有权、当前有效性及取消状态。
- 精确模型接收方、固定用途、选中字段、记录／文件版本、原始 asset／来源 hash。
- 当前授权与来源，不能将旧回执、hash、模型 `confirmed:true` 或工具安装当 bearer 权限。
- 提交点同步准入，避免调用前有效、落盘时已撤权。
- 恢复、后续模型调用、原 provider 发送及最终 Node 交付边界的回执复核；不可只在工具最初执行时检查。
- 未配置／权限撤回／来源或手册版本变化时 fail closed，返回明确原因。

不同业务的具体检查点并不完全相同，应继承已有实现并补差异测试。不得把新局部 helper 的通过扩大成整条 Host／SDK／网络发送链已验证。

### 6.3 业务政策与安全状态机分开记录

权限、预算、付款／审批、事务状态、取消和幂等属于可信服务控制。选品方法、建议顺序、评分解释等可放入 Skill，由模型按目标采用；经用户批准的业务准入政策可以继续在后端执行并有明确版本。

例如 Medusa Product Context 的 readiness80 是既有审阅政策，不是普遍安全定律。本次 PR109 保留该规则；本手册不授权删除或调整。规则是否改为可配置，须先核实用户意图、现有审批契约及历史影响。不要为此再造规则引擎。

## 7. 安装、启用、禁用和卸载

### 7.1 当前配置实际支持什么

`plugins/config.json` 当前默认选择：

```json
{
  "extensions": ["./workspace-local-materials", "./workspace-plugin-info"],
  "disabledExtensions": ["extension-module:workspace-plugin-info"]
}
```

**【当前实现】** `extensions` 是相对当前选定插件根目录的`./目录名`，根目录可以是经批准的仓库外受控目录。`disabledExtensions` 可用目录 ID／包名，兼容 `extension-module:` 前缀。`projectPlugins({disabled, none})` 另提供运行选择覆盖。选择器拒绝越界与符号链接路径，不执行安装 hook；但会检查发现的包是否满足现有 manifest／文件要求，因此“禁用”不是允许任意损坏包留在扫描目录。

本地入口已有 `--disable-plugin`、`--no-plugins`、`--plugin-dir`、`--plugin-config` 参数。business Host 的接口更窄：只允许关闭五个指定可选包，Brain／Skill 仍必需。不能把本地配置能力说成 business 可自由组合全部 15 包。[选择器](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/server/workspace-plugin-config.mjs)、[business 约束](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/server/workspace-omp-host.mjs)。

### 7.2 标准生命周期操作

**【开发规范】** 在授权的开发副本中：

1. 审查包及依赖，把完整包置于受控目录；先保持未选中。
2. 校验 manifest、README、AGENTS、Skill、包闭包和无配置加载。
3. 在目标 profile 的批准配置中选择插件；不顺便扩大私有权限。
4. 在新进程／新会话验证可见工具和 Skill。当前 README 约定重启应用配置；没有通用热卸载承诺。
5. 禁用后验证新会话不再发现／调用该工具。
6. 卸载前删除其启用项或明确按目录 ID 禁用；再在测试副本物理移除包。显式选中但缺包应报错，而非换另一能力静默继续。
7. 分别验证本地核心与目标完整 Host 能否启动；静态 import 依赖会使两者结果不同。
8. 验证含该插件历史的会话：必要 guard／版本缺失应拒绝恢复。不得自动剥除证明、改写旧 receipt 或转成公开会话。

**卸载代码不删除业务数据。** Library、Artifact、订单、Session 和审计记录按原数据权限与保留规则处理。不得在 uninstall hook 中清空它们。恢复业务应走原控制，不能通过删除日志获得“干净成功”。

**【待整改】** 全业务模块生命周期、运行中停用、UI 同步隐藏、完整 Host 无包启动并未统一完成。禁止将 loader 级卸载测试宣传成以上全部已实现。

## 8. 依赖、兼容、升级与回退

**【当前实现】** 主要审查版本是 Node 24.19.0、Bun 1.3.14、OMP 18.10.4。旧 Pi 1.1.0 是显式的历史兼容路线；Pi 测试通过不证明 OMP 通过，OMP失败也不能未经批准自动切换到Pi。以根、`support/omp-coding-agent`、`support/omp-bun-linux-x64` 和各独立包的锁文件为准；只安装根依赖不等于OMP运行器已就绪。

**【开发规范】**

- 不使用浮动 SDK 替代锁定版本；不得为让测试导入成功临时换 SDK／Zod 后仍报告原锁验收。
- 包的外部 import 应声明版本；例如 ERP adapter 通过 peer 依赖复用 `@workspace-agent/pi-free-trade@0.1.2`，不能复制另一套 ERP 客户端。
- ERP的独立verify会把两包解到同一临时node_modules；当前根／support锁未自动建立此本地peer映射。全包实际loader前要核对真实解析布局，不能从静态pack通过推断已可加载；本轮未运行build，不宣称该前提已导致本轮故障。
- 独立打包时确认源码、Skill、README、AGENTS、所需资源和 exports 都进入包。`npm pack --dry-run` 不等于真正离仓 import；两项分开验。
- 发布工具名／schema／回执／Skill 变更时，记录 package 版本、源码 SHA、兼容范围及迁移策略。旧 Session 不自动跨 engineScope、接收方、来源或手册 pin 迁移。
- 涉及数据库／外部系统版本迁移：另列备份、迁移、不可逆点、兼容读写及业务回滚方案；源码 PR 不执行生产迁移。
- 回退首先停用受影响能力并回到已审代码与配置；回退代码不等于撤销已经提交的业务写入。必须核对旧 reader 是否能安全理解新数据，不能盲目恢复旧批准或重放未知请求。

## 9. 测试与证据：按层声明，不用一个“通过”包办

### 9.1 证据分级

| 层级 | 可以证明 | 不能由此推导 |
| --- | --- | --- |
| S 静态／语法／pack | 文件、声明、静态依赖、包内容 | 实际 SDK 加载、运行权限、业务接通 |
| P 纯模块／契约替身 | DTO、schema构造、纯逻辑、错误分支 | 官方 SDK、持久化、真实鉴权 |
| H 原 Host＋合成 HTTP／身份 | 指定原 Host／Store／接口路径在合成条件下的行为 | 真实企业／外部服务、实际模型选择质量 |
| K 实际锁定 SDK | 官方 loader／schema／Session／发送路径的特定场景 | 真实模型推理、真实服务、全产品完成 |
| E 真实服务 | 指定服务／版本／范围的真实连接和结果 | 其他服务、真实模型或用户全流程 |
| M 真实模型 | 被批准模型在给定任务中的真实调用 | 稳定业务质量、商业结果或无限预算 |
| U 用户流程 | 指定端到端用户场景，含恢复／取消等 | 未覆盖场景、部署安全或未来版本 |

这是报告标签，不是所有项目必须付费跑到 M 的发布规则。每项写明：固定 SHA、命令、版本、实际组件、替身、测试数、失败／跳过、日期、证据摘要和未验证项。层级可以交叉，不能把同一测试重复累加成总覆盖。

### 9.2 真实存在的命令

从仓库根目录执行。以下是给**有相应测试授权的开发环境**的命令索引，不是默认全部运行，也不是本次文档任务已执行记录。默认开发验收仅使用明确无凭据合成数据与有限模型；先确保原锁定依赖和运行器齐全，缺依赖时保留失败，不临时替换。可用干净环境前缀减少继承凭据：`env -i PATH="$PATH" HOME=/tmp NO_COLOR=1`。这不是网络沙箱，也不是通用秘密检查。

涉及合成新Session的生命周期／恢复回归须在本次批准范围内运行；**先前被安全拒绝的旧receipt恢复不得重跑**。下表并不恢复那项授权，也不默认引导运行总恢复套件。

| 命令 | 覆盖／前提与当前注意点 |
| --- | --- |
| `npm run plugins:check` | 所有发现包的语法、声明、静态 import；S 级 |
| `npm run plugins:pack-check` | 再核对 npm pack dry-run 文件闭包；仍是 S 级 |
| `npm run build:omp` | 固定 Bun／OMP 逐包编译、发现、注册；生命周期探针仅 plugin-info；不执行业务工具 |
| `npm run build` | 与`build:omp`相同，不是Web构建 |
| `npm run workspace -- --check` | 运行器、清单及有限环境预检；零模型，不是完整 Session／业务验收 |
| `npm run workspace -- --profile business --check` | business 清单预检，仍不接通服务／授予权限 |
| `node --test test/workspace-omp-plugins.test.mjs` | 原 SDK 插件／本地 Session 场景；**当前有14常量，15包基线可能失败** |
| `node --test test/workspace-omp-plugin-uninstall.test.mjs` | 七旧业务包移除后本地入口／Session；不等于完整 HTTP Host 卸载 |
| `node --test test/workspace-omp-cloud-acceptance.test.mjs` | 合成取消／恢复和逐包生命周期；**fixture和父断言仍写死14** |
| `node --test test/workspace-omp-unified.test.mjs test/workspace-omp-local-environment.test.mjs` | 入口／环境检查；**也有陈旧14断言，不可预报全过** |
| `node --test test/factory-plugin-interfaces.test.mjs` | 现有工厂 DTO／原 SDK 参数兼容场景，需完整原依赖 |
| `node test/erpnext-enterprise-adapter/verify.mjs` | 离仓实际打包／peer／27项包测试；明确 `actualPiOmpSdk:false` |
| `node --test test/workspace-native-capability-discovery.test.mjs` | 新手册 pin／发现 schema 的8项本地契约／文件测试 |
| `node --test test/workspace-native-document-tools.test.mjs test/enterprise-context-extension.test.mjs` | 现有窄 facade／extension 7项回归 |
| `node --test --test-name-pattern='document capability discovery' test/goal-brain-memory-fact.test.mjs` | 新2项 Host；本检查点因原依赖缺失，未进入测试体 |
| `node --test test/workspace-native-document-mainchain-sdk.test.mjs` | 新5项完整 SDK 场景；待验，不能用8项纯测试替代 |
| `node test/document-provenance-acceptance/run.mjs` | PR110显式三组runner；本地整体exit1，upload4项未执行 |
| `MEDUSA_DISABLE_TELEMETRY=1 npm --prefix packages/medusa-enterprise-product-context test` | Medusa独立锁／构建／包测试；不是OMP测试，也不包含真实PG部署 |
| `npm test` | 顶层后端套件；**不递归ERP／PR110子目录，不包含Medusa独立包测试** |

范围之外的入口另记，不列入默认复制执行步骤：

- `build:web` 是`tsc --noEmit && vite build`；`test:all`包含UI、conversation UI与小程序构建。前端暂停期间不自动执行，也不能用其名称推断包含全部插件。
- `test:provider-live`、`test:provider-native-live`、`test:medusa-live`涉及真实模型／外部服务，须单独确认目标、资料、接收方、费用和授权，不能因手册列名就运行。
- `test:recovery`是独立恢复套件；与既往被拒的旧receipt恢复均不属于本次文档交付的运行授权。

更多专项命令与确切范围见审计附录。当前陈旧断言应由获准代码任务修正并重跑，不应为得到绿灯删除 ERP 包、跳过失败或修改结果标签。文档交付不执行这些修复。

### 9.3 最低场景设计

新插件至少设计：无配置注册、合法输入、额外字段／错误类型拒绝、重复请求、取消、错误脱敏、相同名称冲突、独立打包和原 SDK 注册。带 Host 的再覆盖撤权、换用户／租户／模型、换来源／版本、恢复旧回执、最终交付竞态；写工具覆盖提交前撤权、部分提交、应答丢失及精确重试。关闭／卸载验证新会话和旧历史分别如何处理。

测试里的有限模型步骤是为了稳定检验路径，不是生产 DAG，也不证明真实模型已会自主选择。真实模型／外部服务测试必须另有明确目标、接收方、资料范围、费用上限和可核实剩余额度；历史余额或预算布尔值不足以启动付费。

## 10. PR 交付与后续演进

**【开发规范】**

1. 只提交批准文件范围；代码、契约、Skill、README、测试和脱敏验收说明同步。
2. 只操作批准开发分支；不改／合并 main，不强推、不自动部署、不扩大权限、不发布 npm 或创建凭据。
3. 共享 Host／loader／配置／锁文件变更交唯一写入者；交接固定 source SHA、目标 parent SHA、逐文件清单和冲突检查。
4. 记录已跑／失败／未跑，保留首次失败及最终修复结果；远端 CI 与本地结果分开。
5. 不提交 `.env`、密钥、Cookie、真实业务资料、Session JSONL、原始用户输出、数据库／运行目录或未脱敏日志。提交必要的合成夹具和证据摘要；摘要用 SHA 说明受控原日志，而非泄露原文。
6. 独审后确认最终远端 SHA 与验收 SHA 的差异；若只补文档也注明，不能泛称最新所有源码已经全测。
7. 交付完成后由用户／既有发布流程决定是否部署。PR合入、插件启用、外部服务部署和真实业务授权分别处理。

**【待整改】最小演进路线：**先修正15包测试盘点与证据，再沿现有 loader／事件绑定收束业务特判。用户当前偏向在现成OMP GUI／宿主上二次开发且前端暂停；恢复前端工作后，应依据最终选定的现成宿主接口接入插件页面。现在不设计／实现UI注册协议，不预设必须继续自研React前端。继续复用OMP与原Session，不增加另一Runtime、桌面壳、“插件平台”或规则引擎。

## 11. 参考与阅读顺序

1. 本手册及[交付清单](PLUGIN-DELIVERY-CHECKLIST.md)。
2. [15包实现审计](PLUGIN-IMPLEMENTATION-AUDIT.md)，先看现有能力与缺口。
3. 目标包 `README.md`、`AGENTS.md`、`skills/*/SKILL.md` 和相应测试。
4. [Factory接口契约](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/docs/FACTORY-PLUGIN-INTERFACES.md)、[原社区插件边界](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/docs/PI-FACTORY-COMMUNITY-PLUGINS.md)。
5. [新能力发现限定报告](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/docs/WORKSPACE-NATIVE-CAPABILITY-DISCOVERY-20261018.md)、[PR110有限整合](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/docs/DOCUMENT-PROVENANCE-INTEGRATION-20261018.md)、[PR109有限整合](https://github.com/magicy565-web/workspace-agent/blob/2376015b5749b621ee7ca0d673c2c499323e3976/docs/MEDUSA-PRODUCT-CONTEXT-INTEGRATION-20261018.md)。

历史文档保留其原检查点意义。若历史启动说明与当前代码冲突，以固定源码和较新限定报告核实；尤其不要照旧文档把当前默认离线 TUI 说成自动启动 HTTP／模型服务。
