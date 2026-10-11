# PR32 独立验收后的前端最小修复

本增量基于 PR32 同树本地保存点 `44529de03603eeb0d6f11e9b0440bad3274ff094`／GitHub `7b891844821803ec61aaf564fe5dfcb903d83a8f`。依据 task3 的 `pr32-final-reverification/FINAL-REVIEW.md` 修正当前前端和测试，不改 `server/`／`deploy/`，不重做 DSH Host。用户已选 Pi-agent 底座，Pi-durable 的选择与迁移由另一独立任务处理；本前端只消费既有业务 API，新 Pi 整合和打包等待其固定候选。

## 两处加载时序和夹具泄漏

旧完整套件中，设置场景只等设置按钮出现就开始，最近会话自动选择尚未完成。于是结束路径有时是 `/chat`，有时是 `/chat/<原会话>`。App 现在以 `aria-busy` 表达首次数据读取／默认会话选择未完成；测试在此就绪后才开始操作，并断言关闭设置回到该 Goal 的确切原会话，仍保留导航断言。

笔记测试曾在会话 scope 的 `<option>` 未加载时直接给 `<select>` 赋值，浏览器的实际值成为空，提交后记录为 null。现在先等待该原会话选项存在、再赋值并断言受控值；持久化范围、停用状态、再次编辑和全局范围的原断言保留。

原 API fixture 的 setup／post／render 发生在场景的 try/finally 外，setup 请求失败会漏掉 app.close，留下服务和计时器。原 19 项套件现在注册 afterEach 清理所有已创建的窗口／服务，listen 后的任意 setup 失败也在清理范围内。测试 HTTP 用每个临时服务独立的 non-keepalive Node HTTP agent，保留实际 loopback HTTP、原服务、原 Store 和请求断言；不继承跨 fixture 的全局 fetch socket 池。响应真实读取完成后构造标准 Response，关闭时取消其自有请求，不触碰其他任务进程。

## 原精灵和原附件预览

默认 chat 实际渲染一个原 `ControlSpirit`。保留既有 SVG、状态样式、动画、动效偏好与 reduced-motion／visibility 行为；只接入会话布局和原助手面板，未生成图像或动画。视觉状态来自当前会话的原 Run／会话记录与诊断，不把 Muse 领取说成模型启动。embedded CloudControl 不另渲染第二精灵。

会话附件增加“打开／预览”，仍读取原 `muse-worker-files/id?version=1&sha256=...`，同源凭据、HTTP 授权拒绝、原 SHA256 字节校验与迟到读取保护保持。通过校验才在当前会话的原 Modal 打开。资料库的安全内容渲染抽为共享 SafeFilePreview：纯文本按文本显示，受支持的 PNG/JPEG/GIF/WebP 作为静态图片显示；不执行 HTML/SVG，不嵌 iframe。文本按原规则显示前100,000字符，Muse 预览限5MiB，PDF和其他二进制仍仅下载。viewer、坏引用、坏哈希和拒绝响应都不开放内容。

## 原 ID 单次编码

浏览器 chat 路径解码一次得到原 opaque ID；历史 raw slash 路径仍可读，导航和业务 API 段编码一次。`original/session`、`original:session`及其组合保留；`%252F`不会再被解码成另一个 ID。Library 的多段视图路径保持原语义。原会话消息、取消、重命名、删除、任务输入、Muse和采购的 API 构建也统一编码。非法编码不生成替代会话或派发；原 Scope/审批/CSRF/owner/epoch 权限没有缩窄或删除。

这是前端构建／解析验证；task3 找到的后台 owner 解码问题交由另一任务修复。本增量不修改旧 Host 路由，不声明已验证新 Pi 的 owner／epoch 合同。

## 当前真实结果

| 本轮检查 | 结果 | 证据 |
|---|---|---|
| TypeScript | exit 0 | 原工具会话20840，无诊断 |
| production Vite | 通过 | 60 modules；JS500.74kB／gzip141.72kB；CSS203.92kB |
| 原完整 V22 UI，同一源码／构建连续两轮 | 19/19与19/19，均0 fail/skip，正常exit0 | run1 102.53秒，run2 82.00秒；不是两项单独重跑替代整套 |
| 会话专项 | 14/14，0 fail/skip，正常exit0 | 原12项，加opaque ID／默认精灵及精确预览／坏SHA／403／viewer检查 |
| URL单次编码／非法编码 | 2/2，0 fail/skip | 原opaque ID、slash/colon、literal percent和Library路径 |

两次整套重复验证不是38个独立测试。模型／Session／Native bootstrap／运输拒绝仍是已标注的离线夹具；原普通 HTTP、磁盘、业务对象和 Native binding/Desk/artifact 是现有实现。未启动 Pi runtime、DSH Host或真实 Muse，没有真实账号执行、唤醒、回传及人审结论。上游未改的3项磁盘/MCP结果沿用独立报告，未算成本轮重新运行。

浏览器 MCP 恢复检查仍为 Transport closed，参考图也未物化。本轮仅 DOM 验证，不表示320/390px真实排版、键盘、动画或Muse像素验收已完成。

## 旧包更正与剩余接续

撤回旧交接中“430源码原始字节完全等于Git”的说法。以独立报告为准：旧包430源码规范化CRLF后相同，395项存在CRLF/LF差异；旧 Host34项清单29项不匹配。总ZIP CRC／总清单通过不能代替严格原Host字节门槛。旧ZIP不作为新的Pi整合／上线候选，未改写失败的SHA来掩盖差异。

本轮不生成新的应用／Host包。待任务二固定Pi-agent／可选Pi-durable候选后，协调会话合并这份前端增量，按一份明确字节策略重做新目标包及独立验收。现有MuseConnector与已保存身份／回执路径保留；两账号Worker方式、真实连接／唤醒、原会话回传、视觉和上线仍各自待验收。

华为生产仍是用户主动关机，本机短断连不代表其开机；没有生产探测、部署、重启、主分支合并、授权/订阅/凭据更新、付费或真实任务领取。
