// Real index HTTP/access/Library/Brain, with an unconfigured model adapter.
// This checks the ordinary read path, not a mock handleGoalBrainHttp call.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {createWorkspaceOmpBusinessOptions} from '../server/workspace-omp-host.mjs';
import {createPiProvider} from '../server/pi-provider.mjs';
import {signWorkspaceRequest} from '../server/auth-ingress.mjs';
import {request} from './agent-service.helpers.mjs';
test('actual index keeps ordinary viewer-owned Brain GET without business/model binding or write role',async t=>{
 for(const pluginConfiguration of [{root:'/tmp'},{configuration:'config.json'},{none:true},{disabled:['workspace-goal-intelligence']},{disabled:['workspace_skill']},{disabled:['unknown-plugin']}]) assert.throws(()=>createWorkspaceOmpBusinessOptions({environment:{WORKSPACE_OMP_PROFILE:'business'},pluginConfiguration}),/only original optional-plugin disables/);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'brain-read-compat-')),keys=generateKeyPairSync('ed25519');let bindings=0;
 const model={provider:'workspace-deepseek',id:'deepseek-flash',baseUrl:'https://api.deepseek.com'},recipient={kind:'pi-coding-agent',provider:model.provider,model:model.id,destination:model.baseUrl};
 const access={mode:'enterprise',publicOrigin:'https://workspace.example',workspaceId:'read-compat',issuer:'synthetic-read',keyId:'synthetic-read-key',publicKey:keys.publicKey.export({type:'spki',format:'pem'}),members:[{subject:'admin',role:'admin'},{subject:'reader',role:'viewer'}]};
 const app=await createApp({dataDirectory:directory,capabilityEnvironment:{},access,provider:createPiProvider({apiKey:''}),
  libraryModelReadPolicy:{enabled:true,reviewed:true,workspaceId:access.workspaceId,subject:'reader',expiresAt:'2099-01-01T00:00:00.000Z',recipient,company:null,products:[],productFields:['name']},
  goalBrainOptions:{originalReceiver:model,reviewedGoals:[]},
  businessAgentOptions:{recipient,engineAdapter:{scope:'omp:18.10.4:business-v1',complete:async()=>{throw Error('No model allowed');}},resolveBinding:async()=>{bindings++;throw Error('An ordinary GET must not resolve a model');}}});
 t.after(async()=>{await app.close();await fs.rm(directory,{recursive:true,force:true});});const address=await app.listen(0),baseURL='http://127.0.0.1:'+address.port;
 const created=await app.runtime.createConversation({title:'Original ordinary owned conversation',requestId:randomUUID()},{subject:'reader',workspaceId:access.workspaceId}),cid=created.conversation.id;
 assert.equal(created.conversation.businessAgentOwner,undefined);
 const target='/api/session/login',login=await request(baseURL,target,{method:'POST',body:{},headers:{Host:'workspace.example',Origin:access.publicOrigin,'X-Workspace-Login':'1','X-Workspace-Assertion':signWorkspaceRequest({privateKey:keys.privateKey,...access,subject:'reader',method:'POST',target,body:'{}'})}});assert.equal(login.status,200,login.text);
 const headers={Host:'workspace.example',Cookie:login.headers['set-cookie'][0].split(';')[0]};
 for(const resource of ['sources','context','diagnosis','brief']){
  const route='/api/conversations/'+cid+'/brain/'+resource,result=await request(baseURL,route,{headers:{...headers,'X-Workspace-Assertion':signWorkspaceRequest({privateKey:keys.privateKey,...access,subject:'reader',method:'GET',target:route})}});assert.equal(result.status,200,result.text);
 }
 assert.equal(bindings,0);assert.equal(app.store.read().runs.length,0);assert.equal(app.store.read().conversations.length,1);
});
