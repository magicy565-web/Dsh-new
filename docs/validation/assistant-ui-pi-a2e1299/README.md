# assistant-ui 与原 Pi 产品流程验收

已将 **@assistant-ui/react 0.15.28** 的真实 Thread/Composer 接到原 Workspace 主入口。默认提交结构化任务，普通聊天仍可显式选择。目标主入口现在允许已配置的 Pi，继续使用原 Goal/Run、预算、提交 ID、检查点和审批服务。整体仍为 **Draft / release_blocked**。

最终源码 S 为 **a2e12994d68b36a9cffcc95e6e1239c8a0c2dfd1**，tree `c40666c789ffc3e414fce1da068b88c01ee19cc2`。应用和依赖实际构建、后端/Agent/Python测试在干净 **c7ebab587c7e57708109b4ad825ab75b35a5f80e** 执行；之后仅浏览器 driver 与 DOM 测试兼容修正。完整浏览器执行在 **5c3e81d259658e0f1adfdf037ce9ecd3ae81a12c**，当时存在独立 DOM 测试/helper 编辑，原记录保留准确 dirty 状态。最终 DOM 51 项在干净 S 再执行。[逐文件来源证明](SOURCE-EQUIVALENCE.json)核对全部应用/锁文件和原测试字节，不把复用结果重标为新的执行。

## 实际产品接线与资料边界

`WorkspaceAssistantRuntime` 使用官方 ExternalStoreRuntime，只消费原消息/运行/文件以及原 `/api/events` 通知，发送/取消/重试交回原 API。SSE 重连只触发读取；一个连接、cleanup、读取合并和原轮询继续保留。没有 react-pi/node 服务、第二个数据库或模型循环。

