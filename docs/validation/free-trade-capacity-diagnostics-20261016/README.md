# PR89 收尾验收：容量预留与 TED 拒绝诊断

同一 writer、同一开发分支，从 `a3d6328a7311fc330ad7051901ee297063c3ae20` 继续，插件补丁版本 0.1.2。本轮只修复多记录读取容量和可选脱敏诊断，未接入 PR87。

## 三记录容量

真实原 Host/签名 Session/Run、Bun1.3.14、OMP18.10.4，加有限合成模型和 loopback ERP，复现原实现的问题：第一轮同时请求三份投影、第二轮回答，需要 `3 + 6 + 3 + 3 + 3 = 18` 次读取。原实现读到 16 次后，在 Node 最终交付失败，错误 `OMP_DISCLOSURE_REFUSED`。原始复现日志不推仓库，哈希在 checks.json。

修复在 Node 的工具读取前预留后续所有来源重验额度，且在网络 I/O 前同步保留并发请求的位置。剩余容量不足时返回 `FREE_TRADE_PRIVATE_READ_CAPACITY`，不发该条 ERP 请求。已失败的读取尝试保守保留本 turn 的位置。新模型轮也在请求记账前检查能否留下完成和最终交付所需额度。

总上限仍为 **16**，以下五次独立来源/撤权检查全部保留：请求记账前准备、原 Host hook 后发送前、模型完成、worker 最终交付、Node 最终交付。没有缓存、合并或删除重验。

实际 SDK 三记录测试：两份成功、第三份在 HTTP 前拒绝，首 turn 用 12 次读取完成；续接同一 native Session 用恰好 16 次完成，拒绝无法负担的工具重读。另测第三模型轮预检：只记账前两次模型请求，第三次拒绝；8 次来源读取后，原 worker 仍执行两份来源的交付检查，再拒绝不完整答案，总计 10 次。各检查阶段撤权、生成中改源、worker 退出后撤权、压缩/恢复、篡改、卸载等仍通过。

## TED 403 能说明什么

实际客户端请求 `https://api.ted.europa.eu/v3/notices/search`。官方发布公告 Search API 是匿名接口，不需要 TED key。兼容错误码 `REMOTE_AUTHORIZATION_REFUSED` 仅表示收到 HTTP401/403，不能证明缺 key。参考 [官方 Search API 文档](https://docs.ted.europa.eu/api/latest/search.html)。本轮没有重新访问该 API 或文档。

旧验收仅保留 HTTP403、1663ms、一次请求、零结果；响应头/正文已丢弃，无法事后恢复或断言具体拒绝来源。新增 `createTenderClient({onDiagnostic})` 只向可信进程内观察器输出固定白名单投影；不加入模型工具参数，不附到含密钥的 SAM 请求，不改变现有错误码或发起重试。

正文采样上限 2048 bytes，诊断期限 250ms，并服从原传输中止信号；输出最多 1024 bytes。只保留状态码、粗分类、固定正文信号，以及 MIME/数字重试时间/Via 是否存在/枚举 server、challenge 和 intermediary hint。任意头、Cookie、Authorization、请求 ID、原始正文、URL、异常文本均不输出。403 默认 `http_forbidden_unknown_origin`；明确观察到代理策略或 challenge 信号时另标提示，仍 `causeProven:false`。正文/取消挂起、观察器抛错和短传输超时均不会把已收到的 403 误报成网络故障。

只读网络检查的证据见 [network-readonly.json](network-readonly.json)：**当前任务容器** `/etc/codex/network-policy.json` 为 `restricted`，151 条 HTTP egress host 规则，没有匹配 `api.ted.europa.eu`，有 `api.deepseek.com`，TCP domain/IP 规则均为空。此配置不代表父会话环境；父环境策略在这里不可见。没有找到已有可读代理拒绝日志，`/var/log/private` 不可读，未申请扩权。当前白名单缺项是后续联调的配置阻断，不能作为历史 403 来源的确定证明。

## 验证

| 组 | 实际结果 |
| --- | --- |
| Node24 原适配器 + 脱敏诊断 | 92/92 |
| 原 Host + 固定原生 SDK | 22/22 |
| 公开原生插件/生命周期/来源/预算/入口回归 | 11/11 |
| 固定 Bun 诊断 | 15/15，与 Node 诊断用例重复，单列跨运行时验证 |
| `npm run build` | TypeScript/Vite/十包静态与打包闭包通过，保留已有 bundle 大小提示 |

Node 共 125 个不同顶层用例，无失败/跳过/取消。有限模型与业务授权/记录均为明确合成；实际传输只有本机 loopback。完整命令、日志哈希、容量断言及边界在 [checks.json](checks.json)，源码哈希在 [source.json](source.json)。原始日志、会话、响应或密钥不入库。

## 未完成项与下一轮边界

- 本轮新增 TED/SAM/生产 ERP/付费模型请求均为 0，增量费用 0 元，历史保守模型累计 0.074952 元未变。未改网络、代理、凭据、权限、main 或部署。
- 以后若要真实 TED 诊断，应先由用户/原环境控制面核对并允许**执行该任务环境**的精确 API 域名，再单独授权一次请求；不能把父会话的配置当成本环境已生效，也不能把此 HTTP allowlist 与模型密钥域名设置混为一层。此次不修改或绕过限制，不重试。
- 合法 SAM、已部署 ERPNext 的现有安全只读绑定、真实模型业务验收及原 Artifact 业务保存仍待完成。报价仍 `persisted:false`。
- 已收到 PR87 修复头 `13cccff0df703e6471329cd0e1815aee3f6179a9` 的交接信息，仅存检查点。下一轮另行安排选择性接入最新 PR89 底座；不整包覆盖 Host、不启用 Mem0、不另写 ERP 客户端，不将本轮有限模型测试称为服务真实验收。
