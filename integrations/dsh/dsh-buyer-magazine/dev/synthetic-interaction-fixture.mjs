// All suppliers, terms, evidence and sources are synthetic. No live collection.
export const NOW = new Date('2026-10-26T10:00:00Z');
export function makeIssue() {
  const ids = ['audit-retail', 'audit-wholesale', 'audit-quote', 'audit-unknown'];
  const sources = ids.map((id, i) => ({
    id: `s${i + 1}`, url: `https://example.com/synthetic/${id}`,
    title: `Synthetic evidence ${i + 1}`, publisher: `Synthetic Publisher ${i + 1}`,
    accessedAt: '2026-10-25T12:00:00Z', kind: 'supplier',
    excerpt: `Fictional source ${i + 1}; no supplier was contacted.`,
  }));
  const unknown = () => ({ value: 'Not disclosed', status: 'unknown', sourceIds: [] });
  const products = ids.map((id, i) => ({
    id, name: `Synthetic Product ${i + 1}`, supplier: `Fictional Supplier ${i + 1}`,
    category: i % 2 ? 'Synthetic B' : 'Synthetic A', region: 'Not confirmed',
    summary: 'Synthetic interaction fixture only.', buyerFit: `Evaluate synthetic fit ${i + 1}.`,
    watchout: `Confirm fictional terms ${i + 1} before any decision.`, image: null,
    specs: [{ key: 'width', label: 'Width', value: 10 + i, unit: 'cm',
      status: 'supplier-stated', sourceIds: [`s${i + 1}`], visibility: 'public' }],
    price: { kind: 'retail', amount: 25, currency: 'USD', unit: 'item',
      basis: 'Synthetic public retail reference', sourceIds: [`s${i + 1}`], status: 'supplier-stated' },
    moq: unknown(), leadTime: unknown(), sourceIds: [`s${i + 1}`],
    cta: { label: 'Synthetic evidence only', type: 'source', url: sources[i].url },
  }));
  products[1].price = { kind: 'wholesale', amount: 12, currency: 'USD', unit: 'item',
    basis: 'EXW, packaging excluded', minQty: 500, sourceIds: ['s2'], status: 'supplier-stated' };
  products[1].moq = { value: 50, unit: 'units', status: 'supplier-stated', sourceIds: ['s2'] };
  products[1].leadTime = { value: 21, unit: 'days', status: 'supplier-stated', sourceIds: ['s2'] };
  products[2].price = { kind: 'request-quote', sourceIds: [], status: 'unknown' };
  products[3].price = { kind: 'unknown', sourceIds: [], status: 'unknown' };
  products[3].specs = [{ key: 'material', label: 'Material', value: 'Not confirmed',
    status: 'unknown', sourceIds: [], visibility: 'public' }];
  return {
    schemaVersion: '1.0', id: 'synthetic.interaction-audit-01', edition: '01',
    title: 'Synthetic Interaction Audit', subtitle: 'Fictional fixtures, no live evidence',
    date: '2026-10-26', locale: 'en', market: 'Synthetic buyer', theme: 'porcelain', demo: true,
    cover: { kicker: 'Synthetic evidence', headline: 'Read, compare, draft',
      dek: 'Fictional demonstration only.', image: null },
    editorNote: 'Nothing has been sent.',
    highlights: [{ label: 'Unknown remains unknown', text: 'Confirm terms before any decision.' }],
    products, sources,
    insights: [{ title: 'Terms remain open', body: 'Retail is not a wholesale offer.',
      kind: 'observation', sourceIds: ['s1'] }],
    dataNotes: ['All data is synthetic. No live collection or supplier contact.'],
    provenance: { mode: 'demo', collectedAt: '2026-10-25T12:00:00Z' },
  };
}
