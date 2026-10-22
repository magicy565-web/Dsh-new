import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, ROUTES } from '../src/index.mjs';

function fakeStorage() {
  let state = {};
  return {
    read: () => structuredClone(state),
    update: async mutator => {
      const draft = structuredClone(state);
      const result = mutator(draft);
      state = draft;
      return structuredClone(result);
    },
  };
}

function fakeContext() {
  const routes = new Map();
  const health = new Map();
  let service = null;
  const ctx = {
    storage: fakeStorage(),
    http: { route: definition => { routes.set(`${definition.method} ${definition.path}`, definition); } },
    health: { register: (name, fn) => health.set(name, fn) },
    provide: (name, value) => { if (name === 'chat') service = value; return () => { service = null; }; },
  };
  const call = async (key, { params = {}, body = {}, query = {}, actor = { subject: 'local-operator', role: 'admin', workspaceId: 'local' } } = {}) => {
    const definition = routes.get(key);
    assert.ok(definition, `missing route ${key}`);
    const [method, pathname] = key.split(' ');
    return definition.handler({ headers: {}, once() {} }, {}, { method, pathname, params, body, query, actor });
  };
  return { ctx, routes, health, call, get service() { return service; } };
}

function frameReader(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    async next(timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const index = buffer.indexOf('\n\n');
        if (index >= 0) {
          const raw = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (!raw.trim() || raw.startsWith(':')) continue;
          const lines = Object.fromEntries(raw.split('\n').map(line => {
            const at = line.indexOf(': ');
            return [line.slice(0, at), line.slice(at + 2)];
          }));
          return { id: Number(lines.id), event: lines.event, data: JSON.parse(lines.data) };
        }
        if (Date.now() > deadline) throw new Error('timed out waiting for an SSE frame');
        const { done, value } = await reader.read();
        if (done) return null;
        buffer += decoder.decode(value, { stream: true });
      }
    },
    async end(timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const chunk = await this.next(deadline - Date.now());
        if (chunk === null) return true;
      }
      throw new Error('the stream did not end');
    },
    cancel() {
      return reader.cancel();
    },
  };
}

async function mounted() {
  const harness = fakeContext();
  await apply(harness.ctx, {});
  return harness;
}

test('the plugin registers every declared route and a health probe', async () => {
  const harness = await mounted();
  assert.equal(harness.routes.size, ROUTES.length);
  for (const [method, path] of ROUTES) assert.ok(harness.routes.has(`${method} ${path}`), `${method} ${path}`);
  const health = harness.health.get('chat')();
  assert.equal(health.status, 'ok');
  assert.equal(health.detail.conversations, 0);
});

test('the chat page is self-contained and served with a strict CSP', async () => {
  const harness = await mounted();
  const response = await harness.call('GET /chat');
  assert.match(response.headers.get('content-type'), /text\/html/u);
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /default-src 'none'/u);
  assert.match(csp, /connect-src 'self'/u);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const html = await response.text();
  assert.match(html, /<title>工作台 · 对话<\/title>/u);
  assert.match(html, /new EventSource\(/u);
  assert.doesNotMatch(html, /<script src=/u, 'the page must not load external scripts');
  assert.doesNotMatch(html, /@import|https?:\/\/fonts/u, 'the page must not load external styles');
});

test('the inline page script parses as JavaScript', async () => {
  const harness = await mounted();
  const html = await (await harness.call('GET /chat')).text();
  const match = html.match(/<script>([\s\S]*)<\/script>/u);
  assert.ok(match, 'the page must ship its script inline');
  assert.doesNotThrow(() => new Function(match[1]), 'the inline script must be syntactically valid');
  for (const id of ['list', 'messages', 'composer', 'input', 'send', 'stop', 'new']) {
    assert.match(html, new RegExp(`id="${id}"`, 'u'), `the page needs #${id}`);
  }
});

