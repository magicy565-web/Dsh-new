# 插件开发者上手指南

配套规范：**1.0.0**。先读 [长期标准](PLUGIN-STANDARD.md)，再按本指南完成一个边界明确的变更。模板见 [PLUGIN-TEMPLATES.md](PLUGIN-TEMPLATES.md)，每次验收使用 [ACCEPTANCE-CHECKLIST.md](ACCEPTANCE-CHECKLIST.md)。

本指南中的路径和命令是项目现有实现的导航，**不是不可变化的 API 承诺**。实施时检查当期文件、锁和脚本；变更这些入口的开发者负责同步更新指南。本文不固定任何 SDK 版本，也不承诺一次根测试会覆盖所有插件。

## 1. 先决定你真正需要交付什么

用一句话写用户目标，再选择最小层：

| 需求 | 通常从哪里开始 |
| --- | --- |
| 已有工具足够，只缺判断与使用方法 | 修改已有 Skill，并验证原 loader 实际读取 |
| 纯计算、转换或校验 | 包内纯函数＋必要工具；无需新服务或数据库 |
| 暴露原业务 API | 薄 OMP extension＋已有受控 Host adapter |
| 扩展外部平台模型／路由 | 平台自身插件；单列该服务安装、数据迁移和部署验收 |
| 声称整个业务模块可以装卸 | 同时处理工具／Skill、Host 挂载、任务、界面（如有）、数据和外部依赖 |

先写“不做什么”，避免为一个工具引入新 Loop、注册平台、调度器或记忆库。完整模块可装卸是较大的验收范围，不是所有纯工具包的最低门槛。

## 2. 建立自己的工作边界

在项目根目录执行下列只读检查；这里不读取 `.env`、账号配置或运行数据：

```sh
git status --short
git branch --show-current
git rev-parse HEAD
node --version
npm --version
node --input-type=module -e 'import fs from "node:fs"; const p=JSON.parse(fs.readFileSync("package.json","utf8")); console.log(JSON.stringify({engines:p.engines,scripts:p.scripts},null,2));'
```

填写：任务目标、自己的开发分支、可改目录、共享文件写入者、审查者、允许的测试类别、交付与停止条件。遵守项目受保护分支和批准的发布流程；不要直接在受保护分支开展普通开发。创建分支和提交本身不授权部署、付费、创建凭据或扩大权限。

读取仓库和目标目录实际存在的 AGENTS、README、Skill 及相关测试。若没有根 AGENTS，不需要人为补一份才能开发。并行任务不能同时修改共享 Host、loader、锁或选择配置；由指定整合者协调。

## 3. 找到真正的 loader、锁与原接口

### 3.1 实现导航

以下路径从项目根开始，点击链接可进入源码：

| 要查的事实 | 当前位置 | 重点 |
| --- | --- | --- |
| 包选择与路径校验 | [server/workspace-plugin-config.mjs](../../server/workspace-plugin-config.mjs) | `projectPlugins`；选择配置；disabled／none；它不执行安装 |
| 原生 Session／Skill 接线 | [server/workspace-omp-session.mjs](../../server/workspace-omp-session.mjs) | 原 SDK 发现／注册；选中手册；Host 能力；来源与最终披露 |
| Host 接收与工具边界 | [server/workspace-omp-host.mjs](../../server/workspace-omp-host.mjs) | 入口实际允许哪些配置与可选包 |
| 原业务 RPC | [server/workspace-omp-bridge.mjs](../../server/workspace-omp-bridge.mjs)、[worker](../../server/workspace-omp-worker.mjs) | 当前 profile、原请求／取消与安全错误 |
| 业务客户端构造 | [server/pi-business-agent.mjs](../../server/pi-business-agent.mjs) | 现有原身份／Run 绑定；名称含 Pi 不等于应另建运行时 |
| 运行时锁定与校验 | [server/workspace-omp-runtime.mjs](../../server/workspace-omp-runtime.mjs)、[support](../../support) | SDK、运行时二进制和完整性须共同匹配 |
| 本地入口参数 | [scripts/workspace-omp-local.mjs](../../scripts/workspace-omp-local.mjs) | 当前参数为 `--plugin-dir`、`--plugin-config`、`--disable-plugin`、`--no-plugins` |
| 静态／打包检查 | [scripts/check-plugins.mjs](../../scripts/check-plugins.mjs) | 语法、声明、资源、静态 import 与 pack closure；非沙箱 |
| 构建与探针 | [scripts/build-omp.mjs](../../scripts/build-omp.mjs)、[native 构建](../../scripts/build-omp-native.mjs) | 真正运行了哪些发现、注册与生命周期场景 |
| 主测试枚举 | [scripts/test-backend.mjs](../../scripts/test-backend.mjs) | 是否递归、过滤哪些文件、专用 runner 是否另跑 |

`projectPlugins` 的现有配置使用 `extensions` 与 `disabledExtensions`，包使用 `pi.extensions` 与 `pi.skills`。选择配置中的路径相对于所选插件根；项目 API 允许的配置范围仍由相应 Host 入口决定。不要把 CLI 可以传路径推断成远端调用者可以任意选代码目录。

