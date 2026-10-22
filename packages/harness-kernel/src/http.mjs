// Route registry + `node:http` server for the Workspace Harness kernel.
//
// Routes support static paths and one-segment `:param` patterns (CONTRACT.md §4):
//   - static routes always win over parameterised ones;
//   - `:param` matches exactly one non-empty path segment and is percent-decoded;
//   - malformed percent-encoding is a 400 JSON response (never a 500);
//   - two parameterised patterns that can match the same concrete path are a
//     startup failure (conflict), e.g. `/leads/:id` vs `/leads/:leadId`.
import { createServer } from 'node:http';
import { ERROR, HarnessError } from '../../harness-contracts/src/index.mjs';
import { parseRoutePath } from './resolve.mjs';

/** Kernel-local error codes that are not part of the frozen contracts vocabulary. */
export const HTTP_ERROR = Object.freeze({
  routeNotFound: 'HARNESS_ROUTE_NOT_FOUND',
  invalidPath: 'HARNESS_HTTP_INVALID_PATH',
  invalidBody: 'HARNESS_HTTP_INVALID_BODY',
  internal: 'HARNESS_HTTP_INTERNAL',
  methodNotAllowed: 'HARNESS_HTTP_METHOD_NOT_ALLOWED',
});

/**
 * HarnessError code → HTTP status. The contract only says "corresponding
 * error.code/status"; this table is the kernel's frozen mapping (documented in the
 * package README). Unknown HarnessError codes fail closed to 500.
 */
export const ERROR_STATUS = Object.freeze({
  [ERROR.manifestInvalid]: 400,
  [ERROR.compositionInvalid]: 400,
  [ERROR.pluginDuplicate]: 409,
  [ERROR.pluginMissingDependency]: 500,
  [ERROR.pluginFailed]: 500,
  [ERROR.toolInvalid]: 400,
  [ERROR.toolDuplicate]: 409,
  [ERROR.toolRefused]: 403,
  [ERROR.approvalRequired]: 403,
  [ERROR.approvalRefused]: 403,
  [ERROR.storageInvalid]: 500,
  [ERROR.workspaceInvalid]: 400,
  [ERROR.workspaceForbidden]: 403,
  [HTTP_ERROR.routeNotFound]: 404,
  [HTTP_ERROR.invalidPath]: 400,
  [HTTP_ERROR.invalidBody]: 400,
  [HTTP_ERROR.methodNotAllowed]: 405,
  [HTTP_ERROR.internal]: 500,
});

export const DEFAULT_ACTOR = Object.freeze({
  subject: 'local-operator',
  role: 'admin',
  workspaceId: 'local',
});

const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const MAX_BODY_BYTES = 1024 * 1024;
const KERNEL_PLUGIN_ID = '__kernel__';

/** Map an incoming HarnessError code to an HTTP status (allows explicit `error.status`). */
export function statusForError(error) {
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599) return error.status;
  return ERROR_STATUS[error?.code] ?? 500;
}

/** Derive the P0 simulated actor from request headers (fail-safe local defaults). */
export function actorFromHeaders(headers = {}) {
  const pick = name => {
    const value = headers[name] ?? headers[name.toLowerCase()];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };
  return {
    subject: pick('x-harness-actor') ?? DEFAULT_ACTOR.subject,
    role: pick('x-harness-role') ?? DEFAULT_ACTOR.role,
    workspaceId: pick('x-harness-workspace') ?? DEFAULT_ACTOR.workspaceId,
  };
}

function queryObject(url) {
  const query = {};
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(query, key)) {
      query[key] = [].concat(query[key], value);
    } else {
      query[key] = value;
    }
  }
  return query;
}

function normalizeAddress(raw) {
  if (!raw || typeof raw === 'string') {
    const value = typeof raw === 'string' ? raw : '127.0.0.1';
    return { address: value, host: value, port: null, url: typeof raw === 'string' ? raw : null };
  }
  const host = raw.address;
  const printable = host.includes(':') ? `[${host}]` : host;
  // `address`/`family` mirror `server.address()`; `host`/`url` are conveniences.
  return { address: host, host, family: raw.family, port: raw.port, url: `http://${printable}:${raw.port}` };
}

function canOverlap(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    const paramA = a.startsWith(':');
    const paramB = b.startsWith(':');
    if (!paramA && !paramB && a !== b) return false;
  }
  return true;
}

function describeParams(segments) {
  return segments.filter(segment => segment.startsWith(':')).map(segment => segment.slice(1));
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_BODY_BYTES)
        throw new HarnessError(HTTP_ERROR.invalidBody, `request body exceeds ${MAX_BODY_BYTES} bytes.`);
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    throw new HarnessError(HTTP_ERROR.invalidBody, `cannot read request body: ${error?.message ?? error}`);
  }
  if (!chunks.length) return undefined;
  const text = Buffer.concat(chunks).toString('utf8');
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  if (contentType.includes('json') || /^\s*[[{]/u.test(text)) {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new HarnessError(HTTP_ERROR.invalidBody, `request body is not valid JSON: ${error?.message ?? error}`);
    }
  }
  return text;
}

