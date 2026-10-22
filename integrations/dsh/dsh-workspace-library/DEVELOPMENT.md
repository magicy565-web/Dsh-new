# dsh-workspace-library 开发指南

这份文档回答：**在这个插件里加一个新功能，要改哪些文件、跑哪些命令、怎么确认没坏。**

## 1. 代码地图

```
dsh-workspace-library/
├─ index.js              Host：存储、领域校验、Service、HTTP、模型工具、插件装配
├─ client.js             Client：中文/英文字典、样式、数据访问、面板与所有页面
├─ locale/*.json         Plugin Manager 里的标题/描述
├─ icon.svg              侧栏图标
├─ test/library.test.mjs Host 测试（领域 + HTTP + 文件/图片）
└─ dev/                  开发辅助（不随插件发布）
   ├─ client-smoke.mjs   真实 React + jsdom 冒烟
   ├─ check-locales.mjs  zh/en 字典一致性
   └─ bundle-rev.mjs     当前 client bundle 的 rev 与服务端是否一致
```

Host 里的顺序就是调用顺序：

| 段落 | 关键函数 | 职责 |
| --- | --- | --- |
| 校验 | `text` / `integer` / `choice` / `assertKeys` / `normalizeCertificate` | 所有输入的唯一校验入口 |
| 状态 | `emptyState` / `validateState` / `migrateLoadedState` / `LibraryStore` | JSON 文件、原子写、串行化 |
| 读模型 | `productSummary` / `listProducts` / `documentSummary` / `readinessOf` | 列表与就绪度 |
| 写模型 | `createProduct` / `updateProduct` / `addProductImage` / `updateCompany` / `createDocument` / `appendDocumentVersion` / `reviewDocument` | 修订冲突、版本链、审核 |
| 检索 | `searchLibrary` | 跨实体片段 |
| Service | `createLibraryService(store, { attachments })` | **所有能力的唯一实现** |
| HTTP | `createHttpHandler(service, { allowRemote, authorize })` | 面板的同源接口 |
| 工具 | `toolDefinitions(service)` | 模型工具，调用同一批 Service 方法 |
| 装配 | `apply(ctx, config)` | 注册工具、HTTP 路由、认证 |

Client 里的顺序：

| 段落 | 关键函数 | 职责 |
| --- | --- | --- |
| 字典 | `zh` / `en` | 所有可见文案；键集必须一致 |
| 样式 | `styles` | 全部 `wl-*` 类，只用 `--dsw-alias-*` token（主按钮用 workspace 蓝 `--wl-accent`） |
| 传输 | `request` / `api` / `fetchStoredBlob` / `openStoredFile` / `useBlobUrl` / `fileToBase64` | 同源 JSON、blob 文件、上传编码 |
| 面板 | `LibraryPanel` | 页签 + 路由状态机 `list / product / productNew / productEdit / document / documentNew / documentVersion` |
| 页面 | `ProductPane` / `ProductDetail` / `ProductEditor` / `CompanyPane` / `CompanyCard` / `DocumentDetail` / `DocumentEditor` | 列表页 / 详情页 / 编辑页 |
| 注册 | `apply(ctx)` | `sidebar.panellist` + `main`，含启动后的注册重放 |

### 一次操作，三个调用方

```text
面板按钮 → api.xxx() → HTTP 路由 → service.xxx() → domain + store
模型工具 → toolDefinitions 的 execute → service.xxx()
```

**不要**在 UI 或工具里复制校验/业务逻辑；新增能力先想清楚 Service 方法，再给它接 HTTP 和/或工具。

## 2. 本地开发循环

本机 node 不在 PATH，先设一次：

```powershell
$node = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
```

### 改 Host（`index.js`）

```powershell
& $node --check dsh-workspace-library/index.js
& $node --test dsh-workspace-library/test/library.test.mjs
```

Host 代码**不会**热更新。改完用插件管理器重载这一行（禁用再启用）：

```text
plugin_manager set_plugin target=include:workspace-library enabled=false
plugin_manager set_plugin target=include:workspace-library enabled=true
```

`application: applied` 之后验证：

```powershell
# 没有浏览器会话时应为 401（Connection 拒绝），不是 404
Invoke-WebRequest http://127.0.0.1:59355/workspace-library-api/state -UseBasicParsing
```

### 改 Client（`client.js` / 样式 / 字典）

```powershell
& $node --check dsh-workspace-library/client.js
& $node dsh-workspace-library/dev/check-locales.mjs
& $node dsh-workspace-library/dev/client-smoke.mjs
& $node dsh-workspace-library/dev/bundle-rev.mjs       # rev 与服务端图一致、关键标记存在
```