现有 selector 还会验证已安装但未启用包的 manifest／资源。因此“禁用包”不自动等于“忽略它的损坏文件”，物理移除与禁用必须分别验证。manifest 检查不执行模块 factory，也不隔离运行中的插件代码。

### 3.2 按当期锁确认环境

在项目根查看已批准的版本声明和原锁，不输出任何秘密：

```sh
node --input-type=module <<'NODE'
import fs from 'node:fs';
for (const file of [
  'package.json',
  'support/omp-coding-agent/package.json',
  'support/omp-bun-linux-x64/package.json'
]) {
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(file, JSON.stringify({ engines: p.engines, dependencies: p.dependencies }));
}
for (const file of [
  'package-lock.json',
  'support/omp-coding-agent/package-lock.json',
  'support/omp-bun-linux-x64/package-lock.json'
]) {
  const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(file, JSON.stringify({ lockfileVersion: lock.lockfileVersion }));
}
NODE
```

锁文件、包声明、运行时完整性记录和源码 verifier 必须相容。只改一个版本字符串，或临时安装另一个校验库，不能称为原锁验收。若包带独立 lock 或 peer，继续核对该包；peer 声明不能替代目标环境的实际解析。

需要安装依赖时，先确认来源、安装脚本、许可、目标平台和本次安装授权，再依当前项目说明从原锁安装。不要在文档里用 `npm install latest` 修复版本不匹配，也不要自动改 lock。安装可能有网络和代码执行，不包含在上面的只读检查中。

## 4. 先写契约，再写实现

从模板复制到插件 README 或专用契约文档，至少填完：

1. 用户目标、非目标和插件层。
2. 工具名、输入 schema／运行时校验、输出与错误。
3. 无 Host、无配置、缺依赖时的行为。
4. 原身份、接收方、用途、来源与授权入口。
5. 读写／外传／费用、副作用提交点。
6. 取消、幂等、并发冲突和未知结果的处理。
7. Skill 如何被发现、如何让模型按目标组合能力。
8. 安装／启禁／卸载的真实边界，数据保留和兼容计划。
9. 需要哪些验收层、哪些暂不声明。

有业务规则时标明：硬前置条件、安全约束、经批准准入政策，还是可由模型判断的建议。后者优先写在 Skill；不要为了让示例跑通把整段业务流程焊进 Host。

对接现有材料／客户／询盘时，先读 [Factory 接口契约](../FACTORY-PLUGIN-INTERFACES.md) 并对照当前实现；其他领域读取其自己的原接口。不要拿某个领域的 DTO 或历史建议扩张成全局 `registerPlugin` API。

## 5. 从最小真实包开始

参考 [workspace-plugin-info](../../plugins/workspace-plugin-info) 的真实 `package.json`、`src/extension.js` 和 `skills/plugin-info/SKILL.md`。它展示原 `pi.registerTool` 和静态、无副作用返回；可复制的新命名示例见 [模板](PLUGIN-TEMPLATES.md)。

常规包结构：

```text
plugins/workspace-<domain>/
  package.json
  README.md
  AGENTS.md
  src/extension.js
  skills/<domain>/SKILL.md

test/<domain>.test.mjs
```

上面是命名结构，尖括号不是可直接执行的路径。只有需要时才增加 contracts、类型、资源、迁移或包内测试。新包先在隔离副本／批准分支中开发，不自动加入默认产品配置。

extension factory 只注册；测试前不得偷偷探测真实账号、加载凭据、请求模型或写业务数据。输入校验、工具描述和返回类型必须相互一致。未配置工具应报告未配置；不能为了“开箱即用”发明回退账号或服务。

若需要 Host，沿现有 factory／client 接缝接入。分别审查 Session、worker RPC、bridge、原业务服务及最终披露是否需要变动；具体领域并非全部经过同一套接线。纯探针不需要 Host，不能为了套模板新增这些文件。

## 6. 写好四类说明

- **README**：面向使用者，写清能力、依赖、启禁、权限、错误、兼容和证据。
- **AGENTS**：面向开发者，写代码边界、测试和维护陷阱；不存企业事实或秘密。
- **Skill**：面向运行时模型，写适用目标、工具选择、缺项追问、可跳过建议和停止条件；验证实际 loader 能读到。
- **企业记忆**：由既有业务系统承载事实、来源与更正。不能在 Skill 中固化某客户当前订单，也不能让普通资料覆盖策略手册。

不要把 AGENTS 被开发工具读取当作 OMP Skill 已接入。不要把完整手册直接硬塞提示词作为默认替代加载器。

## 7. 在明确范围内验证

### 7.1 先建测试计划

先列出 S／P／H／K／E／M／U 证据层和用例，默认采用无凭据合成数据。合成 HTTP、模拟客户端、真实原 Host、真实原 SDK、真实外部服务和真实模型必须分别标注。日志只保存脱敏必要信息。

