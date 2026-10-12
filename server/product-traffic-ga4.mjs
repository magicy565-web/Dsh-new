import { createHash } from 'node:crypto';
import { PRODUCT_TRAFFIC_DEFINITIONS, productTrafficInstant, validateProductTrafficObservation } from './product-traffic-contract.mjs';

const MINUTE = 60000, DAY = 86400000;
const DIMENSIONS = ['itemId', 'hostName', 'dateHourMinute'];
const METRIC = 'itemViewEvents';
const OAUTH_SCOPES = ['https://www.googleapis.com/auth/analytics.readonly', 'https://www.googleapis.com/auth/analytics'];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value, max = 200) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const gid = (kind, value) => typeof value === 'string' && new RegExp(`^gid://shopify/${kind}/[1-9]\\d*$`).test(value);
const host = value => typeof value === 'string' && value.length <= 253 && value.includes('.') && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value);
const iso = ms => new Date(ms).toISOString();
const minuteKey = ms => iso(ms).slice(0, 16).replace(/\D/g, '');
const fail = (code, status = 'unavailable') => { throw Object.assign(new Error(code), { code, trafficStatus: status }); };

function pinnedBinding(input) {
  if (input == null) return null;
  const binding = structuredClone(input);
  if (!text(binding.workspaceId) || !gid('Shop', binding.shopId) || !/^[a-z0-9][a-z0-9-]{0,61}\.myshopify\.com$/.test(binding.shopDomain) ||
      !text(binding.propertyId, 20) || !/^[1-9]\d{0,19}$/.test(binding.propertyId) || !text(binding.mappingRevision) ||
      !Array.isArray(binding.hostNames) || !binding.hostNames.length || binding.hostNames.length > 10 || binding.hostNames.some(value => !host(value)) ||
      new Set(binding.hostNames).size !== binding.hostNames.length || !Array.isArray(binding.products) || !binding.products.length || binding.products.length > 1000 ||
      binding.products.some(row => !gid('Product', row?.productId) || !text(row.itemId) || ['(not set)', '(other)'].includes(row.itemId) ||
        productTrafficInstant(row.collectionStartedAt) === null || !text(row.evidenceRef, 500)) ||
      new Set(binding.products.map(row => row.productId)).size !== binding.products.length || new Set(binding.products.map(row => row.itemId)).size !== binding.products.length) {
    throw Object.assign(new TypeError('Use one fixed Workspace/shop/property and unique reviewed product-to-item mappings.'), { code: 'PRODUCT_TRAFFIC_BINDING_INVALID' });
  }
  return { workspaceId: binding.workspaceId, shopId: binding.shopId, shopDomain: binding.shopDomain,
    propertyId: binding.propertyId, mappingRevision: binding.mappingRevision, hostNames: binding.hostNames.sort(),
    authorizationReviewed: binding.authorizationReviewed === true,
    products: binding.products.sort((a, b) => a.productId.localeCompare(b.productId)).map(row => ({ productId: row.productId,
      itemId: row.itemId, collectionStartedAt: row.collectionStartedAt, evidenceRef: row.evidenceRef })) };
}

