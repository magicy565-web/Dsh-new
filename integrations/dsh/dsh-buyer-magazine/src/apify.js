import {safePublicUrl} from '../upstream/src/schema.js';
const API='https://api.apify.com/v2';
const ACTOR='apify~website-content-crawler';
const MAX_CREDENTIALS=100;
const credentialNames=credentialId=>['APIFY_TOKEN_'+credentialId,'APIFY_TOKEN'+credentialId];
const configuredCredentialName=(credentialId,environment)=>credentialNames(credentialId).find(name=>environment[name]);
/** Presence only: never expose token values, hashes or prefixes to the model. */
export function apifyCredentials(environment=process.env){
  const credentials=[];
  for(let credentialId=1;credentialId<=MAX_CREDENTIALS;credentialId++){
    const name=configuredCredentialName(credentialId,environment);
    if(name)credentials.push({credentialId,name});
  }
  return {status:'listed',provider:'apify',capacity:MAX_CREDENTIALS,credentials,legacyDefaultConfigured:Boolean(environment.APIFY_TOKEN),defaultCredential:environment.APIFY_TOKEN?'APIFY_TOKEN':configuredCredentialName(1,environment)??null};
}
const ACTOR_ID='aYG0l9s7dbB7j3gbS';
const id=value=>typeof value==='string'&&/^[A-Za-z0-9]{10,40}$/.test(value);
async function boundedJson(response){
  const parts=[];let size=0;
  for await(const part of response.body){size+=part.length;if(size>5*1024*1024)throw Error('APIFY_RESPONSE_TOO_LARGE');parts.push(part);}
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
/** The native tool runs an actual Actor. Missing credentials never become a web_fetch success. */
export async function collectWithApify(args,{token,fetchImpl=fetch,signal,maxChargeUsd=1}={}){
  if(!token)return {status:'blocked',reason:'APIFY_NOT_CONFIGURED',requiredSecret:'APIFY_TOKEN',provider:'apify'};
  if(!Number.isFinite(maxChargeUsd)||maxChargeUsd<0.01||maxChargeUsd>5)return {status:'blocked',reason:'APIFY_BUDGET_INVALID',provider:'apify'};
  const request=async (path,body)=>{
    const response=await fetchImpl(API+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...body?{'Content-Type':'application/json'}:{}},...body?{body:JSON.stringify(body)}:{},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)});
    if(!response.ok)return {httpStatus:response.status};
    return {data:await boundedJson(response)};
  };
  let starting=false,record;
  const preflight=async()=>{
    const result=await request('/users/me/limits');
    if(result.httpStatus)return {status:'blocked',provider:'apify',reason:'APIFY_PREFLIGHT_HTTP_ERROR',httpStatus:result.httpStatus};
    const data=result.data?.data,limit=data?.limits?.maxMonthlyUsageUsd,used=data?.current?.monthlyUsageUsd;
    if(!Number.isFinite(limit)||limit<0||!Number.isFinite(used)||used<0)return {status:'blocked',provider:'apify',reason:'APIFY_BUDGET_UNAVAILABLE'};
    const budget={observedAt:new Date().toISOString(),monthlyLimitUsd:limit,monthlyUsedUsd:used,remainingLimitUsd:Math.max(0,limit-used),maxChargeUsd,
      cycleStart:data.monthlyUsageCycle?.startAt??null,cycleEnd:data.monthlyUsageCycle?.endAt??null,scope:'account-limit-headroom-not-reserved-credit'};
    return {status:budget.remainingLimitUsd>=maxChargeUsd?'ready':'blocked',provider:'apify',...budget.remainingLimitUsd<maxChargeUsd?{reason:'APIFY_BUDGET_INSUFFICIENT'}:{},budget};
  };
  try{
    signal?.throwIfAborted();
    if(args.action==='preflight')return await preflight();
    if(args.action==='start'){
      if(!safePublicUrl(args.url)||!Number.isInteger(args.maxPages??8)||(args.maxPages??8)<1||(args.maxPages??8)>30)return {status:'blocked',reason:'APIFY_INPUT_INVALID',provider:'apify'};
      const checked=await preflight();
      if(checked.status!=='ready')return checked;
      const query=new URLSearchParams({timeout:'180',memory:'1024',maxTotalChargeUsd:String(maxChargeUsd)});
      const body={startUrls:[{url:args.url}],maxCrawlPages:args.maxPages??8,maxConcurrency:2,maxCrawlDepth:3,saveHtml:true,saveMarkdown:true,saveScreenshots:false,respectRobotsTxtFile:true};
      starting=true;
      const result=await request('/acts/'+ACTOR+'/runs?'+query,body);
      if(result.httpStatus)return {status:result.httpStatus>=500?'unknown':'failed',provider:'apify',reason:result.httpStatus>=500?'APIFY_START_OUTCOME_UNKNOWN':'APIFY_HTTP_ERROR',httpStatus:result.httpStatus};
      const run=result.data?.data;
      if(!id(run?.id)||!id(run?.defaultDatasetId)||run.actId!==ACTOR_ID)return {status:'unknown',provider:'apify',reason:'APIFY_START_OUTCOME_UNKNOWN'};
      return {status:'running',provider:'apify',actor:ACTOR,runId:run.id,datasetId:run.defaultDatasetId,sourceUrl:args.url,maxPages:body.maxCrawlPages,maxChargeUsd,budget:checked.budget,run};
    }
    if(args.action!=='status'||!id(args.runId))return {status:'blocked',reason:'APIFY_INPUT_INVALID',provider:'apify'};
    const result=await request('/actor-runs/'+args.runId);
    if(result.httpStatus)return {status:'failed',provider:'apify',reason:'APIFY_HTTP_ERROR',httpStatus:result.httpStatus};
    const run=result.data?.data;
    if(run?.id!==args.runId||run.actId!==ACTOR_ID)return {status:'blocked',reason:'UNEXPECTED_APIFY_ACTOR',provider:'apify'};
    record={provider:'apify',actor:ACTOR,runId:run.id,datasetId:run.defaultDatasetId??null,actorStatus:run.status,run};
    if(['READY','RUNNING','TIMING-OUT','ABORTING'].includes(run.status))return {status:'running',...record};
    if(run.status!=='SUCCEEDED')return {status:'failed',...record};
    if(!id(run.defaultDatasetId))return {status:'failed',...record,reason:'APIFY_DATASET_INVALID'};
    const dataset=await request('/datasets/'+run.defaultDatasetId+'/items?clean=true&format=json&limit=30');
    if(dataset.httpStatus)return {status:'failed',...record,reason:'APIFY_HTTP_ERROR',httpStatus:dataset.httpStatus};
    const items=dataset.data;
    if(!Array.isArray(items)||items.some(item=>!item||typeof item!=='object'||Array.isArray(item)))return {status:'failed',...record,reason:'APIFY_DATASET_INVALID'};
    return {status:items.length?'collected':'blocked',...record,...items.length?{}:{reason:'APIFY_DATASET_EMPTY'},finishedAt:run.finishedAt??null,items};
  }catch(error){signal?.throwIfAborted();return {status:starting?'unknown':'failed',provider:'apify',...record,reason:starting?'APIFY_START_OUTCOME_UNKNOWN':error.message==='APIFY_RESPONSE_TOO_LARGE'?error.message:'APIFY_REQUEST_FAILED'};}
}

