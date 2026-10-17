# 阶段2继续开发：原Host询盘两轮与最终交付修复

源码与测试提交：`1b8546511c3088ca44c041d2e2686be1423f95ac`，基线 `c7fe96683c19925e5ff4a15ad3c997f574d7f859`。同一开发分支/Draft PR99，单写入者。此阶段在用户要求继续后推进，后续交付仅文档。

原认证Host的同Session两轮询盘草稿链已通过有限替身验收；同时修复了实际复现的最终交付缺口。原签名HTTP、Store/Library/Artifact、OMP18.10.4 Session及worker/fd3实际执行，只有模型选择和正文是明确有限脚本。没有真实模型、付费或外部业务请求，不能把本轮写成真实两轮通过。

## 两轮行为与数据权威

第一轮读取原选定询盘文档/version/asset SHA和产品/revision，保存数量100的未审核内部回复，正常stop；第二句话在同一原生Session ID/文件、同一profile中续接，将数量改200，保留MOQ/交期/认证未知，再保存修订回复，正常stop。两轮分别属于两个原Run，模型调用数4/2。

保存均委托原Artifact服务：两份不同Artifact ID，各version1，归属同conversation及各自创建Run，internal可见，正文/SHA与两份原sources匹配。修订草稿是新的Artifact，不冒充对首版Artifact原地更新或新增版本链。首版字节和原JSONL前缀不变；`humanReviewed:false`、`humanReviewRequired:true`、`sent:false`、`externalActions:false`。没有发送、报价批准、订单、派单或新写权限。

## 复现并修复的缺口

1. 基线仅在询盘worker内复核来源与保存结果。合成夹具在worker退出后、Node返回前修改刚保存草稿的blob，原Run仍成功。现扩展已有Node最终边界：从受控原Session文件读取，通过已有固定SDK解析器取得上下文，调用原materials/inquiry客户端复核。超出本profile的工具、畸形或夹带额外数据的回执拒绝，不新建Session、数据库或授权。
2. 加上Node边界后，仍复现最终Artifact下载等待期间产品来源升版或草稿自身升版，旧回执校验放过陈旧结果。原inquiry客户端现于下载后重新读取来源投影，在最后授权等待之后同步核对当前来源、Artifact版本/哈希及全部未审核/未发送标志。原保存提交检查复用同一来源版本检查，写意图要求不变。
3. 最终反例均拒绝为 `OMP_DISCLOSURE_REFUSED`：worker退出后blob变化、最终读取期间来源升版、草稿升版、以及通过原签名HTTP撤销原Session。未变化的最终读取控制仍成功。已经提交的内部草稿保留；失败不声称回滚。

这些是本地合成竞争反例，没有声称已在真实生产自然触发。没有修改DeepSeek Provider、限额、预算或收费机制，没有新增AgentLoop/DB/队列/权限体系，也没有把询盘profile并入默认预览或迁移其他profile历史。

## 验证

Node24.19.0、固定审计Bun1.3.14、OMP18.10.4。执行环境仅继承PATH、临时HOME和NO_COLOR，无真实凭据。最终生产/测试文件与上述提交一致。

| 最终源码检查 | 结果 |
| --- | --- |
| 新同Session两轮/保护/最终读取9项 + 既有询盘服务及原OMP验收 | 23 passed，0 failed/cancelled/skipped |
| 原SDK上下文差分、可选包移除、Session重置、business组合/发送 | 44 passed，0 failed/cancelled/skipped |
| typecheck | 通过 |
| build:omp | 14插件原生编译/发现/加载及disable/uninstall通过 |
| plugins:pack-check | 14插件闭包通过；插件包文件本轮没有变化 |

中间源码另执行原包/解析/本地续改/移除29项、business/Brain/统一入口35项，均通过；其后只调整了询盘最终授权等待的顺序，最终23/44组及typecheck/build重新执行。pack在调整前执行，全部插件包字节与最终源码一致。计数重叠，不累加总数；编译/替身通过不表示14个真实服务连通。完整后端、浏览器及真实服务未执行。

新增测试为 `test/workspace-omp-inquiry-continuation.test.mjs`。精确argv、固定源码tree/文件及日志SHA256、初始失败与中间竞争反例口径见 [数值证据](validation/omp-stage2-inquiry-host-20261017-summary.json)。初次5项测试中的另一次失败是测试错误地期待未脱敏403业务码；已改为原插件既有 `ORIGINAL_AUTHORIZATION_REFUSED`，没有改产品错误映射。原日志/合成资料/Session/Artifact正文不提交，测试目录自动清理。

## 当前剩余项

DeepSeek历史真实接入已由[旧脱敏记录](validation/live-two-turn-20261016/README.md)证实，两次真实请求read/write成功；最终确认当时被本地 `SHORT_INPUT_LIMIT`挡住，首轮未正常stop、第二轮未提交。既有长度修复已纳入，本轮未提高任何限额。该检查点0.051610元累计保守费用、4.948390元剩余授权估算均不是今天账单或可花余额。

当前安全模型配置可用性、原5元累计账单/在途费用及剩额、真实资料的适用授权、真实模型完整两轮仍未核实。[固定阶段2](DEVELOPMENT-PLAN-HANDOFF.md)的工程准备继续完善，但真实验收尚未通过，阶段3–5不推进。未读取/创建真实凭据或配置、读取真实运行资料、操作服务器、付费、扩权、部署、改main、合并或强推；Mem0向量关闭。
