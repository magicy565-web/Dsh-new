import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBusinessSources, analyzeInquiryFunnel } from '../plugins/workspace-goal-intelligence/src/diagnostics.mjs';
import { openFixture, contextInput, model } from './fixtures/goal-brain-fixture.mjs';
import { sourceId } from '../plugins/workspace-goal-intelligence/src/contracts.mjs';

const now = Date.parse('2026-10-16T06:00:00Z');
const measurement = (overrides = {}) => ({
  metricType: 'inquiry-funnel-v1', windowStart: '2026-09-01T00:00:00Z', windowEnd: '2026-10-01T00:00:00Z',
  eligible: 100, converted: 10, pending: 0, unknown: 0,
  segment: { productId: 'cloth', market: 'US', channel: 'inbound-rfq' },
  baseline: { windowStart: '2026-08-01T00:00:00Z', windowEnd: '2026-08-31T00:00:00Z',
    eligible: 100, converted: 15, pending: 0, unknown: 0 },
  ...overrides,
});
const source = (v, enterprise = 'A') => ({
  evidenceId: 'metric:rfq-funnel', reference: { kind: 'metric', id: 'rfq-funnel', revision: '1', sha256: 'a'.repeat(64), fields: Object.keys(v) },
  observedAt: '2026-10-16T05:00:00Z', values: v, workspaceId: enterprise,
});
const code = (fn, error) => assert.throws(fn, e => e.code === error);

test('complete explicitly segmented cohorts produce descriptive delta, not causal conclusion', () => {
  const r = analyzeInquiryFunnel(source(measurement()), now);
  assert.equal(r.current.rate, .1);
  assert.equal(r.baseline.rate, .15);
  assert.equal(r.descriptiveRateDelta, -.05);
  assert.equal(r.comparisonStatus, 'descriptive-only');
  assert.equal(r.conclusion, 'measurement-not-causal-diagnosis');
  assert.equal(r.recommendationsAllowed, false);
  assert.equal(r.businessGoalVerified, false);
});
test('pending and unknown records never count as lost sales or mature denominators', () => {
  const r=analyzeInquiryFunnel(source(measurement({eligible:100,converted:10,pending:30,unknown:10})),now);
  assert.equal(r.current.observed,60); assert.equal(r.current.rate, 1/6); assert.equal(r.current.coverage,.6);
  assert.equal(r.descriptiveRateDelta,null);assert.ok(r.gaps.includes('UNKNOWN_COHORT_OUTCOMES'));
  assert.equal(r.comparisonStatus,'incomplete-or-unmeasurable-cohorts');
});
test('no baseline remains missing, not a zero rate',()=>{
  const r=analyzeInquiryFunnel(source(measurement({baseline:null,eligible:0,converted:0,pending:0,unknown:0})),now);
  assert.equal(r.current.rate,null);assert.equal(r.descriptiveRateDelta,null);assert.ok(r.gaps.includes('NO_COMPARABLE_BASELINE'));
});
test('cohorts with impossible numerators reject',()=>code(()=>analyzeInquiryFunnel(source(measurement({eligible:10,converted:9,pending:9})),now),'BRAIN_COHORT_INVALID'));
test('future or inverted windows reject',()=>{
  code(()=>analyzeInquiryFunnel(source(measurement({windowEnd:'2026-10-17T00:00:00Z'})),now),'BRAIN_METRIC_WINDOW_INVALID');
  code(()=>analyzeInquiryFunnel(source(measurement({windowStart:'2026-10-02T00:00:00Z'})),now),'BRAIN_METRIC_WINDOW_INVALID');
});
test('overlapping baseline refuses invalid comparison',()=>code(()=>analyzeInquiryFunnel(source(measurement({baseline:{...measurement().baseline,windowEnd:'2026-09-15T00:00:00Z'}})),now),'BRAIN_METRIC_WINDOW_OVERLAP'));
test('unknown metric types and missing typed metrics never fabricate an issue',()=>{
  const r=analyzeBusinessSources([source({metricType:'visits',value:123})],now);
  assert.equal(r.status,'no-supported-metrics');assert.equal(r.signals.length,0);assert.equal(r.gaps[0].reason,'UNSUPPORTED_METRIC_TYPE');
});
test('no unauthorized extra fields or malformed segments can enter a diagnosis',()=>{
  code(()=>analyzeInquiryFunnel(source(measurement({approved:true})),now),'BRAIN_METRIC_INVALID');
  code(()=>analyzeInquiryFunnel(source(measurement({segment:{market:'US',channel:'inbound-rfq'}})),now),'BRAIN_METRIC_INVALID');
  code(()=>analyzeInquiryFunnel(source(measurement({baseline:{...measurement().baseline,forecast:true}})),now),'BRAIN_METRIC_INVALID');
});
test('brain diagnoses authorized source, revalidates receipt, blocks revocation and cross-enterprise borrowing',async t=>{
  const f=openFixture(); t.after(()=>f.close());f.addGoal('A'); f.addGoal('B');
  const ref=f.addSource('A','metric','rfq-funnel',measurement());
  const a=f.makeBrain('A'); const b=f.makeBrain('B');
  await a.brain.contextSave(contextInput([ref]),undefined,model);
  const report=await a.brain.diagnose({},undefined,model);
  assert.equal(report.kind,'diagnosis');assert.equal(report.persisted,true);assert.equal(report.data.signals.length,1);
  assert.equal(await a.brain.revalidateReceipt(report,undefined,model),true);
  await assert.rejects(()=>b.brain.revalidateReceipt(report,undefined,model),e=>e.code==='BRAIN_CACHE_REFUSED');
  f.state.sourceRevoked=true;
  await assert.rejects(()=>a.brain.revalidateReceipt(report,undefined,model),e=>e.code==='BRAIN_AUTHORIZATION_REFUSED');
  assert.equal(f.state.commitCount,1);
});
test('diagnosis cold start has no signals, no writes',async t=>{
  const f=openFixture();t.after(()=>f.close());f.addGoal('A'); const {brain}=f.makeBrain('A');
  const r=await brain.diagnose({},undefined,model);
  assert.equal(r.status,'empty');assert.equal(r.data.coldStart,true);assert.deepEqual(r.data.signals,[]);
  assert.equal(f.state.commitCount,0);
});
