// Manual-only retained-product subset of medusa-catalog-live-smoke.mjs.
// Native emailpass API, no credential env/argv/file, no cleanup/delete/retries.
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

export function loopbackOrigin(value) {
  let url; try { url = new URL(value); } catch { throw Error('LOOPBACK_ORIGIN_REQUIRED'); }
  if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('LOOPBACK_ORIGIN_REQUIRED');
  return url.origin;
}

export async function retainedProductCheck({ baseUrl, email, password, signal, fetchImpl = fetch }) {
  const origin = loopbackOrigin(baseUrl);
  const marker = 'workspace-acceptance-' + Date.now() + '-' + randomUUID();
  const report = { ok:false, status:'failed', marker, creation:'not_attempted', retained:false, checks:[], clientUseWindowSeconds:120, serverTokenExpiry:'unchanged' };
  let token, stage = 'authentication', deadline = performance.now() + 120000;
  const sensitive = () => [email,password,token].filter(s => typeof s === 'string' && s.length).flatMap(s => [s,encodeURIComponent(s),Buffer.from(s).toString('base64'),Buffer.from(s).toString('base64url')]);
  const safeId = id => typeof id === 'string' && /^prod_[a-zA-Z0-9]{6,128}$/.test(id) && !sensitive().some(s => id.includes(s));
  const check = (name, valid) => { if (!valid) throw Error('CHECK_REFUSED'); report.checks.push(name); };
  async function call(route, method = 'GET', body) {
    const left = deadline - performance.now(); if (left <= 0 || signal?.aborted) throw Error('WINDOW_CLOSED');
    const response = await fetchImpl(origin + route, { method, redirect:'error', credentials:'omit',
      headers:{ ...(body ? {'content-type':'application/json'} : {}), ...(token ? {Authorization:'Bearer ' + token} : {}) },
      body:body ? JSON.stringify(body) : undefined,
      signal:AbortSignal.any([AbortSignal.timeout(Math.max(1,Math.min(15000,Math.floor(left)))), ...(signal ? [signal] : [])]) });
    let bytes = 0, raw = '';
    const decoder = new TextDecoder();
    for await (const chunk of response.body) { bytes += chunk.byteLength; if (bytes > 65536) throw Error('RESPONSE_LIMIT'); raw += decoder.decode(chunk,{stream:true}); }
    raw += decoder.decode();
    if (performance.now() >= deadline || signal?.aborted) throw Error('WINDOW_CLOSED');
    let data; try { data = JSON.parse(raw); } catch { throw Error('INVALID_RESPONSE'); }
    return { ok:response.ok, status:response.status, data };
  }
  const title = 'Synthetic acceptance ' + marker;
  const owned = p => p && p.id === report.productId && p.handle === marker && p.status === 'draft'
    && p.metadata?.workspace_acceptance_marker === marker && p.metadata?.synthetic === true;
  try {
    if (typeof email !== 'string' || !email.includes('@') || email.length > 320 || /[\r\n\0]/.test(email)
      || typeof password !== 'string' || !password.length || password.length > 1024) throw Error('INPUT_REFUSED');
    const login = await call('/auth/user/emailpass','POST',{email,password});
    if (!login.ok || login.data.mfa_required || login.data.verification_required || typeof login.data.token !== 'string'
      || !login.data.token.length || login.data.token.length > 16384) { report.status = 'authentication_refused'; return report; }
    token = login.data.token; check('native-authentication',true);
    stage = 'create';
    report.creation = 'unknown';
    const created = await call('/admin/products','POST',{ title, handle:marker, status:'draft',
      description:'Synthetic retained acceptance record; no commercial product or transaction.',
      metadata:{workspace_acceptance_marker:marker,synthetic:true} });
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
  // A single native readline interface keeps raw input/no echo between both prompts.
  // No history, subprocess, cookie jar or file. Both email and password are hidden.
  const muted = new Writable({write(_chunk,_encoding,done){done();}});
  const input = createInterface({input:process.stdin,output:muted,terminal:true,historySize:0});
  let pendingReject, email, password;
  const cancel = () => { abort.abort(); pendingReject?.(Error('INPUT_CANCELLED')); input.close(); };
  input.on('SIGINT',cancel); input.on('close',() => pendingReject?.(Error('INPUT_CLOSED')));
  process.once('SIGTERM',cancel);
  const hidden = label => new Promise((resolve,reject) => {
    pendingReject = reject; process.stdout.write(label);
    input.question('',value => { pendingReject = null; process.stdout.write('\n'); resolve(value); });
  });
  try {
    process.stdout.write('Manual acceptance: one synthetic draft will remain. No deletion. Use a private terminal.\n');
    email = await hidden('Admin email (hidden): ');
    password = await hidden('Admin password (hidden): ');
    const report = await retainedProductCheck({baseUrl,email,password,signal:abort.signal});
    process.stdout.write(JSON.stringify(report,null,2) + '\n'); process.exitCode = report.ok ? 0 : 1;
  } finally { pendingReject = null; email = null; password = null; input.close(); process.removeListener('SIGTERM',cancel); }
}
if (process.argv[1] === import.meta.filename) main().catch(() => {
  console.error('INTERACTIVE_MEDUSA_CHECK_REFUSED. Run manually in a private TTY with --confirm-keep-synthetic-product; credentials are accepted only at hidden prompts.');
  process.exitCode = 2;
});