export async function collectSiteInSession(ctx,args,exec,config={}){
  if(args.credentialId!==undefined&&(!Number.isInteger(args.credentialId)||args.credentialId<1||args.credentialId>MAX_CREDENTIALS))return {status:'blocked',provider:'apify',reason:'APIFY_CREDENTIAL_INVALID'};
  if(args.action==='credentials')return apifyCredentials();
  const credentialId=args.credentialId??(process.env.APIFY_TOKEN?null:1);
  const credentialName=credentialId===null?'APIFY_TOKEN':configuredCredentialName(credentialId,process.env)??credentialNames(credentialId)[0];
  const token=process.env[credentialName];
  if(!token)return {status:'blocked',reason:'APIFY_NOT_CONFIGURED',requiredSecret:credentialName,acceptedSecretNames:credentialId===null?['APIFY_TOKEN']:credentialNames(credentialId),credentialId,credentialName,provider:'apify'};
  const attachments=ctx.get?.('attachments');
  if(token&&!attachments?.saveFile)return {status:'blocked',provider:'apify',reason:'NATIVE_ATTACHMENTS_UNAVAILABLE',credentialId,credentialName};
  const result={...await collectWithApify(args,{token,signal:exec.signal,maxChargeUsd:config.apifyMaxChargeUsd??1}),credentialId,credentialName};
  // Preserve the actual Run response even while running, failed, or empty.
  let dataset;
  if(result.run){
    try{dataset=await attachments.saveFile({data:Buffer.from(JSON.stringify(result,null,2)),name:'apify-'+result.runId+'-'+result.status+'.json'});}
    catch{exec.signal.throwIfAborted();return {...result,status:'blocked',collectionStatus:result.status,reason:'APIFY_EVIDENCE_SAVE_FAILED'};}
  }
  if(result.status!=='collected')return {...result,...dataset?{dataset}:{}};
  const items=result.items.map(item=>({url:item.url??null,title:item.metadata?.title??item.title??null,markdown:String(item.markdown??item.text??'').slice(0,6500),images:[...new Set([...String(item.html??'').matchAll(/<img\b[^>]*?\s(?:src|data-src)=["'](https:\/\/[^"']+)["']/gi)].map(m=>m[1].replaceAll('&amp;','&')).filter(safePublicUrl))].slice(0,30)}));
  return {...result,items,untrustedSourceContent:true,excerpted:true,...dataset?{dataset}: {}};
}
