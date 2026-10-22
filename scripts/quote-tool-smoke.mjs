// End-to-end smoke for a write tool behind approval: quote_create.
//
// The offline provider asks for quote_create; the runner stops on an approval
// request, a human approves over HTTP, the tool executes once, and the quote
// lands in the quotes domain with the server-computed total.
//
// Usage: node scripts/quote-tool-smoke.mjs
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
const compositionPath = path.join(root, '.harness-quote-tool-smoke.yml');
await writeFile(compositionPath, stringify(composition), 'utf8');

const harness = await createHarness({ compositionPath, root, logger: { info() {}, warn() {}, error() {} } });
try {
  const { address } = await harness.start();
  const base = address.url;

  const created = await fetch(`${base}/api/chat/conversations`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), title: 'quote tool smoke' }),
  }).then(response => response.json());

  // Other smokes share the workspace state, so measure a delta, not an absolute.
  const baseline = await fetch(`${base}/api/quotes?status=all`).then(response => response.json());

  const posted = await fetch(`${base}/api/chat/conversations/${created.conversation.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), content: '开单：给海祺贸易报 500 件法兰' }),
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
  check('the approval names the tool', approval?.action === 'quote_create' || approval?.resource === 'quote_create' || Boolean(approval?.payload), approval?.action ?? approval?.resource);

  const beforeApproval = await fetch(`${base}/api/quotes?status=all`).then(response => response.json());
  check('nothing is written before approval', beforeApproval.total === baseline.total, beforeApproval.total);

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

  const quotes = await fetch(`${base}/api/quotes?status=all`).then(response => response.json());
  check('exactly one quote was written', quotes.total === baseline.total + 1, quotes.total);
  const quote = quotes.items?.[0];
  check('the quote carries the server-computed total', quote?.total === '6250.00', quote?.total);
  check('the quote carries the supplied customer', quote?.customer === '海祺贸易', quote?.customer);

  const conversation = await fetch(`${base}/api/chat/conversations/${created.conversation.id}`).then(response => response.json());
  const answer = [...conversation.messages].reverse().find(message => message.role === 'assistant');
  check('the answer reports the draft', (answer?.content ?? '').includes('报价草稿已生成'), (answer?.content ?? '').slice(0, 60));
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
