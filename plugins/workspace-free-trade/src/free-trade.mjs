/** Free trade adapters: official HTTP APIs, no model/queue/store/credential discovery. */
import {httpFailureDiagnostic,emitDiagnostic} from './http-diagnostics.mjs';
const TED = 'https://api.ted.europa.eu/v3/notices/search';
const SAM = 'https://api.sam.gov/opportunities/v2/search';
export const TED_FIELDS = Object.freeze(['publication-number', 'notice-title', 'publication-date',
  'notice-type', 'buyer-name', 'buyer-country', 'classification-cpv',
  'deadline-receipt-tender-date-lot', 'deadline-receipt-tender-time-lot']);
export const ERP_FIELDS = Object.freeze({
  Quotation: Object.freeze(['name', 'modified', 'docstatus', 'quotation_to', 'party_name', 'company', 'transaction_date', 'valid_till', 'currency', 'grand_total', 'status']),
  'Sales Order': Object.freeze(['name', 'modified', 'docstatus', 'customer', 'company', 'transaction_date', 'delivery_date', 'currency', 'grand_total', 'status']),
  'Sales Partner': Object.freeze(['name', 'modified', 'partner_name', 'partner_type', 'territory', 'commission_rate']),
  'Item Price': Object.freeze(['name', 'modified', 'item_code', 'price_list', 'buying', 'selling', 'currency', 'price_list_rate', 'valid_from', 'valid_upto'])
});
export class TradeError extends Error {
  constructor(code, status = 'blocked', retryAfterSeconds = null) {
    super(code); this.name = 'TradeError'; this.code = code; this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
const fail = (code = 'INPUT_INVALID', status = 'blocked') => { throw new TradeError(code, status); };
const abort = signal => { if (signal?.aborted) fail('OPERATION_CANCELLED'); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function shape(x, allowed, required = []) {
  if (!object(x) || Object.keys(x).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(x, k))) fail();
}
function text(x, max = 256) {
  if (typeof x !== 'string' || !x.length || x.length > max || x.trim() !== x || /[\x00-\x1f\x7f]/u.test(x)) fail();
  return x;
}
function integer(x, min, max) {
  if (!Number.isSafeInteger(x) || x < min || x > max) fail(); return x;
}
function date(x) {
  text(x, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(x)) fail();
  const ms = Date.parse(x + 'T00:00:00Z');
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== x) fail();
  return ms;
}
function name(x) {
  text(x, 140); if (/[\/\\%?#]/u.test(x) || x === '.' || x === '..') fail(); return x;
}
function credential(x) {
  if (typeof x !== 'string' || !/^[\x21-\x7e]{8,512}$/u.test(x) || x.includes(':')) fail('CREDENTIAL_INVALID');
  return x;
}
function noSecretEcho(value, secrets) {
  const encoded = JSON.stringify(value);
  if (secrets.some(s => s && (encoded.includes(s) || encoded.includes(encodeURIComponent(s))))) fail('SECRET_ECHO_REFUSED');
  return value;
}
export function validateTenderInput(input) {
  if (!object(input)) fail();
  if (input.provider === 'ted') {
    shape(input, ['provider', 'query', 'page', 'limit'], ['provider', 'query']);
    return Object.freeze({ provider: 'ted', query: text(input.query, 1000),
      page: integer(input.page ?? 1, 1, 100), limit: integer(input.limit ?? 5, 1, 10) });
  }
  if (input.provider !== 'sam') fail();
  shape(input, ['provider', 'title', 'postedFrom', 'postedTo', 'pageIndex', 'limit', 'naicsCode', 'noticeType'], ['provider', 'postedFrom', 'postedTo']);
  const from = date(input.postedFrom), to = date(input.postedTo);
  // Conservative <=365 days; no implicit widening and no unbounded historical scan.
  if (to < from || to - from > 365 * 86400000) fail('DATE_RANGE_INVALID');
  const out = { provider: 'sam', postedFrom: input.postedFrom, postedTo: input.postedTo,
    pageIndex: integer(input.pageIndex ?? 0, 0, 99), limit: integer(input.limit ?? 5, 1, 10) };
  if (input.title !== undefined) out.title = text(input.title, 200);
  if (input.naicsCode !== undefined) { if (!/^\d{2,6}$/u.test(text(input.naicsCode, 6))) fail(); out.naicsCode = input.naicsCode; }
  if (input.noticeType !== undefined) { if (!['u', 'p', 'a', 'r', 's', 'o', 'g', 'k', 'i'].includes(input.noticeType)) fail(); out.noticeType = input.noticeType; }
  return Object.freeze(out);
}
/** One bounded request. No retry, redirect, background operation or response-body logging. */
export async function requestJson(url, { method = 'GET', headers = {}, body, signal, fetchImpl = globalThis.fetch, timeoutMs = 15000, maxBytes = 524288, onDiagnostic } = {}) {
  integer(timeoutMs, 1, 30000); integer(maxBytes, 1, 1048576);
  const combined = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  let response,diagnosed=false;
  try {
    combined.throwIfAborted();
    response = await fetchImpl(url, { method, headers: { Accept: 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual', signal: combined });
    combined.throwIfAborted();
    if(!response.ok&&response.status>=400&&typeof onDiagnostic==='function'){
      // An optional trusted observer receives a bounded whitelist projection.
      // Failure of diagnostics never substitutes for the original HTTP error.
      diagnosed=true;try{emitDiagnostic(onDiagnostic,await httpFailureDiagnostic(response,{signal:combined}));}catch{}
    }
    if (response.redirected || (response.status >= 300 && response.status < 400)) fail('REDIRECT_REFUSED');
    if (response.status === 429) {
      const after = response.headers.get('retry-after');
      throw new TradeError('RATE_LIMITED', 'unavailable', /^\d{1,5}$/u.test(after ?? '') ? Math.min(Number(after), 86400) : null);
    }
    if ([401, 403].includes(response.status)) fail('REMOTE_AUTHORIZATION_REFUSED');
    if (!response.ok) fail('REMOTE_HTTP_ERROR', 'unavailable');
    if (!/\bapplication\/(?:[a-z0-9.+-]*\+)?json\b/iu.test(response.headers.get('content-type') ?? '')) fail('REMOTE_NOT_JSON', 'unavailable');
    if (Number(response.headers.get('content-length')) > maxBytes) fail('RESPONSE_TOO_LARGE', 'unavailable');
    if (!response.body) fail('EMPTY_RESPONSE', 'unavailable');
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      while (true) {
        combined.throwIfAborted(); const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > maxBytes) fail('RESPONSE_TOO_LARGE', 'unavailable'); chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    combined.throwIfAborted();
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!object(data)) fail('REMOTE_SCHEMA_INVALID', 'unavailable');
    return data;
  } catch (error) {
    if(!response&&!diagnosed)emitDiagnostic(onDiagnostic,{stage:'transport',classification:signal?.aborted?'cancelled':combined.aborted?'timeout':'network_unavailable',httpStatus:null,causeProven:false});
    if (signal?.aborted) fail('OPERATION_CANCELLED');
    // The HTTP status arrived before diagnostic sampling. Its known refusal
    // must not turn into a transport timeout because the error body stalled.
    if(diagnosed&&error instanceof TradeError)throw error;
    if (combined.aborted) fail('REQUEST_TIMEOUT', 'unavailable');
    if (error instanceof TradeError) throw error;
    fail(error instanceof SyntaxError ? 'REMOTE_NOT_JSON' : 'NETWORK_UNAVAILABLE', 'unavailable');
  } finally {
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
  }
}
const mmddyyyy = x => `${x.slice(5, 7)}/${x.slice(8, 10)}/${x.slice(0, 4)}`;
function sourceValue(x) { return x === undefined || x === '' || x === 'null' ? null : x; }
function publicRecord(row, provider, retrievedAt) {
  if (!object(row)) fail('REMOTE_SCHEMA_INVALID', 'unavailable');
  const id = provider === 'ted' ? row['publication-number'] : row.noticeId;
  const valid = provider === 'ted' ? /^\d{1,8}-\d{4}$/u : /^[A-Za-z0-9_-]{1,128}$/u;
  if (typeof id !== 'string' || !valid.test(id)) fail('NOTICE_ID_INVALID', 'unavailable');
  return {
    provider, noticeId: id,
    title: sourceValue(provider === 'ted' ? row['notice-title'] : row.title),
    buyer: sourceValue(provider === 'ted' ? row['buyer-name'] : row.fullParentPathName),
    publishedAtRaw: sourceValue(provider === 'ted' ? row['publication-date'] : row.postedDate),
    noticeType: sourceValue(provider === 'ted' ? row['notice-type'] : row.type),
    classification: sourceValue(provider === 'ted' ? row['classification-cpv'] : row.naicsCode),
    countryRaw: sourceValue(provider === 'ted' ? row['buyer-country'] : row.placeOfPerformance?.country?.code),
    deadline: { dateRaw: sourceValue(provider === 'ted' ? row['deadline-receipt-tender-date-lot'] : (row.responseDeadLine ?? row.reponseDeadLine)),
      timeRaw: sourceValue(provider === 'ted' ? row['deadline-receipt-tender-time-lot'] : undefined), interpretation: 'unverified' },
    activeRaw: sourceValue(provider === 'sam' ? row.active : undefined),
    setAsideRaw: sourceValue(provider === 'sam' ? (row.typeOfSetAside ?? row.setAsideCode) : undefined),
    sourceUrl: provider === 'ted' ? `https://ted.europa.eu/en/notice/-/detail/${id}` : `https://sam.gov/opp/${id}/view`,
    retrievedAt, eligibility: 'not_assessed', openForBids: null
  };
}
export function createTenderClient({ samApiKey, fetchImpl = globalThis.fetch, timeoutMs = 15000, now = () => new Date(), onDiagnostic } = {}) {
  if (samApiKey !== undefined) credential(samApiKey);
  return Object.freeze({
    status() { return { ted: 'configured_unverified', sam: samApiKey ? 'configured_unverified' : 'unconfigured' }; },
    async search(raw, signal) {
      const input = validateTenderInput(raw); abort(signal);
      if (input.provider === 'sam' && !samApiKey) fail('SAM_API_KEY_REQUIRED', 'unconfigured');
      const url = new URL(input.provider === 'ted' ? TED : SAM);
      let options = { signal, fetchImpl, timeoutMs };
      if (input.provider === 'ted') options = { ...options, ...(typeof onDiagnostic==='function'?{onDiagnostic:value=>onDiagnostic({provider:'ted',operation:'anonymous-published-search',...value})}:{}),method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: { query: input.query, fields: [...TED_FIELDS], page: input.page, limit: input.limit, paginationMode: 'PAGE_NUMBER' } };
      else {
        const params = { api_key: samApiKey, postedFrom: mmddyyyy(input.postedFrom), postedTo: mmddyyyy(input.postedTo), limit: input.limit, offset: input.pageIndex };
        if (input.title !== undefined) params.title = input.title;
        if (input.naicsCode !== undefined) params.ncode = input.naicsCode;
        if (input.noticeType !== undefined) params.ptype = input.noticeType;
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
      }
      const data = await requestJson(url, options); abort(signal);
      const rows = input.provider === 'ted' ? data.notices : data.opportunitiesData;
      if (!Array.isArray(rows) || rows.length > input.limit) fail('REMOTE_SCHEMA_INVALID', 'unavailable');
      if (input.provider === 'sam' && (data.offset !== input.pageIndex || data.limit !== input.limit)) fail('PAGINATION_MISMATCH', 'unavailable');
      const retrievedAt = now().toISOString();
      const items = rows.map(row => publicRecord(row, input.provider, retrievedAt));
      // Duplicate publications are retained and flagged: never merge lot/version facts silently.
      const duplicated = new Set(items.map(x => x.noticeId)).size !== items.length;
      const totalRaw = input.provider === 'ted' ? data.totalNoticeCount : data.totalRecords;
      const total = Number.isSafeInteger(totalRaw) && totalRaw >= 0 ? totalRaw : null;
      const pageIndex = input.provider === 'ted' ? input.page - 1 : input.pageIndex;
      const mayHaveMore = total === null ? null : (pageIndex + 1) * input.limit < total;
      return noSecretEcho({ status: 'ok', provider: input.provider, items, total,
        pagination: { pageIndex, pageSize: input.limit, returned: rows.length, mayHaveMore, completeDataset: false },
        retrievedAt, sources: items.map(x => x.sourceUrl), warnings: [
          'PUBLIC_NOTICE_IS_NOT_BUYER_QUALIFICATION_OR_A_CONFIRMED_ORDER', 'CHECK_ORIGINAL_NOTICE_LOTS_AMENDMENTS_AND_ELIGIBILITY',
          ...(duplicated ? ['DUPLICATE_PUBLICATION_IDS_RETAINED'] : [])], contentTrust: 'untrusted_external_data', externalWrites: false }, [samApiKey]);
    }
  });
}
export function validateErpRead(input) {
  shape(input, ['doctype', 'name', 'fields'], ['doctype', 'name', 'fields']);
  if (!Object.hasOwn(ERP_FIELDS, input.doctype)) fail('DOCTYPE_REFUSED');
  name(input.name);
  if (!Array.isArray(input.fields) || !input.fields.length || input.fields.length > 13 || new Set(input.fields).size !== input.fields.length || input.fields.some(f => !ERP_FIELDS[input.doctype].includes(f))) fail('FIELD_REFUSED');
  return Object.freeze({ doctype: input.doctype, name: input.name, fields: Object.freeze([...input.fields]) });
}
export function createErpNextClient({ baseUrl, apiKey, apiSecret, authorizeRecord, fetchImpl = globalThis.fetch, timeoutMs = 15000, allowLoopbackHttpForTests = false } = {}) {
  let origin = null;
  if (baseUrl !== undefined) {
    try {
      const u = new URL(baseUrl);
      if (u.username || u.password || u.search || u.hash || u.pathname !== '/' ||
        (u.protocol !== 'https:' && !(allowLoopbackHttpForTests && u.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(u.hostname)))) fail('ERP_ORIGIN_INVALID');
      origin = u.origin;
    } catch { fail('ERP_ORIGIN_INVALID'); }
  }
  if (apiKey !== undefined) credential(apiKey); if (apiSecret !== undefined) credential(apiSecret);
  const configured = Boolean(origin && apiKey && apiSecret && typeof authorizeRecord === 'function');
  return Object.freeze({
    status() { return configured ? 'configured_unverified' : 'unconfigured'; },
    async read(raw, signal, receiver) {
      const input = validateErpRead(raw);
      if (!configured) fail('ERP_REVIEWED_CONNECTION_REQUIRED', 'unconfigured');
      if (!receiver) fail('EXACT_MODEL_RECEIVER_REQUIRED');
      const scope = Object.freeze({ ...input, origin });
      async function check() {
        abort(signal);
        try { if (await authorizeRecord(scope, signal, receiver) !== true) fail('ORIGINAL_AUTHORIZATION_REFUSED'); }
        catch (e) { if (signal?.aborted) fail('OPERATION_CANCELLED'); fail('ORIGINAL_AUTHORIZATION_REFUSED'); }
        abort(signal);
      }
      await check();
      const url = new URL(`/api/resource/${encodeURIComponent(input.doctype)}`, origin);
      // Use Frappe's field projection rather than fetching an entire private document.
      url.searchParams.set('fields', JSON.stringify([...new Set(['name', ...input.fields])]));
      url.searchParams.set('filters', JSON.stringify([[input.doctype, 'name', '=', input.name]]));
      url.searchParams.set('limit_page_length', '1');
      url.searchParams.set('limit_start', '0');
      const response = await requestJson(url, { signal, fetchImpl, timeoutMs, headers: { Authorization: `token ${apiKey}:${apiSecret}` } });
      await check();
      if (!Array.isArray(response.data) || response.data.length !== 1 || !object(response.data[0]) || response.data[0].name !== input.name || (response.data[0].doctype !== undefined && response.data[0].doctype !== input.doctype)) fail('ERP_RECORD_MISMATCH', 'unavailable');
      const record = Object.fromEntries(input.fields.map(f => {
        const value = response.data[0][f] ?? null;
        if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) fail('ERP_FIELD_SHAPE_INVALID', 'unavailable');
        if ((typeof value === 'string' && value.length > 2048) || (typeof value === 'number' && !Number.isFinite(value))) fail('ERP_FIELD_SHAPE_INVALID', 'unavailable');
        return [f, value];
      }));
      return noSecretEcho({ status: 'ok', doctype: input.doctype, name: input.name, fields: [...input.fields], record,
        sourceUrl: url.toString(), sources: [url.toString()], contentTrust: 'private_source_data', externalWrites: false }, [apiKey, apiSecret]);
    }
  });
}
/** Map explicitly supplied commercial terms; ERPNext still owns pricing/tax/master-data rules. */
export function prepareQuotation(input) {
  shape(input, ['company', 'customer', 'currency', 'transactionDate', 'validTill', 'items'], ['company', 'customer', 'currency', 'transactionDate', 'validTill', 'items']);
  name(input.company); name(input.customer);
  if (!/^[A-Z]{3}$/u.test(text(input.currency, 3))) fail();
  if (date(input.validTill) < date(input.transactionDate)) fail('DATE_RANGE_INVALID');
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 20) fail();
  const items = input.items.map(item => {
    shape(item, ['itemCode', 'qty', 'rate', 'uom'], ['itemCode', 'qty', 'rate', 'uom']); name(item.itemCode); name(item.uom);
    if (!Number.isFinite(item.qty) || item.qty <= 0 || item.qty > 1e9 || !Number.isFinite(item.rate) || item.rate < 0 || item.rate > 1e12) fail();
    return { item_code: item.itemCode, qty: item.qty, rate: item.rate, uom: item.uom };
  });
  return { status: 'prepared-draft', document: { doctype: 'Quotation', docstatus: 0, quotation_to: 'Customer', company: input.company,
    party_name: input.customer, currency: input.currency, transaction_date: input.transactionDate, valid_till: input.validTill, items },
    humanReviewed: false, humanReviewRequired: true, persisted: false, externalWrites: false,
    pricingRulesApplied: false, totalsCalculated: false, masterDataVerified: false,
    warnings: ['USER_SUPPLIED_TERMS_NOT_VERIFIED', 'ERP_MUST_VALIDATE_MASTERS_PRICING_TAX_SHIPPING_AND_PAYMENT_TERMS', 'NOT_CREATED_SUBMITTED_SENT_OR_ORDERED'] };
}
export const TENDER_INPUT = { type: 'object', additionalProperties: false, required: ['provider'], properties: {
  provider: { type: 'string', enum: ['ted', 'sam'] }, query: { type: 'string', minLength: 1, maxLength: 1000 },
  page: { type: 'integer', minimum: 1, maximum: 100 }, limit: { type: 'integer', minimum: 1, maximum: 10 },
  title: { type: 'string', minLength: 1, maxLength: 200 }, postedFrom: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, postedTo: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  pageIndex: { type: 'integer', minimum: 0, maximum: 99 }, naicsCode: { type: 'string', pattern: '^\\d{2,6}$' }, noticeType: { type: 'string', enum: ['u','p','a','r','s','o','g','k','i'] }
} };
export const ERP_READ_INPUT = { type: 'object', additionalProperties: false, required: ['doctype', 'name', 'fields'], properties: {
  doctype: { type: 'string', enum: Object.keys(ERP_FIELDS) }, name: { type: 'string', minLength: 1, maxLength: 140 },
  fields: { type: 'array', minItems: 1, maxItems: 13, uniqueItems: true, items: { type: 'string', enum: [...new Set(Object.values(ERP_FIELDS).flat())] } }
} };
export const QUOTATION_INPUT = { type: 'object', additionalProperties: false, required: ['company','customer','currency','transactionDate','validTill','items'], properties: {
  company: { type: 'string', minLength: 1, maxLength: 140 }, customer: { type: 'string', minLength: 1, maxLength: 140 }, currency: { type: 'string', pattern: '^[A-Z]{3}$' },
  transactionDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, validTill: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  items: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', additionalProperties: false, required: ['itemCode','qty','rate','uom'], properties: {
    itemCode: { type: 'string', minLength: 1, maxLength: 140 }, qty: { type: 'number', exclusiveMinimum: 0, maximum: 1e9 }, rate: { type: 'number', minimum: 0, maximum: 1e12 }, uom: { type: 'string', minLength: 1, maxLength: 140 }
  } } }
} };
