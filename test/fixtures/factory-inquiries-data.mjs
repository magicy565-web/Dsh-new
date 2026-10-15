import { createHash } from 'node:crypto';
// Synthetic original Library DTOs only, not live permissions or stored files.
export function inquiryFixture(hash) {
  const requirements = { product: 'Steel cup', spec: '500 ml stainless steel', quantity: '2000 pieces', targetMarket: 'United Kingdom',
    requestedDelivery: '15 December 2026', requirements: 'Food-contact documents requested' };
  const text = Object.values(requirements).join('\n');
  const authorization = { workspaceId: 'synthetic-workspace', subject: 'synthetic-member', scopeFingerprint: 'a'.repeat(64),
    expiresAt: '2099-01-01T00:00:00.000Z', recipient: { kind: 'pi-coding-agent', provider: 'factory-inquiries-test-faux', model: 'finite', destination: 'https://synthetic.invalid' } };
  const provenance = { kind: 'user_provided', referenceOnly: false, sourceUrl: null, fetchedAt: null, batchId: null, fieldSources: [] };
  const document = { id: '11111111-1111-4111-8111-111111111111', revision: 3, documentVersion: 2,
    asset: { artifactId: '22222222-2222-4222-8222-222222222222', version: 2, sha256: createHash('sha256').update(text).digest('hex') },
    title: 'Synthetic uploaded inquiry', slotKey: 'other', provenance,
    certificate: { number: '', issuer: '', scope: '', validFrom: null, validUntil: null, expiryMode: 'unknown', expiryNote: '' },
    internalReview: 'unreviewed', independentVerification: false, validity: 'unknown', status: 'available', format: 'text', text,
    extractionPolicy: 'original-library-native-text-hints-v1', textTruncated: false, pagesNeedingOcr: [], ocrStatus: 'not_applicable', notice: 'Only the selected original synthetic text was read.' };
  const product = { id: '33333333-3333-4333-8333-333333333333', revision: 5, name: 'Synthetic factory steel cup', description: 'Supplied synthetic product record only.',
    category: 'Kitchenware', status: 'draft', skuSpecifications: [{ id: '44444444-4444-4444-8444-444444444444', code: 'SYNTHETIC-CUP-500',
      specs: [{ key: 'capacity', value: '500 ml' }], unit: 'piece', moq: 500, leadTimeDays: 21 }], capacityNote: 'Supplied capacity note, not an audit or commitment.', documentReferences: [], provenance: structuredClone(provenance) };
  const inquiry = { plugin: 'workspace-factory-materials', status: 'available', authorization: structuredClone(authorization), document, sources: [{
    kind: 'factory-document', recordId: document.id, revision: document.revision, documentVersion: document.documentVersion, ...document.asset,
    workspaceId: authorization.workspaceId, projectionSha256: hash(document), api: '/api/library/model-read/factory/documents/' + document.id + '/' + document.documentVersion }] };
  const materials = { plugin: 'workspace-factory-materials', status: 'available', authorization: structuredClone(authorization), products: [product], sources: [{
    kind: 'factory-product', recordId: product.id, revision: product.revision, workspaceId: authorization.workspaceId,
    projectionSha256: hash(product), api: '/api/library/model-read/factory/materials?productId=' + product.id }],
    selection: 'approved-exact-revisions-only', limit: 20, hasMore: false, productId: product.id };
  const input = { inquiryDocumentId: document.id, documentVersion: document.documentVersion, productId: product.id, requirements };
  return { inquiry, materials, requirements, input };
}