保存后服务端会重建 bundle，但**页面必须刷新**才执行新代码：`Ctrl+Shift+R`。

### 加/改一个 HTTP 路由之后

1. `test/library.test.mjs` 里补一条（HTTP 测试用 `authorize` 假函数）
2. `dev/client-smoke.mjs` 的 `fetch` mock 补一条路径，否则面板会拿到 404
3. 重载 Host → 刷新页面 → 手动点一遍

## 3. 配方：给产品加一个字段（例：海关编码 HS code）

按顺序改 6 处，缺一处就会“存不上/看不到/工具不认”。

1. **默认值**：`createProduct()` 的 `original` 对象加 `hsCode: ''`
2. **校验/归一化**：`normalizeProductChanges()` 里
   ```js
   if (changes.hsCode !== undefined) next.hsCode = text(changes.hsCode, 'hsCode', 64);
   ```
   并把 `'hsCode'` 加进 `PRODUCT_FIELDS`，否则 `assertKeys` 会拒绝
3. **旧数据兼容**：`migrateLoadedState()` 给老产品补默认值
   ```js
   for (const product of state.products) if (typeof product.hsCode !== 'string') product.hsCode = '';
   ```
4. **列表摘要**（可选）：`productSummary()` 加 `hsCode`
5. **工具 schema**：`toolDefinitions()` 的 `workspace_library_products.changes.properties` 加
   ```js
   hsCode: { type: 'string', maxLength: 64 },
   ```
6. **UI**：
   - `emptyProductDraft()` / `toDraft()` 带上 `hsCode`
   - `ProductEditor` 基本信息区加一个 `wl-field`
   - `ProductDetail` 的“产品信息”区展示
   - `zh` / `en` 字典加 `product.hsCode`，两边都加

7. **测试**：`completeProduct` 加字段；断言保存后读回一致；`check-locales` 通过
8. 重载 Host + 刷新页面

> 写模型只接受 `changes` 里的白名单字段；不在 `PRODUCT_FIELDS` 里的字段会被 `assertKeys` 明确拒绝，这是故意的。

## 4. 配方：加一个实体/页签（例：笔记与记忆）

以“笔记”为例，最小闭环：

1. **状态**：`emptyState()` 加 `notes: []`；`validateState` 检查数组；
   `migrateLoadedState` 补 `if (!Array.isArray(state.notes)) state.notes = [];`
2. **领域**：`createNote` / `updateNote` / `listNotes` / `getNote`，沿用 `text`、`assertKeys`、
   `revision` 冲突、`recordOperation`
3. **Service**：`notes()`、`note(id)`、`saveNote()`、`deleteNote()`（或 archive）
4. **HTTP**：`GET/POST /notes`、`GET/PATCH /notes/:id`，写请求走 `assertSameOrigin`
5. **工具**（可选）：`workspace_library_notes`，`action: list|read|save`
6. **Client**：
   - `LibraryPanel` 的页签数组加 `['notes', t('tab.notes')]`
   - `route.page` 分支加 `note / noteNew / noteEdit`（照抄 product 的三段）
   - 新页面组件复用 `wl-heading` / `wl-list` / `wl-row` / `wl-section` / `wl-field`
   - `api` 加 `notes` 方法
   - `zh`/`en` 加所有文案
7. **测试**：领域 + HTTP；smoke mock 加 `/notes`

约束：
- 单个实体序列化后 ≤ 64 KiB（`ENTITY_TOO_LARGE`）
- 列表默认最多 200 条；需要分页就加 `cursor`（参考旧 app 的 `hash` 游标）
- 文件内容不要塞进 JSON，用附件服务

## 5. 文件与图片

- 写文件：`storeAttachment(attachments, { data, fileName, mimeType })`
  - `attachments.saveFile({ data, name })` 返回内容寻址的 `{ attachmentId, name, bytes }`
  - 我们额外保存 `mimeType`、`sha256`、`bytes`
- 读文件：`service.documentFile(id, version)` / `service.productImageFile(id, imageId)`
  返回 `{ fileName, mimeType, bytes, stream }`，HTTP 层用 `pipeline` 输出
- 上限：`MAX_FILE_BYTES = 12 MiB`；HTTP body `20 MiB`（base64 膨胀）
- 图片 magic-byte 校验在 `assertImageBytes`；只有 PNG/JPEG/WebP/GIF 允许 `inline`
- 附件不可变：删除引用不会删除对象；不要尝试原地替换附件

新增文件型实体时，照抄 `normalizeVersion` 的 `data`/`mimeType` 分支和 HTTP 的
`decodeFileBody`。

## 6. 认证

