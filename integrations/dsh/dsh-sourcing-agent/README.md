# Sourcing skills

七份按需使用的方法与模板，供 DSH 原生会话完成当前任务：

| Skill | 用途 |
| --- | --- |
| sourcing | 识别当前问题，选择需要的方法 |
| export-supplier | 买家核验、供货条款、开发信与询盘回复 |
| dtc-brand | 定位、供应商、单位经济、店铺与复盘 |
| market-evidence | 来源、口径、引用与估算 |
| opportunity-pack | 按请求整理文件和交接材料 |
| long-term-mandate | 用户明确要求持续工作时，使用工作记录及原生提醒 |
| buyer-magazine | 复用独立 dsh-buyer-magazine 的网站编辑、十模块与统一生成能力 |

每份可独立使用。用户只要一封回复就交付回复；不要求先建立项目、完成其他文档或推进商业阶段。
模板中的数字、预算、条款是示例，不替代实际来源或用户确认。

## 在 DSH 中使用

已有用户可继续安装此本地 bundle：

```text
plugin_manager install_bundle target=<checkout>/integrations/dsh/dsh-sourcing-agent
```

选择原生 `Sourcing Agent` 预设后，DSH skill 目录提供这些方法，由 Agent 按需加载。
`index.js` 只注册 skill 并管理卸载；预设组合使用原生文件、搜索、会话、交付、提醒等工具。
它没有独立状态或自动化引擎。微刊工具由依赖的 dsh-buyer-magazine 提供；其余方法需要文件时用原生文件工具生成，再由 present 交付。安装本地源码时先运行根目录 npm ci --ignore-scripts，并让宿主可以解析杂志包；独立使用网站转杂志可只安装该包。

也可以仅把所需 skill 目录放入实际工作区的 `.agents/skills/` 或 `.dsh/skills/`，
使用 DSH 标准预设的原生 skill-filesystem 发现；保留该目录下的 templates，避免覆盖已有同名技能。
无需安装专用业务预设即可使用这些文件型 skill。目录由用户或开发者选择，不会自动复制到其他工作区。
微刊 Skill 的唯一目录位于依赖包 dsh-buyer-magazine/skills/；完整生成还需该包的原生工具，不能只复制说明文件就声称已经安装生成能力。

## 本次收敛

已移除自建项目／阶段／策略／长期委托工具、阶段渲染器、状态存储实现及对应演示脚本。
旧项目文件、原生产物和原生提醒属于用户运行数据，本次不迁移、不删除、不自动恢复。
已有提醒若正文引用旧业务工具，需针对确切提醒单独处理，不能把旧配置自动当作新的授权。

源码中的旧实现可从 Git 历史恢复；当前树不保留第二套引擎或归档副本。
Space、资料库、记忆和询盘模块不属于本次试点改动。

## 验证

仓库根目录运行 `npm run check`，覆盖 skill 注册／卸载、模板可达性和 bundle 公共入口。
可选的官方 skill 注册与文件型发现验证（临时环境、无模型请求）：

```sh
DSH_RUNTIME_DIR=/workspace/dsh-runtime node integrations/dsh/dsh-sourcing-agent/dev/native-smoke.mjs
```

后续具体任务由原生 DSH Agent 执行，skill 本身不注册阶段工具、不代替用户授权，也不承诺经营结果。

## 买手微刊模块

微刊已统一由 [dsh-buyer-magazine](../dsh-buyer-magazine/README.md) 拥有。此包通过依赖复用同一份 Skill、十种内容模块与编译器；原脚本路径仅保留转调兼容，不再维护独立渲染器。每期明确选择 blocks，支持重排、重复类型及不同产品的不同组合；不自动补全全部模块。

输入格式见 [统一字段说明](../dsh-buyer-magazine/skills/buyer-magazine/MODULES.md)。在 DSH 中可以要求：

> 使用 buyer-magazine 创建本期微刊，只包含产品展示、新品首发、样品申请；缺失资料保持待确认。

创建通过对话完成。资料来自实际可读的用户电脑工作区或工单上传附件；样品、采购及独家权益等交易由 ERP 承担。具体边界见 [架构说明](../../../docs/BUYER-MAGAZINE-ARCHITECTURE.md)。

当前已实现模块和文件渲染；可选 [mini-erp](../dsh-mini-erp/README.md) 提供本机原生交易工具。工单附件接口、用户电脑远程接入及买手交易网页尚未实现。渲染器不发送或发布，不在本地模拟名额锁定。
