import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/index.mjs';
import { DOT_MCP_TOOLS } from '../server/dot-mcp-server.mjs';

const PROTOCOL = '2026-07-28';
const token = randomBytes(32).toString('base64url');
const digest = createHash('sha256').update(token).digest('hex');
const meta = {
  'io.modelcontextprotocol/protocolVersion': PROTOCOL,
  'io.modelcontextprotocol/clientInfo': { name: 'dot-xy-plugin-fixture', version: '1.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};
async function start(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'workspace-dot-mcp-'));
  const app = await createApp({ dataDirectory: dir, dotWorkerConfig: {
    workerId: 'chatgpt-dot-xy', ownerId: 'xy',
    enabled: true, scopeReviewed: true, externalBudgetVerified: true, tokenDigest: digest,
  } });
  const address = await app.listen(0);
  t.after(async () => { await app.close(); await rm(dir, { force: true, recursive: true }); });
  return { app, base: 'http://127.0.0.1:' + address.port };
}
async function jsonRpc(base, message, options = {}) {
  const modern = options.modern !== false;
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (!options.unauthenticated) headers.Authorization = 'Bearer ' + token;
  if (modern) {
    headers['MCP-Protocol-Version'] = PROTOCOL;
    headers['Mcp-Method'] = message.method;
    if (message.method === 'tools/call') headers['Mcp-Name'] = message.params?.name;
    message = { ...message, params: { ...message.params, _meta: options.omitClientInfo
      ? Object.fromEntries(Object.entries(meta).filter(([key]) => key !== 'io.modelcontextprotocol/clientInfo'))
      : meta } };
  }
  Object.assign(headers, options.headers || {});
  const response = await fetch(base + (options.url || '/mcp'), {
    method: 'POST', headers, body: JSON.stringify(message),
  });
  return { status: response.status, headers: response.headers,
    body: response.status === 202 ? null : await response.json() };
}
const rpc = (method, id, params = {}) => ({ jsonrpc: '2.0', id, method, params });
const toolCall = (name, args, id = 3) => rpc('tools/call', id, { name, arguments: args });

test('real MCP 2026 discovery and eleven genuine plugins over authenticated Streamable HTTP', async t => {
  const { base } = await start(t);
  const discover = await jsonRpc(base, rpc('server/discover', 1));
  assert.equal(discover.status, 200);
  assert.equal(discover.body.result.resultType, 'complete');
  assert.ok(discover.body.result.supportedVersions.includes(PROTOCOL));
  assert.ok(discover.body.result.capabilities.tools);
  const list = await jsonRpc(base, rpc('tools/list', 2));
  assert.equal(list.status, 200);
  assert.equal(list.body.result.tools.length, 11);
  assert.deepEqual(list.body.result.tools.map(x => x.name).sort(),
    DOT_MCP_TOOLS.map(x => x.name).sort());
  assert.ok(list.body.result.tools.every(x => x.inputSchema.type === 'object' &&
    x.inputSchema.additionalProperties === false));
  const identity = await jsonRpc(base, toolCall('workspace_worker_identity', {}));
  assert.equal(identity.status, 200);
  assert.equal(identity.body.result.structuredContent.dot, 'xy');
  assert.equal(identity.body.result.structuredContent.approved, true);
  const inbox = await jsonRpc(base, toolCall('workspace_worker_inbox', {}));
  assert.deepEqual(inbox.body.result.structuredContent.tasks, []);
  const connection = await (await fetch(base + '/api/dot-worker-connection')).json();
  assert.ok(connection.lastSeenAt, 'Authenticated MCP identity and inbox calls must persist handshake');
});

test('modern client omits optional clientInfo without losing dot identity', async t => {
  const { base } = await start(t);
  const discovery = await jsonRpc(base, rpc('server/discover', 21), { omitClientInfo: true });
  assert.equal(discovery.status, 200);
  const inbox = await jsonRpc(base, toolCall('workspace_worker_inbox', {}, 22), { omitClientInfo: true });
  assert.equal(inbox.status, 200);
  assert.deepEqual(inbox.body.result.structuredContent.tasks, []);
  const connection = await (await fetch(base + '/api/dot-worker-connection')).json();
  assert.ok(connection.lastSeenAt);
});
test('legacy initialized MCP client can enumerate and call tools without a fake tokenless API', async t => {
  const { base } = await start(t);
  const init = await jsonRpc(base, rpc('initialize', 1, {
    protocolVersion: '2025-11-25',
    clientInfo: { name: 'legacy-dot', version: '1.0' }, capabilities: {},
  }), { modern: false });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.serverInfo.name, 'workspace-dot-xy');
  const initialized = await jsonRpc(base, {
    jsonrpc: '2.0', method: 'notifications/initialized', params: {},
  }, { modern: false });
  assert.equal(initialized.status, 202);
  const list = await jsonRpc(base, rpc('tools/list', 2), { modern: false });
  assert.equal(list.status, 200);
  assert.equal(list.body.result.tools.length, 11);
  assert.equal(list.body.result.resultType, undefined);
  const older = await jsonRpc(base, rpc('initialize', 4, {
    protocolVersion: '2025-06-18',
    clientInfo: { name: 'older-streamable-http', version: '1.0' }, capabilities: {},
  }), { modern: false });
  assert.equal(older.status, 200);
  assert.equal(older.body.result.protocolVersion, '2025-06-18');
});

