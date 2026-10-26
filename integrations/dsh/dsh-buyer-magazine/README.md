# 网站转买手杂志 · dsh-buyer-magazine

版本 **0.2.0**，面向官方 `@deepseek-ai/dsh@0.2.1-rc.2`。这是可单独安装的 DSH 原生插件，提供自己的「网站转杂志」Agent 预设、一个 Skill、四种主题及生成工具。无需安装 Sourcing、资料库或 ERP。模型、会话、权限、文件与交付复用 DSH。

## 安装与使用

```sh
dsh plugin --profile web add /absolute/path/dsh-buyer-magazine-0.2.0.tgz
dsh web
```

开发时也可通过 `link:/absolute/path/integrations/dsh/dsh-buyer-magazine` 安装。插件包含完整的运行资源，压缩包安装不依赖源码仓库或相邻目录。

在原生新会话中选择「网站转杂志」、工作区和宿主已配置的模型，然后输入：

> 请把 https://你的企业网站 转成一份面向欧洲买手的中文杂志，选择资料充分的产品，保留来源，交付 HTML 工作稿。

Agent 自行读取网站与相关页面、选择内容、编辑、组织输入、校验、生成并通过原生文件卡片交付。用户无需编写 JSON 或运行脚本。已有模型配置和允许目标网站访问的网络仍由宿主提供；本插件不绕过网络或权限设置。

停用／卸载：

```sh
dsh plugin --profile web remove dsh-buyer-magazine
```

已生成文件与原生会话不删除。

## 一个核心，两种资料组织方式

- 网站编辑稿沿用 Studio 的产品档案、来源、编辑说明、四种主题及交互。
- 十种内容模块可选择、排序、按产品重复组合；兼容输入先归一化为同一个 Studio schema 的 `composition: modules`，再使用同一个校验、主题、HTML 外壳和编译器。
- ERP 是可选只读资料源，转换结果只包含选中模块。内部来源追溯保留在任务工作区；生成本身不创建交易。
- 原 Sourcing 脚本路径仅转调此包，原重复 Skill 入口和独立文档渲染器已移除。

字段见 [网站输入](skills/buyer-magazine/ISSUE-FORMAT.md)、[模块输入](skills/buyer-magazine/MODULES.md)。原 Studio 编辑方法与 18 份参考资料随包提供。

## 原生工具与文件 API

`buyer_magazine_validate_issue({issueJson})` 返回有效性、错误数、警告数和受限字段路径，便于 Agent 自行修正，不回显任意输入内容。

`buyer_magazine_generate({issueJson})` 在当前原生 Session 工作区创建 HTML，返回实际 `path`、哈希、大小与草稿状态。相同内容可复用；冲突不覆盖。生成后由 Agent 单独调用官方 `present`，只有该调用成功才表示文件已交付。

纯编译 API `dsh-buyer-magazine/compiler` 不导入 SDK、联网或写文件。`dsh-buyer-magazine/adapters` 提供模块归一化和 ERP 只读转换。命令行兼容入口：

```sh
node cli.js issue.json new-output.html
node cli.js --list
node src/adapters/from-erp.js snapshot.json selection.json new-blocks.json
```

## 结果边界

网络读取、模型响应与来源内容会影响实际完成情况。Agent 对无法读取的资料如实说明；价格未知保持待询价，公开网页不等于取得图片复用授权。没有图片依据时可交付明确标记的无图工作稿，不声称已经完成视觉终审。

全部产物保留 DRAFT FOR REVIEW。生成和文件交付不代表已经发布、发送、核实供应商、付款或预留库存。外部发送与发布按用户已有授权执行。

## 验证

仓库 `npm run check` 包含原 Studio 校验、文件边界、价格／来源、模块与 ERP 回归，以及独立包和统一编译检查。可另运行官方 SDK、Skill 发现与交互 DOM 检查；它们不等同于真实模型全流程验收。当前原生安装、浏览器和实际执行结果记录在仓库 `docs/DSH-MAGAZINE-UNIFICATION.md`。

来源版本、许可、原始与修改后文件指纹保留在 `upstream/` 和 `docs/*provenance.json`。不包含旧 CLI、采集服务器、模型网关或业务数据库。
