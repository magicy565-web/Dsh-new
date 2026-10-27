# 买手微刊真实业务接入验收

2026-10-27，北京时间。基于 `2360d7bec665180043ce26e5506eb8d973582571` 的 `dsh-buyer-magazine 0.4.0` 继续接线。本轮结论为 **source-intake-blocked**：已验证现有原生资料工具与核查文件交付，没有取得可用的实际工厂资料或授权网站采集结果，因此没有制作业务微刊，也没有进行该作品的桌面、移动端、交互和 PDF 审阅。

固定源码前发现远端已前进至 `2f1be8d5b90c59b7e46b1004a6f0ad8a145c46f7`（0.4.1，多凭据显式选择）。本轮改动已在该提交上整合，保留 `credentials`、`credentialId 1–100`、同账号 start/status 及不自动轮换的行为；预算预检使用同一选中账号。下面原生模型会话保留首次真实执行记录，不改写为后续版本的执行证明。

## 实际接口核查

| 接口／资产 | 真实观察 | 可用范围与缺项 |
| --- | --- | --- |
| 原生企业资料库 | 登录后 `/workspace-library-api/state` 返回 200；产品 0、文档 0、sequence 0；无登录返回 401 | 服务可用；本次所查 profile 没有业务资料。不能推断其他主机或所有企业系统均无资料 |
| 固定版本引用 | `/workspace-library-api/references` 返回 200，候选 0；无登录返回 401 | 复用原版本／SHA 读取器；本轮没有真实附件可验证字节或来源授权 |
| Workspace 工单插件 | identity、inbox 都返回 MCP `-32603 Internal error` | 未取得任务引用；没有 claim、上传或 submit_result，不编造工单号 |
| Space | 默认配置返回 9 条示例条目及 2 条示例任务 | 属于内存种子数据；文件上传仅元数据，任务列表不是业务执行队列。核查用宿主后续关闭 seedDemo，未写入示例业务记录 |
| ERP | 只读 SQLite 检查：商品、买手、权益、订单、请求、事件与商品关联均 0；认证 workspaces 接口 200 | 复用已有账本；没有真实交易或公开买手交易页 |
| 会话工作区 | 原生 working_directory 与 glob 实际返回空目录 | 云端会话目录不是用户电脑；没有发现远程资料同步或本次真实上传附件 |
| Google Drive | 对“工厂”“产品资料”做有限关键词搜索，未定位可作为本期素材的工厂资料 | 工程设计及一般 AI 文档未当作业务素材；该搜索不是全盘无资料的证明 |
| 安全配置 | 云环境当前观察为 ready 的密钥只有 DeepSeek；没有 Apify 绑定，进程也无 APIFY_TOKEN/APIFY_TOKEN_1 | 实际原生 preflight 返回 APIFY_NOT_CONFIGURED；未读取认证账户预算，未启动 Actor，无 Run/Dataset |
| 分享、分发、回执 | Space 的成员／shared 字段仅为本地元数据；未发现可用的公开刊物托管、买手身份、邮件分发或访问回执服务 | 没有发出分享、邀请或消息；没有买手访问、传播或交易效果可验收 |

认证 HTTP 的原始状态与空数据计数见 [HTTP 核查记录](evidence/buyer-magazine-20261027/native-http-audit.json)，工单插件错误见 [连接器核查记录](evidence/buyer-magazine-20261027/connector-audit.json)。没有读取、导出或公开凭据值。

## 本次接线修改

继续使用原杂志预设、四技能和 DSH 工具。预设与编排技能明确复用已有 `workspace_library_status/products/product_context/references`、会话 read 和真实工单附件，不建立第二套资料库、Agent、模板或任务引擎。只需本期适用的一种授权资料；无需先补齐产品目录、证书、影像或 ERP 账户，也不强制把用户文件导入资料库。

Apify 原工具增加 `action:preflight`，通过官方 `GET /v2/users/me/limits` 读取当前月额度与使用量。每次 start 再次预检；额度无法核实、余额差额不足或费用配置非法时不发起 Actor POST，不修改账户额度。默认单次 cap 为 USD 1，可配置 USD 0.01–5；差额是账户限额快照，不是预留信用额。[官方 API 依据](evidence/buyer-magazine-20261027/api-reference.json) 保留文档地址和所读 OpenAPI 哈希。

