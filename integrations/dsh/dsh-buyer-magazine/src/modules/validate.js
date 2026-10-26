import { moduleById, economics } from './catalog.js';
import { safePublicUrl } from '../../upstream/src/schema.js';
const required = (value, path) => { if (typeof value !== 'string' || !value.trim()) throw new Error(`${path}: text is required`); };
function texts(value, path) {
  if (!Array.isArray(value) || !value.length) throw new Error(`${path}: non-empty text array required`);
  value.forEach((v, i) => required(v, `${path}[${i}]`));
}
function url(value) {
  if (typeof value !== 'string' || !safePublicUrl(value)) throw new Error('Only public HTTPS URLs without credentials are supported');
  return value;
}

const keys = (value, allowed, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: object required`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${path}: unrecognized field`);
};
export function validateModuleIssue(issue) {
  if (!issue || typeof issue !== 'object') throw new Error('Issue object required');
  keys(issue, ['id', 'date', 'edition', 'theme', 'title', 'audience', 'language', 'preview', 'blocks'], 'issue');
  required(issue.title, 'title'); required(issue.audience, 'audience');
  if (!['zh', 'en'].includes(issue.language)) throw new Error('language must be zh or en');
  if (issue.preview !== undefined && typeof issue.preview !== 'boolean') throw new Error('preview must be boolean');
  if (!Array.isArray(issue.blocks) || !issue.blocks.length) throw new Error('Select at least one block; modules are never added automatically');
  const ids = new Set();
  if (issue.blocks.length > 60) throw new Error('Select at most 60 blocks');
  for (const b of issue.blocks) {
    keys(b, ['id', 'type', 'title', 'product', 'data', 'evidence'], 'block');
    required(b.id, 'block.id');
    if (!/^[a-zA-Z][\w-]*$/.test(b.id) || ids.has(b.id)) throw new Error(`Invalid or duplicate block id: ${b.id}`);
    ids.add(b.id);
    if (!moduleById.has(b.type)) throw new Error(`Unknown module: ${b.type}`);
    if (b.title !== undefined) required(b.title, 'block.title');
    if (b.product !== undefined) required(b.product, 'block.product');
    const d = b.data;
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error(`${b.id}.data required`);
    const definition = moduleById.get(b.type);
    keys(d, [...definition.fields, ...(definition.optional ?? []), 'imageRights', 'imageGenerated'], `${b.id}.data`);
    for (const key of ['imageUrl', 'productUrl', 'actionUrl']) if (d[key] !== undefined) { required(d[key], key); url(d[key]); }
    if (d.imageUrl && (!['owned', 'licensed', 'permission'].includes(d.imageRights) || d.imageGenerated !== false)) throw new Error('Product image needs explicit reuse rights and imageGenerated: false');
    const evidence = b.evidence ?? [];
    if (!Array.isArray(evidence)) throw new Error(`${b.id}.evidence must be an array`);
    evidence.forEach(s => {
      keys(s, ['label', 'reference', 'date', 'kind', 'url'], 'evidence');
      required(s.label, 'evidence.label'); required(s.reference, 'evidence.reference'); required(s.date, 'evidence.date');
      if (!Number.isFinite(Date.parse(s.date))) throw new Error('evidence.date must be a date');
      if (!['observed', 'estimated', 'provided', 'illustrative'].includes(s.kind)) throw new Error('Unknown evidence kind');
      if (s.kind === 'illustrative' && !issue.preview) throw new Error('Illustrative evidence requires preview: true');
      if (s.url !== undefined) url(s.url);
    });
    const text = (...keys) => keys.forEach(k => required(d[k], `${b.id}.${k}`));
    const arrays = (...keys) => keys.forEach(k => texts(d[k], `${b.id}.${k}`));
    switch (b.type) {
      case 'product': text('summary'); arrays('features'); if (d.imageUrl) { text('imageAlt'); if (!issue.preview && !evidence.length) throw new Error('Product image needs source evidence'); } break;
      case 'buyer-fit': text('buyerContext'); arrays('reasons'); if (d.unknowns !== undefined) arrays('unknowns'); break;
      case 'opportunity': arrays('signals', 'uncertainties'); text('interpretation'); break;
      case 'launch': text('status', 'timing', 'availability'); break;
      case 'sales-history':
        if (!Array.isArray(d.comparables) || !d.comparables.length) throw new Error('sales-history.comparables required');
        d.comparables.forEach(row => {
          keys(row, ['name', 'period', 'market', 'channel', 'currency', 'basis', 'comparability', 'revenue', 'measurement', 'source'], 'sales-history.row');
          for (const key of ['name', 'period', 'market', 'channel', 'currency', 'basis', 'comparability']) required(row[key], `sales-history.${key}`);
          if (!/^[A-Z]{3}$/.test(row.currency)) throw new Error('sales-history.currency must be a currency code');
          if (typeof row.revenue !== 'number' || !Number.isFinite(row.revenue) || row.revenue < 0) throw new Error('sales-history.revenue must be non-negative');
          if (!['reported', 'estimated'].includes(row.measurement)) throw new Error('sales-history.measurement must distinguish reported and estimated');
          if (!Number.isInteger(row.source) || !evidence[row.source]) throw new Error('Each sales row needs a valid evidence index');
          if (row.measurement === 'reported' && evidence[row.source].kind === 'estimated') throw new Error('Estimated evidence cannot become reported sales');
        }); break;
      case 'margin': economics(d); arrays('assumptions'); break;
      case 'comparison':
        arrays('columns', 'caveats');
        if (!Array.isArray(d.rows) || !d.rows.length) throw new Error('comparison.rows required');
        d.rows.forEach(row => { texts(row, 'comparison.row'); if (row.length !== d.columns.length) throw new Error('Comparison columns and row widths differ'); }); break;
      case 'procurement': case 'sample': arrays('terms'); break;
      case 'exclusive':
        text('territory', 'channel', 'term'); arrays('conditions');
        if (!['proposed', 'recorded', 'confirmed'].includes(d.status)) throw new Error('exclusive.status must be proposed, recorded or confirmed');
        if (['recorded', 'confirmed'].includes(d.status) && !evidence.length) throw new Error('Confirmed supply rights need supplier evidence');
        if (['recorded', 'confirmed'].includes(d.status) && evidence.every(s => s.kind === 'estimated')) throw new Error('Estimated evidence cannot confirm supply rights');
        if (d.slots !== undefined) {
          if (!['recorded', 'confirmed'].includes(d.status) || !Number.isInteger(d.slots) || d.slots < 0) throw new Error('Slots require recorded or confirmed rights and a non-negative integer');
          text('asOf');
        }
        break;
    }
  }
  return issue;
}

