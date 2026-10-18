// Credential-free contracts. All PG rows/HTTP results below are explicit doubles;
// none of these tests are evidence of Medusa, PostgreSQL or authentication running.
import test from 'node:test'
import assert from 'node:assert/strict'
import {Readable} from 'node:stream'
import {spawnSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {validateConfig,readConfig,redact,MAX_VERSION} from './config.mjs'
import {guard,raceCases,assertPublicPayload} from './review-suite.mjs'
import {bounded,waitingUpdates,waitForUpdates,raceWithRowLock,openPostgres} from './postgres.mjs'
import {createMedusaApprovedSource} from '../../plugins/workspace-medusa-catalog/src/approved-source.mjs'

const config=()=>({backendUrl:'http://127.0.0.1:19000',adminToken:'synthetic-admin-token',agentToken:'synthetic-agent-token',postgres:{host:'127.0.0.1',port:15432,database:'medusa_live_synthetic_contract',user:'synthetic',password:'synthetic-pg-password',serverRole:'synthetic'},isolation:{acknowledgement:'DISPOSABLE_ISOLATED_MEDUSA_ONLY',backendUrl:'http://127.0.0.1:19000',database:'medusa_live_synthetic_contract',instance:'medusa-live-synthetic-contract',cleanup:'operator-destroys-instance'}})
const check=(name,ok)=>assert.ok(ok,name)
const waiting=(pid,blockers)=>({pid,blockers,query:'update "product_context" set "status"=$1 where "id"=$2',wait_event_type:'Lock'})

test('config requires explicit exact disposable origin/database and operator cleanup',()=>{
 assert.equal(validateConfig(config()).backendUrl,'http://127.0.0.1:19000')
 for(const mutate of [
  c=>delete c.isolation,c=>c.isolation.acknowledgement='yes',c=>c.isolation.backendUrl='http://localhost:19000',c=>c.isolation.database='other',c=>c.isolation.cleanup='prune',
  c=>c.backendUrl='https://example.com',c=>c.backendUrl='http://127.0.0.1:19000/path',c=>c.backendUrl='http://user:password@127.0.0.1:19000',
  c=>c.postgres.host='production.internal',c=>c.postgres.database='postgres',c=>c.postgres.port=0,c=>c.postgres.connectionString='postgres://forbidden',c=>c.postgres.ssl=true,
  c=>c.adminToken=c.agentToken,c=>c.agentToken+='\n',c=>c.postgres.password='',c=>c.unreviewed='unexpected',c=>c.pgRequireFrom='./unreviewed/package.json',
 ]){const value=config();mutate(value);assert.throws(()=>validateConfig(value),/EXPLICIT_DISPOSABLE/)}
})

test('stdin JSON is size bounded and does not include submitted text in failures',async()=>{
 assert.equal((await readConfig(Readable.from([JSON.stringify(config())]))).isolation.instance,config().isolation.instance)
 await assert.rejects(readConfig(Readable.from(['SYNTHETIC SECRET invalid JSON'])),error=>!error.message.includes('SECRET'))
 await assert.rejects(readConfig(Readable.from(['x'.repeat(32769)])),/CONFIG_TOO_LARGE/)
})

test('CLI refuses absent/invalid isolation before HTTP or PG module loading',()=>{
 const script=new URL('../../scripts/medusa-catalog-live-smoke.mjs',import.meta.url)
 const preload='globalThis.fetch=()=>{throw Error("CONTRACT_NETWORK_MUST_NOT_RUN")}'
 for(const input of ['{}',JSON.stringify({...config(),isolation:undefined})]){
  const result=spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),script.pathname,'--context-review-only'],{input,encoding:'utf8',timeout:3000,env:{PATH:process.env.PATH}})
  assert.equal(result.status,2,result.stderr);assert.match(result.stderr,/EXPLICIT_DISPOSABLE/);assert.doesNotMatch(result.stderr,/CONTRACT_NETWORK|synthetic-pg-password|synthetic-admin-token/)
 }
})

