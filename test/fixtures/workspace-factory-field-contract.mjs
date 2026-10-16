// Pinned official OMP validation plus the real registered tools; no model/network.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { registerFactoryTools } from '../../plugins/workspace-procurement/src/factory.mjs';
import { workspaceOmpPaths } from '../../server/workspace-omp-bridge.mjs';
const {validateToolArguments}=await import(pathToFileURL(workspaceOmpPaths({}).packageRoot+'/../pi-ai/src/utils/validation.ts').href);
const registered=[];let unexpectedServiceReads=0;
registerFactoryTools({registerTool:t=>registered.push(t)},new Proxy({}, {get(){unexpectedServiceReads++;throw Error('NO_SERVICE_EXPECTED');}}),'local-files',{localOnly:true});
const get=name=>registered.find(t=>t.name==='workspace_factory_'+name);
const invoke=async(name,args)=>{const t=get(name),validated=validateToolArguments(t,{type:'toolCall',id:'contract',name:t.name,arguments:args});return (await t.execute('contract',validated,new AbortController().signal)).details;};
let cases=0;
for(const rfq of [{},{product:'cup',quantity:100},{product:null,spec:'',quantity:null,target_market:'',requested_delivery:'  ',requirements:'\t'}, {product:'cup',quantity:0}]){
 const r=await invoke('rfq_requirements',{rfq});assert.equal(r.status,'draft');assert.equal(r.persisted,false);assert.equal(r.submitted,false);
 if(!rfq.product||!rfq.product.trim()){assert.ok(r.pending.includes('product'));assert.equal(r.sources.length,0);}
 if(rfq.quantity===0){assert.ok(!r.pending.includes('quantity'));assert.equal(r.customerRequirements.quantity,0);}
 if(rfq.requested_delivery==='  ')assert.ok(r.pending.includes('requested_delivery'));
 cases++;
}
for(const args of [{rfq:{}},{rfq:{},factoryOffer:{}},{rfq:{product:'cup'},factoryOffer:{product:null,spec:'',production_capacity:'  ',available_quantity:null,lead_time:'',source:''}}, {rfq:{quantity:100},factoryOffer:{product:'cup',available_quantity:0,source:'input-1'}}]){
 const r=await invoke('match_prepare',args);assert.equal(r.status,'draft');assert.equal(r.matchingDecision,'pending-human-review');
 if(!args.factoryOffer||!Object.keys(args.factoryOffer).length)assert.equal(r.pendingFactoryFields.length,7);
 if(args.factoryOffer?.production_capacity==='  '){assert.ok(r.pendingFactoryFields.includes('production_capacity'));assert.ok(!r.sources.some(s=>s.recordId==='input.factoryOffer.production_capacity'));}
 if(args.factoryOffer?.available_quantity===0)assert.ok(!r.pendingFactoryFields.includes('available_quantity'));
 cases++;
}
for(const [index,[name,args]] of [['rfq_requirements',{rfq:null}],['rfq_requirements',{}]].entries()){
 await assert.rejects(invoke(name,args),'invalid fixture '+index);cases++;
}
// Original OMP may repair an invalid optional field. Assert the resulting
// executor contract, rather than assuming the upstream validator never coerces.
const repaired=await invoke('match_prepare',{rfq:{},factoryOffer:{source:{nested:true}}});
assert.equal(repaired.status,'draft');assert.ok(repaired.suppliedFactoryMaterials.source==null||['string','number'].includes(typeof repaired.suppliedFactoryMaterials.source));cases++;
// Executor retains its independent boundary if called without SDK sanitation.
await assert.rejects(get('rfq_requirements').execute('direct',{rfq:{unrecognized:'data'}},new AbortController().signal),/explicitly supplied/);cases++;
await assert.rejects(get('match_prepare').execute('direct',{rfq:{},factoryOffer:{source:{nested:true}}},new AbortController().signal),/explicitly supplied/);
const controller=new AbortController();controller.abort();await assert.rejects(get('rfq_requirements').execute('abort',{rfq:{}},controller.signal));cases++;
assert.equal(unexpectedServiceReads,0);
console.log(JSON.stringify({passed:true,cases,officialOmpValidator:'18.10.4',modelRequests:0,serviceReads:0}));
