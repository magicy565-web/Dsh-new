// Local smoke test for the Business Memory harness plugin.
//
// It talks to a running composition over HTTP only (default
// http://127.0.0.1:8790) and uses synthetic business facts. It writes real
// records into .harness-data, so run it against a disposable local harness.
// Assertions are relative to the counts observed at start, so the script can be
// re-run without a reset.
//
// Usage: node scripts/business-memory-smoke.mjs
import { writeFileSync } from 'node:fs';

const BASE = process.env.BUSINESS_MEMORY_BASE_URL || 'http://127.0.0.1:8790';
const results = [];
let failures = 0;

function check(name, condition, detail = undefined) {
  results.push({ name, ok: Boolean(condition), ...(detail === undefined ? {} : { detail }) });
  if (!condition) failures += 1;
}

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json; charset=utf-8' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 200) }; }
  return { status: response.status, body: payload };
}

const proposal = (overrides = {}) => ({
  requestId: crypto.randomUUID(),
  subjectType: 'customer',
  subjectId: 'customer-haiqi',
  subjectLabel: '海祺贸易',
  factKey: 'reorder-window',
  kind: 'fact',
  statement: '海祺贸易通常在每年 3 月和 9 月补货。',
  source: { kind: 'operator', basis: '2026-10-21 与客户采购负责人通话确认', label: '电话记录' },
  tags: ['复购', '节奏'],
  ...overrides,
});

const baseline = await call('/api/business-memory/status');
check('status reachable', baseline.status === 200, baseline.body);
check('status workspace is local', baseline.body?.workspaceId === 'local');
check('status requires human review', baseline.body?.humanReviewRequired === true);

const area = await fetch(BASE + '/business-memory');
const areaText = await area.text();
check('area page is html', area.status === 200 && areaText.includes('经营记忆'));

const first = await call('/api/business-memory/records', { method: 'POST', body: proposal() });
check('proposal is pending', first.status === 201 && first.body?.record?.status === 'proposed', first.body?.error);
check('proposal keeps the Chinese statement', first.body?.record?.statement === '海祺贸易通常在每年 3 月和 9 月补货。');
check('proposal is human-attested', first.body?.record?.source?.attestation === 'human-attested');

const activeBefore = await call('/api/business-memory/records');
check('pending memory is not a fact', activeBefore.body?.total === baseline.body.active, { total: activeBefore.body?.total, baseline: baseline.body.active });

const approved = await call(`/api/business-memory/records/${first.body.record.id}/review`, {
  method: 'POST', body: { decision: 'approve', requestId: crypto.randomUUID(), note: '与客户确认' },
});
check('approval activates the fact', approved.body?.record?.status === 'active', approved.body);
check('approval records the reviewer', approved.body?.record?.reviewedBy === 'local-operator');

const recalled = await call('/api/business-memory/records?q=补货');
check('recall finds the active fact', recalled.body?.total >= 1 && recalled.body.items.some(item => item.id === first.body.record.id), recalled.body?.total);

const second = await call('/api/business-memory/records', {
  method: 'POST',
  body: proposal({ requestId: crypto.randomUUID(), statement: '海祺贸易改为每年 4 月和 10 月补货。' }),
});
const superseded = await call(`/api/business-memory/records/${second.body.record.id}/review`, {
  method: 'POST', body: { decision: 'approve', requestId: crypto.randomUUID() },
});
check('a newer fact gets the next revision', superseded.body?.record?.revision > first.body.record.revision, superseded.body?.record?.revision);
check('a newer fact chains the previous one', superseded.body?.record?.previousId === first.body.record.id);
const all = await call('/api/business-memory/records?status=all&limit=50');
const old = all.body.items.find(item => item.id === first.body.record.id);
check('the old fact is superseded', old?.status === 'superseded');

const pendingProduct = await call('/api/business-memory/records', {
  method: 'POST',
  body: proposal({
    requestId: crypto.randomUUID(), subjectType: 'product', subjectId: 'prod_linen', subjectLabel: '亚麻衬衫',
    factKey: 'buyer-profile', kind: 'observation',
    statement: '美国度假衬衫品牌更关注透气和可水洗，而不是最低价。',
    source: { kind: 'conversation', ref: 'conversation-2026-10-21', label: '经营对话' },
  }),
});
check('conversation proposal is pending', pendingProduct.body?.record?.status === 'proposed');

const map = await call('/api/business-memory/map');
check('map counts the active fact', map.body?.counts?.active >= baseline.body.active + 1, map.body?.counts);
check('map reports customer coverage', map.body?.subjects?.find(row => row.subjectType === 'customer')?.coverage !== 'none');

const brief = await call('/api/business-memory/brief');
check('brief is generated', brief.status === 200 && Array.isArray(brief.body?.items));
check('brief cites existing memory only', brief.body.items.every(item => item.evidenceIds.every(id => all.body.items.some(record => record.id === id))));
check('brief counts the pending proposals', brief.body?.basedOn?.proposed >= 1);
check('brief contains no forecast vocabulary', !/forecast|revenue|probability|预计/iu.test(JSON.stringify(brief.body.items)));

const bad = await call('/api/business-memory/records', {
  method: 'POST',
  body: proposal({ requestId: crypto.randomUUID(), source: { kind: 'operator' } }),
});
check('unsourced operator memory is refused', bad.status === 400 && bad.body?.error?.code === 'BUSINESS_MEMORY_INPUT', bad.body?.error?.code);

const forbidden = await call('/api/business-memory/records', {
  method: 'POST', body: proposal({ requestId: crypto.randomUUID() }),
  headers: { 'x-harness-actor': 'unknown-actor', 'x-harness-role': 'admin' },
});
check('unknown workspace member is refused', forbidden.status === 403, forbidden.body?.error?.code);

const report = { base: BASE, generatedAt: new Date().toISOString(), passed: results.length - failures, failed: failures, results };
const outIndex = process.argv.indexOf('--out');
if (outIndex !== -1 && process.argv[outIndex + 1]) writeFileSync(process.argv[outIndex + 1], `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (failures > 0) process.exitCode = 1;
