# workspace-artifacts

工作区的文件面：把 `ctx.artifacts` 接缝暴露成 HTTP，让人能把文本文件带进对话。

## 路由

```text
POST /api/artifacts                 { filename, content, mimeType?, title?, description?, requestId? }
GET  /api/artifacts?q=              列表（按文件名/标题/描述搜索）
GET  /api/artifacts/:id             元数据与版本
GET  /api/artifacts/:id/content     文本内容（二进制返回 415）
GET  /api/artifacts/:id/download    以附件下载文本（content-disposition）
```

## 限制

- 只接受 UTF-8 文本上传，单文件 ≤ 512 KiB（内核请求体上限 1 MiB）；
- `mimeType` 只允许 `text/plain`、`text/markdown`、`text/csv`、`application/json`；
- viewer 可读、不可上传；
- 二进制文件可以存（走接缝直接创建），但**不能**挂到模型 run，runner 会以
  `ARTIFACT_UNSUPPORTED` 拒绝。


## 模型写文件

插件注册 `artifact_write` 工具（`approval: 'always'`）：模型产出文档时必须经过一次人工
批准，工具才落库。runner 会把结果里的 artifact 固定到 `run.snapshot.outputs`，并发出
`run.output_created`，页面上显示下载链接。
## 二进制文件

除了 UTF-8 文本，还支持按字节存储的二进制：上传时发送 `base64`（与 `content` 二选一），
`mimeType` 必须在允许列表内（PNG / JPEG / PDF / XLSX / DOCX / octet-stream），上限 5 MiB；
服务端会校验魔数。下载按原始字节返回，带正确的 `Content-Type` 与附件文件名。

二进制**不会进入模型上下文**：它只被存储、显示和下载，模型最多看到文件名与元数据。
## 与 run 的关系

上传只产生 artifact；把它挂到某次对话，是消息里的
`selection.artifacts: [id]`。runner 读取内容、固定版本与 SHA-256，写入
`run.snapshot.artifacts`。上传本身不会自动进入任何 run。

## 验证

```powershell
node --test plugins/workspace-artifacts/test/plugin.test.mjs
node scripts/runner-smoke.mjs
```
