import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { ProviderError } from './provider.mjs';

const fail = (code, message) => new ProviderError(code, message);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const validId = value => typeof value === 'string' && ID.test(value);

/** Import same-install supported native exports; never execute an arbitrary worker command. */
export async function loadNativeWorkerModules(packagePath) {
  if (typeof packagePath !== 'string' || !path.isAbsolute(packagePath) || path.basename(packagePath) !== 'package.json') throw fail('WORKER_SETUP', 'A reviewed built native worker package is required.');
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
  if (manifest.name !== '@deepseek-ai/dsh-experimental-muse-worker' || manifest.version !== '0.2.0-rc.2') throw fail('WORKER_SETUP', 'The reviewed native worker package version is required.');
  const require = createRequire(packagePath);
  const engine = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-experimental-muse-worker/multi-engine')).href);
  const gateway = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-experimental-muse-worker/multi-gateway')).href);
  if (typeof engine.MultiWorkerEngine?.open !== 'function' || typeof gateway.createMultiWorkerGateway !== 'function') throw fail('WORKER_SETUP', 'The built native worker exports are unavailable.');
  return { MultiWorkerEngine: engine.MultiWorkerEngine, createMultiWorkerGateway: gateway.createMultiWorkerGateway };
}

/**
 * Disabled by default. This is a separate local native control plane, not the
 * SDK profile's in-process worker service and not an external executor.
 * Only reviewed server-side configuration and a host identity verifier can enable it.
 */
