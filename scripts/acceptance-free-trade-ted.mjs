#!/usr/bin/env node
// Explicit one-request anonymous TED acceptance through original OMP. The model
// is finite synthetic; this is NOT paid/live reasoning or business qualification.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {workspaceOmpPaths,verifyWorkspaceOmpRuntime} from '../server/workspace-omp-runtime.mjs';
const filename=fileURLToPath(import.meta.url),paths=workspaceOmpPaths({});
if(process.argv.includes('--live-child')){
 const {runLocalFactorySession}=await import('./workspace-omp-local.mjs');
 const {createTenderClient}=await import('../plugins/workspace-free-trade/src/free-trade.mjs');
 const root=await fs.mkdtemp('/tmp/free-trade-ted-live-');let requests=0,httpStatus=null;const started=Date.now();
 try{
  await fs.mkdir(root+'/out',{mode:0o700});await fs.mkdir(root+'/run');
  const tenders=createTenderClient({timeoutMs:15000,fetchImpl:async(url,options)=>{
    if(++requests!==1||new URL(url).origin!=='https://api.ted.europa.eu'||Object.keys(options.headers).some(key=>key.toLowerCase()==='authorization'))throw Error('ANONYMOUS_SINGLE_REQUEST_REQUIRED');
    const response=await fetch(url,options);httpStatus=response.status;return response;
  }});
  const result=await runLocalFactorySession({directory:root+'/run',paths,configuration:{providerId:'explicit-ted-acceptance-finite',model:'finite',baseUrl:'https://synthetic.invalid'},
   syntheticResponses:[{tool:'workspace_tender_search',arguments:{provider:'ted',query:'publication-date>=20260101',page:1,limit:1},expectedToolNames:['workspace_free_trade_status','workspace_tender_search','workspace_erpnext_read','workspace_erpnext_prepare_quotation']},{text:'Finite synthetic completion; inspect the actual TED receipt for API status. No reasoning or business outcome verified.'}],
   options:{publicOnly:true,inputs:[],outputDirectory:root+'/out',sessionFile:root+'/out/ted.jsonl',pluginConfig:'config.free-trade.json',task:'Query one public TED page only; no credentials, contact or bidding.'}},{publicTenderClient:tenders});
  const entries=(await fs.readFile(root+'/out/ted.jsonl','utf8')).trim().split('\n').map(JSON.parse);
  const receipt=entries.find(e=>e.message?.toolName==='workspace_tender_search')?.message.details;
  console.log(JSON.stringify({kind:'real-anonymous-ted-api-through-native-omp-with-finite-model',success:receipt?.status==='ok',apiRequests:requests,httpStatus,
   stage:receipt?.status==='ok'?'completed':result.status==='stopped'?'native-host':'ted-network-or-api',reason:receipt?.reason||result.reason||null,
   elapsedMs:Date.now()-started,returned:receipt?.items?.length??0,notices:(receipt?.items||[]).map(row=>({noticeId:row.noticeId,sourceUrl:row.sourceUrl,openForBids:row.openForBids,eligibility:row.eligibility})),
   pagination:receipt?.pagination??null,retrievedAt:receipt?.retrievedAt??null,credentialsUsed:false,realModelRequests:0,modelEvidence:'finite-synthetic-only',samLiveTested:false,erpLiveTested:false}));
  if(receipt?.status!=='ok')process.exitCode=2;
 }finally{await fs.rm(root,{recursive:true,force:true});}
}else if(process.argv.includes('--live')){
 await verifyWorkspaceOmpRuntime(paths);
 const env={PATH:path.dirname(paths.bun)+':/usr/bin:/bin',HOME:'/tmp',NO_COLOR:'1'};
 for(const key of ['HTTP_PROXY','HTTPS_PROXY','NO_PROXY','NODE_EXTRA_CA_CERTS'])if(process.env[key])env[key]=process.env[key];
 if(!env.NODE_EXTRA_CA_CERTS&&process.env.CODEX_PROXY_CERT)env.NODE_EXTRA_CA_CERTS=process.env.CODEX_PROXY_CERT;
 const child=spawn(paths.bun,[filename,'--live-child'],{env,cwd:path.resolve('.'),stdio:['ignore','inherit','ignore']});
 const timer=setTimeout(()=>child.kill('SIGKILL'),60000);const code=await new Promise(resolve=>child.once('close',resolve));clearTimeout(timer);process.exitCode=code===0?0:2;
}else {console.log('Explicit anonymous one-page TED read only: node scripts/acceptance-free-trade-ted.mjs --live. No paid model or SAM/ERP call.');}
