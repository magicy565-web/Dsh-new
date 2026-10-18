import http from 'node:http';
import path from 'node:path';
import { constants, promises as fs } from 'node:fs';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { signWorkspaceRequest } from './auth-ingress.mjs';
import { validateAccessConfig } from './access.mjs';

// This process trusts ONLY the protected Unix socket and Caddy's overwritten
// username header. It is not an authenticator, credential store or account API.
const identityHeader = 'x-workspace-authenticated-user';
const methods = new Set(['GET', 'HEAD', 'POST', 'PATCH', 'DELETE']);
const emptyMethods = new Set(['GET', 'HEAD', 'DELETE']);
const forwardedHeaders = new Set([
  'accept', 'accept-encoding', 'accept-language', 'cache-control',
  'content-type', 'content-encoding', 'cookie', 'origin', 'referer',
  'user-agent', 'if-match', 'if-none-match', 'if-modified-since',
  'if-unmodified-since', 'if-range', 'range', 'last-event-id',
  'idempotency-key', 'x-csrf-token', 'x-workspace-login',
  'x-workspace-session', 'x-workspace-client',
  'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user',
]);
const boundaryHeaders = new Set([
  'host', 'origin', 'authorization', 'idempotency-key', 'cookie',
  'x-workspace-assertion', 'x-csrf-token', 'x-workspace-login',
  'x-workspace-session', 'x-workspace-client', identityHeader,
]);
const hopHeaders = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'proxy-connection',
]);
const configFields = new Set([
  'publicOrigin', 'workspaceId', 'issuer', 'keyId', 'socketPath',
  'socketMode', 'upstream', 'usernameSubjects', 'maxBodyBytes',
  'maxInFlight', 'bodyTimeoutMs', 'upstreamHeadersTimeoutMs',
]);
const invalidConfig = () => Object.assign(new Error('Invalid authenticated ingress configuration.'), { code: 'INGRESS_CONFIGURATION_INVALID' });
const failure = (status, code) => Object.assign(new Error(code), { status, code });
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function boundedInteger(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw invalidConfig();
  return value;
}

/** Programmatic configuration uses explicit in-memory keys/members for tests or
 * trusted composition. The CLI loads only the explicitly named files below. */
export function validateAuthenticatedIngressConfig(input, { privateKey, members } = {}) {
  try {
    if (!plainObject(input) || Object.keys(input).some(key => !configFields.has(key))) throw invalidConfig();
    const key = privateKey?.type === 'private' ? privateKey : createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== 'ed25519') throw invalidConfig();
    const access = validateAccessConfig({
      mode: 'enterprise', publicOrigin: input.publicOrigin,
      workspaceId: input.workspaceId, issuer: input.issuer, keyId: input.keyId,
      publicKey: createPublicKey(key).export({ type: 'spki', format: 'pem' }), members,
    });
    const upstream = new URL(input.upstream);
    if (upstream.origin !== input.upstream || upstream.protocol !== 'http:' ||
        !['127.0.0.1', '[::1]'].includes(upstream.hostname) || !upstream.port ||
        upstream.username || upstream.password) throw invalidConfig();
    if (typeof input.socketPath !== 'string' || !path.isAbsolute(input.socketPath) ||
        path.normalize(input.socketPath) !== input.socketPath ||
        Buffer.byteLength(input.socketPath) > 100 || /[\u0000-\u001f]/.test(input.socketPath)) throw invalidConfig();
    const socketMode = input.socketMode ?? '0600';
    if (!['0600', '0660'].includes(socketMode)) throw invalidConfig();
    if (!Array.isArray(input.usernameSubjects) || !input.usernameSubjects.length ||
        input.usernameSubjects.length > 500) throw invalidConfig();
    const subjects = new Map();
    for (const row of input.usernameSubjects) {
      if (!plainObject(row) || Object.keys(row).sort().join(',') !== 'subject,username' ||
          typeof row.username !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._@+-]{0,127}$/.test(row.username) ||
          subjects.has(row.username) || !access.members.has(row.subject)) throw invalidConfig();
      subjects.set(row.username, row.subject);
    }
    return {
      privateKey: key, publicOrigin: access.publicOrigin, publicHost: access.origin.host,
      workspaceId: access.workspaceId, issuer: access.issuer, keyId: access.keyId,
      socketPath: input.socketPath, socketMode: Number.parseInt(socketMode, 8),
      upstreamHost: upstream.hostname === '[::1]' ? '::1' : upstream.hostname,
      upstreamPort: Number(upstream.port), subjects,
      maxBodyBytes: boundedInteger(input.maxBodyBytes ?? 7_100_000, 1, 7_100_000),
      maxInFlight: boundedInteger(input.maxInFlight ?? 8, 1, 32),
      bodyTimeoutMs: boundedInteger(input.bodyTimeoutMs ?? 60_000, 1000, 120_000),
      upstreamHeadersTimeoutMs: boundedInteger(input.upstreamHeadersTimeoutMs ?? 25_000, 100, 25_000),
    };
  } catch { throw invalidConfig(); }
}

