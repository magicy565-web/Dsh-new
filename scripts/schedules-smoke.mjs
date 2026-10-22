// End-to-end smoke for schedules.
//
// A one-shot schedule is created and enabled; the harness timer fires it, the
// chat pipeline creates a real run, and the schedule records a dispatch
// receipt. Nothing here needs a model: the run is created and left to the
// runner (which fails without a provider, which is fine).
//
// Usage: node scripts/schedules-smoke.mjs
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
  if (row.id === 'schedules') return { ...row, config: { ...row.config, tickMs: 1_000 } };
  // Keep the run prepared: this smoke is about dispatch, not the model call.
  if (row.id === 'runner') return { ...row, config: { ...row.config, enabled: false } };
  return row;
});
const compositionPath = path.join(root, '.harness-schedules-smoke.yml');
await writeFile(compositionPath, stringify(composition), 'utf8');

const harness = await createHarness({ compositionPath, root, logger: { info() {}, warn() {}, error() {} } });
try {
  const { address } = await harness.start();
  const base = address.url;

  const created = await fetch(`${base}/api/chat/conversations`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), title: '定时冒烟' }),
  }).then(response => response.json());

  const dueAt = new Date(Date.now() + 2_000).toISOString();
  const schedule = await fetch(`${base}/api/schedules`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: randomUUID(), title: '两秒后检查', prompt: '定时检查库存', conversationId: created.conversation.id,
      kind: 'at', at: dueAt,
    }),
  }).then(response => response.json());
  check('a one-shot schedule is created disabled', schedule.schedule?.status === 'disabled', schedule.schedule?.status);

  const page = await fetch(`${base}/schedules`);
  const pageHtml = await page.text();
  check('the schedules page renders', page.status === 200 && pageHtml.includes('新建计划'), page.status);

  await fetch(`${base}/api/schedules/${schedule.schedule.id}/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'enabled' }),
  });

  let detail = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    detail = await fetch(`${base}/api/schedules/${schedule.schedule.id}`).then(response => response.json());
    if (detail.schedule.status === 'done') break;
    await sleep(500);
  }
  check('the timer fires the schedule', detail?.schedule.status === 'done', detail?.schedule.status);
  check('a dispatch receipt points at a real run', Boolean(detail?.receipts?.[0]?.runId), detail?.receipts?.[0]);

  const conversation = await fetch(`${base}/api/chat/conversations/${created.conversation.id}`).then(response => response.json());
  const scheduledMessage = conversation.messages.find(message => message.content === '定时检查库存');
  check('the schedule posted its prompt into the conversation', Boolean(scheduledMessage), conversation.messages.length);

  const run = await fetch(`${base}/api/chat/runs/${detail.receipts[0].runId}`).then(response => response.json());
  check('the run belongs to the scheduled message', run.run.snapshot?.messageId === scheduledMessage?.id, run.run.snapshot?.messageId);
  check('the scheduler is the recorded requester', run.run.requestedBy === 'service:scheduler', run.run.requestedBy);

  const inbox = await fetch(`${base}/api/inbox?status=all`).then(response => response.json());
  check('the dispatch lands in the inbox',
    inbox.items.some(item => item.kind === 'schedule.dispatched' && item.refs.scheduleId === schedule.schedule.id),
    inbox.items.map(item => item.kind));
} finally {
  await harness.stop().catch(() => {});
  await unlink(compositionPath).catch(() => {});
}

const failed = results.filter(item => !item.ok);
for (const item of results) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.detail === undefined ? '' : ` (${JSON.stringify(item.detail)})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
