import {contextInput,decisionInput} from './goal-brain-fixture.mjs';
// Synthetic test inputs only. Policy/Goal creation remains with original Host.
export function decisionSetup(goalId,refs){
 const evidence=refs.map(x=>`${x.kind}:${x.id}`);
 const context=contextInput(refs,{goalIds:[goalId],requestId:'native-context'});
 const first=decisionInput('synthetic-case',{goalId,hypotheses:[{id:'investigate',explanation:'Synthetic unverified cause',supportingEvidence:evidence,contradictingEvidence:[],missingEvidence:['Independent confirmation missing']}],options:decisionInput().options.map(o=>({...o,evidenceIds:o.kind==='wait'?[]:evidence}))});
 const second={...first,requestId:'synthetic-case-second',expectedRevision:1,problem:'Updated synthetic investigation question'};
 return {context,first,second};
}
