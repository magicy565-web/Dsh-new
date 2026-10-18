// Actual TypeScript/React Brain components and api() over loopback HTTP.
// Synthetic HTTP responses test client lifecycle only, not Host authorization,
// full App bundling, layout/browser rendering or an OMP/model lifecycle.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {JSDOM} from 'jsdom';
import {installBrowserPlatform} from './fixtures/browser-platform.mjs';
const require=createRequire(import.meta.url),repo=fileURLToPath(new URL('..',import.meta.url));
async function until(check,label){for(let n=0;n<120;n++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out: '+label);}

test('actual Brain page keeps its conversation and never resurrects an older response after a newer source refusal',async t=>{
 const out=await fs.mkdtemp(path.join(tmpdir(),'brain-page-client-'));
 t.after(()=>fs.rm(out,{recursive:true,force:true}));
 // Compile the original component subtree with the project's actual TypeScript.
 // CommonJS is only the test execution format; production source is unchanged.
 const compile=spawnSync(process.execPath,[require.resolve('typescript/bin/tsc'),'--module','CommonJS','--target','ES2022','--jsx','react-jsx','--moduleResolution','Node10','--ignoreDeprecations','6.0','--skipLibCheck','--strict','--rootDir',path.join(repo,'src'),'--outDir',out,path.join(repo,'src/experience/BusinessBrainHome.tsx'),path.join(repo,'src/vite-env.d.ts')],{encoding:'utf8'});
 assert.equal(compile.status,0,compile.stdout+compile.stderr);
 await fs.writeFile(path.join(out,'package.json'),'{"type":"commonjs"}');
 await fs.symlink(path.join(repo,'node_modules'),path.join(out,'node_modules'),'dir');
 await fs.copyFile(path.join(repo,'src/experience/business-brain-home.css'),path.join(out,'experience/business-brain-home.css'));
 const requests=[],server=createServer((req,res)=>{requests.push({url:req.url,res});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:origin+'/home',pretendToBeVisual:true});const window=dom.window;
 installBrowserPlatform(window);const polls=new Map();let timerId=0;
 window.setInterval=callback=>{polls.set(++timerId,callback);return timerId;};window.clearInterval=id=>polls.delete(id);
 const originalGlobals=Object.fromEntries(['window','document','navigator','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),realFetch=globalThis.fetch;
 const consumptions=[];
 Object.defineProperties(globalThis,{IS_REACT_ACT_ENVIRONMENT:{configurable:true,value:true},window:{configurable:true,value:window},document:{configurable:true,value:window.document},navigator:{configurable:true,value:window.navigator},HTMLElement:{configurable:true,value:window.HTMLElement},fetch:{configurable:true,value:async(url,options)=>{const target=new URL(url,origin);assert.equal(target.origin,origin);const consumed=Promise.withResolvers();consumptions.push(consumed);const response=await realFetch(target,options);const json=response.json.bind(response);response.json=async()=>{try{return await json();}finally{consumed.resolve();}};return response;}}});
 const oldCss=require.extensions['.css'];require.extensions['.css']=()=>{}; // JSDOM has no CSS layout.
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),{BusinessBrainHome}=require(path.join(out,'experience/BusinessBrainHome.js'));
 const root=createRoot(window.document.getElementById('root'));let continued=[],mounted=true;
 t.after(async()=>{if(mounted)await act(async()=>root.unmount());for(const request of requests)if(!request.res.writableEnded)request.res.destroy();await new Promise(r=>{server.close(r);server.closeAllConnections();});window.close();if(oldCss)require.extensions['.css']=oldCss;else delete require.extensions['.css'];for(const [key,value]of Object.entries(originalGlobals))if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];});
 const first={id:'conversation-first',createdAt:'2026-10-17T00:00:00Z'},second={id:'conversation-newer',createdAt:'2026-10-18T00:00:00Z'},goal={id:'reviewed-goal',title:'Existing reviewed Goal',status:'draft',createdAt:first.createdAt};
 const card={id:'synthetic-card',priority:90,title:'SYNTHETIC source-backed suggestion',reason:'SYNTHETIC private fact 120',evidenceIds:[],executable:false,businessGoalVerified:true,action:{kind:'analysis',goalId:goal.id,decisionId:'synthetic-decision'},decisionDraft:{status:'persisted',revision:1,goalId:goal.id,businessGoalVerified:true,problem:'SYNTHETIC private fact 120',sourceRefs:[],hypotheses:[],options:[],recommendation:{optionId:'observe',rationale:'Verify the source',verification:{metricId:'next-window',observationDays:7,stopConditions:[]}}}};
 const payload={data:{cards:[card],coldStart:false,gaps:[],diagnosisStatus:'measured'}};
 const reply=(request,status,body)=>{request.res.writeHead(status,{'content-type':'application/json'});request.res.end(JSON.stringify(body));};
 const render=(conversations,key='initial-page')=>act(async()=>root.render(React.createElement(BusinessBrainHome,{key,data:{conversations,goals:[goal]},loading:false,readOnly:false,onStartAnalysis:()=>{},onStartGoal:()=>{},onOpenGoal:()=>{},onContinueConversation:id=>continued.push(id),onNavigate:()=>{}})));
 // Wait for the original api() to consume the actual HTTP JSON, then let its
 // promise continuations run and React flush. This is an observed completion
 // barrier, not a fixed sleep that might assert before a stale reply arrives.
 const deliver=async(index,status,body)=>act(async()=>{let timeout;try{reply(requests[index],status,body);await Promise.race([consumptions[index].promise,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('HTTP JSON not consumed: '+index)),5000);})]);await new Promise(resolve=>setImmediate(resolve));}finally{clearTimeout(timeout);}});
 const tick=async()=>act(async()=>{const poll=[...polls.values()][0];assert.equal(typeof poll,'function');poll();});
 const button=text=>[...window.document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
 await render([first]);await until(()=>requests.length===1,'first original api GET');assert.equal(requests[0].url,'/api/conversations/'+first.id+'/brain/brief');await deliver(0,200,payload);
 assert.ok(button('为什么？'),'persisted Decision card');await act(async()=>button('为什么？').click());assert.ok(button('在原会话继续'));await act(async()=>button('在原会话继续').click());assert.deepEqual(continued,[first.id]);
 await render([first,second]);assert.equal(consumptions.length,1,'A newer unrelated conversation does not retarget the page');
 // A completed older poll must not finish the latest request's loading state.
 await tick();await until(()=>requests.length===2,'older held poll');await tick();await until(()=>requests.length===3,'newer held poll');
 await deliver(1,200,payload);const latestLoadingRetained=window.document.body.textContent.includes('正在刷新经营信号');
 // A newer denial must dominate the earlier still-in-flight success.
 await tick();await until(()=>requests.length===4,'newest poll');assert.ok(requests.every(r=>r.url==='/api/conversations/'+first.id+'/brain/brief'));
 await deliver(3,409,{error:{code:'BRAIN_SOURCE_CHANGED',message:'Synthetic source authorization changed'}});
 assert.ok(window.document.body.textContent.includes('资料版本或会话授权已变更'));assert.equal(window.document.querySelector('[role="dialog"]'),null);assert.ok(!window.document.body.textContent.includes('SYNTHETIC private fact 120'));
 await deliver(2,200,payload);
 assert.ok(window.document.body.textContent.includes('资料版本或会话授权已变更'),'An older success cannot replace a newer refusal');assert.ok(!window.document.body.textContent.includes('SYNTHETIC private fact 120'),'Stale private card stays cleared');assert.ok(latestLoadingRetained,'Older finally cannot end latest request loading');
 // Navigation/remount chooses the next page's conversation explicitly; the
 // previous page's in-flight response must never fill that new page.
 await tick();await until(()=>requests.length===5,'old page request before navigation');
 await render([second],'next-page');await until(()=>requests.length===6,'new page selects its conversation');assert.equal(requests[5].url,'/api/conversations/'+second.id+'/brain/brief');
 const fresh={data:{cards:[{...card,title:'SYNTHETIC new page suggestion',reason:'New page current value',decisionDraft:undefined}],coldStart:false,gaps:[],diagnosisStatus:'measured'}};
 await deliver(5,200,fresh);assert.ok(window.document.body.textContent.includes('SYNTHETIC new page suggestion'));await deliver(4,200,payload);assert.ok(!window.document.body.textContent.includes('SYNTHETIC private fact 120'));assert.ok(window.document.body.textContent.includes('SYNTHETIC new page suggestion'));
 // Deleting the displayed conversation cancels its effect even when an older
 // HTTP read is still returning. No automatic selection of another chat.
 await tick();await until(()=>requests.length===7,'request before conversation removal');await render([],'next-page');assert.equal(polls.size,0);await deliver(6,200,payload);assert.ok(!window.document.body.textContent.includes('SYNTHETIC private fact 120'));
 await render([first],'last-page');await until(()=>requests.length===8,'request before unmount');await act(async()=>root.unmount());mounted=false;await deliver(7,200,payload);assert.equal(window.document.getElementById('root').textContent,'');assert.equal(polls.size,0);assert.deepEqual(continued,[first.id]);
});
