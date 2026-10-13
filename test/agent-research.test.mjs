import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createBraveResearchAdapter } from '../server/agent/research.mjs';
const scope = { query: 'stainless bottle US supplier', limit: 2, requestId: 'original-research', taskId: 'original-task', stageKey: 'search', actor: { subject: 'member', workspaceId: 'enterprise' } };
test('real research transport is opt-in and missing credentials never causes an outbound request', async () => {
  let calls = 0;
  for (const environment of [{}, { WS_AGENT_RESEARCH_ENABLED: '1' }, { BRAVE_SEARCH_API_KEY: 'test-only' }]) {
    const adapter = createBraveResearchAdapter({ environment, fetchImpl() { calls++; } });
    assert.equal(adapter.configured, false);
    await assert.rejects(adapter.search(scope), { code: 'AGENT_REQUIRED_CAPABILITY_MISSING' });
  }
  assert.equal(calls, 0);
});
test('official Web Search protocol is exercised against a local HTTP response with bounded source evidence', async t => {
  const secret = randomBytes(32).toString('hex');
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++; assert.equal(req.headers['x-subscription-token'], secret);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ web: { results: [{ url: 'https://example.com/catalog', title: 'Supplier catalog', description: 'Public product information.', extra_snippets: ['Terms require confirmation.'] }] } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const adapter = createBraveResearchAdapter({ environment: { WS_AGENT_RESEARCH_ENABLED: '1', BRAVE_SEARCH_API_KEY: secret }, fetchImpl(url, options) {
    assert.equal(url.origin, 'https://api.search.brave.com'); assert.equal(url.pathname, '/res/v1/web/search'); assert.equal(url.searchParams.get('q'), scope.query);
    assert.equal(options.redirect, 'error'); assert.equal(options.method, 'GET');
    return fetch('http://127.0.0.1:' + server.address().port, options);
  } });
  const result = await adapter.search(scope);
  assert.equal(requests, 1); assert.equal(result.sources.length, 1);
  assert.match(result.sources[0].excerpt, /Terms require confirmation/);
  assert.ok(!JSON.stringify(result).includes(secret));
});
test('empty, failed and malformed search remain missing evidence without automatic repeated requests', async () => {
  const environment = { WS_AGENT_RESEARCH_ENABLED: '1', BRAVE_SEARCH_API_KEY: 'test-only-host-token' };
  let count = 0;
  const empty = createBraveResearchAdapter({ environment, fetchImpl: async () => { count++; return new Response('{"web":{"results":[]}}'); } });
  assert.deepEqual((await empty.search(scope)).sources, []);
  const failed = createBraveResearchAdapter({ environment, fetchImpl: async () => { count++; return new Response('unavailable', { status: 429 }); } });
  await assert.rejects(failed.search(scope), { code: 'AGENT_RESEARCH_RATE_LIMITED' }); assert.equal(count, 2);
  const malformed = createBraveResearchAdapter({ environment, fetchImpl: async () => new Response('{"web":{"results":"not-an-array"}}') });
  await assert.rejects(malformed.search(scope), { code: 'AGENT_RESEARCH_RESPONSE_INVALID' });
});
