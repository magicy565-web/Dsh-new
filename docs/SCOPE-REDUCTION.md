# 收敛清单：DSH 宿主与少量插件

2026-10-26。用户明确要求停止向大而全的平台发展。初次代码审查提交为 de4aee6；下面保留当时的判断。

实施进展：用户随后指定尝试 skill 化，Sourcing 的自建引擎与强制流程已删除，六份 skill 已解除旧工具依赖。
后续已移除 Space 原型及其安装、检查入口；运行数据没有自动迁移或删除。
当前开发环境仍挂载五个 bundle；这是已有实现的状态，不是收敛后的目标配置。

目标入口是 DSH 原生对话。业务方法按需加载为 skill；只有原生能力和现有连接器确实缺少的数据操作才需要插件。
当前没有理由把自建业务面板、阶段引擎或审批台列为通用底座的必备部分。

## 宿主已经提供什么

审查依据为官方 `dsh-v0.2.1-rc.2`（`687f282e`）源码及包说明。
下列能力由宿主／预设组合提供，是否启用仍取决于具体 profile，不能只凭包存在判断已挂载。

| 能力 | 官方实现与边界 | 本仓库的取舍 |
| --- | --- | --- |
| 文件发现、读写、检索 | `dsh-file-reference-local`、`dsh-tool-fs`、`dsh-tool-fs-search`；文件引用发现不等于读取原文 | 复用工作目录及原生工具；不再建通用文件管理器 |
| 文件附件 | `dsh-attachment` / `attachment-local`，原生文件引用、流式读取及摘要／长度校验 | 不再包装成另一套通用附件后端 |
| 会话与跨会话引用 | `dsh-session-reference` 读取有界、不可变的会话快照，标为不可信上下文 | 不再保存自建聊天或复制会话历史 |
| 产物交付 | `dsh-tool-present` 在标准等预设中声明现有文件；它记录路径，不保存不可变产物版本 | 用原生文件与交付入口；确切版本要求需要另证需求，不能声称 present 已提供 |
| 定时唤醒 | `dsh-schedule` 与 `dsh-tool-schedule`，会话绑定、持久提醒及重启恢复 | 删除只有任务字段、不能执行的自建定时任务面板 |
| 业务方法 | `dsh-skill-filesystem` 与 `dsh-tool-skill` 可发现／加载 skill | 提取方法和模板，不以阶段推进代码替代 Agent 判断 |

官方没有因这些能力而自动提供企业产品目录、证书审核、经营事实审批或 CRM。
这些自建功能不是“已有原生等价物”，但也不能因此成为通用底座的必备功能。

## 逐项取舍

| 现有实现 | 判断 | 具体处理方向 |
| --- | --- | --- |
| `dsh-space-workspace` | 已从当前源码移除 | 页面、站点、成员、评论、模拟聊天和任务设置不再作为本项目的产品方向；保留仓库外原有数据，历史代码由 Git 提供 |
| `dsh-sourcing-agent/workflow.js`、`tools.js` | 已完成试点 | 原两文件共 3108 行；已移除 `sourcing_project`／`sourcing_stage`／长期委托包装及强制阶段前缀。只提取可独立使用的方法、证据要求和模板 |
| `dsh-sourcing-agent/skills/` | 已完成试点 | 六份方法已解除 `sourcing_*` 工具依赖，模板按需裁剪；官方注册和独立文件发现均通过 |
| `dsh-workspace-library` | 拆分后按需保留 | 产品／企业 CRUD、SKU 报价、证书审核、就绪度和大面板属于业务目录。确切文档 pin、来源读取可作为小型适配器候选；普通文件操作直接复用 DSH |
| `dsh-workspace-memory` | 退出默认核心 | 人工维护的经营事实库是一种可选业务能力。不能把独立审核面板、状态管理当作 Agent 必备记忆；没有实际需要时不默认挂载 |
| `dsh-inquiry-recovery` | 退出默认核心，冻结扩展 | 来源校验、退订规则有业务价值；导入、身份审核、候选和内容审阅组成了独立询盘子系统，已经超过通用工具范围。不再以修订、审批等扩建推动底座开发 |
| `workspace_context_search` | 暂停，随业务源一起收敛 | 它聚合的是上述自建数据源，不是原生全工作区检索。数据源退出核心后，不能仅为了保留此入口而继续保留整个业务系统 |
| `packages/domain-product-library` | 删除候选 | 仅保留的 Medusa 领域资产，当前没有生产接入；源码中未发现除自身测试外的消费，只有根测试脚本引用。没有当前外部来源需求，不继续接入 |
| 其余两个 `domain-*` | 随对应可选业务能力处理 | 不迁入新“核心”或再建归档目录；保留与否由真实数据操作需求决定，不因已有代码而默认保留 |

## 收敛前的代码证据（de4aee6）

- Space README 明确说明：上传只保存元数据，聊天不调用模型；`index.js` 的 `addMessage`／任务方法仅保存本地条目。
  `SpaceStore` 默认 `seedDemo: true`，还会创建示例页面、站点和任务。它在增加界面与状态负担，而非补齐原生执行。
- Sourcing 的 `cordis.patch.yml` 写明“流程由工具强制执行，不是建议”，并要求首次回复建立项目、开始第一道门。
  `skills/sourcing/SKILL.md` 要求只有 `sourcing_stage advance` 才能推进。即便这个预设可选，其内部仍是代码规定的业务路线。
- 当前五个 bundle 与三个领域包约有 1.54 万行非 test／dev 的 JavaScript；这一数字只衡量维护体量，不代表能力或质量。
  Space 约 3967 行，Sourcing 约 3211 行。优先去掉这两部分，能直接减少平台化负担。
- 文件版本与来源校验不是完全重复建设：原生 `@file` 是路径发现，`present` 指向当前文件，均不能自动等同于企业文档的历史版本／人工审核。
  因此应先确认确切版本是否必要，再提取小适配器，不做虚假的一对一替换。

## Space 后续删减候选的边界

若继续处理 Space，删除该 bundle，同时清理根检查脚本、Client 冒烟、安装提示、默认安装／启动验证和文档中的对应引用。
验收只需证明 DSH 原生会话、文件、交付和其他暂存插件仍可用，不新增页面或替代模块。
不能把 Space 本地任务自动转换为原生计划任务，也不能自动迁移分享／成员记录或触发提醒。
`/workspace/dsh-home`、附件、原生会话和仓库外业务数据必须保留。

Space 已从当前源码、安装和检查入口移除；Sourcing 试点已完成，其余判断仍是待实施清单。

## 官方参考

- [文件引用](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/context/file-reference/README.md)
- [文件工具](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/fs/tool-fs/README.md)
- [附件](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/attachment/attachment/README.md)
- [会话引用](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/context/session-reference/README.md)
- [产物交付](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/deliverables/tool-present/README.md)
- [原生计划任务](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/schedule/schedule/README.md)
- [本地 skill](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/skill/skill-filesystem/README.md)
