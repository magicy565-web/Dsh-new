import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { startNativeDotHost } from '../deploy/native-dot-host.mjs';

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
  const call=route=>new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port:host.frontend.address().port,path:route,headers:{Host:new URL(origin).host,Authorization:'Bearer '+key}},res=>{
      const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}));
    });req.on('error',reject);req.end();
  });
  const identity=await call('/api/muse-worker/v1/identity'); assert.equal(identity.status,200); assert.equal(identity.body.approved,false);
  const inbox=await call('/api/muse-worker/v1/inbox');assert.equal(inbox.status,200);assert.deepEqual(inbox.body.tasks,[]);
  await host.close(); host=undefined;
});
