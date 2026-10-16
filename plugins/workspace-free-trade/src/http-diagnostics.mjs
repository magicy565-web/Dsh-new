// Diagnostic projection only, never a transport or raw HTTP logger. No URL,
// request header, arbitrary response header, body text or remote error is kept.
export const HTTP_DIAGNOSTIC_LIMITS=Object.freeze({bodyBytes:2048,deadlineMs:250,encodedBytes:1024});
const mime=value=>{
  const type=(value||'').slice(0,128).split(';')[0].trim().toLowerCase();
  return ['application/json','application/problem+json','text/html','text/plain'].includes(type)?type:type?'other':'missing';
};
function headerProjection(headers){
  const out={'content-type':mime(headers.get('content-type'))};
  const retry=(headers.get('retry-after')||'').slice(0,128);
  if(/^\d{1,5}$/.test(retry))out.retryAfterSeconds=Math.min(Number(retry),86400);
  if(headers.has('via'))out.viaPresent=true;
  const server=(headers.get('server')||'').slice(0,128).trim().toLowerCase();
  if(server)out.serverHint=['cloudflare','envoy','nginx'].find(name=>server===name||server.startsWith(name+'/'))||'other';
  if((headers.get('cf-mitigated')||'').slice(0,128).trim().toLowerCase()==='challenge')out.challengeHint=true;
  const blocked=(headers.get('x-mitmproxy-blocked-reason')||'').slice(0,128).trim().toUpperCase();
  if(blocked)out.intermediaryPolicyHint=['ROBOTS_DENIED','HTTPS_ONLY','DOMAIN_BLOCKED','IP_BLOCKED','BLOCKLIST','INTERNAL'].includes(blocked)?blocked:'other';
  return out;
}
async function sampleBody(response,signal){
  if(!response.body)return {text:'',sampledBodyBytes:0,bodyTruncated:false,bodyRead:'absent'};
  const reader=response.body.getReader(),chunks=[];let sampledBodyBytes=0,bodyTruncated=false,bodyRead='complete',timer,onAbort;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DIAGNOSTIC_DEADLINE')),HTTP_DIAGNOSTIC_LIMITS.deadlineMs);});
  const cancellation=new Promise((_,reject)=>{onAbort=()=>reject(Error('DIAGNOSTIC_ABORT'));if(signal?.aborted)onAbort();else signal?.addEventListener('abort',onAbort,{once:true});});
  try{
    while(sampledBodyBytes<HTTP_DIAGNOSTIC_LIMITS.bodyBytes){
      const {done,value}=await Promise.race([reader.read(),deadline,cancellation]);if(done)break;
      const size=Math.min(value.byteLength,HTTP_DIAGNOSTIC_LIMITS.bodyBytes-sampledBodyBytes);
      chunks.push(value.subarray(0,size));sampledBodyBytes+=size;
      if(sampledBodyBytes===HTTP_DIAGNOSTIC_LIMITS.bodyBytes){bodyTruncated=true;bodyRead='bounded';break;}
    }
  }catch{bodyRead='unavailable';bodyTruncated=true;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}
  return {text:Buffer.concat(chunks).toString('utf8'),sampledBodyBytes,bodyTruncated,bodyRead};
}
export async function httpFailureDiagnostic(response,{signal}={}){
  const headers=headerProjection(response.headers),sample=await sampleBody(response,signal),bodySignals=[];
  // Remote bytes can only select these static labels, never become log text.
  for(const [label,pattern]of [
    ['proxy_block_page',/blocked by (?:a |the )?proxy|proxy (?:policy|access) (?:denied|refused)/i],
    ['access_denied_text',/access denied|forbidden|permission denied/i],
    ['challenge_page',/captcha|verify you are human|cf-chl-|cloudflare challenge/i],
    ['authentication_text',/api[ _-]?key|authentication required|unauthori[sz]ed/i],
    ['query_error',/invalid query|query syntax|malformed query/i],
    ['rate_limit_text',/rate limit|too many requests/i],
  ])if(pattern.test(sample.text))bodySignals.push(label);
  let classification=response.status===401?'http_unauthorized_unknown_origin':response.status===403?'http_forbidden_unknown_origin':
    response.status===429?'rate_limited':response.status>=500?'http_server_failure_unknown_origin':'http_request_rejected_unknown_origin';
  if(response.status===403){
    if(headers.intermediaryPolicyHint&&headers.intermediaryPolicyHint!=='other'||bodySignals.includes('proxy_block_page'))classification='intermediary_policy_signal';
    else if(headers.challengeHint||bodySignals.includes('challenge_page'))classification='challenge_signal';
  }
  const {text,...bounded}=sample;
  const result={stage:'http-response',httpStatus:response.status,classification,headers,bodySignals,...bounded,causeProven:false};
  if(Buffer.byteLength(JSON.stringify(result))>HTTP_DIAGNOSTIC_LIMITS.encodedBytes)throw Error('DIAGNOSTIC_PROJECTION_LIMIT');
  return result;
}
export function emitDiagnostic(callback,value){
  if(typeof callback!=='function')return;
  try{Promise.resolve(callback(value)).catch(()=>{});}catch{}
}
