# 网站转买手杂志 · dsh-buyer-magazine

版本 **0.3.0**，面向官方 `@deepseek-ai/dsh@0.2.1-rc.2`。这是可单独安装的 DSH 原生插件，提供自己的「网站转杂志」Agent 预设、用户提供的四技能包、五跨页与双阅读模式、品牌设计参数及原生生成／截图审阅工具。无需安装 Sourcing、资料库或 ERP。模型、会话、权限、文件与交付复用 DSH。

## 安装与使用

```sh
dsh plugin --profile web add /absolute/path/dsh-buyer-magazine-0.3.0.tgz
dsh web
```

开发时也可通过 `link:/absolute/path/integrations/dsh/dsh-buyer-magazine` 安装。插件包含完整的运行资源，压缩包安装不依赖源码仓库或相邻目录。

在原生新会话中选择「网站转杂志」、工作区和宿主已配置的模型，然后输入：

> 请把 https://你的企业网站 转成一份面向欧洲买手的中文杂志，选择资料充分的产品，保留来源，完成图文设计、看图修订，交付 HTML 和 PDF。

Agent 自行读取网站与相关页面、选择内容、编辑、组织输入、校验、生成并通过原生文件卡片交付。用户无需编写 JSON 或运行脚本。已有模型配置和允许目标网站访问的网络仍由宿主提供；本插件不绕过网络或权限设置。

停用／卸载：

```sh
dsh plugin --profile web remove dsh-buyer-magazine
```

已生成文件与原生会话不删除。

## 四个原始技能

- `ai-media-kinetic-commerce`：总编排、五跨页交互名片与交付。
- `apify-ecommerce-intelligence`：真实企业资料与素材采集；当前可用路径是 DSH 原生网页工具，Apify 外部服务须实际配置。
- `editorial-magazine-design`：Kinfolk / Loewe / Monocle / 032c 四种原型、纸张质感、跨页节奏与获客交互。
- `editorial-typography-system`：多声部标题、CJK/Latin 排版、字阶与 OpenType 原语。

原始 ZIP 的全部 15 个文件保留来源哈希，原始 SKILL 与 DSH 运行适配分开保存。`buyer-magazine` 是兼容入口，不是另一套制作技能。六个制作阶段属于这四项技能的工作流程。

## 设计制作能力与运行条件

默认按用户提供的网站属于自有或已授权素材源制作对外交付成品；授权属于用户声明，不冒称独立核验。Agent 自选第三方测试站不继承此声明。

`design` 记录品牌、读者、编辑目标、视觉概念、来源、配色、字体与图片用途，并由同一个渲染器实际应用。图片支持 contain/cover 与焦点设置。中文刊物包含中文导航、状态与对比控件。

`buyer_magazine_review({issueJson,view,start?})` 返回当前 HTML 的真实截图，让当前模型逐屏审看后修改。overview 检查三种宽度；spreads/products 每次最多三屏；editorial 返回原生 PDF 附件，print 将实际 PDF 页面转成截图逐页检查。翻页／滚动、键盘、材料对比、描图注记、vCard 和实际行动入口均有浏览器检查。机械测量通过不代表审美通过。

宿主需要 Chromium、原生附件存储和支持图片输入的模型；实际 PDF 逐页审阅还需 pdfinfo/pdftoppm。使用现有 `/usr/bin/chromium` 等安装，或设置非敏感环境变量 `DSH_MAGAZINE_CHROMIUM` 为浏览器绝对路径。不在运行中下载安装浏览器，不改变网络/TLS规则；不可用时明确返回 blocked。浏览器库随插件安装，不依赖另一个业务插件。截图审阅仅处理本编译器生成的内容，不接受任意网页/代码/文件路径。

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

网络读取、模型响应与来源内容会影响实际完成情况。Agent 对无法读取的资料如实说明；价格未知保持待询价，公开网页不等于取得图片复用授权。缺少所需素材时报告具体阻碍，不能自动把任务降级为无图工作稿。用户明确选择文字刊物时，需专门的文字版设计。

全部产物保留 DRAFT FOR REVIEW。生成和文件交付不代表已经发布、发送、核实供应商、付款或预留库存。外部发送与发布按用户已有授权执行。

## 验证

仓库 `npm run check` 包含原 Studio 校验、文件边界、价格／来源、模块与 ERP 回归，以及独立包和统一编译检查。可另运行官方 SDK、Skill 发现与交互 DOM 检查；它们不等同于真实模型全流程验收。当前原生安装、浏览器和实际执行结果记录在仓库 `docs/DSH-MAGAZINE-UNIFICATION.md`。

来源版本、许可、原始与修改后文件指纹保留在 `upstream/` 和 `docs/*provenance.json`。不包含旧 CLI、采集服务器、模型网关或业务数据库。

## 外部能力边界

FastAI 图片中继、Apify 采集、VIP 身份核验和真实线索 Webhook 尚未注册为本包的原生工具。随包脚本是原始参考，不自动运行，不使用占位密钥。使用可用的原站授权图片及原生采集；如任务必须使用外部服务，报告具体未配置项。视频仅作为实际目的地的请求入口，不自动生成；无成本证据时使用真实材料比较，不虚构 ROI。获客动作目前支持真实链接或本地需求卡下载，不能宣称同步 CRM。