test('MCP rejects untrusted callers, protocol/header confusion and arbitrary tool names', async t => {
  const { base } = await start(t);
  assert.equal((await jsonRpc(base, rpc('tools/list', 1), { unauthenticated: true })).status, 401);
  assert.equal((await jsonRpc(base, rpc('tools/list', 1), {
    headers: { Origin: 'https://untrusted.example.org' },
  })).status, 403);
  const headerConfusion = await jsonRpc(base, toolCall('workspace_worker_inbox', {}),
    { headers: { 'Mcp-Name': 'workspace_worker_submit_result' } });
  assert.equal(headerConfusion.status, 400);
  assert.equal(headerConfusion.body.error.code, -32020);
  const unknown = await jsonRpc(base, toolCall('run_arbitrary_shell', {}));
  assert.equal(unknown.status, 404);
  const unsupported = await jsonRpc(base, rpc('tools/list', 1),
    { headers: { 'MCP-Protocol-Version': '2100-01-01' } });
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.body.error.code, -32022);
  assert.ok(unsupported.body.error.data.supported.includes(PROTOCOL));
  const method = await fetch(base + '/mcp', {
    headers: { Authorization: 'Bearer ' + token },
  });
  assert.equal(method.status, 405);
});

test('MCP actual task: Workspace approve -> queued -> dot claim -> submit evidence -> human review', async t => {
  const { base } = await start(t);
  const workerRequest = async (endpoint, data) => {
    const response = await fetch(base + '/api' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    assert.equal(response.ok, true, endpoint + ' failed with HTTP ' + response.status);
    return response.json();
  };
  const ordered = await workerRequest('/worker-orders', {
    serviceId: 'buyer-discovery', workerId: 'chatgpt-dot-xy',
    product: 'Printed rayon', market: 'United States',
    objective: 'Research published distributors with original sources',
    budgetCredits: 12,
    deadlineAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    requestId: 'mcp-e2e-test-001', publicDataConfirmed: true,
  });
  const orderId = ordered.order.id;
  await workerRequest('/worker-orders/' + orderId + '/approve',
    { confirmed: true, workerId: 'chatgpt-dot-xy' });
  const dispatched = await workerRequest('/worker-orders/' + orderId + '/dispatch', {});
  assert.equal(dispatched.order.status, 'queued');
  const inbox = await jsonRpc(base, toolCall('workspace_worker_inbox', {}));
  assert.deepEqual(inbox.body.result.structuredContent.tasks.map(x => x.taskRef), [orderId]);
  const task = await jsonRpc(base, toolCall('workspace_worker_read_task', { taskRef: orderId }));
  assert.equal(task.body.result.structuredContent.inputs.market, 'United States');
  assert.equal(task.body.result.structuredContent.dataScope, 'public');
  const claim = await jsonRpc(base, toolCall('workspace_worker_claim_task',
    { taskRef: orderId, requestId: 'claim-stable-001' }));
  assert.equal(claim.status, 200);
  const { attemptId, fence } = claim.body.result.structuredContent;
  assert.equal(fence, 1);
  assert.equal(claim.body.result.structuredContent.canExecute, true);
  const data = {
    schema: 'workspace.worker.delivery.v1', orderId,
    deliverables: [{ name: 'Public distributors', type: 'table', summary: 'One sourced example fixture' }],
    evidence: [{ title: 'Public catalog', url: 'https://buyer.example.org/catalog', detail: 'Published company page' }],
    prospects: [{ name: 'Source fixture', country: 'USA',
      website: 'https://buyer.example.org', fitReason: 'Wholesale textiles',
      sourceUrl: 'https://buyer.example.org/catalog' }],
  };
  const bytes = Buffer.from(JSON.stringify(data));
  const uploaded = await jsonRpc(base, toolCall('workspace_worker_upload_file', {
    taskRef: orderId, attemptId, fence, uploadId: 'original-upload-01',
    filename: 'source-buyers.json', base64: bytes.toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }));
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.body.result.isError, undefined);
  const submitted = await jsonRpc(base, toolCall('workspace_worker_submit_result', {
    taskRef: orderId, attemptId, fence, requestId: 'submit-evidence-original',
    summary: 'A public company source requires human verification.',
    sources: ['https://buyer.example.org/catalog'],
    toolEvidence: [{ tool: 'web-search', receiptId: 'original-receipt-001' }],
  }));
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.result.structuredContent.reviewRequired, true);
  const refreshed = await workerRequest('/worker-orders/' + orderId + '/refresh', {});
  assert.equal(refreshed.order.status, 'review_required');
  assert.equal(refreshed.order.workerReport.prospects.length, 1);
  assert.equal(refreshed.order.workerReport.independentlyVerified, false);
  const accepted = await workerRequest('/worker-orders/' + orderId + '/accept', { confirmed: true });
  assert.equal(accepted.order.status, 'accepted');
  assert.ok(accepted.order.deliveryArtifactId);
});
