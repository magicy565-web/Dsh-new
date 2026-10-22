# workspace-artifacts

工作区的文件面：把 `ctx.artifacts` 接缝暴露成 HTTP，让人能把文本文件带进对话。

## 路由

```text
POST /api/artifacts                 { filename, content, mimeType?, title?, description?, requestId? }
GET  /api/artifacts?q=              列表（按文件名/标题/描述搜索）
GET  /api/artifacts/:id             元数据与版本
GET  /api/artifacts/:id/content     文本内容（二进制返回 415）
```

## 限制

- 只接受 UTF-8 文本上传，单文件 ≤ 512 KiB（内核请求体上限 1 MiB）；
- `mimeType` 只允许 `text/plain`、`text/markdown`、`text/csv`、`application/json`；
- viewer 可读、不可上传；
- 二进制文件可以存（走接缝直接创建），但**不能**挂到模型 run，runner 会以
  `ARTIFACT_UNSUPPORTED` 拒绝。

## 与 run 的关系

上传只产生 artifact；把它挂到某次对话，是消息里的
`selection.artifacts: [id]`。runner 读取内容、固定版本与 SHA-256，写入
`run.snapshot.artifacts`。上传本身不会自动进入任何 run。

## 验证

```powershell
node --test plugins/workspace-artifacts/test/plugin.test.mjs
node scripts/runner-smoke.mjs
```
