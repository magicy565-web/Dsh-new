import { isIP } from 'node:net';

const API_BASE = '/api/agent/v1';

function serviceOrigin(origin) {
  if (typeof origin !== 'string' || /[\s\\\u0000-\u001f\u007f]/u.test(origin)) {
    throw new TypeError('Invalid service origin');
  }
  const url = new URL(origin);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new TypeError('Expected a credential-free HTTP(S) origin');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const dnsName = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.?$/i;
  if ((!isIP(hostname) && (!dnsName.test(hostname) || hostname.length > 253)) || url.port === '0') {
    throw new TypeError('Invalid service host');
  }
  return url.origin;
}

/** Plain-text instructions. The caller validates Host and trusted proxy headers. */
export function renderInstall(origin) {
  const service = serviceOrigin(origin);
  const host = new URL(service).host;
  const transportNote = service.startsWith('http:')
    ? '当前公开地址使用 HTTP。正式远程接入须先启用 HTTPS，并使用 HTTPS 地址重新打开 /install；薄客户端仅允许本机回环地址使用 HTTP。此说明页可公开读取，但不代表远程 Bearer 接入已经就绪。'
    : '远程接入使用 HTTPS；所有带凭据请求必须保持同一服务来源。';
  return `Cnsubscribe Workspace Agent — Muse 安装说明

服务地址：${service}
API base：${API_BASE}
${transportNote}
用途：产品批发采购、供应商寻找、产品机会发现。任务预设、Pi 模型与工具执行、研究与产物生成均在原 Workspace 服务端运行；Muse 只提交、呈现事件、交付文件。

请依次完成以下五步：

① 创建自定义连接器
使用当前 Muse 运行时实际提供的自定义连接器管理界面或工具，建立连接器：
  id：custom.cnsubscribe-workspace-agent
  host：${host}
  service URL：${service}
  API base：${API_BASE}
  鉴权：Authorization: Bearer <用户专属 token>
仅授权本服务 host。不要把服务端模型密钥或其他账号 token 作为用户 token。
这里不假设某个未验证的 Muse 专有工具名或 API。若当前运行时不能创建自定义连接器，应如实报告这一步的能力缺口，不得声称安装完成。

② 让用户在安全凭据页填写一次 token
打开运行时提供的安全凭据页，由用户在该页面填写自己的 Workspace token，保存到该连接器的 Secure Vault。不要让用户把 token 发到聊天里，不要写入源码、配置文件、.env、脚本、shell history 或日志。
后续调用由运行时从 Secure Vault 自动注入。此客户端接受 WS_AGENT_TOKEN 环境变量的进程内注入，或可信 Python 适配层向 Client(token=...) 传入内存凭据；服务地址使用 WS_AGENT_URL。
必须实际确认该运行时具备上述安全注入方式。若仅支持受托 HTTP 请求，需要先对接该运行时真实存在的请求适配层；不得把 Vault 中的 token 导出到磁盘，也不得把“创建了连接器”误报为“Python 已得到凭据”。
token 必须由服务端绑定到已存在的企业成员及 agent:read / agent:submit 范围，不建立第二套账号。它在服务端撤销、轮换或到期前按服务端策略使用，无需每次任务重新填入。

③ 下载零依赖薄客户端
从 ${service}/plugin/client.py 下载到 ~/workspace/tools/ws-agent/ws_client.py。
使用 Python 3.10 或以上版本；客户端只依赖 Python 标准库。服务地址可以写入启动配置，token 不能落盘。
以下下载命令仅处理公开源码，不读取或打印 token：

python3 - <<'PY'
import os
import tempfile
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, build_opener

source = '${service}/plugin/client.py'
class SameOrigin(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if (urlsplit(newurl).scheme, urlsplit(newurl).netloc) != (urlsplit(source).scheme, urlsplit(source).netloc):
            raise RuntimeError('Refusing cross-origin client download')
        return super().redirect_request(req, fp, code, msg, headers, newurl)

target = Path.home() / 'workspace' / 'tools' / 'ws-agent' / 'ws_client.py'
target.parent.mkdir(parents=True, exist_ok=True)
if any(part.is_symlink() for part in (target, target.parent, *target.parent.parents)):
    raise RuntimeError('Install path must not contain symlinks')
with build_opener(SameOrigin()).open(source, timeout=30) as response:
    content = response.read(1024 * 1024 + 1)
if len(content) > 1024 * 1024:
    raise RuntimeError('Client download is too large')
fd, temporary = tempfile.mkstemp(prefix='.ws-client-', dir=target.parent)
try:
    with os.fdopen(fd, 'wb') as output:
        output.write(content)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, target)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
print(str(target))
PY

④ 做 health 与 presets 连通回执
在运行时已安全注入 WS_AGENT_TOKEN 的进程内执行：

WS_AGENT_URL='${service}' python3 ~/workspace/tools/ws-agent/ws_client.py health
WS_AGENT_URL='${service}' python3 ~/workspace/tools/ws-agent/ws_client.py presets

向用户回报真实的服务状态、版本、mode、readiness、模型名称及可用预设。health 为公开接口，health 成功不能替代 presets 的鉴权验证。presets 成功后再确认连接可用；readiness=unconfigured 表示生产执行尚未就绪，不能宣称任务可完成。
如 mode=demo，明确告知：演示模式：未接模型与真实数据源，内容为结构模板，数字为待确认。
禁止在回执里显示 token。真实 Muse Secure Vault 联调未完成时，应写“本地环境变量模拟通过，真实 Muse 安全注入待验证”，不能宣称一键接入已经实测。

⑤ 告诉用户三类任务的示例说法
产品批发采购（procurement）：发起产品采购：不锈钢保温杯 500ml，首批 1000 个，目标出厂价人民币 EXW ≤18 元/个，卖美国。
供应商寻找（supplier-sourcing）：帮我寻找供应商：不锈钢保温杯，500ml、双层真空、食品接触用途；目标市场美国。
产品机会发现（opportunity-discovery）：帮我分析不锈钢保温杯在美国市场的产品机会，关注价格带、竞品和差评雷区。

提交示例（只包含业务字段；token 仍由运行时安全注入）：
WS_AGENT_URL='${service}' python3 ~/workspace/tools/ws-agent/ws_client.py submit --type procurement --title '500ml 保温杯采购研究' --input-json '{"product":"不锈钢保温杯","spec":"500ml，双层真空","quantity":1000,"target_price":"CNY 18/个，EXW，目标上限待确认","market":"美国"}'

客户端 stdout 按行输出 {seq,kind,payload,ts} 原始事件 JSON，stderr 仅输出脱敏连接提示、非秘密 request_key 与提交回执。首次提交前保存 request_key；响应丢失用 lookup REQUEST_KEY 查询原任务，或以相同 --request-key 和相同业务内容重提，不要换键创建替代任务。
Muse 按 accepted.plan 呈现计划，按 thinking.text 呈现服务端公开的执行说明；这些说明是实际动作与证据摘要，不是模型隐藏推理。读取 task.result.version=1 的 state、completion 与 businessGoalAchieved：done 只表示本次执行结束，demonstration_only 是显式演示，documents_ready 是文书就绪，均不代表商品发布、七天监测或商业目标达成。按登记的产物名称下载并交付，失败任务的部分文件也可下载：
WS_AGENT_URL='${service}' python3 ~/workspace/tools/ws-agent/ws_client.py download TASK_ID --output-dir ~/workspace/outputs/TASK_ID

断线可用 replay TASK_ID --from-seq LAST_SEQ 续传；只读历史可加 --format json。条件补齐且 result.resumable=true 时，可用 resume TASK_ID 恢复原任务；重启恢复沿用原 Pi 检查点，未知外部结果不会自动重做。原失败事件保留，恢复后序号继续递增；重放不要在第一条历史 error 就丢弃后续事件，应读到连接关闭并核对当前状态。
任务当前结束时连接关闭。客户端不会自动联系供应商、代发询价、下单、付款或对外承诺；产物中的相关动作均需用户确认后执行。供应商商品预览、准确版本审批、Shopify 发布及七天监测使用原 Workspace 供应商会话契约，不通过研究预设隐式执行。
`;
}

export function pluginManifest(origin, presets, version) {
  const service = serviceOrigin(origin);
  return {
    name: 'Cnsubscribe Workspace Agent',
    id: 'custom.cnsubscribe-workspace-agent',
    version,
    description: '服务端内置研究 Agent：产品批发采购、供应商寻找、产品机会发现。',
    service_url: service,
    api_base: API_BASE,
    api_url: service + API_BASE,
    client_url: service + '/plugin/client.py',
    install_url: service + '/install',
    authentication: {
      type: 'bearer',
      header: 'Authorization',
      connector_id: 'custom.cnsubscribe-workspace-agent',
      host: new URL(service).host,
      token_source: 'User-specific token entered once in the runtime Secure Vault credentials page.',
      client_injection: ['WS_AGENT_TOKEN process environment', 'Trusted in-memory Client(token=...) adapter'],
      service_url_environment: 'WS_AGENT_URL',
      persist_token_on_client: false,
      runtime_requirement: 'A verified runtime credential-injection or delegated HTTP adapter is required; no Muse-specific API is assumed.',
    },
    presets,
  };
}