启动响应丢失、服务端 5xx 或有效 Run 标识缺失返回 unknown；不能自动重试并重复收费。实际 Run 响应在运行中、失败和空结果时也写入原生 JSON 附件；成功 Dataset 保存原始 items 后再给模型有界摘要。空结果、证据保存失败及 Dataset 读取失败保留准确状态和已有标识。此协议的成功／故障测试使用明确的合成 HTTP 响应，不代表本账户已执行真实采集。

## 原生模型与交付记录

在官方 DSH Web 宿主中实际选择原“网站转杂志”预设，完成一次真实资料接入任务。原生日志确认 Session 为 `session-8fd6c541-0715-4786-a9f6-b3f5b4037df4`；模型实际加载四技能，读取原库状态／产品／文档，调用 Apify preflight，枚举当前工作区，再通过原生 write/read/present 交付核查 JSON。13 次工具结果均无执行错误；preflight 的业务状态仍为 blocked。

原生 `deliverables/presented` 在事件 seq 71，最终 turn/end 在 seq 79，reason 为 completed。这里 completed 表示接入核查任务已结束，**不表示业务微刊完成**。交付文件为 `source-intake-result.json`，10,046 字节，SHA-256 为 `a37e1b2a204ca610d143cc48414649ad3c2c368a37344192f9bfabf72a17fc3e`。实际会话标识、工具调用／事件引用及文件指纹见 [脱敏原生交付回执](evidence/buyer-magazine-20261027/native-intake-receipt.json)。原始会话和模型原文件保留在宿主私有存储，不进入 Git。

模型原记录未获得 Session ID，所以保留 null；上面的确切 ID 来自持久化日志核对。模型给出的七类资料建议不是强制准入条件；后续技能已明确“一种本期可用授权资料即可”。模型把 sequence 0 描述为“从未写入”，本验收只认可当前空库快照，不推断企业历史。

官方 present 保存交付事件与当前文件路径，不复制不可变附件。原生附件 ID、文件哈希、交付事件、企业验收及买手回执要分别记录；本轮交付的是接入核查文件，没有伪造采集附件或买手回执。

## 业务链路结果

| 环节 | 验收 |
| --- | --- |
| 现有接口、当前资料范围及授权入口核查 | 已执行；来源为空、工单插件错误与凭据缺项有记录 |
| 实际工厂资料／授权网站字节读取及来源核验 | 阻塞，未取得本期业务素材 |
| LLM 编辑、设计与交互式 HTML | 未执行，不用旧 Allbirds 或合成材料补位 |
| 最终桌面、手机、交互与全部 PDF 页图审阅 | 未执行；没有可审阅业务作品 |
| 原生交付 | 核查 JSON 已实际 present；业务作品尚未交付 |
| 买手链接、权限、分发及回执 | 未接入真实服务，未宣称效果 |

继续制作需要一个实际可访问且允许本期使用的工厂资料文件、资料库记录或工单附件；如走网站路线，还需明确的授权 URL、有效 Apify 绑定与通过的预算预检。工单插件由其服务端恢复身份／收件箱后才能挂接真实 taskRef；不要求为文件路线等待工单恢复。

## 工程验证

`npm ci --ignore-scripts` 成功；合并远端更新后的 `npm run check` 构建、静态校验和 **250 项测试全部通过**，完整输出见 [检查日志](evidence/buyer-magazine-20261027/check.txt)。预算不足／未知、非法 cap、启动结果未知、空 Dataset、证据保存失败、已知 Run 保留及第 5／100 号账号同凭据预检均有回归。官方 SDK 工具分派及独立四技能发现通过，分别见 [SDK 结果](evidence/buyer-magazine-20261027/official-sdk.json) 和 [技能结果](evidence/buyer-magazine-20261027/skill-discovery.json)；SDK 夹具不等于真实业务验收。合并后实际环境的凭据清单仍为空，见 [最终 Apify 状态](evidence/buyer-magazine-20261027/final-apify-status.json)。

没有运行旧 Allbirds 制作脚本，没有新建或采用被否定的模板样刊。源码、脱敏观察与工程日志可固定在同一提交；没有发布公开买手站点。
