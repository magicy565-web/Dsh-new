import { createHash } from 'node:crypto';
// Inert JSON contract, not a planner, scheduler, approval or spend ledger.
export const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const text = (maxLength = 2000) => ({ type: 'string', minLength: 1, maxLength });
const choice = values => ({ type: 'string', enum: values });
const nullable = schema => ({ ...schema, type: [schema.type, 'null'], ...(schema.enum ? { enum: [...schema.enum, null] } : {}) });
const array = (items, maxItems = 20, minItems = 0) => ({ type: 'array', items, maxItems, minItems });
export const uuid = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const integer = { type: 'integer', minimum: 1, maximum: 1000000000 };
const money = { type: 'string', pattern: '^(?:0|[1-9][0-9]{0,9})(?:\\.[0-9]{1,2})?$' };
const currency = { type: 'string', pattern: '^[A-Z]{3}$' };
const name = { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,39}$' };
export const B2B_METRICS = Object.freeze(['qualified_inquiries', 'quote_requests', 'sample_requests', 'b2b_orders']);
export const B2C_METRICS = Object.freeze(['visits', 'add_to_cart', 'checkouts', 'net_paid_orders', 'net_paid_units', 'refunds']);
export const PRODUCT_INPUT_SCHEMA = object({ productId: uuid, documents: array(object({ documentId: uuid, documentVersion: { ...integer, maximum: 100 } }), 3) });
const source = object({ kind: choice(['factory-product', 'factory-document']), recordId: uuid, revision: integer, workspaceId: text(1000),
  projectionSha256: hash, api: text(2000), documentVersion: { ...integer, maximum: 100 }, artifactId: uuid, version: integer, sha256: hash },
['kind', 'recordId', 'revision', 'workspaceId', 'projectionSha256', 'api']);
const supply = object({ status: choice(['unknown', 'proposed', 'reported_unverified']), detail: nullable(text()) });
export const RESULT_ASSESSMENT_SCHEMA = object({ metric: choice(['sales_units', 'conversion_rate']), category: text(200), region: text(200), channelId: text(256),
  unit: choice(['net_paid_units_per_168h', 'net_paid_orders_per_valid_visit']), benchmarkSourceId: text(256), benchmarkWindow: object({ from: text(40), to: text(40) }), validVisitDefinition: text(), minimumValidVisits: integer });
const nonnegative = { type: 'integer', minimum: 0, maximum: 1000000000 };
export const MARKET_REFERENCE_SCHEMA = object({ id: name, sourcePlatform: choice(['tiktok', 'amazon', 'other']), identifierKind: choice(['platform_product_id', 'asin']), unitsKind: choice(['reported', 'estimated']), salesUnit: choice(['units', 'orders', 'packs', 'unknown']), channelId: text(256), region: text(100), leafCategory: text(300), useCase: text(500), currency,
  salesScope: choice(['product_all_variants', 'single_listing_or_variant']), salesDefinition: text(),
  source: object({ provider: text(100), tool: text(200), schemaUrl: nullable(text(2000)), evidenceRef: text(256), snapshotSha256: hash, observedAt: text(40) }),
  match: object({ factoryProductId: uuid, factoryProductRevision: integer, priceLow: money, priceHigh: money, rationale: text() }),
  history: object({ from: text(40), to: text(40), days: { ...integer, maximum: 366 } }),
  selection: object({ method: choice(['category_catalog', 'search_sample', 'provided_sample', 'bestseller_only']), criteria: text(), exclusions: array(text(), 20),
    zeroSales: choice(['included', 'omitted', 'unknown']), populationCount: nullable(nonnegative), limitations: array(text(), 20, 1) }),
  products: array(object({ productId: text(256), evidenceRef: text(256), region: text(100), leafCategory: text(300), useCase: text(500), price: money,
    units: nullable(nonnegative), availability: choice(['available', 'unavailable']), unitsKind: choice(['reported', 'estimated']), listingAgeDays: nullable(nonnegative) }), 50, 1),
  seasonality: text(), newProductDifferences: text() });