export function createWorkerProvider({ enabled = false, packagePath, configuration, verifyIdentity,
  loadModules = loadNativeWorkerModules } = {}) {
  let policy;
  if (enabled) {
    if (!fields(configuration, ['operatorId', 'statePath', 'workflows', 'operatorEnrollments', 'leaseMs', 'requestMaxBytes', 'responseMaxBytes'])
      || typeof configuration.operatorId !== 'string' || !configuration.operatorId.trim()
      || typeof configuration.statePath !== 'string' || !path.isAbsolute(configuration.statePath)
      || !record(configuration.workflows) || !Object.keys(configuration.workflows).length
      || !Array.isArray(configuration.operatorEnrollments)
      || typeof verifyIdentity !== 'function'
      || typeof packagePath !== 'string' || !path.isAbsolute(packagePath)) {
      throw fail('WORKER_SETUP', 'Enabling native workers requires a reviewed catalog, private state path, package, and host-supplied identity verifier.');
    }
    policy = structuredClone(configuration);
    for (const key of ['leaseMs', 'requestMaxBytes', 'responseMaxBytes']) if (!Number.isSafeInteger(policy[key]) || policy[key] < 1) throw fail('WORKER_SETUP', 'Native worker bounds must be explicit positive integers.');
  }
  let initializing;
  let closed = false;
  let started = false;
  let startupFailed = false;
  let closing;
  const principal = policy ? Object.freeze({ role: 'orchestrator', subject: policy.operatorId }) : null;
  const assertOpen = () => {
    if (!enabled) throw fail('WORKER_SETUP_REQUIRED', 'Native workers are disabled. Configure a reviewed catalog and verified worker gateway in the host before submitting.');
    if (closed) throw fail('WORKER_CLOSED', 'The native worker adapter is closed.');
  };
  async function ready() {
    assertOpen();
    initializing ??= (async () => {
      try {
        const modules = await loadModules(packagePath);
        assertOpen();
        const engine = await modules.MultiWorkerEngine.open({ statePath: policy.statePath,
          workflows: policy.workflows, operatorEnrollments: policy.operatorEnrollments, leaseMs: policy.leaseMs });
        // Always retain an opened engine for close(), including a racing shutdown.
        started = true;
        let gateway;
        try { gateway = modules.createMultiWorkerGateway({ engine, enabled: true,
          requestMaxBytes: policy.requestMaxBytes, responseMaxBytes: policy.responseMaxBytes, verifyIdentity }); }
        catch (error) { await engine.close(); throw error; }
        return { engine, gateway };
      } catch {
        startupFailed = true;
        throw fail('WORKER_SETUP', 'The native worker package or reviewed configuration could not initialize. No remote executor was started.');
      }
    })();
    const result = await initializing;
    assertOpen();
    return result;
  }
  async function operation(fn, signal) {
    if (signal?.aborted) throw fail('CANCELLED', 'The worker operation was stopped.');
    const { engine } = await ready();
    if (signal?.aborted) throw fail('CANCELLED', 'The worker operation was stopped.');
    try { return await fn(engine); }
    catch (error) {
      const codes = { forbidden: 'WORKER_FORBIDDEN', invalid: 'WORKER_INVALID', conflict: 'WORKER_CONFLICT', stale_attempt: 'WORKER_STALE', store: 'WORKER_STORE', closed: 'WORKER_CLOSED' };
      throw fail(codes[error?.code] || 'WORKER_ERROR', 'The native worker operation was not accepted. Review its current local state before retrying.');
    }
  }
  return {
    configured: enabled,
    kind: 'native-multi-worker',
    status() { return { configured: enabled, kind: 'native-multi-worker',
      status: closed ? 'closed' : !enabled ? 'setup_required' : startupFailed ? 'blocked' : started ? 'ready' : 'configured',
      taskKeys: policy ? Object.keys(policy.workflows) : [],
      capabilities: ['native-dag', 'native-credit-accounting', 'native-lease-fencing', 'verified-worker-gateway'],
      limitations: ['No external executor, listener, credentials, cron, payment, or deployment is created.',
        'This optional local control plane is separate from the SDK profile worker service; it must use its own state path.',
        'Task text comes only from the reviewed server catalog. Results remain untrusted; cancellation requires worker acknowledgment.'] }; },
    async submit(request, signal) {
      assertOpen();
      if (!fields(request, ['taskKey', 'jobId', 'idempotencyKey', 'deadlineAt'])
        || !validId(request.jobId) || !validId(request.idempotencyKey) || !validId(request.taskKey)
        || !Number.isSafeInteger(request.deadlineAt) || request.deadlineAt <= Date.now()
        || !Object.hasOwn(policy.workflows, request.taskKey)) throw fail('WORKER_UNAPPROVED_TASK', 'Choose an exact approved task key and stable job identities.');
      const workflow = policy.workflows[request.taskKey];
      return operation(engine => engine.submit(principal, { ...request, kind: 'public_research',
        query: workflow.query, acceptance: workflow.acceptance }), signal);
    },
    get(jobId, signal) {
      if (!validId(jobId)) return Promise.reject(fail('WORKER_INVALID', 'The worker job identity is invalid.'));
      return operation(engine => engine.get(principal, jobId), signal);
    },
    async result(jobId, signal) {
      const job = await this.get(jobId, signal);
      return job ? { ...job, independentlyVerified: false } : undefined;
    },
    cancel(jobId, signal) {
      if (!validId(jobId)) return Promise.reject(fail('WORKER_INVALID', 'The worker job identity is invalid.'));
      return operation(engine => engine.cancel(principal, jobId), signal);
    },
    async gateway(request) {
      if (!enabled) return Response.json({ error: 'disabled' }, { status: 503 });
      // The real native gateway independently verifies every request and its ownership.
      try { return await (await ready()).gateway(request); }
      catch { return Response.json({ error: 'unavailable' }, { status: 503 }); }
    },
    close() {
      closed = true;
      closing ??= (async () => {
        if (!initializing) return;
        let value;
        try { value = await initializing; } catch { return; }
        try { await value.engine.close(); }
        catch { throw fail('WORKER_SHUTDOWN', 'The native worker store did not confirm shutdown. Do not remove its ownership lock.'); }
      })();
      return closing;
    },
  };
}

/** Adapter for Workspace's existing exact-action approval registry; no new HTTP routes. */
export function createNativeWorkerConnectorAdapter({ workerProvider }) {
  if (!workerProvider || workerProvider.configured !== true) throw fail('WORKER_SETUP_REQUIRED', 'An explicitly configured native worker provider is required.');
  return {
    capabilities: ['submit', 'status', 'result', 'cancel'],
    credentialEnvNames: [],
    async execute({ action, resource, payload = {}, signal, idempotencyKey }) {
      if (signal?.aborted) throw fail('CANCELLED', 'The approved worker action was stopped.');
      if (action === 'submit') {
        if (!fields(payload, ['taskKey', 'jobId', 'deadlineAt']) || resource !== payload.taskKey || !validId(idempotencyKey)) {
          throw fail('WORKER_UNAPPROVED_TASK', 'The approved worker resource and task must match exactly.');
        }
        return workerProvider.submit({ ...payload, idempotencyKey }, signal);
      }
      if (!['status', 'result', 'cancel'].includes(action) || !fields(payload, ['jobId'])
        || !validId(resource) || (payload.jobId !== undefined && payload.jobId !== resource)) {
        throw fail('WORKER_INVALID', 'The approved worker resource must identify the exact job.');
      }
      const method = action === 'status' ? 'get' : action;
      return await workerProvider[method](resource, signal) ?? { jobId: resource, state: 'not_found', independentlyVerified: false };
    },
  };
}
