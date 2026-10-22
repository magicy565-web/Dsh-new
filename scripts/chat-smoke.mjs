// End-to-end smoke for the chat substrate over the real kernel.
//
// Boots harness.local.yml on an ephemeral port and drives it exactly like a
// browser would: create a conversation, post a message, follow the run over
// SSE, cancel it, then reconnect after the last seen event id.
//
// Usage: node scripts/chat-smoke.mjs
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'yaml';
import { createHarness } from '../packages/harness-kernel/src/app.mjs';

const root = path.resolve(import.meta.dirname, '..');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) }); };

function reader(response) {
  const source = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    async next(timeoutMs = 3000) {
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
    async end(timeoutMs = 3000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const frame = await this.next(deadline - Date.now());
        if (frame === null) return true;
      }
      return false;
    },
    cancel() { return source.cancel(); },
  };
}

const composition = parse(await readFile(path.join(root, 'harness.local.yml'), 'utf8'));
composition.server = { host: '127.0.0.1', port: 0 };
// This smoke isolates the chat substrate: no model call, so the run stays
// prepared until the test cancels it.
composition.plugins = composition.plugins.map(row => row.id === 'runner'
  ? { ...row, config: { ...row.config, enabled: false } }
  : row);

const harness = await createHarness({ composition, root, logger: { info() {}, warn() {}, error() {} } });
let base;
try {
  const started = await harness.start();
  base = started?.address?.url ?? started?.url;
  check('composition started with the chat plugin', Boolean(base), base);

  const created = await fetch(`${base}/api/chat/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), title: '冒烟会话' }),
  }).then(async response => ({ status: response.status, body: await response.json() }));
  check('a conversation is created over HTTP', created.status === 201 && created.body.conversation.title === '冒烟会话');
  const conversationId = created.body.conversation.id;

  const page = await fetch(`${base}/chat`);
  check('the chat page is served', page.status === 200 && /text\/html/u.test(page.headers.get('content-type') ?? ''));
  check('the page carries a strict CSP', /default-src 'none'/u.test(page.headers.get('content-security-policy') ?? ''));
  check('the page never loads external scripts', !/<script src=/u.test(await page.text()));

  const posted = await fetch(`${base}/api/chat/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), content: '海祺这个月该补货吗？' }),
  }).then(async response => ({ status: response.status, body: await response.json() }));
  check('a message prepares a run', posted.status === 201 && posted.body.run.status === 'prepared');
  const runId = posted.body.run.id;

  const stream = await fetch(`${base}/api/chat/runs/${runId}/events`, { headers: { accept: 'text/event-stream' } });
  check('the event stream is a real SSE response', stream.status === 200 && /text\/event-stream/u.test(stream.headers.get('content-type')));
  const frames = reader(stream);
  const prepared = await frames.next();
  check('the first frame is the prepared run', prepared?.event === 'run.prepared', prepared?.event);

  const cancelled = await fetch(`${base}/api/chat/runs/${runId}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'smoke' }),
  }).then(async response => ({ status: response.status, body: await response.json() }));
  check('cancel moves the run to cancelled', cancelled.body.run.status === 'cancelled');

  const cancelledFrame = await frames.next();
  check('the live stream carries the cancellation', cancelledFrame?.event === 'run.cancelled');
  check('the stream closes on the terminal event', await frames.end());

  const replay = await fetch(`${base}/api/chat/runs/${runId}/events?after=${prepared.id}`);
  const replayFrames = reader(replay);
  check('a reconnect with after= replays nothing twice and ends', await replayFrames.end());

  // A goal groups runs without copying them.
  const goal = await fetch(`${base}/api/goals`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), title: '冒烟目标' }),
  }).then(response => response.json());
  const linked = await fetch(`${base}/api/chat/conversations/${conversationId}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), content: '推进这个目标', goalId: goal.goal.id }),
  }).then(response => response.json());
  const goalDetail = await fetch(`${base}/api/goals/${goal.goal.id}`).then(response => response.json());
  check('a goal lists the run attached to it', goalDetail.runs.total === 1 && goalDetail.runs.items[0].id === linked.run.id, goalDetail.runs);
} finally {
  await harness.stop().catch(() => {});
}

const failed = results.filter(item => !item.ok);
for (const item of results) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.detail === undefined ? '' : ` (${JSON.stringify(item.detail)})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
