import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fail = code => { throw Object.assign(new Error(code), { code }); };
export function renderMuseHandoff(delegation, muse) {
  if (!delegation || !['queued', 'claimed'].includes(delegation.phase) || delegation.taskRef !== delegation.orderId) fail('MUSE_HANDOFF_DISPATCH_REQUIRED');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(delegation.orderId) || !/^[a-f0-9]{64}$/.test(delegation.reviewHash)) fail('MUSE_HANDOFF_SCOPE_INVALID');
  if (muse?.installed !== true || muse.approved !== true || muse.workerId !== delegation.review?.workerId) fail('MUSE_HANDOFF_WORKER_MISMATCH');
  const scope = Object.fromEntries(['serviceId', 'product', 'market', 'objective', 'budgetCredits', 'deadlineAt', 'workerId'].map(key => [key, delegation.review[key]]));
  if (!Number.isFinite(Date.parse(scope.deadlineAt)) || Date.parse(scope.deadlineAt) <= Date.now()) fail('MUSE_HANDOFF_DEADLINE_EXPIRED');
  return `# 给已有 Muse 的一次指定订单交接

只处理订单 **${delegation.orderId}**。这是用户在原 Workspace 已分别审批、派发的公开任务说明；仍须读取服务端实时状态。此文件本身不授予权限，不启动 Muse，不代表执行成功。

- 预期 workerId：\`${muse.workerId}\`
- 原审批 reviewHash：\`${delegation.reviewHash}\`
- 原 taskRef = orderId：\`${delegation.orderId}\`
- 当前远端 Muse/CLI 版本仍需核验；不要用普通模型 API 代替真实 Muse。

## 核对原任务

\`\`\`json
${JSON.stringify(scope, null, 2)}
\`\`\`

使用已有 Secure Vault/authd 和原批准 egress。不得复制原始 key、增加凭据、扩大权限或安装常驻任务。原 CLI v4 是单次命令，不是监听器。历史安装位置如下；先确认实际文件存在，SHA256 为 \`0fb492b9e8860c850f7e236537a6df9b84fa84919655331ab1c62f70fc67888c\`，不同版本先报告，不能覆盖真实安装。

\`\`\`sh
muse_cli="$HOME/workspace/skills/cnsubscribe-workspace/bin/workspace-api.py"
muse_task='${delegation.orderId}'
python3 "$muse_cli" identity
python3 "$muse_cli" inbox
python3 "$muse_cli" task-get --task-ref "$muse_task"
python3 "$muse_cli" task-status --task-ref "$muse_task"
\`\`\`

identity 必须匹配预期 workerId、\`workspace.muse.pull.v1\` 和已有 approved:true；connected:false 不是执行失败，也不是在线证明。task-get 的 product/market/objective/acceptance/maxCredits/deadlineAt 必须与本次任务一致。只能领取这个 ID，不能遍历领取 inbox 其他订单。

## 领取与实际执行

只在原状态为 pending、未取消且未过任务截止时领取。pending 的 canExecute:false / leaseUntil:null 是尚未领取，不能执行；不要把它冒充有效租约。若已 claimed，先保留并核对原本地 claims/intents；只有同一已保存 attempt/fence 和有效 lease 才可继续，不能用新的 request-id 抢占或重开。claim 回执丢失但原 inflight claim intent 仍在时，只重试原 claim 命令以恢复同一 attempt/fence；两者都缺失则停止并报告。原首次 claim 或丢响应重试使用同一个命令：

\`\`\`sh
python3 "$muse_cli" claim --task-ref "$muse_task" --request-id 'tui-${delegation.orderId}-claim-v1'
python3 "$muse_cli" task-status --task-ref "$muse_task"
\`\`\`

claim 必须返回 claimed:true、canExecute:true、cancellationRequested:false、服务器 attemptId、整数 fence 和未来 leaseUntil。保持原 CLI 的 claims/intents 文件；不要清空它们。随后由**真实 Muse**执行原 task-get 中的目标与验收条件，仅使用其已有授权工具。记录真实来源、输出和限制，不造工具回执，不发送未批准消息，不新增付费消费。内部 credits 不等于提供方支出授权；不能满足原限制时停止并报告。

在每个后续工作阶段、上传前、提交前先读 status。根据服务器 leaseUntil 安排当前任务内的 heartbeat，必须留出网络余量且在到期前执行；不要按本地时钟虚构新租约，不得越过 deadlineAt。没有新增轮询服务或后台定时任务：

\`\`\`sh
python3 "$muse_cli" task-status --task-ref "$muse_task"
python3 "$muse_cli" heartbeat --task-ref "$muse_task"
\`\`\`

## 原文件上传与回传

先生成真实结果文件；允许 json/md/csv/txt，单文件最多 1 MiB、单次 attempt 最多20个。使用同一 upload-id 重试同一字节，原 CLI 计算 SHA256。将下列占位文件换为真实文件后逐项执行；不要提交占位内容。

\`\`\`sh
python3 "$muse_cli" task-status --task-ref "$muse_task"
python3 "$muse_cli" upload-file --task-ref "$muse_task" --upload-id 'tui-result-v1' --file /absolute/path/to/actual-report.json
python3 "$muse_cli" task-status --task-ref "$muse_task"
\`\`\`

submit-result 参数必须是实际总结、1–20个真实公开 HTTPS 来源，以及真实 tool-evidence JSON 或诚实的 evidence-note（二选一）。在本地先审阅准确文本，再通过原 CLI 的 \`submit-result --task-ref ... --summary ... --sources ... --evidence-note ...\` 提交；无可验证工具 receipt 时不能编造 receiptId。命令帮助：\`python3 "$muse_cli" submit-result --help\`。

若 serviceId 为 buyer-discovery，交付 JSON 必须使用原 \`workspace.worker.delivery.v1\` schema、准确 orderId，并有真实 deliverables/evidence/prospects；自由叙述不能替代其结构化验收。上传后再提交，保留所有原 request/attempt/fence/uploadId、文件版本和SHA。2xx submitted 仍需主人验收，不是已被接受。

## 取消、阻挡和未知响应

- 领取后任何 cancellationRequested:true、canExecute:false、leaseUntil:null/到期、deadlineAt到期或401/403：立即停止执行。409不是成功，不换 request-id 绕过冲突。
- 真正停止后，使用原已保存 attempt/fence：\`python3 "$muse_cli" confirm-stop --task-ref "$muse_task"\`。过期/取消不阻止该命令，但丢失原 claims 不能伪造身份。
- 尚未领取就已取消时，不存在 attempt；不伪造 confirm-stop 参数，报告当前取消状态给主人。
- 当前有效租约内的业务阻挡：\`python3 "$muse_cli" report-blocked --task-ref "$muse_task" --message '准确阻挡原因'\`。报告只描述事实，不自行扩权。
- 网络丢响应：保留原命令参数、claims/intents；先 status 核实，仅重试原未确认的逻辑操作。原 CLI 会复用已保存 requestId 和 body SHA；不删除记录、不新建任务、不猜成功。
- event-ack 仅确认读到的准确事件 ID，不等于停止；取消必须真实停工并 confirm-stop。

## 返回给主人

交回这个 orderId、实际状态、attempt/fence、结果摘要、来源与上传回执（文件ID/version/SHA）及未完成项；不要返回凭据。主人在原 TUI 执行 \`/workspace-muse refresh ${delegation.orderId}\` 将同一 receipt 投影回原 Session，再检查证据并单独 accept。没有真实执行、来源或回执就明确报告，不能以本地 fixture 或本说明充数。
`;
}

export async function saveMuseHandoff(delegation, muse, root = path.join(process.env.WORKSPACE_PI_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '.data'), 'handoffs')) {
  const content = renderMuseHandoff(delegation, muse);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const filename = path.join(root, `${delegation.orderId}-${delegation.reviewHash}.md`);
  let file;
  try { file = await open(filename, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (await readFile(filename, 'utf8') !== content) fail('MUSE_HANDOFF_FILE_CHANGED');
    return { filename, duplicate: true, externalSend: false };
  }
  try { await file.writeFile(content); await file.sync(); }
  catch (error) { await file.close(); await unlink(filename); throw error; }
  await file.close();
  return { filename, duplicate: false, externalSend: false };
}
