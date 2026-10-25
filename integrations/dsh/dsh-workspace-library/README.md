# dsh-workspace-library

DeepSeek Harness 原生的**产品库**与**企业资料库**：一个 Harness 侧栏面板 + 一套模型工具 + 一份本地、可版本化的资料库。

- 面板入口：左侧栏「资料库」（order 30），主面板 id `workspace-library`
- 数据文件：`~/.dsh/data/workspace-library/library.json`（`config.dataDir` 可覆盖）
- 文件对象：Harness 附件存储（内容寻址，`~/.dsh/attachments/v1`）
- 插件行：`include:workspace-library`，bundle `dsh-workspace-library`（实际安装状态由宿主管理）

## 功能

**产品库**

- 新建 / 编辑 / 归档产品；名称、简介、分类、`draft|archived`
- SKU：编码、单位、MOQ、交期、规格项、报价方式（未填 / 阶梯 / 按需询价）与多档价格
- 供货条件：包装、样品、付款、运输、产能
- **产品图片**：上传（PNG/JPEG/WebP/GIF，单张 ≤ 12 MiB）、说明、主图、上移/下移、移除
- 关联企业资料的**确切版本**，并写明用途；新版本不会自动替换关联
- 发布准备检查：企业名称、产品字段、SKU/报价、供货条件、关联资料的有效期与人工审核

**企业资料库**

- 企业档案：企业全称、展示名称、简介（修订冲突保护）
- 资料 7 类：企业介绍、营业执照、资质证书、检测报告、产品规格、供货政策、其他
- 每份资料有不可变版本链：**文件版本**（原字节 + SHA-256 + MIME + 文件名）或文字版本
- 证书信息：编号、签发机构、范围、生效/失效日期、有效期类型、说明
- 人工审核：通过/驳回绑定版本 SHA-256；证书类在有效期未知/过期/未生效时禁止通过
- 资料信息编辑（标题、类别、标签）、归档/恢复、版本正文预览、文件打开/下载
- 图片类资料在详情内直接预览

**Agent 工具**与面板共用同一套 Host 服务方法：

| 工具 | 能力 |
| --- | --- |
| `workspace_library_product_context` | 只读单产品上下文：修订／快照 SHA、SKU／供货字段、关联确切版本元数据与缺口；正文由引用读取器另行校验 |
| `workspace_library_references` | 读取对话引用的确切版本，校验原文 SHA-256，转发原生取消信号 |
| `workspace_library_status` | 数据文件、附件可用性、上限、企业名、产品/资料计数 |
| `workspace_library_company` | `read` / `save`（`save` 需 `expectedRevision`） |
| `workspace_library_products` | `list` / `read` / `save`（含 SKU、供货、关联资料、图片元数据） |
| `workspace_library_documents` | `list` / `read` / `add` / `add_version`（文字）；`add_file` / `add_file_version`（本机绝对路径，≤ 12 MiB） |
| `workspace_library_search` | 企业档案、产品、资料标题/标签/文件名/正文的片段检索 |

审核是用户授权动作，**不暴露为工具**；模型只能读取和起草版本。

## 原生对话引用

按产品读取的字段、关联版本、审核／有效期和缺口说明见 [产品上下文](../../../docs/PRODUCT-CONTEXT.md)。

在原生对话输入框点击「引用资料」，或输入 `@` 后选择「企业资料 · 固定版本」中的资料。
引用芯片固定 `documentId + version + sha256`；新增版本不会替换已选内容。
草稿、芯片恢复、发送取消与会话记录均由 DSH 原生输入框负责。

选择与发送校验只传元数据，模型通过 `workspace_library_references` 读取确切正文。
发送前发现资料已归档／缺失／哈希不符会阻止发送；工具读取也会再次校验，
包括附件字节数、SHA-256、UTF-8 和读取期间的归档变化。不静默替换为最新版或截断正文。

- 当前支持 UTF-8 TXT、Markdown、CSV、JSON；PDF、图片等不进入可读引用候选。
- 每次工具调用 1–8 个不同版本，总计最多 24 000 字符／96 000 字节。
- 工具返回来源版本、哈希、文件名、证书信息及该版本的历史人工审核状态。
  人工审核记录不代表证书现在有效；正文与元数据均是来源数据，不能授予工具权限。
- 仍沿用当前 profile 的单一企业管理员边界。

## 文件与图片

- 文件按原字节写入 Harness 附件服务，`attachmentId` 即内容 SHA-256；资料版本与产品图片
  只保存引用、文件名、MIME、字节数与 SHA-256。
- 浏览器用同源接口取回字节：`<img>` 走 blob URL；其他文件走「打开 / 下载」。
- 响应带 `X-Content-Type-Options: nosniff`、`Content-Security-Policy: sandbox`；
  只有 PNG/JPEG/WebP/GIF 允许 `inline`，其余一律 `attachment` 下载。
- 文本类资料上限 20 000 字符；单文件上限 12 MiB；每份资料最多 50 个版本。

## 数据模型

