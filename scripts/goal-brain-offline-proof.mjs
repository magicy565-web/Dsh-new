#!/usr/bin/env node
/** Reproducible synthetic functional proof; NOT a real-model demonstration. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFixture, prepared, decisionInput, contextInput, model } from '../test/fixtures/goal-brain-fixture.mjs';
const dir = await mkdtemp(join(tmpdir(),'enterprise-brain-proof-'));
const file = join(dir,'synthetic-artifacts.sqlite');
let f;
try {
  f=openFixture(file);
  const a=await prepared(f,'factory-A'), b=await prepared(f,'factory-B');
  const first=await a.brain.decisionSave(decisionInput('inquiry-blocker'),undefined,model);
  const aId=first.recordRef.artifactId;
  const before=await a.brain.brief({},undefined,model);
  f.close(); f=null;
  f=openFixture(file);
  for (const id of ['factory-A','factory-B']) {
    f.addSource(id,'product','cloth',{name:`${id} product`,moqMeters:1000}); f.addGoal(id);
  }
  const reopened=f.makeBrain('factory-A').brain;
  const restored=await reopened.decisionRead({id:'inquiry-blocker'},undefined,model);
  let crossEnterprise;
  try { await f.makeBrain('factory-B').brain.decisionRead({id:'inquiry-blocker'},undefined,model);crossEnterprise='ERROR: leaked'; }
  catch(e) { crossEnterprise=e.code; }
  const ctx=await reopened.contextRead({},undefined,model);
  await reopened.contextSave(contextInput(ctx.data.context.payload.sourceRefs,{expectedRevision:1,requestId:'owner-next-context',unknowns:['Owner wants small-order cost evidence first; this is a draft note, not authorization.']}),undefined,model);
  console.log(JSON.stringify({
    evidenceType:'synthetic-business-data / SQLite-test-artifact-facade / no-model',
    realModelCalls:0, externalServiceCalls:0, newModelSpend:0,
    independentEnterprises:2, sharedProductId:'cloth',
    initialRecommendation:before.data.cards[0].title,
    restoredSameArtifact:restored.recordRef.artifactId===aId,
    foreignDecisionRead:crossEnterprise,
    savedContextRevision:(await reopened.contextRead({},undefined,model)).recordRef.recordRevision,
    staleDecisionCardsAfterContextUpdate:(await reopened.brief({},undefined,model)).data.cards.length,
    allCommercialActionsDisabled:!restored.executable && !restored.businessGoalVerified,
    sourceOfTruth:'Original Artifact adapter in product code; test-only facade used by this proof.',
  },null,2));
} finally { f?.close(); await rm(dir,{recursive:true,force:true}); }
