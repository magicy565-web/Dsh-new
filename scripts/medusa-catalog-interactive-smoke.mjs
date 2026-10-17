// Manual-only retained-product subset of medusa-catalog-live-smoke.mjs.
// Native emailpass API, no credential env/argv/file, no cleanup/delete/retries.
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { PassThrough, Writable } from 'node:stream';

export function loopbackOrigin(value) {
  let url; try { url = new URL(value); } catch { throw Error('LOOPBACK_ORIGIN_REQUIRED'); }
  if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('LOOPBACK_ORIGIN_REQUIRED');
  return url.origin;
}

export function productCreatePayload(marker) {
  return {title:'Synthetic acceptance ' + marker,handle:marker,status:'draft',
    description:'Synthetic retained acceptance record; no commercial product or transaction.',
    options:[{title:'Acceptance',values:['Synthetic']}],variants:[],
    metadata:{workspace_acceptance_marker:marker,synthetic:true}};
}
export function validationFields(data) {
  const allowed=new Set(['title','handle','status','options','variants','shipping_profile_id','metadata','subtitle','description','sales_channels','collection_id']);
  const fields=new Set();
  for(const issues of [data?.issues,data?.errors,data?.details?.issues])if(Array.isArray(issues))for(const issue of issues.slice(0,50)){
    const key=Array.isArray(issue?.path)?issue.path[0]:undefined;if(allowed.has(key))fields.add(key);
  }
  const message=typeof data?.message==='string'?data.message.slice(0,65536):'';
  if(/^Product options are not provided for:/.test(message))fields.add('options');
  for(const match of message.matchAll(/\bfield\s+['"]([^'"\r\n]{1,160})['"]/gi)){
    const root=match[1].split(/[.,\[]/)[0].trim();if(allowed.has(root))fields.add(root);
  }
  return [...fields].sort();
}

function inputRefusal(cancelled = false) {
  return {ok:false,status:cancelled?'cancelled':'input_refused',reason:cancelled?'INPUT_CANCELLED':'INPUT_REFUSED',
    creation:'not_attempted',retained:false,checks:[],requests:[],
    failure:{stage:'input',kind:cancelled?'cancelled':'input_refused',validationFields:[]}};
}

export async function retainedProductCheck({ baseUrl, email, password, signal, fetchImpl = fetch }) {
  const origin = loopbackOrigin(baseUrl);
  const marker = 'workspace-acceptance-' + Date.now() + '-' + randomUUID();
  const report = { ok:false, status:'failed', marker, creation:'not_attempted', retained:false, checks:[], requests:[], clientUseWindowSeconds:120, serverTokenExpiry:'unchanged' };
  let token, stage = 'authentication', deadline = performance.now() + 120000;
  const sensitive = () => [email,password,token].filter(s => typeof s === 'string' && s.length).flatMap(s => [s,encodeURIComponent(s),Buffer.from(s).toString('base64'),Buffer.from(s).toString('base64url')]);
  const safeId = id => typeof id === 'string' && /^prod_[a-zA-Z0-9]{6,128}$/.test(id) && !sensitive().some(s => id.includes(s));
  const check = (name, valid) => { if (!valid) { report.failure??={stage,kind:'response_consistency_refused',validationFields:[]}; throw Error('CHECK_REFUSED'); } report.checks.push(name); };
  async function call(route, method = 'GET', body) {
    const left = deadline - performance.now(); if (left <= 0 || signal?.aborted) throw Error('WINDOW_CLOSED');
    const response = await fetchImpl(origin + route, { method, redirect:'error', credentials:'omit',
      headers:{ ...(body ? {'content-type':'application/json'} : {}), ...(token ? {Authorization:'Bearer ' + token} : {}) },
      body:body ? JSON.stringify(body) : undefined,
      signal:AbortSignal.any([AbortSignal.timeout(Math.max(1,Math.min(15000,Math.floor(left)))), ...(signal ? [signal] : [])]) });
    report.requests.push({stage,httpStatus:response.status});
    if(!response.ok)report.failure={stage,httpStatus:response.status,kind:'http_rejected',validationFields:[]};
    let bytes = 0, raw = '';
    const decoder = new TextDecoder();
    for await (const chunk of response.body) { bytes += chunk.byteLength; if (bytes > 65536) throw Error('RESPONSE_LIMIT'); raw += decoder.decode(chunk,{stream:true}); }
    raw += decoder.decode();
    if (performance.now() >= deadline || signal?.aborted) throw Error('WINDOW_CLOSED');
    let data; try { data = JSON.parse(raw); } catch { throw Error('INVALID_RESPONSE'); }
    if(!response.ok){
      const isValidation=['create','update'].includes(stage)&&[400,422].includes(response.status);
      report.failure={stage,httpStatus:response.status,kind:'http_rejected',validationFields:isValidation?validationFields(data):[]};
    }
    return { ok:response.ok, status:response.status, data };
  }
  const title = 'Synthetic acceptance ' + marker;
  const owned = p => p && p.id === report.productId && p.handle === marker && p.status === 'draft'
    && p.metadata?.workspace_acceptance_marker === marker && p.metadata?.synthetic === true;
  try {
    if (typeof email !== 'string' || !email.includes('@') || email.length > 320 || /[\r\n\0]/.test(email)
      || typeof password !== 'string' || !password.length || password.length > 1024 || /[\r\n\0]/.test(password)) return Object.assign(report,inputRefusal());
    const login = await call('/auth/user/emailpass','POST',{email,password});
    if (!login.ok || login.data.mfa_required || login.data.verification_required || typeof login.data.token !== 'string'
      || !login.data.token.length || login.data.token.length > 16384) { report.status = 'authentication_refused'; return report; }
    token = login.data.token; check('native-authentication',true);
    stage = 'create';
    report.creation = 'unknown';
    const created = await call('/admin/products','POST',productCreatePayload(marker));
    check('synthetic-product-created',created.ok && safeId(created.data.product?.id)
      && created.data.product.handle === marker && created.data.product.status === 'draft'
      && created.data.product.metadata?.workspace_acceptance_marker === marker && created.data.product.metadata?.synthetic === true);
    report.productId = created.data.product.id;
    report.creation = 'confirmed'; report.retained = true;
    const route = '/admin/products/' + encodeURIComponent(report.productId);
    const fields = '?fields=id,title,handle,status,subtitle,metadata';
    stage = 'read';
    const first = await call(route + fields); check('exact-created-product-reread',first.ok && owned(first.data.product) && first.data.product.title === title);
    stage = 'update';
    const updatedTitle = title + ' — checked';
    const changed = await call(route,'POST',{title:updatedTitle,subtitle:'Retained synthetic acceptance'});
    check('synthetic-product-updated',changed.ok && owned(changed.data.product));
    stage = 'reread';
    const last = await call(route + fields);
    check('update-persisted-reread',last.ok && owned(last.data.product) && last.data.product.title === updatedTitle
      && last.data.product.subtitle === 'Retained synthetic acceptance');
    report.ok = true; report.status = 'passed'; return report;
  } catch {
    report.status = signal?.aborted ? 'cancelled' : 'failed'; report.reason = stage.toUpperCase() + '_REFUSED_OR_UNKNOWN';
    report.failure??={stage,kind:signal?.aborted?'cancelled':'transport_or_response_unknown',validationFields:[]};
    return report;
  } finally {
    // No response body/error is reported. Screen the only server-controlled output field too.
    if (report.productId && !safeId(report.productId)) delete report.productId;
    email = null; password = null; token = null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1 || args[0] !== '--confirm-keep-synthetic-product'
    || ![1,3].includes(args.length) || (args.length === 3 && args[1] !== '--base-url')
    || !process.stdin.isTTY || !process.stdout.isTTY) throw Error('PRIVATE_INTERACTIVE_TERMINAL_REQUIRED');
  const baseUrl = loopbackOrigin(args[2] || 'http://127.0.0.1:9000');
  const abort = new AbortController();
  // Own the real TTY raw mode until explicit completion. Readline receives a
  // standard stream, so its Ctrl+D/close cannot restore ECHO behind our back.
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  const lines = new PassThrough();
  const muted = new Writable({write(_chunk,_encoding,done){done();}});
  const input = createInterface({input:lines,output:muted,terminal:true,historySize:0,crlfDelay:Infinity});
  let email, password, phase = 0, inputFailure, resolveInput, rejectInput;
  let discarding = false, finishInput;
  const ready = new Promise((resolve,reject) => {resolveInput=resolve;rejectInput=reject;});
  const finished = new Promise(resolve => {finishInput=resolve;});
  const refuse = kind => {
    inputFailure ??= kind; abort.abort(); rejectInput(Error(kind)); input.close();
  };
  const cancel = () => refuse('INPUT_CANCELLED');
  const terminate = () => {if (discarding) finishInput(); else cancel();};
  // Infinity handles delayed adjacent CRLF. Intervening keys make a later LF
  // ambiguous in terminal readline; refuse rather than submit a partial secret.
  // Only delimiter flags are kept, never input content, lengths or traces.
  let unpairedReturn = false, textAfterReturn = false;
  const receive = chunk => {
    if (discarding || phase === 2) {
      // Every byte in this chunk is consumed, including any bytes after Ctrl+C.
      // This is an explicit boundary, not a claim that future input cannot arrive.
      if (chunk.includes(typeof chunk === 'string' ? '\x03' : 3)) terminate();
      return;
    }
    if (inputFailure) return;
    for (let i=0;i<chunk.length;i++) {
      const code = typeof chunk === 'string' ? chunk.charCodeAt(i) : chunk[i];
      if (code === 13) {unpairedReturn=true;textAfterReturn=false;}
      else if (code === 10) {
        if (unpairedReturn && textAfterReturn) {refuse('INPUT_REFUSED');return;}
        unpairedReturn=false;
      } else if (unpairedReturn) textAfterReturn=true;
    }
    lines.write(chunk);
  };
  // Consume lines synchronously so two pasted lines cannot fall between awaits.
  input.on('line',value => {
    if (inputFailure) return;
    if (phase === 0) {email=value;phase=1;process.stdout.write('\nAdmin password (hidden): ');}
    else if (phase === 1) {password=value;phase=2;process.stdout.write('\n');resolveInput();}
    else refuse('INPUT_REFUSED');
  });
  input.on('SIGINT',cancel);
  input.on('close',() => {if (!discarding && !inputFailure) refuse('INPUT_REFUSED');});
  input.on('error',() => refuse('INPUT_REFUSED'));
  const eof = () => {if (!discarding) refuse('INPUT_REFUSED');};
  process.stdin.on('data',receive);
  process.stdin.on('end',eof);
  process.stdin.on('error',eof);
  process.on('SIGINT',terminate);
  process.on('SIGTERM',terminate);
  process.stdin.resume();
  let report;
  try {
    process.stdout.write('Manual acceptance: one synthetic draft will remain. No deletion. Use a private terminal.\n');
    process.stdout.write('Admin email (hidden): ');
    await ready;
    if (inputFailure) throw Error(inputFailure);
    report = await retainedProductCheck({baseUrl,email,password,signal:abort.signal});
  } catch {
    report = inputRefusal(inputFailure === 'INPUT_CANCELLED');
  } finally {
    email=null;password=null;discarding=true;input.close();lines.destroy();
  }
  process.exitCode = report.ok ? 0 : report.status === 'input_refused' || report.failure?.stage === 'input' ? 2 : 1;
  process.stdout.write(JSON.stringify(report,null,2) + '\n');
  if (!report.ok) process.stdout.write('INPUT_DISCARD_ACTIVE. Input remains hidden and is discarded. Stop all queued/pasted input, then press Ctrl+C to finish. If input is disconnected, send SIGINT or SIGTERM. Anything arriving after explicit termination belongs to your terminal.\n');
  // A ref keeps even a disconnected input alive until an explicit signal. This
  // never decides that a queue is empty and never ends discard after a timeout.
  // Success is the separate, natural completion boundary; no extra prompt.
  const keepAlive = report.ok ? undefined : setInterval(() => {}, 60000);
  try {if (!report.ok) await finished;} finally {
    clearInterval(keepAlive);
    process.stdin.removeListener('data',receive);
    process.stdin.removeListener('end',eof);
    process.stdin.removeListener('error',eof);
    process.removeListener('SIGINT',terminate);
    process.removeListener('SIGTERM',terminate);
    // Drop currently available bytes as well; there is no promise about bytes
    // generated after the user's explicit termination boundary.
    while (process.stdin.read() !== null) {}
    process.stdin.pause();
    try {process.stdin.setRawMode(wasRaw);} catch {}
  }
}
if (process.argv[1] === import.meta.filename) main().catch(() => {
  console.error('INTERACTIVE_MEDUSA_CHECK_REFUSED. Run manually in a private TTY with --confirm-keep-synthetic-product; credentials are accepted only at hidden prompts.');
  process.exitCode = 2;
});