test('review guard preserves version zero, real GET hash and integer ceiling',()=>{
 assert.deepEqual(guard({product_context:null,review_source_hash:'initial'}),{review_version:0,source_hash:'initial'})
 assert.deepEqual(guard({product_context:{review_version:MAX_VERSION},review_source_hash:'ceiling'}),{review_version:MAX_VERSION,source_hash:'ceiling'})
 const cases=raceCases();assert.equal(cases.length,8);assert.equal(new Set(cases.map(JSON.stringify)).size,8)
 for(const version of [1,MAX_VERSION])for(const kind of ['missing_evidence','revoke'])assert.deepEqual(cases.filter(x=>x.version===version&&x.kind===kind).map(x=>x.order),['approval-first','negative-first'])
})

test('redaction handles literal, JSON escaped and encoded supplied secrets',()=>{
 const secrets=['synthetic"password\n',config().agentToken,config().adminToken]
 const report={status:'blocked',values:secrets.flatMap(x=>[x,JSON.stringify(x).slice(1,-1),encodeURIComponent(x),Buffer.from(x).toString('base64'),Buffer.from(x).toString('base64url')]),nested:{message:'Error: '+secrets[0]}}
 const clean=redact(report,secrets),parsed=JSON.parse(clean)
 for(const secret of secrets){assert.ok(!clean.includes(secret));assert.ok(!clean.includes(JSON.stringify(secret).slice(1,-1)));assert.ok(!clean.includes(encodeURIComponent(secret)))}
 assert.equal(parsed.status,'blocked');assert.ok(parsed.values.every(value=>value===null));assert.equal(parsed.nested.message,null)
 assert.equal(report.nested.message,'Error: '+secrets[0])
})

test('structured redaction preserves JSON for quote, backslash and control-character passwords',()=>{
 for(const password of ['"','\\','\0','\b','\t','\n','\r','\u001f','synthetic"\\\n\tsecret','\ud800']){
  const c=config();c.postgres.password=password;validateConfig(c)
  const secrets=[password,c.adminToken,c.agentToken]
  const forms=secrets.flatMap(secret=>{const values=[secret,JSON.stringify(secret).slice(1,-1),Buffer.from(secret).toString('base64'),Buffer.from(secret).toString('base64url')];try{values.push(encodeURIComponent(secret))}catch{}return values})
  const report={status:'blocked',values:forms,nested:{message:'Error: '+password},[password+'-sensitive-key']:'private'}
  const output=redact(report,secrets),parsed=JSON.parse(output)
  assert.equal(parsed.status,'blocked');assert.ok(parsed.values.every(value=>value===null));assert.equal(parsed.nested.message,null)
  assert.equal(Object.hasOwn(parsed,password+'-sensitive-key'),false)
  // JSON delimiters/escapes are syntax. No decoded key or string value may carry
  // a credential or its recognized forms, including a one-character password.
  const inspect=value=>{if(typeof value==='string'){for(const form of forms)assert.ok(!value.includes(form))}else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){inspect(key);inspect(item)}}
  inspect(parsed)
  for(const token of [c.adminToken,c.agentToken])assert.ok(!output.includes(token))
 }
})

test('CLI serializes a structured blocked report for a single double-quote password',()=>{
 const c=config();c.postgres.password='"'
 const script=new URL('../../scripts/medusa-catalog-live-smoke.mjs',import.meta.url)
 const preload='import Module from "node:module";const load=Module._load;Module._load=function(name,...args){if(name==="pg")throw Error("Synthetic \\" load failure");return load.call(this,name,...args)};globalThis.fetch=()=>{throw Error("CONTRACT_NETWORK_MUST_NOT_RUN")}'
 const result=spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),script.pathname,'--context-review-only'],{input:JSON.stringify(c),encoding:'utf8',timeout:3000,env:{PATH:process.env.PATH}})
 assert.equal(result.status,1,result.stderr)
 const report=JSON.parse(result.stdout)
 assert.equal(report.status,'blocked');assert.equal(report.error,null);assert.deepEqual(report.checks,[])
 assert.ok(!result.stdout.includes(c.adminToken));assert.ok(!result.stdout.includes(c.agentToken));assert.equal(result.stderr,'')
})

