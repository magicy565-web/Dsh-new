/** Deterministic editorial presentation. Visual classification is not a sourcing claim. */
export const editorialArchetypes = Object.freeze({
  porcelain: Object.freeze({ label: 'The Objects Edit', signature: 'Design-led procurement', desk: 'OBJECTS / A SUPPLIER STUDY', number: '01', mark: '°' }),
  atelier: Object.freeze({ label: 'The Beauty Edit', signature: 'Formula, finish and form', desk: 'ATELIER / MATERIAL & FORM', number: '02', mark: '✳' }),
  foundry: Object.freeze({ label: 'The Industry Edit', signature: 'Engineering with evidence', desk: 'FOUNDRY / TECHNICAL SOURCING', number: '03', mark: '+' }),
  fieldnotes: Object.freeze({ label: 'The Material Edit', signature: 'Made, measured, considered', desk: 'FIELD NOTES / TEXTILE & MATERIALS', number: '04', mark: '∴' }),
});

const familyKeywords = [
  ['atelier', /beauty|cosmetic|gel polish|nail|skin care|skincare|makeup|fragrance|personal care|salon|packaging|serum|colour cosmetic/i],
  ['foundry', /industrial|machin|cnc|precision|component|manufactur|appliance|compressor|cooling|ice maker|alumini?um|steel|metal|lighting|electric|electronic|battery|motor|tool|supply chain/i],
  ['fieldnotes', /linen|textile|fabric|yarn|cotton|wool|hemp|weav|garment|apparel|soft goods|bamboo|wood|sustainable material/i],
];
export function recommendArchetype(products = []) {
  const corpus = products.map(p => [p.category,p.name,...(p.specs || []).filter(s=>s.status!=='unknown').map(s=>String(s.value))].join(' ')).join(' ').slice(0,6000);
  for (const [key, rx] of familyKeywords) if (rx.test(corpus)) return key;
  return 'porcelain';
}
export function resolveArchetype(key) { return editorialArchetypes[key] || editorialArchetypes.porcelain; }
export function sourcingSignals(issue) {
  const products = issue.products || [];
  const disclosed = products.reduce((n,p) => n + [p.moq,p.leadTime,p.price].filter(f => f && f.status !== 'unknown' && f.kind !== 'request-quote' && f.kind !== 'unknown').length, 0);
  const commercialTotal = products.length * 3;
  const cited = new Set(products.flatMap(p=>p.sourceIds||[])).size;
  const claims = products.flatMap(p=>p.specs||[]);
  const verified = claims.filter(c=>c.status==='verified').length;
  const supplierStated = claims.filter(c=>c.status==='supplier-stated').length;
  const pending = commercialTotal - disclosed;
  return { disclosed, commercialTotal, pending, cited, verified, supplierStated, products:products.length };
}
