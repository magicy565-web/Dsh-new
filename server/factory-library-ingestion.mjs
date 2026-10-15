// Thin original Library/Products/company adapter. No HTTP route, worker, agent
// loop, custom store or permission registry. The original host supplies authority.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { ApiError } from './runtime.mjs';
import { createBusinessLibraryService } from './business-library.mjs';
import { looksLikeCredential } from './security.mjs';
import { libraryReadHash as hash, normalizeLibraryRecipient, libraryRecipientForModel } from './library-model-read-contract.mjs';
import { workspaceOmpPaths, checkWorkspaceOmpPaths } from './workspace-omp-bridge.mjs';
import { INGESTION_PLUGIN, validateIntake, exact, asset, UUID, leaves } from '../packages/workspace-factory-ingestion/src/contract.mjs';

const flags = Object.freeze({ visibility: 'internal', humanConfirmed: false, independentVerification: false, externalActions: false });
const fail = (code, status = 409) => { throw new ApiError(status, code, 'Original authorized uploads, unchanged evidence and protected Library fields are required.'); };
const uuidFor = value => { const s = hash(value); return `${s.slice(0, 8)}-${s.slice(8, 12)}-5${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`; };
const refKey = ref => `${ref.artifactId}/${ref.version}/${ref.sha256}`;
const blank = value => value === '' || value === null || value === undefined || Array.isArray(value) && !value.length;
const originalAsset = artifact => ({ artifactId: artifact.id, version: artifact.currentVersion, sha256: artifact.sha256 });
const mimeExtensions = { 'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv', 'application/json': 'json', 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const companyFields = ['legalName', 'displayName', 'description'];
const productFields = ['name', 'description', 'category', 'skus', 'images', 'supply.packaging', 'supply.samplePolicy', 'supply.paymentTerms', 'supply.shippingTerms', 'supply.capacityNote'];

export async function readFactoryLibrarySource({ bytes, mimeType, signal }) {
  signal?.throwIfAborted();
  const unavailable = () => ({ status: 'unavailable', reason: 'NATIVE_SOURCE_READ_UNAVAILABLE', text: '', nativeContent: [], textTruncated: false });
  if (!Buffer.isBuffer(bytes) || bytes.length > 5 * 1024 * 1024 || !mimeExtensions[mimeType]) return unavailable();
  const paths = workspaceOmpPaths();
  try { await checkWorkspaceOmpPaths(paths); } catch { return unavailable(); }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'factory-library-read-'));
  try {
    await fs.chmod(directory, 0o700);
    const filename = 'selected.' + mimeExtensions[mimeType]; await fs.writeFile(path.join(directory, filename), bytes, { mode: 0o600, flag: 'wx' });
    const output = await new Promise(resolve => {
      const child = spawn(paths.bun, [new URL('./factory-library-native-read.mjs', import.meta.url).pathname, paths.packageRoot, directory, filename], {
        cwd: directory, env: { PATH: path.dirname(paths.bun) + ':/usr/bin:/bin', HOME: directory, TMPDIR: directory, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'ignore'] });
      let result = '', invalid = false;
      const kill = () => { invalid = true; child.kill('SIGKILL'); };
      const timer = setTimeout(kill, 15000); signal?.addEventListener('abort', kill, { once: true }); if (signal?.aborted) kill();
      child.stdout.on('data', chunk => { if (Buffer.byteLength(result) + chunk.length > 8 * 1024 * 1024) kill(); else result += chunk; });
      child.on('error', () => { invalid = true; });
      child.on('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', kill); try { resolve(!invalid && code === 0 ? JSON.parse(result) : null); } catch { resolve(null); } });
    });
    signal?.throwIfAborted();
    if (!output || !['available', 'partial'].includes(output.status) || typeof output.text !== 'string' || output.text.length > 200000 || !Array.isArray(output.nativeContent)) return unavailable();
    return { ...output, extractionPolicy: 'original-omp-read-18.10.4-local-only' };
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

/** scope is supplied by the reviewed host, never by a model/tool argument.
 * authorize(signal,model) must return {assertCurrent(state)} from the original
 * Session/recipient/expiry/revocation/run-intent authority, synchronously rejecting
 * changes at every original transaction. It must also reauthorize cached receipts
 * before each provider request. No credentials or runtime discovery occurs here.
 */