export const SERVICE_TARGET_SCHEMA = object({ status: choice(['proposed']), metric: choice(['net_paid_units']), unit: choice(['net_paid_units_per_168h']),
  referenceId: name, executionChannelId: text(256), salesScope: choice(['product_all_variants']), targetUnits: integer,
  adjustmentBasisPoints: { ...integer, maximum: 100000 }, productPrice: object({ amount: money, currency }),
  supplyUnits: integer, supplyEvidenceRef: text(256), supplyVerification: choice(['reported_unverified']),
  pricingRationale: text(), budgetRationale: text(), supplyRationale: text(), crossChannelRationale: text(),
  seasonalAdjustmentRationale: text(), newProductAdjustmentRationale: text(), salesDefinitionDifference: text() });
const path = object({ marketReference: MARKET_REFERENCE_SCHEMA, marketReferences: array(MARKET_REFERENCE_SCHEMA, 5, 1), serviceTarget: SERVICE_TARGET_SCHEMA, resultAssessment: RESULT_ASSESSMENT_SCHEMA, mode: choice(['b2b', 'b2c']), buyer: text(), targetMarket: text(), offer: text(),
  salesRequirement: object({ metric: choice(['b2b_orders', 'net_paid_orders', 'net_paid_units']), target: nullable({ type: 'integer', minimum: 0, maximum: 1000000000 }), definition: text() }),
  metrics: array(object({ id: choice([...B2B_METRICS, ...B2C_METRICS]), definition: text(), dataSource: nullable(text()), availability: choice(['unverified', 'unavailable']) }), 10, 1),
  acquisition: array(object({ id: name, channel: text(200), kind: choice(['paid', 'organic', 'owned', 'partner', 'undecided']), approach: text() }), 10, 1),
  steps: array(text(), 20, 1), successCriteria: array(text(), 10, 1), stopCriteria: array(text(), 10, 1) }, ['mode', 'buyer', 'targetMarket', 'offer', 'salesRequirement', 'metrics', 'acquisition', 'steps', 'successCriteria', 'stopCriteria']);
export const PLAN_SCHEMA = object({ schemaVersion: { type: 'integer', enum: [1] }, title: text(200), goal: text(4000),
  mode: choice(['b2b', 'b2c', 'dual']), rationale: text(4000), productState: text(4000),
  supply: object({ dropshipping: supply, oem: supply, odm: supply }),
  paths: array(path, 2, 1), timeZone: text(100),
  budget: object({ status: choice(['undecided', 'proposed']), currency: nullable(currency), totalCap: nullable(money),
    lines: array(object({ id: name, category: choice(['acquisition', 'samples', 'logistics', 'platform', 'commission', 'other']),
      acquisitionId: nullable(name), cap: money, purpose: text() }), 30) }),
  commission: object({ status: choice(['undecided', 'none_proposed', 'proposed']), payer: nullable(text(300)), payee: nullable(text(300)),
    basis: nullable(text()), method: nullable(choice(['percentage', 'fixed'])), rateOrAmount: nullable(money), currency: nullable(currency),
    settlement: nullable(text()), refunds: nullable(text()), cap: nullable(money), budgetLineId: nullable(name) }),
  questions: array(object({ topic: text(100), question: text(), blocking: { type: 'boolean' } }), 20), assumptions: array(text(), 20) });
