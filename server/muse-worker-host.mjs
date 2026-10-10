import { createDotWorkerBridge } from './dot-worker-bridge.mjs';
import { createMuseWorkerHandler, MuseWorkerError } from './muse-worker-api.mjs';

/**
 * Attach Muse to services already owned by a Workspace host. This factory opens
 * no store, artifact directory, listener, timer or execution runtime. The host
 * registers adapter before constructing its WorkerDesk and mounts handle before
 * employee authentication. It remains responsible for persistence and ingress.
 */
export function createMuseWorkerHost({ store, artifacts, config, workerAdapters = {},
  dotWorkerConfig = null, readBody, respond } = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new TypeError('Muse host requires an explicit server configuration.');
  const workerId = config.workerId || 'muse-personal-owner';
  if (Object.hasOwn(workerAdapters, workerId) ||
      (dotWorkerConfig && workerId === (dotWorkerConfig.workerId || 'chatgpt-dot-xy')))
    throw new TypeError('Muse and Dot worker identities must be distinct.');
  if (dotWorkerConfig?.tokenDigest && config.tokenDigest === dotWorkerConfig.tokenDigest)
    throw new TypeError('Muse and Dot must never share a Bearer credential.');

  const bridge = createDotWorkerBridge({ store, artifacts, agentKind: 'muse', workerId,
    ownerId: config.ownerId || 'personal', enabled: config.enabled === true,
    scopeReviewed: config.scopeReviewed === true,
    externalBudgetVerified: config.externalBudgetVerified === true });
  const rest = createMuseWorkerHandler({ bridge, tokenDigest: config.tokenDigest, readBody, respond });
  const pending = new Set();
  let stopping = false, closing;
  function run(callback) {
    if (stopping)
      return Promise.reject(new MuseWorkerError(503, 'MW_GATEWAY_CLOSED', 'The Muse gateway is unloading.'));
    const task = Promise.resolve().then(callback);
    pending.add(task);
    void task.finally(() => pending.delete(task)).catch(() => {});
    return task;
  }
  const adapter = { ...bridge.adapter,
    get ready() { return !stopping && bridge.adapter.ready; },
    get budgetEnforced() { return !stopping && bridge.adapter.budgetEnforced; },
  };
  for (const name of ['submit', 'get', 'cancel', 'reconcile'])
    adapter[name] = (...args) => run(() => bridge.adapter[name](...args));

  return Object.freeze({ workerId, bridge, adapter: Object.freeze(adapter),
    async handle(req, res, pathname = new URL(req.url, 'http://localhost').pathname) {
      // Returning false lets the original host keep all unrelated routes. The
      // Muse hostname must separately deny them at its trusted TLS ingress.
      pathname = pathname.replace(/\/$/, '') || '/';
      if (pathname !== '/api/muse-worker' && !pathname.startsWith('/api/muse-worker/')) return false;
      await run(() => rest(req, res, pathname));
      return true;
    },
    close() {
      if (closing) return closing;
      // Fence admission synchronously. Drain already accepted operations before
      // the parent closes artifacts/store; never cancel or replay native work.
      stopping = true;
      closing = Promise.allSettled([...pending]).then(() => undefined);
      return closing;
    },
  });
}