- 不做自定义 token。HTTP 路由统一：
  ```js
  authorize: request => webCtx.connection.requestRejection(request)
  ```
  它校验与 `index.html` 相同的签名 Cookie（`dsh-auth-*`）+ Host/Origin 围栏
- 测试里用假的 `authorize`：`createHttpHandler(service, { authorize: () => 401 })`
- 任何新路由都必须在 `createHttpHandler` 的同一个 `authorize` 检查之后，否则就是绕过

## 7. 测试怎么写

Host（`test/library.test.mjs`）：

```js
await withStore(async service => {
  const product = await service.saveProduct({ changes: completeProduct });
  // ...
}, { attachments: createFakeAttachments() });
```

- `withStore` 建临时目录、结束自动清理
- `createFakeAttachments()` 是内容寻址的内存实现，`saveFile` / `readFileStream`
- HTTP 测试用 `createServer(createHttpHandler(service, { authorize }))`
- 永远测 `expectedRevision` 冲突（409）、上限（413）、权限（401/403）

Client（`dev/client-smoke.mjs`）：

- jsdom + 真实 React，挂载 `LibraryPanel`
- `globalThis.fetch` 返回固定数据；**新增接口要加 mock 路径**
- 流程：列表 → 详情 → 编辑 → 取消 → 返回 → 企业页 → 文件 → 资料信息编辑
- 失败时打印 DOM 文本与请求列表

## 8. 发布/升级

1. 改 `package.json` 的 `version`
2. 更新 `README.md` / `DEVELOPMENT.md` / `locale/*.json`（标题、描述）
3. 安装或更新：

   ```text
   plugin_manager install_bundle target=C:\...\dsh-workspace-library
   ```

   这是 `link:` 安装；Host 代码用禁用/启用重载即可，不必重启应用
4. 刷新页面，按第 2 节验证

**数据兼容**：`library.json` 的 `version` 保持 1；新增字段一律在 `migrateLoadedState`
补默认值。不要为了新字段直接改 `STATE_VERSION` 而不写迁移。

## 9. 常见坑

- **改了看不到**：Host 没重载 / 页面没强刷 / bundle rev 没更新（用 `dev/bundle-rev.mjs` 查）
- **侧栏没有图标**：`sidebar.panellist` 的订阅发生在侧栏激活时；`apply` 里 0ms/1s 的注册重放就是为此。**不要删**
- **保存 409**：没有带 `expectedRevision`，或图片/资料操作推进了修订。产品编辑器用
  `baseRevision`，图片操作后要更新它
- **`assertKeys` 报错**：字段没进白名单（`PRODUCT_FIELDS` / `DOCUMENT_FIELDS` / `COMPANY_FIELDS`）
- **工具能读不能写**：工具 schema 漏了字段；工具参数校验在 schema，业务校验在 domain
- **字典报错**：`t()` 的键在 zh/en 缺一边；跑 `check-locales`
- **样式跑偏**：只用 `--dsw-alias-*` token；主按钮的蓝色是 `--wl-accent`
- **文件 413**：base64 后体积超 20 MiB，或单文件超 12 MiB
- **不要**手写 profile 的 `package.json` / `cordis.patch.yml`，交给 `plugin_manager`

## 10. 建议的下一批功能（按投入产出排序）

1. **对话内引用资料**：注册 `conversation.composer.dock` 的 picker，把
   `{kind, id, version}` 存进会话事件；点击 chip 打开资料库详情。Host 加
   `references` 读写，工具加 `workspace_library_references`
2. **产品资料库（Medusa rooms）**：第三个页签，Host 直连 Medusa 只读接口；沿用
   “只读事实 + 审批后关联”的边界，不要在插件里存商品事实
3. **导出/导入**：`GET /export` 输出 `{company, products, documents}` JSON（不含附件字节）；
   导入旧 `workspace.json` 的 `businessLibrary`，版本无文件时标记 `legacy`
4. **分类/筛选/批量归档**：列表页加状态筛选与游标分页
5. **附件 GC**：扫描未被引用的内容寻址对象，提供只读报告 + 用户确认后清理
6. **多用户/角色**：等 Harness 有身份模型再接；现在不要自己造一套权限

## 11. 完成定义

- [ ] `node --check index.js` / `client.js`
- [ ] `node --test test/library.test.mjs` 全绿
- [ ] `dev/check-locales.mjs` 一致
- [ ] `dev/client-smoke.mjs` 通过（新增接口有 mock）
- [ ] `dev/bundle-rev.mjs` rev 一致、无 MISS
- [ ] 重载 Host 后 `application: applied`
- [ ] 页面强刷后面板可操作；无会话请求仍是 401
- [ ] README/DEVELOPMENT 与字典同步更新