export const SAVE_INPUT_SCHEMA = object({ ...PRODUCT_INPUT_SCHEMA.properties, sources: array(source, 4, 1), plan: PLAN_SCHEMA,
  requestId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' } });

// A small validator for precisely the JSON Schema subset above. The service
// validates again: provider-side schema enforcement is not an authority gate.
export function validate(value, schema, location = 'input') {
  const bad = () => { throw new TypeError('Invalid market validation ' + location + '.'); };
  if (value === null && Array.isArray(schema.type) && schema.type.includes('null')) return;
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (schema.enum && !schema.enum.includes(value)) bad();
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) bad();
    if (Object.keys(value).some(k => !Object.hasOwn(schema.properties, k)) || schema.required.some(k => !Object.hasOwn(value, k))) bad();
    for (const k of Object.keys(value)) validate(value[k], schema.properties[k], location + '.' + k);
  } else if (type === 'array') {
    if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems) bad();
    value.forEach((v, i) => validate(v, schema.items, location + '[' + i + ']'));
  } else if (type === 'string') {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
      || value.length < (schema.minLength || 0) || value.length > (schema.maxLength || 10000) || schema.pattern && !new RegExp(schema.pattern).test(value)) bad();
  } else if (type === 'integer') {
    if (!Number.isSafeInteger(value) || value < (schema.minimum ?? 0) || value > (schema.maximum ?? Number.MAX_SAFE_INTEGER)) bad();
  } else if (type === 'boolean' && typeof value !== 'boolean') bad();
}
const units = value => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')); };
const unique = values => new Set(values).size === values.length;
const reject = message => { throw new TypeError(message); };
export function validateProductInput(input) {
  validate(input, PRODUCT_INPUT_SCHEMA);
  if (!unique(input.documents.map(d => d.documentId))) reject('Select each document only once.');
  return structuredClone(input);
}
export function validatePlanInput(input) {
  validate(input, SAVE_INPUT_SCHEMA);
  validateProductInput({ productId: input.productId, documents: input.documents });
  if (Buffer.byteLength(JSON.stringify(input)) > 60000) reject('Plan input exceeds 60 KB.');
  const p = input.plan, modes = p.paths.map(row => row.mode);
  if (!unique(modes) || (p.mode === 'dual' ? modes.length !== 2 : modes.length !== 1 || modes[0] !== p.mode)) reject('Keep B2B and B2C paths explicitly separate.');
  if (p.timeZone !== 'UTC' && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(p.timeZone)) reject('Specify an explicit IANA time zone, not a numeric offset.');
  try { new Intl.DateTimeFormat('en', { timeZone: p.timeZone }); } catch { reject('Specify a valid IANA time zone.'); }
  const acquisitionIds = p.paths.flatMap(row => row.acquisition.map(a => a.id));
  if (!unique(acquisitionIds) || !unique(p.budget.lines.map(row => row.id))) reject('Use unique acquisition and budget line IDs.');
  for (const row of p.paths) {
    if (row.resultAssessment) validateResultAssessment(row.resultAssessment);
    validatePreServicePath(row, input);
    const allowed = row.mode === 'b2b' ? B2B_METRICS : B2C_METRICS;
    if (!unique(row.metrics.map(m => m.id)) || row.metrics.some(m => !allowed.includes(m.id))
      || !allowed.includes(row.salesRequirement.metric) || !row.metrics.some(m => m.id === row.salesRequirement.metric)) reject('Inquiries are not sales. Keep each path and sales metric distinct.');
  }
  const b = p.budget, c = p.commission;
  if (b.status === 'undecided' ? b.lines.length || b.totalCap !== null : b.currency === null || b.totalCap === null) reject('Proposed budgets require currency and a total cap; undecided budgets cannot allocate spend.');
  if (b.lines.some(l => l.acquisitionId !== null && !acquisitionIds.includes(l.acquisitionId) || l.category === 'acquisition' && l.acquisitionId === null)) reject('Link acquisition spend to an exact proposed channel.');
  if (b.totalCap !== null && b.lines.reduce((sum, l) => sum + units(l.cap), 0n) > units(b.totalCap)) reject('Budget line caps exceed the total cap. No currency conversion or extra commission is implicit.');
  if (c.status === 'proposed') {
    if (Object.values(c).some(v => v === null) || c.currency !== b.currency || b.status !== 'proposed') reject('Commission requires payer, payee, basis, method, rate/amount, currency, settlement, refunds, cap and reserved budget line.');
    if (c.method === 'percentage' && units(c.rateOrAmount) > 10000n) reject('Commission percentage must be at most 100.');
    const line = b.lines.find(l => l.id === c.budgetLineId && l.category === 'commission');
    if (!line || units(line.cap) < units(c.cap) || c.method === 'fixed' && units(c.rateOrAmount) > units(c.cap)) reject('Reserve the commission cap within the same proposed total budget.');
  } else if (Object.entries(c).some(([k, v]) => k !== 'status' && v !== null)) reject('Undecided or no-commission proposals cannot carry payment terms.');
  return structuredClone(input);
}

export function validateResultAssessment(value) {
  validate(value, RESULT_ASSESSMENT_SCHEMA);
  if (value.metric === 'sales_units' ? value.unit !== 'net_paid_units_per_168h' : value.unit !== 'net_paid_orders_per_valid_visit') reject('Select matching result metric and units.');
  const { from, to } = value.benchmarkWindow;
  if (![from, to].every(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v) || Date.parse(to) - Date.parse(from) !== 168 * 3600000) reject('Select the exact canonical UTC 168-hour benchmark window.');
  return structuredClone(value);
}

