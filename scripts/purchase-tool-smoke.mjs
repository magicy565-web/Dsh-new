// End-to-end smoke for the approval-gated purchase tool.
//
// The offline provider asks for purchase_order_create; the runner stops on an
// approval request, a human approves, the tool executes once, and the order is
// persisted as a DRAFT -- the model cannot approve it.
//
// Usage: node scripts/purchase-tool-smoke.mjs
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { createHarness } from '../packages/harness-kernel/src/app.mjs';

const root = path.resolve(import.meta.dirname, '..');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) }); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const composition = parse(await readFile(path.join(root, 'harness.local.yml'), 'utf8'));
composition.server = { host: '127.0.0.1', port: 0 };
composition.plugins = composition.plugins.map(row => {
  if (row.id === 'llm-bridge') return { id: 'echo-provider', name: './scripts/fixtures/echo-provider' };
  if (row.id === 'runner') return { ...row, config: { ...row.config, tools: true, deltaBatchMs: 0 } };
  return row;
});
const compositionPath = path.join(root, '.harness-purchase-tool-smoke.yml');
await writeFile(compositionPath, stringify(composition), 'utf8');

const harness = await createHarness({ compositionPath, root, logger: { info() {}, warn() {}, error() {} } });
try {
  const { address } = await harness.start();
  const base = address.url;

  const created = await fetch(`${base}/api/chat/conversations`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), title: 'purchase tool smoke' }),
  }).then(response => response.json());

  // Other smokes share the workspace state, so measure a delta.
  const baseline = await fetch(`${base}/api/purchases?status=all`).then(response => response.json());

  const posted = await fetch(`${base}/api/chat/conversations/${created.conversation.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), content: '采购：向无锡法兰厂订 500 件法兰' }),
  }).then(response => response.json());
  check('a message prepares a run', posted.run?.status === 'prepared', posted.run?.status);

  let approvals = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    approvals = await fetch(`${base}/api/chat/conversations/${created.conversation.id}/approvals`).then(response => response.json());
    if ((approvals.total ?? 0) > 0) break;
    await sleep(100);
  }
  const approval = approvals?.items?.[0];
  check('the write tool waits for approval', Boolean(approval?.id), approvals?.total);
  check('the approval names the purchase tool', approval?.action === 'purchase_order_create', approval?.action);

  const before = await fetch(`${base}/api/purchases?status=all`).then(response => response.json());
  check('nothing is written before approval', before.total === baseline.total, before.total);

  const decided = await fetch(`${base}/api/chat/approvals/${approval.id}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'approve' }),
  });
  check('a human approval is recorded', decided.ok, decided.status);

  let run = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    run = await fetch(`${base}/api/chat/runs/${posted.run.id}`).then(response => response.json());
    if (['completed', 'failed', 'cancelled'].includes(run.run.status)) break;
    await sleep(100);
  }
  check('the run completes after approval', run?.run.status === 'completed', run?.run.status);

  const orders = await fetch(`${base}/api/purchases?status=all`).then(response => response.json());
  check('exactly one order was written', orders.total === baseline.total + 1, orders.total);
  const order = orders.items?.find(item => item.number);
  check('the order carries the server-computed total', order?.total === '6250.00', order?.total);
  check('the order carries the supplied supplier', order?.supplier === '无锡法兰厂', order?.supplier);
  check('the model left the order as a draft', order?.status === 'draft', order?.status);

  const conversation = await fetch(`${base}/api/chat/conversations/${created.conversation.id}`).then(response => response.json());
  const answer = [...conversation.messages].reverse().find(message => message.role === 'assistant');
  check('the answer reports the draft', (answer?.content ?? '').includes('采购草稿已生成'), (answer?.content ?? '').slice(0, 60));
} catch (error) {
  results.push({ name: 'smoke body threw', ok: false, detail: String(error?.stack ?? error).slice(0, 400) });
} finally {
  await Promise.race([harness.stop().catch(() => {}), new Promise(resolve => setTimeout(resolve, 3000))]);
  await unlink(compositionPath).catch(() => {});
}

const failed = results.filter(item => !item.ok);
for (const item of results) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.detail === undefined ? '' : ` (${JSON.stringify(item.detail)})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
