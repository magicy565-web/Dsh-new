// Traffic v2 is a typed observation, not a substitute for sales or store sessions.
export const PRODUCT_TRAFFIC_CONTRACT_VERSION = 2;
export const PRODUCT_TRAFFIC_DEFINITIONS = Object.freeze({
  productDetailViews: Object.freeze({
    name: 'Product detail view events', unit: 'event',
    definition: 'GA4 itemViewEvents for one explicitly reviewed itemId representing the exact Shopify product; repeated detail views count again.',
    sourceMetric: 'itemViewEvents',
    excludes: 'Store sessions, unique visitors, units viewed, purchases and other products. Consent/tagging omissions are not reconstructed.',
    reference: 'https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema',
  }),
  sessions: Object.freeze({
    name: 'Sessions viewing the product', unit: 'session',
    definition: 'Unavailable from this adapter. Detail view events are never relabeled as sessions.',
    sourceMetric: null,
  }),
});

// Consume only the original client's verified capability observation. This does
// not call a shop, request a scope, install a pixel, or create a credential.
export function shopifyProductTrafficCapability({ shopifyStatus = null, protectedCustomerDataLevel2 = false, authorizedProductEventSource = false } = {}) {
  const configured = shopifyStatus?.configured === true;
  const verified = shopifyStatus?.status === 'verified' && /^gid:\/\/shopify\/Shop\/\d+$/.test(shopifyStatus?.shop?.id);
  const readReportsGranted = verified && shopifyStatus?.scopes?.includes('read_reports') === true;
  return {
    status: configured ? 'unsupported' : 'unconfigured', value: null,
    source: 'shopify_admin_2026-10',
    reason: configured ? 'SHOPIFY_EXACT_PRODUCT_TRAFFIC_NOT_EXPOSED' : 'SHOPIFY_SETUP_REQUIRED',
    capabilities: { storeVerified: verified, readReportsGranted,
      protectedCustomerDataLevel2Granted: protectedCustomerDataLevel2 === true,
      shopifyqlProductIdDimension: false, productViewedEvent: true,
      authorizedProductEventSource: authorizedProductEventSource === true },
    alternatives: ['An already authorized product_viewed event store', 'An already authorized GA4 property with a reviewed exact itemId mapping'],
  };
}

const instant = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return null;
  const ms = Date.parse(value);
  const canonical = value.length === 20 ? value.slice(0, -1) + '.000Z' : value;
  return Number.isFinite(ms) && new Date(ms).toISOString() === canonical ? ms : null;
};
export function productTrafficInstant(value) { return instant(value); }

// Parent integration can use this before persisting into its original check
// receipt. It deliberately rejects v1's integer-sessions-only projection.
export function validateProductTrafficObservation(value, scope) {
  const statuses = ['partial', 'unavailable', 'unconfigured', 'unsupported', 'no_data'];
  const from = instant(scope.from), to = instant(scope.to);
  const same = value?.contractVersion === 2 && value.workspaceId === scope.workspaceId &&
    value.shopId === scope.shopId && value.shopDomain === scope.shopDomain && value.productId === scope.productId &&
    value.sampleKey === scope.sampleKey && value.requestedWindow?.from === scope.from && value.requestedWindow?.to === scope.to;
  const metric = value?.metrics?.productDetailViews;
  const count = metric?.value;
  if (!same || from === null || to === null || to <= from || !statuses.includes(value.status) ||
      value.attribution !== 'exact_product_id' || instant(value.sampledAt) === null ||
      value.complete !== false || value.dataLagSeconds !== null || value.freshness !== 'unknown' ||
      typeof value.completePagination !== 'boolean' || metric?.status !== value.status ||
      value.source?.kind !== 'ga4_data_api_v1beta' || typeof value.source.id !== 'string' ||
      scope.adapterId !== undefined && value.source.id !== scope.adapterId ||
      count !== null && (!Number.isSafeInteger(count) || count < 0 || value.status !== 'partial' || metric.status !== 'partial' || !value.completePagination) ||
      value.metrics?.sessions?.value !== null || value.metrics?.sessions?.status !== 'unsupported' ||
      value.metricDefinitions?.productDetailViews?.sourceMetric !== 'itemViewEvents') {
    throw Object.assign(new TypeError('Invalid exact-product traffic v2 observation.'), { code: 'PRODUCT_TRAFFIC_OBSERVATION_INVALID' });
  }
  if (value.coverage !== null) {
    const start = instant(value.coverage?.from), end = instant(value.coverage?.to);
    if (start === null || end === null || start < from || end > to || start >= end || value.granularity !== 'minute' || start % 60000 || end % 60000) {
      throw Object.assign(new TypeError('Traffic coverage must stay inside the original requested window.'), { code: 'PRODUCT_TRAFFIC_OBSERVATION_INVALID' });
    }
  } else if (count !== null) {
    throw Object.assign(new TypeError('A count requires acknowledged coverage.'), { code: 'PRODUCT_TRAFFIC_OBSERVATION_INVALID' });
  }
  return structuredClone(value);
}
