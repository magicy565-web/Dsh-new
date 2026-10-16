import { createHash } from 'node:crypto';

export const COMPANY_MODEL_FIELDS = Object.freeze(['legalName', 'displayName', 'description']);
export const PRODUCT_MODEL_FIELDS = Object.freeze(['name', 'description', 'category', 'status']);
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
export const libraryReadHash = value => createHash('sha256').update(canonical(value)).digest('hex');
export function normalizeLibraryRecipient(value) {
  if (!value || Object.keys(value).some(key => !['kind', 'provider', 'model', 'destination'].includes(key)) || value.kind !== 'pi-coding-agent'
    || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value.provider || '') || !/^[A-Za-z0-9_.:/-]{1,160}$/.test(value.model || '')) throw new TypeError('Pin an exact official Pi provider/model/destination before library disclosure.');
  if (value.destination === 'faux://keyless-synthetic' && value.provider === 'workspace-agent-test-faux' && value.model === 'workspace-agent-test') return { ...value };
  if (typeof value.destination !== 'string' || value.destination.length > 2048 || /\s/.test(value.destination)) throw new TypeError('Use a bounded exact model destination.');
  let url;
  try { url = new URL(value.destination); } catch { throw new TypeError('The library recipient requires a pinned HTTPS model destination.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new TypeError('The library recipient requires a pinned HTTPS model destination without credentials.');
  return { ...value, destination: url.href.replace(/\/+$/, '') };
}
export function libraryRecipientForModel(model) {
  return normalizeLibraryRecipient({ kind: 'pi-coding-agent', provider: model?.provider, model: model?.id,
    destination: model?.api === 'faux' ? 'faux://keyless-synthetic' : model?.baseUrl });
}
