// Actual original index/access/CSRF/Goal route. Model remains unconfigured.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {signWorkspaceRequest} from '../server/auth-ingress.mjs';
import {request} from './agent-service.helpers.mjs';
test('signed HTTP creates the real Goal owner from trusted identity and refuses cross-owner adoption',async t=>{
 const directory=await fs.mkdtemp('/tmp/workspace-goal-http-'),keys=generateKeyPairSync('ed25519');
 const access={mode:'enterprise',publicOrigin:'https://workspace.example',workspaceId:'goal-http',issuer:'synthetic',keyId:'synthetic',publicKey:keys.publicKey.export({type:'spki',format:'pem'}),members:[{subject:'owner',role:'admin'},{subject:'other',role:'operator'}]};
 const app=await createApp({dataDirectory:directory,capabilityEnvironment:{},provider:{kind:'synthetic',configured:false},access});t.after(async()=>{await app.close();await fs.rm(directory,{recursive:true,force:true});});const address=await app.listen(0),base='http://127.0.0.1:'+address.port,sessions=new Map();
 const post=async(subject,target,body)=>{if(!sessions.has(subject)){const loginTarget='/api/session/login',login=await request(base,loginTarget,{method:'POST',body:{},headers:{Host:'workspace.example',Origin:access.publicOrigin,'X-Workspace-Login':'1','X-Workspace-Assertion':signWorkspaceRequest({privateKey:keys.privateKey,...access,subject,method:'POST',target:loginTarget,body:'{}'})}});assert.equal(login.status,200,login.text);sessions.set(subject,{Cookie:login.headers['set-cookie'][0].split(';')[0],'X-CSRF-Token':login.json.csrfToken});}return request(base,target,{method:'POST',body,headers:{Host:'workspace.example',Origin:access.publicOrigin,...sessions.get(subject),'X-Workspace-Assertion':signWorkspaceRequest({privateKey:keys.privateKey,...access,subject,method:'POST',target,body:JSON.stringify(body)})}});};
 const body={requestId:randomUUID(),title:'Real HTTP Goal',description:'No execution',createdBy:'forged',workspaceId:'forged'};
 const created=await post('owner','/api/goals',body);assert.equal(created.status,201,created.text);const goal=created.json.goal,conversation=app.store.read().conversations.find(c=>c.id===goal.conversationId);assert.equal(conversation.createdBy,'owner');assert.equal(conversation.workspaceId,access.workspaceId);assert.equal(goal.status,'draft');assert.equal(app.store.read().runs.length,0);
 const duplicate=await post('owner','/api/goals',body);assert.equal(duplicate.status,201,duplicate.text);assert.equal(duplicate.json.duplicate,true);
 const stolen=await post('other','/api/goals',{requestId:randomUUID(),title:'Foreign adoption',conversationId:goal.conversationId});assert.equal(stolen.status,404,stolen.text);assert.equal(app.store.read().goals.length,1);
});
