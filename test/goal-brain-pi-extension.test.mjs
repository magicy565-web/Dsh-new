import test from 'node:test';
import assert from 'node:assert/strict';
import { businessBrainExtension, BRAIN_TOOLS } from '../plugins/workspace-goal-intelligence/src/extension.mjs';

test('Brain extension registers eight model tools only after the Host-owned guard is acknowledged',async()=>{
  const calls={tools:[],handler:null};
  const pi={
    registerTool(tool){calls.tools.push(tool);},
    on(event,handler){if(event==='before_agent_start') calls.handler=handler;return ()=>{};},
  };
  const brain={revalidateReceipt:async()=>true};
  businessBrainExtension({brain,registerContextGuard:({validateReceipt})=>validateReceipt===brain.revalidateReceipt})(pi);
  assert.equal(calls.tools.length,Object.keys(BRAIN_TOOLS).length);
  assert.equal(calls.tools.length,8);
  assert.ok(calls.tools.every(tool=>tool.annotations?.openWorldHint===false));
  const prompt=await calls.handler({messageType:'user',systemPrompt:'base'});
  assert.match(prompt.systemPrompt,/ENTERPRISE BUSINESS BRAIN/);
  assert.match(prompt.systemPrompt,/same Goal\/session/);
});
test('Brain extension refuses to configure when the Host does not register the exact validator',()=>{
  const pi={registerTool(){},on(){return ()=>{};}};
  assert.throws(()=>businessBrainExtension({brain:{revalidateReceipt:()=>true},registerContextGuard:()=>false})(pi),e=>e.code==='BRAIN_CONTEXT_GUARD_REQUIRED');
});
