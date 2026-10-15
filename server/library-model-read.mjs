import { ApiError } from './runtime.mjs';
import { createFactoryMaterialsRead, validateFactoryMaterialsPolicy } from './factory-materials-read.mjs';
import { looksLikeCredential } from './security.mjs';
import { COMPANY_MODEL_FIELDS, PRODUCT_MODEL_FIELDS, libraryReadHash, normalizeLibraryRecipient } from './library-model-read-contract.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const fields = (value, allowed) => Array.isArray(value) && value.length > 0 && new Set(value).size === value.length && value.every(field => allowed.includes(field));

// Deliberately no environment switch, credential, new role or stored grant.
// An existing Host may supply an explicitly reviewed, expiring, exact-revision
// projection policy after user approval. Default requests read no library data.
export function createLibraryModelRead({ library, artifacts, access, policy = null, clock = Date.now }) {
  let scope = null;
  if (policy !== null && (!policy || typeof policy !== 'object' || Array.isArray(policy) || typeof policy.enabled !== 'boolean'))
    throw new TypeError('Library model-read policy must be explicitly enabled or disabled.');
  if (policy?.enabled === true) {
    if (access.mode !== 'enterprise' || !exact(policy, ['enabled', 'reviewed', 'workspaceId', 'subject', 'expiresAt', 'recipient', 'company', 'products', 'productFields', 'factoryMaterials'])
      || policy.reviewed !== true || typeof policy.workspaceId !== 'string' || !policy.workspaceId || typeof policy.subject !== 'string' || !policy.subject
      || typeof policy.expiresAt !== 'string' || !Number.isFinite(Date.parse(policy.expiresAt))
      || policy.company !== null && (!exact(policy.company, ['revision', 'fields']) || !Number.isSafeInteger(policy.company.revision) || policy.company.revision < 1 || !fields(policy.company.fields, COMPANY_MODEL_FIELDS))
      || !Array.isArray(policy.products) || policy.products.length > 100 || new Set(policy.products.map(row => row?.id)).size !== policy.products.length
      || policy.products.some(row => !exact(row, ['id', 'revision']) || !uuid(row.id) || !Number.isSafeInteger(row.revision) || row.revision < 1)
      || !fields(policy.productFields, PRODUCT_MODEL_FIELDS)) throw new TypeError('Library model reads require a reviewed enterprise Session scope, exact revisions, allowed fields, expiry and recipient.');
    validateFactoryMaterialsPolicy(policy.factoryMaterials);
    scope = structuredClone({ workspaceId: policy.workspaceId, subject: policy.subject, expiresAt: policy.expiresAt,
      recipient: normalizeLibraryRecipient(policy.recipient), company: policy.company, products: policy.products, productFields: policy.productFields, ...(policy.factoryMaterials === undefined ? {} : { factoryMaterials: policy.factoryMaterials }) });
  }
  const authorization = scope && { scopeFingerprint: libraryReadHash(scope), recipient: scope.recipient,
    workspaceId: scope.workspaceId, subject: scope.subject, expiresAt: scope.expiresAt };
  const factory = createFactoryMaterialsRead({ library, artifacts, scope, authorization, clock });
  function authorize(context, recipientHash, trustedSession = false) {
    if (access.mode !== 'enterprise' || !context.session || !trustedSession && !context.claims
      || context.workspaceId !== scope.workspaceId || context.subject !== scope.subject)
      fail(403, 'LIBRARY_SESSION_SCOPE_REQUIRED', 'Use the original approved enterprise Session and member; Agent Bearer credentials do not confer this read.');
    if (clock() >= Date.parse(scope.expiresAt)) fail(403, 'LIBRARY_READ_SCOPE_EXPIRED', 'The reviewed library disclosure scope expired.');
    if (recipientHash !== libraryReadHash(scope.recipient)) fail(403, 'LIBRARY_MODEL_RECIPIENT_CHANGED', 'This read is not bound to the reviewed model receiver.');
  }
  function projection(record, selected, expectedRevision, kind) {
    if (record.revision !== expectedRevision) fail(409, 'LIBRARY_READ_REVISION_CHANGED', 'The approved record revision changed; review this exact record again before model disclosure.');
    const value = { id: record.id, revision: record.revision, ...Object.fromEntries(selected.map(field => [field, record[field]])) };
    if (selected.some(field => typeof value[field] !== 'string') || looksLikeCredential(JSON.stringify(value))) fail(403, 'LIBRARY_READ_UNSAFE_RECORD', 'The selected fields cannot be safely disclosed; no record content was returned.');
    return { value, source: { kind, recordId: record.id, revision: record.revision, workspaceId: scope.workspaceId,
      projectionSha256: libraryReadHash(value), api: '/api/library/model-read/' + (kind === 'company' ? 'company' : 'products/' + record.id) } };
  }
  return {
    // Server-private reuse of the original LIVE native Session identity. This is
    // never exposed as a tool-selected identity or an Agent-Bearer capability.
    async readFactoryForSession({ identity, recipientHash, suffix, query, signal }) {
      if (!scope) return { plugin: 'workspace-factory-materials', status: 'unconfigured', reason: 'FACTORY_MATERIAL_DISCLOSURE_NOT_CONFIGURED', sources: [] };
      const assertCurrent = () => {
        signal?.throwIfAborted();
        const live = access.nativeSessionById(identity?.sessionId);
        if (!live || live.subject !== identity.subject || live.workspaceId !== identity.workspaceId || live.role !== identity.role)
          fail(403, 'LIBRARY_SESSION_SCOPE_REQUIRED', 'The original Session is no longer authorized.');
        authorize({ ...live, session: live }, recipientHash, true);
      };
      assertCurrent();
      return factory.read(suffix, query, { signal, assertCurrent });
    },
    async handle({ req, res, pathname, query, context, respond }) {
      if (!pathname.startsWith('/api/library/model-read/')) return false;
      if (req.method !== 'GET') fail(405, 'LIBRARY_READ_ONLY', 'Model library access is read-only.');
      const factoryRequest = pathname.startsWith('/api/library/model-read/factory/');
      if (!scope) { await respond(res, 200, factoryRequest ? { plugin: 'workspace-factory-materials', status: 'unconfigured', reason: 'FACTORY_MATERIAL_DISCLOSURE_NOT_CONFIGURED', sources: [] }
        : { plugin: 'workspace-library', status: 'unconfigured', reason: 'LIBRARY_MODEL_DISCLOSURE_NOT_CONFIGURED', sources: [], detail: 'No reviewed model-readable library scope is activated; no library record was read.' }); return true; }
      authorize(context, req.headers['x-workspace-library-recipient']);
      if (factoryRequest) {
        const assertCurrent = () => {
          const live = access.nativeSessionById(context.session.id);
          if (!live || live.subject !== context.subject || live.workspaceId !== context.workspaceId || live.role !== context.role) fail(403, 'LIBRARY_SESSION_SCOPE_REQUIRED', 'The original Session changed.');
          authorize(context, req.headers['x-workspace-library-recipient']);
        };
        const result = await factory.read(pathname.slice('/api/library/model-read/factory/'.length), query, { assertCurrent });
        await respond(res, 200, result); return true;
      }
      const base = { plugin: 'workspace-library', authorization, sources: [] };
      const suffix = pathname.slice('/api/library/model-read/'.length);
      if ([...query.keys()].some(key => suffix !== 'products' || key !== 'limit') || [...query.keys()].some(key => query.getAll(key).length !== 1)) fail(400, 'LIBRARY_READ_INPUT_INVALID', 'Only a bounded product limit is accepted; identity, fields and recipient cannot be selected by tools.');
      if (suffix === 'status') { await respond(res, 200, { ...base, status: 'available', fields: { company: scope.company?.fields || [], product: scope.productFields } }); return true; }
      if (suffix === 'company') {
        if (!scope.company) fail(403, 'LIBRARY_CATEGORY_NOT_APPROVED', 'Company fields are outside the reviewed disclosure scope.');
        const { value, source } = projection(library.getCompany().company, scope.company.fields, scope.company.revision, 'company');
        await respond(res, 200, { ...base, status: scope.company.fields.some(field => value[field]) ? 'available' : 'empty', company: value, sources: [source] }); return true;
      }
      if (suffix === 'products') {
        const raw = query.get('limit') ?? '20'; if (!/^(?:[1-9]|1[0-9]|20)$/.test(raw)) fail(400, 'LIBRARY_READ_INPUT_INVALID', 'Product limit must be 1–20.');
        const selected = scope.products.slice(0, Number(raw)).map(ref => projection(library.getProduct(ref.id).product, scope.productFields, ref.revision, 'product'));
        await respond(res, 200, { ...base, status: selected.length ? 'available' : 'empty', products: selected.map(row => row.value), sources: selected.map(row => row.source),
          limit: Number(raw), hasMore: scope.products.length > Number(raw), selection: 'approved-exact-revisions-only' }); return true;
      }
      const match = suffix.match(/^products\/([a-f0-9-]{36})$/), ref = match && scope.products.find(row => row.id === match[1]);
      if (!ref) fail(404, 'LIBRARY_APPROVED_RECORD_NOT_FOUND', 'The requested product is not in this reviewed enterprise scope.');
      const { value, source } = projection(library.getProduct(ref.id).product, scope.productFields, ref.revision, 'product');
      await respond(res, 200, { ...base, status: 'available', product: value, sources: [source] }); return true;
    },
  };
}
