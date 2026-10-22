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
   - Host-only bundle，注册 4 个只读工具：
     `product_library_status` / `product_library_list` /
     `product_library_search` / `product_library_read`；
   - 通过 `http://127.0.0.1:8790`（可用 `PRODUCT_LIBRARY_BASE_URL` 覆盖）
     调用仓库 Harness 的 HTTP 面；
   - 已安装到当前 DSH profile，工具在当前会话可用。
4. **应用内页面** `src/product-library/` + `server/product-library-proxy.mjs`
   - 资料库 → **产品资料库** 标签页：商品列表、room、已审核 Context、页面/评论/审核、
     附件上传与下载；
   - 应用在 **local 模式** 下把 `/api/product-library/*` 同源代理到 8790，
     不暴露 loopback 端口、不需要 CORS；enterprise 模式不代理，继续走签名入口；
   - HTTP 非安全上下文下 `requestId` 回退到 `crypto.getRandomValues`。

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

本地门禁、真实腾讯云部署与应用内流程分开记录：

| 项 | 结果 |
| --- | --- |
| `node --test plugins/workspace-product-library/test/plugin.test.mjs` | 17/17 通过 |
| `node --test integrations/dsh-product-library/test/index.test.mjs` | 5/5 通过 |
| `node --test test/product-library-proxy.test.mjs` | 2/2 通过 |
| `tsc --noEmit` / `vite build` | 通过 |
| `wh doctor --composition harness.local.yml` | `status: ok`，product-library 行、artifacts seam 与 12 条路由注册 |
| Harness HTTP 冒烟 | `/status`、`/products` 返回显式配置状态 |
| 附件冒烟（合成 Medusa，loopback） | open room → 上传 62 字节 PDF → 下载字节 SHA-256 完全一致 |
| 腾讯云真实 Medusa 端到端 | 新建商品 `prod_01M5FXD1MGMEG0HBMF3VGZG16N` → Product Context `approved` rev1 readiness 90 → 资料库列表出现 → open room → 页面 5 条引用全 `current` → 评论 → 页面通过 → 69 字节 PDF 上传/下载 SHA-256 一致 → 搜索命中页面+文档 |
| 应用内浏览器流程（真实部署） | Playwright：新建页面 → 评论 → 通过审核 → 上传 42 字节 PDF → 下载 SHA-256 一致；页面/附件数递增 |
| DSH 工具对真实部署 | `product_library_status` 返回 configured、rooms=1、pages=2；`product_library_search("OEKO-TEX")` 命中 2 页面 + 1 文档 |

腾讯云验证使用了真实 Medusa v2 + PostgreSQL；DSH 工具经本机 SSH 隧道访问服务器 8790。
仍未执行：生产签名入口/会话撤销/并发写/断网重试；附件 OCR/全文检索/预览、
multipart 与超过 512 KiB 的文件；幻灯片/动态块、任务与实时协作；DSH 独立页面化。

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
