# 产品资料库：Medusa 商品 + Product Context 的 Harness 后端

日期：2026-10-22
分支：`codex/product-library-20261022`
基线：`codex/medusa-shopify-parity-20261022`

## 这次做了什么

按「以 Medusa 商品 + Product Context 为底座、对标 ChatGPT Space、集成到
Harness」落了一个后端切片：

1. **仓库 Harness 插件** `plugins/workspace-product-library`
   - 一间商品 = 一个 room（ChatGPT Space 的“空间”）；
   - 页面是版本化文档，带引用、评论、管理员审核；
   - 事实只来自 Medusa 的 **已审核 Product Context Agent 面**；
   - 写操作走 Harness 审批票据，不写 Medusa、不发布商品。
2. **组合接线** `harness.local.yml`
   - 新增 `product-library` 行；默认不配置 Medusa source，
     `status.configured=false`，只列已有 room，不伪造商品。
3. **DSH 适配器** `integrations/dsh-product-library`
   - Host-only bundle，注册 3 个只读工具：
     `product_library_status` / `product_library_list` / `product_library_read`；
   - 通过 `http://127.0.0.1:8790`（可用 `PRODUCT_LIBRARY_BASE_URL` 覆盖）
     调用仓库 Harness 的 HTTP 面；
   - 已安装到当前 DSH profile，工具在当前会话可用。

## ChatGPT Space 对标

| ChatGPT Space | 本切片 | 说明 |
| --- | --- | --- |
| 资料空间、团队 + AI 共同工作 | 每个商品一间 room；成员按 workspace + 角色读取 | 不是多租户 SaaS |
| 对话转页面 | Agent 工具可建页/存新版本 | 纯文本 + 引用，不是块编辑器 |
| 引用与来源 | 引用固定到 product/context/evidence 字段 + value hash | `sync` 后自动标 `stale` |
| 版本历史/评论/审核 | 版本、版本锚定评论、管理员通过/撤回 | 编辑已通过页会撤回通过 |
| 文件附件 | 每个 room 存 ≤512 KiB 的 PDF/图片/CSV/MD/文本，SHA-256 固定，可关联 evidence | 走 harness artifacts seam |
| 动态页面/幻灯片/任务/实时协作 | 未做 | 明确不伪装 |

## 数据与安全不变量

- room 的 `pin` 同时固定商品投影、已审核 context、`review_version`、
  `source_hash` 和两者规范化后的 SHA-256；读取时重新校验 pin 完整性。
- Agent 面只接受 `status=approved`、发布门通过、指纹匹配的 context；
  插件不读 Admin JWT / Secret API Key，不建第二条商品事实。
- 引用保存 `valueHash`；`sync` 改 pin 后旧引用变 `stale`，重新保存才刷新。
  未知字段直接 400 `PRODUCT_LIBRARY_CITATION_UNKNOWN`，不落库。
- 所有写操作要求 `requestId`；同 requestId 同内容重放原结果，不同内容 409。
- viewer 可读、可评论；创建/保存/同步限 admin/operator；页面通过限 admin。
- 注入失败、Medusa 不可达、token 非法、存储损坏全部 fail closed，返回明确 code。

## HTTP（节选）

```text
GET  /api/product-library/status
GET  /api/product-library/products?q=&limit=
GET  /api/product-library/search?q=&limit=
GET  /api/product-library/products/:productId
POST /api/product-library/products/:productId/open
POST /api/product-library/products/:productId/sync
POST /api/product-library/products/:productId/pages
POST /api/product-library/products/:productId/pages/:pageId/save
POST /api/product-library/products/:productId/pages/:pageId/comments
POST /api/product-library/products/:productId/pages/:pageId/approve
POST /api/product-library/products/:productId/documents
GET  /api/product-library/products/:productId/documents/:documentId
```

完整说明见 [插件 README](../plugins/workspace-product-library/README.md)。

## 验证

以下均为本地、合成输入，不是真实 Medusa/PostgreSQL/生产 Host 验收：

| 项 | 结果 |
| --- | --- |
| `node --test plugins/workspace-product-library/test/plugin.test.mjs` | 17/17 通过 |
| `node --test integrations/dsh-product-library/test/index.test.mjs` | 5/5 通过 |
| `wh doctor --composition harness.local.yml` | `status: ok`，product-library 行、artifacts seam 与 11 条路由注册 |
| Harness HTTP 冒烟 | `/status`、`/products` 返回 `configured:false` 与显式 warning |
| 附件冒烟（合成 Medusa，loopback） | 真实 kernel HTTP：open room → 上传 62 字节 PDF → 读 room 见 documents → 下载字节 SHA-256 完全一致 |
| DSH 端到端（合成 Medusa，loopback） | DSH 工具 → Harness HTTP → 插件 → 合成 Agent 面；`status configured:true`、list 1 条、open room + 建页/上传后 `product_library_read` 返回 pin/页面/引用/doc 元数据 |

端到端验证使用的是临时 mock Medusa（127.0.0.1:9099）和临时私有 token 文件；
验证结束后已停止进程并删除临时数据。`docs` 不包含该 mock 数据。

未执行、不能声称通过：

- 真实 Medusa v2 + PostgreSQL + 真实 `AGENT_CONTEXT_READ_TOKEN` 与轮换；
- 生产 Host 的签名入口、会话撤销、并发写、断网重试；
- 附件 OCR/全文检索/在线预览、multipart 上传与超过 512 KiB 的文件；
- 幻灯片/动态块、任务与实时协作；
- DSH 页面化（本切片只提供 DSH 只读工具）。

## 怎么用

1. 在 `workspace-agent` 启动 Harness（前台，Ctrl+C 停止）：

```powershell
$node = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node scripts/harness-serve.mjs
# 或：npm run harness:serve （需要 PATH 中有 node）
```

默认监听 `http://127.0.0.1:8790`；`HARNESS_COMPOSITION` 可换组合文件。

2. 配 Medusa 读取（可选）：在 `harness.local.yml` 的 `product-library` 行加
   `source`，`readTokenFile` 指向私有的 Product Context Agent 读 token 文件
   （绝对路径，POSIX 要求 0600）。
3. 在 DSH 对话中直接使用 `product_library_*` 工具；未启动 Harness 时工具返回
   `PRODUCT_LIBRARY_UNAVAILABLE`，不会编造数据。
