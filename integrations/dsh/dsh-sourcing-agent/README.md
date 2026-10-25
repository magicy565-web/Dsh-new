# Sourcing skills

六份按需使用的方法与模板，供 DSH 原生会话完成当前任务：

| Skill | 用途 |
| --- | --- |
| sourcing | 识别当前问题，选择需要的方法 |
| export-supplier | 买家核验、供货条款、开发信与询盘回复 |
| dtc-brand | 定位、供应商、单位经济、店铺与复盘 |
| market-evidence | 来源、口径、引用与估算 |
| opportunity-pack | 按请求整理文件和交接材料 |
| long-term-mandate | 用户明确要求持续工作时，使用工作记录及原生提醒 |

每份可独立使用。用户只要一封回复就交付回复；不要求先建立项目、完成其他文档或推进商业阶段。
模板中的数字、预算、条款是示例，不替代实际来源或用户确认。

## 在 DSH 中使用

已有用户可继续安装此本地 bundle：

```text
plugin_manager install_bundle target=<checkout>/integrations/dsh/dsh-sourcing-agent
```

选择原生 `Sourcing Agent` 预设后，DSH skill 目录提供这些方法，由 Agent 按需加载。
`index.js` 只注册 skill 并管理卸载；预设组合使用原生文件、搜索、会话、交付、提醒等工具。
它没有独立状态、业务工具或自动化引擎。需要文件时用原生文件工具生成，再由 present 交付。

也可以仅把所需 skill 目录放入实际工作区的 `.agents/skills/` 或 `.dsh/skills/`，
使用 DSH 标准预设的原生 skill-filesystem 发现；保留该目录下的 templates，避免覆盖已有同名技能。
无需安装专用业务预设即可使用这些文件型 skill。目录由用户或开发者选择，不会自动复制到其他工作区。

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
