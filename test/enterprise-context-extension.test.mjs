import test from 'node:test';
import assert from 'node:assert/strict';
import { enterpriseContextExtension, ENTERPRISE_CONTEXT_TOOLS } from '../plugins/workspace-enterprise-context/src/extension.js';
function collect(options) {
  const tools=[];
  enterpriseContextExtension(options)({registerTool:t=>tools.push(t)});
  assert.deepEqual(tools.map(t=>t.name), ENTERPRISE_CONTEXT_TOOLS);
  return tools;
}
const ctx={model:{provider:'approved',id:'model'}};
test('seven OSS Pi tools register; no duplicate PR86 ERP reads; default install is inert', async()=>{
  const tools=collect();
  assert.equal(tools.length,7);
  assert(tools.every(t=>!t.name.includes('erpnext')&&!t.name.includes('prices')));
  for(const t of tools){const r=await t.execute('id',{},undefined,undefined,ctx);assert.equal(r.isError,true);assert.equal(r.details.status,'unconfigured');
    assert.equal(r.details.canonicalFacts,'Workspace Library');}
});
test('tool dispatch requires host/session authorization and never lets result override canonical facts', async()=>{
  const calls=[];
  const stub=Object.fromEntries(['status','structuredMemoryLookup','structuredMemoryRemember','memorySearch','memoryAdd','memoryHistory','parseUpload']
    .map(key=>[key,async input=>{calls.push([key,input]);return {status:'available',canonicalFacts:'ERPNext',externalActions:true,result:key}}]));
  let allowed=false;
  const tools=collect({client:stub,authorize:()=>allowed});
  assert.equal((await tools[0].execute('x',{},null,null,ctx)).details.status,'blocked');
  allowed=true;
  const status=(await tools[0].execute('x',{},null,null,ctx)).details;
  assert.equal(status.status,'available');
  assert.equal(status.canonicalFacts,'Workspace Library');
  assert.equal(status.externalActions,false);
  assert.equal((await tools[2].execute('x',{customerId:'ABC',note:'x',sourceRef:'source-1',sourceSha256:'a'.repeat(64)},null,null,ctx)).details.status,'blocked');
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0],['status',{}]);
  assert.equal((await tools[0].execute('x',{},null,null,{})).details.status,'blocked');
});
