// All provider records/identities/credentials below are synthetic. No external network/model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { TradeError, requestJson, createTenderClient, createErpNextClient, prepareQuotation, validateTenderInput,
  validateErpRead, TED_FIELDS } from '../plugins/workspace-free-trade/src/free-trade.mjs';
import extension, { freeTradeExtension } from '../plugins/workspace-free-trade/src/extension.js';
const JSON_RESPONSE = x => new Response(JSON.stringify(x), { headers: { 'content-type': 'application/json' } });
const fixedNow = () => new Date('2026-10-16T00:00:00Z');
const tedRow = { 'publication-number': '123456-2026', 'notice-title': {eng:'Fixture textile demand'}, 'buyer-name': ['Fixture Buyer'],
  'publication-date':'2026-10-15', 'notice-type':'cn-standard', 'deadline-receipt-tender-date-lot':['2026-11-01'], 'deadline-receipt-tender-time-lot':['12:00'], 'classification-cpv':['19000000'] };
const samRow = { noticeId:'fixture123', title:'Fixture textile demand', type:'Award Notice', active:'Yes', responseDeadLine:null, typeOfSetAside:'SBA', links:[{href:'https://secret.example/?api_key=do-not-echo'}] };
const quotation = () => ({ company:'Fixture Factory', customer:'Fixture Buyer', currency:'USD', transactionDate:'2026-10-16', validTill:'2026-10-30', items:[{itemCode:'FAB-1',qty:500,rate:2.3,uom:'Meter'}] });
const erpRead = () => ({ doctype:'Quotation', name:'Q-FIX-001', fields:['name','currency','grand_total','modified'] });
const credentials = { apiKey:'fixture-key-only', apiSecret:'fixture-secret-only' };
const receiver = { provider:'fixture', id:'fixture-model-not-live' };
const register = options => { const tools = new Map(); freeTradeExtension(options)({registerTool:x=>tools.set(x.name,x)}); return tools; };
const execute = (tools,name,args,ctx={model:receiver},signal) => tools.get(name).execute('fixture-tool-call',args,signal,undefined,ctx);
const errorCode = code => error => error instanceof TradeError && error.code === code;
async function wire(t, handler) {
  const server = createServer(async (req,res) => {
    try { let body=''; for await(const part of req) body+=part; await handler(req,res,body); }
    catch { res.writeHead(500); res.end(); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  return `http://127.0.0.1:${server.address().port}`;
}
test('manifest: isolated installable package, no dependencies or install hooks',async()=>{
  const p=JSON.parse(await readFile(new URL('../plugins/workspace-free-trade/package.json',import.meta.url)));
  assert.equal(p.private,true); assert.equal(p.engines.node,'>=24'); assert.equal(p.dependencies,undefined); assert.equal(p.scripts,undefined);
  assert.deepEqual(p.pi.extensions,['./src/extension.js']); assert.deepEqual(p.pi.skills,['./skills/free-trade']);
});
test('ordinary extension registers four unique business tools without starting network',()=>{
  const tools=[]; extension({registerTool:t=>tools.push(t)});
  assert.equal(tools.length,4); assert.equal(new Set(tools.map(t=>t.name)).size,4);
  for(const t of tools) { assert.equal(t.parameters.type,'object'); assert.equal(t.parameters.additionalProperties,false); }
});
test('status is configured_unverified, never a live-connection claim',async()=>{
  const result=await execute(register(),'workspace_free_trade_status',{});
  assert.equal(result.details.tenderSources.ted,'configured_unverified'); assert.equal(result.details.tenderSources.sam,'unconfigured'); assert.equal(result.details.erpnext,'unconfigured');
});
for(const input of [null,{}, {provider:'other'}, {provider:'ted',query:''}, {provider:'ted',query:' x'}, {provider:'ted',query:'x\n'},
  {provider:'ted',query:'x',page:0},{provider:'ted',query:'x',limit:11},{provider:'ted',query:'x',limit:1.5},
  {provider:'ted',query:'x',api_key:'fake'},{provider:'ted',query:'x',baseUrl:'https://other.example'}, {provider:'ted',query:'x',postedFrom:'2026-01-01'},
  {provider:'sam',postedFrom:'2026-02-30',postedTo:'2026-03-01'}, {provider:'sam',postedFrom:'2025-01-01',postedTo:'2026-10-16'},
  {provider:'sam',postedFrom:'2026-10-17',postedTo:'2026-10-16'}, {provider:'sam',postedFrom:'2026-10-01',postedTo:'2026-10-16',noticeType:'z'}]) {
  test(`reject tender input ${JSON.stringify(input)}`,()=>assert.throws(()=>validateTenderInput(input),TradeError));
}
test('TED uses official POST and bounded field set over real loopback HTTP',async t=>{
  let seen;
  const local=await wire(t,(req,res,body)=>{seen={method:req.method,path:req.url,headers:req.headers,body:JSON.parse(body)};res.setHeader('content-type','application/json');res.end(JSON.stringify({notices:[tedRow],totalNoticeCount:50}));});
  const client=createTenderClient({now:fixedNow,fetchImpl:(url,opts)=>{assert.equal(new URL(url).origin,'https://api.ted.europa.eu'); return fetch(local+new URL(url).pathname,opts);}});
  const result=await client.search({provider:'ted',query:'PD>=20261001',page:2,limit:5});
  assert.equal(seen.method,'POST');assert.equal(seen.path,'/v3/notices/search');assert.equal(seen.headers.authorization,undefined);
  assert.deepEqual(seen.body.fields,[...TED_FIELDS]);assert.equal(seen.body.page,2);assert.equal(seen.body.paginationMode,'PAGE_NUMBER');
  assert.deepEqual(result.items[0].deadline.dateRaw,['2026-11-01']);assert.equal(result.items[0].deadline.interpretation,'unverified');
  assert.equal(result.items[0].openForBids,null);assert.equal(result.items[0].eligibility,'not_assessed');assert.equal(result.items[0].retrievedAt,fixedNow().toISOString());
  assert.equal(result.pagination.mayHaveMore,true);assert.equal(result.pagination.completeDataset,false);
});
test('SAM missing key fails without HTTP',async()=>{
  const client=createTenderClient({fetchImpl:()=>assert.fail('network must not run')});
  await assert.rejects(client.search({provider:'sam',postedFrom:'2026-10-01',postedTo:'2026-10-16'}),errorCode('SAM_API_KEY_REQUIRED'));
});
test('SAM date conversion, zero-based page, source link allowlist and no key leakage',async t=>{
  const key='synthetic-sam-api-key-only';let seen;
  const local=await wire(t,(req,res)=>{seen=new URL(req.url,'http://fixture');res.setHeader('content-type','application/json');res.end(JSON.stringify({opportunitiesData:[samRow],offset:1,limit:2,totalRecords:9}));});
  const client=createTenderClient({samApiKey:key,now:fixedNow,fetchImpl:(url,opts)=>{const u=new URL(url);assert.equal(u.origin,'https://api.sam.gov');return fetch(local+u.pathname+u.search,opts);}});
  const result=await client.search({provider:'sam',postedFrom:'2026-10-01',postedTo:'2026-10-16',pageIndex:1,limit:2,naicsCode:'313',noticeType:'a'});
  assert.equal(seen.searchParams.get('postedFrom'),'10/01/2026');assert.equal(seen.searchParams.get('offset'),'1');assert.equal(seen.searchParams.get('ncode'),'313');assert.equal(seen.searchParams.get('api_key'),key);
  assert.equal(result.items[0].noticeType,'Award Notice');assert.equal(result.items[0].openForBids,null);assert.equal(result.items[0].setAsideRaw,'SBA');
  assert.equal(result.items[0].sourceUrl,'https://sam.gov/opp/fixture123/view');assert.equal(JSON.stringify(result).includes(key),false);assert.equal(JSON.stringify(result).includes('secret.example'),false);
});
test('SAM field typo compatibility preserves missing timezone without interpretation',async()=>{
  const client=createTenderClient({samApiKey:'fixture-key-only',fetchImpl:async()=>JSON_RESPONSE({offset:0,limit:5,totalRecords:1,opportunitiesData:[{...samRow,responseDeadLine:undefined,reponseDeadLine:'2026-11-01 12:00'}]})});
  const result=await client.search({provider:'sam',postedFrom:'2026-10-01',postedTo:'2026-10-16'});
  assert.equal(result.items[0].deadline.dateRaw,'2026-11-01 12:00');assert.equal(result.items[0].openForBids,null);
});
for(const [label,data,code] of [
  ['missing rows',{},'REMOTE_SCHEMA_INVALID'],['invalid id',{notices:[{'publication-number':'../secrets'}]},'NOTICE_ID_INVALID'],
  ['over limit',{notices:[tedRow,tedRow]},'REMOTE_SCHEMA_INVALID']]) test(`TED fails closed: ${label}`,async()=>{
    await assert.rejects(createTenderClient({fetchImpl:async()=>JSON_RESPONSE(data)}).search({provider:'ted',query:'PD>=20261001',limit:1}),errorCode(code));
});
test('unknown total stays null, missing title stays null, duplicates not silently merged',async()=>{
  const client=createTenderClient({fetchImpl:async()=>JSON_RESPONSE({notices:[{'publication-number':'123456-2026'},{'publication-number':'123456-2026'}]})});
  const result=await client.search({provider:'ted',query:'PD>=20261001'});
  assert.equal(result.total,null);assert.equal(result.pagination.mayHaveMore,null);assert.equal(result.items[0].title,null);assert.equal(result.items.length,2);assert.ok(result.warnings.includes('DUPLICATE_PUBLICATION_IDS_RETAINED'));
});
test('SAM refuses incorrect pagination echo',async()=>{
  await assert.rejects(createTenderClient({samApiKey:'fixture-key-only',fetchImpl:async()=>JSON_RESPONSE({offset:1,limit:5,opportunitiesData:[]})}).search({provider:'sam',postedFrom:'2026-10-01',postedTo:'2026-10-16'}),errorCode('PAGINATION_MISMATCH'));
});
test('secret echo in successful response is refused',async()=>{
  await assert.rejects(createTenderClient({samApiKey:'fixture-key-only',fetchImpl:async()=>JSON_RESPONSE({offset:0,limit:5,opportunitiesData:[{...samRow,title:'fixture-key-only'}]})}).search({provider:'sam',postedFrom:'2026-10-01',postedTo:'2026-10-16'}),errorCode('SECRET_ECHO_REFUSED'));
});
for(const [status,code] of [[302,'REDIRECT_REFUSED'],[401,'REMOTE_AUTHORIZATION_REFUSED'],[403,'REMOTE_AUTHORIZATION_REFUSED'],[429,'RATE_LIMITED'],[500,'REMOTE_HTTP_ERROR']]) test(`HTTP ${status} no retry/no response-body leak`,async()=>{
  let calls=0;
  await assert.rejects(requestJson('https://fixture.invalid',{fetchImpl:async()=>{calls++;return new Response('secret-body-do-not-echo',{status,headers:{'retry-after':'60','location':'https://attacker.invalid'}});}}),error=>{assert.equal(error.code,code);assert.equal(error.message.includes('secret'),false);if(status===429)assert.equal(error.retryAfterSeconds,60);return true;});assert.equal(calls,1);
});
test('HTTP rejects non-json, malformed JSON and oversized decoded body',async()=>{
  await assert.rejects(requestJson('https://fixture.invalid',{fetchImpl:async()=>new Response('<html>') }),errorCode('REMOTE_NOT_JSON'));
  await assert.rejects(requestJson('https://fixture.invalid',{fetchImpl:async()=>new Response('{',{headers:{'content-type':'application/json'}}) }),errorCode('REMOTE_NOT_JSON'));
  await assert.rejects(requestJson('https://fixture.invalid',{maxBytes:10,fetchImpl:async()=>JSON_RESPONSE({large:'x'.repeat(50)})}),errorCode('RESPONSE_TOO_LARGE'));
});
test('real HTTP timeout and abort produce no success receipt',async t=>{
  const local=await wire(t,(_req,_res)=>{});
  await assert.rejects(requestJson(local,{timeoutMs:30}),errorCode('REQUEST_TIMEOUT'));
  const controller=new AbortController();controller.abort('private-abort-reason');
  await assert.rejects(requestJson(local,{signal:controller.signal}),errorCode('OPERATION_CANCELLED'));
});
for(const url of ['http://erp.example','https://user:pass@erp.example','https://erp.example/path','https://erp.example/?key=x','ftp://erp.example','http://127.0.0.1:8888']) test(`ERP rejects unsafe origin ${url}`,()=>assert.throws(()=>createErpNextClient({baseUrl:url}),errorCode('ERP_ORIGIN_INVALID')));
for(const input of [{...erpRead(),doctype:'User'},{...erpRead(),fields:['*']},{...erpRead(),fields:['api_secret']},{...erpRead(),fields:['name','name']},{...erpRead(),name:'../secret'},{...erpRead(),name:'%2fsecret'},{...erpRead(),approved:true}]) test(`ERP refuses expanded scope ${JSON.stringify(input)}`,()=>assert.throws(()=>validateErpRead(input),TradeError));
test('ERP default cannot read even when given a guessed record ID',async()=>{
  await assert.rejects(createErpNextClient({fetchImpl:()=>assert.fail('no HTTP')}).read(erpRead(),undefined,receiver),errorCode('ERP_REVIEWED_CONNECTION_REQUIRED'));
});
test('ERP exact read over real HTTP, two authorization checks, field minimization and zero preserved',async t=>{
  let seen;let checks=0;
  const local=await wire(t,(req,res)=>{seen={url:req.url,method:req.method,auth:req.headers.authorization};res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{doctype:'Quotation',name:'Q-FIX-001',currency:'USD',grand_total:0,modified:'2026-10-16 10:00:00',owner:'hidden-person',api_secret:'NEVER-EXPOSE'}]}));});
  const client=createErpNextClient({baseUrl:local,allowLoopbackHttpForTests:true,...credentials,authorizeRecord:async(scope,_signal,model)=>{checks++;assert.equal(scope.name,'Q-FIX-001');assert.equal(model,receiver);assert.ok(Object.isFrozen(scope.fields));return true;}});
  const result=await client.read(erpRead(),undefined,receiver);
  assert.equal(checks,2);assert.equal(seen.method,'GET');const readUrl=new URL(seen.url,local);assert.equal(readUrl.pathname,'/api/resource/Quotation');assert.deepEqual(JSON.parse(readUrl.searchParams.get('fields')),erpRead().fields);assert.deepEqual(JSON.parse(readUrl.searchParams.get('filters')),[['Quotation','name','=','Q-FIX-001']]);assert.equal(readUrl.searchParams.get('limit_page_length'),'1');assert.equal(seen.auth,`token ${credentials.apiKey}:${credentials.apiSecret}`);
  assert.equal(result.record.grand_total,0);assert.equal(result.record.owner,undefined);assert.equal(JSON.stringify(result).includes('NEVER-EXPOSE'),false);assert.equal(result.externalWrites,false);
});
test('ERP denied scope stops before any network operation',async()=>{
  const client=createErpNextClient({baseUrl:'https://erp.example',...credentials,authorizeRecord:async()=>false,fetchImpl:()=>assert.fail('no HTTP')});
  await assert.rejects(client.read(erpRead(),undefined,receiver),errorCode('ORIGINAL_AUTHORIZATION_REFUSED'));
});
test('ERP permission revocation after response withholds private data',async()=>{
  let checks=0;
  const client=createErpNextClient({baseUrl:'https://erp.example',...credentials,authorizeRecord:async()=>++checks===1,fetchImpl:async()=>JSON_RESPONSE({data:[{name:'Q-FIX-001',currency:'USD'}]})});
  await assert.rejects(client.read(erpRead(),undefined,receiver),errorCode('ORIGINAL_AUTHORIZATION_REFUSED'));assert.equal(checks,2);
});
for(const [data,code] of [[{name:'WRONG'},'ERP_RECORD_MISMATCH'],[{name:'Q-FIX-001',doctype:'User'},'ERP_RECORD_MISMATCH'],[{name:'Q-FIX-001',currency:{password:'hidden'}},'ERP_FIELD_SHAPE_INVALID']]) test(`ERP refuses invalid record shape ${code}`,async()=>{
  const client=createErpNextClient({baseUrl:'https://erp.example',...credentials,authorizeRecord:async()=>true,fetchImpl:async()=>JSON_RESPONSE({data:[data]})});
  await assert.rejects(client.read(erpRead(),undefined,receiver),errorCode(code));
});
test('quote is supplied terms only: draft, no calculated totals or persistence',()=>{
  const result=prepareQuotation(quotation());assert.equal(result.document.docstatus,0);assert.equal(result.document.party_name,'Fixture Buyer');assert.equal(result.document.items[0].rate,2.3);
  assert.equal(result.humanReviewed,false);assert.equal(result.persisted,false);assert.equal(result.externalWrites,false);assert.equal(result.pricingRulesApplied,false);assert.equal(result.document.grand_total,undefined);
});
for(const mutate of [q=>{q.items[0].rate=-1},q=>{delete q.items[0].rate},q=>{q.items[0].qty=Infinity},q=>{q.currency='usd'},q=>{q.validTill='2026-02-30'},q=>{q.validTill='2026-01-01'},q=>{q.approved=true},q=>{q.items=[]},q=>{q.items[0].docstatus=1}]) test(`quote rejects invalid/missing fields ${mutate.toString()}`,()=>{const q=quotation();mutate(q);assert.throws(()=>prepareQuotation(q),TradeError);});
test('enterprise mode fails closed before public outbound network',async()=>{
  const tenders={status:()=>({ted:'configured_unverified'}),search:()=>assert.fail('no HTTP')};
  const result=await execute(register({enterprise:true,tenders}),'workspace_tender_search',{provider:'ted',query:'PD>=20261001'});
  assert.equal(result.isError,true);assert.equal(result.details.reason,'ORIGINAL_REVIEWED_HOST_REQUIRED');
});
test('enterprise receiver is mandatory, model cannot grant authorization',async()=>{
  const tools=register({enterprise:true,authorize:async()=>true});
  const result=await execute(tools,'workspace_erpnext_prepare_quotation',quotation(),{});
  assert.equal(result.details.reason,'EXACT_MODEL_RECEIVER_REQUIRED');assert.equal(result.isError,true);
});
test('enterprise post-call denial removes otherwise successful tool results',async()=>{
  let checks=0;const tools=register({enterprise:true,authorize:async()=>++checks===1,tenders:{status:()=>({}),search:async()=>({status:'ok',items:[{title:'PRIVATE'}]})}});
  const result=await execute(tools,'workspace_tender_search',{provider:'ted',query:'PD>=20261001'});
  assert.equal(result.details.reason,'ORIGINAL_AUTHORIZATION_REFUSED');assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});
