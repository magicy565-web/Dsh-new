import { createHash } from 'node:crypto';
import { validateIssue, safePublicUrl } from '../upstream/src/schema.js';
import { renderMagazine } from '../upstream/src/render.js';
import { productionReadiness } from './production.js';
import { normalizeIssue } from './adapters/module-issue.js';

export const MAX_INPUT_BYTES = 256 * 1024;
export const MAX_HTML_BYTES = 1024 * 1024;
export const FAILURES = Object.freeze({
  MAGAZINE_INPUT_INVALID: 'A complete, bounded issue JSON matching the Studio schema is required.',
  MAGAZINE_LOCAL_ASSET_UNSUPPORTED: 'Local, data, or other non-HTTPS image inputs are not supported. Explicitly omit the image or provide an authorized public HTTPS image.',
  MAGAZINE_ISSUE_INVALID: 'Issue validation failed. Check sources, rights, unknown terms, price basis, and public-only evidence.',
  MAGAZINE_OUTPUT_TOO_LARGE: 'The generated HTML exceeds the bounded file size.',
  MAGAZINE_SESSION_REQUIRED: 'Generation requires the current native Agent Session with an explicit workspace. No file was written.',
  MAGAZINE_WORKSPACE_DENIED: 'Generation is not permitted in the current Session workspace. No permissions were changed.',
  MAGAZINE_TARGET_CONFLICT: 'The generated filename conflicts with an existing or changing entry. Nothing was overwritten.',
  MAGAZINE_WRITE_DENIED: 'The native write policy did not authorize a create-only file. Nothing was overwritten.',
  MAGAZINE_WRITE_FAILED: 'Generation could not confirm the workspace file. A completed publication may remain; retry only the same input after inspecting its status. Nothing was automatically presented.',
  MAGAZINE_CANCELLED: 'Magazine generation was cancelled; delivery was not completed.',
  MAGAZINE_FAILED: 'Magazine operation failed; no delivery is confirmed.',
});
const owned = new WeakSet();
export function fail(code) { const error = new Error(FAILURES[code]); error.code = code; owned.add(error); throw error; }
export function failure(error) {
  if (owned.has(error)) return { code: error.code, message: FAILURES[error.code] };
  return { code: 'MAGAZINE_FAILED', message: FAILURES.MAGAZINE_FAILED };
}
function checkpoint(signal) { if (signal?.aborted) fail('MAGAZINE_CANCELLED'); }
const publicFields = new Set(('headlineLines voice text archetype craftStages webCard tone issueTag locationStamp pullQuote metrics title body label mode design brand reader editorialGoal visualConcept brandSourceIds imageTreatment distribution textLedRequested fontStyle palette paper surface ink accent fit position schemaVersion composition blocks id edition title subtitle date locale market theme demo cover kicker headline dek image editorNote highlights label text products sources insights dataNotes provenance mode collectedAt provider name supplier category region summary buyerFit watchout specs key value unit status sourceIds visibility asOf price kind amount currency basis minQty moq leadTime cta type url sponsored sponsor src alt role generated rights sourceId credit caption publisher accessedAt excerpt contentHash body data evidence product features imageUrl imageAlt imageRights imageGenerated productUrl buyerContext reasons unknowns signals interpretation uncertainties timing availability comparables period channel revenue measurement source comparability salePrice purchaseCost freight duty otherCost channelFeeRate assumptions columns rows caveats terms actionUrl territory term conditions slots').split(' '));
function publicIssue(error) {
  const parts = String(error.path).split('.');
  const path = parts.every(part => publicFields.has(part) || /^\d{1,3}$/.test(part)) ? parts.join('.') : 'issue';
  return { path, code: 'INVALID_FIELD' };
}
function parseInput(issueJson) {
  if (typeof issueJson !== 'string' || Buffer.byteLength(issueJson, 'utf8') > MAX_INPUT_BYTES) fail('MAGAZINE_INPUT_INVALID');
  let value;
  try { value = JSON.parse(issueJson); } catch { fail('MAGAZINE_INPUT_INVALID'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('MAGAZINE_INPUT_INVALID');
  try { value = normalizeIssue(value); } catch { fail('MAGAZINE_ISSUE_INVALID'); }
  // Refuse, never silently drop local image inputs (the upstream schema allows assets/).
  const images = [value.cover?.image, ...(Array.isArray(value.products) ? value.products.map(p => p?.image) : []),
    ...(Array.isArray(value.blocks) ? value.blocks.filter(b => b?.data?.imageUrl).map(b => ({ src: b.data.imageUrl })) : [])];
  for (const image of images) {
    if (image != null && (typeof image !== 'object' || typeof image.src !== 'string' || !safePublicUrl(image.src))) fail('MAGAZINE_LOCAL_ASSET_UNSUPPORTED');
  }
  // No public issue, including synthetic fixtures, may carry internal evidence.
  if (Array.isArray(value.sources) && value.sources.some(source => source?.kind === 'internal')) fail('MAGAZINE_ISSUE_INVALID');
  return value;
}
export function inspectIssue(issueJson, { now = new Date() } = {}) {
  const value = parseInput(issueJson);
  let report;
  try { report = validateIssue(value, { now }); } catch { fail('MAGAZINE_ISSUE_INVALID'); }
  if (report.valid && Date.parse(report.issue.provenance.collectedAt) > now.getTime() + 300000) fail('MAGAZINE_ISSUE_INVALID');
  // Do not echo untrusted field values, unknown object keys, source content, or error messages.
  return { valid: report.valid, errorCount: report.errors.length, warningCount: report.warnings.length,
    issues: report.errors.slice(0, 20).map(publicIssue), stats: report.stats, issue: report.issue };
}
export function compileDraft(issueJson, { now = new Date(), signal } = {}) {
  checkpoint(signal);
  const report = inspectIssue(issueJson, { now });
  if (!report.valid) fail('MAGAZINE_ISSUE_INVALID');
  const issue = report.issue;
  // Preserve the attributed Studio template plus documented price-text patches;
  // the compiler itself adds only the explicit draft banner.
  const banner = issue.locale === 'zh-CN' ? '审阅稿 · 未发送 · 不代表供应商资质或采购审批' : 'DRAFT FOR REVIEW · Not sent · Not supplier qualification or purchase approval';
  const html = renderMagazine(issue).replace('<body>', `<body><div class="demo-notice">${banner}</div>`);
  const data = Buffer.from(html, 'utf8');
  if (data.byteLength > MAX_HTML_BYTES) fail('MAGAZINE_OUTPUT_TOO_LARGE');
  checkpoint(signal);
  const sha256 = createHash('sha256').update(data).digest('hex');
  const id = issue.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48);
  const name = `buyer-magazine-${id}-${sha256.slice(0, 12)}.html`;
  const imageCount = [issue.cover.image, ...issue.products.map(product => product.image), ...(issue.blocks ?? []).map(b => b.data.imageUrl)].filter(Boolean).length;
  return { data, name, sha256, productCount: issue.products.length, sourceCount: issue.sources.length,
    externalImageCount: imageCount, warningCount: report.warningCount, draftOnly: true, readiness: productionReadiness(issue) };
}

