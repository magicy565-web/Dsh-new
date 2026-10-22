import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { apply } from '../index.js';

function fakeContext() {
  const tools = new Map(), handlers = new Map(), effects = [];
  let currentAgent = null;
  const ctx = {
    tools: { register: definition => { tools.set(definition.name, definition); return () => tools.delete(definition.name); } },
    effect: callback => { effects.push(callback()); },
    agents: { currentInitiator: () => currentAgent },
    on: (name, handler) => {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      return () => { handlers.set(name, (handlers.get(name) ?? []).filter(item => item !== handler)); };
    },
    handlers, toolsMap: tools, effects,
    setAgent(agent) { currentAgent = agent; },
  };
  return ctx;
}

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  process.env.BUSINESS_MEMORY_BASE_URL = `http://127.0.0.1:${port}`;
  try { return await run(); }
  finally {
    delete process.env.BUSINESS_MEMORY_BASE_URL;
    delete process.env.BUSINESS_MEMORY_INJECT;
    delete process.env.BUSINESS_MEMORY_REQUIRED;
    await new Promise(resolve => server.close(resolve));
  }
}

function readBody(request) {
  return new Promise(resolve => {
    let text = '';
    request.on('data', chunk => { text += chunk; });
    request.on('end', () => resolve(text ? JSON.parse(text) : null));
  });
}

const emptyAssembly = () => ({ sections: [], contexts: [], tools: [], variables: {} });
const nextAssembly = async () => emptyAssembly();

function preStepPayload(turn = 1, text = '请根据海祺的补货节奏，判断下季度该备多少货。') {
  return {
    agent: { id: 'sess-1' },
    turn,
    step: 1,
    messages: [{ role: 'user', content: [{ type: 'text', text }] }],
    signal: new AbortController().signal,
  };
}

test('every task turn compiles memory and every assembly receives it', async () => {
  const bodies = [];
  await withServer(async (request, response) => {
    bodies.push(await readBody(request));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ text: `MEMORY-BLOCK-${bodies.length}`, revision: 7, counts: { active: 2, injected: 1, omitted: 1 } }));
  }, async () => {
    const ctx = fakeContext();
    apply(ctx, {});
    const preStep = ctx.handlers.get('agent/pre-step')[0];
    const assemble = ctx.handlers.get('system-prompt/assemble')[0];

    const decision = await preStep(preStepPayload(), async () => ({ kind: 'enter', messages: [] }));
    assert.deepEqual(decision, { kind: 'enter', messages: [] });
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].taskId, 'sess-1:1');
    assert.equal(bodies[0].sessionId, 'sess-1');
    assert.match(bodies[0].query, /海祺/u);
    assert.equal(bodies[0].record, true);

    ctx.setAgent({ id: 'sess-1' });
    const assembly = await assemble(emptyAssembly(), {}, nextAssembly);
    const injected = assembly.contexts.find(item => item.name === 'business-memory');
    assert.ok(injected);
    assert.match(injected.text, /MEMORY-BLOCK-1/u);

    // The same turn reuses one compiled context; the next turn reads again.
    await preStep(preStepPayload(1), async () => ({ kind: 'enter', messages: [] }));
    assert.equal(bodies.length, 1);
    await preStep(preStepPayload(2, '那客户林经理的决策流程是什么？'), async () => ({ kind: 'enter', messages: [] }));
    assert.equal(bodies.length, 2);
    assert.equal(bodies[1].taskId, 'sess-1:2');
  });
});

test('a memory outage is disclosed in the prompt instead of silently omitted', async () => {
  await withServer((_request, response) => {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 'BUSINESS_MEMORY_SOURCE_UNCONFIGURED', message: 'no memory' } }));
  }, async () => {
    const ctx = fakeContext();
    apply(ctx, {});
    const preStep = ctx.handlers.get('agent/pre-step')[0];
    const assemble = ctx.handlers.get('system-prompt/assemble')[0];
    await preStep(preStepPayload(), async () => ({ kind: 'enter', messages: [] }));
    ctx.setAgent({ id: 'sess-1' });
    const assembly = await assemble(emptyAssembly(), {}, nextAssembly);
    const injected = assembly.contexts.find(item => item.name === 'business-memory');
    assert.ok(injected);
    assert.match(injected.text, /无法读取企业经营记忆/u);
    assert.match(injected.text, /BUSINESS_MEMORY_SOURCE_UNCONFIGURED/u);
    assert.match(injected.text, /不要声称记得企业事实/u);
  });
});

test('required mode blocks a step when memory was not read', async () => {
  process.env.BUSINESS_MEMORY_REQUIRED = '1';
  await withServer((_request, response) => {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 'BUSINESS_MEMORY_UNAVAILABLE', message: 'down' } }));
  }, async () => {
    const ctx = fakeContext();
    apply(ctx, {});
    const preStep = ctx.handlers.get('agent/pre-step')[0];
    await assert.rejects(
      () => preStep(preStepPayload(), async () => ({ kind: 'enter', messages: [] })),
      /BUSINESS_MEMORY_REQUIRED/u,
    );
  });
});

test('injection can be disabled without removing the tools', async () => {
  process.env.BUSINESS_MEMORY_INJECT = '0';
  let requests = 0;
  await withServer((_request, response) => {
    requests += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ text: 'MEMORY', revision: 1 }));
  }, async () => {
    const ctx = fakeContext();
    apply(ctx, {});
    await ctx.handlers.get('agent/pre-step')[0](preStepPayload(), async () => ({ kind: 'enter', messages: [] }));
    ctx.setAgent({ id: 'sess-1' });
    const assembly = await ctx.handlers.get('system-prompt/assemble')[0](emptyAssembly(), {}, nextAssembly);
    assert.deepEqual(assembly.contexts, []);
    assert.equal(requests, 0);
    assert.equal(ctx.toolsMap.size, 6);
  });
});

test('internal model calls with no executing agent get no business memory', async () => {
  let requests = 0;
  await withServer((_request, response) => {
    requests += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ text: 'MEMORY', revision: 1 }));
  }, async () => {
    const ctx = fakeContext();
    apply(ctx, {});
    const assembly = await ctx.handlers.get('system-prompt/assemble')[0](emptyAssembly(), {}, nextAssembly);
    assert.deepEqual(assembly.contexts, []);
    assert.equal(requests, 0);
  });
});
