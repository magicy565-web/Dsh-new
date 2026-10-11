import http from 'node:http';

// Real loopback HTTP, with one non-pooled client per temporary server. A new
// fixture cannot inherit a global fetch pool's socket for a reused local port.
export function localHttpTransport(base) {
  const origin = new URL(base).origin, agent = new http.Agent({ keepAlive: false });
  const pending = new Set(); let closed = false;
  function fetch(path, options = {}) {
    if (closed) return Promise.reject(Error('Local HTTP fixture is closed'));
    const url = new URL(path, base);
    if (url.origin !== origin) return Promise.reject(Error('Fixture forbids external HTTP'));
    const result = new Promise((resolve, reject) => {
      const headers = Object.fromEntries(new Headers(options.headers).entries());
      const request = http.request(url, { agent, method: options.method || 'GET', headers, signal: options.signal }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk)); response.once('error', reject);
        response.once('end', () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(response.headers)) for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) headers.append(key, item);
          const status = response.statusCode;
          resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, statusText: response.statusMessage, headers }));
        });
      });
      request.once('error', reject); request.setTimeout(15000, () => request.destroy(Error('Local HTTP fixture deadline exceeded')));
      request.end(options.body);
    });
    pending.add(result); result.finally(() => pending.delete(result)).catch(() => {});
    return result;
  }
  async function close() { closed = true; agent.destroy(); await Promise.allSettled([...pending]); }
  return { fetch, close };
}
