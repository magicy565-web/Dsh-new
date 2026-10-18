import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
if (process.argv.length !== 3) throw Error('Usage: node test/plugin-service-parity.mjs /path/to/trusted-baseline');
// Only run against an already reviewed baseline checkout: this imports its code.
const roots = [resolve(process.argv[2]), fileURLToPath(new URL('..', import.meta.url))];
const model = { provider:'synthetic',id:'model' };
const inputs = {status:{},preview:{productId:'11111111-1111-4111-8111-111111111111'},reconcile:{productId:'11111111-1111-4111-8111-111111111111'},
structuredMemoryLookup:{subjectType:'company',subjectId:'a',factKey:'moq'},structuredMemoryRemember:{subjectType:'company',subjectId:'a',factKey:'moq',statement:'100'},
memorySearch:{customerId:'a',query:'x'},memoryAdd:{customerId:'a',note:'x',sourceRef:'a',sourceVersion:1,sourceSha256:'a'.repeat(64)},memoryHistory:{customerId:'a',memoryId:'a'},
parseUpload:{artifactId:'a',version:1,sha256:'a'.repeat(64)}};
let compared=0;
for(const [id,factory,methods] of [
['enterprise-context','enterpriseContextExtension',['status','structuredMemoryLookup','structuredMemoryRemember','memorySearch','memoryAdd','memoryHistory','parseUpload']],
['medusa-catalog','medusaCatalogExtension',['status','preview','reconcile']]]) {
 const modules=await Promise.all(roots.map(root=>import(pathToFileURL(`${root}/plugins/workspace-${id}/src/extension.js`).href)));
 for(const scenario of ['unconfigured','success','extra-field','missing-field','missing-model','cancel','revoke','error','known-error']){
  const snapshots=[];
  for(const mod of modules){
   const tools=[],calls=[],controller=new AbortController();let checks=0;
   if(scenario==='cancel')controller.abort();
   const options=scenario==='unconfigured'?{}:{authorize:async()=>{calls.push('auth');if(scenario==='revoke'&&++checks%2===0)throw Error('private');return true;},
    client:Object.fromEntries(methods.map(method=>[method,async input=>{calls.push(method);
     if(scenario==='error')throw Error('private');if(scenario==='known-error')throw Object.assign(Error('private'),{code:id==='medusa-catalog'?'MEDUSA_SOURCE_CHANGED':'OSS_UPLOAD_REVOKED'});
     return {plugin:id==='medusa-catalog'?'workspace-medusa-catalog':'workspace-enterprise-context-oss',status:'available',method,input};}]))};
   mod[factory](options)({registerTool:t=>tools.push(t)});
   const definitions=tools.map(({execute,...definition})=>definition),results=[];
   for(let i=0;i<tools.length;i++){
    const args=scenario==='extra-field'?{...inputs[methods[i]],approved:true}:scenario==='missing-field'?{}:inputs[methods[i]];
    results.push(await tools[i].execute('id',structuredClone(args),controller.signal,null,scenario==='missing-model'?{}:{model}));
   }
   snapshots.push({definitions,results,calls});
  }
  assert.deepEqual(snapshots[1],snapshots[0],`${id}/${scenario}`);compared+=methods.length;
 }
}
console.log(JSON.stringify({toolScenarioComparisons:compared,passed:true,scope:'Exact baseline/new extension outputs, schemas and call order; synthetic clients, no SDK'}));
