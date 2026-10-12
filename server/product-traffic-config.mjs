import path from 'node:path';
import { openPrivateFile } from './store.mjs';
import { createGa4ProductTrafficAdapter } from './product-traffic-ga4.mjs';
import { productTrafficInstant } from './product-traffic-contract.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const configError = () => Object.assign(new TypeError('Use the reviewed private GA4 configuration schema and existing absolute file paths.'), { code: 'PRODUCT_TRAFFIC_CONFIG_INVALID' });
const absoluteFile = value => typeof value === 'string' && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value) && path.isAbsolute(value);
const identityKeys = ['workspaceId', 'shopId', 'shopDomain', 'propertyId'];
const tokenScopes = ['https://www.googleapis.com/auth/analytics.readonly', 'https://www.googleapis.com/auth/analytics'];

async function privateJson(filename, maximum) {
  if (!absoluteFile(filename)) throw configError();
  let handle;
  try {
    handle = await openPrivateFile(filename);
    const stat = await handle.stat();
    if (stat.size > maximum || process.platform !== 'win32' && (stat.mode & 0o077)) throw configError();
    // Bound the read itself as well as stat: an existing producer may rotate or
    // replace the snapshot, but a growing file must not become an unbounded read.
    const buffer = Buffer.alloc(maximum + 1); let length = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      length += bytesRead;
      if (length > maximum) throw configError();
      if (!bytesRead) break;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
  } catch { throw configError(); }
  finally { await handle?.close(); }
}

function reviewedBinding(value) {
  if (!keys(value, [...identityKeys, 'mappingRevision', 'authorizationReviewed', 'hostNames', 'products']) ||
      typeof value.authorizationReviewed !== 'boolean' || !Array.isArray(value.products) ||
      value.products.some(row => !keys(row, ['productId', 'itemId', 'collectionStartedAt', 'evidenceRef']))) throw configError();
  const binding = structuredClone(value);
  // Reuse the source adapter's fixed-scope validation; never infer item IDs,
  // hostnames, account identity, or collection history in the bootstrap layer.
  try { createGa4ProductTrafficAdapter({ binding }); } catch { throw configError(); }
  return binding;
}

/** Read only an EXISTING rotating authorization snapshot, on each invocation.
 * No acquisition, refresh, grant, file write, network call or persisted token.
 * The producer remains the original trusted host, outside this application. */
export function existingGa4AuthorizationProvider(filename, binding, { clock = Date.now } = {}) {
  if (!absoluteFile(filename)) throw configError();
  const fixed = reviewedBinding(binding);
  return async scope => {
    if (fixed.authorizationReviewed !== true || !scope || scope.signal?.aborted || identityKeys.some(key => scope[key] !== fixed[key])) return null;
    try {
      const data = await privateJson(filename, 16_384);
      if (!keys(data, ['version', ...identityKeys, 'authorized', 'scopes', 'expiresAt', 'accessToken']) || data.version !== 1 ||
          data.authorized !== true || identityKeys.some(key => data[key] !== fixed[key]) ||
          !Array.isArray(data.scopes) || data.scopes.length > 32 || data.scopes.some(scope => typeof scope !== 'string' || scope.length > 500 || /[\u0000-\u0020\u007f]/.test(scope)) ||
          !data.scopes.some(scope => tokenScopes.includes(scope)) || productTrafficInstant(data.expiresAt) === null || Date.parse(data.expiresAt) <= clock() ||
          typeof data.accessToken !== 'string' || !data.accessToken.length || data.accessToken.length > 8192 || /\s|[\u0000-\u001f\u007f]/.test(data.accessToken) || scope.signal?.aborted) return null;
      return { authorized: true, ...Object.fromEntries(identityKeys.map(key => [key, data[key]])),
        scopes: [...data.scopes], expiresAt: data.expiresAt, accessToken: data.accessToken };
    } catch { return null; }
  };
}

/** Startup metadata only. Credentials are forbidden inline; a referenced file
 * is not proof of a live authorization or a successful source connection. */
export async function loadSupplierTrafficOptions(filename, { clock = Date.now, workspaceId } = {}) {
  if (filename === undefined || filename === null || filename === '') return null;
  const config = await privateJson(filename, 1_000_000);
  if (!keys(config, ['version', 'binding', 'authorizationFile']) || config.version !== 1) throw configError();
  const binding = reviewedBinding(config.binding);
  if (workspaceId !== undefined && binding.workspaceId !== workspaceId) throw configError();
  if (config.authorizationFile !== undefined && !absoluteFile(config.authorizationFile)) throw configError();
  return { binding, getAuthorization: config.authorizationFile ? existingGa4AuthorizationProvider(config.authorizationFile, binding, { clock }) : null };
}
