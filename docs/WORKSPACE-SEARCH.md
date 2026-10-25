# 工作区检索

在原生 DSH 对话中可以直接说：

> 查找当前工作区里与 linen 有关的已存信息，分来源列出结果。

经营记忆 bundle 注册只读工具 `workspace_context_search`，复用现有资料库、记忆和询盘服务。
无需新增配置或导入索引；检索本身不调用模型、不写数据。

```json
{"q":"linen","perSourceLimit":5,"sources":["library","memory","inquiries"]}
```

`q` 是 1–200 字符的单个字面短语，不是 OR 关键词、全文语义搜索或外网搜索。
`sources` 可省略，也可选择上述部分来源。
`perSourceLimit` 默认 5、最多 10，分别限制产品、文本资料版本、记忆、询盘各类结果。
结果总 JSON 不超过 32 KB，超过即明确拒绝；没有静默截断原文，因为检索不返回原文。

| 来源 | 范围与检索字段 | 后续读取 |
| --- | --- | --- |
| 产品 | 当前 profile 企业共享资料；仅未归档产品，名称／简介／分类／SKU 编码等已有字段 | 产品上下文工具，带产品 id／修订 |
| 资料版本 | 当前 profile 企业共享资料；可读文本版本的标题／文件名，保留历史版本 | 原文引用工具，带确切 id／版本／SHA |
| 记忆 | 当前 Agent 的原生工作区；已批准、未过期且来源可用的记录，复用字面召回 | 记忆召回工具；核对 id／修订，不能把后来替换的记忆当旧记录 |
| 询盘 | 当前 Agent 的原生工作区；公司／产品名称／询盘标识 | 询盘读取工具，重新核对原文件及当前行哈希 |

各结果带 `reader.name` / `reader.arguments`。Agent 自行决定是否调用后续读取器。
记忆结果只给对象、事实键和记录标识，不返回陈述全文；待审核候选不会进入此入口。
询盘结果包括暂停／退订状态，目录命中不授权跟进。

来源组的 `available` 表示本次查询成功，可以有 0 个命中。
`unavailable` 表示可选服务未提供，`failed` 表示读取失败；两者都不表示该来源没有数据。
各来源独立读取，`discoveryOnly: true` / `exhaustive: false`：这不是原子快照，也不覆盖二进制文件正文。
在实际引用时，必须调用专用读取器并重新核对身份、版本、审核和可用状态。

原生会话决定工作区，不接受调用方自填工作区或角色；返回前再次检查会话归属。
原生取消及插件卸载会取消检索。底层读取错误不会回退到未经审核的内容。

验证：`npm run check`；官方运行时可选验证：

```sh
DSH_RUNTIME_DIR=/workspace/dsh-runtime node integrations/dsh/dsh-workspace-memory/dev/native-smoke.mjs
```

该原生冒烟以合成 Agent／数据验证三个来源和后续原文读取，不调用模型。

2026-10-26（Asia/Shanghai），真实 DeepSeek Flash 在隔离 profile 中自主使用统一检索及既有读取器，
一个原生会话完成 10 次有结果的只读工具调用，无工具错误。
数据为合成夹具；验证范围包括来源分组、工作区归属与读取衔接，不代表模型业务建议已获批准。
本机原始事件在 `/tmp/dsh-workspace-search`，报告在 `/workspace/artifacts/dsh-workspace-search`，不进入 Git。
