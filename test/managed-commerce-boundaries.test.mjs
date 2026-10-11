import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createBusinessLibraryService} from '../server/business-library.mjs';
import {createWorkspaceLibraryAdapter} from '../server/workspace-library.mjs';
import {createCommerceService,normalizeShopifyOrder,summarizeOrders} from '../server/commerce.mjs';
import {createShopifyClient} from '../server/shopify.mjs';
import {createCapabilityService} from '../server/capabilities.mjs';
import {callDotMcpTool,DOT_MCP_TOOLS} from '../server/dot-mcp-server.mjs';

// Existing implementation contracts only. Memory copy-on-write state, synthetic
// connector callbacks and injected Shopify responses; no real Store fsync,
// Shopify request/publication, Muse/model turn or external buyer MCP is exercised.
const provenance=JSON.parse(fs.readFileSync(new URL('../docs/validation/managed-commerce-sources.json',import.meta.url)));
for(const row of provenance.boundaryFiles) {
  const bytes=Buffer.from(fs.readFileSync(new URL('../'+row.path,import.meta.url),'utf8').replace(/\r\n/g,'\n'));
  // The verified Supply V1 extends this one read-only adapter with catalog
  // observation; the other seven reviewed original modules stay byte-identical.
  const expected=row.path==='server/shopify.mjs'?'bb7bb5cacce3a5f48a08c23bcd814d0718788051':row.gitBlob;
  assert.equal(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),expected,
    'Reviewed original source differs: '+row.path);
}
const admin={subject:'fixture-enterprise-operator',role:'admin'},operator={...admin,role:'operator'};
function fixture() {
  const at=new Date().toISOString();
  let state={meta:{sequence:0,createdAt:at,updatedAt:at},artifacts:[],conversations:[],goals:[],runs:[],activity:[],
    workerOrders:[],commerceProjects:[],settings:{model:'fixture'},
    capabilities:{version:1,skills:[],connectors:[],approvals:[],schedules:[],scheduleRuns:[],connectorRuns:[]},
    businessLibrary:{version:1,company:{id:'company',revision:1,legalName:'Fixture enterprise',displayName:'Fixture',
      description:'PRIVATE_COMPANY',createdAt:at,updatedAt:at},products:[],documents:[],operations:[],conversationReferences:[]}};
  let queue=Promise.resolve();
  const store={read:()=>structuredClone(state),update(callback){
    const pending=queue.then(()=>{const next=structuredClone(state),value=callback(next);
      next.meta.sequence++;next.meta.updatedAt=new Date().toISOString();state=next;return structuredClone(value);});
    queue=pending.catch(()=>{});return pending;
  }};
  const artifacts={download(){throw Error('No artifact bytes authorized in this fixture');}};
  const library=createBusinessLibraryService({store,artifacts});
  let externalCalls=0;
  const shopify=createShopifyClient({environment:{},fetchImpl(){externalCalls++;throw Error('No live Shopify call authorized');}});
  const runtime={status:()=>({kind:'fixture',configured:false}),createGoal(){throw Error('No model/Goal invocation authorized');}};
  const commerce=createCommerceService({store,runtime,shopify});
  const product=async extra=>(await library.createProduct({requestId:randomUUID(),name:'Synthetic enterprise product',
    description:'PRIVATE_PRODUCT_DESCRIPTION',...extra},operator)).product;
  const projectInput=p=>({requestId:randomUUID(),confirmed:true,productId:p.id,productRevision:p.revision,
    publicDescription:'Explicit synthetic public facts',market:'US',objective:'Fixture business scope only',
    budget:{amount:'100.00',currency:'USD'},durationDays:30,validationOrderTarget:3});
  return {store,library,commerce,shopify,product,projectInput,externalCalls:()=>externalCalls};
}
const source=()=>({kind:'public_reference',referenceOnly:true,sourceUrl:'https://www.patagonia.com/product/fixture/',
  fetchedAt:'2026-10-11T00:00:00.000Z',batchId:randomUUID(),fieldSources:[
    {fieldPath:'name',sourceUrl:'https://www.patagonia.com/product/fixture/',locator:'Synthetic capture',capturedValue:'Reference product'},
    {fieldPath:'retailPrice',sourceUrl:'https://www.patagonia.com/product/fixture/',locator:'Synthetic retail listing',capturedValue:'199.00 USD retail price'}]});
const sku=()=>({id:randomUUID(),code:'FIXTURE-SKU',specs:[],unit:'piece',moq:null,pricingMode:'unset',
  pricingNote:'',priceTiers:[],leadTimeDays:null});

