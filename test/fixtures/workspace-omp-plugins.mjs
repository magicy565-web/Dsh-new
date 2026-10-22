// Real original native loader, Session and filesystem executors; finite model
// HTTP only. No ambient keys and no provider/network fallback.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {expectedPluginIds} from './workspace-plugin-inventory.mjs';
import {supplyReviewedFreeTradePeer} from './reviewed-free-trade-peer.mjs';
import {runLocalFactorySession} from '../../scripts/workspace-omp-local.mjs';
import {loadWorkspaceOmpSdk} from '../../server/workspace-omp-session.mjs';
import {workspaceOmpPaths} from '../../server/workspace-omp-runtime.mjs';
import {projectPlugins} from '../../server/workspace-plugin-config.mjs';
import {acceptanceConfiguration} from '../../server/deepseek-acceptance-policy.mjs';
globalThis.fetch=async()=>{throw Error('REAL_NETWORK_FORBIDDEN');};
const root=await fs.mkdtemp('/tmp/omp-independent-plugins-'),plugins=root+'/plugins',paths=workspaceOmpPaths({});
const configuration=acceptanceConfiguration({DEEPSEEK_API_KEY:'explicit-offline-unused'});
const hash=b=>createHash('sha256').update(b).digest('hex');
const local='workspace-local-materials',info='workspace-plugin-info';
const localNames=['read','write','workspace_factory_capabilities','workspace_factory_rfq_requirements','workspace_factory_match_prepare'];
let sessionId,requests=0,round=0;const results=[],loaded=[];
function response(body,delta,finish){const frame={id:'finite-plugin-test',model:body.model,choices:[{index:0,delta:{role:'assistant',...delta},finish_reason:null}]};
  const end={...frame,choices:[{index:0,delta:{},finish_reason:finish}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}};
  return new Response('data: '+JSON.stringify(frame)+'\n\ndata: '+JSON.stringify(end)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
async function config(disabled){await fs.writeFile(plugins+'/config.json',JSON.stringify({extensions:['./'+local,'./'+info],disabledExtensions:disabled.map(n=>'extension-module:'+n)}));}
async function turn(label,expectedTools,specs,{disabledPlugins=[],noPlugins=false,save}={}){
  const directory=root+'/round-'+(++round);await fs.mkdir(directory);let index=0;
  const result=await runLocalFactorySession({directory,paths,configuration,options:{inputs:[root+'/product.md'],outputDirectory:root+'/out',sessionFile:root+'/conversation.jsonl',
    pluginRoot:plugins,disabledPlugins,noPlugins,task:label}}, {fetchImpl:async request=>{
      requests++;const body=await request.json();assert.deepEqual((body.tools||[]).map(t=>t.function.name).sort(),[...expectedTools].sort());
      const spec=specs[index++];assert.ok(spec,'UNEXPECTED_MODEL_REPLAY');
      if(spec.tool)return response(body,{tool_calls:[{index:0,id:'plugin-round-'+round+'-'+index,type:'function',function:{name:spec.tool,arguments:JSON.stringify(spec.args)}}]},'tool_calls');
      return response(body,{content:spec.text},'stop');
    }});
  assert.equal(index,specs.length);assert.equal(result.status,save?'saved-local-drafts':'completed-local-turn',JSON.stringify(result));
  assert.equal(result.paidModelVerified,false);assert.equal(result.evidenceKind,'official-omp-local-files-mocked-http');assert.equal(result.provider.billingUncertain,false);
  sessionId ||= result.localSession.id;assert.equal(result.localSession.id,sessionId);assert.equal(result.localSession.resumed,round>1);
  if(save){assert.equal(result.saved[0].name,save);assert.equal(result.saved[0].sources[0].sha256,hash(await fs.readFile(root+'/product.md')));assert.equal(hash(await fs.readFile(root+'/out/'+save)),result.saved[0].sha256);}
  const journal=(await fs.readFile(root+'/conversation.jsonl','utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(journal.filter(e=>e.message?.role==='assistant').at(-1).message.stopReason,'stop');
  for(const prior of results)assert.ok(journal.some(e=>e.message?.role==='user'&&JSON.stringify(e.message.content).includes(prior.label)));
  results.push({label,activeTools:expectedTools,status:result.status,toolTrajectory:result.toolReceipts.map(t=>t.tool),modelRequests:index,resumed:result.localSession.resumed,normalStop:true,
    restoredSources:result.revalidatedPriorSources.length,enabled:result.plugins.enabled});return result;
}
try{
  await fs.cp(path.resolve('plugins'),plugins,{recursive:true});await fs.mkdir(root+'/out');await fs.writeFile(root+'/product.md','Synthetic public product: cup 500ml. Capacity and delivery pending.\n');
  // Ambient code and undeclared package hooks must not execute.
  await fs.mkdir(root+'/.omp/extensions',{recursive:true});await fs.writeFile(root+'/.omp/extensions/evil.js',"throw Error('AMBIENT_EXTENSION_EXECUTED');");
  await fs.mkdir(plugins+'/'+local+'/hooks/pre',{recursive:true});await fs.writeFile(plugins+'/'+local+'/hooks/pre/evil.js',"throw Error('UNDECLARED_HOOK_EXECUTED');");
  const found=await projectPlugins({root:plugins});assert.deepEqual(found.installed.map(p=>p.id).sort(),expectedPluginIds);
  // This test explicitly loads every optional package. Supply ERPNext's original
  // reviewed peer from a byte-verified offline package; no registry/install hooks.
  await supplyReviewedFreeTradePeer(root);
  const sdk=await loadWorkspaceOmpSdk(paths.packageRoot);
  for(const p of found.installed){const extensions=await sdk.loadExtensions(p.extensions,root);assert.deepEqual(extensions.errors,[]);
    loaded.push({id:p.id,extensionCount:extensions.extensions.length,toolNames:extensions.extensions.flatMap(e=>[...e.tools.keys()])});}
  await config([info]);
  const first=await turn('Read selected synthetic material and save first.md.',localNames,[{tool:'read',args:{path:'input-1'}},{tool:'write',args:{path:'first.md',content:'Synthetic cup 500ml; capacity and delivery pending.'}},{text:'Saved first.md.'}],{save:'first.md'});
  const firstSha=first.saved[0].sha256;
  await config([local,info]);await turn('Plugin disabled: answer briefly without file tools.',[],[{text:'Conversation remains available; no file tools.'}]);
  await config([info]);const resumed=await turn('Re-enabled: use prior selected source to save second.md.',localNames,[{tool:'write',args:{path:'second.md',content:'Synthetic second draft; source remains selected; delivery pending.'}},{text:'Saved second.md.'}],{save:'second.md'});
  assert.equal(resumed.revalidatedPriorSources.length,1);assert.deepEqual(resumed.toolReceipts.map(t=>t.tool),['write']);
  await config([]);await turn('Coexistence: use the static info tool and confirm.',[...localNames,'workspace_plugin_info'],[{tool:'workspace_plugin_info',args:{}},{text:'Both plugins coexist.'}]);
  await turn('Explicit disable wins over enabled paths.',['workspace_plugin_info'],[{tool:'workspace_plugin_info',args:{}},{text:'Only probe remains.'}],{disabledPlugins:[local]});
  await turn('No plugins override keeps only conversation.',[],[{text:'No plugin tools.'}],{noPlugins:true});
  await fs.writeFile(plugins+'/config.json',JSON.stringify({extensions:['./'+info],disabledExtensions:[]}));
  await fs.rm(plugins+'/'+local,{recursive:true});await turn('Local package uninstalled: only static probe remains.',['workspace_plugin_info'],[{tool:'workspace_plugin_info',args:{}},{text:'No local material capability remains.'}]);
  await fs.writeFile(plugins+'/config.json',JSON.stringify({extensions:[],disabledExtensions:[]}));
  await fs.rm(plugins+'/'+info,{recursive:true});await turn('Both packages uninstalled: conversation still works.',[],[{text:'Conversational Session continues.'}]);
  assert.equal(hash(await fs.readFile(root+'/out/first.md')),firstSha);
  console.log(JSON.stringify({passed:true,evidenceKind:'original-omp-native-loader-and-file-executors-with-finite-mock-http',independentPackagesLoaded:loaded.length,
    outsideRepositoryCopy:true,loaded,rounds:results,actualMockHttpRequests:requests,realProviderRequests:0,newSpendCny:0,sameSessionId:true,
    disabledHasNoFactoryTools:true,uninstalledHasNoFactoryTools:true,ambientAndUndeclaredHooksNotExecuted:true,oldOutputUnchanged:true}));
}finally{await fs.rm(root,{recursive:true,force:true});}
