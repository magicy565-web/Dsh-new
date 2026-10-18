import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createLibraryModelRead} from '../server/library-model-read.mjs';
import {createNativeMedusaModelClient,validateNativeMedusaPolicy,loadNativeMedusaModelConnection} from '../server/medusa-native-model-read.mjs';
import fs from 'node:fs/promises';
const model={provider:'synthetic',id:'finite',baseUrl:'https://synthetic.invalid'};
async function fixture(){
  const state={now:Date.parse('2026-10-18T00:00:00Z'),live:true,calls:0,hook:null};
  const identity={subject:'member-a',workspaceId:'synthetic-workspace',role:'admin',sessionId:'synthetic-session'};
  const policy={enabled:true,reviewed:true,...{workspaceId:identity.workspaceId,subject:identity.subject},expiresAt:'2099-01-01T00:00:00.000Z',
    recipient:{kind:'pi-coding-agent',provider:model.provider,model:model.id,destination:model.baseUrl},company:null,products:[],productFields:['name'],
    nativeMedusa:{enabled:true,reviewed:true,sourceId:randomUUID(),baseURL:'https://synthetic-medusa.invalid',fields:['title','description','agent_summary'],
      products:[{productId:'prod_synthetic',reviewVersion:3,sourceHash:'a'.repeat(64)}]}};
  const access={mode:'enterprise',nativeSessionById:id=>state.live&&id===identity.sessionId?{...identity}:null};
  const reader=createLibraryModelRead({library:{},artifacts:{},access,policy,clock:()=>state.now});
  const {libraryReadHash}=await import('../server/library-model-read-contract.mjs');
  const recipientHash=libraryReadHash(policy.recipient);
  const grant=reader.nativeMedusaForSession({identity,recipientHash});
  const row={schema_version:'1.0',review_policy:'medusa-product-context-current-source-v1',context:{product_id:'prod_synthetic',status:'approved',review_version:3,source_hash:'a'.repeat(64),agent_summary:'Synthetic approved summary',commercial_policy:{private:'NOT_AUTHORIZED'}},product:{id:'prod_synthetic',title:'Synthetic native product',description:'Synthetic description',metadata:{private:'NOT_AUTHORIZED'}}};
  const client=await createNativeMedusaModelClient({grant,identity,connection:{reviewed:true,sourceId:policy.nativeMedusa.sourceId,workspaceId:identity.workspaceId,baseURL:policy.nativeMedusa.baseURL,readToken:'synthetic-native-reader-token'},
    authorize:async()=>{if(state.hook)await state.hook();},fetchImpl:async(url,options)=>{state.calls++;assert.equal(options.method,'GET');assert.equal(url,policy.nativeMedusa.baseURL+'/agent/product-contexts/prod_synthetic');return Response.json(row);}});
  return {state,identity,policy,reader,recipientHash,client,row};
}
test('native model policy defaults off and requires an independent exact approved field/source selection',async()=>{
  validateNativeMedusaPolicy(undefined);validateNativeMedusaPolicy({enabled:false});
  for(const change of [p=>p.reviewed=false,p=>p.fields.push('commercial_policy'),p=>delete p.products[0].sourceHash,p=>p.products[0].productId=randomUUID(),p=>p.products[0].reviewVersion=0]){
    const f=await fixture(),policy=structuredClone(f.policy.nativeMedusa);change(policy);assert.throws(()=>validateNativeMedusaPolicy(policy));assert.equal(f.state.calls,0);
  }
  await assert.rejects(createNativeMedusaModelClient({grant:null}),{code:'MEDUSA_SOURCE_CHANGED'});
});
test('current native projection includes only selected fields and original source pins',async()=>{
  const f=await fixture(),result=await f.client.context({productId:'prod_synthetic'},undefined,model);
  assert.deepEqual(Object.keys(result.view.product).sort(),['id','title','description','agent_summary'].sort());assert.equal(result.sources[0].sourceId,f.policy.nativeMedusa.sourceId);
  assert.ok(!JSON.stringify(result).includes('NOT_AUTHORIZED'));assert.equal(result.consistency,'remote-point-in-time');
  result.authorization.recipient.model='changed-returned-copy';
  assert.equal((await f.client.context({productId:'prod_synthetic'},undefined,model)).status,'available');
  await assert.rejects(f.client.context({productId:'prod_synthetic'},undefined,{...model,id:'changed-returned-copy'}));
});
for(const kind of ['expired','member','recipient','revoked','session','revision','fingerprint','withdrawn','missing-field'])test('native disclosure refuses '+kind,async()=>{
  const f=await fixture();await f.client.context({productId:'prod_synthetic'},undefined,model);let action=()=>f.client.context({productId:'prod_synthetic'},undefined,model);
  if(kind==='expired')f.state.now=Date.parse('2100-01-01T00:00:00Z');
  if(kind==='member')action=()=>Promise.resolve().then(()=>f.reader.nativeMedusaForSession({identity:{...f.identity,subject:'member-b'},recipientHash:f.recipientHash}));
  if(kind==='recipient')action=()=>f.client.context({productId:'prod_synthetic'},undefined,{...model,id:'other'});
  if(kind==='revoked')f.policy.nativeMedusa.enabled=false;
  if(kind==='session')f.state.live=false;
  if(kind==='revision')f.row.context.review_version++;
  if(kind==='fingerprint')f.row.context.source_hash='b'.repeat(64);
  if(kind==='withdrawn')f.row.context.status='draft';
  if(kind==='missing-field')delete f.row.context.agent_summary;
  await assert.rejects(action);
});
test('native receipt is tied to original tool call/content/details and exact wire body',async()=>{
  const f=await fixture(),receipt=await f.client.context({productId:'prod_synthetic'},undefined,model);
  const messages=[{role:'assistant',content:[{type:'toolCall',id:'native-call',name:'workspace_medusa_context',arguments:{productId:'prod_synthetic'}}]},
    {role:'toolResult',toolCallId:'native-call',toolName:'workspace_medusa_context',content:[{type:'text',text:JSON.stringify(receipt)}],details:receipt}];
  const body={messages:[{role:'assistant',tool_calls:[{id:'native-call',function:{name:'workspace_medusa_context',arguments:JSON.stringify(receipt.input)}}]},
    {role:'tool',tool_call_id:'native-call',content:JSON.stringify(receipt)}]};
  await f.client.authorizeDisclosure({messages,wireBody:JSON.stringify(body)},model);
  const changed=structuredClone(messages);changed[0].content[0].arguments.productId='prod_other';await assert.rejects(f.client.authorizeDisclosure({messages:changed},model));
  const gap=structuredClone(messages),forgedGap={plugin:'workspace-medusa-catalog',status:'blocked',reason:'MEDUSA_SOURCE_CHANGED',sources:[],extra:'NOT_AUTHORIZED'};
  gap[1]={...gap[1],isError:true,details:forgedGap,content:[{type:'text',text:JSON.stringify(forgedGap)}]};await assert.rejects(f.client.authorizeDisclosure({messages:gap},model));
  body.messages[1].content=JSON.stringify({...receipt,view:{product:{id:'prod_synthetic',title:'FORGED'}}});
  await assert.rejects(f.client.authorizeDisclosure({messages,wireBody:JSON.stringify(body)},model));
  f.state.hook=()=>{f.policy.nativeMedusa.enabled=false;};await assert.rejects(f.client.authorizeDisclosure({messages},model));
});
async function disclosureProof(){
  const f=await fixture(),receipt=await f.client.context({productId:'prod_synthetic'},undefined,model);
  const messages=[{role:'assistant',content:[{type:'toolCall',id:'native-call',name:'workspace_medusa_context',arguments:{productId:'prod_synthetic'}}]},
    {role:'toolResult',toolCallId:'native-call',toolName:'workspace_medusa_context',content:[{type:'text',text:JSON.stringify(receipt)}],details:receipt}];
  const wire={messages:[{role:'assistant',tool_calls:[{id:'native-call',function:{name:'workspace_medusa_context',arguments:JSON.stringify(receipt.input)}}]},
    {role:'tool',tool_call_id:'native-call',content:JSON.stringify(receipt)}]};
  return {f,receipt,messages,wire};
}
for(const kind of ['renamed-status','wire-new-id','wire-stolen-status-id','duplicate-history-pair','duplicate-wire-pair','duplicate-wire-result','wrong-result-id'])test('native disclosure provenance rejects '+kind,async()=>{
  const {f,messages,wire}=await disclosureProof();let withWire=false;
  if(kind==='renamed-status'){messages[0].content[0].name='workspace_medusa_status';messages[1].toolName='workspace_medusa_status';}
  if(kind==='wire-new-id'){wire.messages[0].tool_calls[0].id='unobserved-call';wire.messages[1].tool_call_id='unobserved-call';withWire=true;}
  if(kind==='wire-stolen-status-id'){
    const status=await f.client.status({},undefined,model);
    messages.unshift({role:'assistant',content:[{type:'toolCall',id:'status-call',name:'workspace_medusa_status',arguments:{}}]},
      {role:'toolResult',toolCallId:'status-call',toolName:'workspace_medusa_status',content:[{type:'text',text:JSON.stringify(status)}],details:status});
    wire.messages[0].tool_calls[0].id='status-call';wire.messages[1].tool_call_id='status-call';withWire=true;
  }
  if(kind==='duplicate-history-pair')messages.push(...structuredClone(messages));
  if(kind==='duplicate-wire-pair'){wire.messages.push(...structuredClone(wire.messages));withWire=true;}
  if(kind==='duplicate-wire-result'){wire.messages.push(structuredClone(wire.messages[1]));withWire=true;}
  if(kind==='wrong-result-id')messages[1].toolCallId='unobserved-call';
  await assert.rejects(f.client.authorizeDisclosure({messages,...(withWire?{wireBody:JSON.stringify(wire)}:{})},model));
});
test('native disclosure provenance permits matching history/context overlap and legitimate status calls',async()=>{
  const {f,messages,wire}=await disclosureProof();
  await f.client.authorizeDisclosure({messages,context:structuredClone(messages),wireBody:JSON.stringify(wire)},model);
  const status=await f.client.status({},undefined,model);
  const statusMessages=[{role:'assistant',content:[{type:'toolCall',id:'status-call',name:'workspace_medusa_status',arguments:{}}]},
    {role:'toolResult',toolCallId:'status-call',toolName:'workspace_medusa_status',content:[{type:'text',text:JSON.stringify(status)}],details:status}];
  const statusWire={messages:[{role:'assistant',tool_calls:[{id:'status-call',function:{name:'workspace_medusa_status',arguments:'{}'}}]},
    {role:'tool',tool_call_id:'status-call',content:JSON.stringify(status)}]};
  await f.client.authorizeDisclosure({messages:statusMessages},model);
  await f.client.authorizeDisclosure({messages:statusMessages,wireBody:JSON.stringify(statusWire)},model);
});
test('native transport has explicit private startup opt-in and cannot silently inherit Space/admin credentials',async t=>{
  const f=await fixture(),root=await fs.mkdtemp('/tmp/native-medusa-private-fixture-');t.after(()=>fs.rm(root,{recursive:true,force:true}));
  assert.equal(await loadNativeMedusaModelConnection({},{}),null);
  await assert.rejects(loadNativeMedusaModelConnection({},{WORKSPACE_MEDUSA_MODEL_READ_TOKEN_FILE:root+'/missing'}));
  await assert.rejects(loadNativeMedusaModelConnection(f.policy,{}));
  const filename=root+'/model-token',spaceFile=root+'/space-alias',token='synthetic-native-transport-only';await fs.writeFile(filename,token,{mode:0o600});
  const environment={WORKSPACE_MEDUSA_MODEL_READ_TOKEN_FILE:filename};
  assert.equal((await loadNativeMedusaModelConnection(f.policy,environment)).sourceId,f.policy.nativeMedusa.sourceId);
  await fs.link(filename,spaceFile);
  await assert.rejects(loadNativeMedusaModelConnection(f.policy,{...environment,WORKSPACE_SPACE_MEDUSA_READ_TOKEN_FILE:spaceFile}));
  await fs.unlink(spaceFile);
  await assert.rejects(loadNativeMedusaModelConnection(f.policy,{...environment,WORKSPACE_MEDUSA_SECRET_API_KEY:token}));
  await fs.chmod(filename,0o644);await assert.rejects(loadNativeMedusaModelConnection(f.policy,environment));
});