test('public retail reference cannot become supplier quotation, supply policy or hosted enterprise inventory',async()=>{
  const f=fixture(),p=await f.product({name:'Reference product',description:'Public fixture only',source:source(),skus:[sku()]});
  assert.deepEqual(p.skus[0].priceTiers,[]);assert.equal(p.source.referenceOnly,true);
  const before=f.store.read();
  for(const changes of [{skus:[{...p.skus[0],pricingMode:'tiered',priceTiers:[{minQuantity:1,unitPrice:'199.00',currency:'USD'}]}]},
    {supply:{paymentTerms:'Retail price is a supplier quote'}},{source:null}])
    await assert.rejects(f.library.updateProduct(p.id,{requestId:randomUUID(),expectedRevision:p.revision,changes},operator),{code:'INVALID_INPUT'});
  await assert.rejects(f.commerce.create(f.projectInput(p),operator),{code:'PRODUCT_NOT_AVAILABLE'});
  assert.deepEqual(f.store.read(),before);assert.equal(f.externalCalls(),0);
});

test('SKU record is enterprise-local and rejects unimplemented supplier/Shopify mapping fields',async()=>{
  const f=fixture();
  await assert.rejects(f.product({supplierId:'not-a-shipped-binding'}),{code:'INVALID_INPUT'});
  await assert.rejects(f.product({skus:[{...sku(),shopifyVariantId:'gid://shopify/ProductVariant/1'}]}),{code:'INVALID_INPUT'});
  assert.equal(f.store.read().businessLibrary.products.length,0);
});

test('private enterprise assets stay inaccessible through the existing generic connector, even with a pinned version',async()=>{
  const f=fixture(),privateId=randomUUID(),linkedId=randomUUID();let reads=0;
  await f.store.update(state=>{
    state.artifacts=[{id:privateId,metadata:{businessLibrary:{visibility:'internal'}}},{id:linkedId,metadata:{}}];
    state.businessLibrary.documents=[{versions:[{asset:{artifactId:linkedId,version:1}}]}];
  });
  const adapter=createWorkspaceLibraryAdapter({store:f.store,artifacts:{read(){reads++;throw Error('Private bytes must never be read');}}});
  for(const id of [privateId,linkedId])await assert.rejects(adapter.execute({action:'read_file',resource:'artifact:'+id,
    payload:{version:1},idempotencyKey:'synthetic-approved-read'}),{code:'BUSINESS_LIBRARY_PRIVATE'});
  assert.equal(reads,0);
});

test('existing Worker MCP has no procurement/file-lookup bypass and rejects injected private references before bridge access',async()=>{
  let accesses=0;const bridge=new Proxy({}, {get(){accesses++;throw Error('Unsupported inputs must not reach the bridge');}});
  await assert.rejects(callDotMcpTool(bridge,'workspace_supply_query',{artifactId:randomUUID()}),{code:'MCP_TOOL_NOT_FOUND'});
  await assert.rejects(callDotMcpTool(bridge,'workspace_worker_read_task',{taskRef:'fixture-task',artifactId:randomUUID(),
    businessLibrary:{description:'PRIVATE_PROFILE'}}),{code:'MCP_ARGUMENTS_INVALID'});
  assert.equal(DOT_MCP_TOOLS.length,11);assert.equal(accesses,0);
  // This proves only current closed Worker tool behavior; buyer MCP is missing.
});

test('current product library remains draft-only and Shopify adapter exposes no publication operation',async()=>{
  const f=fixture();
  await assert.rejects(f.library.createProduct({requestId:randomUUID(),name:'Unauthorized'}, {subject:'viewer',role:'viewer'}),{code:'ROLE_REQUIRED'});
  await assert.rejects(f.product({status:'published'}),{code:'INVALID_INPUT'});
  assert.deepEqual(Object.keys(f.shopify).sort(),['fingerprint','readCatalogPage','readProjectOrders','status','verify']);
  assert.equal(f.shopify.status().readOnly,true);assert.equal(f.externalCalls(),0);
});

test('existing connector execution rejects publication-shaped actions without an exact approval',async t=>{
  const f=fixture(),calls=[];
  const service=await createCapabilityService({store:f.store,environment:{},adapters:{'fixture-publisher':{
    capabilities:['publish_product'],execute(input){calls.push(input);return {fixture:true,published:false};}}}});
  t.after(()=>service.close());
  const {connector}=await service.createConnector({name:'Synthetic permission fixture',adapter:'fixture-publisher',capabilities:['publish_product']});
  await service.updateConnector(connector.id,{enabled:true});
  const action={action:'publish_product',resource:'fixture:product',payload:{productRevision:1,shopId:'fixture-shop'}};
  await assert.rejects(service.executeConnector(connector.id,action),{code:'APPROVAL_REQUIRED'});assert.equal(calls.length,0);
  const {approval}=await service.requestApproval(service.connectorApprovalRequest(connector.id,action));
  await assert.rejects(service.executeConnector(connector.id,{...action,approvalId:approval.id}),{code:'APPROVAL_REQUIRED'});
  assert.equal(calls.length,0);
});

