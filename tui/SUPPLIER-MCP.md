# 原 Pi TUI 的供应商 MCP 命令

本适配仍在实际 Pi coding-agent 1.1.0 的同一终端和同一扩展中运行。
`/workspace-muse` 与 `/workspace-supplier` 共享一条原 owner Host RPC 管道，
不启动第二个终端、服务、模型、身份或授权解析器。

## 固定依赖与安装

- 原基线：`8ce17ef22190a878f520bad1871029748f211513`。
- PR57 owner-session 源码：`8af564f15fcb821cde1054984356d2e3f3c75c0c`；
  完整验收依赖：`68558d22a46e92fef4b8a300c69b2fbad61fbb20`。
- 原 TUI/Host 基线：`cc49bc9fd017710e2f948d0cdfa220c1a6a638a5`。
- 本次新增源码全部在 `tui/`；整合方必须先包含上述 PR57 完整代码，再应用本次
  TUI 提交。PR58 分支不复制或改写 PR57 的服务、schema、鉴权和审批实现。

在包含这两个固定依赖的整合源码中运行 `npm ci`、`npm --prefix tui ci`。
生产接入仍按 [OWNER-CONNECTION.md](OWNER-CONNECTION.md)：已授权 Host 使用
内存中的原登录 Session 调用已注册 `launchOwnerTui()`，先 diagnose，再在已认证
前台终端打开 `mode:'tui'`。现有无终端服务不能仅靠环境变量完成这一步。
本提交没有部署或获得任何真实会话。local 无登录模式不能使用此 MCP 路径。

## 命令与模型的明确边界

| 入口 | 实际支持 |
| --- | --- |
| 同一 Pi 中 `/workspace-supplier` | initialize → initialized → tools/list → tools/call，15 项原 owner 工具，交互确认写请求 |
| `/workspace-muse` | 原任务草稿、单独审批/派发、单订单交接、读取/验收继续保留 |
| 默认命令模式的自然语言输入 | 显示帮助，**不运行模型或调用供应商工具** |
| 显式 Agent 模式 | [AGENT-MODE.md](AGENT-MODE.md)：五项原生提案工具、Pi 原生循环、每次可见确认；不含批准/派发/发布/计划启用 |
| 模型工具状态 | 默认模式 modelToolsRegistered:false；Agent 模式 ready 后为 true，自动 MCP 发现仍禁用 |
| 显式 `intake` 的 `input.facts` | 直接调用原事实录入服务；本次实际终端验证使用该方式，模型调用数为 0 |
| 显式 `intake` 的 `input.content` | 参数可按服务端 schema 提交，原后端仍自行检查 Pi 配置、预算和审批；本次没有验证或运行模型文本 intake |

本文覆盖原命令适配；后续 Agent 模式已用合成 provider 验证原生工具链路，真实
自然语言效果仍未验证。两种模式都不授予外部插件授权。

## 调用步骤

1. `/workspace-supplier connect`：验证同一个原 owner/会话，完成 MCP 初始化和
   15 工具目录检查。`realShopifyVerified:false` 保留，不推断真实 Shopify 在线。
2. `/workspace-supplier tools`：列出原服务端名称和说明。
3. `/workspace-supplier schema intake`：查看本次服务端返回的准确参数 schema。
4. `/workspace-supplier call intake`：在 Pi 输入框粘贴参数 JSON，随后检查逐项
   确认对话框；选择 No 不发起录入。工具后缀不带 `workspace_supplier_owner_`。

一个事实录入的参数示例（仅示例，不是真实任务数据）：

```json
{"input":{"facts":{"name":"Example shirt","description":"Owner supplied facts","targetMarket":"US","currency":"USD","skuCode":"EXAMPLE-SKU","supplierUnit":"piece","supplierMoq":500,"wholesaleUnitPrice":"2.50","wholesaleCurrency":"CNY","productionDays":30,"retailUnit":"piece","unitsPerPack":2,"consumerPrice":"9.50","handlingDays":3,"shippingDays":7}}}
```

有 `requestId` 的操作可自行提供原 requestId；省略时客户端只生成一次 UUID，
确认后先 fsync 保存准确请求，再发送。请保留返回的 `serviceId` 和当前 `revision`。

5. `/workspace-supplier call get`，输入 `{"serviceId":"实际ID"}`，读取同一服务。
6. `/workspace-supplier call preview`，输入实际 ID、刚读取的 revision 和明确公开
   字段。预览也需要逐项确认；私有报价、MOQ 和生产交期不能成为消费者 Listing 字段。

```json
{"serviceId":"实际ID","input":{"expectedRevision":1,"confirmed":true,"publicFields":["name","description","skuCode","retailUnit","unitsPerPack","consumerPrice","handlingDays","shippingDays","images"]}}
```

