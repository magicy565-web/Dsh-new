# Muse 安装与 Python 薄客户端

客户端源码为 `client/ws_client.py`，服务公开下载路径为 `/plugin/client.py`。依赖仅 Python 标准库，Python 3.10+。客户端只提交任务、读取公开执行摘要、查询、重放与下载；业务计划、模型、工具和商业状态都在原 Workspace 服务器。

## 安装入口

对 Muse 说：

> 帮我安装 Workspace Agent 插件：https://workspace.cnsubscribe.xyz/install

`/install` 根据受校验的当前 Host 生成纯文本，顺序固定：创建 `custom.cnsubscribe-workspace-agent` Bearer 连接器；在安全凭据页填写一次用户 token；下载客户端到 `~/workspace/tools/ws-agent/ws_client.py`；运行 health 和 presets 并回报真实 readiness；介绍三类任务。

token 由服务器绑定既有企业成员及 `agent:read` / `agent:submit`，不是新增账号。用户只在真实运行时的 Secure Vault 页面填写；服务端密钥也只由管理员在安全配置中录入。不要把 token 放进聊天、下载包、源码、命令行参数、客户端 .env、磁盘文件或日志。配置中心按成员撤销、轮换或设置期限。

运行时必须确实支持对 Python 进程注入 `WS_AGENT_TOKEN`，或由可信 Python 适配层以 `Client(token=...)` 传入内存凭据。若运行时只有受托 HTTP connector，需对接其真实请求适配方式；不能把 Vault 导出成文件。代码没有臆造未核验的 Muse 管理 API。**本轮完成了下载客户端及本地环境变量模拟，没有取得真实 Muse Secure Vault 一次填写后长期注入的回执。**

## 命令

下列命令假设可信运行时已经在进程中安全注入 `WS_AGENT_TOKEN`。非秘密服务地址使用 `WS_AGENT_URL=https://workspace.cnsubscribe.xyz`。远程必须 HTTPS，仅回环地址允许 HTTP。

```bash
python3 ~/workspace/tools/ws-agent/ws_client.py health
python3 ~/workspace/tools/ws-agent/ws_client.py presets
python3 ~/workspace/tools/ws-agent/ws_client.py submit \
  --request-key procurement-20261012-001 \
  --type procurement --title '500ml 保温杯采购研究' \
  --input-json '{"product":"不锈钢保温杯","spec":"500ml，双层真空","quantity":1000,"market":"美国","target_price":"CNY 18/个，EXW，待确认目标上限"}'
python3 ~/workspace/tools/ws-agent/ws_client.py lookup procurement-20261012-001
python3 ~/workspace/tools/ws-agent/ws_client.py status TASK_ID
python3 ~/workspace/tools/ws-agent/ws_client.py replay TASK_ID --from-seq 0
python3 ~/workspace/tools/ws-agent/ws_client.py replay TASK_ID --format json
python3 ~/workspace/tools/ws-agent/ws_client.py resume TASK_ID
python3 ~/workspace/tools/ws-agent/ws_client.py download TASK_ID --output-dir ~/workspace/outputs/TASK_ID
```

submit 可省略 `--request-key`，客户端生成 UUID 并在请求前以 stderr JSON 给出。`--input-json` 省略时从 stdin 读业务字段。`submit --no-follow` 只返回提交回执；`resume --no-follow` 只执行恢复请求；download 可重复 `--name` 限定登记产物。全局 `--timeout` 必须放在子命令前。

| 输出 | 协议 |
| --- | --- |
| 流式 stdout | 每行一个未经重写的事件结构 `{seq,kind,payload,ts}`，文本值会移除意外回显的凭据 |
| JSON 重放 stdout | 一次 JSON 事件数组 |
| health、presets、status、lookup、download stdout | 对应 JSON 回执 |
| stderr | 非秘密 request_key、提交/恢复回执、重连提示或脱敏错误 |
| 退出码 | 读取成功 0；HTTP/传输/协议错误 1；跟随事件的 submit/resume/SSE replay 最终失败也为 1；参数解析错误 2；用户停止读取 130 |

status、lookup、download 和 JSON replay 查询到失败任务时，只要读取本身成功就返回 0；判断业务结果仍须读 status/result。

`health` 公开成功不表示鉴权通过或模型可执行。必须再看 presets 和 readiness；`configured_unverified` 也不是已完成真实模型联调。

## 重复提交、断线与恢复

同一个业务请求保存同一键和同一请求体。POST 响应丢失时客户端先 `lookup` 原键；仍未知则报告原键，不发第二个 POST。稍后用 lookup 或原键与原内容重提，服务端返回原任务。同键改内容冲突 409，不能靠更换键绕过未知外部回执。

SSE 根据最后一个完整帧 seq 重连，同时带 `from` 和 `Last-Event-ID`；重复帧去重，序号缺口明确报错。SSE 不可用或重试耗尽时回退有上限的 JSON 轮询。客户端停止不会取消服务端任务。

服务重启后只读取并保留原任务 / run / Pi 检查点，**不会自动重新调用模型**。原任务会显示中断及可恢复原因（`AGENT_EXPLICIT_RESUME_REQUIRED`）；同一企业成员明确使用 `resume TASK_ID` 后，服务才在原权限与预算范围内尝试接续原 run。重复或并发恢复请求只接纳一次业务恢复尝试；它不产生替代任务，不修改业务输入或批准范围。原 error 保留，后来成功事件继续递增。因此 replay 不在第一条历史 error 处截断，而是读到服务端关闭并核对最终任务状态。

Muse 应按 accepted.plan 呈现计划，按 thinking.text 呈现公开执行摘要。不要将其称为模型隐藏推理。读取 `result.version=1`：unconfigured / blocked / partial 必须如实告知；demo 的 demonstration_only、文书的 documents_ready 都不是发布、成交或七天经营目标达成。失败任务已保存的部分文件仍可下载交付。

## 文件与凭据处理

下载只接受服务登记的任务路径、同源 URL 和安全文件名，限制实际大小；不追随跨源重定向。输出目录及父目录拒绝符号链接，文件以独占方式创建，不覆盖已有文件。失败下载仅清理本次创建的不完整文件。所有文件交付继续要求原成员 token，A 不能读 B。

固定五步安装文案由 `server/agent/install.mjs` 提供；它不会以安装为由执行供应商联系、询价、下单、付款或 Shopify 发布。供应商录入 / 预览 / 准确版本审批 / 七天监测使用原 Workspace 会话客户端和服务器契约，见 [供应商客户端接线](../miniprogram/SUPPLIER-CLIENT-CONSUMPTION.md)。

## 本轮验收

Python 的 HTTP fixture 验证下载后的完整操作、SSE 重连、部分帧、JSON 回退、参数、跨来源阻挡、令牌脱敏、路径与覆盖保护，以及原请求键回查、未知回执不重发、历史 error 后续成功、resumeFrom。实际统一服务 HTTP 另验证一次下载后 health / presets / submit / replay / status / 三文件下载。

证据与当前统计见 [统一验收记录](AGENT-ACCEPTANCE.md)。这些只证明本地代码行为；真实 Muse 安全注入、所选模型、真实 Shopify、微信实机和生产部署没有被测试夹具替代。
