import { randomUUID } from 'node:crypto';
import { blankSupplierProfile, normalizeSupplierProfile, supplierFail, supplierHash, supplierListingPreview } from './supplier-profile.mjs';
import { assertSupplierProductSource, supplierAdmission, supplierDto, supplierFind, supplierOwned, supplierRegistry, supplierRequest } from './supplier-draft.mjs';
import { isOriginalMuseArtifact } from './muse-owner-policy.mjs';

export const supplierUuid = value => { const hash = supplierHash(value); return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`; };
export function createSupplierService({ store, runtime, provider, businessLibrary, artifacts, shopify, capabilities, clock = Date.now, monitoring, readMuseImage, notifications, publicationStatus = () => null, ownerMcpConfigured = false, ownerSessionMcpAvailable = false }) {
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
  async function originalImage(actor, cid, ref) {
    if (isOriginalMuseArtifact(store.read(), ref.artifactId)) { if (!readMuseImage) supplierFail(404, 'SUPPLIER_IMAGE_UNAVAILABLE', 'Use the original owned Muse Session file protocol.'); return readMuseImage(actor, cid, ref); }
    return artifacts.download(ref.artifactId, { version: ref.version });
  }
  async function imageAvailability(profile, actor, cid) {
    const available = [];
    for (const image of profile.images) {
      if (image.kind !== 'artifact') { available.push('unknown'); continue; }
      try { const file = await originalImage(actor, cid, image.asset); available.push(file.version.sha256 === image.asset.sha256 && file.mimeType.startsWith('image/') ? 'available' : 'unavailable'); }
      catch { available.push('unavailable'); }
    }
    return available;
  }
  const service = {
    // Process-private proposal mapping into the ORIGINAL supplier record and
    // command receipt. The caller supplies the live original source/Run guard.
    // It proposes unreviewed content; it cannot decide or consume an approval.
    async proposeProduct({ actor, conversationId, runId = null, requestId, facts, source }, { assertCurrent } = {}) {
      if (typeof assertCurrent !== 'function') supplierFail(403, 'SHOPIFY_PRODUCT_SOURCE_CHANGED', 'Use the original source and Run guard.');
      supplierRequest({ requestId, facts }, ['facts']);
      const profile = normalizeSupplierProfile(facts), availability = await imageAvailability(profile, actor, conversationId);
      const preview = supplierListingPreview(profile, ['name', 'description', 'skuCode', 'retailUnit', 'unitsPerPack', 'consumerPrice', 'handlingDays', 'shippingDays', 'images'], availability);
      // Keep the chosen prose rather than the legacy retail paragraph template.
      const escape = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      preview.product.descriptionHtml = '<p>' + escape(profile.description) + '</p>';
      preview.display.paragraphs = [profile.description];
      preview.contentOrigin = 'model-draft-unverified'; preview.humanReviewed = false;
      const body = { requestId, facts: profile, source };
      return store.update(state => {
        const checked = assertCurrent(state);
        if (checked === false || checked && typeof checked.then === 'function') { checked?.catch?.(() => {}); supplierFail(403, 'SHOPIFY_PRODUCT_SOURCE_CHANGED', 'Use the original synchronous source and Run guard.'); }
        supplierOwned(state, actor, conversationId);
        const check = { productSource: source, preview }; assertSupplierProductSource(state, check);
        return command(state, actor, null, `product_proposal:${conversationId}`, body, () => {
          if (supplierRegistry(state).services.length >= 500) supplierFail(409, 'SUPPLIER_CAPACITY_LIMIT', 'Original supplier service capacity needs operator review.');
          const createdAt = now(), row = { id: randomUUID(), subject: actor.subject, workspaceId: actor.workspaceId, conversationId,
            revision: 1, profile, profileHash: supplierHash(profile), versions: [{ phase: 'saved', runId }], messages: [],
            productReference: { productId: source.productId, productRevision: source.revision }, productSource: structuredClone(source),
            preview: { ...preview, id: randomUUID(), previewHash: supplierHash(preview), contentHash: supplierHash(preview), revision: 1, generatedAt: createdAt }, createdAt, updatedAt: createdAt };
          supplierRegistry(state).services.push(row); return { serviceId: row.id };
        });
      });
    },
    catalog() {
      const publication = publicationStatus(), traffic = monitoring?.trafficStatus?.() || { supported: true, configured: false, status: 'unconfigured', observationRequired: true };
      return { name: 'Cnsubscribe Agent Service', executionKernel: 'Pi Agent SDK 1.1.0', persistence: 'original Workspace business Store; pi-durable execution checkpoints', services: [{ id: 'supplier-listing-monitor', title: '供应商产品与零售 Listing', capabilities: ['private_intake', 'retail_preview', 'original_product_library', 'configured_shopify_observation', 'approved_shopify_publication', 'seven_day_monitor', 'exact_product_traffic'], shopify: shopify.status(),
        writesEnabled: publication?.writesEnabled === true && publication.connectorStatus === 'ready',
        publication: { supported: true, configured: publication?.configured === true, hostEnabled: publication?.enabled === true, connectorStatus: publication?.connectorStatus || 'not_configured', reviewRequired: true, automaticRetry: false },
        trafficStatus: traffic.status, traffic,
        ownerMcp: { supported: true, configured: ownerMcpConfigured, status: ownerMcpConfigured ? 'configured_unverified' : 'binding_required', originalGrantRequired: true },
        ownerSessionMcp: { supported: true, available: ownerSessionMcpAvailable, status: ownerSessionMcpAvailable ? 'original_session_required' : 'enterprise_session_required', authentication: 'original_signed_workspace_session', externalConnectorGrant: false },
      }] };
    },
    forActor(context) {
      const actor = actorFor(context);
      const find = (cid, id, state = store.read()) => supplierFind(state, actor, cid, id);
      const get = (cid, id) => supplierDto(store.read(), find(cid, id));
      const requireRevision = (row, body) => { if (row.revision !== body.expectedRevision) supplierFail(409, 'SUPPLIER_REVISION_CONFLICT', 'Refresh the exact supplier revision before changing it.'); };
      const mutable = (row, state = store.read()) => { if (row.cancelledAt || row.rejectedAt) supplierFail(409, 'SUPPLIER_INTAKE_STOPPED', 'Preserve the rejected or cancelled intake; start a separately reviewed service.'); if (state.runs.some(run => run.id === row.versions.at(-1)?.runId && ['running', 'queued', 'interrupted'].includes(run.status)) || row.productSaves?.some(save => save.status !== 'done')) supplierFail(409, 'SUPPLIER_BUSY', 'Reconcile the original Pi run or product save before editing.'); };
      const result = {
        get, async readImage(cid, id, ref) { const row = find(cid, id); if (!row.preview?.images.some(image => image.kind === 'artifact' && supplierHash(image.asset) === supplierHash(ref))) supplierFail(404, 'SUPPLIER_IMAGE_UNAVAILABLE', 'Use the exact explicitly reviewed original supplier image.'); return originalImage(actor, cid, ref); }, list(cid) { supplierOwned(store.read(), actor, cid); return (store.read().workspaceSupplierServices?.services || []).filter(row => row.conversationId === cid && row.subject === actor.subject && row.workspaceId === actor.workspaceId).map(row => supplierDto(store.read(), row)); },
        async request(cid, body, id) {
          if (body.facts !== undefined && !id) {
            supplierRequest(body, ['facts']); supplierOwned(store.read(), actor, cid);
            const profile = normalizeSupplierProfile(body.facts);
            return store.update(state => command(state, actor, null, `create_profile:${cid}`, body, () => { const row = { id: randomUUID(), subject: actor.subject, workspaceId: actor.workspaceId, conversationId: cid, revision: 1, profile, profileHash: supplierHash(profile), versions: [{ phase: 'saved' }], messages: [], preview: null, productReference: null, createdAt: now(), updatedAt: now() }; supplierRegistry(state).services.push(row); return { serviceId: row.id, revision: row.revision, service: supplierDto(state, row) }; }));
          }
          if (provider.kind !== 'pi-durable') supplierFail(409, 'PI_SUPPLIER_REQUIRED', 'The supplier agent requires the existing reviewed Pi runtime.');
          const ctx = supplierAdmission(store.read(), actor, cid, body, id);
          const response = await runtime.sendMessage(cid, { content: body.content, requestId: body.requestId, inputContext: ctx.selection, workspaceExecution: true }, { supplierDraftContext: ctx });
          const admitted = store.read().runs.find(run => run.id === response.run.id)?.supplierDraftContext;
          return { ...response, serviceId: admitted?.serviceId || ctx.serviceId, revision: admitted?.revision || ctx.revision };
        },
        async profile(cid, id, body) {
          supplierRequest(body, ['expectedRevision', 'facts']); const facts = normalizeSupplierProfile(body.facts, find(cid, id).profile);
          return store.update(state => command(state, actor, id, 'profile', body, () => { const row = find(cid, id, state); requireRevision(row, body); mutable(row, state); row.revision++; row.profile = facts; row.profileHash = supplierHash(facts); row.preview = null; row.versions.push({ phase: 'saved' }); row.updatedAt = now(); return { service: supplierDto(state, row) }; }));
        },
        async preview(cid, id, body) {
          supplierRequest(body, ['expectedRevision', 'confirmed', 'publicFields']); if (body.confirmed !== true) supplierFail(400, 'SUPPLIER_PUBLIC_CONFIRMATION_REQUIRED', 'Confirm the exact retail fields allowed in this preview.');
          const before = find(cid, id); mutable(before); const available = await imageAvailability(before.profile, actor, cid), preview = supplierListingPreview(before.profile, body.publicFields, available);
          return store.update(state => command(state, actor, id, 'preview', body, () => { const row = find(cid, id, state); requireRevision(row, body); if (supplierHash(row.profile) !== supplierHash(before.profile)) supplierFail(409, 'SUPPLIER_REVISION_CONFLICT', 'The image/profile scope changed.'); row.revision++; row.preview = { ...preview, id: randomUUID(), profileHash: supplierHash(row.profile), previewHash: supplierHash(preview), contentHash: supplierHash(preview), revision: row.revision, generatedAt: now() }; row.updatedAt = now(); return { service: supplierDto(state, row), preview: row.preview }; }));
        },
        async image(cid, id, index) { const row = find(cid, id), source = row.profile.images[index]; if (source?.kind !== 'artifact') supplierFail(404, 'SUPPLIER_IMAGE_UNAVAILABLE', 'An exact saved image source is required.'); const file = await originalImage(actor, cid, source.asset); if (file.version.sha256 !== source.asset.sha256 || !file.mimeType.startsWith('image/')) supplierFail(409, 'SUPPLIER_IMAGE_UNAVAILABLE', 'The original image is unavailable.'); return file; },
        async saveProduct(cid, id, body) {
          supplierRequest(body, ['expectedRevision', 'confirmed']); if (body.confirmed !== true) supplierFail(400, 'SUPPLIER_CONFIRMATION_REQUIRED', 'Confirm saving the exact private product facts.');
          const operationId = supplierUuid(['supplier-library', actor.subject, actor.workspaceId, id, body.requestId]);
          await store.update(state => { const row = find(cid, id, state); row.productSaves ||= row.productSave ? [row.productSave] : []; const previous = row.productSaves.find(save => save.requestId === body.requestId); if (previous) { if (previous.fingerprint !== supplierHash(body)) supplierFail(409, 'IDEMPOTENCY_CONFLICT', 'Keep the original library save body.'); return; } requireRevision(row, body); mutable(row, state); if (!row.profile.name) supplierFail(409, 'SUPPLIER_PRODUCT_NAME_REQUIRED', 'Clarify the product name first.'); if (row.productSaves.length >= 100) supplierFail(409, 'SUPPLIER_CAPACITY_LIMIT', 'Retain original product save receipts.'); row.productSaves.push({ requestId: body.requestId, fingerprint: supplierHash(body), profile: structuredClone(row.profile), operationId, existing: row.productReference, status: 'pending' }); });
          const save = find(cid, id).productSaves.find(save => save.requestId === body.requestId), profile = save.profile;
          if (save.status === 'done') return { ...structuredClone(save.result), duplicate: true };
          const sku = profile.skuCode ? [{ id: supplierUuid(['supplier-sku', id]), code: profile.skuCode, unit: profile.supplierUnit || '', moq: profile.supplierMoq, leadTimeDays: profile.productionDays || null,
            ...(profile.wholesaleUnitPrice && profile.wholesaleCurrency && profile.supplierMoq ? { pricingMode: 'tiered', priceTiers: [{ minQuantity: profile.supplierMoq, unitPrice: profile.wholesaleUnitPrice, currency: profile.wholesaleCurrency }] } : {}) }] : [];
          const changes = { name: profile.name, description: profile.description || '', skus: sku, images: profile.images.filter(image => image.kind === 'artifact').map((image, index) => ({ id: supplierUuid(['supplier-image', id, image.asset]), asset: image.asset, alt: image.sourceNote, order: index, isPrimary: index === 0 })) };
          const response = save.existing ? await businessLibrary.updateProduct(save.existing.productId, { requestId: operationId, expectedRevision: save.existing.productRevision, changes }, actor) : await businessLibrary.createProduct({ requestId: operationId, ...changes }, actor);
          return store.update(state => { const row = find(cid, id, state), receipt = row.productSaves.find(entry => entry.requestId === body.requestId); if (receipt.fingerprint !== save.fingerprint) supplierFail(409, 'SUPPLIER_SAVE_PENDING', 'The original private product save changed.'); if (receipt.status === 'done') return { ...receipt.result, duplicate: true }; row.productReference = { productId: response.product.id, productRevision: response.product.revision }; receipt.status = 'done'; receipt.result = { service: supplierDto(state, row), product: response.product }; return receipt.result; });
        },
        async observe(cid, id, body) {
          supplierRequest(body, ['requestId', 'expectedRevision', 'shopifyProductId', 'publicationId', 'confirmed']); if (body.confirmed !== true) supplierFail(400, 'SUPPLIER_CONFIRMATION_REQUIRED', 'Confirm the exact existing Shopify product/publication to read.');
          const before = find(cid, id); const cached = store.read().workspaceSupplierServices?.commands.find(entry => entry.subject === actor.subject && entry.workspaceId === actor.workspaceId && entry.requestId === body.requestId); if (cached) { if (cached.fingerprint !== supplierHash({ id, action: 'observe', body })) supplierFail(409, 'IDEMPOTENCY_CONFLICT', 'Retain the original product observation request.'); return { ...cached.result, duplicate: true }; } requireRevision(before, body);
          if (!shopify.status().configured) return { service: get(cid, id), status: 'blocked', error: { code: 'SHOPIFY_SETUP_REQUIRED' } };
          await shopify.verify(); const observed = await shopify.readProductPublication({ productId: body.shopifyProductId, publicationId: body.publicationId || null });
          return store.update(state => command(state, actor, id, 'observe', body, () => { const row = find(cid, id, state); requireRevision(row, body); row.revision++; row.external = { ...observed, status: observed.published ? 'published' : observed.productStatus === 'DRAFT' ? 'shopify_draft' : 'unpublished', evidenceKind: 'shopify_admin_read', relation: 'user_selected_existing_product', writeReceipt: null, observedAt: now() }; return { service: supplierDto(state, row), observation: row.external }; }));
        },
        async shopifyDraft(cid, id, body) { supplierRequest(body, ['expectedRevision', 'expectedPreviewHash', 'confirmed']); const row = find(cid, id); requireRevision(row, body); if (body.confirmed !== true || row.preview?.previewHash !== body.expectedPreviewHash) supplierFail(409, 'SUPPLIER_PREVIEW_REQUIRED', 'Confirm the exact reviewed preview.'); return { service: get(cid, id), status: 'blocked', error: { code: shopify.status().configured ? 'SHOPIFY_PRODUCT_WRITE_NOT_AUTHORIZED' : 'SHOPIFY_SETUP_REQUIRED' }, externalStatus: row.external?.status || 'preview' }; },
        async stop(cid, id, body, reject = false) {
          supplierRequest(body, ['expectedRevision', 'expectedProfileHash', 'confirmed']); if (body.confirmed !== true) supplierFail(400, 'SUPPLIER_CONFIRMATION_REQUIRED', 'Confirm the original intake revision to stop.');
          const stopped = await store.update(state => command(state, actor, id, reject ? 'reject' : 'cancel', body, () => { const row = find(cid, id, state); requireRevision(row, body); if (body.expectedProfileHash !== supplierHash(row.profile)) supplierFail(409, 'SUPPLIER_REVISION_CONFLICT', 'Review the exact current private facts.'); row[reject ? 'rejectedAt' : 'cancelledAt'] = now(); row.preview = null; row.revision++; return { runId: row.versions.at(-1)?.runId || null }; }));
          for (const monitor of (store.read().workspaceSupplierServices?.monitors || []).filter(item => item.serviceId === id && item.subject === actor.subject && !item.stoppedAt)) await result.stopMonitor(cid, id, { requestId: `intake-monitor-stop-${supplierHash([body.requestId, monitor.id]).slice(0, 40)}`, monitorId: monitor.id, expectedMonitorHash: monitor.scopeHash, confirmed: true });
          const current = store.read().conversations.find(item => item.id === cid);
          if (stopped.runId && current?.activeRunId === stopped.runId) await runtime.cancelConversation(cid);
          return { service: get(cid, id), runCancellationRequested: !!stopped.runId, duplicate: !!stopped.duplicate };
        },
        taskScope(cid, id, body) {
          supplierRequest(body, ['expectedRevision', 'expectedPreviewHash', 'confirmed', 'monitorId', 'expectedMonitorHash', 'shareCurrentMetrics']); const row = find(cid, id); requireRevision(row, body); mutable(row);
          if (body.confirmed !== true || row.preview?.previewHash !== body.expectedPreviewHash) supplierFail(409, 'SUPPLIER_PREVIEW_REQUIRED', 'Review this exact public preview before preparing an original public task scope.');
          const scope = { schema: 'workspace.supplier-task.v1', serviceId: id, previewHash: row.preview.previewHash, readPreview: true };
          if (body.shareCurrentMetrics === true) { const monitor = result.monitors(cid, id).find(item => item.id === body.monitorId && item.scopeHash === body.expectedMonitorHash); if (!monitor) supplierFail(409, 'SUPPLIER_MONITOR_SCOPE_INVALID', 'Review the exact aggregate monitor scope separately.'); Object.assign(scope, { monitorId: monitor.id, monitorHash: monitor.scopeHash, readCurrentMetrics: true }); }
          return { publicProductText: JSON.stringify(scope), originalTaskApprovalRequired: true, workerCredentialCreated: false, executionStarted: false };
        },
      };
      if (notifications) result.notifications = notifications.forActor(context, { command, get });
      if (monitoring) Object.assign(result, monitoring.forActor(actor, { find, get, command, requireRevision }));
      return result;
    },
  };
  return service;
}

export async function supplierServiceHttp({ service, req, res, pathname, context, body, respond, access }) {
  if (req.method === 'GET' && pathname === '/api/agent-services') { await respond(res, 200, service.catalog()); return true; }
  const match = pathname.match(/^\/api\/conversations\/([^/]+)\/supplier-services(?:\/([^/]+)(?:\/(messages|profile|preview|preview-page|cancel|reject|task-scope|save-product|shopify-observation|shopify-draft|monitors|monitor-check|monitor-stop|monitor-summary|images|notification-status|notification-first-status|notification-review|notification-decision|notification-execute|notification-cancel|notification-subscription-challenge|notification-subscription-record|notification-subscription-revoke)(?:\/([^/]+))?)?)?$/);
  if (!match) return false;
  let cid; try { cid = decodeURIComponent(match[1]); } catch { supplierFail(400, 'INVALID_PATH', 'Encode the original conversation ID once.'); }
  const [, , id, op, detail] = match, bound = service.forActor(context);
  if (req.method === 'GET') {
    if (op === 'notification-status' || op === 'notification-first-status') { await respond(res, 200, bound.notifications.snapshot(cid, id, detail, op === 'notification-first-status' ? 'first_sample' : 'summary')); return true; }
    if (op === 'preview-page') {
      const row = bound.get(cid, id), preview = row.preview; if (!preview || row.cancelledAt || row.rejectedAt) supplierFail(404, 'SUPPLIER_PREVIEW_REQUIRED', 'Generate and confirm a current owner-scoped preview first.');
      const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
      const image = preview.images.find(item => item.kind === 'artifact' && item.availability === 'available'), index = image ? row.profile.images.findIndex(item => item.asset?.artifactId === image.asset.artifactId) : -1;
      const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(preview.product.title)} · Listing 预览</title><style>body{margin:0;background:#f8f9fb;color:#253041;font:16px system-ui,sans-serif}main{max-width:540px;margin:24px auto;padding:20px;background:white;border-radius:20px;box-sizing:border-box}img{width:100%;max-height:280px;object-fit:contain;border-radius:14px;background:#f0f3f8}h1{font-size:24px}p{line-height:1.7;overflow-wrap:anywhere}.note{color:#667085;font-size:14px}strong{font-size:24px}dl{display:grid;grid-template-columns:1fr 1fr;gap:12px}dd{margin:0;text-align:right}</style><main><p class="note">Cnsubscribe · 零售 Listing 预览 · 未创建或发布 Shopify 商品</p>${image ? `<img src="${pathname.replace(/preview-page$/, 'images/' + index)}" alt="${escape(image.sourceNote)}">` : '<p class="note">图片缺失或尚未核验可用性</p>'}<h1>${escape(preview.product.title || '产品名称待补充')}</h1><p><strong>${escape(preview.market.currency)} ${escape(preview.saleUnit.consumerPrice || '售价待补充')}</strong></p>${preview.product.descriptionHtml}<dl><dt>目标市场</dt><dd>${escape(preview.market.countryCode || '未知')}</dd><dt>零售单位</dt><dd>${escape(preview.saleUnit.unit || '未知')}</dd><dt>每包数量</dt><dd>${escape(preview.saleUnit.unitsPerPack ?? '未知')}</dd></dl><p class="note">状态：${preview.phase === 'preview_ready' ? '预览可审阅' : '还需补充资料'}。已确认零售范围。。</p><p class="note">图片仍使用原私有文件；外部传输和发布需要单独审阅。仅展示已确认零售字段。</p></main></html>`;
      await res.accessFinish?.(200); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'" }); res.end(html); return true;
    }
    if (op === 'images' && /^\d{1,2}$/.test(detail)) { const file = await bound.image(cid, id, Number(detail)); await res.accessFinish?.(200); res.writeHead(200, { 'Content-Type': file.mimeType, 'Content-Length': file.bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(file.bytes); return true; }
    const value = op === 'monitors' ? { monitors: bound.monitors(cid, id) } : op === 'monitor-summary' ? { summary: bound.summary(cid, id, detail) } : id ? { service: bound.get(cid, id) } : { services: bound.list(cid) };
    await respond(res, 200, value); return true;
  }
  if (req.method === 'POST') {
    if (op?.startsWith('notification-')) {
      const method = { 'notification-review': 'reviewNotification', 'notification-decision': 'decideNotification', 'notification-execute': 'executeNotification', 'notification-cancel': 'cancel', 'notification-subscription-challenge': 'challenge', 'notification-subscription-record': 'recordSubscription', 'notification-subscription-revoke': 'revokeSubscription' }[op];
      if (!method) supplierFail(405, 'SUPPLIER_METHOD_INVALID', 'Use the documented original notification command.');
      const controller = new AbortController(), watcher = op === 'notification-execute' ? access?.watchStream(context, () => controller.abort('SESSION_REVOKED')) : null;
      try { if (watcher && !watcher.valid()) supplierFail(401, 'SESSION_REQUIRED', 'The original session expired before notification admission.'); await respond(res, 200, await bound.notifications[method](cid, id, body, { signal: controller.signal })); return true; }
      finally { watcher?.stop(); }
    }
    const value = !id || op === 'messages' ? await bound.request(cid, body, id) : op === 'profile' ? await bound.profile(cid, id, body) : op === 'preview' ? await bound.preview(cid, id, body) : op === 'cancel' || op === 'reject' ? await bound.stop(cid, id, body, op === 'reject') : op === 'task-scope' ? bound.taskScope(cid, id, body) : op === 'save-product' ? await bound.saveProduct(cid, id, body) : op === 'shopify-observation' ? await bound.observe(cid, id, body) : op === 'shopify-draft' ? await bound.shopifyDraft(cid, id, body) : op === 'monitors' ? await bound.createMonitor(cid, id, body) : op === 'monitor-check' ? await bound.checkMonitor(cid, id, body) : op === 'monitor-stop' ? await bound.stopMonitor(cid, id, body) : supplierFail(405, 'SUPPLIER_METHOD_INVALID', 'Use documented original supplier service operations.');
    await respond(res, !id || op === 'messages' ? 202 : 200, value); return true;
  }
  supplierFail(405, 'SUPPLIER_METHOD_INVALID', 'Supplier services use GET and explicit POST operations.');
}
