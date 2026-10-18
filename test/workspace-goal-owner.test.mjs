import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {openStore} from '../server/store.mjs';
import {createRuntime} from '../server/runtime.mjs';
const actor={subject:'owner',workspaceId:'synthetic-workspace'};
const input=()=>({title:'Investigate the reviewed material',description:'Draft only; do not execute',requestId:'new-goal'});
async function fixture(t){const directory=await fs.mkdtemp('/tmp/workspace-goal-owner-'),store=await openStore(directory);const runtime=await createRuntime({store,provider:{kind:'synthetic',configured:false,businessAgentRecipientFingerprint:'synthetic'},autoStart:false});t.after(async()=>{await runtime.close();await store.close();await fs.rm(directory,{recursive:true,force:true});});return {store,runtime};}
test('normal Goal creation makes an owned ordinary conversation without model activity or a preseeded owner',async t=>{
 const {runtime,store}=await fixture(t);const {goal}=await runtime.createGoal({...input(),actor:{subject:'forged'},createdBy:'forged'},{actor});
 const conversation=store.read().conversations.find(c=>c.id===goal.conversationId);assert.equal(conversation.createdBy,actor.subject);assert.equal(conversation.workspaceId,actor.workspaceId);assert.equal(conversation.businessAgentOwner,undefined);assert.equal(goal.status,'draft');assert.equal(goal.revision,0);assert.deepEqual(store.read().runs,[]);assert.equal(store.read().conversations.length,1);
 assert.equal((await runtime.createGoal(input(),{actor})).duplicate,true);
 await assert.rejects(runtime.createGoal(input(),{actor:{...actor,subject:'other'}}),{code:'NOT_FOUND'});
});
test('Goal may use its existing normal owner conversation but cannot adopt another owner or business chat',async t=>{
 const {runtime,store}=await fixture(t),ordinary=await runtime.createConversation({title:'Ordinary owner'},{...actor});
 const normal=await runtime.createGoal({...input(),conversationId:ordinary.conversation.id},{actor});assert.equal(normal.goal.conversationId,ordinary.conversation.id);
 const other=await runtime.createConversation({title:'Other'},{...actor,subject:'other'});
 await assert.rejects(runtime.createGoal({...input(),requestId:'foreign',conversationId:other.conversation.id},{actor}),{code:'NOT_FOUND'});
 const business=await runtime.createConversation({title:'Business'},{...actor},{businessAgentOwner:actor});
 await assert.rejects(runtime.createGoal({...input(),requestId:'business',conversationId:business.conversation.id},{actor}),{code:'BUSINESS_AGENT_CONVERSATION_ONLY'});
 assert.equal(store.read().goals.length,1);assert.equal(store.read().runs.length,0);
});
test('existing trusted service callers without an HTTP actor retain the original createGoal path',async t=>{
 const {runtime,store}=await fixture(t);const {goal}=await runtime.createGoal(input());assert.equal(goal.status,'draft');assert.equal(store.read().conversations[0].createdBy,undefined);assert.equal((await runtime.createGoal(input())).duplicate,true);assert.equal(store.read().runs.length,0);
});