const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object'
  ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
export const preServiceHash = value => createHash('sha256').update(canonical(value)).digest('hex');
const utc = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function summarizeMarketReference(ref) {
  validate(ref, MARKET_REFERENCE_SCHEMA);
  if (ref.sourcePlatform !== 'other' && !new RegExp('^' + ref.sourcePlatform + '(?:[_:.-]|$)').test(ref.channelId)) reject('Keep the source platform channel namespace distinct from the execution channel.');
  if (!utc(ref.history.from) || !utc(ref.history.to) || !utc(ref.source.observedAt) || Date.parse(ref.history.to) - Date.parse(ref.history.from) !== ref.history.days * 86400000
    || Date.parse(ref.source.observedAt) < Date.parse(ref.history.to)) reject('Retain the exact complete historical source window and observation time.');
  if (ref.source.schemaUrl !== null) {
    let url; try { url = new URL(ref.source.schemaUrl); } catch { reject('Use public provider schema documentation or explicit null.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) reject('Schema references cannot carry credentials.');
  }
  if (units(ref.match.priceLow) > units(ref.match.priceHigh) || !unique(ref.products.map(row => row.productId))) reject('Use an ordered price band and unique comparable product IDs.');
  for (const row of ref.products) {
    if (row.unitsKind !== ref.unitsKind || ref.identifierKind === 'asin' && !/^[A-Z0-9]{10}$/.test(row.productId)) reject('Keep platform product IDs/ASINs and the reported or estimated unit definition distinct.');
    if (row.region !== ref.region || row.leafCategory !== ref.leafCategory || row.useCase !== ref.useCase || units(row.price) < units(ref.match.priceLow) || units(row.price) > units(ref.match.priceHigh)) reject('Include only products matching region, leaf category, price band and use case.');
    if ((row.availability === 'available') !== (row.units !== null)) reject('Missing source quantities are null, never zero.');
  }
  if (ref.selection.populationCount !== null && ref.selection.populationCount < ref.products.length) reject('Sample cannot exceed its declared source population.');
  const values = ref.products.filter(row => row.units !== null).map(row => row.units).sort((a, b) => a - b), n = values.length;
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : null;
  const median = n ? (values[Math.floor((n - 1) / 2)] + values[Math.ceil((n - 1) / 2)]) / 2 : null;
  const scale = value => value === null ? null : value * 7 / ref.history.days;
  const gaps = [];
  if (ref.salesUnit !== 'units') gaps.push('SOURCE_SALES_UNIT_NOT_CONFIRMED_AS_PRODUCT_UNITS');
  if (ref.selection.method === 'bestseller_only') gaps.push('BESTSELLER_SELECTION_IS_NOT_MARKET_MEAN');
  if (ref.selection.zeroSales !== 'included') gaps.push('ZERO_SALES_COVERAGE_UNVERIFIED');
  if (n !== ref.products.length) gaps.push('MISSING_COMPARABLE_SALES');
  if (n < 2) gaps.push('COMPARABLE_SAMPLE_TOO_SMALL');
  if (!(mean > 0)) gaps.push('POSITIVE_REFERENCE_REQUIRED_FOR_TARGET');
  return { schema: 'workspace.market-reference-summary.v1', referenceId: ref.id, referenceHash: preServiceHash(ref), sourceVerification: 'external_claim_not_independently_verified', sourceDocumentationGaps: ref.source.schemaUrl === null ? ['PROVIDER_SCHEMA_DOCUMENTATION_UNAVAILABLE'] : [],
    sourcePlatform: ref.sourcePlatform, identifierKind: ref.identifierKind, unitsKind: ref.unitsKind, salesUnit: ref.salesUnit, productIds: ref.products.map(row => row.productId), channelId: ref.channelId, region: ref.region, leafCategory: ref.leafCategory, useCase: ref.useCase, currency: ref.currency,
    salesScope: ref.salesScope, salesDefinition: ref.salesDefinition, source: structuredClone(ref.source), history: structuredClone(ref.history), selection: structuredClone(ref.selection),
    sampleCount: ref.products.length, measuredCount: n, missingCount: ref.products.length - n,
    statistics: { meanMethod: 'unweighted_arithmetic_mean_of_measured_products', mean, median, minimum: n ? values[0] : null, maximum: n ? values.at(-1) : null, confidenceInterval: null, interpretation: 'matched_sample_not_population_mean' },
    sevenDayReference: { method: 'linear_7_over_history_days_not_forecast', sourceDays: ref.history.days, numeratorDays: 7, mean: scale(mean), median: scale(median), minimum: n ? scale(values[0]) : null, maximum: n ? scale(values.at(-1)) : null },
    seasonality: ref.seasonality, newProductDifferences: ref.newProductDifferences,
    limitations: [...ref.selection.limitations, 'Non-probability or unverified sample: no market-wide mean or confidence interval asserted.', ...(n < 10 ? ['Small matched sample; retain uncertainty before confirming a service target.'] : [])],
    suitableForTargetProposal: gaps.length === 0, gaps };
}
export const referencesForPath = path => path.marketReferences ?? (path.marketReference ? [path.marketReference] : []);
const selectedReference = path => referencesForPath(path).find(ref => ref.id === path.serviceTarget?.referenceId);
function validatePreServicePath(path, input) {
  const refs = referencesForPath(path);
  if (path.marketReferences && path.marketReference) reject('Use one explicit reference collection.');
  if (!refs.length && !path.serviceTarget) return;
  if (!refs.length) reject('Service targets require pre-service comparable references.');
  if (!unique(refs.map(ref => ref.id))) reject('Each platform reference needs a unique ID; never pool statistics implicitly.');
  const source = input.sources.find(row => row.kind === 'factory-product');
  for (const ref of refs) {
    summarizeMarketReference(ref);
    if (ref.match.factoryProductId !== input.productId || ref.match.factoryProductRevision !== source?.revision) reject('Match the actual original uploaded product revision.');
  }
  if (!path.serviceTarget) return;
  const ref = selectedReference(path); if (!ref) reject('Explicitly choose one platform reference for the service target.');
  const summary = summarizeMarketReference(ref), target = path.serviceTarget; validate(target, SERVICE_TARGET_SCHEMA);
  if (!summary.suitableForTargetProposal || path.mode !== 'b2c' || !path.metrics.some(row => row.id === target.metric)) reject('Use a complete comparable sample and explicit net paid sales metric; rankings alone cannot set the standard.');
  if (target.productPrice.currency !== ref.currency || units(target.productPrice.amount) <= 0n || units(target.productPrice.amount) < units(ref.match.priceLow) || units(target.productPrice.amount) > units(ref.match.priceHigh)) reject('Explain a product price inside the selected reference price band and currency.');
  if (input.plan.budget.status !== 'proposed' || input.plan.budget.totalCap === null) reject('Propose an explicit original budget before a service sales target; no spend is approved.');
  if (target.targetUnits !== Math.round(summary.sevenDayReference.mean * target.adjustmentBasisPoints / 10000) || target.targetUnits > target.supplyUnits) reject('Keep the seven-day reference adjustment, integer rounding and reported supply bound explicit.');
  if (path.salesRequirement.metric !== target.metric || path.salesRequirement.target !== target.targetUnits) reject('The original sales requirement and proposed service target must agree.');
}
export function buildPreServiceReview(plan) {
  return plan.paths.filter(path => referencesForPath(path).length).map(path => {
    const marketReferences = referencesForPath(path).map(summarizeMarketReference), chosen = marketReferences.find(ref => ref.referenceId === path.serviceTarget?.referenceId);
    return { mode: path.mode, marketReferences, statisticsCombinedAcrossPlatforms: false,
      serviceTarget: path.serviceTarget ? { ...structuredClone(path.serviceTarget), targetHash: preServiceHash(path.serviceTarget), referenceHash: chosen?.referenceHash,
        reviewHash: preServiceHash({ target: path.serviceTarget, marketReference: chosen }), confirmationStatus: 'unreviewed', threshold: .7, durationHours: 168,
        crossChannelReference: chosen?.channelId !== path.serviceTarget.executionChannelId, marketDirectComparisonAuthorized: false } : null };
  });
}

// Only the original Host receipt reader calls this with a human approval record.
// No confirmation input is accepted by the plan tool or draft schema.
export function freezeConfirmedServiceTarget(path, confirmation, context) {
  if (!path.serviceTarget) return null;
  const target = structuredClone(path.serviceTarget), marketReference = summarizeMarketReference(selectedReference(path));
  validate(target, SERVICE_TARGET_SCHEMA);
  const ref = selectedReference(path);
  if (path.mode !== 'b2c' || target.referenceId !== ref.id || path.salesRequirement?.metric !== target.metric || path.salesRequirement.target !== target.targetUnits
    || !path.metrics?.some(metric => metric.id === target.metric) || target.targetUnits !== Math.round(marketReference.sevenDayReference.mean * target.adjustmentBasisPoints / 10000)
    || target.targetUnits > target.supplyUnits || target.productPrice.currency !== ref.currency || units(target.productPrice.amount) <= 0n
    || units(target.productPrice.amount) < units(ref.match.priceLow) || units(target.productPrice.amount) > units(ref.match.priceHigh)) reject('Confirm a consistent sales, price, supply and reference-derived target.');
  const targetHash = preServiceHash(target), referenceHash = marketReference.referenceHash, reviewHash = preServiceHash({ target, marketReference });
  const fields = ['status', 'evidenceKind', 'approvalId', 'evidenceRef', 'approvedBy', 'workspaceId', 'approvedAt', 'planId', 'planRevision', 'planHash', 'targetHash', 'referenceHash', 'reviewHash'];
  if (!confirmation || Object.keys(confirmation).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(confirmation, key))
    || confirmation.status !== 'approved' || confirmation.evidenceKind !== 'real' || !['approvalId', 'evidenceRef'].every(key => typeof confirmation[key] === 'string' && confirmation[key].trim() && confirmation[key].length <= 256)
    || confirmation.approvedBy !== context.subject || confirmation.workspaceId !== context.workspaceId || confirmation.planId !== context.planId || confirmation.planRevision !== context.planRevision
    || confirmation.planHash !== context.planHash || confirmation.targetHash !== targetHash || confirmation.referenceHash !== referenceHash || confirmation.reviewHash !== reviewHash
    || !utc(confirmation.approvedAt) || !utc(context.startedAt) || Date.parse(confirmation.approvedAt) > Date.parse(context.startedAt)
    || Date.parse(marketReference.source.observedAt) > Date.parse(confirmation.approvedAt) || context.createdAt && Date.parse(confirmation.approvedAt) < Date.parse(context.createdAt)
    || target.executionChannelId !== context.channelId || !marketReference.suitableForTargetProposal) reject('An original prelaunch human confirmation must bind this exact plan, sales target and reference evidence.');
  return { schema: 'workspace.confirmed-service-target.v1', proposal: target, marketReference, targetHash, referenceHash, reviewHash, planId: context.planId, planRevision: context.planRevision,
    planHash: context.planHash, planSha256: context.planSha256, confirmation: structuredClone(confirmation) };
}
export function validateFrozenServiceTarget(value, scope) {
  if (!value || value.schema !== 'workspace.confirmed-service-target.v1' || value.planId !== scope.planId || value.planRevision !== scope.planRevision || value.proposal?.executionChannelId !== scope.channelId) reject('Use the frozen original plan target.');
  validate(value.proposal, SERVICE_TARGET_SCHEMA);
  if (value.targetHash !== preServiceHash(value.proposal) || value.referenceHash !== value.marketReference?.referenceHash
    || value.reviewHash !== preServiceHash({ target: value.proposal, marketReference: value.marketReference })
    || value.confirmation?.status !== 'approved' || value.confirmation.evidenceKind !== 'real' || value.confirmation.targetHash !== value.targetHash
    || value.confirmation.referenceHash !== value.referenceHash || value.confirmation.reviewHash !== value.reviewHash
    || value.confirmation.planHash !== value.planHash || value.confirmation.planId !== scope.planId || value.confirmation.planRevision !== scope.planRevision
    || !utc(value.confirmation.approvedAt) || Date.parse(value.confirmation.approvedAt) > Date.parse(scope.startAt)
    || Date.parse(value.marketReference.source.observedAt) > Date.parse(value.confirmation.approvedAt)) reject('Frozen service target or confirmation changed after approval.');
  return structuredClone(value);
}
