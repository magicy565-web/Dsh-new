# 四技能驱动的杂志设计 · dsh-buyer-magazine

**0.4.3 · DeepSeek Harness 原生插件**。四个技能指导当前 LLM 研究、编辑、艺术指导并直接编写 HTML/CSS/JavaScript。插件提供真实采集和文件审阅能力，不决定版面。

0.3 的固定 Allbirds 模板被用户否定，不能作为设计验收样板。旧编译器仅保留给已有 Studio/模块输入兼容调用。

2026-10-27 的 Burel 实际流程虽完成交付，用户随后否定其采购文案编排。采购任务现优先加载 [采购编辑标准](skills/editorial-magazine-design/resources/buyer-publication-standard.md) 与 [第一批阅读笔记](skills/editorial-magazine-design/resources/buyer-publication-reading.md)，先编辑文案再设计。原奢侈品视觉资源保留为可选方法。用户要求先学习时只做阅读与文字练习；这不是模型权重训练。记录见 [采购编辑学习](../../../docs/BUYER-EDITORIAL-LEARNING.md)。

## 工作方式

1. `apify-ecommerce-intelligence`：通过实际 Apify Actor 采集网站，保存原始资料、图片地址与来源。
2. `editorial-magazine-design`：指导 LLM 确定选题、图文叙事、跨页节奏、材料与版面。
3. `editorial-typography-system`：指导 LLM 编辑标题和正文，设计字阶、行宽、断行、图注与中西文关系。
4. `ai-media-kinetic-commerce`：编排过程与交互、看图修订和交付。

LLM 使用 DSH 原生 write/edit 创作文件。无需填写 issue JSON，没有三款商品上限、固定 DOM、五种容器或预制封面。五跨页是原技能包的叙事目标，具体设计由内容决定。原始 ZIP 的 15 个文件与哈希保留，运行约定与原始正文分开。

## 安装

```sh
dsh plugin --profile web add /absolute/path/dsh-buyer-magazine-0.4.3.tgz
dsh web
```

选择「网站转杂志」，提供网站、读者与制作要求。独立安装不需要 Sourcing 或 ERP；模型、会话、文件、权限和附件由 DSH 提供。开发时可使用 `link:/absolute/path/integrations/dsh/dsh-buyer-magazine`。

## 实际工具

- `buyer_magazine_collect_site`：先 `action:preflight` 只读检查凭据和账户额度；`action:start` 加网址，重新检查额度后创建真实 `apify/website-content-crawler` 任务；`action:status` 加返回的 runId 读取结果。原生 JSON 附件保留实际 Run 响应及原始 Dataset，失败和空结果也保留已有证据。
- `buyer_magazine_review_artifact`：读取当前 Session 工作区中 LLM 编写的 `htmlPath`，显示真实截图或 PDF 页图。可以选择宽度、滚动位置、CSS selector，并执行有限的本地 UI 操作。返回文件哈希、素材指纹与实际观察，不修改 HTML，不提供审美批准。
- 原生 `write/edit/read`：编写并修改实际作品。原生 `present`：交付已审阅文件。

本地 CSS/JS、图片和字体放在 HTML 所在目录下。远程图片/字体/CSS 通过 `assetUrls` 明确列出。审阅浏览器隔离运行，不允许外部脚本、任意导航或表单提交。它不是网站发布服务；HTML 成品也不会自动提交线索。

`view:print` 生成实际 PDF，每次最多返回三页截图，按 `nextPrintStart` 继续。修改文件后重新审查受影响的视图。机械测量、程序检查与设计质量分别记录，不能用一个 observed 状态宣称作品合格。

## 环境能力

- Apify：支持 `APIFY_TOKEN_1` 到 `APIFY_TOKEN_100`，也兼容已有的 `APIFY_TOKEN1` 到 `APIFY_TOKEN100`，每个 Token 单独绑定，目标均为 `api.apify.com`。`action:credentials` 仅返回当前已配置的编号；`credentialId` 明确选择账号，创建与查询同一 run 使用相同编号。配置存在不代表认证通过。缺失时返回 `APIFY_NOT_CONFIGURED`，不切换账号或采集器。每次最多 30 页、180 秒，默认费用上限 USD 1；宿主可通过 `apifyMaxChargeUsd` 配置，最高 USD 5。权限、额度或限流错误如实返回。

费用配置接受 USD 0.01–5，非法值拒绝执行。启动前通过官方 `GET /v2/users/me/limits` 检查所选账号的当前月额度差额；不可读取或不足时不启动 Actor，不修改账户限额。额度快照不是已预留余额。

采集默认显式使用 `playwright:firefox`、2048 MiB 内存、单并发和最多一次网络重试。
对于服务端 HTML，可显式传 `crawlerType: "cheerio"`（1024 MiB，不执行网页 JavaScript）；
失败后不会自动换引擎。费用和 180 秒上限均保持不变。

