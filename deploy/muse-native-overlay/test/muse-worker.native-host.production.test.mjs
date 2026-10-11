import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { startNativeDotHost } from '../deploy/native-dot-host.mjs';
import { applyPrivateMuseReview, museReportHash } from '../server/muse-worker-private-review.mjs';

// Real production Cordis boot with isolated fixture identities and no Goal/model call.
test('production Cordis Host mounts Muse gates false and drains the original scope', async t => {
  assert.equal(process.platform,'linux');
  const harnessRoot=process.env.DSH_TEST_SOURCE_ROOT;
  assert(harnessRoot && path.isAbsolute(harnessRoot),'Explicit reviewed Harness source required.');
  const directory=await mkdtemp(path.join(os.tmpdir(),'workspace-muse-cordis-fixture-'));
  let host;
  t.after(async()=>{await host?.close(); await rm(directory,{recursive:true,force:true});});
  const actor={subject:'cordis-owner-fixture',nativeAgentId:randomUUID()};
  const {publicKey}=generateKeyPairSync('ed25519');
  const members=path.join(directory,'members.json'), publicFile=path.join(directory,'ingress-public.pem'), workers=path.join(directory,'workers.json');
  await writeFile(members,JSON.stringify([{subject:actor.subject,role:'admin'}]),{mode:0o600});
  await writeFile(publicFile,publicKey.export({type:'spki',format:'pem'}),{mode:0o600});
  const hash=value=>createHash('sha256').update(value).digest('hex');
  await writeFile(workers,JSON.stringify({enabled:true,admissions:[{id:'isolated-dot-grant',subject:actor.subject,
    provider:'dot',agentId:'isolated-dot-agent',providerOwnerId:'isolated-dot-owner',protocolFingerprint:hash('isolated-dot-protocol'),
    admission:'invited',transport:'workspace-pull',expiresAt:Date.now()+86400_000}]}),{mode:0o600});
  const staticDirectory=path.join(directory,'static'); await mkdir(staticDirectory);
  const origin='https://workspace.cordis-fixture.test';
  const environment={WORKSPACE_ACCESS_MODE:'enterprise',WORKSPACE_PUBLIC_ORIGIN:origin,WORKSPACE_ID:'cordis-fixture',
    WORKSPACE_INGRESS_ISSUER:'cordis-fixture',WORKSPACE_INGRESS_KEY_ID:'fixture-key',WORKSPACE_MEMBERS_FILE:members,WORKSPACE_INGRESS_PUBLIC_KEY_FILE:publicFile};
  const configuration={version:1,harnessRoot,sessionDirectory:path.join(directory,'sessions'),mountDirectory:path.join(directory,'mounts'),
    staticDirectory,port:0,dotOwnerSubject:actor.subject,plugin:{enabled:true,version:1,scopeId:'isolated-cordis-fixture',
      dataDirectory:path.join(directory,'data'),workerConfigFile:workers,operators:[actor]}};
  const dotConfiguration={enabled:true,resource:'https://dot.cordis-fixture.test/mcp',authorizationServer:'https://auth.cordis-fixture.test',
    workspaceId:'cordis-fixture',bindings:[],callbackURLs:[],encryptionKeys:[{id:'fixture-encryption',base64:Buffer.alloc(32,7).toString('base64')}],activeEncryptionKey:'fixture-encryption',keys:[{kid:'fixture-key',alg:'EdDSA',jwk:publicKey.export({format:'jwk'})}]};
  const key='cordis-fixture-key_012345678901234567890123';
  const worker={workerId:'ac9cbe73-0c51-41e4-b713-4f78820d1215',ownerId:'personal-cordis-fixture',tokenDigest:hash(key),
    enabled:false,scopeReviewed:false,externalBudgetVerified:false};
  host=await startNativeDotHost({configuration,dotConfiguration,museConfiguration:{version:1,worker,actor},environment});
  assert(host.ctx.get('workspaceCloudMuseRestMounted')); assert(host.ctx.get('workspaceFrontend'));
  assert.equal(host.ctx.agents.get(actor.nativeAgentId).session.id,actor.nativeAgentId);
  assert.equal((await host.ctx.sessionPersistence.list()).length,1);
  const call=(route,method='GET',body)=>new Promise((resolve,reject)=>{
    const raw=body===undefined?undefined:JSON.stringify(body);
    const req=http.request({host:'127.0.0.1',port:host.frontend.address().port,path:route,method,
      headers:{Host:new URL(origin).host,Authorization:'Bearer '+key,...(raw?{'Content-Type':'application/json'}:{})}},res=>{
      const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}));
    });req.on('error',reject);req.end(raw);
  });
  const identity=await call('/api/muse-worker/v1/identity'); assert.equal(identity.status,200); assert.equal(identity.body.approved,false);
  const inbox=await call('/api/muse-worker/v1/inbox');assert.equal(inbox.status,200);assert.deepEqual(inbox.body.tasks,[]);
  const originalAgent=host.ctx.agents.get(actor.nativeAgentId);
  const originalGoal=host.ctx.goals.create(originalAgent,{objective:'Saved public fixture Goal; do not run or replace.',maxGoalRounds:1});
  await host.ctx.sessions.flush(originalAgent.session);
  await host.service.bindActor(actor).register({grantId:'isolated-dot-grant',requestId:'original-dot-fixture-register'});
  await host.close(); host=undefined;
  const approved={version:1,worker:{...worker,enabled:true,scopeReviewed:true,externalBudgetVerified:true},actor};
  host=await startNativeDotHost({configuration,dotConfiguration,museConfiguration:approved,environment});
  const paused=host.service.status();assert.equal(paused.phase,'paused');
  const originalConnection=structuredClone((await host.service.bindActor(actor).view()).worker.connection);
  const review=(action,requestId,extras={})=>({version:1,action,requestId,
    expectedEpoch:host.service.status().epoch,configurationHash:host.service.status().configurationHash,
    callbackCandidateIds:[],workerId:worker.workerId,confirmed:true,...extras});
  const apply=command=>applyPrivateMuseReview({review:command,configuration:approved,service:host.service,
    refreshTools:exact=>host.ctx.workspaceDotHost.refreshReviewedTools(exact)});
  const activation=review('muse-activate','private-muse-activation');
  await assert.rejects(applyPrivateMuseReview({review:activation,configuration:{version:1,worker,actor},service:host.service,
    refreshTools:()=>assert.fail('gates false must not refresh')}),{code:'MW_PRIVATE_REVIEW'});
  assert.equal(host.service.status().epoch,paused.epoch);
  await assert.rejects(apply({...activation,bindings:[]}),{code:'MW_PRIVATE_REVIEW'});
  await assert.rejects(host.ctx.workspaceDotHost.resumeEmptyMount({expectedEpoch:paused.epoch,
    configurationHash:paused.configurationHash,requestId:'deny-empty-history',
    connectionId:originalConnection.id,authorizationEpoch:originalConnection.authorizationEpoch}),{code:'WORKSPACE_DOT_EMPTY_REVIEW'});
  const activated=await apply(activation);assert.equal(activated.dotConnectionResumed,false);
  assert.equal(host.service.status().phase,'active');
  await apply(activation);assert.equal(host.service.status().epoch,paused.epoch+1);
  assert.deepEqual((await host.service.bindActor(actor).view()).worker.connection,originalConnection);
  assert.equal(host.ctx.goals.get(host.ctx.agents.get(actor.nativeAgentId)).id,originalGoal.id);
  assert.equal(host.ctx.goals.get(host.ctx.agents.get(actor.nativeAgentId)).phase,'active');
  assert.equal((await host.ctx.sessionPersistence.list()).length,1);
  assert.equal((await call('/api/muse-worker/v1/identity')).body.approved,true);
  const requestId='private-product-fixture';
  const order={serviceId:'channel-validation',product:'Synthetic public product fixture',market:'US',
    objective:'Isolated contract test; no research, paid calls or contact.',budgetCredits:5,
    deadlineAt:new Date(Date.now()+86400_000).toISOString(),requestId,publicDataConfirmed:true,workerId:worker.workerId};
  const start=review('muse-order-start',requestId,{order,extraCostLimitUsd:0});
  await assert.rejects(apply({...start,extraCostLimitUsd:1}),{code:'MW_PRIVATE_REVIEW'});
  const dispatched=await apply(start);assert.equal(dispatched.status,'queued');
  assert.equal((await apply(start)).orderId,dispatched.orderId);
  assert.equal((await call('/api/muse-worker/v1/inbox')).body.tasks.length,1);
  const taskBase='/api/muse-worker/v1/tasks/'+dispatched.orderId;
  const claimed=await call(taskBase+'/claim','POST',{requestId:'private-fixture-claim'});assert.equal(claimed.status,200);
  const attempt={attemptId:claimed.body.attemptId,fence:claimed.body.fence};
  const delivery=Buffer.from(JSON.stringify({schema:'workspace.worker.delivery.v1',orderId:dispatched.orderId,
    deliverables:[{name:'Synthetic product research',type:'report',summary:'Contract fixture only.'}],
    evidence:[{title:'Synthetic source reference',url:'https://www.loc.gov/about/',detail:'No research was performed.'}]}));
  assert.equal((await call(taskBase+'/upload-file','POST',{...attempt,uploadId:'private-fixture-upload',
    filename:'fixture.json',base64:delivery.toString('base64'),sha256:hash(delivery)})).status,201);
  assert.equal((await call(taskBase+'/submit-result','POST',{...attempt,requestId:'private-fixture-submit',
    summary:'Synthetic product contract fixture.',sources:['https://www.loc.gov/about/'],toolEvidence:[],
    evidenceNote:'Isolated local regression fixture; no Muse research or paid execution occurred.'})).status,200);
  const refreshed=await apply(review('muse-order-refresh','private-fixture-refresh',{orderId:dispatched.orderId}));
  assert.equal(refreshed.order.status,'review_required');assert.equal(refreshed.reportSha256,museReportHash(refreshed.order.workerReport));
  await assert.rejects(apply(review('muse-order-accept','bad-result-hash',{orderId:dispatched.orderId,reportSha256:hash('wrong')})),{code:'MW_PRIVATE_REVIEW'});
  const accepted=await apply(review('muse-order-accept','exact-result-hash',{orderId:dispatched.orderId,reportSha256:refreshed.reportSha256}));
  assert.equal(accepted.status,'accepted');assert(accepted.deliveryArtifactId);
  assert.equal((await apply(review('muse-order-accept','exact-result-hash-retry',{orderId:dispatched.orderId,reportSha256:refreshed.reportSha256}))).deliveryArtifactId,accepted.deliveryArtifactId);
  assert.deepEqual((await host.service.bindActor(actor).view()).worker.connection,originalConnection);
  await host.close(); host=undefined;
});
