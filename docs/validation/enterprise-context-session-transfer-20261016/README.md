# Session 恢复及原件传输验收（开发分支）

基线 PR91 `f7353fead48da4ce4cddcf91230a28d3caf6e7b7`，独立分支 `codex/enterprise-context-session-transfer-20261016`，单 writer。先完成恢复门禁，后处理原件传输授权；未覆盖其他支线。

## Checkpoint 1：压缩恢复凭据门禁

实际旧版复现来自 `ba4f3789174b36ba7497eed707efe6ac513b1f14` 的完整源码临时 checkout（插件0.2.0），Node24.19.0、Bun1.3.14/OMP18.10.4，原 Host/签名 Session/Library/Artifact、本机 HTTP Docling 替身、有限模型。HTTP200 返回非通用 secret 格式的随机合成 key。旧版实际 parse 接受该值；SDK SessionManager.appendCompaction 把正文带入合成摘要并移除上下文中的 toolResult；恢复成功且摘要触发1次有限模型请求、0次真实模型请求。测试不输出 key/正文，临时 journal 不提交。

PR91 基线对应回归也失败：预期恢复模型请求0，实为1。新实现先由 Node 对完整响应/接受正文执行既有已知凭据筛查，再给 parse proof 增加 HMAC-SHA256 筛查凭证。MAC 使用当前 Node 内连接 key，绑定来源/正文 hash/scope/native Session 全部字段和固定用途域；key 不随 proof 或 RPC 发送。不靠版本号、标记或来源可读性认定已筛查。恢复沿既有 snapshot 的 control.check 首先核验证据，缺失/伪造/正文或 Session 换绑均拒绝；压缩摘要不会先进入模型。当前连接 key 改变也拒绝旧证据，故障关闭。未引入持久密钥、配置、迁移权限或第二套存储。

旧会话不自动迁移，拒绝后原 journal 完整保留；不调用模型清洗。安全新会话通过实际 SDK 压缩后续接同一 native Session，验证缓存不再请求 Docling。旧 status 的完整多来源要求仍独立存在。

最终命令、结果与第二阶段在后续 checkpoint 补齐。真实 Docling/模型/ERP 未验收，Mem0关闭，原 Artifact 保存仍 `SESSION_READONLY_EXECUTION_REFUSED`。无TED重试、网络变更、main修改合并、强推、部署或真实凭据读取/创建。

第一阶段完成：`node --test test/enterprise-context-host.test.mjs` 49/49；`node --test test/enterprise-context-oss.test.mjs test/enterprise-context-extension.test.mjs` 14/14；`npm run build`（含十一包 `plugins:pack-check`）通过，仅已有 bundle大小提示。命令及本地日志hash见 `checkpoint-1-checks.json`，未提交运行日志/会话。