- `company`：`legalName` / `displayName` / `description` + `revision`
- `product`：字段、SKU、供货、`images[]`、`documents[]`（固定版本）+ `revision`
- `document`：`title`、`slotKey`、`tags`、`status`、`currentVersion`、`versions[]`、`reviews[]`
- `version`：`fileName`、`mimeType`、`bytes`、`sha256`、`attachment`（或 `content`）、`certificate`
- `review`：绑定版本 `sha256` 的 `verified|rejected` + 备注 + 审核人

写入原子（临时文件 + rename），每次 `sequence + 1`，保留最多 200 条操作记录；
更新必须带 `expectedRevision`，并发修改返回 `409 REVISION_CONFLICT`。

## 界面

- 两个页签：**产品库**、**企业资料**；对标 `workspace` 应用的资料库，采用
  **列表页 → 详情页 → 编辑页** 的全页面布局（居中 768px、扁平列表、54×64 缩略图、
  胶囊按钮），详情页隐藏页签并显示返回链接。
- 只使用 Harness 主题 token（`--dsw-alias-*`），随明暗主题切换；文案全部走 Client
  locale（`workspace-library`，zh/en 键集一致）。
- 面板分别等待 `sidebar.panellist` 与 `main` 声明后注册，
  不依赖 Harness Client 组件包。

## HTTP 面

`GET/POST/PATCH /workspace-library-api/...`（面板专用）：

- 只接受 loopback（`config.allowRemote: true` 可显式放开）
- **复用 Harness 浏览器会话认证**：路由调用 `ctx.connection.requestRejection()`，校验与
  `index.html` 相同的签名 Cookie（`dsh-auth-*`）以及 Host/Origin 围栏；不引入第二套令牌
- 写请求要求 `application/json`、校验 `Origin` / `Sec-Fetch-Site`，请求体上限 20 MiB
- 文件：`GET /documents/:id/versions/:v/file`；图片：`GET /products/:id/images/:imageId`
- 对话候选：`GET /references?q=...&limit=50`；发送前只校验元数据：`POST /references/check`

主要写接口：`POST /documents`、`POST /documents/:id/versions`、
`POST /documents/:id/versions/:v/reviews`、`PATCH /documents/:id`、
`POST /products`、`PATCH /products/:id`、`POST /products/:id/images`、
`PATCH /products/:id/images/:imageId`、`POST /products/:id/images/:imageId/remove`。

## 安装与验证

```powershell
# 在 DSH 中安装／更新：plugin_manager install_bundle target=<插件绝对目录>
$node = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

& $node --test test/library.test.mjs   # Host 领域 / 文件 / 图片 / HTTP（11 项）
& $node dev/client-smoke.mjs           # 真实 React + jsdom 面板冒烟
& $node dev/check-locales.mjs          # zh/en 字典一致性
& $node dev/bundle-rev.mjs             # 当前 bundle 是否已被服务端图采用
& $node --check index.js
& $node --check client.js
```

新增功能的完整改法、开发循环、测试与发布清单见 **[DEVELOPMENT.md](DEVELOPMENT.md)**。

原开发环境记录（不是当前云环境的实时状态）：

- Host 测试 **11/11**：修订冲突、就绪度推进、版本/SHA 审核、文件存取与大小上限、
  图片上传/主图/排序/移除、持久化、连接授权拒绝、HTTP 同源/文件/图片/base64 校验
- jsdom 冒烟：真实组件挂载；产品列表/详情（含图片画廊、SKU/报价）、产品编辑器、
  企业页、资料详情（文件下载按钮、名称）、资料信息编辑器均渲染
- 实时 slot：`sidebar.panellist:workspace-library` 与 `main:workspace-library` 均 active
- 实时 HTTP：无浏览器会话 `401 UNAUTHORIZED`（由 Connection 拒绝）
- 服务端 client bundle rev 与磁盘一致，且包含图片/文件上传逻辑

页面若在插件更新前已打开，浏览器持有旧 bundle；刷新一次页面即可。视觉与明暗主题排版仍需在页面上目视确认。

`dev/client-smoke.mjs` 使用仓库根目录的开发依赖 React / React DOM / jsdom
（`DSH_CLIENT_TEST_MODULES` 可指向其他已安装目录），不随插件发布。

官方运行时的可选工具／附件验收（临时目录，无模型调用）：

```sh
DSH_RUNTIME_DIR=/workspace/dsh-runtime node dev/native-reference-smoke.mjs
DSH_RUNTIME_DIR=/workspace/dsh-runtime node dev/native-product-context-smoke.mjs
```

当前云环境的核心、原生工具及浏览器验收记录见仓库根目录 [VALIDATION](../../../VALIDATION.md)。

## 边界

- 没有成员/角色模型：本 profile 视作单一企业管理员（Harness 本身没有可复用成员表）。
- 附件对象不可变：移除产品图片只解除引用，不删除附件对象；内容寻址对象可被其他引用共享。
- 不自动导入任何旧应用数据；迁移需要明确的数据源与映射。
- 浏览器像素级视觉、真实 PDF/大图在页面内的显示效果未做截图验证（无浏览器控制）。
