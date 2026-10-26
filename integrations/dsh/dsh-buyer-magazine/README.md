# 四技能驱动的杂志设计 · dsh-buyer-magazine

**0.4.0 · DeepSeek Harness 原生插件**。四个技能指导当前 LLM 研究、编辑、艺术指导并直接编写 HTML/CSS/JavaScript。插件提供真实采集和文件审阅能力，不决定版面。

0.3 的固定 Allbirds 模板被用户否定，不能作为设计验收样板。旧编译器仅保留给已有 Studio/模块输入兼容调用。

## 工作方式

1. `apify-ecommerce-intelligence`：通过实际 Apify Actor 采集网站，保存原始资料、图片地址与来源。
2. `editorial-magazine-design`：指导 LLM 确定选题、图文叙事、跨页节奏、材料与版面。
3. `editorial-typography-system`：指导 LLM 编辑标题和正文，设计字阶、行宽、断行、图注与中西文关系。
4. `ai-media-kinetic-commerce`：编排过程与交互、看图修订和交付。

LLM 使用 DSH 原生 write/edit 创作文件。无需填写 issue JSON，没有三款商品上限、固定 DOM、五种容器或预制封面。五跨页是原技能包的叙事目标，具体设计由内容决定。原始 ZIP 的 15 个文件与哈希保留，运行约定与原始正文分开。

## 安装

```sh
dsh plugin --profile web add /absolute/path/dsh-buyer-magazine-0.4.0.tgz
dsh web
```

选择「网站转杂志」，提供网站、读者与制作要求。独立安装不需要 Sourcing 或 ERP；模型、会话、文件、权限和附件由 DSH 提供。开发时可使用 `link:/absolute/path/integrations/dsh/dsh-buyer-magazine`。

## 实际工具

- `buyer_magazine_collect_site`：`action:start` 加网址创建真实 `apify/website-content-crawler` 任务；`action:status` 加返回的 runId 读取结果。保留 run/dataset ID、来源与原生 JSON 附件。
- `buyer_magazine_review_artifact`：读取当前 Session 工作区中 LLM 编写的 `htmlPath`，显示真实截图或 PDF 页图。可以选择宽度、滚动位置、CSS selector，并执行有限的本地 UI 操作。返回文件哈希、素材指纹与实际观察，不修改 HTML，不提供审美批准。
- 原生 `write/edit/read`：编写并修改实际作品。原生 `present`：交付已审阅文件。

本地 CSS/JS、图片和字体放在 HTML 所在目录下。远程图片/字体/CSS 通过 `assetUrls` 明确列出。审阅浏览器隔离运行，不允许外部脚本、任意导航或表单提交。它不是网站发布服务；HTML 成品也不会自动提交线索。

`view:print` 生成实际 PDF，每次最多返回三页截图，按 `nextPrintStart` 继续。修改文件后重新审查受影响的视图。机械测量、程序检查与设计质量分别记录，不能用一个 observed 状态宣称作品合格。

## 环境能力

- Apify：在环境密钥面板配置 `APIFY_TOKEN`，目标 `api.apify.com`；也识别已有 `APIFY_TOKEN_1`。缺失时返回 `APIFY_NOT_CONFIGURED`，不静默切换采集器。每次最多 30 页、180 秒，默认费用上限 USD 1；宿主可通过 `apifyMaxChargeUsd` 配置，最高 USD 5。授权错误不轮换密钥绕过。
- 审阅：宿主 Chromium、原生附件、支持图片输入的当前模型；PDF 页图另外需要 `pdfinfo`/`pdftoppm`。保留宿主代理与 TLS 信任。
- FastAI、视频请求、VIP 和线索后端：仍需实际配置相应能力，原始参考脚本不自动执行，不把示例或占位值当作可用服务。

用户提供的网站沿用其自有/已授权素材声明；自选第三方站点不继承商用授权。用户提供的材料或明确标注的合成设计测试可直接使用。缺少采集能力时报告真实缺项，不把未采集的作品称为网站研究成品。

## 兼容与验证

原 `compiler`/`adapters` 公共入口保留。旧 Studio JSON 或十模块调用方显式配置 `legacyCompiler: true` 后才注册原 validate/generate/review 工具。Sourcing 兼容配置已显式启用；创意设计预设默认看不到固定生成工具。

`npm run check` 检查源数据、文件边界、兼容性和默认工具路由。可显式运行 `node dev/authored-review-smoke.mjs` 检查自由 DOM、本地 CSS/JS、交互截图和 PDF；这是合成浏览器验证，不是设计验收。实际 Apify 采集必须另有真实凭据与成功 run 证明。
