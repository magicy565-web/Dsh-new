# 原会话 Muse 草案：客户端消费约束

客户端子分支 `codex/wechat-goal-intake-20261012` 从已整合PR36及P1修复/会话幂等/原微信入口的 `e5ae75584b45c8be02dc10b048ebd27b7ea7d3c3` 建立。服务器/API/锁文件由主任务负责。本文件描述需求，接口路径和DTO最终以主任务实际固定源码为准；本文不是已实现服务声明。

最小消费能力：当前原Muse会话的intake文本提交/补充与GET恢复，返回持久草案标识、conversationId、revision、draftHash、phase、真实order候选字段、必要missingFields及明确标注的模型suggestions。补充普通文本只更新该草案。服务端保留原会话消息关联；客户端不解析产品/预算/期限、不补虚构值、不借Pi消息冒充Muse执行。

准备待审原单需要原requestId、expectedRevision、expectedDraftHash、独立公开文字授权及明确的预算/期限确认。返回真实草案和原delegation(orderId/reviewHash)；之后分别走既有approve/dispatch，不能在prepare里合并批准或外发。所有突变复用写前日志的原body/requestId。编辑/拒绝使旧草案/旧reviewHash与旧授权不能执行；过时客户端应收到确定冲突。缺原绑定明确阻挡，不发送普通Pi替代请求。

最小交互沿用一个会话：目标或补充文字从已有composer发送；必要缺项由Agent消息/紧凑卡提示。可审阅草案展示真实产品/市场/目标/预算/期限；建议标为建议，两项确认默认未选（预算期限、仅本次公开文字）。用户可返回、用会话文本编辑或明确拒绝；准备真实订单后，原批准/派发/状态/文件卡继续完成流程。关联企业/产品/私有输入附件不自动进入可公开的order。

默认包仍空baseUrl、touristappid、urlCheck:true。真实账号/原Muse模型执行/生产/付费不属于本次运行验证。代码接线必须等固定后端契约可读，测试必须用真实本地业务HTTP与原Worker协议验证，不把模型提取或模拟DTO当作用户许可或实际执行。

## 已接实际实现（替换此前拟议字段）

后端固定提交 `5eceddc81ae819e5b4c5acc485b339f6df21d28e` 已整合到本客户端分支。唯一使用的请求字段为 revision/draftHash：clarification携带expectedRevision，prepare携带expectedRevision/expectedDraftHash及confirmed、budgetConfirmed、deadlineConfirmed、publicDataConfirmed四个true值。scopeVersion/scopeHash仅后端DTO别名，客户端不读取、不发送对应旧请求字段。

客户端读取原绑定和runtime capability `inert-muse-draft-proposals` 后，GET/POST `/api/conversations/:cid/muse-drafts`；补充走 `/:draftId/messages`；准备走 `/:draftId/prepare`；持久拒绝走 `/:draftId/reject`。模型建议仍独立呈现，publicText原样完整显示，预算、期限和公开文字三个确认默认未选。原单创建后仅显示原approve/dispatch/refresh/accept/文件操作，未合并批准派发。

实际客户端业务HTTP验证 `miniprogram/test/intake-http.test.mjs` 3/3通过，连接真实本地签名企业HTTP、官方Pi faux工具、Store和原Worker协议；回执文件ID由原上传生成、下载字节SHA真实核对。另10项控件/传输fixture通过；它们是单元测试，不能冒充HTTP或真实微信/Muse执行。原独立安全审查被平台中断，未由本任务替代。源码、失败原日志和通过增量均保留在Draft PR38。
