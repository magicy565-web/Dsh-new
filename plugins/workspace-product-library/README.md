# workspace-product-library

产品资料库：把 **Medusa 商品 + 已审核的 Product Context** 变成一间可协作的产品空间
（product room）。页面、版本、引用、评论、审核与操作回执都在 Workspace Harness 的
自有存储里；Medusa 仍是商品事实的唯一权威。

这是后端与 Harness 集成切片，不是一套新前端：

- 一个商品 = 一个 Space；页面 = 版本化文档；引用 = 指回商品字段 / Product Context 字段 / 证据；
- Agent 通过工具读写，写操作一律走 harness 审批票据；
- 不写 Medusa、不发布商品、不改变 Product Context 审核状态、不授予模型披露权限。

## ChatGPT Space 对标范围

| ChatGPT Space 能力 | 本切片 |
| --- | --- |
| 空间与成员协作 | 每个商品一间 room；读取按 workspace + 角色，编辑限 admin/operator |
| 对话转页面 | Agent 可用 `product_library_create_page` / `save_page` 起草版本化页面 |
| 引用与来源 | 引用固定到 pin 的 product/context/evidence 字段并保存 value hash |
| 版本历史 | 每次保存追加版本；历史只读；编辑已通过页面会撤回通过 |
| 评论 | 版本锚定评论，viewer 也可评论 |
| 审核 | 管理员按精确 revision 通过/撤回页面 |
| 上传、幻灯片、任务、实时协作 | 本切片未做，不伪装 |

## 事实来源

只读用已有的 Product Context Agent 面：

```text
GET {MEDUSA_ORIGIN}/agent/product-contexts?limit=100
GET {MEDUSA_ORIGIN}/agent/product-contexts/:productId
```

响应必须是 `schema_version: "1.0"` +
`review_policy: "medusa-product-context-current-source-v1"`，且只包含已审核、
过发布门、指纹匹配的 context。插件不读 Admin JWT / Secret API Key，不复制商品库，
不建立第二条商品事实。

## 组合行

默认关闭；先准备专用读 token 文件（0600，绝对路径，只给本插件用）：

```yaml
- id: product-library
  name: workspace-product-library
  config:
    workspaceId: local
    source:
      kind: medusa-approved-context
      baseURL: https://medusa.example.com
      readTokenFile: C:\secrets\workspace-product-library.read-token
      timeoutMs: 5000
```

不配置 `source` 时插件仍可挂载：`status.configured=false`，只列已有 room，打开新商品
返回 `PRODUCT_LIBRARY_SOURCE_UNCONFIGURED`，绝不伪造商品或上下文。

## HTTP

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/product-library/status` | 配置与计数 |
| GET | `/api/product-library/products?q=&limit=` | 已审核商品 + 是否已建 room |
| GET | `/api/product-library/products/:productId` | room：pin、页面、引用状态、评论 |
| POST | `/api/product-library/products/:productId/open` | 建 room（幂等 requestId） |
| POST | `/api/product-library/products/:productId/sync` | 重新 pin，返回变更字段与过期页面 |
| POST | `/api/product-library/products/:productId/pages` | 新建页面 |
| POST | `/api/product-library/products/:productId/pages/:pageId/save` | 保存新版本（expectedRevision） |
| POST | `/api/product-library/products/:productId/pages/:pageId/comments` | 版本锚定评论 |
| POST | `/api/product-library/products/:productId/pages/:pageId/approve` | 管理员通过/撤回 |

写操作都要求 `requestId`；相同 requestId + 相同内容返回原结果，不同内容返回 409。

## 工具

只读：`product_library_status`、`product_library_list`、`product_library_read`。
写入（`approval: 'always'`）：`product_library_open`、`product_library_sync`、
`product_library_create_page`、`product_library_save_page`、`product_library_comment`、
`product_library_approve_page`。

## 引用语义

保存页面时服务端按当前 pin 计算 `valueHash`。`sync` 更新 pin 后：

- 引用值未变 → `current`
- 引用值变了 → `stale`（页面需要重新保存以刷新引用）
- 字段在 pin 中不存在 → `missing`

未知字段在保存时直接 400 `PRODUCT_LIBRARY_CITATION_UNKNOWN`，不落库。

## 验证

```powershell
$node = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node --test plugins/workspace-product-library/test/plugin.test.mjs
```

测试用本地 synthetic source / 本地 HTTP server，不连接真实 Medusa。真实 Medusa
Agent 面、PostgreSQL、token 轮换和生产 Host 仍属于未执行的验收项。

## 未做（明确边界）

- 页面正文是纯文本（Markdown 语义），不是动态块编辑器或幻灯片；
- 没有文件上传/OCR；证据元数据来自 Product Context 的 `evidence`；
- 没有向 Medusa 写 Product Context 或商品；写回仍走原审核面；
- 没有多租户隔离；`workspaceId` 只是 harness 内的作用域绑定；
- 没有实时协作、任务、会议或连接器。
