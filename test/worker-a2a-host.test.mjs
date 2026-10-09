import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadReviewedA2AWorkers } from '../server/worker-a2a-host.mjs';
import { openStore } from '../server/store.mjs';
import { createWorkerServiceDesk } from '../server/worker-desk.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const endpoint = 'https://trusted-worker.example/rpc';
const card = {
  name: 'Reviewed Remote Research', supportedInterfaces: [{
    url: endpoint, protocolBinding: 'JSONRPC', protocolVersion: '1.0.0',
  }],
  provider: { organization: 'Reviewed Partner', url: 'https://trusted-worker.example' },
  version: '1.0.0', capabilities: { streaming: false, extendedAgentCard: false, pushNotifications: false },
  securitySchemes: {}, securityRequirements: [], defaultInputModes: ['text'],
  defaultOutputModes: ['text'], skills: [], signatures: [],
};
async function writePinned(dir, filename, value) {
  const content = JSON.stringify(value);
  const full = path.join(dir, filename);
  await writeFile(full, content, { mode: 0o600 });
  await chmod(full, 0o600);
  return { file: full, sha: hash(content) };
}
async function setup(t, overrides = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'reviewed-a2a-host-'));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const savedCard = await writePinned(dir, 'agent-card.json', card);
  const worker = {
    id: 'trusted-worker', name: 'Reviewed Distributor Research',
    serviceIds: ['buyer-discovery'], endpoint, enabled: true,
    agentCardFile: savedCard.file, agentCardSha256: savedCard.sha,
    tokenEnv: 'WORKSPACE_WORKER_RESEARCH_TOKEN',
    review: {
      partnerVerifiedRef: 'review-identity-001',
      budgetHardCapVerifiedRef: 'review-account-limit-001',
      reviewedBy: 'admin-operator',
    }, ...overrides,
  };
  const registry = await writePinned(dir, 'worker-registry.json', { version: 1, workers: [worker] });
  return {
    dir, worker,
    environment: {
      WORKSPACE_A2A_REGISTRY_FILE: registry.file,
      WORKSPACE_A2A_REGISTRY_SHA256: registry.sha,
      WORKSPACE_WORKER_RESEARCH_TOKEN: 'simulated-private-token-12345',
    },
  };
}

test('no registry has no SDK import, third-party code or network activity', async () => {
  const host = await loadReviewedA2AWorkers({
    environment: {},
    sdkLoader: () => { throw new Error('SDK must not load'); },
  });
  assert.equal(host.status.configured, false);
  assert.deepEqual(host.adapters, {});
});

test('disabled entries require neither tokens nor SDK activation', async t => {
  const { dir, worker } = await setup(t);
  const registry = await writePinned(dir, 'disabled.json', { version: 1, workers: [{ ...worker, enabled: false }] });
  const host = await loadReviewedA2AWorkers({
    environment: { WORKSPACE_A2A_REGISTRY_FILE: registry.file, WORKSPACE_A2A_REGISTRY_SHA256: registry.sha },
    sdkLoader: () => { throw new Error('SDK must not load'); },
  });
  assert.equal(host.status.connections, 0);
});

test('tampered pins, unauthorized environment secrets and private services fail closed', async t => {
  const { dir, worker, environment } = await setup(t);
  await assert.rejects(loadReviewedA2AWorkers({
    environment: { ...environment, WORKSPACE_A2A_REGISTRY_SHA256: '0'.repeat(64) },
    sdkLoader: () => { throw new Error('SDK must not load'); },
  }), { code: 'WORKER_A2A_SETUP' });
  for (const patch of [
    { serviceIds: ['rfq-recovery'] },
    { tokenEnv: 'GITHUB_TOKEN' },
    { endpoint: 'https://localhost/internal' },
    { agentCardSha256: '0'.repeat(64) },
    { review: { partnerVerifiedRef: 'x', budgetHardCapVerifiedRef: 'x', reviewedBy: 'x' } },
  ]) {
    const registry = await writePinned(dir, 'rejected-' + Math.random().toString(36).slice(2) + '.json', { version: 1, workers: [{ ...worker, ...patch }] });
    await assert.rejects(loadReviewedA2AWorkers({
      environment: {
        ...environment,
        WORKSPACE_A2A_REGISTRY_FILE: registry.file,
        WORKSPACE_A2A_REGISTRY_SHA256: registry.sha,
      },
      sdkLoader: () => { throw new Error('SDK must not load'); },
    }), { code: 'WORKER_A2A_SETUP' });
  }
});

