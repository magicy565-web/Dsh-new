import { randomUUID } from 'node:crypto';
import { blankSupplierProfile, normalizeSupplierProfile, supplierFail, supplierHash, supplierListingPreview } from './supplier-profile.mjs';
import { supplierAdmission, supplierDto, supplierFind, supplierOwned, supplierRegistry, supplierRequest } from './supplier-draft.mjs';

export const supplierUuid = value => { const hash = supplierHash(value); return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`; };
export function createSupplierService({ store, runtime, provider, businessLibrary, artifacts, shopify, capabilities, clock = Date.now, monitoring }) {
  const now = () => new Date(clock()).toISOString();
  const saved = store.read().workspaceSupplierServices;
  if (saved && (saved.version !== 1 || !['services', 'commands', 'monitors'].every(field => Array.isArray(saved[field])))) supplierFail(409, 'SUPPLIER_STORE_INVALID', 'Preserve and review the original supplier store.');
  const actorFor = actor => ({ subject: actor.subject, workspaceId: actor.workspaceId || 'local', role: actor.role });
  function command(state, actor, id, action, body, work) {
    const data = supplierRegistry(state), fingerprint = supplierHash({ id, action, body }), previous = data.commands.find(entry => entry.subject === actor.subject && entry.workspaceId === actor.workspaceId && entry.requestId === body.requestId);
    if (previous) { if (previous.fingerprint !== fingerprint) supplierFail(409, 'IDEMPOTENCY_CONFLICT', 'Keep the exact original supplier request.'); return { ...structuredClone(previous.result), duplicate: true }; }
    if (data.commands.length >= 4000) supplierFail(409, 'SUPPLIER_CAPACITY_LIMIT', 'Original supplier command receipts need operator review.');
    const result = work(); data.commands.push({ subject: actor.subject, workspaceId: actor.workspaceId, requestId: body.requestId, fingerprint, result: structuredClone(result), committedAt: now() }); return result;
  }
  async function imageAvailability(profile) {
    const available = [];
    for (const image of profile.images) {
      if (image.kind !== 'artifact') { available.push('unknown'); continue; }
      try { const file = await artifacts.download(image.asset.artifactId, { version: image.asset.version }); available.push(file.version.sha256 === image.asset.sha256 && file.mimeType.startsWith('image/') ? 'available' : 'unavailable'); }
      catch { available.push('unavailable'); }
    }
    return available;
  }
  const service = {
    catalog() { return { name: 'Cnsubscribe Agent Service', executionKernel: 'Pi Agent SDK 1.1.0', persistence: 'original Workspace business Store; pi-durable execution checkpoints', services: [{ id: 'supplier-listing-monitor', title: '供应商产品与零售 Listing', capabilities: ['private_intake', 'retail_preview', 'original_product_library', 'configured_shopify_observation', 'seven_day_monitor'], shopify: shopify.status(), writesEnabled: false, trafficStatus: 'unsupported' }] }; },
    forActor(context) {
      const actor = actorFor(context);
      const find = (cid, id, state = store.read()) => supplierFind(state, actor, cid, id);
      const get = (cid, id) => supplierDto(store.read(), find(cid, id));
      const requireRevision = (row, body) => { if (row.revision !== body.expectedRevision) supplierFail(409, 'SUPPLIER_REVISION_CONFLICT', 'Refresh the exact supplier revision before changing it.'); };
      const result = {
        get, list(cid) { supplierOwned(store.read(), actor, cid); return (store.read().workspaceSupplierServices?.services || []).filter(row => row.conversationId === cid && row.subject === actor.subject && row.workspaceId === actor.workspaceId).map(row => supplierDto(store.read(), row)); },
        async request(cid, body, id) {
          if (body.facts !== undefined && !id) {
            supplierRequest(body, ['facts']); supplierOwned(store.read(), actor, cid);
            const profile = normalizeSupplierProfile(body.facts);
            return store.update(state => command(state, actor, null, 'create_profile', body, () => { const row = { id: randomUUID(), subject: actor.subject, workspaceId: actor.workspaceId, conversationId: cid, revision: 1, profile, profileHash: supplierHash(profile), versions: [{ phase: 'saved' }], messages: [], preview: null, productReference: null, createdAt: now(), updatedAt: now() }; supplierRegistry(state).services.push(row); return { serviceId: row.id, revision: row.revision, service: supplierDto(state, row) }; }));
          }
          if (provider.kind !== 'pi-durable') supplierFail(409, 'PI_SUPPLIER_REQUIRED', 'The supplier agent requires the existing reviewed Pi runtime.');
          const ctx = supplierAdmission(store.read(), actor, cid, body, id);
          const response = await runtime.sendMessage(cid, { content: body.content, requestId: body.requestId, inputContext: ctx.selection, workspaceExecution: true }, { supplierDraftContext: ctx });
          const admitted = store.read().runs.find(run => run.id === response.run.id)?.supplierDraftContext;
          return { ...response, serviceId: admitted?.serviceId || ctx.serviceId, revision: admitted?.revision || ctx.revision };
        },
        async profile(cid, id, body) {
          supplierRequest(body, ['expectedRevision', 'facts']); const facts = normalizeSupplierProfile(body.facts, find(cid, id).profile);
          return store.update(state => command(state, actor, id, 'profile', body, () => { const row = find(cid, id, state); requireRevision(row, body); if (state.runs.some(run => run.id === row.versions.at(-1)?.runId && ['running', 'queued', 'interrupted'].includes(run.status))) supplierFail(409, 'SUPPLIER_BUSY', 'Stop or reconcile the original intake before editing facts.'); row.revision++; row.profile = facts; row.profileHash = supplierHash(facts); row.preview = null; row.versions.push({ phase: 'saved' }); row.updatedAt = now(); return { service: supplierDto(state, row) }; }));
        },
        async preview(cid, id, body) {
          supplierRequest(body, ['expectedRevision', 'confirmed', 'publicFields']); if (body.confirmed !== true) supplierFail(400, 'SUPPLIER_PUBLIC_CONFIRMATION_REQUIRED', 'Confirm the exact retail fields allowed in this preview.');
          const before = find(cid, id), available = await imageAvailability(before.profile), preview = supplierListingPreview(before.profile, body.publicFields, available);
          return store.update(state => command(state, actor, id, 'preview', body, () => { const row = find(cid, id, state); requireRevision(row, body); if (supplierHash(row.profile) !== supplierHash(before.profile)) supplierFail(409, 'SUPPLIER_REVISION_CONFLICT', 'The image/profile scope changed.'); row.revision++; row.preview = { ...preview, id: randomUUID(), profileHash: supplierHash(row.profile), previewHash: supplierHash(preview), contentHash: supplierHash(preview), revision: row.revision, generatedAt: now() }; row.updatedAt = now(); return { service: supplierDto(state, row), preview: row.preview }; }));
        },
        async image(cid, id, index) { const row = find(cid, id), source = row.profile.images[index]; if (source?.kind !== 'artifact') supplierFail(404, 'SUPPLIER_IMAGE_UNAVAILABLE', 'An exact saved image source is required.'); const file = await artifacts.download(source.asset.artifactId, { version: source.asset.version }); if (file.version.sha256 !== source.asset.sha256 || !file.mimeType.startsWith('image/')) supplierFail(409, 'SUPPLIER_IMAGE_UNAVAILABLE', 'The original image is unavailable.'); return file; },
        async saveProduct(cid, id, body) {
          supplierRequest(body, ['expectedRevision', 'confirmed']); if (body.confirmed !== true) supplierFail(400, 'SUPPLIER_CONFIRMATION_REQUIRED', 'Confirm saving the exact private product facts.');
          const operationId = supplierUuid(['supplier-library', actor, id, body.requestId]);
          await store.update(state => { const row = find(cid, id, state); if (row.productSave) { if (row.productSave.requestId !== body.requestId || row.productSave.fingerprint !== supplierHash(body)) supplierFail(409, 'SUPPLIER_SAVE_PENDING', 'Reconcile the original library save request.'); return; } requireRevision(row, body); if (!row.profile.name) supplierFail(409, 'SUPPLIER_PRODUCT_NAME_REQUIRED', 'Clarify the product name first.'); row.productSave = { requestId: body.requestId, fingerprint: supplierHash(body), profile: structuredClone(row.profile), operationId, existing: row.productReference }; });
          const save = find(cid, id).productSave, profile = save.profile;
          const sku = profile.skuCode ? [{ id: supplierUuid(['supplier-sku', id]), code: profile.skuCode, unit: profile.supplierUnit || '', moq: profile.supplierMoq, leadTimeDays: profile.productionDays || null,
            ...(profile.wholesaleUnitPrice && profile.wholesaleCurrency && profile.supplierMoq ? { pricingMode: 'tiered', priceTiers: [{ minQuantity: profile.supplierMoq, unitPrice: profile.wholesaleUnitPrice, currency: profile.wholesaleCurrency }] } : {}) }] : [];
          const changes = { name: profile.name, description: profile.description || '', skus: sku, images: profile.images.filter(image => image.kind === 'artifact').map((image, index) => ({ id: supplierUuid(['supplier-image', id, image.asset]), asset: image.asset, alt: image.sourceNote, order: index, isPrimary: index === 0 })) };
          const response = save.existing ? await businessLibrary.updateProduct(save.existing.productId, { requestId: operationId, expectedRevision: save.existing.productRevision, changes }, actor) : await businessLibrary.createProduct({ requestId: operationId, ...changes }, actor);
          return store.update(state => { const row = find(cid, id, state); if (row.productSave.fingerprint !== save.fingerprint) supplierFail(409, 'SUPPLIER_SAVE_PENDING', 'The original private product save changed.'); row.productReference = { productId: response.product.id, productRevision: response.product.revision }; row.productSave.status = 'done'; return { service: supplierDto(state, row), product: response.product, duplicate: !!response.operation.duplicate }; });
        },
        async observe(cid, id, body) {
          supplierRequest(body, ['requestId', 'expectedRevision', 'shopifyProductId', 'publicationId', 'confirmed']); if (body.confirmed !== true) supplierFail(400, 'SUPPLIER_CONFIRMATION_REQUIRED', 'Confirm the exact existing Shopify product/publication to read.');
          const before = find(cid, id); requireRevision(before, body);
          if (!shopify.status().configured) return { service: get(cid, id), status: 'blocked', error: { code: 'SHOPIFY_SETUP_REQUIRED' } };
          await shopify.verify(); const observed = await shopify.readProductPublication({ productId: body.shopifyProductId, publicationId: body.publicationId || null });
          return store.update(state => command(state, actor, id, 'observe', body, () => { const row = find(cid, id, state); requireRevision(row, body); row.revision++; row.external = { ...observed, status: observed.published ? 'published' : observed.productStatus === 'DRAFT' ? 'shopify_draft' : 'unpublished', observedAt: now() }; return { service: supplierDto(state, row), observation: row.external }; }));
        },
        async shopifyDraft(cid, id, body) { supplierRequest(body, ['expectedRevision', 'expectedPreviewHash', 'confirmed']); const row = find(cid, id); requireRevision(row, body); if (body.confirmed !== true || row.preview?.previewHash !== body.expectedPreviewHash) supplierFail(409, 'SUPPLIER_PREVIEW_REQUIRED', 'Confirm the exact reviewed preview.'); return { service: get(cid, id), status: 'blocked', error: { code: shopify.status().configured ? 'SHOPIFY_PRODUCT_WRITE_NOT_AUTHORIZED' : 'SHOPIFY_SETUP_REQUIRED' }, externalStatus: row.external?.status || 'preview' }; },
      };
      if (monitoring) Object.assign(result, monitoring.forActor(actor, { find, get, command, requireRevision }));
      return result;
    },
  };
  return service;
}

export async function supplierServiceHttp({ service, req, res, pathname, context, body, respond }) {
  if (req.method === 'GET' && pathname === '/api/agent-services') { await respond(res, 200, service.catalog()); return true; }
  const match = pathname.match(/^\/api\/conversations\/([^/]+)\/supplier-services(?:\/([^/]+)(?:\/(messages|profile|preview|save-product|shopify-observation|shopify-draft|monitors|monitor-check|monitor-stop|monitor-summary|images)(?:\/([^/]+))?)?)?$/);
  if (!match) return false;
  let cid; try { cid = decodeURIComponent(match[1]); } catch { supplierFail(400, 'INVALID_PATH', 'Encode the original conversation ID once.'); }
  const [, , id, op, detail] = match, bound = service.forActor(context);
  if (req.method === 'GET') {
    if (op === 'images' && /^\d{1,2}$/.test(detail)) { const file = await bound.image(cid, id, Number(detail)); res.writeHead(200, { 'Content-Type': file.mimeType, 'Content-Length': file.bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(file.bytes); return true; }
    const value = op === 'monitors' ? { monitors: bound.monitors(cid, id) } : op === 'monitor-summary' ? { summary: bound.summary(cid, id, detail) } : id ? { service: bound.get(cid, id) } : { services: bound.list(cid) };
    await respond(res, 200, value); return true;
  }
  if (req.method === 'POST') {
    const value = !id || op === 'messages' ? await bound.request(cid, body, id) : op === 'profile' ? await bound.profile(cid, id, body) : op === 'preview' ? await bound.preview(cid, id, body) : op === 'save-product' ? await bound.saveProduct(cid, id, body) : op === 'shopify-observation' ? await bound.observe(cid, id, body) : op === 'shopify-draft' ? await bound.shopifyDraft(cid, id, body) : op === 'monitors' ? await bound.createMonitor(cid, id, body) : op === 'monitor-check' ? await bound.checkMonitor(cid, id, body) : op === 'monitor-stop' ? await bound.stopMonitor(cid, id, body) : supplierFail(405, 'SUPPLIER_METHOD_INVALID', 'Use documented original supplier service operations.');
    await respond(res, !id || op === 'messages' ? 202 : 200, value); return true;
  }
  supplierFail(405, 'SUPPLIER_METHOD_INVALID', 'Supplier services use GET and explicit POST operations.');
}
