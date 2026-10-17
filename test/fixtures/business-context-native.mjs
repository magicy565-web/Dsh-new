// Locked original SDK only; synthetic entries, no model/provider/credentials.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {workspaceOmpPaths} from '../../server/workspace-omp-runtime.mjs';
const root=workspaceOmpPaths({}).packageRoot;
const {SessionManager}=await import(pathToFileURL(root+'/src/session/session-manager.ts').href);
const {buildSessionContext}=await import(pathToFileURL(root+'/src/session/session-context.ts').href);
const {resolveSessionLeafId}=await import(pathToFileURL(root+'/src/session/session-entries.ts').href);
const usage={purpose:'title',role:'default',api:'openai-completions',provider:'explicit-synthetic',model:'finite',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop'};
const user=text=>({role:'user',content:text,timestamp:Date.now()});
const manager=SessionManager.inMemory('/tmp');
manager.appendMessage(user('Synthetic A'));const reset=manager.appendResetBoundary();
const current=manager.appendMessage({role:'toolResult',toolCallId:'synthetic-call',toolName:'workspace_marketplace_order',content:[{type:'text',text:'Synthetic current B requiring source validation'}],details:{synthetic:true},isError:false,timestamp:Date.now()});
manager.appendModelUsage(usage,{sessionId:manager.getSessionId(),parentId:reset});
const entries=manager.getEntries(),last=entries.at(-1),native=buildSessionContext(entries);
assert.equal(last.type,'model_usage');assert.equal(last.parentId,reset);assert.equal(last.activeLeafId,current);assert.equal(resolveSessionLeafId(entries),current);assert.equal(native.messages.some(m=>m.toolName==='workspace_marketplace_order'),true);

const {loadNativeBusinessParser,nativeBusinessMessages}=await import('../../server/workspace-omp-business-context.mjs');
const parser=await loadNativeBusinessParser(root),cases=[];
function record(name,m,rows=m.getEntries(),leafId){
 const raw=JSON.stringify(rows),oracle=buildSessionContext(structuredClone(rows),leafId).messages;
 const supported=oracle.every(x=>['user','assistant','toolResult'].includes(x.role));
 if(supported)assert.deepEqual(nativeBusinessMessages(structuredClone(rows),parser,{leafId}),oracle);
 else assert.throws(()=>nativeBusinessMessages(structuredClone(rows),parser,{leafId}),e=>e.code==='NATIVE_BUSINESS_CONTEXT_UNSUPPORTED');
 assert.equal(JSON.stringify(rows),raw);
 cases.push({name,entries:rows,oracle,supported,...(leafId===undefined?{}:{leafId})});
}
record('late-usage-captured-active-message',manager);
const dangling=structuredClone(entries);dangling.at(-1).activeLeafId='rolled-back-captured-leaf';record('usage-native-fallback',manager,dangling);
const ordinary=SessionManager.inMemory('/tmp');const oa=ordinary.appendMessage(user('Ordinary active message'));ordinary.appendModelUsage(usage,{sessionId:ordinary.getSessionId(),parentId:oa});record('ordinary-usage-self-leaf',ordinary);
const cleared=SessionManager.inMemory('/tmp');const ca=cleared.appendMessage(user('Not selected by null leaf'));cleared.resetLeaf();cleared.appendModelUsage(usage,{sessionId:cleared.getSessionId(),parentId:ca});record('usage-null-active-leaf',cleared);
const branch=SessionManager.inMemory('/tmp');const ba=branch.appendMessage(user('Common root'));branch.appendResetBoundary();branch.appendMessage(user('Abandoned reset branch'));branch.branch(ba);branch.appendMessage(user('Current selected branch'));record('branch-switch-away-from-reset',branch);
const live=SessionManager.inMemory('/tmp');const la=live.appendMessage(user('Live root'));live.appendResetBoundary();live.appendMessage(user('Live current branch'));live.branch(la);
record('live-inmemory-branch-switch',live,live.getEntries(),live.getLeafId());assert.deepEqual(cases.at(-1).oracle,live.buildSessionContext().messages);
live.resetLeaf();record('live-inmemory-null-leaf',live,live.getEntries(),live.getLeafId());assert.deepEqual(cases.at(-1).oracle,live.buildSessionContext().messages);
for(const placement of ['before','after'])for(const kind of ['notes','branch-summary','compaction','custom-message']){
 const m=SessionManager.inMemory('/tmp');const a=m.appendMessage(user('Synthetic old source'));
 if(placement==='after')m.appendResetBoundary();
 if(kind==='notes')m.appendCustomEntry('experimental_context_notes',{version:1,text:'Synthetic notebook without original source proof'});
 if(kind==='branch-summary')m.branchWithSummary(m.getLeafId(),'Synthetic branch summary without original source proof');
 if(kind==='compaction')m.appendCompaction('Synthetic compacted history',undefined,a,100);
 if(kind==='custom-message')m.appendCustomMessageEntry('synthetic-unproven','Synthetic private custom text',false);
 if(placement==='before')m.appendResetBoundary();
 m.appendMessage(user('New user question'));
 record(kind+'-'+placement+'-reset',m);
}
console.log(JSON.stringify({constructedByOriginalManager:true,originalSdkVersion:'18.10.4',cases}));
