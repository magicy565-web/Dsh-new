# Pi P1 修复检查点 — 2026-10-12

原始独立复现来自 PR37 `75babfb424c438122cab695c8b3814785e6bf7c8` 的
`acceptance/independent-ee1ad6c.mjs`，本分支逐字节保存同路径，SHA256：
`9457965c411d12541a764544d8b8a965244d59e0a7d90a65dac749711c5ba291`。
未改原断言。登录 WIP `7aefb2d` 保留但未挂载 broker；客户端 PR36 未在本检查点整合。

## 已复现与修复

同一原脚本的 6 项后端检查，在隔离 ee1ad6c 和修复前当前分支上均为
0 pass / 6 fail。修复后 6/6、0 skip：

- 通用 Worker list 不含原 Muse 订单；详情和通用变更路径 404。必须用原
  delegation 的审批 hash / dispatch / Attempt 对账协议，原主人也不能绕行。
- 非主人对原 Muse 会话的 Pi 注入 403；受保护回执作为普通 Pi input 为 403，
  两条路径都为 0 model calls。保护涵盖通用读取、search/bootstrap、关联写入、
  输入准备/执行快照、历史上下文与 Library Connector。没有绑定配置时仍按
  保存的 provenance 关闭私有读取。旧私有输入 Run 及其输出不能洗成普通文件。
- 原 owner 专用文件 route 仍按 version/SHA 返回原字节；原协议未重建。
- 官方 SDK 的 raw SSE 无 usage 时，三个业务 counters 为 null，status unknown；
  不把 Pi 初始化的三个零当计量。Cache fixture 为 prompt100/output5/total105，
  另保存 read/write cache counters。
- 同一 1600-token Goal 的四个真实 loopback SDK 请求发出 max_tokens
  `[400,400,400,400]`，总 ceiling1600。每次实际 SDK dispatch 前在原 durable
  invocation 文档 fsync reservation，按剩余额度及请求槽分配。缺 usage、未完成
  请求和进程崩溃保留完整 ceiling；只有验证过的计数能释放余额。SDK retries0。
  这是本地请求额度验证，不是已测在线收费。没有另建调度器或批准业务 effect。

安全 policy fingerprint 已更新。旧 policy 下 interrupted work 不会绕过 scope
检查自动恢复；新 policy 下的 pending / answered / metadata-gap SIGKILL 三场景
保持原 Run/Submission，后两场景不新增模型调用。原审批/租约/幂等断言保留。

## 当前实跑

日志在 [validation/cloud-pi-p1](validation/cloud-pi-p1)。各套有重叠，不累加。

| 实际命令 | 结果 |
|---|---|
| PR37 原脚本，后端名称过滤 | 6/6、0 skip、exit0 |
| PR37 原脚本完整14项 | 9 pass / 5 fail / 0 skip，exit1 |
| Pi/runtime/usage/policy/durable/crash/Muse 六文件 | 18/18、0 skip、exit0 |
| npm run test:all | exit0；backend541 total /534 pass /7 skip；UI19/19，会话14/14；build/mini pass |
| node test/pi-conversation.browser.mjs | 真正 Chromium151 六项 pass，console errors0；390/320、SHA文件预览/reload、reduced motion |

完整严格检查剩余5项：accepted Muse文件卡留存、failed终态、确定拒绝解锁、
上传 PDF 留存、过期登录 UI。它们归客户端 PR36，尚未在本检查点整合，
不能把9/14称作整体验收通过。7 skip 为原6个 DSH/source-bound 与1 Windows-only。

观察到的两轮全量失败也保存：首轮 Library 原源码 hash pin 拒绝授权的窄安全改动；
只添加新精确 blob pin，未删除行为断言。第二轮无绑定的合成 native receipt 被
新安全规则正确隐藏。该 DOM fixture 现在先声明真实离线原 owner binding；原
receipt hash、确切 task 关联、无自动派发/无模型与权限断言全部保留并重跑通过。
PR37 外部原脚本没有任何修改。

## 边界

这些是本地修复证据，独立审核尚未重启/确认通过。原 ee1ad6c 源码 ZIP 是已被
独立证明存在 P1 的历史包，不得当修复版使用；待客户端/剩余契约整合后生成新
固定 Git blob 字节包与逐文件 SHA256。当前无 main 修改/合并、强推、部署、生产
探测/唤醒、真实 Muse/微信账号、真实 Pi计费或新凭据。截图为明确标记的 Pi faux
本地浏览器；不是微信真机、原 Personal Agent 执行或生产结果。