test('a conversation, a message and a run are reachable over HTTP', async () => {
  const harness = await mounted();
  const created = await harness.call('POST /api/chat/conversations', { body: { requestId: crypto.randomUUID(), title: '补货' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.conversation.title, '补货');

  const posted = await harness.call('POST /api/chat/conversations/:id/messages', {
    params: { id: created.body.conversation.id },
    body: { requestId: crypto.randomUUID(), content: '这个月该补货吗？' },
  });
  assert.equal(posted.status, 201);
  assert.equal(posted.body.run.status, 'prepared');

  const read = await harness.call('GET /api/chat/conversations/:id', { params: { id: created.body.conversation.id } });
  assert.equal(read.body.messages.length, 1);
  assert.equal(read.body.conversation.runCount, 1);

  const run = await harness.call('GET /api/chat/runs/:id', { params: { id: posted.body.run.id } });
  assert.equal(run.body.run.id, posted.body.run.id);
});

test('the event stream replays history and follows the run until it ends', async () => {
  const harness = await mounted();
  const created = await harness.call('POST /api/chat/conversations', { body: { requestId: crypto.randomUUID() } });
  const posted = await harness.call('POST /api/chat/conversations/:id/messages', {
    params: { id: created.body.conversation.id },
    body: { requestId: crypto.randomUUID(), content: 'go' },
  });
  const runId = posted.body.run.id;

  const response = await harness.call('GET /api/chat/runs/:id/events', { params: { id: runId }, query: { after: '0' } });
  assert.match(response.headers.get('content-type'), /text\/event-stream/u);
  const frames = frameReader(response);

  const prepared = await frames.next();
  assert.equal(prepared.event, 'run.prepared');
  assert.equal(prepared.data.type, 'run.prepared');

  await harness.service.advance({}, runId, 'running');
  const running = await frames.next();
  assert.equal(running.event, 'run.running');

  await harness.service.advance({}, runId, 'completed');
  const completed = await frames.next();
  assert.equal(completed.event, 'run.completed');
  assert.equal(await frames.end(), true, 'the stream must close on a terminal event');
});

test('a client reconnecting with after= only receives newer events', async () => {
  const harness = await mounted();
  const created = await harness.call('POST /api/chat/conversations', { body: { requestId: crypto.randomUUID() } });
  const posted = await harness.call('POST /api/chat/conversations/:id/messages', {
    params: { id: created.body.conversation.id },
    body: { requestId: crypto.randomUUID(), content: 'go' },
  });
  const runId = posted.body.run.id;
  const first = await harness.call('GET /api/chat/runs/:id/events', { params: { id: runId }, query: { after: '0' } });
  const firstFrames = frameReader(first);
  const prepared = await firstFrames.next();
  assert.ok(prepared.id >= 1);
  // Drop the connection and reconnect after the last seen id.
  await firstFrames.cancel();

  const second = await harness.call('GET /api/chat/runs/:id/events', {
    params: { id: runId }, query: { after: String(prepared.id) },
  });
  const secondFrames = frameReader(second);
  await harness.service.advance({}, runId, 'running');
  const running = await secondFrames.next();
  assert.equal(running.event, 'run.running');
  assert.ok(running.id > prepared.id);
});

test('cancelling over HTTP ends the stream and is idempotent', async () => {
  const harness = await mounted();
  const created = await harness.call('POST /api/chat/conversations', { body: { requestId: crypto.randomUUID() } });
  const posted = await harness.call('POST /api/chat/conversations/:id/messages', {
    params: { id: created.body.conversation.id },
    body: { requestId: crypto.randomUUID(), content: 'long task' },
  });
  const runId = posted.body.run.id;

  const response = await harness.call('GET /api/chat/runs/:id/events', { params: { id: runId }, query: { after: '0' } });
  const frames = frameReader(response);
  await frames.next();

  const cancelled = await harness.call('POST /api/chat/runs/:id/cancel', { params: { id: runId }, body: { reason: 'operator' } });
  assert.equal(cancelled.body.run.status, 'cancelled');
  const frame = await frames.next();
  assert.equal(frame.event, 'run.cancelled');
  assert.equal(await frames.end(), true);

  const again = await harness.call('POST /api/chat/runs/:id/cancel', { params: { id: runId }, body: {} });
  assert.equal(again.body.replayed, true);
});

test('approvals are listed and decided over HTTP', async () => {
  const harness = await mounted();
  const created = await harness.call('POST /api/chat/conversations', { body: { requestId: crypto.randomUUID() } });
  const posted = await harness.call('POST /api/chat/conversations/:id/messages', {
    params: { id: created.body.conversation.id },
    body: { requestId: crypto.randomUUID(), content: '需要批准的一步' },
  });
  const runId = posted.body.run.id;
  await harness.service.advance({}, runId, 'running');

  const runner = { actor: { subject: 'service:runner', role: 'operator', workspaceId: 'local' }, trustedService: true };
  const approval = await harness.service.requestApproval(runner, runId, {
    action: 'business_memory_propose', resource: 'memory:customer-haiqi', payload: { factKey: 'moq', value: 500 }, ticketId: 'ticket-1',
  });
  assert.equal(approval.status, 'pending');

  const listed = await harness.call('GET /api/chat/conversations/:id/approvals', { params: { id: created.body.conversation.id } });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.total, 1);
  assert.equal(listed.body.items[0].action, 'business_memory_propose');
  assert.deepEqual(listed.body.items[0].payload, { factKey: 'moq', value: 500 });

  const runBlocked = await harness.call('GET /api/chat/runs/:id', { params: { id: runId } });
  assert.equal(runBlocked.body.run.status, 'blocked');

  const decided = await harness.call('POST /api/chat/approvals/:id', {
    params: { id: approval.id }, body: { decision: 'approve', note: '确认' },
  });
  assert.equal(decided.status, 200);
  assert.equal(decided.body.approval.status, 'approved');
  assert.equal(decided.body.approval.decidedBy, 'local-operator');

  const runResumed = await harness.call('GET /api/chat/runs/:id', { params: { id: runId } });
  assert.equal(runResumed.body.run.status, 'running');

  const after = await harness.call('GET /api/chat/conversations/:id/approvals', { params: { id: created.body.conversation.id } });
  assert.equal(after.body.total, 0, 'a decided approval leaves the pending list');
});