import {safePublicUrl} from '../upstream/src/schema.js';
const API='https://api.apify.com/v2';
const ACTOR='apify~website-content-crawler';
const id=value=>typeof value==='string'&&/^[A-Za-z0-9]{10,40}$/.test(value);
async function boundedJson(response){
  const parts=[];let size=0;
  for await(const part of response.body){size+=part.length;if(size>5*1024*1024)throw Error('APIFY_RESPONSE_TOO_LARGE');parts.push(part);}
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
/** The native tool runs an actual Actor. Missing credentials never become a web_fetch success. */
export async function collectWithApify(args,{token,fetchImpl=fetch,signal,maxChargeUsd=1}={}){
  if(!token)return {status:'blocked',reason:'APIFY_NOT_CONFIGURED',requiredSecret:'APIFY_TOKEN',provider:'apify'};
  const request=async (path,body)=>{
    const response=await fetchImpl(API+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...body?{'Content-Type':'application/json'}:{}},...body?{body:JSON.stringify(body)}:{},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)});
    if(!response.ok)return {httpStatus:response.status};
    return {data:await boundedJson(response)};
  };
  try{
    signal?.throwIfAborted();
    if(args.action==='start'){
      if(!safePublicUrl(args.url)||!Number.isInteger(args.maxPages??8)||(args.maxPages??8)<1||(args.maxPages??8)>30)return {status:'blocked',reason:'APIFY_INPUT_INVALID',provider:'apify'};
      const query=new URLSearchParams({timeout:'180',memory:'1024',maxTotalChargeUsd:String(Math.min(5,Math.max(0.01,Number.isFinite(maxChargeUsd)?maxChargeUsd:1)))});
      const body={startUrls:[{url:args.url}],maxCrawlPages:args.maxPages??8,maxConcurrency:2,maxCrawlDepth:3,saveHtml:true,saveMarkdown:true,saveScreenshots:false,respectRobotsTxtFile:true};
      const result=await request('/acts/'+ACTOR+'/runs?'+query,body);
      if(result.httpStatus)return {status:'failed',provider:'apify',reason:'APIFY_HTTP_ERROR',httpStatus:result.httpStatus};
      const run=result.data.data;
      return {status:'running',provider:'apify',actor:ACTOR,runId:run.id,datasetId:run.defaultDatasetId,sourceUrl:args.url,maxPages:body.maxCrawlPages,maxChargeUsd:Number(query.get('maxTotalChargeUsd'))};
    }
    if(args.action!=='status'||!id(args.runId))return {status:'blocked',reason:'APIFY_INPUT_INVALID',provider:'apify'};
    const result=await request('/actor-runs/'+args.runId);
    if(result.httpStatus)return {status:'failed',provider:'apify',reason:'APIFY_HTTP_ERROR',httpStatus:result.httpStatus};
    const run=result.data.data;
    if(run.actId!=='aYG0l9s7dbB7j3gbS')return {status:'blocked',reason:'UNEXPECTED_APIFY_ACTOR',provider:'apify'};
    if(['READY','RUNNING'].includes(run.status))return {status:'running',provider:'apify',runId:run.id,actorStatus:run.status};
    if(run.status!=='SUCCEEDED')return {status:'failed',provider:'apify',runId:run.id,actorStatus:run.status};
    if(!id(run.defaultDatasetId))return {status:'failed',provider:'apify',reason:'APIFY_DATASET_INVALID'};
    const dataset=await request('/datasets/'+run.defaultDatasetId+'/items?clean=true&format=json&limit=30');
    if(dataset.httpStatus)return {status:'failed',provider:'apify',reason:'APIFY_HTTP_ERROR',httpStatus:dataset.httpStatus};
    const items=dataset.data;
    if(!Array.isArray(items))throw Error('APIFY_DATASET_INVALID');
    return {status:'collected',provider:'apify',actor:ACTOR,runId:run.id,datasetId:run.defaultDatasetId,finishedAt:run.finishedAt,items};
  }catch(error){signal?.throwIfAborted();return {status:'failed',provider:'apify',reason:['APIFY_RESPONSE_TOO_LARGE','APIFY_DATASET_INVALID'].includes(error.message)?error.message:'APIFY_REQUEST_FAILED'};}
}

export async function collectSiteInSession(ctx,args,exec,config={}){
  const result=await collectWithApify(args,{token:process.env.APIFY_TOKEN||process.env.APIFY_TOKEN_1,signal:exec.signal,maxChargeUsd:config.apifyMaxChargeUsd??1});
  if(result.status!=='collected')return result;
  const attachments=ctx.get?.('attachments');
  const dataset=attachments?await attachments.saveFile({data:Buffer.from(JSON.stringify(result,null,2)),name:'apify-'+result.runId+'.json'}):undefined;
  const items=result.items.map(item=>({url:item.url??null,title:item.metadata?.title??item.title??null,markdown:String(item.markdown??item.text??'').slice(0,6500),images:[...new Set([...String(item.html??'').matchAll(/<img\b[^>]*?\s(?:src|data-src)=["'](https:\/\/[^"']+)["']/gi)].map(m=>m[1].replaceAll('&amp;','&')).filter(safePublicUrl))].slice(0,30)}));
  return {...result,items,untrustedSourceContent:true,excerpted:true,...dataset?{dataset}: {}};
}