test('authenticated official SDK client plugs into complete business order through review', async t => {
  const { dir, environment } = await setup(t);
  const calls = [];
  let remoteOrderId = null;
  const sdk = {
    JsonRpcTransportFactory: class {
      constructor(options) { assert.equal(typeof options.fetchImpl, 'function'); this.protocolName = 'JSONRPC'; this.options = options; }
    },
    ClientFactory: class {
      constructor(options) {
        assert.equal(options.clientConfig.polling, true);
        assert.deepEqual(options.preferredTransports, ['JSONRPC']);
        assert.equal(options.transports.length, 1);
        assert.equal(options.transports[0].protocolName, 'JSONRPC');
      }
      async createFromAgentCard(value) {
        assert.equal(value.name, card.name);
        return {
          async sendMessage(message, options) {
            calls.push({ method: 'send', options });
            remoteOrderId = JSON.parse(message.message.parts[0].text).orderId;
            return { id: 'verified-job-001', status: { state: 'TASK_STATE_WORKING' } };
          },
          async getTask({ id }, options) {
            calls.push({ method: 'get', options });
            return {
              id, status: { state: 'TASK_STATE_COMPLETED' },
              artifacts: [{ parts: [{ data: {
                schema: 'workspace.worker.delivery.v1', orderId: remoteOrderId, costCredits: 3,
                deliverables: [{ name: 'Distributor shortlist', type: 'table', summary: 'Sourced candidate records' }],
                prospects: [{ name: 'Buyer Example', country: 'United States', website: 'https://buyer.example.com', fitReason: 'Relevant wholesale textile catalog', sourceUrl: 'https://buyer.example.com/about' }],
                evidence: [{ title: 'Public company profile', url: 'https://example.com/source', detail: 'Source fixture' }],
              } }] }],
            };
          },
          async cancelTask({ id }, options) {
            calls.push({ method: 'cancel', options });
            return { id, status: { state: 'TASK_STATE_CANCELED' } };
          },
        };
      }
    }
  };
  const host = await loadReviewedA2AWorkers({ environment, sdkLoader: async () => sdk });
  assert.equal(host.status.connections, 1);
  assert.equal(host.adapters['trusted-worker'].ready, true);
  const store = await openStore(path.join(dir, 'orders'));
  const desk = createWorkerServiceDesk({ store, adapters: host.adapters });
  const { order } = await desk.create({
    serviceId: 'buyer-discovery', product: 'Textile materials', market: 'US',
    objective: 'Find US wholesale distributors with evidence',
    budgetCredits: 20, requestId: 'reviewed-worker-test',
    deadlineAt: new Date(Date.now() + 86400000 * 7).toISOString(),
    publicDataConfirmed: true,
  }, 'operator');
  await desk.approve(order.id, 'admin', { confirmed: true, workerId: 'trusted-worker' });
  const dispatched = await desk.dispatch(order.id);
  assert.equal(dispatched.order.remoteJobId, 'verified-job-001');
  const checked = await desk.refresh(order.id);
  assert.equal(checked.order.status, 'review_required');
  assert.equal(checked.order.reportedCostCredits, 3);
  assert.equal(checked.order.workerReport.prospects.length, 1);
  assert.equal(checked.order.workerReport.prospects[0].independentlyVerified, false);
  assert.equal(checked.order.workerReport.independentlyVerified, false);
  assert.equal((await desk.accept(order.id, 'admin', { confirmed: true })).order.status, 'accepted');
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.options.serviceParameters.Authorization, 'Bearer simulated-private-token-12345');
    assert.ok(call.options.signal instanceof AbortSignal);
  }
  await store.close();
  await host.close();
});
