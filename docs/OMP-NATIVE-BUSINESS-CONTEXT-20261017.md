# 原生 SDK 活动叶与业务披露解析修复

当前固定路线以 [开发计划交接](DEVELOPMENT-PLAN-HANDOFF.md) 为准。后续TUI根因已定位并完成限定验收，见 [阶段1报告](OMP-STAGE1-TUI-20261017.md)；本文保留原检查点的历史事实。

同一分支与 Draft PR99，从 `dd3d98ab71e78db0a78d33180a3b91bd6a0e4cb3` 继续。实现提交 `87a1cbc`；完整相关验证源码 HEAD `980422eb40ae8f28025ea9283e61cbbee1740493`。其后仅追加说明和脱敏证据。本轮没有扩展业务或修改旧 journal/proof。

## 确认的反例与界限

用锁定 OMP18.10.4 的原 `SessionManager.appendMessage / appendResetBoundary / appendModelUsage` 构造合法合成日志：A → reset R → 当前消息 B，末尾 usage U 的 parentId=R、activeLeafId=B。原 SDK 上下文含 B，旧 currentBusinessEntries 从物理末行 U 走 parent 链会漏掉 B。旧 helper 来自交付基线 `dd3d98ab71e78db0a78d33180a3b91bd6a0e4cb3`；原始复现元数据和日志 SHA256 在摘要 beforeFixWitness 中，当前差分 fixture 保留相同原生构造。

这证实解析/验收缺口。尚未确认真实业务组合曾自然生成该形状，也没有证据表明已发生生产泄漏；局部合成测试不能替代这些证据。

## 修复边界

移除自写的活动叶与 reset 裁剪规则，直接复用固定 SDK `session-context.ts` 的 `buildSessionContext()`：

- live worker 传入原 `SessionManager.getLeafId()`，包括尚未追加后继记录的内存分支切换/null leaf。
- Node 最终交付通过有界、只读 Bun 子进程调用同一原函数，由其内部原生 `resolveSessionLeafId` 选择恢复活动叶，包含 model_usage 捕获叶、null、普通 usage 及上游规定的缺失捕获叶 fallback。没有复制活动叶规则。
- 这个解析进程不创建 Session、auth store、模型、队列、数据库或授权框架；只接收已有原 journal 经私有 pipe 的数据，限制大小、时间、输出并服从取消。无业务/模型调用或 journal 写入。
- 薄适配只做严格结构入场及现有私有能力支持检查：重复 ID、断链、循环、非法 activeLeafId 类型和畸形 notes/entry 失败即拒绝。原 SDK 为恢复容忍的损坏不能据此获准披露。
- 原生实际发出的不透明 summary/notes/custom 消息，没有本 business profile 可核验的私有来源证明，明确以 NATIVE_BUSINESS_CONTEXT_UNSUPPORTED 拒绝。reset 前由上游实际丢弃的摘要/notes仍被丢弃；reset 后发出的内容不会被静默忽略。没有新造摘要授权或迁移机制。

原 Session/Run、身份、接收者、用途、字段/版本、来源 proof、撤权、取消、插件禁用及最终发送/交付检查继续执行。人工 resetContext 仍只清空同一 Session 的模型上下文；不重签旧历史，不授予业务权限或商业执行许可。操作入口见 [受控继续说明](OMP-BUSINESS-CONTEXT-RESET-20261017.md)。

## 差分和真实边界验证

差分 fixture 使用原 SDK 构造/回放15个场景：捕获活动叶的 late usage、普通 usage、null leaf、缺失捕获叶的原生 fallback、持久与内存分支切换，以及 reset 前后 notes、branch summary、compaction、custom message。可支持输出与原函数逐消息相等；不透明原生输出明确拒绝。另有7个畸形日志拒绝测试。输入在投影前后保持不变。

真实 Store/Host/SDK 新增两条检查：合法 late usage 后改变当前 B 的原订单来源，模型发送前原 Host 精确返回 MARKETPLACE_SOURCE_CHANGED，fetch入口=0；官方 worker 正常退出后再由原 SDK 追加 usage 并改变来源，Node 最终交付同样确切观察到原 Host 的该拒绝码，返回 OMP_DISCLOSURE_REFUSED，不把通用解析错误当作成功拦截。追加 usage 的 fixture 校验同一 Session ID、原 journal 前缀字节不变，并确认原 SDK 仍含当前 toolResult。

模型、身份/审核与业务授权、Provider/Worker/支付/SSE均为明确合成替身；原 Store/Host/SDK/Session/fd3与实际序列化路径真实执行。无真实外部模型或业务请求，Mem0向量关闭。

## 同一源码的完整相关验证

| 执行组 | 结果 | 本地忽略日志 |
| --- | --- | --- |
| native | 20 passed，0 failed/cancelled/skipped | `native-context-final-native.tap` |
| sdk | 22 passed，0 failed/cancelled/skipped | `native-context-final-sdk.tap` |
| regression | 110 passed，0 failed/cancelled/skipped | `native-context-final-regression.tap` |
| reset | 7 passed，0 failed/cancelled/skipped | `native-context-final-reset.tap` |
| context | 22 passed，0 failed/cancelled/skipped | `native-context-final-context.tap` |
| controls | 50 passed，0 failed/cancelled/skipped | `native-context-final-controls.tap` |
| pack / build:omp | 14插件闭包、原生编译/发现/加载、disable/uninstall 通过 | `native-context-final-pack.log` / `native-context-final-build-omp.log` |

使用 Node24.19.0、审计 Bun1.3.14、OMP18.10.4，命令均以 `env -i PATH="$PATH" HOME=/tmp NO_COLOR=1` 清空业务环境。源码/tree、命令、SDK原文件 SHA256、最终日志计数与 SHA256 见 [验证摘要](validation/omp-native-business-context-20261017-summary.json)。各组有交集，不相加冒充独立总数；不是全仓所有测试通过声明。

SDK22项已含原14与清空后8项。两个正常控制各进入一次本地有限 SSE，其余13及7个拒绝场景均零 fetch；包括新增 late-usage-source 的精确原 Host 拒绝。入口计数仍在任何正文断言之前。聚焦 guard 绕过变异再次使测试以1!=0失败并恢复原 fixture/父测试哈希；这是预期失败的敏感性证据，不计作通过项。

## 保留阻塞

既有 public TUI 等待 `terminal model disabled` 超时的根因仍未知。前轮在基线与当时源码同症复现，只说明可复现，不能说明根因已解决；本轮没有重跑或声称 TUI 通过。此前记录见受控继续报告和原失败日志摘要。

真实审核/模型/Provider/Worker/支付仍未配置或未调用；私有交付正文/Artifact 披露、完整浏览器、其他隔离 profile 组合及既有 Medusa 缺口保留。活动中的不透明摘要/notes继续拒绝。没有 main 修改/合并、强推、部署、真实服务器操作、付费、真实凭据读取/配置创建、权限/网络扩大或运行资料入库。远程 CI 未在本轮重查或重触发。
