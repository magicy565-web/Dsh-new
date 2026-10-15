import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';

export const API = '/api/agent/v1';
export const PRESET_IDS = ['procurement', 'supplier-sourcing', 'opportunity-discovery', 'factory-export'];
export const EVENT_KINDS = ['accepted', 'stage', 'thinking', 'progress', 'artifact', 'done', 'error'];
export const MODEL_TEXT = '当前资料的缺口应逐项核对。';
export const INPUTS = {
  procurement: { product: '不锈钢保温杯', spec: '500ml；采购数量单位：个', quantity: 1000, target_price: 'CNY 18/个；出厂价，EXW/FOB 口径待确认', market: '美国', requirements: '英文标签；需要确认样品' },
  'supplier-sourcing': { product: '不锈钢保温杯', spec: '500ml', quantity: 1000, market: '美国' },
  'opportunity-discovery': { product: '不锈钢保温杯', market: '美国', spec: '500ml', own_price: 'USD 19.99；零售展示价，非成交价' },
};
export const ARTIFACTS = {
  procurement: ['inquiry-pack.md', 'comparison.md', 'procurement-brief.md'],
  'supplier-sourcing': ['suppliers.md'],
  'opportunity-discovery': ['opportunity-report.md'],
};
const fixtureSecrets = new Set();
function containsCredential(text) { return [...fixtureSecrets].some(value => text.includes(value)); }

// All credentials in this suite are newly generated fixture credentials. They
// are never read from a user account, saved in a client file, or included in
// diagnostics/assertion values. Provider fixtures listen on loopback only.
export function credentials() {
  const tokenA = randomBytes(32).toString('base64url');
  const tokenB = randomBytes(32).toString('base64url');
  fixtureSecrets.add(tokenA); fixtureSecrets.add(tokenB);
  return { tokenA, tokenB, tokenMap: { [tokenA]: 'fixture-account-a', [tokenB]: 'fixture-account-b' } };
}

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export const presetRows = value => Array.isArray(value) ? value : value?.presets;

export function request(base, route, { token, method = 'GET', body, rawBody, headers = {}, timeoutMs = 15_000 } = {}) {
  const url = new URL(route, base);
  if (url.origin !== new URL(base).origin) throw new Error('Fixture requests must remain on loopback origin.');
  return new Promise((resolve, reject) => {
    const data = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
    const req = http.request(url, { method, agent: false, headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(data === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.once('error', () => reject(new Error('Loopback HTTP response failed.')));
      res.once('end', () => {
        const bytes = Buffer.concat(chunks), text = bytes.toString('utf8');
        if (containsCredential(text)) { reject(new Error('HTTP response contained a forbidden fixture credential; its body was withheld.')); return; }
        let json;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, bytes, text, json });
      });
    });
    req.once('error', () => reject(new Error('Loopback HTTP request failed.')));
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Loopback HTTP deadline exceeded.')));
    req.end(data);
  });
}

