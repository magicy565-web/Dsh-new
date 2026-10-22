// End-to-end smoke for the migrated procurement comparison tool.
//
// The offline provider asks for procurement_compare with two supplied quotes;
// the real tools seam executes it without a ticket (readOnly), and the answer
// echoes the aligned result.
//
// Usage: node scripts/procurement-smoke.mjs
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
const compositionPath = path.join(root, '.harness-procurement-smoke.yml');
await writeFile(compositionPath, stringify(composition), 'utf8');

const harness = await createHarness({ compositionPath, root, logger: { info() {}, warn() {}, error() {} } });
try {
  const { address } = await harness.start();
  const base = address.url;

  const created = await fetch(`${base}/api/chat/conversations`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), title: 'procurement smoke' }),
  }).then(response => response.json());

  const posted = await fetch(`${base}/api/chat/conversations/${created.conversation.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), content: '报价：比较这两家的法兰报价' }),
  }).then(response => response.json());
  check('a message prepares a run', posted.run?.status === 'prepared', posted.run?.status);

  let run = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    run = await fetch(`${base}/api/chat/runs/${posted.run.id}`).then(response => response.json());
    if (['completed', 'failed', 'cancelled'].includes(run.run.status)) break;
    await sleep(100);
  }
  check('the run completes', run?.run.status === 'completed', run?.run.status);

  const conversation = await fetch(`${base}/api/chat/conversations/${created.conversation.id}`).then(response => response.json());
  const answer = [...conversation.messages].reverse().find(message => message.role === 'assistant');
  const text = answer?.content ?? '';
  check('the answer carries the aligned quotes', text.includes('same-supplied-basis-unverified'), text.slice(0, 100));
  check('the comparison is explicitly not ranked', text.includes('"ranked":false'), text.slice(0, 200));
  check('pending cells are still pending', text.includes('"status":"pending"'), text.slice(0, 240));
} finally {
  await harness.stop().catch(() => {});
  await unlink(compositionPath).catch(() => {});
}

const failed = results.filter(item => !item.ok);
for (const item of results) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.detail === undefined ? '' : ` (${JSON.stringify(item.detail)})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