图片及长参数使用 `/workspace-supplier file image_upload`，随后输入**准确的绝对
JSON 文件路径**；仅读取这一个明确指定文件，不扫描目录、不下载 URL。文件中放原
schema 的 `input.filename`、canonical `input.base64`、`input.sourceNote`，以及可选
原 `input.requestId`。本地文件上限 1,500,000 bytes，原 MCP/图片限制继续有效。
确认对话框展示原文件名、来源、字节数和 SHA256，避免渲染大段 base64。
上传返回的 artifact ID/version/SHA 再填入 intake/profile 的 `facts.images`。
未知 URL 仍是 `unknown`，不能因填了 URL 就算图片可用。

`file TOOL` 同样支持其他工具的准确 JSON 参数。原服务端 schema 和校验始终为准。

## 15 项原操作

| 工具后缀 | 命令行为与原约束 |
| --- | --- |
| get | 读取准确服务；不弹写确认 |
| intake | 显式事实录入或原 Pi 文本 intake；先确认 |
| profile | 准确 revision 的事实更新；先确认 |
| image_upload | 原 artifact 持久化；先确认文件 hash/来源 |
| preview | 原消费者可销售单元预览与公开字段；先确认 |
| save_product | 原私有产品库保存/协调；先确认 |
| shopify_observation | 原产品/发布事实读取；按原 schema 确认，不能由发布 receipt 推断真实时间 |
| publication | 读取原发布状态；不弹写确认 |
| publication_review | 准备原审批，不决定审批；先确认 |
| publication_execute | 消耗已经批准的原操作；TUI 确认不能代替原审批 |
| publication_reconcile | 读取同一未知/部分操作；不新建产品 |
| monitors | 读取原监测；不弹写确认 |
| monitor_create | 配置原禁用七天计划；不能激活计划或通知 |
| monitor_check | 原准确范围的一次人工检查；先确认 |
| monitor_stop | 停止原监测；先确认 |

MCP 不包含发布审批决定、计划激活、订阅/通知工具；这些仍只在原人工审批入口处理。
本提交没有调用真实店铺、真实 Muse 或任何付费服务。

## 会话、失败与恢复

唯一新增准许路径是原会话的
`POST /api/conversations/:originalCid/supplier-session-mcp`。Host 每个 POST 重新
验证原 Session、获取原 CSRF，并由原 ingress 签名实际路径/方法/body。子进程不持有
token、CSRF、私钥或 Worker 凭据。外部 `/supplier-mcp` 未加入 Host 路径白名单，
无 resolver 时仍 fail-closed。使用原 transport 已支持的 MCP `2025-11-25` 初始化协议，
不添加额外头转发、MCP 会话凭据或 2026 协议的假声明。

原 request 日志位于 `WORKSPACE_PI_DATA_DIR/supplier-requests/`（默认
`tui/.data/supplier-requests/`），按 owner/workspace/conversation 隔离。它包含用户
确认的私有供应商参数，图片上传可能包含原 base64；这是私有运行数据，不上传 Git
或交给 Muse。Host 凭据不会放入日志。一个同时进行的 Workspace 命令锁避免两类
命令混用同一 RPC 流；子进程退出时仍关闭原管道。

网络丢响应不自动重放。先 get/publication/monitors 读取原状态；对于
`intake/profile/image_upload/preview/save_product`，`/workspace-supplier retry`
可经再次确认重试最后保存的同一 UUID/参数。其他操作拒绝此快捷重试；尤其发布
执行必须使用原 operationId/scopeHash 走 `publication_reconcile`。不换 ID 猜成功。
重启后要重新原安全登录；记录恢复不恢复授权。原服务 revision/hash/审批拒绝
会保留原错误码，缺少 PR57 返回失败，不调用外部路径或业务替代端点。

## 验证与未验收项

在 PR57 `68558d22` + TUI `cc49bc9` 的独立临时整合工作树应用本提交代码后：

```sh
npm --prefix tui test
npm --prefix tui run test:supplier
npm --prefix tui run test:supplier-terminal
node --test test/supplier-session-mcp.http.test.mjs test/wechat-ingress.test.mjs test/pi-muse-binding.test.mjs test/pi-muse-policy.test.mjs
```

`test:supplier` 和 `test:supplier-terminal` 需要上述后端依赖，不在旧基线无入口的
环境伪装通过。终端测试启动实际 Pi CLI，父 Host 和 Pi 使用真实 Unix PTY，凭据留在
合成 Host；它验证初始化、15 目录、No 拒绝、>32 KiB PNG、事实录入/读取、预览和
后端/Pi 冷启动后的相同服务、artifact 和 previewHash。测试不调用模型，真实店铺
与真实 Muse 标志始终 false。日志见 `validation/supplier-*.txt`。

首次补强的隐私测试曾错误假定原 Muse owner 应被现有策略拒绝；已改成由另一个
已登录 owner 在自己的普通会话引用原 Muse 私有图片，按原递归隐私策略拒绝。
没有修改或放宽任何原业务/权限实现。

未验收：生产 Host 前台终端接入、真实登录/TLS、真实 Shopify/Muse、Windows、
模型文本 intake、真实自然语言效果。七天无人值守通知及持久收件人同意仍未授权。