小页数研究应先确定真正相关的页面。`pageUrls` 可增加同 origin 的明确页面，连同 `url`
去重后的数量不能超过 `maxPages`；传入该数组后深度固定为 0，只读取指定页面。
传空数组表示只读 `url`。省略时保持原有跟随链接行为，但可能采到法律声明等无关页面。
例如 `url` 为品牌介绍页，`pageUrls` 为两个已确认存在的产品页，`maxPages` 为 3。
这只控制采集范围，不验证商品事实或图片授权。失败／超时／中止的终态仍尝试保存已存在的
Dataset，并标为 `failed / APIFY_RUN_FAILED / partialDataset`；部分结果不算成功研究。
- 审阅：宿主 Chromium、原生附件、支持图片输入的当前模型；PDF 页图另外需要 `pdfinfo`/`pdftoppm`。保留宿主代理与 TLS 信任。
- FastAI、视频请求、VIP 和线索后端：仍需实际配置相应能力，原始参考脚本不自动执行，不把示例或占位值当作可用服务。

用户提供的网站沿用其自有/已授权素材声明；自选第三方站点不继承商用授权。用户提供的材料或明确标注的合成设计测试可直接使用。缺少采集能力时报告真实缺项，不把未采集的作品称为网站研究成品。

### 多个 Apify Token 的配置

云环境依赖 `HTTP_PROXY` / `HTTPS_PROXY` 时，Node 的原生 `fetch` 需要宿主启用环境代理支持。Node 24.5+ 可用 `NODE_USE_ENV_PROXY=1 dsh web` 启动，保留原有代理和 CA 信任；不要关闭 TLS 校验或绕过代理。先运行 credentials / preflight。变量已列出但请求失败不能认定密钥无效：HTTP 401/403 才是远端认证／权限证据；网络错误没有验证额度。工具仅返回白名单 transportCode，不回显异常正文。此配置影响宿主启动，不由插件擅自修改进程全局代理。

实际绑定数量以当前运行环境的 `action:credentials` 为准，不从历史环境草稿或示例推断。用户在环境密钥面板分别绑定值、保存并发布后生效；代码不保存密钥。后续按需增加编号至 100 即可，不需要修改插件，也无需提前建立 100 个必填密钥项。

已在环境面板填写 `APIFY_TOKEN1`、`APIFY_TOKEN2` 等名称的用户无需重新录入或改名。两种写法可混用；同一编号两者都有值时优先使用带下划线的名称，不在失败后尝试另一个别名。凭据列表显示实际选中的变量名称。

旧 `APIFY_TOKEN` 继续兼容：未指定编号时优先读取它，不存在时读取 `_1`。使用编号方案不需要旧变量；草稿中的旧空项可由用户在设置中移除。显式编号不会回退到旧变量或其他编号。

例如要求“用第 5 个 Apify 账号采集此网站”，模型调用：

```json
{"action":"start","credentialId":5,"url":"https://example.com/","maxPages":8}
```

获得 runId 后，使用 `{"action":"status","credentialId":5,"runId":"返回的真实 runId"}` 查询。工具不将 Token 值、前缀或哈希返回给模型。

启动响应丢失、5xx 或缺少有效 Run 标识时返回 `unknown / APIFY_START_OUTCOME_UNKNOWN`，不自动重试；须先在 Apify 核对是否已有收费任务。空 Dataset 返回 `APIFY_DATASET_EMPTY`，不视作研究成功。原生证据存储不可用时不启动采集；附件保存失败则保留已知 Run 标识并报告 `APIFY_EVIDENCE_SAVE_FAILED`。

## 实际业务接入

已安装企业资料库时直接使用原 `workspace_library_status/products/product_context/references` 工具，固定版本与 SHA 仍由原库校验；不新增资料库或复制记录。原生 read 只读取实际会话可访问的文件。工单必须返回当前授权任务的附件字节；Space 文件元数据、示例任务及云端目录不能替代工单附件或用户电脑接入。读取权限与对外披露授权分别保留。

交付记录单独保存真实 Session ID、工单引用（没有则注明缺失）、来源版本、Run/Dataset ID、文件与资源哈希、审阅范围和未完成项。官方 `present` 声明的是当前工作区文件，不是不可变附件快照；原生附件、交付事件与企业验收分别记录。公开买手链接、分发和回执必须有实际服务记录，不能由 Space 的链接／成员元数据推断。当前环境核查与业务阻塞见 [真实接入验收](../../../docs/BUYER-MAGAZINE-LIVE-WIRING.md)。

## 兼容与验证

原 `compiler`/`adapters` 公共入口保留。旧 Studio JSON 或十模块调用方显式配置 `legacyCompiler: true` 后才注册原 validate/generate/review 工具。Sourcing 兼容配置已显式启用；创意设计预设默认看不到固定生成工具。

`npm run check` 检查源数据、文件边界、兼容性和默认工具路由。可显式运行 `node dev/authored-review-smoke.mjs` 检查自由 DOM、本地 CSS/JS、交互截图和 PDF；这是合成浏览器验证，不是设计验收。实际 Apify 采集必须另有真实凭据与成功 run 证明。