/**
 * The HTTP side of the kernel: route/health registries, matching and the server.
 * `route()`/`health()` calls made while `beginPlugin()` is active are attributed to
 * that composition row, so unmounting (or rolling back) a plugin also removes its
 * routes and health checks.
 */
export class HttpKernel {
  constructor({ logger = console, getHealthz = () => ({ status: 'ok', plugins: [] }) } = {}) {
    this.logger = logger;
    this.getHealthz = getHealthz;
    this.server = null;
    this.address = null;
    this.stopping = false;
    this._records = new Map(); // `${method} ${path}` → record
    this._static = new Map(); // `${method} ${pathname}` → record
    this._param = []; // parameterised records, registration order
    this._checks = new Map(); // health name → record
    this._scope = [];
    this._actorResolver = null;
    this._registerKernelRoutes();
  }

  /** Install the authoritative actor resolver (session middleware); null clears it. */
  setActorResolver(resolver) {
    if (resolver !== null && typeof resolver !== 'function')
      throw new HarnessError(ERROR.pluginFailed ?? 'HARNESS_PLUGIN_FAILED', 'setActorResolver requires a function or null.');
    this._actorResolver = resolver;
    return () => { if (this._actorResolver === resolver) this._actorResolver = null; };
  }

  _registerKernelRoutes() {
    this.route({
      method: 'GET',
      path: '/healthz',
      handler: () => ({ status: 200, body: this.getHealthz() }),
      kernel: true,
    });
  }

  currentPlugin() {
    return this._scope.length ? this._scope[this._scope.length - 1] : KERNEL_PLUGIN_ID;
  }

  beginPlugin(id) {
    this._scope.push(String(id));
    return () => this.endPlugin(String(id));
  }

  endPlugin(id) {
    if (id === undefined) {
      this._scope.pop();
      return;
    }
    const index = this._scope.lastIndexOf(String(id));
    if (index >= 0) this._scope.splice(index, 1);
  }

  /** Register a route. Throws (startup failure) on duplicate or overlapping patterns. */
  route(definition) {
    const { method, path, handler, kernel = false } = definition ?? {};
    if (typeof method !== 'string' || !HTTP_METHODS.has(method.toUpperCase()))
      throw new HarnessError(
        ERROR.pluginFailed,
        `invalid route method ${JSON.stringify(method)} (expected one of ${[...HTTP_METHODS].join('/')}).`,
      );
    if (typeof handler !== 'function') throw new HarnessError(ERROR.pluginFailed, `route ${method} ${path} handler must be a function.`);
    const actualMethod = method.toUpperCase();
    const { segments, hasParams } = parseRoutePath(path);
    const pluginId = this.currentPlugin();
    const key = `${actualMethod} ${path}`;
    if (this._records.has(key)) {
      const existing = this._records.get(key);
      throw new HarnessError(
        ERROR.pluginFailed,
        `route conflict: ${actualMethod} ${path} is already registered by "${existing.pluginId}" (attempted by "${pluginId}").`,
        { method: actualMethod, path, pluginId },
      );
    }
    const record = { method: actualMethod, path, handler, pluginId, segments, hasParams, kernel, public: definition.public === true };
    if (hasParams) {
      for (const other of this._param) {
        if (other.method !== actualMethod) continue;
        if (!canOverlap(segments, other.segments)) continue;
        throw new HarnessError(
          ERROR.pluginFailed,
          `route conflict: ${actualMethod} ${path} (:${describeParams(segments).join('/:')}) overlaps ${actualMethod} ${other.path} (:${describeParams(other.segments).join('/:')}); two patterns can match the same concrete path.`,
          { method: actualMethod, path, otherPath: other.path },
        );
      }
      this._param.push(record);
    } else {
      this._static.set(key, record);
    }
    this._records.set(key, record);
    return () => {
      if (this._records.get(key) === record) this._records.delete(key);
      if (this._static.get(key) === record) this._static.delete(key);
      const index = this._param.indexOf(record);
      if (index >= 0) this._param.splice(index, 1);
    };
  }

  /** Register (or replace?) a health check; duplicates fail closed like routes. */
  health(name, fn) {
    if (typeof name !== 'string' || !name.trim())
      throw new HarnessError(ERROR.pluginFailed, 'health check name must be a non-empty string.');
    if (typeof fn !== 'function') throw new HarnessError(ERROR.pluginFailed, `health check "${name}" must be a function.`);
    if (this._checks.has(name)) {
      const existing = this._checks.get(name);
      throw new HarnessError(
        ERROR.pluginDuplicate,
        `health check "${name}" is already registered by "${existing.pluginId}" (attempted by "${this.currentPlugin()}").`,
      );
    }
    const record = { name, fn, pluginId: this.currentPlugin() };
    this._checks.set(name, record);
    return () => {
      if (this._checks.get(name) === record) this._checks.delete(name);
    };
  }