test('quotation input is validated and frozen before authorizing a controlled call',async()=>{
  const tools=register({enterprise:true,authorize:async({input})=>{assert.ok(Object.isFrozen(input));assert.ok(Object.isFrozen(input.items[0]));return true;}});
  const result=await execute(tools,'workspace_erpnext_prepare_quotation',quotation());assert.equal(result.details.status,'prepared-draft');
});
test('untrusted adapter exceptions and cancellation never leak details',async()=>{
  const tools=register({tenders:{status:()=>({}),search:async()=>{throw new Error('secret-url-and-key');}}});
  const result=await execute(tools,'workspace_tender_search',{provider:'ted',query:'PD>=20261001'});
  assert.equal(result.isError,true);assert.equal(JSON.stringify(result).includes('secret-url'),false);
  const c=new AbortController();c.abort('secret-reason');const aborted=await execute(tools,'workspace_tender_search',{provider:'ted',query:'PD>=20261001'},{model:receiver},c.signal);
  assert.equal(aborted.details.reason,'OPERATION_CANCELLED');assert.equal(JSON.stringify(aborted).includes('secret-reason'),false);
});
test('unconfigured and rate-limited errors are marked as tool errors',async()=>{
  const result=await execute(register(),'workspace_erpnext_read',erpRead());assert.equal(result.isError,true);assert.equal(result.details.status,'unconfigured');
  const tenders={status:()=>({}),search:async()=>{throw new TradeError('RATE_LIMITED','unavailable',60);}};
  const rate=await execute(register({tenders}),'workspace_tender_search',{provider:'ted',query:'PD>=20261001'});assert.equal(rate.details.retryAfterSeconds,60);assert.equal(rate.isError,true);
});

