// Reproduce the missing native-product-to-model path without granting it.
// Original signed HTTP/Library/Space; finite source responses; no model/Medusa.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {taskFixture} from './fixtures/pi-task-helpers.mjs';
import {createMedusaApprovedSource} from '../plugins/workspace-medusa-catalog/src/approved-source.mjs';
import {createMedusaCatalogService} from '../plugins/workspace-medusa-catalog/src/service.mjs';

test('reviewed native Medusa Space source cannot become a Library model selection',{timeout:30000},async t=>{
  const sourceId=randomUUID(),productId='prod_native_boundary',calls=[];
  const row={context:{product_id:productId,status:'approved',review_version:3,source_hash:'a'.repeat(64),agent_summary:'SYNTHETIC_CONTEXT_NOT_MODEL_AUTHORIZED'},
    product:{id:productId,title:'SYNTHETIC_NATIVE_TITLE',description:'SYNTHETIC_DESCRIPTION_NOT_MODEL_AUTHORIZED'}};
  const f=await taskFixture(t,{enterprise:true,appOptions:{spaceOptions:{enabled:true,medusaSourceFactory:assertCurrent=>createMedusaApprovedSource({
    connection:{reviewed:true,sourceId,workspaceId:'pi-enterprise-test',baseURL:'https://synthetic-medusa.invalid',readToken:'synthetic-not-a-live-read-token'},
    authorizeOriginal:actor=>assertCurrent(actor),
    fetchImpl:async(url,options)=>{
      calls.push({url,method:options.method});assert.equal(options.method,'GET');
      assert.ok(url==='https://synthetic-medusa.invalid/agent/product-contexts?limit=100'||url==='https://synthetic-medusa.invalid/agent/product-contexts/'+productId);
      return Response.json({schema_version:'1.0',review_policy:'medusa-product-context-current-source-v1',
        ...(url.endsWith('?limit=100')?{items:[row],count:1}:row)});
    },
  })}}});
  const call=(route,body)=>f.workspace(route,{subject:'member-a',body});
  const created=await call('/api/library/spaces',{requestId:randomUUID(),name:'Synthetic native product reference'});assert.equal(created.status,201,created.text);
  const base='/api/library/spaces/'+created.json.operation.receipt.spaceId;
  const listed=await call(base+'/sources?kind=medusa-product');assert.equal(listed.status,200,listed.text);
  assert.equal(listed.json.modelAccess,false);assert.equal(listed.json.items[0].reference.id,productId);
  const pin=listed.json.items[0].reference;
  const page=await call(base+'/nodes',{requestId:randomUUID(),kind:'page',parentId:null,title:'Native reference',content:'Synthetic supplied page text',sources:[pin]});assert.equal(page.status,201,page.text);
  const read=await call(base+'/nodes/'+page.json.operation.receipt.entityId);assert.equal(read.status,200,read.text);
  assert.equal(read.json.page.sourceResolution[0].status,'current');assert.deepEqual(read.json.page.selected.sources,[pin]);
  assert.ok(!JSON.stringify([listed.json,read.json]).includes('NOT_MODEL_AUTHORIZED'));
  const conversation=await call('/api/conversations',{requestId:randomUUID(),title:'Synthetic native product conversation',inputContext:{artifacts:[],skills:[],memoryIds:[],connectorActions:[]}});assert.equal(conversation.status,201,conversation.text);
  const target='/api/conversations/'+conversation.json.conversation.id+'/library-references';
  const selected=await call(target,{requestId:randomUUID(),expectedRevision:0,references:{products:[{productId,productRevision:pin.revision}],documents:[]}});
  assert.equal(selected.status,400,selected.text);assert.equal(selected.json.error.code,'INVALID_INPUT');
  assert.deepEqual((await call(target)).json.libraryReferences.products,[]);
  assert.ok(calls.length>0);assert.ok(calls.every(call=>call.method==='GET'));
  assert.equal(f.app.store.read().businessLibrary.products.length,0);assert.equal(f.app.store.read().runs.length,0);assert.equal(f.app.store.read().artifacts.length,0);
});

test('native prod_* preview/reconcile is refused before a Library-only client or authorization callback runs',async()=>{
  let reads=0,authorizations=0;
  const service=createMedusaCatalogService({client:{preview:async()=>{reads++;throw Error('MUST_NOT_READ');},reconcile:async()=>{reads++;throw Error('MUST_NOT_READ');}},authorize:async()=>{authorizations++;}});
  for(const method of ['preview','reconcile']){
    const receipt=await service[method]({productId:'prod_native_boundary'},undefined,{provider:'synthetic',id:'finite'});
    assert.equal(receipt.status,'blocked');assert.deepEqual(receipt.sources,[]);
    assert.equal(receipt.reason,'ORIGINAL_MEDUSA_OPERATION_REFUSED');
  }
  assert.equal(reads,0);assert.equal(authorizations,0);
});