test('one exact connector approval cannot authorize another product revision, store, connector revision or repeated execution',async t=>{
  const f=fixture(),calls=[];
  const service=await createCapabilityService({store:f.store,environment:{},adapters:{'fixture-publisher':{
    capabilities:['publish_product'],execute(input){calls.push(input);return {fixture:true,published:false};}}}});
  t.after(()=>service.close());
  const {connector}=await service.createConnector({name:'Synthetic permission fixture',adapter:'fixture-publisher',capabilities:['publish_product']});
  await service.updateConnector(connector.id,{enabled:true});
  const action={action:'publish_product',resource:'fixture:product',payload:{productRevision:1,shopId:'fixture-shop'}};
  const approve=async()=>{const {approval}=await service.requestApproval(service.connectorApprovalRequest(connector.id,action));
    await service.decideApproval(approval.id,{decision:'approved',confirmed:true});return approval.id;};
  const approvalId=await approve();
  for(const payload of [{...action.payload,productRevision:2},{...action.payload,shopId:'another-shop'}])
    await assert.rejects(service.executeConnector(connector.id,{...action,payload,approvalId}),{code:'APPROVAL_MISMATCH'});
  assert.equal(calls.length,0);
  await service.updateConnector(connector.id,{description:'New reviewed connector revision'});
  await assert.rejects(service.executeConnector(connector.id,{...action,approvalId}),{code:'APPROVAL_MISMATCH'});
  const currentApproval=await approve();await service.executeConnector(connector.id,{...action,approvalId:currentApproval});
  await assert.rejects(service.executeConnector(connector.id,{...action,approvalId:currentApproval}),{code:'APPROVAL_USED'});
  assert.equal(calls.length,1);assert.equal(calls[0].payload.productRevision,1);
});

test('hosting pins exact enterprise product revision and explicit public scope without reading private company facts',async()=>{
  const f=fixture(),p=await f.product(),input=f.projectInput(p);
  const made=await f.commerce.create(input,operator);assert.equal(made.project.productRevision,1);
  assert.equal(made.project.publicDescription,input.publicDescription);
  const output=JSON.stringify(made);assert.equal(output.includes('PRIVATE_PRODUCT_DESCRIPTION'),false);assert.equal(output.includes('PRIVATE_COMPANY'),false);
  await f.library.updateProduct(p.id,{requestId:randomUUID(),expectedRevision:1,changes:{description:'Changed PRIVATE_VERSION_TWO'}},operator);
  await assert.rejects(f.commerce.create({...input,requestId:randomUUID()},operator),{code:'REVISION_CONFLICT'});
  assert.equal(f.externalCalls(),0);assert.equal(f.store.read().goals.length,0);
});

test('accepted Worker task or completed Goal is not sales evidence, settlement or billable operating result',async()=>{
  const f=fixture(),p=await f.product(),{project}=await f.commerce.create(f.projectInput(p),operator);
  await f.store.update(state=>{
    state.workerOrders=[{id:'fixture-order',status:'accepted',acceptedAt:new Date().toISOString(),workerId:'fixture-muse',
      workerReport:{deliverables:[{summary:'Synthetic returned task'}],evidence:[{}]}}];
    state.goals=[{id:'fixture-goal',status:'completed'}];
    state.commerceProjects[0].researchOrderId='fixture-order';state.commerceProjects[0].researchGoalId='fixture-goal';
  });
  const current=f.commerce.get(project.id).project;
  assert.equal(current.researchOrder.status,'accepted');assert.equal(current.researchOrder.independentlyVerified,false);
  assert.equal(current.results.paidFulfilledOrders,0);assert.deepEqual(current.results.netReceipts,[]);
  assert.equal(current.results.billableAmount,null);assert.equal(current.results.attribution,'requires_review');
});

test('only recorded non-test paid/fulfilled net receipts count; partial sync and task results never imply attribution or profit',()=>{
  const at='2026-10-11T00:00:00.000Z';
  const row=(id,extra={})=>normalizeShopifyOrder({id:'gid://shopify/Order/'+id,name:'#'+id,createdAt:at,updatedAt:at,
    test:false,cancelledAt:null,displayFinancialStatus:'PAID',displayFulfillmentStatus:'FULFILLED',
    totalReceivedSet:{shopMoney:{amount:'10.00',currencyCode:'USD'}},totalRefundedSet:{shopMoney:{amount:'2.00',currencyCode:'USD'}},...extra},at);
  const result=summarizeOrders({orderEvidence:{complete:false,observedAt:at,orders:[row(1),row(2,{test:true}),
    row(3,{displayFulfillmentStatus:'UNFULFILLED'}),row(4,{cancelledAt:at})]}});
  assert.equal(result.paidFulfilledOrders,1);assert.deepEqual(result.netReceipts,[{currency:'USD',amount:'8'}]);
  assert.equal(result.complete,false);assert.equal(result.billableAmount,null);assert.equal(result.settlement,'terms_and_attribution_required');
});
