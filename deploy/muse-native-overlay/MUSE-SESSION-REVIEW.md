# Muse 原会话回传增量

状态：隔离候选，未部署。基线是已冻结的 native Muse + Dot history 18 文件版 `1ebd5cc`。
生产代码增量 7 文件，新增回归 2 文件；不附带账户配置、认证信息、生产数据库或测试依赖。

已有 Muse REST 绑定继续使用原 Worker、专用 Vault token 和固定 native actor。新建订单的 Session 所有权由可信 Host 自动记录，客户端不能指定或更换 actor。原订单、任务、attempt/fence、证据哈希、报告哈希和文件第一版本 SHA 均核对后，Host 才向原 Agent Session 发送一次 notice。`next-step, false` 不启动模型、不新建或修改 Goal。

先验证实际文件字节，再保存原 Harness Session，最后写原业务会话消息和回传回执。原生 notice 保留完整结构；产品会话展示 Worker 原 summary，完整 receipt 和 SHA 保存在消息元数据。保存或回执失败后沿用原 message ID 重试。已回传记录、原 Session notice 或原业务消息丢失/变更，以及未知 owner/Worker/订单漂移均失败关闭，保留现有任务供人工核对。

业务验收仍是独立管理员操作，回传不触发验收；外部研究与工具证据始终未独立验证。既有 Dot 恢复与未派发 Goal 的处理保持原逻辑。

## 前端合同

- `GET /api/personal-worker`：只有已签名、已登录的原管理员 actor 获得 `museTasks` 数组。其他身份省略字段，不泄露 Muse 订单。
- 每项保留原 `orderId/requestId/nativeAgentId/workerId/taskRef/attemptId/fence`、WorkerDesk `status`、bridge `executionStatus`、租约/截止时间、原公开需求、`receipt/receiptHash/returnedHash/acceptedAt`。
- `receipt` 包含 `schema: workspace.muse.session-receipt.v1`、原提交信息与 SHA、`reportSha256/report`、summary/sources/toolEvidence/evidenceNote、`files: [{id,version:1,sha256,filename}]`，`independentlyVerified:false`。
- `GET /api/muse-worker-files/:id?version=1&sha256=<64hex>` 只读原 actor 的原 receipt 文件，校验实际字节，返回 `X-Content-SHA256`。其他管理员 404、viewer 403、错版本或错 SHA 404。
- Host `workspaceMuseSessionHost.reconcile()` 与 `service.muse.bindSession()` 是可信 Host 接口，未注册为模型、MCP 或 HTTP 写接口。既有订单审批/派发/验收路径不变。

## 验证与实际限制

Windows Node 24.21.0：64 项通过，零 skip。包括 11 个新增失败恢复/完整性合同测试、9 个原绑定测试、42 个 Dot history 检查、1 个原 Dot 真实 Harness 测试、1 个新增 Muse 真实 Harness 重启测试。
新增实际 Harness 测试使用下载的原 Cordis/Agent/Session/Goal 源码与真实业务写入和文件服务，测试身份经原 REST claim/upload/submit 后，原 Session、签名 UI 与精确文件下载一致；重启保留同一个活动 Goal、零模型轮次、同 attempt/fence、只一份 notice，拒绝其他身份；没有研究、模型或付费外部执行。
测试日志 `Muse-Session-Candidate-Windows-20261011.log` 随包保存。Linux 生产相关回归仍需云端恢复后运行，不能把 Windows 测试记为 Linux 通过。

云端当前因账号欠费系统停机，旧 SSH/HTTPS 断开，最终 18 文件版与本增量均未切换。恢复后由既定唯一发布方核对原数据、原授权与原 lifecycle，使用 before SHA gate 合并；再做 Linux 回归、原 OAuth 续期/旋转、原公共 Dot 任务与 Muse 已授权产品研究的真实执行、原会话回传及共同列表验收。不要重复建立订单、签发 token 或清除原 Goal。
