import test from 'node:test';
import assert from 'node:assert/strict';
import {registerFactoryTools as original} from '../plugins/workspace-procurement/src/factory.mjs';
import {registerFactoryTools as standalone} from '../plugins/workspace-local-materials/src/drafts.mjs';
const register=fn=>{const tools=new Map();fn({registerTool:tool=>tools.set(tool.name,tool)},null,'local-files',{localOnly:true});return tools;};
test('standalone public-only draft subset preserves original outputs and refused authority fields',async()=>{
  const old=register(original),next=register(standalone),signal=new AbortController().signal;
  assert.deepEqual([...next.keys()],[...old.keys()]);
  for(const[name,args]of [['workspace_factory_capabilities',{}],['workspace_factory_rfq_requirements',{rfq:{product:'Synthetic cup',quantity:100}}],
    ['workspace_factory_match_prepare',{rfq:{product:'Synthetic cup'},factoryOffer:{product:'Synthetic cup',spec:'500ml',source:'input-1'}}]]){
    assert.deepEqual(await next.get(name).execute('test',args,signal),await old.get(name).execute('test',args,signal));
  }
  for(const fn of [old,next]){
    await assert.rejects(fn.get('workspace_factory_rfq_requirements').execute('test',{rfq:{product:'cup',unexpected:'untrusted'}},signal),/explicitly supplied/);
    await assert.rejects(fn.get('workspace_factory_match_prepare').execute('test',{rfq:{product:'cup'},factoryOffer:{source:{arbitrary:'object'}}},signal),/explicitly supplied/);
  }
});
