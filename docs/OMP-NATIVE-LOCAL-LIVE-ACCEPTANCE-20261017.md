# 原生真实模型与本地资料两轮验收

日期：2026-10-17。本文仅转录协调方提供的现场脱敏结果；文档作者未操作服务器、读取凭据或下载原始 Session、运行日志、输入及输出正文。

## 固定版本与验收范围

- 本次真实调用使用原固定源码 `95b0a2f8ecbd23231c4a7cee9872e18fe23394f2` 的 1,256 项源码选集；现场逐文件 SHA 全部核对通过。
- 运行环境：Node 24.19、Bun 1.3.14、OMP 18.10.4，使用原生 SDK Session 与原 factory CLI。
- 本地资料插件为原 `workspace-local-materials` 0.2.1；原 CLI `--check` 返回 exit 0、`preflight-ready`，确认启用插件仅此一个，预检模型请求为 0。
- 模型：官方 DeepSeek-flash，真实模型响应；输入资料及业务目标为明确合成验收数据。
- 本次分别验证无工具原生会话、显式本地文件读取及保存后的原生续会话。未改用替身模型或另建循环、会话数据库。
- 记录编写时 PR99 开发分支 HEAD 为 `5106662c31be6e845e8f9d36da17f93d9b96a0d6`。该 HEAD 与现场固定 `95b0a2f` 不相同，本报告不表示整条 PR99 分支已部署。

## A. 无工具原生连续会话

先进行两轮无工具调用，共 2 次实际模型请求，响应与用量均已确认。

- 同一原生 Session 的第二轮正确回忆第一轮验收标签和 MOQ。
- 本组保守费用上界：人民币 **0.007602 元**。
- 该组建立真实 provider 与原 SDK 连续会话基线，不单独证明资料工具、企业资料授权或 Brain 业务链。

## B. 原 factory CLI 两轮本地资料闭环

调用原 CLI，显式选择 **2 份合成 input**。默认仅启用 `workspace-local-materials` 插件，工具范围仍为原 `read`、`write` 及三个字段工具：

- `workspace_factory_capabilities`
- `workspace_factory_rfq_requirements`
- `workspace_factory_match_prepare`

模型自主选择实际工具，没有强制每轮重读，也没有启用默认之外的企业或业务 profile。

| 回合 | 实际模型请求 | 现场实际工具顺序 | 保守费用上界（人民币） |
| --- | ---: | --- | ---: |
| 第一轮 | 4 | `read` × 2 → `workspace_factory_match_prepare` / `workspace_factory_rfq_requirements` → `write` | 0.026672 元 |
| 第二轮 | 3 | `workspace_factory_match_prepare` → `write` | 0.030578 元 |
| 本组总计 | 7 | 两轮均完成，原 SDK 同 Session 继续 | **0.057250 元** |

- **7/7 请求用量确认，`billingUncertain:false`。** 工具调用数量不等于模型 HTTP 请求数量。
- 第一轮合计 input 10,332 / output 751 / total 11,083 tokens；第二轮合计 input 12,913 / output 594 / total 13,507。这些是各轮多请求汇总，不是单次请求输出；本轮没有提高原单请求限制。
- 第二轮原 SDK 返回 `resumed:true`，恢复同 Session 的 2 个已读来源；无需伪造新来源或强制再次 `read`。
- 两轮分别保留一份合成草稿，文件权限均为 `0600`；`sent:false`，均未获人工审批，未对外发送。
- 人工检查合成草稿：没有虚构价格、产能、交期或认证。续稿保留无 logo、银色、纸盒条件；客户的 30 天目标仍为客户要求，没有写成工厂承诺。
- 这些人工检查仅针对本次合成样本，不构成对全部模型输出质量的保证。

## 费用口径

本地资料组为 **0.057250 元**；前置无工具组另为 **0.007602 元**。协调方合并历史记录后给出的累计保守上界为 **0.139804 元人民币**。

以上是已确认请求用量对应的保守费用记录，不是账户账单、余额或新的付费授权。本文未查询账户账单，不新增模型请求。

## 与其他验收的关系

- 本报告证明固定 `95b0a2f` 的 **native local files** 两轮真实模型链：显式本地资料 → 原工具 → 带来源草稿保存 → 原 SDK 同 Session 恢复来源并续稿。
- 不证明 Web 入口、Medusa 服务、enterprise-context 授权资料/结构化记忆、Brain 的真实模型业务链，也不证明当前完整分支或生产部署通过。
- [Brain document reference 验收](BRAIN-DOCUMENT-REFERENCE-20261017.md)属于另一组证据：`dbccbf9` 加 4 文件最小修改后，真实 Node/原 Host/权限类＋合成 Store 的 **43/43（19 新＋24 原）**通过，后提交为 `5106662`。其读取范围是文档引用 metadata，不能当作本文真实模型已经读取了企业正文或结构化事实。
- [此前腾讯云指定矩阵](OMP-TENCENT-ACCEPTANCE-20261017.md)与[本地 CLI 说明中的历史记录](WORKSPACE-OMP-LOCAL.md)保留各自版本、失败、费用及边界。本次成功不改写过去发生的失败，也不把早期 `95b0a2f` 记录概括为所有当前服务器部署状态。
- 不涉及此前受阻的 receipt 恢复安全复审；该复审仍无结论。本次普通原 SDK 两轮事实按现场证据记录，不据此扩大被阻断审查的范围或结论。

## 脱敏证据

本地资料组在 18:39:52 UTC 由唯一现场操作者启动一次，最终 exit 0，`factory-two-turns-passed`。执行入口为现场已核安全脚本 `run-native-factory-two-turns.mjs --run-two-turns`，脚本 9,925 bytes，SHA256 `93c797d112df31132f9ffb05c42c5e16782604ba404c6da9c463a1591c5b0b83`；它调用原 `scripts/workspace-omp-local.mjs`。本文不包含该现场脚本或认证内容。

以下大小与 SHA256 由唯一现场执行者提供；本文作者没有下载原始报告或草稿重算服务器 hash。

| 现场证据 | 大小 | SHA256 |
| --- | ---: | --- |
| `native-factory-deepseek-20261017/final-safe-report.json` | 4,485 bytes | `8925dba2a0d6c1a7bda5604c8386521acfc334da901d428a3e61370b42ffa0f6` |
| `inquiry-review.md` | 878 bytes | `c32cccae0cd893830cc43b1602724f263822c470073427b32786d81d69b48ad3` |
| `inquiry-followup.md` | 769 bytes | `024a3166da745962b55e3a4f1aeb1b6e993a42497af80c9bb684e7ff05a69c02` |

最终报告权限 `0600`、uid 1000。两份草稿各保留 2 个实际来源 SHA：`PRODUCT.md` 为 `b29b01e81f4c4e1bf5c5d0ac3f7f831acc41b6570df6c2017d7a4fcaa1eca714`，`RFQ.txt` 为 `011268e55c55376133b6c025fe0470eb8b912e01969f3c2b53b74c47f376a34a`。

仅提交结果说明与校验摘要，不提交原始报告正文、模型会话、实际输入输出文件、绝对运行目录、凭据或运行数据。
