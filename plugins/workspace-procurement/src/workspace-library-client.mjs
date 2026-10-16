import { COMPANY_MODEL_FIELDS, PRODUCT_MODEL_FIELDS, libraryReadHash, normalizeLibraryRecipient, libraryRecipientForModel } from './library-model-read-contract.mjs';
import { looksLikeCredential } from './public-input.mjs';

const API = '/api/library/model-read';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const gap = reason => ({ plugin: 'workspace-library', status: 'blocked', reason, sources: [], detail: 'The original reviewed Session read is unavailable; no company or product contents are disclosed.' });
// The Host supplies its EXISTING Session transport. No login, credential, token
// conversion, arbitrary URL, write method or new permission exists here.
export function createWorkspaceLibraryClient({ request, recipient }) {
  if (typeof request !== 'function') throw new TypeError('Use an existing enterprise Session request transport.');
  const receiver = normalizeLibraryRecipient(recipient), receiverHash = libraryReadHash(receiver);
  const matchesModel = model => { try { return libraryReadHash(libraryRecipientForModel(model)) === receiverHash; } catch { return false; } };
  async function read(suffix, signal, model) {
    if (model !== undefined && !matchesModel(model)) return gap('LIBRARY_MODEL_RECIPIENT_CHANGED');
    let response;
    try { response = await request(API + suffix, { method: 'GET', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      headers: { Accept: 'application/json', 'X-Workspace-Library-Recipient': receiverHash } }); }
    catch { throw new Error('Library Session transport failed; no read result is inferred.'); }
    if (!response?.ok) {
      if ([401, 403, 404, 409].includes(response?.status)) return gap('LIBRARY_SESSION_READ_REFUSED_HTTP_' + response.status);
      throw new Error('Library Session request failed; no read result is inferred.');
    }
    if (response.redirected || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('Library returned an invalid read receipt.');
    let text = '', bytes = 0;
    const reader = response.body?.getReader(), decoder = new TextDecoder();
    if (!reader) throw new Error('Library returned no read receipt.');
    try { while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength;
      if (bytes > 512_000) { await reader.cancel(); throw new Error('Library read receipt exceeded its limit.'); }
      text += decoder.decode(chunk.value, { stream: true }); } text += decoder.decode(); } finally { reader.releaseLock(); }
    let value; try { value = JSON.parse(text); } catch { throw new Error('Library returned an invalid read receipt.'); }
    if (value?.plugin !== 'workspace-library') throw new Error('Library returned an invalid read receipt.');
    if (value.status === 'unconfigured') return { plugin: 'workspace-library', status: 'unconfigured', reason: 'LIBRARY_MODEL_DISCLOSURE_NOT_CONFIGURED', sources: [] };
    const a = value.authorization;
    if (!['available', 'empty'].includes(value.status) || !a || !/^[a-f0-9]{64}$/.test(a.scopeFingerprint || '')
      || typeof a.workspaceId !== 'string' || !a.workspaceId || typeof a.subject !== 'string' || !a.subject
      || !Number.isFinite(Date.parse(a.expiresAt)) || Date.now() >= Date.parse(a.expiresAt)
      || libraryReadHash(normalizeLibraryRecipient(a.recipient)) !== receiverHash || !Array.isArray(value.sources)) throw new Error('Library authorization receipt is invalid or expired.');
    const authorization = { scopeFingerprint: a.scopeFingerprint, workspaceId: a.workspaceId, subject: a.subject, expiresAt: a.expiresAt, recipient: receiver };
    const base = { plugin: 'workspace-library', status: value.status, authorization, sources: [] };
    if (suffix === '/status') {
      if (!value.fields || !Array.isArray(value.fields.company) || !Array.isArray(value.fields.product)
        || value.fields.company.some(field => !COMPANY_MODEL_FIELDS.includes(field)) || value.fields.product.some(field => !PRODUCT_MODEL_FIELDS.includes(field))) throw new Error('Library field scope is invalid.');
      return { ...base, fields: { company: [...value.fields.company], product: [...value.fields.product] } };
    }
    const kind = suffix === '/company' ? 'company' : 'product', allowed = kind === 'company' ? COMPANY_MODEL_FIELDS : PRODUCT_MODEL_FIELDS;
    const rows = kind === 'company' ? [value.company] : suffix.startsWith('/products?') ? value.products : [value.product];
    if (!Array.isArray(rows) || rows.length > 20 || rows.length !== value.sources.length) throw new Error('Library record receipt is invalid.');
    const projected = rows.map((row, index) => {
      if (!row || (kind === 'company' ? row.id !== 'company' : !uuid(row.id)) || !Number.isSafeInteger(row.revision) || row.revision < 1
        || Object.keys(row).some(key => !['id', 'revision', ...allowed].includes(key))
        || allowed.some(field => row[field] !== undefined && (typeof row[field] !== 'string' || row[field].length > 64_000))) throw new Error('Library projection is invalid.');
      const source = value.sources[index];
      if (!source || source.kind !== kind || source.recordId !== row.id || source.revision !== row.revision || source.workspaceId !== a.workspaceId
        || source.projectionSha256 !== libraryReadHash(row) || source.api !== API + (kind === 'company' ? '/company' : '/products/' + row.id)) throw new Error('Library original source does not match the projection.');
      base.sources.push({ kind, recordId: row.id, revision: row.revision, workspaceId: a.workspaceId, projectionSha256: source.projectionSha256, api: source.api });
      return { ...row };
    });
    if (looksLikeCredential(JSON.stringify({ authorization, projected }))) return gap('LIBRARY_UNSAFE_RECORD');
    if (kind === 'company') return { ...base, company: projected[0] };
    if (!suffix.startsWith('/products?')) {
      if (projected[0].id !== suffix.slice('/products/'.length)) throw new Error('Library returned a different product.');
      return { ...base, product: projected[0] };
    }
    const requestedLimit = Number(new URLSearchParams(suffix.split('?')[1]).get('limit'));
    if (value.limit !== requestedLimit || projected.length > requestedLimit || typeof value.hasMore !== 'boolean'
      || value.selection !== 'approved-exact-revisions-only' || value.status !== (projected.length ? 'available' : 'empty')) throw new Error('Library product list is invalid.');
    return { ...base, products: projected, limit: requestedLimit, hasMore: value.hasMore, selection: value.selection };
  }
  const companyProfile = (signal, model) => read('/company', signal, model);
  const products = (input = {}, signal, model) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'limit')
      || input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 20)) throw new Error('Product input allows only an integer limit from 1 to 20.');
    return read('/products?limit=' + (input.limit ?? 20), signal, model);
  };
  const product = (id, signal, model) => { if (!uuid(id)) throw new Error('Use an exact product UUID.'); return read('/products/' + id, signal, model); };
  async function revalidateReceipt(receipt, model, signal) {
    const current = await read('/status', signal, model);
    if (current.status !== 'available' || libraryReadHash(current.authorization) !== libraryReadHash(receipt.authorization)) throw new Error('Library cached receipt authorization or recipient changed.');
    const fresh = receipt.company ? await companyProfile(signal, model) : Array.isArray(receipt.products) ? await products({ limit: receipt.limit }, signal, model) : await product(receipt.product?.id, signal, model);
    if (!['available', 'empty'].includes(fresh.status) || libraryReadHash(fresh) !== libraryReadHash(receipt)) throw new Error('Library cached receipt scope or original record revision changed.');
  }
  return Object.freeze({ companyProfile, products, product, revalidateReceipt, matchesModel });
}
