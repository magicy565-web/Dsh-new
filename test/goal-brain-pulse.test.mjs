import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBusinessPulse } from '../plugins/workspace-goal-intelligence/src/pulse.mjs';

const product = { evidenceId:'product:cloth', reference:{kind:'product',id:'cloth'}, values:{name:'Rayon'} };
const baseContext = {
  context:{ payload:{ goalIds:['goal-1'], unknowns:[] } },
  sources:[product],
};
const signal = (changes={}) => ({
  evidenceId:'metric:rfq',
  current:{eligible:100,converted:10,pending:0,unknown:0},
  gaps:[],
  descriptiveRateDelta:null,
  ...changes,
});
test('cold start produces one honest setup action and no invented business diagnosis',()=>{
  const cards=buildBusinessPulse({context:null});
  assert.equal(cards.length,1);assert.equal(cards[0].id,'context:missing');assert.equal(cards[0].executable,false);assert.deepEqual(cards[0].evidenceIds,[]);
});
test('context gaps outrank routine review suggestions',()=>{
  const cards=buildBusinessPulse({context:{...baseContext,context:{payload:{goalIds:['goal-1'],unknowns:['毛利','真实客户流失原因']}}},decisionCards:[{decisionId:'d1',goalId:'goal-1',title:'旧决策',hasOutcomeReview:false}]});
  assert.equal(cards[0].id,'context:unknowns');
  assert.ok(cards.some(x=>x.id==='decision:d1'));
});
test('pending and unknown inquiry outcomes become action prompts, not lost-sale claims',()=>{
  const cards=buildBusinessPulse({context:baseContext,diagnosis:{signals:[signal({current:{eligible:100,converted:10,pending:20,unknown:5}})]}});
  assert.equal(cards[0].id,'metric:unknown:metric:rfq');
  assert.match(cards[0].reason,/结果未知/);
  assert.equal(cards[0].executable,false);
});
test('descriptive decline is surfaced without claiming a cause',()=>{
  const cards=buildBusinessPulse({context:baseContext,diagnosis:{signals:[signal({descriptiveRateDelta:-0.05})]}});
  assert.equal(cards[0].id,'metric:decline:metric:rfq');
  assert.match(cards[0].reason,/描述性变化/);
});
test('missing baseline is prioritized above descriptive movement',()=>{
  const cards=buildBusinessPulse({context:baseContext,diagnosis:{signals:[signal({gaps:['NO_COMPARABLE_BASELINE'],descriptiveRateDelta:-0.2})]}});
  assert.equal(cards[0].id,'metric:baseline:metric:rfq');
});
test('no supported metric produces a data-gap action rather than a made-up KPI',()=>{
  const cards=buildBusinessPulse({context:baseContext,diagnosis:{signals:[]}});
  assert.equal(cards[0].id,'metric:missing');assert.match(cards[0].reason,/没有可用于经营判断/);
});
test('at most three stable cards are returned and duplicates are suppressed',()=>{
  const cards=buildBusinessPulse({
    context:{...baseContext,context:{payload:{goalIds:['goal-1'],unknowns:['A','B','C']}}},
    diagnosis:{signals:[signal({current:{eligible:100,converted:10,pending:5,unknown:0},gaps:['NO_COMPARABLE_BASELINE']}),signal({evidenceId:'metric:other',descriptiveRateDelta:-.1})]},
    decisionCards:[{decisionId:'d1',goalId:'goal-1',title:'旧决策',hasOutcomeReview:false}]
  });
  assert.ok(cards.length<=3);assert.equal(new Set(cards.map(x=>x.id)).size,cards.length);
});
