import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
const base=process.env.ERP_ADAPTER_PACKAGE_URL;
if(!base)throw Error('Run npm test in plugins/workspace-erpnext-enterprise (packed external acceptance).');
const {createErpNextEnterpriseAdapter,ERP_ENTERPRISE_FIELD_MAP}=await import(new URL('src/adapter.mjs',base));
const {erpNextEnterpriseExtension,default:defaultExtension}=await import(new URL('src/extension.js',base));
const {createFreeTradeSessionBinding}=await import(pathToFileURL(process.env.ERP_ADAPTER_REPO_ROOT+'/server/workspace-free-trade-host.mjs'));
const {ERP_FIELDS}=await import(new URL('../pi-free-trade/src/free-trade.mjs',base));
const model={provider:'synthetic-fixture',id:'fixture-only',baseUrl:'https://synthetic.invalid'};
const identity={sessionId:'session-fixture',subject:'member-fixture',workspaceId:'workspace-fixture',role:'admin'};
const request={doctype:'Quotation',name:'Q-SYNTHETIC-001',fields:['currency','grand_total','modified']};
const credentials={apiKey:'synthetic-key-only',apiSecret:'synthetic-secret-only'};
async function fixture(t,{selection=request,response,authorization=true,configured=true}={}){
  const state={allowed:authorization,live:true,fields:new Set(selection.fields),requests:[],checks:[],record:
    {name:selection.name,currency:'USD',grand_total:0,modified:'2026-10-17 12:00:00',secret_unrequested:'DO NOT PROJECT'}};
  const server=http.createServer((req,res)=>{
    state.requests.push({url:req.url,method:req.method,authorization:req.headers.authorization});
    if(response)return response(req,res,state);
    res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[state.record]}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const binding=await createFreeTradeSessionBinding({access:{mode:'enterprise',nativeSessionById:()=>state.live?identity:null},identity,
    instanceId:'instance-fixture',sessionClient:{readOnlySession:true,bindingIdentity:async()=>({...identity,instanceId:'instance-fixture'})},
    policy:{enabled:true,reviewed:true,subject:identity.subject,workspaceId:identity.workspaceId,
      recipient:{kind:'pi-coding-agent',provider:model.provider,model:model.id,destination:model.baseUrl},
      expiresAt:'2099-01-01T00:00:00Z',origin,records:[selection]},
    connection:{...(configured?{baseUrl:origin,...credentials}:{}),allowLoopbackHttpForTests:true},
    authorizeRecord:async(scope,_signal,receiver)=>{
      state.checks.push(scope);assert.equal(receiver,model);
      return state.allowed&&scope.origin===origin&&scope.doctype===selection.doctype&&scope.name===selection.name&&scope.fields.every(f=>state.fields.has(f));
    }});
  const control=binding.open('native-fixture');
  return {state,origin,control,adapter:createErpNextEnterpriseAdapter({enabled:true,selection,control})};
}
function install(options){
  const tools=new Map(),hooks=new Map(),guards=[];
  const host={history:[],getModel:()=>model,addDisclosureGuard:(fn,id)=>guards.push({fn,id})};
  (options===undefined?defaultExtension:erpNextEnterpriseExtension({...options,host:options.host??host}))({
    registerTool:tool=>tools.set(tool.name,tool),on:(name,fn)=>hooks.set(name,fn)});
  return {tools,hooks,guards,host,call:(name,input={},receiver=model,signal)=>tools.get(name).execute('fixture-call',input,signal,undefined,{model:receiver})};
}
const read='workspace_erpnext_enterprise_read',status='workspace_erpnext_enterprise_status';
test('default install has only status and fixed-selection read; missing connection is unconfigured',async()=>{
  const plugin=install();assert.deepEqual([...plugin.tools.keys()],[status,read]);
  const result=await plugin.call(status);assert.equal(result.details.status,'unconfigured');assert.equal(result.details.enterpriseFactAuthority,'workspace-library');
  assert.equal((await plugin.call(read)).details.reason,'ERP_ADAPTER_DISABLED');
  for(const tool of plugin.tools.values())assert.deepEqual(tool.parameters,{type:'object',properties:{},additionalProperties:false});
});
test('configuration and selection are independent from actual permission',async t=>{
  const f=await fixture(t,{authorization:false});assert.equal(f.adapter.status().status,'configured_unverified');
  await assert.rejects(f.adapter.read({},undefined,model),{code:'FREE_TRADE_RECORD_SCOPE_REVOKED'});assert.equal(f.state.requests.length,0);
  assert.equal(createErpNextEnterpriseAdapter({enabled:true}).status().reason,'ERP_ADAPTER_SELECTION_REQUIRED');
  assert.equal(createErpNextEnterpriseAdapter({enabled:true,selection:request}).status().reason,'ORIGINAL_REVIEWED_HOST_REQUIRED');
});
test('existing Host with absent credentials remains unconfigured and sends no HTTP',async t=>{
  const f=await fixture(t,{configured:false});assert.equal(f.adapter.status().reason,'ERP_REVIEWED_CONNECTION_REQUIRED');
  await assert.rejects(f.adapter.read({},undefined,model),{status:'unconfigured'});assert.equal(f.state.requests.length,0);
});
test('exact host-selected fields produce scalar facts, ERP citations and original proof',async t=>{
  const f=await fixture(t),selection=structuredClone(request),adapter=createErpNextEnterpriseAdapter({enabled:true,selection,control:f.control});
  selection.fields.push('party_name');selection.name='ATTACKER-CHANGED';
  const result=await adapter.read({},undefined,model);assert.equal(result.libraryMigration,'not_migrated');assert.equal(result.enterpriseFactAuthority,'workspace-library');
  assert.equal(result.source.system,'erpnext');assert.equal(result.source.origin,f.origin);assert.equal(result.source.name,request.name);
  assert.equal(result.source.modified,'2026-10-17 12:00:00');assert.equal(result.source.revisionEvidence,'authorized_modified_field');
  assert.match(result.source.projectionSha256,/^[a-f0-9]{64}$/);assert.ok(Number.isFinite(Date.parse(result.source.retrievedAt)));
  assert.deepEqual(result.facts.map(f=>[f.key,f.value]),[['erpnext.quotation.currency','USD'],['erpnext.quotation.grand_total',0],['erpnext.quotation.modified','2026-10-17 12:00:00']]);
  assert.ok(result.facts.every(f=>f.sourceRef.id===result.source.id));assert.equal(result.persisted,false);assert.equal(result.externalWrites,false);
  assert.ok(Object.isFrozen(result.facts[0]));assert.ok(Object.isFrozen(result.authorization));
  const sent=f.state.requests[0],url=new URL(sent.url,f.origin);assert.equal(sent.method,'GET');
  assert.deepEqual(JSON.parse(url.searchParams.get('fields')),['name',...request.fields]);
  assert.deepEqual(JSON.parse(url.searchParams.get('filters')),[[request.doctype,'name','=',request.name]]);
  assert.equal(url.searchParams.get('limit_page_length'),'1');assert.equal(url.searchParams.get('limit_start'),'0');
  assert.ok(!JSON.stringify(result).includes('DO NOT PROJECT'));assert.ok(!JSON.stringify(result).includes(credentials.apiKey));
  assert.equal(await adapter.revalidateReceipt(structuredClone(result),undefined,model),true);assert.equal(f.state.requests.length,2);
});
test('every existing allowlisted DocType and field maps exactly; null/false/zero preserved',async t=>{
  assert.deepEqual(Object.keys(ERP_ENTERPRISE_FIELD_MAP),Object.keys(ERP_FIELDS));
  for(const [doctype,fields]of Object.entries(ERP_FIELDS)){
    const selection={doctype,name:'EXACT-SYNTHETIC',fields:[...fields]},f=await fixture(t,{selection});
    f.state.record=Object.fromEntries(fields.map((field,i)=>[field,field==='name'?selection.name:i%3===0?null:i%3===1?false:0]));
    const result=await f.adapter.read({},undefined,model);
    assert.deepEqual(result.facts.map(x=>x.value),fields.map(fld=>f.state.record[fld]));
    assert.deepEqual(result.facts.map(x=>x.sourceRef.field),fields);
    assert.equal(new Set(result.facts.map(x=>x.key)).size,fields.length);
  }
});
test('unauthorized modified/name are never added to facts or claimed as a document revision',async t=>{
  const selection={...request,fields:['currency']},f=await fixture(t,{selection}),receipt=await f.adapter.read({},undefined,model);
  assert.equal(receipt.source.modified,null);assert.equal(receipt.source.revisionEvidence,'no_revision_field_authorized');
  assert.deepEqual(receipt.facts.map(x=>x.sourceRef.field),['currency']);
});
test('record/field/wildcard/origin/write inputs cannot expand an empty tool request',async t=>{
  const f=await fixture(t);
  for(const raw of [null,[],{name:'other'},{doctype:'Customer'},{fields:['*']},{baseUrl:'https://other.invalid'},{write:true},{approved:true},{selection:request}])
    await assert.rejects(f.adapter.read(raw,undefined,model),{code:'ERP_ADAPTER_INPUT_REFUSED'});
  assert.equal(f.state.requests.length,0);
  for(const selection of [{...request,doctype:'Customer'},{...request,fields:['*']},{...request,fields:['items']},{...request,name:'../all'}, {...request,limit:100}])
    assert.throws(()=>createErpNextEnterpriseAdapter({enabled:true,selection,control:f.control}));
});
test('field revocation, member revocation and receiver changes refuse before I/O',async t=>{
  for(const kind of ['field','member','receiver']){
    const f=await fixture(t);if(kind==='field')f.state.fields.delete('currency');if(kind==='member')f.state.live=false;
    await assert.rejects(f.adapter.read({},undefined,kind==='receiver'?{...model,id:'other-model'}:model));assert.equal(f.state.requests.length,0);
  }
});
test('revocation during real loopback response withholds all facts',async t=>{
  const f=await fixture(t,{response:(_req,res,state)=>{state.allowed=false;res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[state.record]}));}});
  const plugin=install({adapter:f.adapter}),result=await plugin.call(read);
  assert.equal(result.isError,true);assert.ok(!result.details.facts);assert.ok(!JSON.stringify(result).includes('USD'));assert.equal(f.state.requests.length,1);
});
test('cached receipt refresh uses original proof and refuses revoked or changed source',async t=>{
  for(const kind of ['revoked','changed','tampered']){
    const f=await fixture(t),receipt=await f.adapter.read({},undefined,model);
    if(kind==='revoked')f.state.allowed=false;if(kind==='changed')f.state.record.currency='EUR';
    const candidate=structuredClone(receipt);if(kind==='tampered')candidate.facts[0].value='FAKE';
    await assert.rejects(f.adapter.revalidateReceipt(candidate,undefined,model));
    assert.equal(f.state.requests.length,kind==='changed'?2:1);
  }
});
test('a new adapter rejects old private receipts instead of restoring authority',async t=>{
  const f=await fixture(t),receipt=await f.adapter.read({},undefined,model);
  const next=createErpNextEnterpriseAdapter({enabled:true,selection:request,control:f.control});
  await assert.rejects(next.revalidateReceipt(receipt,undefined,model),{code:'ERP_ADAPTER_RECEIPT_UNKNOWN'});
});
test('configured model tools require the original disclosure gate',async t=>{
  const f=await fixture(t),plugin=install({adapter:f.adapter,host:{}});
  assert.equal((await plugin.call(status)).details.reason,'ORIGINAL_DISCLOSURE_GUARD_REQUIRED');
  assert.equal((await plugin.call(read)).details.reason,'ORIGINAL_DISCLOSURE_GUARD_REQUIRED');assert.equal(f.state.requests.length,0);
});
test('gate refreshes before model disclosure and rejects cached content after revoke',async t=>{
  const f=await fixture(t),plugin=install({adapter:f.adapter});assert.equal(plugin.guards.length,1);
  const result=await plugin.call(read);assert.equal(result.isError,undefined);
  const message={role:'toolResult',toolName:read,details:result.details,content:result.content};
  await plugin.hooks.get('context')({messages:[message]});await plugin.guards[0].fn({phase:'model:prepare'});
  f.state.allowed=false;await assert.rejects(plugin.guards[0].fn({phase:'model:disclose'}));
  await assert.rejects(plugin.hooks.get('context')({messages:[message]}));
});
test('default loading/reloading refuses private history; tampered bodies cannot pass a configured context',async t=>{
  const f=await fixture(t),plugin=install({adapter:f.adapter}),result=await plugin.call(read);
  const message={role:'toolResult',toolName:read,details:result.details,content:result.content};
  await assert.rejects(install().hooks.get('context')({messages:[message]}),{code:'ERP_ADAPTER_PRIVATE_HISTORY_REFUSED'});
  assert.throws(()=>install({adapter:f.adapter,host:{history:[message]}}),{code:'ERP_ADAPTER_PRIVATE_RESTORE_UNSUPPORTED'});
  await assert.rejects(plugin.hooks.get('context')({messages:[{...message,content:[{type:'text',text:'tampered'}]}]}),{code:'ERP_ADAPTER_PRIVATE_HISTORY_REFUSED'});
});
test('error history must be a safe exact failure receipt; private data cannot hide behind isError',async()=>{
  const plugin=install(),result=await plugin.call(read);
  const message={role:'toolResult',toolName:read,isError:true,details:result.details,content:result.content};
  await plugin.hooks.get('context')({messages:[message]});
  const details={...result.details,facts:[{value:'PRIVATE'}]};
  await assert.rejects(plugin.hooks.get('context')({messages:[{...message,details,content:[{type:'text',text:JSON.stringify(details)}]}]}),
    {code:'ERP_ADAPTER_PRIVATE_HISTORY_REFUSED'});
});
test('foreign upstream source URL or widened projection cannot become a citation',async t=>{
  const f=await fixture(t),raw=await f.control.erp.read(request,undefined,model);
  for(const changed of [{...raw,sourceUrl:raw.sourceUrl+'&scan=all'},
    {...raw,fields:[...request.fields,'party_name']}, {...raw,sourceUrl:'https://other.invalid/private'},
    {...raw,record:{...raw.record,party_name:'PRIVATE'}}]){
    const adapter=createErpNextEnterpriseAdapter({enabled:true,selection:request,control:{...f.control,erp:{status:()=> 'configured_unverified',read:async()=>changed}}});
    await assert.rejects(adapter.read({},undefined,model),{code:'ERP_ADAPTER_SOURCE_INVALID'});
  }
});
test('wrong tool receiver and cancelled operations send no HTTP',async t=>{
  const f=await fixture(t),plugin=install({adapter:f.adapter});
  assert.equal((await plugin.call(read,{}, {...model})).details.reason,'EXACT_MODEL_RECEIVER_REQUIRED');
  const abort=new AbortController();abort.abort();assert.equal((await plugin.call(read,{},model,abort.signal)).details.reason,'OPERATION_CANCELLED');
  assert.equal(f.state.requests.length,0);
});
for(const [name,statusCode,body,code]of [
  ['remote deny',403,'synthetic-key-only RAW PRIVATE BODY','REMOTE_AUTHORIZATION_REFUSED'],
  ['rate limit',429,'RAW PRIVATE BODY','RATE_LIMITED'],['server failure',500,'RAW PRIVATE BODY','REMOTE_HTTP_ERROR'],
  ['redirect',302,'RAW PRIVATE BODY','REDIRECT_REFUSED'],['malformed JSON',200,'{invalid','REMOTE_NOT_JSON'],
  ['wrong record',200,JSON.stringify({data:[{name:'WRONG',currency:'USD'}]}),'ERP_RECORD_MISMATCH'],
  ['multiple records',200,JSON.stringify({data:[{name:request.name},{name:request.name}]}),'ERP_RECORD_MISMATCH'],
  ['nested fields',200,JSON.stringify({data:[{name:request.name,currency:{private:'nested'}}]}),'ERP_FIELD_SHAPE_INVALID'],
  ['secret echo',200,JSON.stringify({data:[{name:request.name,currency:credentials.apiSecret}]}),'SECRET_ECHO_REFUSED']])test(`error response: ${name} is safe and not retried`,async t=>{
    const f=await fixture(t,{response:(_req,res)=>{res.statusCode=statusCode;res.setHeader('content-type','application/json');res.end(body);}});
    const result=await install({adapter:f.adapter}).call(read);assert.equal(result.isError,true);assert.equal(result.details.reason,code);
    assert.deepEqual(Object.keys(result.details).sort(),['externalWrites','plugin','reason','status']);
    assert.ok(!JSON.stringify(result).includes('RAW PRIVATE'));assert.ok(!JSON.stringify(result).includes(credentials.apiSecret));assert.equal(f.state.requests.length,1);
  });
