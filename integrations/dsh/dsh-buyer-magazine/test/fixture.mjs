// Entirely synthetic fixture. Never presents a real business or real image permission.
export const now = new Date('2026-10-26T00:00:00Z');
export function issueFixture() {
  return {
    schemaVersion: '1.0', id: 'synthetic.issue-01', edition: '01', title: 'Synthetic Supply Notes',
    subtitle: 'Synthetic contract fixture, not a supplier offer', date: '2026-10-26', locale: 'en',
    market: 'Synthetic buyer', theme: 'porcelain', demo: true,
    cover: { kicker: 'Synthetic evidence', headline: 'A bounded sourcing draft', dek: 'Fictional demonstration only.', image: null },
    editorNote: 'Nothing has been sent.', highlights: [{ label: 'Unknown stays unknown', text: 'Confirm terms before any decision.' }],
    products: [{ id: 'sample-01', name: 'Fictional vessel', supplier: 'Synthetic Supplier', category: 'Objects', region: 'Not confirmed',
      summary: 'This fictional item exists only for a contract test.', buyerFit: 'Evaluate the stated dimensions against the brief.', watchout: 'Confirm every term with the supplier.', image: null,
      specs: [{ key: 'width', label: 'Width', value: 10, unit: 'cm', status: 'supplier-stated', sourceIds: ['s1'], visibility: 'public' }],
      price: { kind: 'retail', amount: 25, currency: 'USD', unit: 'item', basis: 'Synthetic public retail listing; not wholesale', sourceIds: ['s1'], status: 'supplier-stated' },
      moq: { value: 'Not disclosed', status: 'unknown', sourceIds: [] }, leadTime: { value: 'Not confirmed', status: 'unknown', sourceIds: [] }, sourceIds: ['s1'],
      cta: { label: 'Synthetic source', type: 'source', url: 'https://example.com/product' } }],
    sources: [{ id: 's1', url: 'https://example.com/product', title: 'Synthetic product evidence', publisher: 'Synthetic Publisher', accessedAt: '2026-10-25T12:00:00Z', kind: 'supplier', excerpt: 'Fictional evidence for tests only.' }],
    insights: [{ title: 'Terms remain open', body: 'Retail is not a wholesale offer.', kind: 'observation', sourceIds: ['s1'] }],
    dataNotes: ['Synthetic fixture. No live evidence was collected.'], provenance: { mode: 'demo', collectedAt: '2026-10-25T12:00:00Z' },
  };
}
export const json = issue => JSON.stringify(issue);