export function stream(base, route, token, { stopAfter, onEvent, timeoutMs = 15_000, headers = {} } = {}) {
  const url = new URL(route, base);
  if (url.origin !== new URL(base).origin) throw new Error('Fixture streams must remain on loopback origin.');
  return new Promise((resolve, reject) => {
    const events = [], ids = [];
    let pending = '', settled = false, response;
    const finish = (closedByServer, status = response?.statusCode) => {
      if (settled) return;
      settled = true; clearTimeout(deadline);
      resolve({ status, events, ids, closedByServer, headers: response?.headers || {} });
    };
    const fail = () => {
      if (settled) return;
      settled = true; clearTimeout(deadline);
      response?.destroy(); req.destroy();
      reject(new Error('SSE stream failed or exceeded its deadline.'));
    };
    const req = http.request(url, { agent: false, headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream', ...headers } }, res => {
      response = res;
      if (res.statusCode !== 200) { res.resume(); res.once('end', () => finish(true)); return; }
      if (!String(res.headers['content-type']).includes('text/event-stream')) { fail(); return; }
      res.setEncoding('utf8');
      res.on('data', chunk => {
        if (settled) return;
        pending += chunk.replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = pending.indexOf('\n\n')) !== -1) {
          const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
          const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          if (containsCredential(data)) { fail(); return; }
          try {
            const event = JSON.parse(data);
            const idLine = frame.split('\n').find(line => line.startsWith('id:'));
            ids.push(idLine?.slice(3).trim()); events.push(event);
            onEvent?.(event);
            if (stopAfter && events.length >= stopAfter) { finish(false); res.destroy(); req.destroy(); return; }
          } catch { fail(); return; }
        }
      });
      res.once('end', () => finish(true));
      res.once('error', () => { if (!settled) fail(); });
      res.once('aborted', () => { if (!settled) fail(); });
    });
    const deadline = setTimeout(fail, timeoutMs);
    req.once('error', () => { if (!settled) fail(); });
    req.end();
  });
}

export async function serviceFixture(t, options = {}) {
  const { createApp } = await import('../server/index.mjs');
  const { createPiProvider } = await import('../server/pi-provider.mjs');
  const dir = options.dataDir || await mkdtemp(path.join(tmpdir(), 'workspace-agent-http-'));
  const creds = options.credentials || credentials();
  const env = { WS_AGENT_DEMO: '1', ...options.env, WS_AGENT_DATA: path.join(dir, 'agent') };
  const principals = [{ subject: 'local-operator', workspaceId: 'local', tokenSha256: createHash('sha256').update(creds.tokenA).digest('hex'), scopes: ['agent:read', 'agent:submit'] }];
  let app, base, closed = false;
  async function start() {
    app = await createApp({ dataDirectory: dir, provider: createPiProvider(), capabilityEnvironment: {}, agentConfig: { env, principals } });
    const address = await app.listen(0); base = 'http://127.0.0.1:' + address.port;
  }
  async function stop() { if (app) { const current = app; app = null; await current.close(); } }
  await start();
  t.after(async () => { if (!closed) { closed = true; await stop(); } if (!options.dataDir) await rm(dir, { recursive: true, force: true }); });
  return {
    ...creds, dir, get app() { return app; }, get base() { return base; }, get service() { return app.builtinAgent; },
    api(route, options = {}) { return request(base, route, { token: creds.tokenA, ...options }); },
    async restart() { await stop(); await start(); },
    async close() { if (!closed) { closed = true; await stop(); } },
  };
}

export async function submit(fixture, type = 'procurement', input = INPUTS[type], token = fixture.tokenA) {
  const result = await fixture.api(`${API}/tasks`, { method: 'POST', token, body: { type, title: `${type} 契约验收任务`, input } });
  assert.equal(result.status, 201, 'Valid task creation must return HTTP 201.');
  assert.equal(typeof result.json?.taskId, 'string');
  assert.equal(result.json.status, 'queued');
  assert.equal(result.json.events_url, `${API}/tasks/${result.json.taskId}/events`);
  return result.json;
}

export async function completed(fixture, task, { token = fixture.tokenA } = {}) {
  const live = await stream(fixture.base, task.events_url, token);
  assert.equal(live.status, 200);
  assert.equal(live.closedByServer, true, 'A terminal stream must close without client cancellation.');
  const detail = await fixture.api(`${API}/tasks/${task.taskId}`, { token });
  const history = await fixture.api(`${task.events_url}?format=json`, { token });
  assert.equal(detail.status, 200); assert.equal(history.status, 200);
  assert.ok(Array.isArray(history.json), 'JSON replay must return the complete event array.');
  assert.deepEqual(live.events, history.json, 'Every live event must equal its persisted replay.');
  return { live, detail: detail.json, events: history.json };
}

