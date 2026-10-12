import { Socket } from 'node:net';

const safeCode = value => typeof value === 'string' && /^[A-Z0-9_]{1,100}$/.test(value);
const failure = code => Object.assign(new Error(code), { code });

// The TUI receives an inherited private pipe, never Session/CSRF/key material.
export function createOwnerRpcTransport(fd) {
  if (!Number.isInteger(fd) || fd < 3 || fd > 64) throw failure('OWNER_SESSION_PIPE_REQUIRED');
  const stream = new Socket({ fd, readable: true, writable: true });
  stream.setEncoding('utf8');
  let nextId = 0, buffer = '';
  const pending = new Map();
  const close = () => { for (const wait of pending.values()) wait.reject(failure('OWNER_HOST_DISCONNECTED')); pending.clear(); };
  stream.on('error', close); stream.on('close', close);
  stream.on('data', bytes => {
    buffer += bytes.toString('utf8');
    if (buffer.length > 16_777_216) { stream.destroy(); return; }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      let response;
      try { response = JSON.parse(buffer.slice(0, end)); } catch { stream.destroy(); return; }
      buffer = buffer.slice(end + 1);
      const wait = pending.get(response.id); if (!wait) continue;
      pending.delete(response.id);
      if (!pending.size) stream.unref();
      if (response.error) wait.reject(failure(safeCode(response.error) ? response.error : 'OWNER_HOST_FAILED'));
      else wait.resolve(response.result);
    }
  });
  stream.unref();
  const request = ({ method, path, body, signal = AbortSignal.timeout(15000) }) => new Promise((resolve, reject) => {
    if (stream.destroyed || signal.aborted) { reject(failure('OWNER_HOST_DISCONNECTED')); return; }
    const id = ++nextId;
    const abort = () => { pending.delete(id); if (!pending.size) stream.unref(); reject(failure('OWNER_HOST_RESULT_UNKNOWN')); };
    signal.addEventListener('abort', abort, { once: true });
    pending.set(id, { resolve: value => { signal.removeEventListener('abort', abort); resolve(value); }, reject: error => { signal.removeEventListener('abort', abort); reject(error); } });
    stream.ref();
    stream.write(JSON.stringify({ id, method, path, ...(body === undefined ? {} : { body }) }) + '\n');
  });
  request.close = () => stream.destroy();
  return request;
}

// Host side: native Session material remains in this process and the existing
// trusted HTTPS ingress. Scope/auth decisions still belong to that ingress.
export function serveOwnerRpc(stream, request) {
  stream.setEncoding('utf8');
  let buffer = '', queue = Promise.resolve();
  const abort = new AbortController();
  stream.on('error', () => abort.abort()); stream.on('close', () => abort.abort());
  stream.on('data', bytes => {
    buffer += bytes.toString('utf8');
    // Bounded original supplier image JSON (1.3M base64 chars) plus RPC envelope.
    if (Buffer.byteLength(buffer, 'utf8') > 1_650_000) { stream.destroy(); return; }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      queue = queue.then(async () => {
        let input;
        try { input = JSON.parse(line); } catch { stream.destroy(); return; }
        if (!input || !Number.isSafeInteger(input.id) || Object.keys(input).some(key => !['id', 'method', 'path', 'body'].includes(key))) { stream.destroy(); return; }
        let output;
        try {
          const result = await request({ ...input, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
          // The TUI needs identity/scope, never the underlying session secrets.
          if (input.path === '/api/session' && result.status === 200) {
            const { mode, authenticated, workspaceId, user, expiresAt, idleExpiresAt } = result.body;
            output = { id: input.id, result: { status: 200, body: { mode, authenticated, workspaceId, user, expiresAt, idleExpiresAt } } };
          } else if (input.path === '/api/bootstrap' && result.status === 200) {
            output = { id: input.id, result: { status: 200, body: { museBinding: result.body.museBinding } } };
          } else output = { id: input.id, result };
        } catch (error) { output = { id: input.id, error: safeCode(error.code) ? error.code : 'OWNER_HOST_REQUEST_FAILED' }; }
        if (!stream.destroyed) stream.write(JSON.stringify(output) + '\n');
      }).catch(() => stream.destroy());
    }
  });
}
