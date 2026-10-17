import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {contextHistory,mutateHistoricalSource,injectFinalContextRead,MODEL,mapping} from './fixtures/brain-context-final-read.mjs';
for(const mode of ['control','version','revoke','delete'])test('original Store/Host historical context final-read race '+mode,{timeout:30000},async t=>{
 const f=await contextHistory(t),receiptBytes=JSON.stringify(f.old),oracle=injectFinalContextRead(f,()=>mutateHistoricalSource(f,mode));
 try{
  if(mode==='control')assert.equal(await f.contextBinding.brain.revalidateReceipt(f.old,undefined,MODEL),true);
  else await assert.rejects(f.contextBinding.brain.revalidateReceipt(f.old,undefined,MODEL),e=>['BRAIN_SOURCE_CHANGED','BRAIN_SOURCE_NOT_SELECTED'].includes(e.code));
 }finally{oracle.restore();oracle.assertReached();}
 assert.equal(JSON.stringify(f.old),receiptBytes);assert.deepEqual(await fs.readFile(mapping(f).sessionFile),f.originalJournal,'Validator never rewrites original journal/proofs');
 console.log(JSON.stringify({mode,artifactVersions:oracle.versions,originalStore:true,originalHost:true,sourceScopeWithdrawalSynthetic:mode==='revoke',externalCalls:0}));
});

test('original Host continues context succession and decision saves without changing prior proofs',{timeout:45000},async t=>{
 const {send}=await import('./fixtures/brain-context-final-read.mjs');
 const f=await contextHistory(t),first={...f.inputs.first,contextRevision:2,hypotheses:f.inputs.first.hypotheses.map(h=>({...h,supportingEvidence:[],contradictingEvidence:[]})),options:f.inputs.first.options.map(o=>({...o,evidenceIds:[]}))};
 const second={...first,requestId:'decision-after-context-second',expectedRevision:1,problem:'Updated synthetic decision after context succession'};
 for(const input of [first,second,second]){const run=await send(f,[{tool:'workspace_brain_decision_save',arguments:input},{text:'Synthetic decision memory only.'}]);assert.equal(run.status,'succeeded',JSON.stringify(run));}
 const state=f.app.store.read(),context=state.artifacts.filter(a=>a.metadata?.businessBrain?.key==='context'),decision=state.artifacts.filter(a=>a.metadata?.businessBrain?.key==='decision:synthetic-case');
 assert.equal(context.length,1);assert.equal(context[0].currentVersion,2);assert.equal(decision.length,1);assert.equal(decision[0].currentVersion,2);
 const after=await fs.readFile(mapping(f).sessionFile);assert.deepEqual(after.subarray(0,f.originalJournal.length),f.originalJournal);assert.equal(f.remote.calls.length,0);
});