export function assertEvents(events, { type, taskId, status = 'done', from = 0 } = {}) {
  assert.ok(events.length > 0, 'The event history must not be empty.');
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    assert.deepEqual(Object.keys(event).sort(), ['kind', 'payload', 'seq', 'ts']);
    assert.equal(event.seq, from + index + 1, 'Per-task sequences must be contiguous and monotonic.');
    assert.ok(EVENT_KINDS.includes(event.kind), 'Only the seven contract kinds are permitted.');
    assert.ok(Number.isFinite(Date.parse(event.ts)), 'An event timestamp must be an ISO-compatible timestamp.');
    assert.equal(typeof event.payload, 'object');
  }
  if (!from) {
    const accepted = events[0];
    assert.equal(accepted.kind, 'accepted');
    assert.equal(accepted.payload.taskId, taskId);
    assert.equal(accepted.payload.type, type);
    assert.equal(typeof accepted.payload.preset, 'string');
    assert.equal(typeof accepted.payload.title, 'string');
    assert.ok(['demo', 'model'].includes(accepted.payload.mode));
    assert.ok(Array.isArray(accepted.payload.plan));
    assert.equal(accepted.payload.plan.length, type === 'procurement' ? 4 : 3);
    assert.ok(accepted.payload.plan.every(title => typeof title === 'string' && title.length > 0));
  }
  assert.equal(events.at(-1).kind, status === 'done' ? 'done' : 'error');
  assert.equal(events.filter(event => ['done', 'error'].includes(event.kind)).length, 1);
  if (status !== 'done') return;
  const stages = events.filter(event => event.kind === 'stage');
  assert.equal(stages.length, type === 'procurement' ? 4 : 3);
  for (const stage of stages) {
    assert.deepEqual(Object.keys(stage.payload).sort(), ['stage', 'title']);
    assert.equal(typeof stage.payload.stage, 'string');
    assert.equal(typeof stage.payload.title, 'string');
    const thoughts = events.filter(event => event.kind === 'thinking' && event.payload.stage === stage.payload.stage);
    assert.ok(thoughts.length >= 2 && thoughts.length <= 4, 'Each stage needs two to four truthful execution updates.');
    for (const thought of thoughts) {
      assert.deepEqual(Object.keys(thought.payload).sort(), ['stage', 'text']);
      assert.equal(typeof thought.payload.text, 'string'); assert.ok(thought.payload.text.trim());
      assert.ok(thought.seq > stage.seq, 'Thinking must follow the stage entry event.');
    }
    const progress = events.filter(event => event.kind === 'progress' && event.payload.stage === stage.payload.stage);
    assert.equal(progress.length, 1);
    assert.deepEqual(progress[0].payload, { stage: stage.payload.stage, done: true });
    assert.ok(progress[0].seq > thoughts.at(-1).seq, 'Stage completion must follow all its execution updates.');
  }
  for (const event of events.filter(event => event.kind === 'artifact')) {
    assert.deepEqual(Object.keys(event.payload).sort(), ['bytes', 'name', 'url']);
    assert.ok(Number.isSafeInteger(event.payload.bytes) && event.payload.bytes > 0);
    assert.equal(typeof event.payload.name, 'string'); assert.equal(typeof event.payload.url, 'string');
  }
  assert.deepEqual(Object.keys(events.at(-1).payload).sort(), ['artifacts', 'result', 'summary']);
  assert.equal(events.at(-1).payload.result.version, 1);
  assert.equal(events.at(-1).payload.result.businessGoalAchieved, false);
}