async function readExplicitFile(filename, { secret = false } = {}) {
  let handle;
  try {
    if (typeof filename !== 'string' || !path.isAbsolute(filename) ||
        path.normalize(filename) !== filename || await fs.realpath(filename) !== filename) throw invalidConfig();
    handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 100_000 || (stat.mode & (secret ? 0o077 : 0o022)) ||
        ![0, process.getuid()].includes(stat.uid)) throw invalidConfig();
    return await handle.readFile('utf8');
  } catch { throw invalidConfig(); }
  finally { await handle?.close(); }
}

export async function loadAuthenticatedIngressConfig(filename) {
  try {
    if (process.platform !== 'linux') throw invalidConfig();
    const input = JSON.parse(await readExplicitFile(filename));
    if (!plainObject(input) || !Object.hasOwn(input, 'privateKeyFile') || !Object.hasOwn(input, 'membersFile')) throw invalidConfig();
    const { privateKeyFile, membersFile, ...settings } = input;
    const privateKey = await readExplicitFile(privateKeyFile, { secret: true });
    const members = JSON.parse(await readExplicitFile(membersFile));
    // Validate before returning; no key generation, credential discovery or defaults.
    validateAuthenticatedIngressConfig(settings, { privateKey, members });
    return { settings, privateKey, members };
  } catch { throw invalidConfig(); }
}

function reply(res, status, code) {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    Connection: 'close',
  });
  res.end(JSON.stringify({ error: { code, message: 'The authenticated ingress could not forward this request.' } }));
}
function checkRequest(req, config) {
  if (req.rawHeaders.length > 160) throw failure(431, 'INGRESS_TOO_MANY_HEADERS');
  const seen = new Set();
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    const name = req.rawHeaders[index].toLowerCase();
    if (boundaryHeaders.has(name) && seen.has(name)) throw failure(400, 'INGRESS_AMBIGUOUS_HEADER');
    seen.add(name);
  }
  if (req.headers.host !== config.publicHost) throw failure(403, 'INGRESS_HOST_REJECTED');
  const username = req.headers[identityHeader];
  if (typeof username !== 'string' || !username) throw failure(401, 'INGRESS_IDENTITY_REQUIRED');
  const subject = config.subjects.get(username);
  if (!subject) throw failure(403, 'INGRESS_IDENTITY_REJECTED');
  if (!methods.has(req.method)) throw failure(405, 'INGRESS_METHOD_REJECTED');
  if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//') ||
      req.url.length > 2048 || /[\\\u0000-\u0020\u007f-\uffff]/.test(req.url)) throw failure(400, 'INGRESS_TARGET_REJECTED');
  const connectionTokens = (req.headers.connection || '').toLowerCase().split(',').map(value => value.trim());
  if (connectionTokens.some(name => name && !['close', 'keep-alive'].includes(name)) ||
      req.headers.trailer || req.headers.upgrade) throw failure(400, 'INGRESS_HOP_HEADER_REJECTED');
  if (emptyMethods.has(req.method) &&
      (Number(req.headers['content-length'] || 0) !== 0 || req.headers['transfer-encoding'])) throw failure(400, 'INGRESS_BODY_NOT_ALLOWED');
  if (Number(req.headers['content-length'] || 0) > config.maxBodyBytes) throw failure(413, 'INGRESS_BODY_TOO_LARGE');
  return subject;
}
function readBody(req, config) {
  return new Promise((resolve, reject) => {
    let length = 0;
    const chunks = [];
    const timer = setTimeout(() => fail(failure(408, 'INGRESS_BODY_TIMEOUT')), config.bodyTimeoutMs);
    timer.unref();
    function cleanup() {
      clearTimeout(timer);
      req.off('data', data); req.off('end', end); req.off('aborted', aborted); req.off('error', aborted);
    }
    function fail(error) { cleanup(); req.pause(); reject(error); }
    function aborted() { fail(failure(400, 'INGRESS_REQUEST_ABORTED')); }
    function data(chunk) {
      length += chunk.length;
      if (length > config.maxBodyBytes) { fail(failure(413, 'INGRESS_BODY_TOO_LARGE')); return; }
      chunks.push(chunk);
    }
    function end() { cleanup(); resolve(Buffer.concat(chunks, length)); }
    req.on('data', data); req.once('end', end); req.once('aborted', aborted); req.once('error', aborted);
  });
}
function requestHeaders(req, config, subject, body) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (forwardedHeaders.has(name)) headers[name] = value;
  }
  headers.host = config.publicHost;
  headers['content-length'] = String(body.length);
  headers['x-workspace-assertion'] = signWorkspaceRequest({
    privateKey: config.privateKey, publicOrigin: config.publicOrigin,
    workspaceId: config.workspaceId, issuer: config.issuer, keyId: config.keyId,
    subject, method: req.method, target: req.url, body,
  });
  return headers;
}
function responseHeaders(response) {
  const headers = {};
  const omitted = new Set(hopHeaders);
  for (const token of (response.headers.connection || '').toLowerCase().split(',')) omitted.add(token.trim());
  omitted.add('x-workspace-assertion'); omitted.add(identityHeader);
  for (const [name, value] of Object.entries(response.headers)) if (!omitted.has(name)) headers[name] = value;
  return headers;
}