  /** Remove everything a plugin registered (routes + health checks). */
  removePlugin(id) {
    let removed = 0;
    for (const [key, record] of [...this._records]) {
      if (record.pluginId !== id || record.kernel) continue;
      this._records.delete(key);
      if (this._static.get(key) === record) this._static.delete(key);
      const index = this._param.indexOf(record);
      if (index >= 0) this._param.splice(index, 1);
      removed += 1;
    }
    for (const [name, record] of [...this._checks]) {
      if (record.pluginId !== id) continue;
      this._checks.delete(name);
      removed += 1;
    }
    return removed;
  }

  /** Case-sensitive exact-or-param match; static routes are consulted first. */
  match(method, pathname) {
    const actualMethod = method.toUpperCase();
    const staticRecord = this._static.get(`${actualMethod} ${pathname}`);
    if (staticRecord) return { record: staticRecord, params: {} };
    const segments = pathname.split('/');
    for (const record of this._param) {
      if (record.method !== actualMethod) continue;
      if (record.segments.length !== segments.length) continue;
      const params = {};
      let matched = true;
      for (let index = 0; index < segments.length; index += 1) {
        const pattern = record.segments[index];
        const actual = segments[index];
        if (!pattern.startsWith(':')) {
          if (pattern !== actual) {
            matched = false;
            break;
          }
          continue;
        }
        if (actual === '') {
          matched = false;
          break;
        }
        try {
          params[pattern.slice(1)] = decodeURIComponent(actual);
        } catch {
          throw new HarnessError(HTTP_ERROR.invalidPath, `malformed percent-encoding in request path ${JSON.stringify(pathname)}.`);
        }
      }
      if (matched) return { record, params };
    }
    return null;
  }

  routeList() {
    return [...this._records.values()].map(record => ({
      method: record.method,
      path: record.path,
      pluginId: record.pluginId,
      params: describeParams(record.segments),
    }));
  }

  healthChecks() {
    const checks = [];
    for (const record of this._checks.values()) {
      try {
        const result = record.fn();
        if (result && typeof result.then === 'function') {
          checks.push({ name: record.name, pluginId: record.pluginId, status: 'failed', detail: 'health check must be synchronous' });
          continue;
        }
        const status = ['ok', 'degraded', 'failed'].includes(result?.status) ? result.status : 'failed';
        const entry = { name: record.name, pluginId: record.pluginId, status };
        if (result?.detail !== undefined) entry.detail = result.detail;
        if (status !== 'ok' && entry.detail === undefined) entry.detail = 'health check did not report ok';
        checks.push(entry);
      } catch (error) {
        checks.push({ name: record.name, pluginId: record.pluginId, status: 'failed', detail: error?.message ?? String(error) });
      }
    }
    return checks;
  }

