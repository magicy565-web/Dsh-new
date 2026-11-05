/** Read-only boundary for owner-exported Sites factory records. No network, writes or publication. */
const FIELDS = Object.freeze(['企业身份','产品','工艺与设备','产能','定制能力','批发价','MOQ','交期','贸易条件','认证']);
const FIELD_SET = new Set(FIELDS);
const MAX_BYTES = 128 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;
const TEXT_LIMITS = { title: 250, value: 1200, quote: 1500 };
const PUBLIC_STAGES = new Set(['research_review','buyer_enabled']);
function textWithin(value, max) { return typeof value === 'string' && !!value.trim() && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value); }
function safeHttps(value) {
  if (!textWithin(value, 2048)) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
      && host.includes('.') && !host.endsWith('.') && !/^(?:\d+\.){3}\d+$/.test(host)
      && !host.includes(':') && !/(^|\.)(?:localhost|local|internal|home|lan|test|invalid|onion)$/.test(host)
      && ![...url.searchParams.keys()].some(k=>/^(?:api[-_]?key|token|access[-_]?token|authorization|password|secret)$/i.test(k));
  } catch { return false; }
}
function blocked(reason) {return {status:'blocked',reason,publicationAllowed:false,outreachAllowed:false};}
/**
 * Do not infer that "confirmed" means independent verification: it only reports
 * the owner-workbench state. URLs and quotes are *references*, not live-checked.
 */
export function prepareSitesEvidence(recordJson, expectedRevision, {now = new Date()} = {}) {
  if (typeof recordJson !== 'string' || Buffer.byteLength(recordJson,'utf8') > MAX_BYTES) return blocked('RECORD_INVALID');
  let record;
  try { record = JSON.parse(recordJson); } catch { return blocked('RECORD_INVALID'); }
  if (!record || typeof record !== 'object' || Array.isArray(record)) return blocked('RECORD_INVALID');
  if (!UUID.test(record.id) || !textWithin(record.title, TEXT_LIMITS.title) || !safeHttps(record.url)
      || !Number.isSafeInteger(record.revision) || record.revision < 1
      || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return blocked('RECORD_INVALID');
  if (record.revision !== expectedRevision) return blocked('REVISION_CONFLICT');
  if (!PUBLIC_STAGES.has(record.stage)) return blocked('STAGE_NOT_SUPPORTED');
  if (!Array.isArray(record.claims) || record.claims.length > 100 || !Array.isArray(record.missing_fields)
      || record.missing_fields.some(f=>!FIELD_SET.has(f))) return blocked('RECORD_INVALID');
  const ownerHost = new URL(record.url).hostname.toLowerCase();
  const seen = new Set(), approved = [], pending = [], rejected = [];
  for (const claim of record.claims) {
    if (!claim || typeof claim !== 'object' || !UUID.test(claim.id) || seen.has(claim.id)
        || !FIELD_SET.has(claim.field) || !['confirmed','candidate'].includes(claim.classification)) return blocked('RECORD_INVALID');
    seen.add(claim.id);
    const value = claim.buyerValue ?? claim.value_en;
    const time = Date.parse(claim.capturedAt ?? claim.captured_at);
    if (!textWithin(value, TEXT_LIMITS.value) || !textWithin(claim.quote, TEXT_LIMITS.quote)
        || !safeHttps(claim.source) || !TIMESTAMP.test(claim.capturedAt ?? claim.captured_at ?? '')
        || !Number.isFinite(time) || time > now.getTime()+300000) {
      rejected.push({id:claim.id,field:claim.field,reason:'UNUSABLE_EVIDENCE'});
      continue;
    }
    const item = {id:claim.id,field:claim.field,textEn:value,sourceUrl:claim.source,
      sourceExcerpt:claim.quote,capturedAt:new Date(time).toISOString(),
      sourceType:new URL(claim.source).hostname.toLowerCase() === ownerHost?'supplier_self_published':'external_source',
      independentlyVerified:false};
    if (claim.classification === 'candidate') pending.push(item);
    else approved.push(item);
  }
  const allowEditorialFacts = record.stage === 'buyer_enabled' && rejected.length === 0;
  const factsForEditor = allowEditorialFacts ? approved : [];
  const notConfirmedFields = FIELDS.filter(field=>!approved.some(item=>item.field===field));
  return {
    status: rejected.length ? 'review_required' : record.stage==='buyer_enabled'&&approved.length ? 'evidence_ready_for_editor' : 'review_required',
    id: record.id, title: record.title, factoryUrl: record.url, revision: record.revision, stage: record.stage,
    factsForEditor, pendingReview:pending, invalidEvidence:rejected,
    declaredMissingFields:[...new Set(record.missing_fields)], notConfirmedFields,
    editorialDraftAllowed: allowEditorialFacts && approved.length>0,
    publicationAllowed:false, outreachAllowed:false,
    provenanceNotice:'Classification is workbench review state, not independent third-party verification. Source excerpts have not been re-fetched. Publication, image rights, supplier qualifications and outreach require separate human authorization.'
  };
}