export function createFactoryLibraryIngestionClient({ store, artifacts, scope: selectedScope, identity: selectedIdentity,
  conversationId, authorize, canSave, sourceReader = readFactoryLibrarySource, clock = Date.now } = {}) {
  if (!store || !artifacts || typeof authorize !== 'function' || typeof canSave !== 'function' || typeof sourceReader !== 'function') throw TypeError('Original services and rejecting host authority are required.');
  const scope = structuredClone(selectedScope), identity = structuredClone(selectedIdentity);
  const principal = { workspaceId: identity?.workspaceId, subject: identity?.subject };
  exact(scope, ['workspaceId', 'subject', 'expiresAt', 'recipient', 'uploads', 'companyRevision', 'products', 'fields']);
  if (scope.workspaceId !== identity?.workspaceId || scope.subject !== identity.subject || !Number.isFinite(Date.parse(scope.expiresAt))
    || !['operator', 'admin'].includes(identity.role) || !Array.isArray(scope.uploads) || !scope.uploads.length || scope.uploads.length > 20
    || !Array.isArray(scope.products) || scope.products.length > 100 || !conversationId) throw TypeError('Use original operator identity and exact host-selected scope.');
  scope.recipient = normalizeLibraryRecipient(scope.recipient);
  exact(scope.fields, ['company', 'product']);
  for (const [kind, allowed] of [['company', companyFields], ['product', productFields]]) {
    const selected = scope.fields[kind];
    if (!Array.isArray(selected) || new Set(selected).size !== selected.length || selected.some(f => !allowed.includes(f))) throw TypeError('Use exact fields admitted by the original host policy.');
  }
  scope.uploads.forEach(asset);
  if (new Set(scope.uploads.map(refKey)).size !== scope.uploads.length) throw TypeError('Duplicate upload pins.');
  for (const p of scope.products) { exact(p, ['id', 'revision']); if (!UUID.test(p.id) || !Number.isSafeInteger(p.revision) || p.revision < 1) throw TypeError('Pin original product revisions.'); }
  if (scope.companyRevision !== null && (!Number.isSafeInteger(scope.companyRevision) || scope.companyRevision < 1)) throw TypeError('Pin company revision or null.');
  const baseLibrary = createBusinessLibraryService({ store, artifacts, clock });
  function projection(record, kind) {
    if (!record) return null;
    const result = { id: record.id, revision: record.revision };
    for (const field of scope.fields[kind]) {
      if (field === 'skus') result.skus = record.skus.map(({ id, code, specs, unit, moq, leadTimeDays }) => ({ id, code, specs, unit, moq, leadTimeDays }));
      else if (field.startsWith('supply.')) { result.supply ??= {}; result.supply[field.slice(7)] = record.supply[field.slice(7)]; }
      else if (field === 'images') result.images = record.images.filter(image => scope.uploads.some(ref => refKey(ref) === refKey(image.asset)));
      else result[field] = record[field];
    }
    return result;
  }
  function localCheck(state, signal, model, write, permit) {
    signal?.throwIfAborted();
    if (Date.parse(scope.expiresAt) <= clock() || hash(scope.recipient) !== hash(libraryRecipientForModel(model))) fail('FACTORY_INGESTION_SCOPE_REFUSED', 403);
    if (!permit || typeof permit.assertCurrent !== 'function') fail('FACTORY_INGESTION_AUTHORITY_REQUIRED', 403);
    const checked = permit.assertCurrent(state); if (checked === false || checked && typeof checked.then === 'function') fail('FACTORY_INGESTION_SYNC_AUTHORITY_REQUIRED', 403);
    if (write && canSave() !== true) fail('BUSINESS_EXECUTION_INTENT_REQUIRED', 403);
    for (const ref of scope.uploads) {
      const a = state.artifacts.find(a => a.id === ref.artifactId), v = a?.versions.find(v => v.version === ref.version);
      if (v?.sha256 !== ref.sha256 || a.metadata?.businessLibrary?.visibility !== 'internal') fail('FACTORY_INGESTION_UPLOAD_CHANGED');
    }
  }
  async function gate(signal, model, write = false) {
    signal?.throwIfAborted(); const permit = await authorize(signal, model);
    const check = state => localCheck(state, signal, model, write, permit);
    check(store.read()); return check;
  }
  async function status(_input, signal, model) {
    const check = await gate(signal, model), state = store.read();
    // Status exposes selection metadata only. Original field values are returned
    // by a source-checked batch query, never a stale pre-write catalog snapshot.
    check(state); return { plugin: INGESTION_PLUGIN, status: 'available', ...flags,
      uploads: scope.uploads.map(ref => { const a = state.artifacts.find(a => a.id === ref.artifactId), v = a.versions.find(v => v.version === ref.version); return { asset: ref, filename: v.filename, mimeType: v.mimeType }; }),
      company: scope.companyRevision === null ? null : { id: 'company', revision: scope.companyRevision }, products: scope.products.map(p => ({ ...p })), fields: scope.fields,
      policy: 'reviewed-selection-metadata; fill-empty-fields-only; source-quotes-not-certification' };
  }

  async function read(input, signal, model) {
    exact(input, ['asset']); asset(input.asset);
    if (!scope.uploads.some(ref => refKey(ref) === refKey(input.asset))) fail('FACTORY_INGESTION_UPLOAD_NOT_APPROVED', 403);
    await gate(signal, model);
    const file = await artifacts.download(input.asset.artifactId, { version: input.asset.version });
    if (file.version.sha256 !== input.asset.sha256 || createHash('sha256').update(file.bytes).digest('hex') !== input.asset.sha256) fail('FACTORY_INGESTION_UPLOAD_CHANGED');
    const extracted = await sourceReader({ bytes: file.bytes, mimeType: file.mimeType, signal });
    await gate(signal, model);
    if (!extracted || !['available', 'partial', 'unavailable'].includes(extracted.status) || typeof extracted.text !== 'string'
      || !Array.isArray(extracted.nativeContent) || looksLikeCredential(extracted.text)) fail('FACTORY_INGESTION_READ_UNSAFE', 403);
    return { plugin: INGESTION_PLUGIN, ...flags, ...extracted, source: { asset: input.asset, readHash: hash(extracted) } };
  }
  const groupFor = requestId => hash([identity.workspaceId, identity.subject, conversationId, requestId]);
  const journalKey = requestId => 'factory-ingestion-plan-' + groupFor(requestId);
  function guardedLibrary(check) {
    return createBusinessLibraryService({ artifacts, clock, store: { read: () => store.read(), update: mutate => store.update(state => { check(state); return mutate(state); }) } });
  }
  function merge(old, proposed, prefix, conflicts) {
    if (blank(proposed) || hash(old ?? null) === hash(proposed)) return old;
    if (blank(old)) return structuredClone(proposed);
    conflicts.push({ field: prefix, existing: old, proposed, resolution: 'preserved-existing-human-edit-required' }); return old;
  }
  function productChanges(row, old, group, conflicts, sourceDocs) {
    const changes = {}, v = row.values;
    for (const key of ['name', 'description', 'category']) if (v[key] !== undefined) changes[key] = merge(old?.[key], v[key], key, conflicts);
    if (v.supply) changes.supply = Object.fromEntries(['packaging', 'samplePolicy', 'paymentTerms', 'shippingTerms', 'capacityNote'].map(k => [k, merge(old?.supply[k], v.supply[k], `supply.${k}`, conflicts) ?? '']));
    if (v.skus) {
      changes.skus = structuredClone(old?.skus || []);
      for (const sku of v.skus) {
        let next = changes.skus.find(s => s.code.toLowerCase() === sku.code.toLowerCase());
        if (!next) { next = { id: uuidFor([group, row.key, sku.code.toLowerCase()]), code: sku.code, specs: [], unit: '', moq: null, leadTimeDays: null }; changes.skus.push(next); }
        for (const key of ['unit', 'moq', 'leadTimeDays']) if (sku[key] !== undefined) next[key] = merge(next[key], sku[key], `sku:${sku.code}.${key}`, conflicts);
        for (const spec of sku.specs || []) {
          const existing = next.specs.find(s => s.key.toLowerCase() === spec.key.toLowerCase());
          if (existing) existing.value = merge(existing.value, spec.value, `sku:${sku.code}.spec:${spec.key}`, conflicts); else next.specs.push(structuredClone(spec));
        }
      }
    }
    if (v.images) {
      changes.images = structuredClone(old?.images || []);
      for (const image of v.images) if (!changes.images.some(i => i.asset.sha256 === image.asset.sha256)) changes.images.push({ id: uuidFor([group, row.key, image.asset.sha256]), ...image, order: changes.images.length, isPrimary: changes.images.length === 0 });
    }
    changes.documents = structuredClone(old?.documents || []);
    for (const sourceIndex of new Set(row.evidence.map(e => e.sourceIndex))) {
      const ref = sourceDocs[sourceIndex];
      if (!changes.documents.some(d => d.documentId === ref.documentId && d.documentVersion === ref.documentVersion)) changes.documents.push({ ...ref, purpose: 'Source-bound factory intake; interpretation requires review.' });
    }
    return Object.fromEntries(Object.entries(changes).filter(([k, v]) => v !== undefined && (!old || hash(old[k]) !== hash(v))));
  }
  function validateJournal(plan, input, group, fingerprint) {
    exact(plan, ['schema', 'fingerprint', 'group', 'input', 'operations', 'sourceDocs', 'pending', ...Object.keys(flags)]);
    if (plan.schema !== 'workspace.factory-ingestion.plan.v1' || plan.group !== group || plan.fingerprint !== fingerprint || hash(plan.input) !== hash(input)
      || Object.entries(flags).some(([k, v]) => plan[k] !== v) || !Array.isArray(plan.operations) || plan.operations.length > 61
      || !Array.isArray(plan.sourceDocs) || plan.sourceDocs.length !== input.sources.length || !Array.isArray(plan.pending)
      || new Set(plan.operations.map(o => o.key)).size !== plan.operations.length) fail('FACTORY_INGESTION_JOURNAL_INVALID');
    const rows = input.records.filter(r => r.kind !== 'document' && !r.evidence.some(e => e.observation));
    if (plan.pending.length !== rows.length || plan.pending.some(p => !rows.some(r => r.key === p.key && r.kind === p.kind))) fail('FACTORY_INGESTION_JOURNAL_INVALID');
    for (const op of plan.operations) {
      exact(op, ['method', 'args', 'key']);
      if (!Array.isArray(op.args)) fail('FACTORY_INGESTION_JOURNAL_INVALID');
      if (op.key.startsWith('source:')) {
        const index = Number(op.key.slice(7)), source = input.sources[index];
        if (!source || op.key !== `source:${index}` || !['createDocument', 'appendDocumentVersion'].includes(op.method)) fail('FACTORY_INGESTION_JOURNAL_INVALID');
        const classification = input.records.find(r => r.kind === 'document' && r.sourceIndex === index);
        const v = classification && !classification.evidence.some(e => e.observation) ? classification.values : {};
        const common = { requestId: uuidFor([group, 'source', index]), asset: source.asset, ...(v.certificate ? { certificate: v.certificate } : {}) };
        if (op.method === 'createDocument') {
          if (op.args.length !== 1 || hash(op.args[0]) !== hash({ ...common, title: v.title || 'Uploaded factory material', slotKey: v.slotKey || 'other' })) fail('FACTORY_INGESTION_JOURNAL_INVALID');
        } else {
          const doc = store.read().businessLibrary.documents.find(d => d.id === op.args[0]);
          if (op.args.length !== 2 || !doc?.versions.some(v => v.asset.artifactId === source.asset.artifactId)
            || hash(op.args[1]) !== hash({ ...common, expectedRevision: op.args[1].expectedRevision })) fail('FACTORY_INGESTION_JOURNAL_INVALID');
        }
      } else {
        const row = rows.find(r => r.key === op.key);
        if (!row) fail('FACTORY_INGESTION_JOURNAL_INVALID');
        if (row.kind === 'company') {
          if (op.method !== 'updateCompany' || op.args.length !== 1 || op.args[0].requestId !== uuidFor([group, row.key])) fail('FACTORY_INGESTION_JOURNAL_INVALID');
          exact(op.args[0], ['requestId', 'expectedRevision', 'changes']);
          const previous = store.read().businessLibrary.operations.find(o => o.requestId === op.args[0].requestId);
          if (!previous) {
            const current = store.read().businessLibrary.company, conflicts = [], changes = {};
            for (const k of ['legalName', 'displayName', 'description']) if (row.values[k] !== undefined) { const v = merge(current[k], row.values[k], k, conflicts); if (v !== current[k]) changes[k] = v; }
            if (hash(changes) !== hash(op.args[0].changes)) fail('FACTORY_INGESTION_JOURNAL_INVALID');
          }
        } else {
          if (!['createProduct', 'updateProduct'].includes(op.method) || op.args.length !== 4) fail('FACTORY_INGESTION_JOURNAL_INVALID');
          const [id, admission, savedRow, original] = op.args;
          exact(admission, ['requestId', 'expectedRevision']);
          if (hash(savedRow) !== hash(row) || admission.requestId !== uuidFor([group, row.key])
            || (op.method === 'createProduct' ? id !== null || original !== null || admission.expectedRevision !== null
              : !original || id !== original.id || admission.expectedRevision !== original.revision)) fail('FACTORY_INGESTION_JOURNAL_INVALID');
          if (original && !(row.recordId === id || original.skus.some(s => (row.values.skus || []).some(v => v.code.toLowerCase() === s.code.toLowerCase()))
            || !row.values.skus?.length && row.values.name?.toLowerCase() === original.name.toLowerCase())) fail('FACTORY_INGESTION_JOURNAL_INVALID');
        }
      }
    }
    for (const [i, ref] of plan.sourceDocs.entries()) {
      if (ref.sourceIndex !== undefined) {
        exact(ref, ['sourceIndex']); if (ref.sourceIndex >= i || ref.sourceIndex < 0 || input.sources[ref.sourceIndex]?.asset.sha256 !== input.sources[i].asset.sha256) fail('FACTORY_INGESTION_JOURNAL_INVALID');
      } else if (ref.operationKey !== undefined) {
        exact(ref, ['operationKey']); if (ref.operationKey !== `source:${i}` || !plan.operations.some(o => o.key === ref.operationKey && o.method === 'createDocument')) fail('FACTORY_INGESTION_JOURNAL_INVALID');
      } else {
        exact(ref, ['documentId', 'documentVersion']);
        const doc = store.read().businessLibrary.documents.find(d => d.id === ref.documentId), version = doc?.versions.find(v => v.version === ref.documentVersion);
        if (version ? version.asset.sha256 !== input.sources[i].asset.sha256 : !plan.operations.some(o => o.key === `source:${i}` && o.method === 'appendDocumentVersion' && o.args[0] === doc?.id)) fail('FACTORY_INGESTION_JOURNAL_INVALID');
      }
    }
  }
  async function saveIntake(raw, signal, model) {
    const input = validateIntake(raw); if (looksLikeCredential(JSON.stringify(input))) fail('FACTORY_INGESTION_UNSAFE', 403);
    await gate(signal, model, true);
    const reads = [];
    for (const s of input.sources) { const r = await read({ asset: s.asset }, signal, model); if (r.source.readHash !== s.readHash) fail('FACTORY_INGESTION_SOURCE_CHANGED'); reads.push(r); }
    for (const row of input.records) {
      if (row.kind !== 'document') {
        const direct = row.kind === 'company' ? companyFields : productFields.filter(f => !f.startsWith('supply.'));
        for (const key of Object.keys(row.values)) {
          if (direct.includes(key) && !scope.fields[row.kind].includes(key)) fail('FACTORY_INGESTION_FIELD_NOT_APPROVED', 403);
          if (key === 'supply') for (const f of Object.keys(row.values.supply)) if (!scope.fields.product.includes('supply.' + f)) fail('FACTORY_INGESTION_FIELD_NOT_APPROVED', 403);
        }
      }
      for (const e of row.evidence) {
        const source = reads[e.sourceIndex];
        if (e.observation === 'image-unverified') {
          const selected = input.sources[e.sourceIndex].asset;
          const mime = store.read().artifacts.find(a => a.id === selected.artifactId)?.versions.find(v => v.version === selected.version)?.mimeType;
          if (source.format !== 'image' || !mime?.startsWith('image/')) fail('FACTORY_INGESTION_IMAGE_EVIDENCE_REQUIRED');
        }
        else if (!['available', 'partial'].includes(source.status) || source.text.slice(e.start, e.end) !== e.quote) fail('FACTORY_INGESTION_QUOTE_MISMATCH');
      }
      for (const image of row.values.images || []) if (!scope.uploads.some(s => refKey(s) === refKey(image.asset)) || !store.read().artifacts.find(a => a.id === image.asset.artifactId)?.versions.find(v => v.version === image.asset.version)?.mimeType.startsWith('image/')) fail('FACTORY_INGESTION_IMAGE_NOT_APPROVED', 403);
    }
    const group = groupFor(input.requestId), fingerprint = hash({ input, identity: principal, conversationId, recipient: scope.recipient });
    let planArtifact = store.read().artifacts.find(a => a.requestId === journalKey(input.requestId)), plan;
    if (planArtifact) {
      if (planArtifact.metadata?.factoryIngestion?.fingerprint !== fingerprint || planArtifact.currentVersion !== 1
        || planArtifact.metadata.businessLibrary?.visibility !== 'internal' || planArtifact.sourceConversationId !== conversationId) fail('FACTORY_INGESTION_REQUEST_CHANGED');
      plan = JSON.parse((await artifacts.read(planArtifact.id, { version: 1 })).content);
    } else {
      const state = store.read(), lib = state.businessLibrary, operations = [], sourceDocs = [], pending = [];
      const add = (method, args, key) => { operations.push({ method, args, key }); };
      for (const [index, source] of input.sources.entries()) {
        const same = input.sources.findIndex((s, i) => i < index && s.asset.sha256 === source.asset.sha256);
        if (same >= 0) { sourceDocs.push({ sourceIndex: same }); continue; }
        const classification = input.records.find(r => r.kind === 'document' && r.sourceIndex === index);
        const values = classification && !classification.evidence.some(e => e.observation) ? classification.values : {};
        let doc = lib.documents.find(d => d.status === 'active' && d.versions.some(v => v.asset.sha256 === source.asset.sha256));
        let version = doc?.versions.find(v => v.asset.sha256 === source.asset.sha256)?.version;
        if (!doc) {
          // Version continuity comes only from original artifact identity, never a filename/model assertion.
          doc = lib.documents.find(d => d.status === 'active' && d.versions.some(v => v.asset.artifactId === source.asset.artifactId));
          if (doc) {
            add('appendDocumentVersion', [doc.id, { requestId: uuidFor([group, 'source', index]), expectedRevision: doc.revision, asset: source.asset, ...(values.certificate ? { certificate: values.certificate } : {}) }], `source:${index}`); version = doc.currentVersion + 1;
          } else {
            add('createDocument', [{ requestId: uuidFor([group, 'source', index]), title: values.title || 'Uploaded factory material', slotKey: values.slotKey || 'other', asset: source.asset, ...(values.certificate ? { certificate: values.certificate } : {}) }], `source:${index}`);
          }
        }
        sourceDocs.push(doc ? { documentId: doc.id, documentVersion: version } : { operationKey: `source:${index}` });
      }
      // All model observations remain in the private original artifact. Visual-only
      // observations are never automatically promoted into populated catalog fields.
      const catalogRows = input.records.filter(r => r.kind !== 'document' && !r.evidence.some(e => e.observation));
      const claimedSKUs = new Set();
      for (const row of catalogRows) {
        if (row.kind === 'company') {
          if (scope.companyRevision === null || lib.company.revision !== scope.companyRevision) fail('FACTORY_INGESTION_TARGET_NOT_APPROVED', 403);
          const conflicts = [], changes = {};
          for (const key of ['legalName', 'displayName', 'description']) if (row.values[key] !== undefined) changes[key] = merge(lib.company[key], row.values[key], key, conflicts);
          const changed = Object.fromEntries(Object.entries(changes).filter(([k, v]) => v !== undefined && v !== lib.company[k]));
          pending.push({ key: row.key, kind: row.kind, conflicts, recordId: 'company', revision: lib.company.revision, status: 'unchanged' });
          if (Object.keys(changed).length) add('updateCompany', [{ requestId: uuidFor([group, row.key]), expectedRevision: scope.companyRevision, changes: changed }], row.key);
          continue;
        }
        const codes = (row.values.skus || []).map(s => s.code.toLowerCase());
        for (const code of codes) { if (claimedSKUs.has(code)) fail('FACTORY_INGESTION_DUPLICATE_SKU'); claimedSKUs.add(code); }
        const matches = lib.products.filter(p => p.id === row.recordId || p.skus.some(s => codes.includes(s.code.toLowerCase())) || !codes.length && p.name.toLowerCase() === row.values.name?.toLowerCase());
        if (matches.length > 1 || row.recordId && matches[0]?.id !== row.recordId) fail('FACTORY_INGESTION_PRODUCT_IDENTITY_CONFLICT');
        const old = matches[0];
        if (old && (old.status === 'archived' || old.source?.kind === 'public_reference' || !scope.products.some(p => p.id === old.id && p.revision === old.revision)
          || row.expectedRevision !== undefined && old.revision !== row.expectedRevision)) fail('FACTORY_INGESTION_TARGET_NOT_APPROVED', 403);
        const conflicts = [];
        pending.push({ key: row.key, kind: row.kind, recordId: old?.id ?? null, revision: old?.revision ?? null, conflicts });
        // Resolve new document IDs after original create receipts, without a new id allocator/store.
        add(old ? 'updateProduct' : 'createProduct', [old?.id ?? null, { requestId: uuidFor([group, row.key]), expectedRevision: old?.revision ?? null }, row, old ?? null], row.key);
      }
      plan = { schema: 'workspace.factory-ingestion.plan.v1', fingerprint, group, input, operations, sourceDocs, pending, ...flags };
      const check = await gate(signal, model, true);
      const saved = await artifacts.create({ requestId: journalKey(input.requestId), filename: 'factory-ingestion-plan.json', content: JSON.stringify(plan),
        sourceConversationId: conversationId, metadata: { businessLibrary: { visibility: 'internal' }, factoryIngestion: { group, fingerprint, kind: 'plan', ...flags } } }, { check });
      planArtifact = saved.artifact;
    }
    validateJournal(plan, input, group, fingerprint);
    const resolved = structuredClone(plan.sourceDocs), outcomes = structuredClone(plan.pending);
    for (const op of plan.operations) {
      const check = await gate(signal, model, true), lib = guardedLibrary(check);
      let result;
      if (['createProduct', 'updateProduct'].includes(op.method)) {
        const [id, admission, row, original] = op.args, pending = outcomes.find(p => p.key === op.key);
        if (id && !scope.products.some(p => p.id === id)) fail('FACTORY_INGESTION_TARGET_NOT_APPROVED', 403);
        const sourceDocs = resolved.map(ref => ref.sourceIndex === undefined ? ref : resolved[ref.sourceIndex]);
        const changes = productChanges(row, original, plan.group, pending.conflicts, sourceDocs);
        // Reuse original durable operation body after a partial restart. Its response
        // is queried before recomputing changes so replay cannot overwrite later edits.
        const prior = store.read().businessLibrary.operations.find(o => o.requestId === admission.requestId);
        if (prior) { if (prior.actor !== identity.subject) fail('FACTORY_INGESTION_OPERATION_OWNER'); result = { ...prior.response, operation: { duplicate: true } }; }
        else {
          const old = id ? baseLibrary.getProduct(id).product : null;
          if (old && (old.revision !== admission.expectedRevision || hash(old) !== hash(original))) fail('FACTORY_INGESTION_TARGET_CHANGED');
          if (!id && !changes.name) { pending.status = 'needs-name'; continue; }
          if (id && !Object.keys(changes).length) { result = { product: old, operation: { duplicate: true } }; }
          else result = id ? await lib.updateProduct(id, { requestId: admission.requestId, expectedRevision: admission.expectedRevision, changes }, identity)
            : await lib.createProduct({ requestId: admission.requestId, ...changes }, identity);
        }
      } else {
        if (op.method === 'updateCompany' && scope.companyRevision === null) fail('FACTORY_INGESTION_TARGET_NOT_APPROVED', 403);
        result = await lib[op.method](...op.args, identity);
      }
      if (op.key.startsWith('source:')) {
        const index = Number(op.key.slice(7)); resolved[index] = { documentId: result.document.id, documentVersion: result.document.currentVersion };
      } else {
        const p = outcomes.find(p => p.key === op.key), record = result.product || result.company;
        Object.assign(p, { recordId: record.id, revision: record.revision, status: 'saved' });
      }
    }
    for (let i = 0; i < resolved.length; i++) if (resolved[i].sourceIndex !== undefined) resolved[i] = resolved[resolved[i].sourceIndex];
    const report = { schema: 'workspace.factory-ingestion.report.v1', ...flags, fingerprint: plan.fingerprint, input: plan.input,
      sources: reads.map(r => ({ source: r.source, status: r.status, textTruncated: r.textTruncated, notice: r.notice ?? null, ocrStatus: r.ocrStatus ?? null })),
      documents: resolved, outcomes, observationOnly: input.records.filter(r => r.evidence.some(e => e.observation)).map(r => r.key),
      provenanceMeaning: 'Original bytes and exact extracted-text fragments; model interpretation unverified. Not external certification or human confirmation.' };
    const check = await gate(signal, model, true);
    const savedReport = await artifacts.create({ requestId: 'factory-ingestion-report-' + group, filename: 'factory-ingestion-report.json', content: JSON.stringify(report),
      sourceConversationId: conversationId, metadata: { businessLibrary: { visibility: 'internal' }, factoryIngestion: { group, fingerprint, kind: 'report', ...flags } } }, { check });
    const reportDoc = await guardedLibrary(await gate(signal, model, true)).createDocument({ requestId: uuidFor([group, 'report']),
      title: 'Factory intake source report — unreviewed', slotKey: 'other', tags: ['factory-ingestion', 'unreviewed'], asset: originalAsset(savedReport.artifact) }, identity);
    await gate(signal, model, true);
    return { plugin: INGESTION_PLUGIN, status: 'saved', ...flags, requestId: input.requestId, outcomes, documents: resolved,
      report: { ...originalAsset(savedReport.artifact), documentId: reportDoc.document.id, documentVersion: 1 }, plan: originalAsset(planArtifact) };
  }
  async function query(input, signal, model) {
    exact(input, ['requestId']); if (typeof input.requestId !== 'string' || !input.requestId.length || input.requestId.length > 128) fail('FACTORY_INGESTION_QUERY_INVALID', 400);
    await gate(signal, model);
    const group = groupFor(input.requestId), state = store.read(), lib = state.businessLibrary;
    const journal = state.artifacts.find(a => a.requestId === journalKey(input.requestId));
    if (!journal) return { plugin: INGESTION_PLUGIN, status: 'incomplete', ...flags, requestId: input.requestId, resume: 'Replay the exact original save body; original partial writes may exist.' };
    if (journal.currentVersion !== 1 || journal.sourceConversationId !== conversationId || journal.metadata?.businessLibrary?.visibility !== 'internal') fail('FACTORY_INGESTION_JOURNAL_INVALID');
    const plan = JSON.parse((await artifacts.read(journal.id, { version: 1 })).content);
    const fingerprint = hash({ input: plan.input, identity: principal, conversationId, recipient: scope.recipient });
    validateJournal(plan, validateIntake(plan.input), group, fingerprint);
    // Reauthorize every ORIGINAL source before any old report/conflict text can
    // be redisclosed. Current selected uploads alone do not authorize this batch.
    for (const source of plan.input.sources) {
      const fresh = await read({ asset: source.asset }, signal, model);
      if (hash(source) !== hash(fresh.source)) fail('FACTORY_INGESTION_SOURCE_CHANGED');
    }
    const record = state.artifacts.find(a => a.requestId === 'factory-ingestion-report-' + group);
    const reportOperation = lib.operations.find(o => o.requestId === uuidFor([group, 'report']));
    if (!record || !reportOperation) {
      const outcomes = plan.pending.map(row => {
        const op = lib.operations.find(o => o.requestId === uuidFor([group, row.key]));
        if (op && op.actor !== identity.subject) fail('FACTORY_INGESTION_OPERATION_OWNER');
        const committed = op?.response[row.kind];
        return { key: row.key, kind: row.kind, recordId: committed?.id ?? null, revision: committed?.revision ?? null, status: committed ? 'saved' : 'pending' };
      });
      await gate(signal, model);
      return { plugin: INGESTION_PLUGIN, status: 'partial', ...flags, requestId: input.requestId,
        plan: originalAsset(journal), outcomes, reason: 'ORIGINAL_LIBRARY_INGESTION_INCOMPLETE', resume: 'Replay the exact original save body; original partial writes may exist.' };
    }
    if (record.metadata?.factoryIngestion?.group !== group || record.metadata.factoryIngestion.fingerprint !== fingerprint
      || record.sourceConversationId !== conversationId || record.metadata.businessLibrary?.visibility !== 'internal' || record.currentVersion !== 1) fail('FACTORY_INGESTION_REPORT_CHANGED');
    const reportDocument = lib.documents.find(d => d.id === reportOperation.response.document?.id);
    if (reportOperation.actor !== identity.subject || reportDocument?.status !== 'active' || reportDocument.currentVersion !== 1
      || hash(reportDocument.versions[0].asset) !== hash(originalAsset(record))) fail('FACTORY_INGESTION_REPORT_CHANGED');
    const report = JSON.parse((await artifacts.read(record.id, { version: 1 })).content);
    if (hash(report.input) !== hash(plan.input) || report.fingerprint !== fingerprint || !Array.isArray(report.outcomes)
      || report.outcomes.length !== plan.pending.length || Object.entries(flags).some(([k, v]) => report[k] !== v)) fail('FACTORY_INGESTION_REPORT_CHANGED');
    for (const outcome of report.outcomes) {
      const pending = plan.pending.find(p => p.key === outcome.key && p.kind === outcome.kind);
      const committed = lib.operations.find(o => o.requestId === uuidFor([group, outcome.key]));
      const saved = committed?.response[outcome.kind];
      const originalOperation = plan.operations.find(o => o.key === outcome.key);
      if (outcome.kind === 'company' && scope.companyRevision === null || outcome.kind === 'product' && originalOperation?.args[0]
        && !scope.products.some(p => p.id === originalOperation.args[0])) fail('FACTORY_INGESTION_TARGET_NOT_APPROVED', 403);
      if (!pending || (saved ? saved.id !== outcome.recordId || saved.revision !== outcome.revision || committed.actor !== identity.subject
        : pending.recordId !== outcome.recordId || pending.revision !== outcome.revision && outcome.status !== 'needs-name')) fail('FACTORY_INGESTION_REPORT_CHANGED');
    }
    const records = report.outcomes.map(o => ({ key: o.key, kind: o.kind, recordId: o.recordId, revision: o.revision ?? null,
      current: o.kind === 'product' ? lib.products.find(p => p.id === o.recordId) ?? null : lib.company }));
    // Only the exact saved projection can be redisclosed; a later human edit needs
    // fresh host selection. Do not leak its new content through a stale batch.
    for (const row of records) if (row.current && row.current.revision !== row.revision) fail('FACTORY_INGESTION_QUERY_REAUTHORIZE', 403);
    // The saved report may contain prior protected values in conflict notes;
    // refuse redisclosure if the original field scope has since narrowed.
    for (const row of plan.input.records.filter(r => r.kind !== 'document')) for (const field of Object.keys(row.values)) {
      if ((row.kind === 'company' ? companyFields : productFields).includes(field) && !scope.fields[row.kind].includes(field)) fail('FACTORY_INGESTION_FIELD_NOT_APPROVED', 403);
      if (field === 'supply') for (const k of Object.keys(row.values.supply)) if (!scope.fields.product.includes('supply.' + k)) fail('FACTORY_INGESTION_FIELD_NOT_APPROVED', 403);
    }
    await gate(signal, model); return { plugin: INGESTION_PLUGIN, status: 'available', ...flags, requestId: input.requestId, report,
      records: records.map(r => ({ ...r, current: projection(r.current, r.kind) })) };
  }
  async function save(input, signal, model) {
    try { return await saveIntake(input, signal, model); }
    catch (error) {
      if (signal?.aborted || error?.name === 'AbortError' || [400, 401, 403, 404, 409].includes(error?.status)) throw error;
      const progress = await query({ requestId: validateIntake(input).requestId }, signal, model);
      if (progress.status === 'partial') return progress;
      throw error;
    }
  }
  async function revalidateReceipt(receipt, model, signal, nativeContent) {
    if (receipt?.plugin !== INGESTION_PLUGIN) fail('FACTORY_INGESTION_CACHE_CHANGED', 403);
    let current;
    if (!receipt?.source && nativeContent?.length) fail('FACTORY_INGESTION_CACHE_CHANGED', 403);
    if (receipt?.source) {
      current = await read({ asset: receipt.source.asset }, signal, model);
      if (nativeContent !== undefined && hash(nativeContent) !== hash(current.nativeContent)) fail('FACTORY_INGESTION_CACHE_CHANGED', 403);
      const { nativeContent: _images, ...data } = current; current = data;
    } else if (receipt?.status === 'saved') {
      const q = await query({ requestId: receipt.requestId }, signal, model);
      if (q.status !== 'available') fail('FACTORY_INGESTION_CACHE_CHANGED', 403);
      const state = store.read(), group = groupFor(receipt.requestId), a = state.artifacts.find(a => a.requestId === 'factory-ingestion-report-' + group);
      const p = state.artifacts.find(a => a.requestId === journalKey(receipt.requestId));
      const doc = state.businessLibrary.documents.find(d => d.versions.some(v => refKey(v.asset) === refKey(originalAsset(a))));
      if (!doc || doc.currentVersion !== 1 || doc.status !== 'active') fail('FACTORY_INGESTION_CACHE_CHANGED', 403);
      current = { plugin: INGESTION_PLUGIN, status: 'saved', ...flags, requestId: receipt.requestId, outcomes: q.report.outcomes,
        documents: q.report.documents, report: { ...originalAsset(a), documentId: doc.id, documentVersion: 1 }, plan: originalAsset(p) };
    } else if (receipt?.requestId) {
      current = await query({ requestId: receipt.requestId }, signal, model);
    }
    else current = await status({}, signal, model);
    if (receipt?.status === 'partial') {
      exact(receipt, ['plugin', 'status', ...Object.keys(flags), 'requestId', 'plan', 'outcomes', 'reason', 'resume']);
      if (Object.entries(flags).some(([k, v]) => receipt[k] !== v) || receipt.reason !== 'ORIGINAL_LIBRARY_INGESTION_INCOMPLETE'
        || receipt.resume !== 'Replay the exact original save body; original partial writes may exist.' || !Array.isArray(receipt.outcomes)) fail('FACTORY_INGESTION_CACHE_CHANGED', 403);
      const journal = store.read().artifacts.find(a => a.requestId === journalKey(receipt.requestId));
      if (!journal || hash(originalAsset(journal)) !== hash(receipt.plan)) fail('FACTORY_INGESTION_CACHE_CHANGED', 403);
      const plan = JSON.parse((await artifacts.read(journal.id, { version: 1 })).content);
      if (receipt.outcomes.length !== plan.pending.length) fail('FACTORY_INGESTION_CACHE_CHANGED', 403);
      for (const [index, row] of receipt.outcomes.entries()) {
        exact(row, ['key', 'kind', 'recordId', 'revision', 'status']);
        const expected = plan.pending[index], op = store.read().businessLibrary.operations.find(o => o.requestId === uuidFor([groupFor(receipt.requestId), expected.key]));
        const record = op?.response[expected.kind];
        if (row.key !== expected.key || row.kind !== expected.kind || (row.status === 'pending'
          ? row.recordId !== null || row.revision !== null
          : row.status !== 'saved' || record?.id !== row.recordId || record?.revision !== row.revision || op.actor !== identity.subject)) fail('FACTORY_INGESTION_CACHE_CHANGED', 403);
      }
    } else if (hash(current) !== hash(receipt)) fail('FACTORY_INGESTION_CACHE_CHANGED', 403);
    await gate(signal, model);
  }
  return Object.freeze({ status, read, save, query, revalidateReceipt });
}