常规顺序是：静态与契约 → 原 SDK／原 Host 的相关边界 → 生命周期 → 受影响回归。外部服务、模型与完整用户流程按实际发布声明另设验收门。该顺序是开发方法，不是运行时强制业务 DAG。

### 7.2 现有命令与范围

以下命令均从项目根运行；先查看当期 `package.json` 及对应脚本。它们是候选命令表，**不是一段应整体粘贴执行的脚本**。文档没有替你确认其环境、授权或依赖已就绪。

| 命令 | 实际入口与当前范围 | 主要边界 |
| --- | --- | --- |
| `npm run plugins:check` | `scripts/check-plugins.mjs` | 静态语法、manifest、资源和 import；不执行 factory、不证明加载或沙箱 |
| `npm run plugins:pack-check` | 同上加 `--pack` | `npm pack --dry-run --json --ignore-scripts` 的文件闭包；不是安装和原 SDK 验收 |
| `npm run build:omp` 或 `npm run build` | `scripts/build-omp.mjs` | 原运行时校验、pack 检查及 native 构建／发现；探针覆盖范围必须读脚本，不代表每包完整生命周期 |
| `npm run test:omp` | `test/workspace-omp-unified.test.mjs` | 专门 OMP 用例；不等于全部插件与 Host 实跑 |
| `npm test` | `scripts/test-backend.mjs` | 当前枚举 test 顶层并过滤 UI／DOM；不递归所有子目录和独立包 |
| `npm run typecheck` | `tsc --noEmit` | 类型检查；不能证明纯 JS 插件行为和授权 |
| `npm run build:web` | `tsc --noEmit && vite build` | Web 构建；只有变更范围涉及相应界面时选择 |
| `npm run test:all` | 当期根脚本定义的组合 | 名字中的 all 不保证所有包内／专用 runner；先查清范围 |

为目标插件增加或选择精确测试文件，执行其真实命令并写入证据。独立包测试使用该包 README 的工作目录和脚本；不能把包内测试不存在于根 runner 误判为已自动覆盖。

若检查失败，保留原错误并区分代码缺陷、环境不匹配、依赖缺失或测试发现清单过期。修正应恢复真实覆盖，不能删包、去掉守卫或跳过失败来获得绿色结果。

### 7.3 有额外授权门的命令

`test:provider-live`、`test:provider-native-live`、`test:medusa-live` 等可能访问真实服务或产生费用。只有该轮明确批准环境、接收方、数据、账号、费用与停止条件后才可运行；不得放进默认无凭据验收步骤。

恢复／迁移测试必须先核对 fixture、入口和副作用：纯合成恢复测试可在批准开发范围内验证；真实历史会话、回执、数据库或已被安全拒绝的操作不能借“跑测试”重放。此前拒绝不会因清单出现此项而失效。

`dev`、`start`、`factory:local` 不是纯静态检查。即使使用预检参数，也要先查看其当前实现会读取哪些选定文件、配置和路径，避免把开发探针导向真实用户资料。

## 8. 分别验收生命周期

在独立临时副本／测试安装中验证，不删除开发者正在使用的插件目录或业务数据：

1. 包存在但未选择：不自动激活。
2. 按批准配置启用：原 SDK 注册正确工具与 Skill；无 Host 按契约未配置。
3. 禁用后重建进程／Session：调用入口消失；其他能力保留。
4. 解除链接与物理移除分别验证；显式启用缺包应给出清晰错误。
5. 声称完整模块时，运行完整 Host 无包启动及其他模块回归；检查静态 imports、RPC、后台任务和界面引用。
6. 受保护旧历史缺守卫或不兼容时拒绝恢复；不降级权限使其通过。
7. 升级、弃用和回退分别验证；热卸载只有真实实现并测试后才声明。

记录哪些步骤只在纯 helper、哪些在原 SDK、哪些在完整 Host 中完成。包编译通过不能代替上述列表。

## 9. 审查、集成与发布

先自查，再由独立审查者核对最终版本的契约、代码与证据。共享写入者按清晰文件边界整合，复核最终树、依赖和测试差异；不要把源分支日志直接当最终整合结果。

PR 使用项目批准流程，附：用户目标、改动／不改范围、兼容、清单、已跑与未跑、例外、配置／迁移、回退以及负责人。未完成的关键验证保持显式阻塞，可用 Draft PR 表示审查中。

发布依据受保护分支、制品和环境的批准流程进行。合并代码不等于安装／启用插件，发布包不等于生产迁移，部署服务不等于用户已授权资料披露或付费。

## 10. 完成定义

完成应能回答：这个插件是什么层、可独立做什么、依赖哪个原 Host、谁维护、如何安全启禁、数据如何保留、哪个版本在哪些环境被测、哪些失败／未验、如何迁移和回退。答案落在 README、契约与验收记录，而不是只留在聊天里。

如遇文档和代码矛盾，报告具体路径与行为，更新相应文档或实现并重新验证受影响范围。不要把某次临时环境限制写成下一位开发者必须永久遵守的架构规则。
