import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantModule, assistantPrompt, launchAssistant } from '../src/assistant.js';
test('assistant context uses explicit workspace/record identities and keeps task separate',()=>{
 assert.equal(assistantModule('inventory'),'products');assert.equal(assistantModule('payments'),null);
 const prompt=assistantPrompt({module:'products',goal:'核对商品',instructions:'保留来源',task:'列出缺失信息',context:{workspaceId:'a',recordId:'p1',revision:3}});
 assert.match(prompt,/"recordId": "p1"/);assert.match(prompt,/用户当前任务：\n列出缺失信息/);
 assert.throws(()=>assistantPrompt({module:'products',task:'x',context:{}}));
});
test('launch creates a fresh native session and never clears an existing draft',async()=>{
 const calls=[];const binding={sessionId:'fresh'};
 const services={sessions:{retain(){return {release(){}};},async create(request){calls.push(request);return 'fresh';},binding(id){assert.equal(id,'fresh');return binding;}},conversation:{input:{requestDraftInitialization(b,options){assert.equal(b,binding);calls.push(options);return 'applied';}}},uiWorkspace:{openSession(target){calls.push(target);}}};
 assert.equal(await launchAssistant(services,'workspace-a','task'),'fresh');
 assert.deepEqual(calls,[{workspaceId:'workspace-a',agentPreset:'standard'},{prompt:'task',clearPreviousDraft:false},'fresh']);
 services.conversation.input.requestDraftInitialization=()=> 'preserved';
 await assert.rejects(launchAssistant(services,'workspace-a','task'),/未能载入/);
 assert.equal(calls.length,4,'failed preparation must not open a misleading conversation');
 await assert.rejects(launchAssistant({},'workspace-a','task'),/缺少原生/);
});
