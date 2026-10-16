# PR86 → 原 Host 集成验收

本目录记录 `a3d6328` 初次接线验收。后续 0.1.2 容量预留、TED 脱敏诊断与当前任务白名单检查见相邻 `free-trade-capacity-diagnostics-20261016/`；本目录的旧结果与旧源码哈希保持历史含义。

基于 `be0c3c1deb175e0076c14d312bc3157f87ff07d0`，选择性接收 PR86 固定头 `92b23961bbbb26e9118f849a2ade062dd19686f0`。正式包只有 `plugins/workspace-free-trade` 0.1.1；TED/SAM/ERPNext 原客户端的 Git blob 仍为 `1f3facd337726163aeee0933c6bae3ec3b546a31`。没有接入 PR87，也没有回退 be0 的本地资料/权限修复。

## 当前可运行范围

公开入口沿用原 CLI、`createWorkspaceOmpSession`、provider 和原生插件加载。默认配置不启用免费外贸插件；显式选择 `config.free-trade.json`。`--public-only` 不接收本地文件、archive、enterprise 或 project，且写入原 Session 绑定，不能沿旧私有会话切换成公开模式。

```sh
npm run factory:local -- --public-only --plugin-config config.free-trade.json --output-dir /ABS/private/out --session /ABS/private/chat/trade.jsonl --check "仅预检公开采购工具"
npm run factory:local -- --public-only --plugin-config config.free-trade.json --output-dir /ABS/private/out --session /ABS/private/chat/trade.jsonl "按明确公开产品词查询一页 TED，保留原链接和资格不确定性"
```

目录须已存在；`--check` 不调用模型、不创建会话。第二条实际推理命令仍需原有安全模型配置、已审价格和剩余预算，本次没有执行。没有新增 WS/ERP/SAM 密钥配置方式。原本地 128KiB 请求、64 条消息、8 次模型请求、512 输出 tokens/请求、32 次工具及费用不确定即停的边界不变。

私有路径是原 Node24 Host、签名 Session、成员、Conversation/Run 经现有 fd3 通道到 Bun1.3.14/OMP18.10.4。完整 Node Host 依赖 `node:sqlite`，不能冒充已在 Bun 中运行；ERP 密钥与当前记录授权检查保留在 Node。可信进程内 resolver 可以选择 `freeTrade:true`，并用实际 `app.freeTradeSessionBinding()` 注入既有审核范围、安全连接和当前授权函数。契约见插件 README；没有新增生产环境 profile、HTTP 授权接口、账号、审批/授权库、ERP、RAG 或 Agent Loop。

私有回执在原生 Session 中保留精确请求、正文/投影哈希、原 Host 范围和 native Session ID；恢复、压缩后、模型发送前/完成后、worker 交付和 Node 最终交付均检查当前授权与来源。每 turn 最多 8 份不同私有投影、16 次 ERP 读取（包括重验），来源变化拒绝继续。公开外传另需当前工具/输入授权。原生 JSONL 是可信 Host 私有文件，这些哈希不能授权任意用户改写的 journal。

## 实际结果

环境：Node24.19.0 / Bun1.3.14 / OMP18.10.4。

| 验证组 | 结果 | 证据边界 |
| --- | --- | --- |
| 原适配器、公开 SDK、包生命周期、本地资料/来源/预算 | 107/107 | 包含原 77 项适配器、真实 parser/native Session；模型/远端业务数据为合成 |
| 原 Host + Bun 私有接线 | 16/16 | 实际签名 Session/Run/SDK/loopback HTTP；成员、记录、授权和模型为合成 |
| 原启动、Session 只读、终端 | 26/26 | 其中 7 项 DeepSeek policy 与第一组重叠，未重复累加 |
| 原素材/询盘/客户/摄取/计划/Artifact/监测与快照清理 | 42/42 | 原服务真实本地路径，有限合成模型/连接 |
| `npm run build` | 通过 | 10 包静态导入/打包闭包、TypeScript、Vite；保留已有 bundle 大小提示 |

共 191 次顶层 Node 测试执行、184 个不同顶层用例；嵌套 fixture 子项未另外累加。无失败/跳过/取消。命令、日志哈希和已修复问题在 [checks.json](checks.json)，源码哈希在 [source.json](source.json)。原始日志、会话和业务回执不推仓库。

私有测试实际覆盖：准确记录/字段读取和同一 native Session 恢复、撤权/字段收窄/来源变化时零新增模型请求、生成中撤权或来源改变、worker 退出后的 Node 最终撤权、缓存正文篡改/错误伪装/缺失证明/跨 Session 证明、原签名 Session 登出再登录、真实原生压缩后旧工具消息退出上下文、禁用/物理卸载后旧私有会话拒绝复用、私有来源未经另行许可不得发公开检索。缺安全 ERP 连接诚实返回 `unconfigured`，零 ERP 请求。

另一次独立验收沿原 SDK 工具执行真实匿名 TED 请求：一页、limit1、恰好一次网络请求，1663ms，HTTP403 / `REMOTE_AUTHORIZATION_REFUSED`，返回 0 条。结果见 [ted-live.json](ted-live.json)。无法据此区分源站与网络中介拒绝；不宣称 TED 已连通，也不把有限模型的结束文本当 API 成功。没有自动重试。该次脚本结构化输出为 `success:false`；随后补充了非成功退出码 2 的传播，未重复真实请求。官方发布公告查询映射参考 [TED Search API](https://docs.ted.europa.eu/api/latest/search.html) 和 [TED Search API reuse](https://docs.ted.europa.eu/ODS/latest/reuse/search-api.html)。

本轮真实/付费模型请求 0，付费 API 请求 0，增量费用 0 元。历史模型保守累计 0.074952 元未变，不在本轮重复验收或重新计费。

## 仍待真实联调

1. 在允许 TED 匿名 Search API 的现有网络中明确授权再查一次，确认源站响应、字段与真实公告链接；本次 403 不可改成样例成功。
2. 由原 Host 提供合法 SAM key、已部署 ERPNext 的安全只读连接和当前企业/精确记录授权，再做最小真实只读联调。不借用 Dot/Muse 身份或令牌，不让模型生成授权。
3. 另行接入原 Host 业务 Artifact 保存与对应权限/版本重验。当前只持久化原生 Session；报价始终 `persisted:false`，没有创建、提交、发送或下单。
4. 后续获准的模型业务验收继续走原有预算闸门；当前有限模型仅证明接线与拒绝边界，不证明真实推理或业务质量。

未合并 main、部署、扩权、写聊天密钥、联系客户、投标或启动真实监测。
