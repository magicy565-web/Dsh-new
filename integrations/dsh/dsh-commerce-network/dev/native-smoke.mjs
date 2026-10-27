import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import Commerce from '../index.js';
import { createWorkerHandler } from '../http.js';

if (!process.env.DSH_RUNTIME_DIR) throw new Error('Set DSH_RUNTIME_DIR to an installed official DSH package directory.');
const require = createRequire(join(resolve(process.env.DSH_RUNTIME_DIR), 'package.json'));
const load = name => import(require.resolve(`@deepseek-ai/${name}`));
const { Context } = await load('cordis');
const { default: SystemPrompt } = await load('dsh-system-prompt');
const { default: Tools } = await load('dsh-tools');
const root = await mkdtemp(join(tmpdir(), 'native-commerce-'));
const sessionId = `session-${randomUUID()}`, workspaceId = randomUUID();
const row = { id: workspaceId, sessionIds: [sessionId] };
const registry = { list: () => [row], get: id => id === workspaceId ? row : null };
let ctx, server, worker;
try {
  ctx = new Context();
  await ctx.plugin(SystemPrompt); await ctx.plugin(Tools);
  await ctx.plugin({ apply(scope) { scope.provide('workspaceRegistry', registry); } });
  await ctx.plugin(Commerce, { dataDir: root });
  const service = ctx.get('commerceNetwork');
  assert.ok(service, 'The native Cordis service must actually be registered.');
  const execute = async (name, args) => {
    const result = await ctx.tools.execute({ name, arguments: args, agent: { session: { id: sessionId } }, callId: `native_${randomUUID()}`, signal: new AbortController().signal });
    assert.equal(result.isError, false, JSON.stringify(result)); return result.value;
  };
  const initial = await execute('commerce_network_read', {});
  const plan = await execute('commerce_network_plan', {
    expectedRevision: initial.revision, requestId: 'native-plan', title: 'Native acceptance fixture',
    parties: [{ id: 'factory', type: 'factory', displayName: 'Synthetic factory' }, { id: 'provider', type: 'provider', displayName: 'Synthetic independent provider' }],
    agents: [{ id: 'worker', providerPartyId: 'provider', displayName: 'Separate process worker fixture', skills: ['public_web_research'] }],
    workOrders: [{ id: 'order', requesterPartyId: 'factory', agentServiceId: 'worker', title: 'Verify independent worker transport', brief: 'Return a protocol acceptance record; do not invent buyers or contact anyone.', allowedActions: ['public_web_research'], allowedResourceRefs: [], maximumMinor: 0 }],
  });
  const state = () => service.state(sessionId, plan.projectId);
  const command = (name, payload) => service.command(sessionId, { projectId: plan.projectId, expectedRevision: state().revision, requestId: randomUUID(), command: name, payload });
  const issued = await command('issue_agent_credential', { agentServiceId: 'worker' });
  server = createServer(createWorkerHandler(service)); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  worker = fork(new URL('./worker-process.mjs', import.meta.url), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const receive = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('External worker process did not return a receipt.')); }, 15_000);
    const handler = message => { cleanup(); message.type === 'error' ? reject(new Error(`${message.code}: ${message.message}`)) : resolve(message); };
    const ended = () => { cleanup(); reject(new Error('External worker process exited.')); };
    function cleanup() { clearTimeout(timer); worker.off('message', handler); worker.off('exit', ended); }
    worker.once('message', handler); worker.once('exit', ended);
  });
  let pending = receive(); worker.send({ type: 'connect', origin: `http://127.0.0.1:${server.address().port}`, token: issued.credential.token });
  assert.equal((await pending).type, 'connected');
  const review = await service.review(sessionId, plan.projectId, 'order');
  await command('approve_order', { orderId: 'order', reviewDigest: review.reviewDigest });
  const queued = await execute('commerce_network_dispatch', { projectId: plan.projectId, expectedRevision: state().revision, requestId: 'native-dispatch', orderId: 'order' });
  assert.equal(queued.commerceNetwork.workOrders[0].status, 'queued');
  pending = receive(); worker.send({ type: 'execute' }); const delivered = await pending;
  assert.equal(delivered.type, 'delivered'); assert.equal(delivered.result.order.status, 'delivered');
  assert.equal(delivered.result.deliverable.sha256, createHash('sha256').update(delivered.content).digest('hex'));
  await command('accept_delivery', { orderId: 'order' });
  const accepted = await execute('commerce_network_read', { projectId: plan.projectId });
  assert.equal(accepted.commerceNetwork.workOrders[0].status, 'accepted');
  assert.equal(accepted.deliverables[0].content, delivered.content);
  console.log(JSON.stringify({ ok: true, officialToolRuntime: true, nativePluginLoaded: true, independentProcessGateway: true, actualStoredBytes: true, ownerAcceptance: true, modelCalls: 0, records: 'explicit-synthetic-fixtures', scope: 'Official Cordis+ToolRuntime with fixture session/registry, real SQLite, HTTP and external worker process. Separate live Host/browser acceptance is required.' }, null, 2));
} finally {
  worker?.kill(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await ctx?.fiber.dispose(); await rm(root, { recursive: true, force: true });
}
