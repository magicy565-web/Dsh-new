// Actual pinned OMP loader/Session/tools; finite synthetic model and tender HTTP.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {runLocalFactorySession} from '../../scripts/workspace-omp-local.mjs';
import {workspaceOmpPaths} from '../../server/workspace-omp-runtime.mjs';
import {createTenderClient} from '../../plugins/workspace-free-trade/src/free-trade.mjs';
const root=await fs.mkdtemp('/tmp/free-trade-native-'),plugins=root+'/plugins',paths=workspaceOmpPaths({});
const model={providerId:'explicit-free-trade-finite',model:'finite',baseUrl:'https://synthetic.invalid'};
const names=['workspace_free_trade_status','workspace_tender_search','workspace_erpnext_read','workspace_erpnext_prepare_quotation'];
let id,round=0,tenderCalls=0,forbiddenNetwork=0;const rounds=[];
globalThis.fetch=async()=>{forbiddenNetwork++;throw Error('NO_NETWORK_FALLBACK');};
const tenderClient=createTenderClient({fetchImpl:async(url,options)=>{
  assert.equal(new URL(url).origin,'https://api.ted.europa.eu');assert.equal(options.method,'POST');tenderCalls++;
  return new Response(JSON.stringify({notices:[{'publication-number':'123456-2026','notice-title':{eng:'Explicit synthetic textile notice'},'notice-type':'cn-standard'}],totalNoticeCount:1}),{headers:{'content-type':'application/json'}});
}});
const options={publicOnly:true,inputs:[],outputDirectory:root+'/out',sessionFile:root+'/conversation.jsonl',pluginRoot:plugins};
const tool=(name,args,expected=names)=>({tool:name,arguments:args,expectedToolNames:expected}),stop={text:'Explicit synthetic model answer, not real reasoning.'};
const quote={company:'Synthetic Factory',customer:'Synthetic Buyer',currency:'USD',transactionDate:'2026-10-16',validTill:'2026-10-30',items:[{itemCode:'FAB-1',qty:5,rate:2,uom:'Meter'}]};
async function config(entries){await fs.writeFile(plugins+'/config.json',JSON.stringify({extensions:entries.map(x=>'./'+x),disabledExtensions:[]}));}
async function turn(responses,changes={}){
  const directory=root+'/run-'+round++;await fs.mkdir(directory);
  const result=await runLocalFactorySession({directory,paths,configuration:model,syntheticResponses:responses,options:{...options,...changes,task:'Explicit finite native free-trade acceptance; synthetic material only.'}},{publicTenderClient:tenderClient});
  if(!changes.sessionFile&&result.status!=='stopped'){id ||= result.localSession.id;assert.equal(result.localSession.id,id);}
  rounds.push({status:result.status,tools:result.toolReceipts.map(x=>x.tool),modelCalls:result.modelRequests});return result;
}
async function receipts(file=options.sessionFile){return (await fs.readFile(file,'utf8')).trim().split('\n').map(JSON.parse).filter(e=>e.message?.role==='toolResult').map(e=>e.message);}
try{
 await fs.mkdir(plugins);await fs.mkdir(root+'/out');
 for(const name of ['workspace-free-trade','workspace-local-materials','workspace-plugin-info'])await fs.cp(path.resolve('plugins',name),plugins+'/'+name,{recursive:true});
 await config(['workspace-free-trade']);
 let result=await turn([tool('workspace_free_trade_status',{}),stop]);assert.equal(result.status,'completed-local-turn',JSON.stringify(result));
 let receipt=(await receipts()).at(-1).details;assert.equal(receipt.mode,'public-only');assert.equal(receipt.erpnext,'unconfigured');assert.equal(receipt.tenderSources.sam,'unconfigured');
 result=await turn([tool('workspace_tender_search',{provider:'ted',query:'classification-cpv=19000000',limit:1}),stop]);assert.equal(result.status,'completed-local-turn',JSON.stringify(result));
 receipt=(await receipts()).at(-1).details;assert.equal(receipt.items[0].noticeId,'123456-2026');assert.equal(receipt.items[0].openForBids,null);
 result=await turn([tool('workspace_erpnext_prepare_quotation',quote),stop]);assert.equal(result.status,'completed-local-turn',JSON.stringify(result));
 receipt=(await receipts()).at(-1);assert.equal(receipt.isError,false,JSON.stringify(receipt));assert.equal(receipt.details.persisted,false);assert.equal(receipt.details.humanReviewed,false);
 result=await turn([tool('workspace_tender_search',{provider:'sam',postedFrom:'2026-10-01',postedTo:'2026-10-16',limit:1}),stop]);assert.equal(result.status,'completed-local-turn');
 receipt=(await receipts()).at(-1);assert.equal(receipt.isError,true);assert.equal(receipt.details.reason,'SAM_API_KEY_REQUIRED');
 result=await turn([tool('workspace_erpnext_read',{doctype:'Quotation',name:'Q-SYNTHETIC',fields:['currency']}),stop]);assert.equal(result.status,'completed-local-turn');
 receipt=(await receipts()).at(-1);assert.equal(receipt.isError,true);assert.equal(receipt.details.status,'unconfigured');
 await config(['workspace-free-trade','workspace-local-materials','workspace-plugin-info']);
 const combined=[...names,'write','workspace_factory_capabilities','workspace_factory_rfq_requirements','workspace_factory_match_prepare','workspace_plugin_info'];
 result=await turn([tool('workspace_plugin_info',{},combined),stop]);assert.equal(result.status,'completed-local-turn',JSON.stringify(result));
 result=await turn([{...stop,expectedToolNames:[]}],{disabledPlugins:['workspace-free-trade','workspace-local-materials','workspace-plugin-info']});assert.equal(result.status,'completed-local-turn');
 await config(['workspace-free-trade']);result=await turn([tool('workspace_free_trade_status',{}),stop]);assert.equal(result.status,'completed-local-turn');
 // Explicit public classification cannot inherit a private local-input Session.
 await fs.writeFile(root+'/private.txt','Explicit synthetic private product term.');await config(['workspace-free-trade','workspace-local-materials']);
 const privateNames=[...names,'read','write','workspace_factory_capabilities','workspace_factory_rfq_requirements','workspace_factory_match_prepare'];
 const privateFile=root+'/private-context.jsonl';
 result=await turn([tool('read',{path:'input-1'},privateNames),tool('workspace_tender_search',{provider:'ted',query:'private source text must be withheld'},privateNames),stop],{publicOnly:false,inputs:[root+'/private.txt'],sessionFile:privateFile});
 assert.equal(result.status,'completed-local-turn',JSON.stringify(result));receipt=(await receipts(privateFile)).at(-1);assert.equal(receipt.isError,true);assert.equal(receipt.details.reason,'ORIGINAL_REVIEWED_HOST_REQUIRED');
 result=await turn([stop],{sessionFile:privateFile});assert.equal(result.status,'stopped');assert.equal(result.modelRequests,0);
 await config([]);await fs.rm(plugins+'/workspace-free-trade',{recursive:true});
 result=await turn([{...stop,expectedToolNames:[]}]);assert.equal(result.status,'completed-local-turn',JSON.stringify(result));
 assert.equal(tenderCalls,1);assert.equal(forbiddenNetwork,0);
 console.log(JSON.stringify({passed:true,nodeHostModel:'synthetic-only',nativeSdk:'18.10.4',publicOnlyDefault:true,originalSdkSchemasAccepted:true,
  unpersistedQuote:true,samAndErpUnconfigured:true,samePublicSession:true,coexistence:true,disableRestartUninstall:true,privateLocalOutboundBlocked:true,privateToPublicResumeBlocked:true,
  mockTenderRequests:tenderCalls,realTenderRequests:0,realModelRequests:0,rounds}));
}finally{await fs.rm(root,{recursive:true,force:true});}