选择依据为官方 [ExternalStoreRuntime 文档](https://www.assistant-ui.com/docs/runtimes/custom/external-store)及 [react-pi README](https://github.com/assistant-ui/assistant-ui/blob/main/packages/react-pi/README.md)。本仓库已有原 durable backend，不引入另一份 PiClient/API 运行服务。依赖由官方 npm registry 安装并锁定 exact 0.15.28，实际版本及应用字节见包锁和来源证明。

原 `server/index.mjs` → `Runtime` → `pi-provider` → Pi Durable Harness/GenerationTask/ToolTask 仍是唯一执行链。Pi ToolTask 的 before/after hook 只持久化真实工具名、SHA-256 调用 ID 和开始/完成/失败阶段，禁止携带参数、结果、模型推理或私有文件。UI 不从模型文本或旧事件猜测工具已执行。批准本身不会执行连接器；用户仍需原“继续”操作。

资料库产品/公司文件引用保存在本地会话。**原 BUSINESS_LIBRARY_PRIVATE 政策仍禁止公司 Library 私有字节进入模型/连接器**；关联没有授予发送权。本次完整最小流程使用用户另外明确选定的公共通用工件 v1。没有把公司资料复制为公开资料、追加 standing consent 或改变账户/worker 权限。若下一步需要模型实际读取内部公司文件，需先解决原授权政策，不能将当前本地关联解释为已分析内部资料。

Muse/Dot 仍为各自原绑定/队列/领取回传。queued/receipt/claimed 不证明外部 worker 或模型已执行；此变更没有远程唤醒 Muse 或 ChatGPT Dot。供应商、Shopify、GA4 和七天通知保留原接线及审批，没有生产调用或新持续同意/持久收件人权限实现。

## 实际验收

| 实际执行及源码 | 结果 |
| --- | --- |
| `npm run build`，干净 c7 | exit0，TypeScript 与 Vite 成功；[回执](final/core-c7/build.json) |
| `npm test`，干净 c7 | 766总 / 759通过 / 7条件跳过 / 0失败；[回执](final/core-c7/backend.json)、[日志](final/core-c7/backend.log) |
| `npm run test:agent`，干净 c7 | 41/41；[回执](final/core-c7/agent.json) |
| `npm run test:agent:client`，干净 c7 | Python27/27；[日志](final/core-c7/python.log) |
| 原 UI/会话/引用/Library/Supply 六个 DOM 文件，干净 S | 51/51 / 0跳过；[回执](final/dom-a2e/final-dom.json)、[日志](final/dom-a2e/final-dom.log) |
| Chromium + 原 HTTP/Store/Pi SDK，5c | 11流程 / 9截图 / 0页面错误；11本地合成 provider dispatch、0外部真实模型；[原回执](final/browser-5c/assistant-browser-2.json)、[流程和 SHA](final/browser-5c/web/acceptance.json) |
| 只读 GitHub CI 查询，S | [38377402798](https://github.com/magicy565-web/workspace-agent/actions/runs/38377402798) startup_failure / jobs=[]；[回执](final/CI-SOURCE.json) |

浏览器实际操作完成：主入口任务提交、明确公共 v1 输入、真实 Pi workspace_input 工具事件和原文件精确 SHA 下载、重开无重放、SSE 中断只读重连、UI GoalComposer 保存和 GoalFocus 主按钮启动、原精确批准后独立继续、取消、Host/Store 重启后的原 run/submission/checkpoint 恢复、lost acknowledgment 原请求重试、未配置准确阻断、原企业 viewer 控件禁用与真实签名 HTTP403。没有把工具回执当成生产发布证明。

DOM 51项包括原 UI19、会话/引用/Muse/采购19、当前 Library6、退役 Supply 组件契约7。它们与后端/Agent/适配器的分母重叠，不相加为独立总数。适配器6项已经包含在全后端；[早期专项记录](history/adapter-candidate/ADAPTER-CHECKS.json)保留候选状态。

初次 JSDOM 缺 WHATWG TransformStream、旧 driver 未展开已完成任务的外层 details、以及 busy 状态下旧测试点击 disabled 控件的失败均保留在 [history](history)。最终 helper 使用 Node24 原 WHATWG 实现，几何 shim 明确仅供 JSDOM 无布局挂载；手机/桌面布局由实际 Chromium 验证。失效 session 仍移除可编辑输入及草稿，react-textarea-autosize 留下的隐藏测量节点严格限于单个 sentinel `x`；未降低资料或身份断言。

## 可看交付

| 真实 Chromium 页面 | 截图 |
| --- | --- |
| assistant-ui 主入口，任务执行前 | [桌面1440](final/browser-5c/web/assistant-thread-desktop-1440.png) |
| 原 Pi 任务的工具、计划及文件 | [手机390](final/browser-5c/web/assistant-thread-390.png)、[桌面1440](final/browser-5c/web/assistant-thread-1440.png) |
| 原 GoalFocus 主入口已启动 Pi，拍摄瞬间 RUNNING | [目标启动](final/browser-5c/web/assistant-goal-pi-start.png) |
| 原精确批准 | [批准控件](final/browser-5c/web/assistant-exact-local-approval.png) |
| 原检查点恢复与未知提交回执 | [恢复](final/browser-5c/web/assistant-original-checkpoint-recovery.png)、[原请求重试](final/browser-5c/web/assistant-unknown-submit-original-request.png) |
| 准确阻断与原 viewer | [未配置](final/browser-5c/web/assistant-unconfigured-blocked-390.png)、[viewer](final/browser-5c/web/assistant-actual-enterprise-viewer-390.png) |

[逐图状态及 hash](SCREENS-INDEX.json)区分拍摄瞬间与之后断言；目标最终 review_required/文件下载的证据是 acceptance.json，不能把 RUNNING 截图标成最终完成。

[当前真实前端构建 ZIP](../../../deliverables/assistant-ui-pi-a2e1299/Workspace-AssistantUI-Frontend-a2e1299.zip)只包含当前 dist 三个文件及构建回执，逐字节验证见 [包清单](../../../deliverables/assistant-ui-pi-a2e1299/BUILD-MANIFEST.json)与 [ZIP证明](../../../deliverables/assistant-ui-pi-a2e1299/ZIP-BYTE-VERIFICATION.json)。完整应用需原同源 Host/API/身份，不能双击 ZIP 当成离线委托应用。未创建部署，没有已核实的用户可访问预览 URL，未将 localhost 提供为交付网址。

ZIP 为 **290682 bytes**，SHA-256 `8103472420b1a045cf3871a11917215b59dedb791488b0f1c315fd635efd73b9`。当前代码/构建指纹 `e3d4ce4754cc9e5e12718d8e7f7b463f951ec67a8f41f86d153a78ea27aa5d58`，由原 source-fingerprint 模块计算。

Library 原 prepared-upload helper 再次在只读 hosted tools/list 阶段 network 失败，尚未 prepare/finalize 或写入 Library，没有 confirmed library_file_id；未换直传或入口绕过。按用户已有 fallback，交付私有仓库准确路径及逐文件 SHA，父会话可用其可访问的原附件路径展示。[保存状态](LIBRARY-DELIVERY-STATUS.json)。

## 仍未签署的门槛

七项条件跳过继续是六项缺少受审原 native source/build export、一项 Windows/Linux差异。CI 没有启动任何作业；真实生产 Identity、Pi 模型、Host/Muse/Dot、Shopify/GA4、微信及七天通知未在本任务验证。用户报告生产登录恢复不证明本分支已部署或验收。历史独立安全审查曾被平台拒绝，本轮没有重启、换人、换入口或改措辞绕过，继续 release_blocked。

三个并行方向均按用户指定 **gpt-6.1-sol / xhigh** 执行，[分工记录](AGENT-ASSIGNMENTS.json)。只提交源码、测试、合成截图和处理后的验收回执；不交付运行 Store/session/checkpoint、依赖或真实密钥。没有生产调用、真实发布/通知、凭据/权限扩张、付费、部署、main修改/合并或强推。

旧 13b268e / 017cf20 交付与包保留各自 SHA，当前追加资料没有重写历史。全部本目录文件完整性见 SHA256SUMS.txt。