async function boundedJson(response) {
  if (!response.body || Number(response.headers.get('content-length')) > 2_000_000) fail('GA4_RESPONSE_INVALID');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 2_000_000) fail('GA4_RESPONSE_INVALID');
      chunks.push(Buffer.from(value));
    }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result) || result.error) fail('GA4_RESPONSE_INVALID');
    return result;
  } catch (error) {
    if (error.trafficStatus) throw error;
    fail('GA4_RESPONSE_INVALID');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function metadataQuality(metadata) {
  if (!metadata || !['UTC', 'Etc/UTC'].includes(metadata.timeZone)) fail('GA4_TIMEZONE_UNSUPPORTED', 'unsupported');
  for (const flag of ['dataLossFromOtherRow', 'subjectToThresholding']) if (metadata[flag] !== undefined && typeof metadata[flag] !== 'boolean') fail('GA4_RESPONSE_INVALID');
  if (metadata.emptyReason !== undefined && typeof metadata.emptyReason !== 'string' ||
      metadata.dataTruncationReasons !== undefined && !Array.isArray(metadata.dataTruncationReasons) ||
      metadata.schemaRestrictionResponse?.activeMetricRestrictions !== undefined && !Array.isArray(metadata.schemaRestrictionResponse.activeMetricRestrictions)) fail('GA4_RESPONSE_INVALID');
  const samples = metadata.samplingMetadatas;
  if (samples !== undefined && (!Array.isArray(samples) || samples.length !== 1)) fail('GA4_SAMPLING_INVALID');
  let sampling = { sampled: false, samplesReadCount: null, samplingSpaceSize: null, rate: null };
  if (samples) {
    const { samplesReadCount: read, samplingSpaceSize: space } = samples[0];
    if (typeof read !== 'string' || typeof space !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(read) || !/^[1-9]\d{0,19}$/.test(space) || BigInt(read) > BigInt(space) || BigInt(space) > 9223372036854775807n) fail('GA4_SAMPLING_INVALID');
    sampling = { sampled: true, samplesReadCount: read, samplingSpaceSize: space, rate: Number(read) / Number(space) };
  }
  return { sampling, subjectToThresholding: metadata.subjectToThresholding === true, dataLossFromOtherRow: metadata.dataLossFromOtherRow === true,
    truncated: !!metadata.dataTruncationReasons?.length,
    restricted: metadata.schemaRestrictionResponse?.activeMetricRestrictions?.some(row => row.metricName === METRIC) === true,
    empty: !!metadata.emptyReason };
}

/** Read-only GA4 Core Data API. Host supplies an existing authorization on every
 * invocation. No OAuth acquisition/refresh, pixel installation, model or timer. */
export function createGa4ProductTrafficAdapter({ binding = null, getAuthorization = null, fetchImpl = fetch, clock = Date.now,
  pageSize = 1000, maxPages = 12, maxCachedSamples = 128 } = {}) {
  const fixed = pinnedBinding(binding);
  if (![pageSize, maxPages, maxCachedSamples].every(Number.isSafeInteger) || pageSize < 1 || pageSize > 1000 || maxPages < 1 || maxPages > 25 || maxCachedSamples < 1 || maxCachedSamples > 1000) throw new TypeError('Invalid bounded traffic read limits.');
  const id = `ga4-product-traffic-v2:${hash(fixed).slice(0, 24)}`;
  const pending = new Map(), receipts = new Map();
  const configured = !!fixed && typeof getAuthorization === 'function';
  const status = () => ({ id, contractVersion: 2, configured, authorizationReviewed: fixed?.authorizationReviewed === true,
    status: !configured ? 'unconfigured' : fixed.authorizationReviewed ? 'configured_unverified' : 'unsupported',
    productAttribution: 'exact_product_id', readOnly: true, sessionsAvailable: false, metric: METRIC });

  function scopeOf(input) {
    const { workspaceId, shopId, shopDomain, productId, from, to, sampleKey, signal } = input || {};
    const start = productTrafficInstant(from), end = productTrafficInstant(to);
    if (!text(workspaceId) || !gid('Shop', shopId) || !/^[a-z0-9][a-z0-9-]{0,61}\.myshopify\.com$/.test(shopDomain) || !gid('Product', productId) ||
        !text(sampleKey) || start === null || end === null || start >= end || end - start > 7 * DAY || end > clock() || signal && !(signal instanceof AbortSignal)) {
      throw Object.assign(new TypeError('Use an original sample key and a bounded, elapsed UTC product window.'), { code: 'PRODUCT_TRAFFIC_SCOPE_INVALID' });
    }
    return { workspaceId, shopId, shopDomain, productId, from, to, sampleKey, signal };
  }
  function base(scope) {
    return { contractVersion: 2, source: { id, kind: 'ga4_data_api_v1beta', propertyId: fixed?.propertyId || null, mappingRevision: fixed?.mappingRevision || null },
      workspaceId: scope.workspaceId, shopId: scope.shopId, shopDomain: scope.shopDomain, productId: scope.productId,
      attribution: 'exact_product_id', sampleKey: scope.sampleKey, requestFingerprint: hash([id, scope.workspaceId, scope.shopId, scope.shopDomain, scope.productId, scope.from, scope.to]),
      status: 'unavailable', sampledAt: iso(clock()), requestedWindow: { from: scope.from, to: scope.to }, coverage: null,
      granularity: 'minute', dataLagSeconds: null, freshness: 'unknown', complete: false, completePagination: false,
      metrics: { productDetailViews: { value: null, status: 'unavailable' }, sessions: { value: null, status: 'unsupported' } },
      metricDefinitions: PRODUCT_TRAFFIC_DEFINITIONS, sampling: null,
      quality: { provisional: true, subjectToThresholding: null, dataLossFromOtherRow: null, truncated: null, limitationCodes: [] },
      diagnostics: { pages: 0, rows: 0 }, error: null };
  }
  function missing(result, state, code) {
    result.status = state; result.metrics.productDetailViews = { value: null, status: state }; result.error = { code };
    return result;
  }
  async function authorization(scope) {
    const auth = await getAuthorization({ workspaceId: fixed.workspaceId, shopId: fixed.shopId, shopDomain: fixed.shopDomain, propertyId: fixed.propertyId, signal: scope.signal });
    if (auth?.authorized !== true || auth.workspaceId !== fixed.workspaceId || auth.shopId !== fixed.shopId || auth.shopDomain !== fixed.shopDomain || auth.propertyId !== fixed.propertyId ||
        !Array.isArray(auth.scopes) || !auth.scopes.some(value => OAUTH_SCOPES.includes(value)) || productTrafficInstant(auth.expiresAt) === null || Date.parse(auth.expiresAt) <= clock() ||
        !text(auth.accessToken, 8192) || /\s/.test(auth.accessToken)) fail('GA4_AUTH_NOT_AUTHORIZED', 'unconfigured');
    // The token stays in this invocation's closure and never in returned receipts.
    return { accessToken: auth.accessToken, expiresAt: auth.expiresAt };
  }
  async function api(method, body, scope, token) {
    if (scope.signal?.aborted) fail('PRODUCT_TRAFFIC_ABORTED');
    if (Date.parse(token.expiresAt) <= clock()) fail('GA4_AUTH_NOT_AUTHORIZED', 'unconfigured');
    const response = await fetchImpl(`https://analyticsdata.googleapis.com/v1beta/properties/${fixed.propertyId}:${method}`, {
      method: 'POST', redirect: 'error', signal: scope.signal ? AbortSignal.any([scope.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.accessToken}` }, body: JSON.stringify(body),
    });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) fail('GA4_AUTH_REJECTED', 'unconfigured');
      if (response.status === 400) fail('GA4_QUERY_UNSUPPORTED', 'unsupported');
      if (response.status === 404) fail('GA4_PROPERTY_UNAVAILABLE', 'unconfigured');
      fail(response.status === 429 ? 'GA4_RATE_LIMITED' : 'GA4_REQUEST_FAILED');
    }
    return boundedJson(response);
  }
  async function collect(scope, result, product, token) {
    const start = Math.ceil(Math.max(Date.parse(scope.from), Date.parse(product.collectionStartedAt)) / MINUTE) * MINUTE;
    const end = Math.floor(Date.parse(scope.to) / MINUTE) * MINUTE;
    if (start >= end) return missing(result, 'no_data', 'GA4_NO_COLLECTED_MINUTE_WINDOW');
    result.coverage = { from: iso(start), to: iso(end) };
    result.quality.limitationCodes.push('SOURCE_FRESHNESS_UNKNOWN', 'CONSENT_AND_TAGGING_COVERAGE_UNKNOWN');
    if (start !== Date.parse(scope.from) || end !== Date.parse(scope.to)) result.quality.limitationCodes.push('PARTIAL_TIME_COVERAGE');
    const dimensionFilter = { andGroup: { expressions: [
      { filter: { fieldName: 'itemId', stringFilter: { matchType: 'EXACT', value: product.itemId, caseSensitive: true } } },
      { filter: { fieldName: 'hostName', inListFilter: { values: fixed.hostNames, caseSensitive: true } } },
      { filter: { fieldName: 'dateHourMinute', numericFilter: { operation: 'GREATER_THAN_OR_EQUAL', value: { int64Value: minuteKey(start) } } } },
      { filter: { fieldName: 'dateHourMinute', numericFilter: { operation: 'LESS_THAN', value: { int64Value: minuteKey(end) } } } },
    ] } };
    const core = { dimensions: DIMENSIONS.map(name => ({ name })), metrics: [{ name: METRIC }], dimensionFilter };
    const compatibility = await api('checkCompatibility', core, scope, token);
    for (const [field, names, metadata] of [['dimensionCompatibilities', DIMENSIONS, 'dimensionMetadata'], ['metricCompatibilities', [METRIC], 'metricMetadata']]) {
      if (!Array.isArray(compatibility[field])) fail('GA4_COMPATIBILITY_INVALID');
      if (names.some(name => {
        const matches = compatibility[field].filter(row => row?.[metadata]?.apiName === name);
        return matches.length !== 1 || matches[0].compatibility !== 'COMPATIBLE';
      })) fail('GA4_QUERY_UNSUPPORTED', 'unsupported');
    }
    const request = { ...core, dateRanges: [{ startDate: iso(start).slice(0, 10), endDate: iso(end - MINUTE).slice(0, 10) }],
      orderBys: DIMENSIONS.map(dimensionName => ({ dimension: { dimensionName }, desc: false })), keepEmptyRows: true, limit: String(pageSize) };
    let offset = 0, rowCount = null, quality = null, sum = 0; const seen = new Map();
    for (let page = 0; page < maxPages; page++) {
      const response = await api('runReport', { ...request, offset: String(offset) }, scope, token);
      result.diagnostics.pages++;
      if (response.kind !== 'analyticsData#runReport' || JSON.stringify(response.dimensionHeaders?.map(row => row.name)) !== JSON.stringify(DIMENSIONS) ||
          response.metricHeaders?.length !== 1 || response.metricHeaders[0]?.name !== METRIC || response.metricHeaders[0]?.type !== 'TYPE_INTEGER') fail('GA4_REPORT_SCHEMA_INVALID');
      const rows = response.rows ?? [], count = response.rowCount ?? 0;
      if (!Array.isArray(rows) || rows.length > pageSize || !Number.isSafeInteger(count) || count < 0 || count < offset + rows.length || rowCount !== null && count !== rowCount) fail('GA4_PAGINATION_CHANGED');
      rowCount = count;
      const currentQuality = metadataQuality(response.metadata);
      if (quality && JSON.stringify(quality) !== JSON.stringify(currentQuality)) fail('GA4_REPORT_CHANGED');
      quality = currentQuality; result.sampling = quality.sampling;
      Object.assign(result.quality, { subjectToThresholding: quality.subjectToThresholding, dataLossFromOtherRow: quality.dataLossFromOtherRow, truncated: quality.truncated });
      if (quality.empty && rows.length) fail('GA4_RESPONSE_INVALID');
      for (const row of rows) {
        if (row?.dimensionValues?.length !== 3 || row?.metricValues?.length !== 1) fail('GA4_REPORT_SCHEMA_INVALID');
        const [item, hostname, minute] = row.dimensionValues.map(value => value?.value), value = row.metricValues[0]?.value;
        if (item !== product.itemId || !fixed.hostNames.includes(hostname) || !/^\d{12}$/.test(minute) || minute < minuteKey(start) || minute >= minuteKey(end) ||
            typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) fail('GA4_ROW_SCOPE_INVALID');
        const eventMinute = `${minute.slice(0, 4)}-${minute.slice(4, 6)}-${minute.slice(6, 8)}T${minute.slice(8, 10)}:${minute.slice(10, 12)}:00.000Z`;
        if (productTrafficInstant(eventMinute) === null) fail('GA4_ROW_SCOPE_INVALID');
        const key = JSON.stringify([item, hostname, minute]);
        // Core reports are aggregate rows, not raw events. Repeated pagination
        // buckets indicate a changing report; never count them twice or guess.
        if (seen.has(key)) fail(seen.get(key) === value ? 'GA4_DUPLICATE_BUCKET' : 'GA4_REPORT_CHANGED');
        seen.set(key, value); sum += Number(value); if (!Number.isSafeInteger(sum)) fail('GA4_COUNT_OVERFLOW');
      }
      result.diagnostics.rows += rows.length; offset += rows.length;
      if (offset === rowCount) { result.completePagination = true; break; }
      if (!rows.length) fail('GA4_PAGINATION_INCOMPLETE');
    }
    if (!result.completePagination) fail('GA4_PAGINATION_LIMIT');
    if (!seen.size) return missing(result, 'no_data', 'GA4_NO_RECORDED_PRODUCT_VIEWS');
    for (const [flag, code] of [['subjectToThresholding', 'GA4_THRESHOLDING'], ['dataLossFromOtherRow', 'GA4_OTHER_ROW_LOSS'], ['truncated', 'GA4_DATA_TRUNCATED'], ['restricted', 'GA4_METRIC_RESTRICTED']]) {
      if (quality[flag]) result.quality.limitationCodes.push(code);
    }
    if (quality.sampling.sampled) result.quality.limitationCodes.push('GA4_SAMPLED_REPORT');
    // Report counts are source observations, including Google's own sampling
    // estimates. This adapter never scales them or asserts final ingestion.
    result.status = 'partial'; result.metrics.productDetailViews = { value: quality.restricted ? null : sum, status: 'partial' };
    if (quality.restricted) result.error = { code: 'GA4_METRIC_RESTRICTED' };
    return result;
  }

  async function readProductTraffic(input) {
    const scope = scopeOf(input), result = base(scope);
    const finish = value => validateProductTrafficObservation({ ...value, sampledAt: iso(clock()) }, scope);
    const forCaller = value => scope.signal?.aborted ? finish(missing(base(scope), 'unavailable', 'PRODUCT_TRAFFIC_ABORTED')) : structuredClone(value);
    if (scope.signal?.aborted) return finish(missing(result, 'unavailable', 'PRODUCT_TRAFFIC_ABORTED'));
    if (!configured) return finish(missing(result, 'unconfigured', 'GA4_SETUP_REQUIRED'));
    if (scope.workspaceId !== fixed.workspaceId || scope.shopId !== fixed.shopId || scope.shopDomain !== fixed.shopDomain) return finish(missing(result, 'unsupported', 'PRODUCT_TRAFFIC_STORE_MISMATCH'));
    if (!fixed.authorizationReviewed) return finish(missing(result, 'unconfigured', 'GA4_AUTH_REVIEW_REQUIRED'));
    const product = fixed.products.find(row => row.productId === scope.productId);
    if (!product) return finish(missing(result, 'unsupported', 'GA4_PRODUCT_MAPPING_REQUIRED'));
    let token;
    try { token = await authorization(scope); }
    catch { return finish(missing(result, 'unconfigured', 'GA4_AUTH_NOT_AUTHORIZED')); }
    if (scope.signal?.aborted) return finish(missing(result, 'unavailable', 'PRODUCT_TRAFFIC_ABORTED'));
    const existing = receipts.get(scope.sampleKey) || pending.get(scope.sampleKey);
    if (existing) {
      if (existing.fingerprint !== result.requestFingerprint) throw Object.assign(new TypeError('The original sample key names a different product/window.'), { code: 'PRODUCT_TRAFFIC_IDEMPOTENCY_CONFLICT' });
      return forCaller(existing.value || await existing.promise);
    }
    // Bound both completed and active reads. Receipts are an optimization; the
    // original Store/check receipt remains the durable idempotency authority.
    if (pending.size >= maxCachedSamples) return finish(missing(result, 'unavailable', 'PRODUCT_TRAFFIC_BUSY'));
    const promise = (async () => {
      try {
        const collected = await collect(scope, result, product, token);
        if (scope.signal?.aborted) return finish(missing(base(scope), 'unavailable', 'PRODUCT_TRAFFIC_ABORTED'));
        return finish(collected);
      }
      catch (error) {
        const code = error.trafficStatus ? error.code : scope.signal?.aborted ? 'PRODUCT_TRAFFIC_ABORTED' : 'GA4_UNREACHABLE';
        return finish(missing(result, error.trafficStatus || 'unavailable', code));
      }
    })();
    pending.set(scope.sampleKey, { fingerprint: result.requestFingerprint, promise });
    try {
      const value = await promise;
      // Do not cache errors: the same original key can recover from rate limits,
      // expired auth, cancellation or incomplete pagination without a fake zero.
      if (value.status === 'partial' && value.metrics.productDetailViews.value !== null || value.status === 'no_data') {
        if (receipts.size >= maxCachedSamples) receipts.delete(receipts.keys().next().value);
        receipts.set(scope.sampleKey, { fingerprint: result.requestFingerprint, value: structuredClone(value) });
      }
      return forCaller(value);
    } finally { pending.delete(scope.sampleKey); }
  }
  return Object.freeze({ id, contractVersion: 2, authorizationReviewed: fixed?.authorizationReviewed === true,
    productAttribution: 'exact_product_id', status, readProductTraffic });
}