test('private field keys are rejected even without sentinel values',()=>{
 for(const value of [{context:{notes:null}},{items:[{context:{reviewed_by:'synthetic'}}]},{context:{evidence:[{id:'a',source:'anything'}]}}])assert.throws(()=>assertPublicPayload(value,check,'synthetic'))
 assertPublicPayload({context:{source_hash:'a'.repeat(64),evidence:[{id:'a',label:'visible'}]}},check,'synthetic')
})

test('Agent projection rejects product metadata and all undefined projected fields',()=>{
 const row={context:{product_id:'prod_synthetic',status:'approved',source_hash:'a'.repeat(64),evidence:[{id:'a',label:'visible',type:'spec_sheet',status:'verified'}],commercial_policy:{moq:1,currency:'USD'}},product:{id:'prod_synthetic',title:'Synthetic',variants:[{id:'variant_synthetic',title:'One',sku:'SYNTHETIC'}]}}
 const detail={schema_version:'1.0',review_policy:'medusa-product-context-current-source-v1',generated_at:'synthetic-time',...row}
 const list={schema_version:detail.schema_version,review_policy:detail.review_policy,generated_at:detail.generated_at,count:1,items:[row]}
 for(const payload of [detail,list]){
  assertPublicPayload(payload,check,'synthetic')
  for(const mutate of [
   value=>value.product.metadata={private:'synthetic-private-metadata'},value=>value.product.metadata=null,
   value=>value.product.internal_cost=1,value=>value.product.variants[0].metadata={private:'synthetic'},
   value=>value.context.internal_note='synthetic',value=>value.context.evidence[0].private_url='synthetic',
   value=>value.context.commercial_policy.private_policy='synthetic',value=>value.product.title={private:'synthetic'},
  ]){const changed=structuredClone(payload);mutate(changed.items?.[0]??changed);assert.throws(()=>assertPublicPayload(changed,check,'synthetic'))}
 }
})

test('actual approved reader rejects a missing policy marker (synthetic transport only)',async()=>{
 const actor={workspaceId:'synthetic'},row={schema_version:'1.0',context:{product_id:'prod_synthetic',status:'approved',review_version:1,source_hash:'a'.repeat(64)},product:{id:'prod_synthetic',title:'Synthetic'}}
 const reader=createMedusaApprovedSource({connection:{reviewed:true,sourceId:'11111111-1111-4111-8111-111111111111',workspaceId:actor.workspaceId,baseURL:'http://127.0.0.1:19000',allowLoopbackHTTP:true,readToken:config().agentToken},authorizeOriginal:a=>a===actor,fetchImpl:async()=>Response.json(row)})
 await assert.rejects(reader.read('prod_synthetic',actor),e=>e.code==='MEDUSA_APPROVED_SOURCE_INVALID')
 row.review_policy='medusa-product-context-current-source-v1'
 assert.equal((await reader.read('prod_synthetic',actor)).reference.id,'prod_synthetic')
})

test('a query name or send order alone cannot constitute the lock witness',async()=>{
 assert.equal(waitingUpdates([{...waiting(2,[1]),wait_event_type:null}],1),null)
 assert.equal(waitingUpdates([{...waiting(2,[1]),query:'select * from product_context'}],1),null)
 assert.equal(waitingUpdates([waiting(2,[99])],1),null)
 assert.equal(waitingUpdates([waiting(2,[1]),waiting(3,[1])],1),null)
 const observer={query:async()=>({rows:[waiting(2,[1]),waiting(3,[1])]})}
 await assert.rejects(waitForUpdates(observer,{lockerPid:1,serverRole:'synthetic',firstPid:2,requests:[{settled:false}],timeoutMs:10}),/WITNESS_TIMEOUT/)
 await assert.rejects(waitForUpdates(observer,{lockerPid:1,serverRole:'synthetic',requests:[{settled:true}]}),/HTTP_FINISHED/)
})

