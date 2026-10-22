// End-to-end smoke for guarded execution.
//
// One message asks the model to remember a fact. The model emits a real
// business_memory_propose tool call, the run blocks on an approval, the smoke
// approves it exactly like a person would, the tool executes under its
// one-shot ticket, and the memory record becomes a pending proposal.
//
// Usage: node scripts/guarded-smoke.mjs
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { createHarness } from '../packages/harness-kernel/src/app.mjs';

const root = path.resolve(import.meta.dirname, '..');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) }); };

function reader(response) {
  const source = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    async next(timeoutMs = 8000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const index = buffer.indexOf('\n\n');
        if (index >= 0) {
          const raw = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (!raw.trim() || raw.startsWith(':')) continue;
          const fields = Object.fromEntries(raw.split('\n').map(line => {
            const at = line.indexOf(': ');
            return [line.slice(0, at), line.slice(at + 2)];
          }));
          return { id: Number(fields.id), event: fields.event, data: JSON.parse(fields.data) };
        }
        if (Date.now() > deadline) throw new Error('timed out waiting for an SSE frame');
        const { done, value } = await source.read();
        if (done) return null;
        buffer += decoder.decode(value, { stream: true });
      }
    },
  };
}

const composition = parse(await readFile(path.join(root, 'harness.local.yml'), 'utf8'));
composition.server = { host: '127.0.0.1', port: 0 };
composition.plugins = composition.plugins.map(row => (row.id === 'llm-bridge'
  ? { id: 'echo-provider', name: './scripts/fixtures/echo-provider' }
  : row));
const compositionPath = path.join(root, '.harness-guarded-smoke.yml');
await writeFile(compositionPath, stringify(composition), 'utf8');

const harness = await createHarness({ compositionPath, root, logger: { info() {}, warn() {}, error() {} } });
try {
  const { address } = await harness.start();
  const base = address.url;
  const baseline = await fetch(`${base}/api/business-memory/records?status=all&q=MOQ`).then(response => response.json());

  const created = await fetch(`${base}/api/chat/conversations`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), title: 'guarded smoke' }),
  }).then(response => response.json());

  const posted = await fetch(`${base}/api/chat/conversations/${created.conversation.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), content: '记住：海祺贸易的 MOQ 是 500 件。' }),
  }).then(response => response.json());
  const runId = posted.run.id;

  const stream = await fetch(`${base}/api/chat/runs/${runId}/events`, { headers: { accept: 'text/event-stream' } });
  const frames = reader(stream);
  const seen = [];
  let approvalId = null;
  let failureCode = null;
  for (;;) {
    const frame = await frames.next();
    if (frame === null) break;
    seen.push(frame.event);
    if (frame.event === 'run.approval_requested') approvalId = frame.data?.data?.approvalId ?? null;
    if (frame.event === 'run.failed') failureCode = frame.data?.data?.code ?? null;
    if (frame.event === 'run.approval_requested') break;
  }
  check('the run pauses on an approval request', seen.includes('run.approval_requested'), { seen, failureCode });
  check('the request names the real tool', Boolean(approvalId), approvalId);

  const blocked = await fetch(`${base}/api/chat/runs/${runId}`).then(response => response.json());
  check('the run is blocked while waiting', blocked.run.status === 'blocked', blocked.run.status);

  const pending = await fetch(`${base}/api/chat/conversations/${created.conversation.id}/approvals`).then(response => response.json());
  check('the approval shows the exact tool payload', pending.total === 1 && pending.items[0].payload?.factKey === 'moq', pending.items?.[0]?.payload);

  // The tool must not have produced a memory record yet.
  const before = await fetch(`${base}/api/business-memory/records?status=all&q=MOQ`).then(response => response.json());
  check('nothing was written before approval', before.total === baseline.total, { before: before.total, baseline: baseline.total });

  const decided = await fetch(`${base}/api/chat/approvals/${approvalId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'approve' }),
  }).then(response => response.json());
  check('a human approval is recorded', decided.approval?.status === 'approved', decided.approval?.status);

  for (;;) {
    const frame = await frames.next();
    if (frame === null) break;
    seen.push(frame.event);
    if (frame.event === 'run.completed' || frame.event === 'run.failed') break;
  }
  check('the run completes after approval', seen.includes('run.completed'), seen);

  const after = await fetch(`${base}/api/business-memory/records?status=all&q=MOQ`).then(response => response.json());
  check('the approved tool wrote exactly one new pending memory',
    after.total === baseline.total + 1 && after.items.some(item => item.status === 'proposed' && String(item.statement).includes('500')),
    { total: after.total, baseline: baseline.total });

  const conversation = await fetch(`${base}/api/chat/conversations/${created.conversation.id}`).then(response => response.json());
  check('the final answer is stored', conversation.messages.at(-1)?.role === 'assistant', conversation.messages.at(-1)?.content);
} finally {
  await harness.stop().catch(() => {});
  await unlink(compositionPath).catch(() => {});
}

const failed = results.filter(item => !item.ok);
for (const item of results) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.detail === undefined ? '' : ` (${JSON.stringify(item.detail)})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
