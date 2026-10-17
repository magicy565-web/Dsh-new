// Original model disclosure + member binding guards for optional Medusa preview.
// No new Agent, PIM, Run store, credentials in model context, or writable model tool.
import { ApiError } from './runtime.mjs';
import { MEDUSA_CATALOG_PLUGIN as PLUGIN, validateMedusaCatalogInput } from '../plugins/workspace-medusa-catalog/src/extension.js';

const fail = (code, status = 403) => { throw new ApiError(status, code, 'Use the exact currently authorized original product revision and member Session.'); };
const requiredFields = ['name', 'description', 'category', 'status', 'provenance'];
export function createMedusaProductClient({ materialsClient, medusaCatalog, identity, authorize, assertCurrent } = {}) {
  if (!materialsClient || !medusaCatalog || !identity || typeof authorize !== 'function' || typeof assertCurrent !== 'function')
    throw TypeError('Original materials, Medusa adapter, identity and live Host guards required.');
  function live(signal) {
    signal?.throwIfAborted();
    const current = assertCurrent();
    if (current === false || current && typeof current.then === 'function') fail('MEDUSA_SOURCE_CHANGED');
  }
  async function gate(signal, model) {
    live(signal); await authorize(signal, model); live(signal);
  }
  async function selected(productId, signal, model) {
    await gate(signal, model);
    const materials = await materialsClient.materials({ productId }, signal, model);
    if (materials.status !== 'available' || materials.products?.length !== 1
      || materials.products[0]?.id !== productId || materials.sources?.length !== 1
      || materials.authorization?.workspaceId !== identity.workspaceId
      || materials.authorization?.subject !== identity.subject) fail('MEDUSA_ORIGINAL_SELECTION_REQUIRED');
    const chosen = materials.products[0];
    if (!requiredFields.every(field => Object.hasOwn(chosen, field)) || chosen.provenance?.kind === 'public_reference')
      fail('MEDUSA_ORIGINAL_SELECTION_REQUIRED');
    const { preview } = medusaCatalog.preview(productId, identity);
    if (chosen.revision !== preview.revision || chosen.name !== preview.title || chosen.description !== preview.description
      || chosen.category !== preview.category || chosen.status !== preview.status
      || !preview.eligible) fail('MEDUSA_SOURCE_CHANGED', 409);
    await gate(signal, model);
    return { materials, preview };
  }
  const response = (method, input, record, view, status = 'available') => ({
    plugin: PLUGIN, method, input: structuredClone(input), status,
    sourceHash: record?.preview.sourceHash ?? null,
    authorization: structuredClone(record?.materials.authorization ?? null),
    sources: structuredClone(record?.materials.sources ?? []),
    view: structuredClone(view), publicListing: false, inventoryWritten: false, humanReviewRequired: true,
  });
  async function status(input, signal, model) {
    validateMedusaCatalogInput('status', input); await gate(signal, model);
    const info = medusaCatalog.status();
    return response('status', input, null, { medusa: info },
      info.configured ? 'available' : 'unconfigured');
  }
  async function preview(input, signal, model) {
    validateMedusaCatalogInput('preview', input);
    const record = await selected(input.productId, signal, model);
    const data = record.preview;
    // Only policy-reviewed title/description, never any other original product details.
    return response('preview', input, record, { preview: data, medusa: medusaCatalog.status() });
  }
  async function reconcile(input, signal, model) {
    validateMedusaCatalogInput('reconcile', input);
    const record = await selected(input.productId, signal, model);
    const outcome = await medusaCatalog.reconcile(input.productId, identity, signal);
    await selected(input.productId, signal, model);
    if (outcome.preview.sourceHash !== record.preview.sourceHash) fail('MEDUSA_SOURCE_CHANGED', 409);
    return response('reconcile', input, record, { preview: record.preview, remote: outcome.remote, medusa: outcome.medusa },
      outcome.medusa.configured ? 'available' : 'unconfigured');
  }
  async function refresh(receipt, model, signal) {
    if (!receipt || receipt.plugin !== PLUGIN || !['status', 'preview', 'reconcile'].includes(receipt.method)
      || !receipt.input || !Array.isArray(receipt.sources)) fail('MEDUSA_SOURCE_CHANGED', 409);
    const fresh = await ({ status, preview, reconcile })[receipt.method](receipt.input, signal, model);
    if (fresh.sourceHash !== receipt.sourceHash || receipt.sources.length !== fresh.sources.length)
      fail('MEDUSA_SOURCE_CHANGED', 409);
    return fresh;
  }
  return Object.freeze({ status, preview, reconcile, refresh });
}