function barrierFixture({badStatus=false,failWitness=false,failLock=false}={}){
 const log=[],pending=[],locker={query:async(sql,params)=>{
  log.push({kind:'sql',sql,params})
  if(sql.includes('for update')){if(failLock)throw Error('SYNTHETIC_LOCK_FAILURE');return {rowCount:1}}
  if(sql.includes('pg_backend_pid'))return {rows:[{pid:11}]}
  if(sql==='rollback')for(const [index,resolve] of pending.entries())resolve({status:index===0?200:badStatus?200:409,data:{product_context:{status:'approved'}}})
  return {}
 }}
 let observations=0
 const observer={query:async(sql,params)=>{
  log.push({kind:'observation',sql,params});observations++
  if(failWitness)throw Error('SYNTHETIC_OBSERVER_DENIED')
  return {rows:observations===1?[waiting(22,[11])]:[waiting(22,[11]),waiting(33,[22])]}
 }}
 return {log,observer,locker,post:body=>{log.push({kind:'http',body});return new Promise(resolve=>pending.push(resolve))}}
}

test('barrier observes first UPDATE, then both queue dependencies, then releases',async()=>{
 const f=barrierFixture(),checks=[]
 const winner=await raceWithRowLock({...f,serverRole:'synthetic',id:'ctx_owned',productId:'prod_owned',firstBody:{first:true},secondBody:{second:true},check:(...args)=>{check(...args);checks.push(args)},name:'contract'})
 assert.equal(winner.status,'approved')
 assert.deepEqual(f.log.map(x=>x.kind==='sql'?x.sql:x.kind),['begin',"set local lock_timeout='3000ms'",'select id from product_context where id=$1 and product_id=$2 and deleted_at is null for update','select pg_backend_pid() as pid','http','observation','http','observation','rollback'])
 assert.deepEqual(f.log.find(x=>x.sql?.includes('for update')).params,['ctx_owned','prod_owned'])
 const witness=checks.find(x=>x[0].endsWith('two-real-updates-waiting'))[2]
 assert.deepEqual(witness.first_blockers,[11]);assert.deepEqual(witness.second_blockers,[22])
})

for(const mode of ['badStatus','failWitness','failLock'])test('barrier finally releases transaction on '+mode,async()=>{
 const f=barrierFixture({[mode]:true})
 await assert.rejects(raceWithRowLock({...f,serverRole:'synthetic',id:'ctx_owned',productId:'prod_owned',firstBody:{},secondBody:{},check,name:'contract'}))
 assert.equal(f.log.filter(x=>x.sql==='rollback').length,1)
})

test('PG startup failure closes both bounded connections',async()=>{
 const instances=[]
 class Client{constructor(options){this.options=options;instances.push(this)}async connect(){if(instances.indexOf(this)===1)throw Error('SYNTHETIC_CONNECT_FAILURE')}async end(){this.ended=true}}
 await assert.rejects(openPostgres(Client,config().postgres),/SYNTHETIC_CONNECT_FAILURE/)
 assert.equal(instances.length,2);assert.ok(instances.every(x=>x.ended&&x.options.query_timeout===3000&&x.options.idle_in_transaction_session_timeout===12000&&x.options.ssl===false&&x.options.options==='-c search_path=public'))
})

test('bounded operation rejects on timeout',async()=>{
 await assert.rejects(bounded(new Promise(()=>{}),5,'SYNTHETIC_TIMEOUT'),/SYNTHETIC_TIMEOUT/)
})

test('driver does not patch production service or use sleeps/retries as evidence',async()=>{
 const pg=await readFile(new URL('./postgres.mjs',import.meta.url),'utf8')
 assert.match(pg,/pg_stat_activity/);assert.match(pg,/pg_blocking_pids/);assert.match(pg,/finally/)
 assert.doesNotMatch(pg,/pg_sleep|setInterval|nativeUpdate|connect:false/)
 const script=await readFile(new URL('../../scripts/medusa-catalog-live-smoke.mjs',import.meta.url),'utf8')
 assert.match(script,/initialGuard=\{review_version:0,source_hash:review.data.review_source_hash\}/)
 assert.match(script,/review_version:revokeSnapshot.data.product_context.review_version/)
})
