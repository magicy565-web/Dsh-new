# 把一个已派发订单交给已有 Muse

此交接使用原 Workspace 审批、原队列和用户已有 Muse。它不会发送消息、唤醒
Muse、调用普通模型代替 Muse，也不安装监听器、创建授权或执行真实任务。

## 主人在原 TUI 中准备

1. 按 [owner 接入说明](OWNER-CONNECTION.md) 完成原安全登录并连接同一原会话。
2. 用 `/workspace-muse new` 保存公开范围草稿。核对产品、市场、目标、内部
   credits 上限和明确截止时间；保留返回的 `orderId`。
3. 分别运行 `/workspace-muse approve ORDER_ID` 和
   `/workspace-muse dispatch ORDER_ID`，逐项核对并确认原审批。
4. 运行 `/workspace-muse handoff ORDER_ID`。它只读服务端现状，并写出
   `WORKSPACE_PI_DATA_DIR/handoffs/ORDER_ID-REVIEW_HASH.md`
   （默认 `tui/.data/handoffs/`）。返回 `externalSend:false`。
5. 打开并检查这个小文件，再由主人交给**已有真实 Muse**。不要发送整个
   `.data` 目录，不要附 session、cookie、CSRF、key、token 或运行状态目录。

文件写入前要求：任务已派发且未到截止时间、同一原 orderId/taskRef、准确
reviewHash，以及原批准 worker。草稿、取消、完成或过期任务拒绝生成。
重复生成相同文件复用原内容；已有内容被修改时拒绝覆盖。运行数据不进 Git。
生成后的文件只是快照，不能代替实时 task-get/status，也不能证明 Muse 在线。

## Muse 收到后

生成文件已经填入准确订单 ID、reviewHash、workerId 和已审阅公开字段，并包含：

- 核验原 CLI 安装位置与已审阅 SHA256，再使用原 Vault/authd 读取 identity、
  inbox、指定 task-get/status。远端实际版本未经本次验证；不覆盖真实安装。
- 只领取该订单；原 requestId、claims/intents、attemptId/fence 始终保留。
  丢响应仅重试原操作。pending 的空租约不允许执行；不重复创建或重新领取。
- 真实执行并在有效服务器租约内 heartbeat；读取状态后上传真实结果文件，
  使用真实来源和诚实证据提交。内部 credits 不授权新增提供方支出。
- 取消、到期、无权限或不可执行时停止；真实停工后用原 attempt/fence
  confirm-stop。event-ack 不等于停止；409 不是成功。
- 返回同一个 orderId 的实际状态、摘要、来源、文件 ID/version/SHA 与未完成项。

主人运行 `/workspace-muse refresh ORDER_ID` 读取同一真实 receipt 回原 Session，
查看证据后再单独 `/workspace-muse accept ORDER_ID`。若没有真实回执，明确
保留未验收；本地 fixture 通过、排队成功和本说明都不算真实 Muse 执行成功。

七天无人值守通知、持续收件人同意和任何新的后台自动执行不在此交接范围内。
