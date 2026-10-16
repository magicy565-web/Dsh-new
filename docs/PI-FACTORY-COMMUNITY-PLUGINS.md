# 中国工厂 Pi 插件与可选社区工具

产品使用者是中国工厂，目标是整理本厂产品与供货材料、理解海外客户 RFQ，并在有真实工具证据时研究潜在经销商。不要把本版本当作让工厂选择供应商买货的产品。旧采购源码和文书链保留为明确非默认的历史兼容回归。

本厂普通包名称为 `@workspace-agent/pi-factory`，兼容目录仍是 `plugins/workspace-procurement`。标准默认入口只公开工厂配置状态、客户 RFQ 整理、本厂已提供材料的匹配准备，以及原成员任务/结果读取。它不会创建采购任务，不读取企业私库，不编造产品、产能、MOQ 或交期；供货是否匹配始终待人工确认。缺绑定为 `unconfigured`，静态能力或合法配置不代表已连接。

工厂包使用 [官方包规范](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/coding-agent/docs/packages.md)的 manifest/default extension 和 [官方 SDK](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/coding-agent/docs/sdk.md)。普通模式保留其他工具、命令和会话操作。受控模式仍单独显式选择，保留原身份、预算、批准以及 Library 缓存逐次重鉴权与精确模型接收方约束；安装普通包不会激活受控模式或迁移私库会话。

本轮仅核查三个明确候选，不安装合集或自动增加可执行组件。固定 npm 版本是 `pi-web-access@0.40.0`、`pi-quiver@6.13.2`、`pi-subagents@0.78.0`。仓库分别为 [pi-web-access](https://github.com/nicobailon/pi-web-access)、[pi-quiver](https://github.com/jjuraszek/pi-quiver)、[pi-subagents](https://github.com/nicobailon/pi-subagents)。版本、tarball integrity、发布来源、入口和依赖由隔离验收记录核对；旧开发依赖或通配 peer 不能证明兼容 Pi 1.1.0。验证使用 Node 24.19.0、干净 HOME/Pi 配置、公开或合成目录，没有真实模型/密钥/企业文件。

可选使用过程是：先以实际文件工具读取用户明确提供的非私密产品资料，再用 RFQ/本厂材料工具整理缺项；有已核查且实际可用的公开搜索工具时，按产品类别和目标市场查询潜在经销商，并保存返回 URL、标题、证据片段及未确认事项。没有搜索回执就报告缺口，不能用假候选或原采购任务补出“市场研究”。搜索命中不是已确认买家、真实采购需求或联系同意。引导式报价、样品、跟进和履约需要各自的后续真实能力，本轮不发送、不接单、不付款。

文字型 PDF 的文本提取不等于扫描件 OCR。解析依赖、工具默认路径与直接调用发行脚本的结果必须分别记录。候选自动下载 Python/OCR 依赖时先核查；不能通过隐藏现有运行器或换入口绕过限制，再声称完整工具已通过。子代理同样需要真实官方 Pi 子进程、工具回执和取消证明；明确模型替身只验证链路，不验证真实推理质量、付费模型额度或商业成果。

[固定官方 MCP 说明](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/coding-agent/docs/mcp.md)已提供 stdio 和 streamable HTTP。需要 MCP 时复用官方配置/extension，不另写搜索、解析、子代理或 MCP 调度引擎，也不把某个 MCP adapter 当作必装依赖。新增服务器配置先保持未激活；私库授权、账号 OAuth、邮件发送和商店写入不在本轮范围。

主会话提供的社区参考只作后续选型线索，未在本轮安装或验收：

| 参考 | 类别／用途边界 |
| --- | --- |
| [BubblePtr/awesome-pi](https://github.com/BubblePtr/awesome-pi)、[thevibeworks/awesome-pi-agent](https://github.com/thevibeworks/awesome-pi-agent) | 插件目录，不是已连接能力 |
| [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff)、[narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions) | 实际扩展套件；不能整体安装或无核查加载所有入口 |
| [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)、[ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | Skill 流程参考；不等于工具、免费服务或授权，Claude/商业连接依赖需另外核对 |
| [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | 多作者 MCP 服务目录；每个服务的来源、运行权限和账号范围分别核查 |

不自动复用宿主账号，不从旧聊天或配置搜集密钥，不安装未选候选，不部署、不合并 main、不发布 npm。真实模型配置和五元总预算仍需安全确认及剩余额度；合成验收不会消耗该预算。

后续授权已选择固定 Oh My Pi 作为开发默认入口方向：[官方仓库](https://github.com/can1357/oh-my-pi)，npm `@oh-my-pi/pi-coding-agent@18.10.4`。必要SDK依赖在隔离目录安装，Bun 1.3.14 单独校验、固定且禁安装hooks；默认启动和原Conversation账本适配仍在开发。原 Pi 1.1.0 保留显式回退，不同时执行同一任务；上面三个候选的 Pi 1.1.0 验收不冒充 OMP 兼容证明，也不默认叠加重复的搜索/子代理组件。

OMP内置搜索来源/403、公开Markdown、已有Chromium及实际eval浏览器/取消检查见 [内置工具验收](validation/omp-builtins-factory-20261014/README.md)。真实DDG连接失败、零来源；不能声称客户研究已完成。原账本文书 `factory-export` 与简短社区Skill改编见 [工厂文书验收](validation/factory-export-20261014/README.md)。这些已测组件仍不等于默认入口端到端或商业成果。