test('ERP never accepts zero or multiple rows for an exact authorized record',async()=>{
  for(const rows of [[],[{name:'Q-FIX-001'},{name:'Q-FIX-001'}]]) {
    const client=createErpNextClient({baseUrl:'https://erp.example',...credentials,authorizeRecord:async()=>true,fetchImpl:async()=>JSON_RESPONSE({data:rows})});
    await assert.rejects(client.read(erpRead(),undefined,receiver),errorCode('ERP_RECORD_MISMATCH'));
  }
});
test('credentials containing controls or URI auth delimiters are rejected',()=>{
  for(const key of ['short','fixture-key\n','fixture:key:only']) assert.throws(()=>createTenderClient({samApiKey:key}),errorCode('CREDENTIAL_INVALID'));
});
test('oversized tool projection is blocked, never silently truncated',async()=>{
  const tools=register({tenders:{status:()=>({}),search:async()=>({status:'ok',items:[{title:'x'.repeat(70000)}]})}});
  const result=await execute(tools,'workspace_tender_search',{provider:'ted',query:'PD>=20261001'});
  assert.equal(result.isError,true);assert.equal(result.details.reason,'TOOL_OUTPUT_TOO_LARGE');assert.equal(result.details.items,undefined);
});
test('status rejects unknown arguments without changing configuration',async()=>{
  const result=await execute(register(),'workspace_free_trade_status',{enable:true});assert.equal(result.isError,true);assert.equal(result.details.reason,'INPUT_INVALID');
});
test('ERP requests name only for identity verification and returns only authorized fields',async()=>{
  const client=createErpNextClient({baseUrl:'https://erp.example',...credentials,authorizeRecord:async()=>true,fetchImpl:async(url)=>{
    assert.deepEqual(JSON.parse(new URL(url).searchParams.get('fields')),['name','currency']);return JSON_RESPONSE({data:[{name:'Q-FIX-001',currency:'USD',grand_total:999}]});
  }});
  const result=await client.read({...erpRead(),fields:['currency']},undefined,receiver);assert.deepEqual(result.record,{currency:'USD'});
});
