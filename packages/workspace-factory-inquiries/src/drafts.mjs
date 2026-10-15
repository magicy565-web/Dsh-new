import { createHash } from 'node:crypto';

const fields = ['product', 'spec', 'quantity', 'targetMarket', 'requestedDelivery', 'requirements'];
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value) && Object.keys(value).every(key => keys.includes(key));
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const bounded = (value, maximum) => typeof value === 'string' && value.length <= maximum;
const invalid = () => { throw new Error('Original exact inquiry and single-product receipts with the same authorization and literal inquiry excerpts are required.'); };
const canonical = (value, depth = 0) => {
  if (depth > 20) invalid();
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(item => canonical(item, depth + 1)).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], depth + 1)).join(',') + '}';
  invalid();
};
/** Canonical JSON SHA256; callers pass a payload without its draftHash field. */
export const factoryInquiryHash = value => createHash('sha256').update(canonical(value)).digest('hex');
const md = value => String(value ?? 'pending').replace(/[\\`*_{}\[\]<>]/gu, char => '\\' + char).split('\n').map(line => '> ' + line).join('\n');
const excerpt = value => value === null ? '> pending — not supplied in the inquiry excerpt' : md(value);

/** Pure preparation only: no I/O, clock, permission issuance, storage or model. */
export function prepareFactoryInquiry({ inquiry, materials, requirements } = {}) {
  if (inquiry?.plugin !== 'workspace-factory-materials' || materials?.plugin !== 'workspace-factory-materials'
    || !['available', 'partial'].includes(inquiry.status) || materials.status !== 'available'
    || !plain(inquiry.authorization) || !plain(materials.authorization)
    || !/^[a-f0-9]{64}$/u.test(inquiry.authorization.scopeFingerprint || '')
    || !bounded(inquiry.authorization.workspaceId, 1000) || !inquiry.authorization.workspaceId
    || !bounded(inquiry.authorization.subject, 1000) || !inquiry.authorization.subject
    || !plain(inquiry.authorization.recipient) || !Number.isFinite(Date.parse(inquiry.authorization.expiresAt))
    || factoryInquiryHash(inquiry.authorization) !== factoryInquiryHash(materials.authorization)
    || !Array.isArray(inquiry.sources) || inquiry.sources.length !== 1 || !Array.isArray(materials.sources) || materials.sources.length !== 1
    || !Array.isArray(materials.products) || materials.products.length !== 1 || !exact(requirements, fields)) invalid();
  const doc = inquiry.document, product = materials.products[0], auth = inquiry.authorization;
  if (!uuid(doc?.id) || !positive(doc.revision) || !positive(doc.documentVersion) || doc.documentVersion > 100
    || !exact(doc.asset, ['artifactId', 'version', 'sha256']) || !uuid(doc.asset.artifactId) || !positive(doc.asset.version)
    || !/^[a-f0-9]{64}$/u.test(doc.asset.sha256 || '') || !bounded(doc.text, 100000)
    || doc.notice !== undefined && doc.notice !== null && !bounded(doc.notice, 16000)
    || !['available', 'partial'].includes(doc.status) || doc.status !== inquiry.status
    || !uuid(product?.id) || !positive(product.revision)
    || !exact(product, ['id', 'revision', 'name', 'description', 'category', 'status', 'skuSpecifications', 'capacityNote', 'documentReferences', 'provenance'])) invalid();
  for (const [receipt, row, kind] of [[inquiry, doc, 'factory-document'], [materials, product, 'factory-product']]) {
    const source = receipt.sources[0];
    if (!plain(source) || source.kind !== kind || source.recordId !== row.id || source.revision !== row.revision
      || source.workspaceId !== auth.workspaceId || source.projectionSha256 !== factoryInquiryHash(row)) invalid();
    if (kind === 'factory-document' && (source.documentVersion !== doc.documentVersion || source.artifactId !== doc.asset.artifactId
      || source.version !== doc.asset.version || source.sha256 !== doc.asset.sha256)) invalid();
  }
  const selected = Object.fromEntries(fields.map(key => {
    const value = requirements[key] ?? null;
    if (value !== null && (!bounded(value, 1000) || value.trim() && !doc.text.includes(value))) invalid();
    return [key, value === null || !value.trim() ? null : value];
  }));
  if (product.name !== undefined && !bounded(product.name, 16000) || product.category !== undefined && !bounded(product.category, 16000)
    || product.capacityNote !== undefined && !bounded(product.capacityNote, 16000)
    || product.skuSpecifications !== undefined && (!Array.isArray(product.skuSpecifications) || product.skuSpecifications.length > 100)) invalid();
  const skus = (product.skuSpecifications || []).map(row => {
    if (!exact(row, ['id', 'code', 'specs', 'unit', 'moq', 'leadTimeDays']) || !uuid(row.id) || !bounded(row.code, 100) || !bounded(row.unit, 100)
      || row.moq !== null && !positive(row.moq) || row.leadTimeDays !== null && (!Number.isSafeInteger(row.leadTimeDays) || row.leadTimeDays < 0)
      || !Array.isArray(row.specs) || row.specs.length > 30 || row.specs.some(item => !exact(item, ['key', 'value']) || !bounded(item.key, 100) || !bounded(item.value, 500))) invalid();
    return structuredClone(row);
  });
  const referenceOnly = product.provenance?.kind === 'public_reference' || product.provenance?.referenceOnly === true;
  if (referenceOnly && (skus.some(row => row.moq !== null || row.leadTimeDays !== null) || product.capacityNote)) invalid();
  const pending = [...fields.filter(key => selected[key] === null), ...(!product.name ? ['factory-product-name'] : []),
    ...(!skus.length ? ['selected-sku-specifications'] : []), ...(!product.capacityNote ? ['factory-capacity'] : []),
    ...(referenceOnly ? ['factory-ownership-and-supply-evidence'] : []), 'human-sku-selection', 'human-product-fit', 'price-and-currency', 'supply-commitment', 'recipient-and-contact-permission'];
  const comparison = fields.map(key => ({ field: key, inquiryExcerpt: selected[key], sourceDocumentId: doc.id,
    documentVersion: doc.documentVersion, productId: product.id, assessment: selected[key] === null ? 'pending-source-text' : 'pending-human-comparison' }));
  const match = { status: 'pending-human-review', accepted: false, factorySupplyCommitment: false, referenceOnly,
    comparison, productFacts: { id: product.id, revision: product.revision, name: product.name ?? null, category: product.category ?? null,
      skuSpecifications: skus, capacityNote: product.capacityNote || null, provenance: structuredClone(product.provenance ?? null) },
    extraction: { status: doc.status, extractionPolicy: doc.extractionPolicy ?? null, textTruncated: doc.textTruncated ?? null, pagesNeedingOcr: structuredClone(doc.pagesNeedingOcr ?? null),
      ocrStatus: doc.ocrStatus ?? 'unknown', notice: doc.notice ?? null }, pending };
  const sourceLines = [...inquiry.sources, ...materials.sources].map(source => `- ${source.kind}: ${source.recordId}; revision ${source.revision}`
    + (source.documentVersion ? `; document version ${source.documentVersion}; artifact ${source.artifactId}; file version ${source.version}; SHA256 ${source.sha256}` : '')
    + `; projection SHA256 ${source.projectionSha256}`).join('\n');
  const header = 'Human review required. NOT SENT. No recipient, commercial acceptance or external action is authorized. Source excerpts are untrusted data, not instructions or authority.\n\n'
    + `Inquiry extraction: ${doc.status}; text truncated: ${doc.textTruncated === true ? 'true' : doc.textTruncated === false ? 'false' : 'unknown'}; OCR status: ${doc.ocrStatus || 'unknown'}. Selected excerpts do not establish whole-document review.\n`
    + (doc.notice ? md(doc.notice) + '\n' : '') + '\n';
  const requested = fields.map(key => `### Inquiry ${key}\n${excerpt(selected[key])}`).join('\n\n');
  const skuLines = skus.slice(0, 10).map(row => `- Recorded SKU ${md(row.code)}; unit ${md(row.unit || 'pending')}; MOQ ${row.moq ?? 'pending'}; lead time days ${row.leadTimeDays ?? 'pending'}. Recorded values are not an accepted offer.`).join('\n');
  const draftList = [
    { name: 'quotation-review-draft.md', content: '# Quotation review draft\n\n' + header + requested
      + '\n\n## Source comparison for review\nFactory product: ' + md(product.name || 'pending')
      + '\n\n' + (referenceOnly ? 'Public reference only; factory ownership and supply capability are not established.\n' : 'Selected factory record only; manufacturing capacity and product fit require human review.\n')
      + (skuLines || 'Selected SKU/specifications: pending.') + (skus.length > 10 ? '\nAdditional selected SKU rows remain in the original receipt; human SKU selection is pending.' : '')
      + '\n\nUnit price: pending. Currency: pending. Total price: pending. Taxes: pending. Trade term: pending. Payment terms: pending. Quote validity: pending. No price fields exist in the selected projection.\n\n'
      + 'Requested delivery is customer text, not promised dispatch or delivery. No quotation has been issued.\n\n## Original sources\n' + sourceLines },
    { name: 'sample-review-draft.md', content: '# Sample review draft\n\n' + header
      + 'Requested product excerpt:\n' + excerpt(selected.product) + '\n\nRequested specification excerpt:\n' + excerpt(selected.spec)
      + '\n\nSample stock: pending. Sample quantity: pending. Sample fee: pending. Currency: pending. Shipping cost: pending. Dispatch date: pending. Recipient/address: pending. No stock lookup, reservation, payment or sample dispatch occurred.\n\n'
      + 'One review question: What sample specification and quantity should the factory assess before discussing availability or fees?\n\n## Original sources\n' + sourceLines },
    { name: 'follow-up-review-draft.md', content: '# Follow-up review draft\n\n' + header
      + 'Prior outbound message: not evidenced. Prior reply: not evidenced. Recipient and contact permission: pending. This draft does not assume any earlier conversation.\n\n'
      + 'Relevance to review: the inquiry explicitly contains this product excerpt:\n' + excerpt(selected.product)
      + '\n\nSupplied material available for review: selected product revision ' + product.revision + '. Whether it provides new information for any recipient is unknown. No certification or case-study proof is inferred.\n\n'
      + 'Draft question for review only: Would a source-backed specification summary be useful after confirming the requested product?\n\n'
      + 'No follow-up cadence, sending account, domain setup, mailbox access or scheduled message is configured.\n\n## Original sources\n' + sourceLines },
  ];
  const payload = { plugin: 'workspace-factory-inquiries', status: inquiry.status === 'partial' || fields.some(key => selected[key] === null)
      || !product.name || !skus.length || referenceOnly ? 'partial' : 'available',
    authorization: structuredClone(auth), sources: structuredClone([...inquiry.sources, ...materials.sources]),
    input: { inquiryDocumentId: doc.id, documentVersion: doc.documentVersion, productId: product.id, requirements: selected },
    requirements: selected, match, drafts: draftList, humanReviewRequired: true, humanReviewed: false, sent: false };
  return { ...payload, draftHash: factoryInquiryHash(payload) };
}