export async function modelFixture(t, { mode = 'success', delayMs = 0, holdAfter = Infinity } = {}) {
  const calls = [], providerSecret = randomBytes(32).toString('base64url');
  fixtureSecrets.add(providerSecret);
  let firstResolve;
  const firstCall = new Promise(resolve => { firstResolve = resolve; });
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { res.writeHead(400); res.end('{}'); return; }
    let context;
    try { context = JSON.parse(body.messages?.filter(message => message.role === 'user').at(-1)?.content || '{}'); } catch {}
    calls.push({ path: req.url, model: body.model, stage: context?.stage?.key, messageCount: body.messages?.length, hasSystemPrompt: body.messages?.some(message => message.role === 'system' && message.content?.length > 0) === true });
    firstResolve();
    if (mode === 'hold' || calls.length >= holdAfter) return;
    if (delayMs) await delay(delayMs);
    if (res.destroyed) return;
    if (mode === 'http-error') { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Synthetic provider unavailable.' } })); return; }
    const output = mode === 'ungrounded-number'
      ? { analysis: [{ text: '该产品月销量为 937145 件。', sources: [] }] }
      : mode === 'unknown-source'
        ? { analysis: [{ text: MODEL_TEXT, sources: ['fixture-source-does-not-exist'] }] }
        : { analysis: [{ text: MODEL_TEXT, sources: [] }], recommendations: [{ text: '建议先补全报价币种与贸易口径，再比较条件。', sources: [] }], questions: [{ text: '是否需要定制标签与包装？', sources: [] }] };
    const content = mode === 'malformed' ? 'This is not valid structured JSON.' : JSON.stringify(output);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'synthetic-completion', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { calls, firstCall, providerSecret, env: { WS_MODEL_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, WS_MODEL_NAME: 'synthetic-loopback-model', WS_MODEL_API_KEY: providerSecret, WS_MODEL_TIMEOUT_MS: '2000' } };
}

export async function waitFor(callback, { timeoutMs = 10_000, message = 'Expected condition was not observed.' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const result = await callback(); if (result) return result; await delay(20); }
  throw new Error(message);
}

export async function childFixture(t, { dir, creds = credentials(), env = {}, concurrency = 1 } = {}) {
  const dataDir = dir || await mkdtemp(path.join(tmpdir(), 'workspace-agent-child-'));
  let child, base, stopped = false;
  async function start() {
    child = fork(new URL('./fixtures/agent-service-child.mjs', import.meta.url), [], {
      env: { PATH: process.env.PATH || '', NODE_NO_WARNINGS: '1', WS_AGENT_DATA: dataDir, WS_AGENT_TOKENS: JSON.stringify(creds.tokenMap), WS_AGENT_TEST_CONCURRENCY: String(concurrency), ...env },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    // Do not relay raw child output: exception dumps can contain credentials.
    child.stdout.resume(); child.stderr.resume();
    base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); child.kill('SIGKILL'); reject(new Error('Agent child startup deadline exceeded.')); }, 10_000);
      const cleanup = () => { clearTimeout(timer); child.off('message', onMessage); child.off('exit', onExit); };
      const onExit = () => { cleanup(); reject(new Error('Agent child exited before becoming ready.')); };
      const onMessage = message => {
        if (message?.kind === 'ready') { cleanup(); resolve(message.base); }
        if (message?.kind === 'startup-error') { cleanup(); reject(new Error('Agent child startup was rejected.')); }
      };
      child.on('message', onMessage); child.once('exit', onExit);
    });
  }
  async function kill(signal = 'SIGTERM') {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const current = child, finished = once(current, 'exit');
    current.kill(signal);
    const timeout = setTimeout(() => current.kill('SIGKILL'), 3000);
    try { await finished; } finally { clearTimeout(timeout); }
  }
  await start();
  t.after(async () => { if (!stopped) await kill(); if (!dir) await rm(dataDir, { recursive: true, force: true }); });
  return {
    ...creds, dir: dataDir, get base() { return base; }, get child() { return child; },
    api(route, options = {}) { return request(base, route, { token: creds.tokenA, ...options }); },
    async restart({ crash = false } = {}) { await kill(crash ? 'SIGKILL' : 'SIGTERM'); await start(); },
    async close() { stopped = true; await kill(); },
  };
}
