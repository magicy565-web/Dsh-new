// Trusted Host assembly, not an OMP loader or a permission registry.
import { createMedusaCatalogBackend } from './backend.mjs';
export function createMedusaBackendModule({ ApiError, ...dependencies } = {}) {
  const raw = createMedusaCatalogBackend({ ApiError }).createMedusaCatalogService(dependencies);
  const lifetime = new AbortController(), pending = new Set();
  let closing;
  const live = () => { if (lifetime.signal.aborted) throw new ApiError(503, 'MEDUSA_MODULE_STOPPED', 'The Medusa module is stopped. Reconcile any uncertain write before retrying.'); };
  const sync = method => (...args) => { live(); return raw[method](...args); };
  const asyncCall = (method, args, signal) => {
    live();
    const combined = signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal;
    combined.throwIfAborted();
    const operation = (async () => {
      try { const result = await raw[method](...args, combined); live(); combined.throwIfAborted(); return result; }
      catch (error) { live(); throw error; }
    })();
    pending.add(operation);
    operation.then(() => pending.delete(operation), () => pending.delete(operation));
    return operation;
  };
  const service = Object.freeze({ status: sync('status'), preview: sync('preview'),
    reconcile: (id, actor, signal) => asyncCall('reconcile', [id, actor], signal),
    saveDraft: (id, body, actor, signal) => asyncCall('saveDraft', [id, body, actor], signal) });
  async function handle({ req, res, pathname, context, body, respond }) {
    const method = req.method;
    const status = method === 'GET' && pathname === '/api/medusa/catalog/status';
    const read = method === 'GET' && pathname.match(/^\/api\/medusa\/products\/([a-f0-9-]{36})\/(preview|remote)$/iu);
    const write = method === 'POST' && pathname.match(/^\/api\/medusa\/products\/([a-f0-9-]{36})\/draft$/iu);
    if (!status && !read && !write) return false;
    // Host must call after authentication, and after signed body checks for POST.
    const request = new AbortController();
    const aborted = () => request.abort();
    const disconnected = () => { if (!res.writableFinished) request.abort(); };
    req.once('aborted', aborted); res.once('close', disconnected);
    try {
      if (req.aborted || res.destroyed) request.abort();
      request.signal.throwIfAborted();
      let result;
      if (status) {
        if (!['admin', 'operator'].includes(context.role)) throw new ApiError(403, 'MEDUSA_ROLE_REQUIRED', 'Enterprise owner access is required.');
        result = { medusa: service.status() };
      } else if (read) result = read[2] === 'preview' ? service.preview(read[1], context) : await service.reconcile(read[1], context, request.signal);
      else result = await service.saveDraft(write[1], body, context, request.signal);
      live(); request.signal.throwIfAborted();
      await respond(res, 200, result);
      return true;
    } finally { req.off('aborted', aborted); res.off('close', disconnected); }
  }
  return Object.freeze({ service, handle,
    close() {
      if (!closing) {
        lifetime.abort();
        closing = Promise.allSettled([...pending]).then(() => undefined);
      }
      return closing;
    },
  });
}
