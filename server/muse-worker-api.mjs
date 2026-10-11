import { createDotWorkerAuth, DotWorkerError } from './dot-worker-bridge.mjs';

/**
 * Dedicated REST transport for a single, explicitly enrolled personal Muse.
 * Reuses the reviewed pull-worker state machine; it does not start/impersonate Muse.
 * The authenticated principal is fixed by server configuration, never client input.
 */
export class MuseWorkerError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const asMuseError = error => {
  // Preserve the host's safe JSON/body validation semantics under Muse's
  // public error namespace, without exposing unexpected internal failures.
  if (['JSON_REQUIRED', 'INVALID_JSON', 'BODY_TOO_LARGE'].includes(error?.code) &&
      Number.isSafeInteger(error?.status))
    return new MuseWorkerError(error.status, 'MW_' + error.code, error.message);
  if (!(error instanceof DotWorkerError)) return error;
  const suffix = error.code.replace(/^STALE_DOT_/, 'STALE_').replace(/^DOT_/, '');
  return new MuseWorkerError(error.status, error.code.startsWith('MW_') ? error.code : 'MW_' + suffix,
    error.message.replace(/\b[Dd]ot\b/g, 'Worker'));
};

/**
 * Independent bounded, per-process rate limits. Valid for the single-writer
 * Node host only; a future multi-host setup requires a shared rate-limit store.
 */
export function createMuseWorkerHandler({ bridge, tokenDigest, readBody, respond,
  limits = { read: 120, write: 30, upload: 10 } } = {}) {
  if (!bridge || typeof readBody !== 'function' || typeof respond !== 'function')
    throw new TypeError('Muse REST gateway requires a durable bridge and host HTTP helpers.');
  const authorize = createDotWorkerAuth({ tokenDigest });
  if (!authorize) throw new TypeError('Muse REST gateway requires a reviewed SHA-256 Bearer token digest.');
  for (const key of ['read', 'write', 'upload'])
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > 1000)
      throw new TypeError('Muse REST gateway needs bounded positive rate limits.');
  const windows = new Map();
  function rateLimit(kind) {
    const now = Date.now();
    const slot = windows.get(kind);
    const current = !slot || now >= slot.start + 60_000 ? { start: now, count: 0 } : slot;
    if (current.count >= limits[kind])
      throw new MuseWorkerError(429, 'MW_RATE_LIMIT', 'This Worker API rate limit has been reached; retry in the next minute.');
    current.count++;
    windows.set(kind, current);
  }
  // Enforce the published OpenAPI additionalProperties:false rule for each
  // mutation. Unknown fields are rejected, not silently ignored by destructuring.
  const acceptedFields = Object.freeze({
    claim: ['requestId'],
    heartbeat: ['attemptId', 'fence', 'requestId'],
    'upload-file': ['attemptId', 'fence', 'uploadId', 'filename', 'base64', 'sha256'],
    'submit-result': ['attemptId', 'fence', 'requestId', 'summary', 'sources', 'toolEvidence', 'evidenceNote'],
    'report-blocked': ['attemptId', 'fence', 'requestId', 'message'],
    'confirm-stop': ['attemptId', 'fence', 'requestId'],
  });
  const base = '/api/muse-worker/v1';
  return async (req, res, pathname) => {
    try {
      // Reject all missing/incorrect credentials (including Dot's) before routes
      // reveal work order existence or state.
      authorize(req);
      const method = req.method;
      const uploadRoute = method === 'POST' && pathname.endsWith('/upload-file');
      rateLimit(method === 'GET' ? 'read' : uploadRoute ? 'upload' : 'write');
      if (method === 'GET' && pathname === base + '/identity') {
        await bridge.recordSeen();
        return respond(res, 200, bridge.identity());
      }
      if (method === 'GET' && pathname === base + '/inbox') {
        await bridge.recordSeen();
        return respond(res, 200, bridge.inbox());
      }
      const eventMatch = pathname.match(/^\/api\/muse-worker\/v1\/tasks\/([^/]+)\/events\/([^/]+)\/ack$/);
      if (eventMatch && method === 'POST') {
        const body = await readBody(req, 2_000);
        if (Object.keys(body).length) throw new MuseWorkerError(400, 'MW_INPUT_INVALID', 'Event acknowledgment body must be empty.');
        return respond(res, 200, await bridge.ackEvent({ taskRef: eventMatch[1], eventId: eventMatch[2] }));
      }
      const match = pathname.match(/^\/api\/muse-worker\/v1\/tasks\/([^/]+)(?:\/(claim|status|heartbeat|upload-file|submit-result|report-blocked|confirm-stop))?$/);
      if (!match) throw new MuseWorkerError(404, 'MW_ROUTE_NOT_FOUND', 'The Muse Worker API path does not exist.');
      const [, taskRef, op] = match;
      if (method === 'GET' && !op) return respond(res, 200, bridge.readTask(taskRef));
      if (method === 'GET' && op === 'status') return respond(res, 200, bridge.status(taskRef));
      if (method !== 'POST' || !op || op === 'status')
        throw new MuseWorkerError(405, 'MW_METHOD_NOT_ALLOWED', 'Unsupported Worker action method.');
      const body = await readBody(req, op === 'upload-file' ? 1_600_000 : 30_000);
      const allowed = acceptedFields[op];
      if (!allowed || Object.keys(body).some(key => !allowed.includes(key)))
        throw new MuseWorkerError(400, 'MW_INPUT_INVALID', 'Unsupported field for this Muse Worker action.');
      const args = { ...body, taskRef };
      if (op === 'claim') return respond(res, 200, await bridge.claimTask(args));
      if (op === 'heartbeat') return respond(res, 200, await bridge.heartbeat(args));
      if (op === 'upload-file') return respond(res, 201, await bridge.uploadFile(args));
      if (op === 'submit-result') return respond(res, 200, await bridge.submitResult(args));
      if (op === 'report-blocked') return respond(res, 200, await bridge.reportBlocked(args));
      if (op === 'confirm-stop') return respond(res, 200, await bridge.confirmStop(args));
      throw new MuseWorkerError(404, 'MW_ROUTE_NOT_FOUND', 'Unsupported Muse Worker action.');
    } catch (error) {
      throw asMuseError(error);
    }
  };
}