/** No TCP listener or request-controlled upstream is exposed by this API.
 * The directory and its group are deployment trust boundaries, not authentication.
 * Every process with socket access can impersonate every configured mapping. */
export function createAuthenticatedIngress({ settings, privateKey, members } = {}) {
  if (process.platform !== 'linux') throw invalidConfig();
  const config = validateAuthenticatedIngressConfig(settings, { privateKey, members });
  let started = false, closed = false, inFlight = 0;
  const outgoing = new Set();
  const server = http.createServer({ maxHeaderSize: 16_384 }, async (req, res) => {
    req.on('error', () => {}); // Client aborts must never become uncaught errors.
    let admitted = false, upstream, upstreamResponse;
    const cancel = () => { upstreamResponse?.destroy(); upstream?.destroy(); };
    res.once('close', cancel);
    try {
      const subject = checkRequest(req, config);
      if (closed || inFlight >= config.maxInFlight) throw failure(503, 'INGRESS_BUSY');
      inFlight++; admitted = true;
      const body = await readBody(req, config);
      if (req.aborted || res.destroyed || closed) return;
      const headers = requestHeaders(req, config, subject, body);
      await new Promise(resolve => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true; clearTimeout(timer); outgoing.delete(upstream); resolve();
        };
        upstream = http.request({
          hostname: config.upstreamHost, port: config.upstreamPort,
          method: req.method, path: req.url, headers, agent: false,
        }, response => {
          clearTimeout(timer); upstreamResponse = response;
          response.once('error', () => { reply(res, 502, 'INGRESS_UPSTREAM_FAILED'); finish(); });
          response.once('aborted', () => { reply(res, 502, 'INGRESS_UPSTREAM_FAILED'); finish(); });
          response.once('end', finish);
          res.writeHead(response.statusCode, responseHeaders(response));
          res.flushHeaders();
          response.pipe(res); // Node stream backpressure; no response buffering.
        });
        outgoing.add(upstream);
        const timer = setTimeout(() => {
          reply(res, 504, 'INGRESS_UPSTREAM_TIMEOUT'); upstream.destroy(); finish();
        }, config.upstreamHeadersTimeoutMs);
        timer.unref();
        upstream.once('error', () => { reply(res, 502, 'INGRESS_UPSTREAM_FAILED'); finish(); });
        upstream.once('close', () => { if (res.destroyed || !upstreamResponse) finish(); });
        res.once('close', finish);
        upstream.end(body); // Exact signed bytes; no JSON parsing, retries or redirects.
      });
    } catch (error) {
      reply(res, error.status || 500, error.status ? error.code : 'INGRESS_INTERNAL_ERROR');
    } finally {
      if (admitted) inFlight--;
      res.off('close', cancel);
    }
  });
  // Node otherwise silently truncates the parsed headers at this count, which
  // could hide a duplicate security header. Bound bytes in the parser and reject
  // the full header count explicitly above.
  server.maxHeadersCount = 0;
  server.maxConnections = 128;
  server.requestTimeout = config.bodyTimeoutMs;
  server.headersTimeout = Math.min(15_000, config.bodyTimeoutMs);
  server.on('checkContinue', (_req, res) => reply(res, 417, 'INGRESS_EXPECTATION_REJECTED'));
  server.on('checkExpectation', (_req, res) => reply(res, 417, 'INGRESS_EXPECTATION_REJECTED'));
  server.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  server.on('connect', (_req, socket) => socket.end('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  return {
    async listen() {
      if (started || closed) throw invalidConfig();
      const directory = path.dirname(config.socketPath);
      const info = await fs.lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() ||
          (info.mode & 0o027) || await fs.realpath(directory) !== directory) throw invalidConfig();
      // Never unlink or take over an existing path (including stale sockets).
      try { await fs.lstat(config.socketPath); throw invalidConfig(); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await new Promise((resolve, reject) => {
        const failed = error => { server.off('listening', ready); reject(error); };
        const ready = () => { server.off('error', failed); resolve(); };
        server.once('error', failed); server.once('listening', ready); server.listen(config.socketPath);
      });
      started = true;
      try { await fs.chmod(config.socketPath, config.socketMode); }
      catch (error) { await this.close(); throw error; }
      return { socketPath: config.socketPath };
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const request of outgoing) request.destroy();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw invalidConfig();
    const ingress = createAuthenticatedIngress(await loadAuthenticatedIngressConfig(process.argv[2]));
    await ingress.listen();
    process.stdout.write('Workspace authenticated ingress listening on its configured Unix socket.\n');
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void ingress.close().catch(() => { process.exitCode = 1; }); });
  } catch {
    process.stderr.write('Workspace authenticated ingress startup failed (INGRESS_CONFIGURATION_INVALID).\n');
    process.exitCode = 1;
  }
}