  sendJson(res, status, payload) {
    if (res.headersSent || res.writableEnded) {
      res.destroy?.();
      return;
    }
    let text;
    try {
      text = JSON.stringify(payload === undefined ? null : payload);
    } catch {
      text = JSON.stringify({ error: { code: HTTP_ERROR.internal, message: 'Response is not JSON serialisable.' } });
      status = 500;
    }
    const buffer = Buffer.from(text, 'utf8');
    res.statusCode = status;
    if (!res.hasHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('content-length', String(buffer.length));
    res.end(buffer);
  }

  respondError(res, error) {
    if (res.headersSent || res.writableEnded) {
      res.destroy?.();
      return;
    }
    if (error instanceof HarnessError) {
      const status = statusForError(error);
      const payload = { error: { code: error.code, message: error.message } };
      if (error.details !== undefined) payload.error.details = error.details;
      this.sendJson(res, status, payload);
      return;
    }
    this.logger?.error?.(`[harness-http] unhandled error: ${error?.stack ?? error}`);
    this.sendJson(res, 500, {
      error: { code: HTTP_ERROR.internal, message: 'Internal server error' },
    });
  }

  async respondResult(res, result) {
    if (result === undefined || result === null) {
      if (!res.headersSent && !res.writableEnded) {
        res.statusCode = 204;
        res.end();
      }
      return;
    }
    if (typeof Response !== 'undefined' && result instanceof Response) {
      if (res.headersSent || res.writableEnded) {
        res.destroy?.();
        return;
      }
      const body = result.body;
      res.statusCode = result.status;
      result.headers.forEach((value, key) => {
        if (!res.hasHeader(key)) res.setHeader(key, value);
      });
      if (body === null || result.status === 204 || result.status === 304) {
        res.setHeader('content-length', '0');
        res.end();
        return;
      }
      // Stream chunk by chunk: SSE and long-running responses must reach the
      // client before the producer finishes, so never buffer the whole body.
      const reader = body.getReader();
      let closed = false;
      const onClose = () => { closed = true; reader.cancel().catch(() => {}); };
      res.once('close', onClose);
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done || closed || res.destroyed || res.writableEnded) break;
          if (!res.write(Buffer.from(value))) {
            await new Promise(resolve => {
              const finish = () => { res.off('drain', finish); res.off('close', finish); resolve(); };
              res.once('drain', finish);
              res.once('close', finish);
            });
          }
        }
        if (!closed && !res.writableEnded) res.end();
      } catch {
        // Headers are already sent: the only honest signal left is to drop the
        // connection so the client sees a truncated stream, never a fake end.
        res.destroy?.();
      } finally {
        res.off('close', onClose);
        if (!closed) reader.cancel().catch(() => {});
      }
      return;
    }
    if (typeof result === 'object' && typeof result.status === 'number') {
      this.sendJson(res, result.status, result.body);
      return;
    }
    this.sendJson(res, 200, result);
  }

  async handle(req, res) {
    let url;
    try {
      url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    } catch {
      this.sendJson(res, 400, { error: { code: HTTP_ERROR.invalidPath, message: 'Invalid request URL.' } });
      return;
    }
    const method = (req.method ?? 'GET').toUpperCase();
    const pathname = url.pathname;
    // `/healthz` is exact and always wins (built-in static route checked first regardless).
    let match;
    try {
      match = this.match(method, pathname);
    } catch (error) {
      this.respondError(res, error);
      return;
    }
    if (!match) {
      this.sendJson(res, 404, {
        error: { code: HTTP_ERROR.routeNotFound, message: `No route for ${method} ${pathname}.` },
      });
      return;
    }
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      this.respondError(res, error);
      return;
    }
    let actor = actorFromHeaders(req.headers);
    if (this._actorResolver !== null) {
      // A session layer is installed: request headers are no longer authority.
      try { actor = await this._actorResolver(req); }
      catch { actor = null; }
      if (!actor && match.record.public !== true && match.record.kernel !== true) {
        this.sendJson(res, 401, {
          error: { code: 'HARNESS_UNAUTHENTICATED', message: 'Sign in to use this workspace.' },
        });
        return;
      }
    }
    const context = {
      method,
      pathname,
      query: queryObject(url),
      params: match.params,
      actor,
      body,
    };
    try {
      const result = await match.record.handler(req, res, context);
      await this.respondResult(res, result);
    } catch (error) {
      this.respondError(res, error);
    }
  }

  async start({ host = '127.0.0.1', port = 8790 } = {}) {
    if (this.server) return { server: this.server, address: this.address };
    if (this.stopping) throw new HarnessError(ERROR.pluginFailed, 'HTTP kernel has already been stopped.');
    if (typeof host !== 'string' || !host)
      throw new HarnessError(ERROR.compositionInvalid, 'composition.server.host must be a non-empty string.');
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new HarnessError(ERROR.compositionInvalid, `composition.server.port must be an integer 0-65535 (got ${port}).`);
    const server = createServer((req, res) => {
      this.handle(req, res).catch(error => {
        this.logger?.error?.(`[harness-http] request handler crashed: ${error?.stack ?? error}`);
        if (!res.headersSent) this.sendJson(res, 500, { error: { code: HTTP_ERROR.internal, message: 'Internal server error' } });
        else res.destroy?.();
      });
    });
    await new Promise((resolve, reject) => {
      const onError = error => {
        server.off('listening', onListening);
        reject(
          error?.code === 'EADDRINUSE'
            ? new HarnessError(ERROR.compositionInvalid, `cannot listen on ${host}:${port}: address already in use.`)
            : new HarnessError(ERROR.pluginFailed, `cannot listen on ${host}:${port}: ${error?.message ?? error}`),
        );
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      try {
        server.listen(port, host);
      } catch (error) {
        server.off('error', onError);
        server.off('listening', onListening);
        reject(new HarnessError(ERROR.pluginFailed, `cannot listen on ${host}:${port}: ${error?.message ?? error}`));
      }
    });
    this.server = server;
    this.address = normalizeAddress(server.address());
    return { server: this.server, address: this.address };
  }

  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    const server = this.server;
    this.server = null;
    this.address = null;
    if (!server) return;
    await new Promise(resolve => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      server.close(done);
      server.closeIdleConnections?.();
      // Do not let a hanging keep-alive socket block shutdown forever.
      setTimeout(() => {
        server.closeAllConnections?.();
        done();
      }, 2000).unref?.();
    });
  }
}
