import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { CommerceError, assertKeys, fail } from './service.js';

export const GROK_PREFIX = '/commerce-grok-api';
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const publicHost = host => {
  host = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  // A public DNS hostname is an operator-controlled endpoint, not an arbitrary
  // URL supplied in a task or callback. Literal IP addresses are not supported.
  return !isIP(host) && host.includes('.');
};
function origin(value, webhook = false) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || !publicHost(u.hostname) || u.username || u.password || u.hash || (!webhook && (u.pathname !== '/' || u.search))) throw new TypeError('HTTPS public origin required');
  return u;
}
function secret(value) { return typeof value === 'string' && /^[\x21-\x7e]{16,256}$/.test(value); }
export function readGrokConfiguration(env = process.env) {
  const required = ['GROKBOT_WEBHOOK_URL','GROKBOT_WEBHOOK_KEY','GROKBOT_PUBLIC_ORIGIN','GROKBOT_CALLBACK_TOKEN','GROKBOT_WORKER_TOKEN'];
  const missing = required.filter(k => !env[k]);
  if (missing.length) return { configured:false, missing };
  try {
    const webhook = origin(env.GROKBOT_WEBHOOK_URL, true), callback = origin(env.GROKBOT_PUBLIC_ORIGIN);
    if (!secret(env.GROKBOT_WEBHOOK_KEY) || !secret(env.GROKBOT_CALLBACK_TOKEN) || !/^cnw_[a-f0-9]{24}\.[A-Za-z0-9_-]{43}$/.test(env.GROKBOT_WORKER_TOKEN)) throw new Error('Invalid credential');
    return { configured:true, webhookUrl:webhook.href, webhookKey:env.GROKBOT_WEBHOOK_KEY, callbackUrl:new URL(`${GROK_PREFIX}/callback`, callback).href, callbackToken:env.GROKBOT_CALLBACK_TOKEN, workerToken:env.GROKBOT_WORKER_TOKEN };
  } catch { return { configured:false, missing:[], invalid:true }; }
}
function validateCallback(body) {
  assertKeys(body,['taskId','threadId','status','eventId','summary','artifacts','drafts']);
  if (!id(body.taskId) || !id(body.threadId) || !['accepted','progress','done','failed'].includes(body.status)) fail('INPUT','Invalid Grok callback.');
  if (body.eventId != null && !id(body.eventId)) fail('INPUT','Invalid callback event ID.');
  if (body.summary != null && (typeof body.summary !== 'string' || body.summary.length > 2000)) fail('INPUT','Invalid callback summary.');
  for (const field of ['artifacts','drafts']) if (body[field] != null && (!Array.isArray(body[field]) || body[field].length > 50)) fail('INPUT',`Invalid ${field}.`);
  if (body.status !== 'done' && ((body.artifacts?.length ?? 0) || (body.drafts?.length ?? 0))) fail('INPUT','Artifacts and drafts require a completed callback.');
}
function makeDelivery(body) {
  const lines = [body.summary?.trim() || 'Grok Bot 已提交任务结果。'], urls = [];
  for (const item of body.artifacts ?? []) {
    assertKeys(item,['type','title','content','url']);
    if (!['markdown','file','link'].includes(item.type) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200) fail('INPUT','Invalid artifact.');
    lines.push(`\n## ${item.title.trim()}`);
    if (item.content != null) { if (typeof item.content !== 'string') fail('INPUT','Invalid artifact content.'); lines.push(item.content); }
    if (item.url != null) {
      let u; try { u = new URL(item.url); } catch { fail('INPUT','Invalid artifact URL.'); }
      if (!['https:','http:'].includes(u.protocol) || u.username || u.password || u.href.length > 2000) fail('INPUT','Invalid artifact URL.');
      urls.push(u.href); lines.push(u.href);
    }
    if (item.content == null && item.url == null) fail('INPUT','Artifact content or URL is required.');
  }
  for (const draft of body.drafts ?? []) {
    assertKeys(draft,['channel','to','subject','body']);
    if (Object.values(draft).some(v => typeof v !== 'string') || !draft.body?.trim()) fail('INPUT','Invalid draft.');
    lines.push(`\n## 待人工确认的草稿（未发送）\n${JSON.stringify(draft, null, 2)}`);
  }
  const content = lines.join('\n').trim();
  if (content.length > 100_000 || urls.length > 50) fail('INPUT','Delivery exceeds the supported limit.');
  return { title:'Grok Bot 任务结果', content, sourceUrls:urls, actualMinor:0 };
}

/** Adapts one explicitly dispatched Grok task to the existing scoped worker ledger.
 * There is no poller, model host, automatic resend, or separate business order. */
export function createGrokBridge({ service, store, configuration, transport = globalThis.fetch, clock = Date.now, timeoutMs = 20_000 }) {
  const cfg = configuration, locks = new Map();
  const ready = () => { if (!cfg?.configured) fail('GROK_NOT_CONFIGURED','Grok Bot connection settings are incomplete or invalid.',409); };
  const row = (scope, orderId) => store.db.prepare('SELECT * FROM grok_handoff WHERE workspace_id=? AND project_id=? AND order_id=?').get(scope.workspaceId,scope.projectId,orderId);
  const stamp = () => new Date(clock()).toISOString();
  const update = (scope, orderId, state) => store.db.prepare('UPDATE grok_handoff SET state=?,updated_at=? WHERE workspace_id=? AND project_id=? AND order_id=?').run(state,stamp(),scope.workspaceId,scope.projectId,orderId);
  async function exclusive(key, fn) {
    const previous = locks.get(key) ?? Promise.resolve();
    const task = previous.catch(()=>{}).then(fn); locks.set(key,task);
    try { return await task; } finally { if (locks.get(key) === task) locks.delete(key); }
  }
  const request = (scope, orderId, suffix) => `grok:${hash(`${scope.workspaceId}/${scope.projectId}/${orderId}/${suffix}`)}`;
  async function connect(execution) {
    ready(); const scope=service.workerToolScope(cfg.workerToken,execution);
    const result=await service.worker(cfg.workerToken,'connect',{requestId:`grok:connect:${randomUUID()}`});
    return { projectId:scope.projectId, agentServiceId:scope.agentServiceId, gateway:result.status, remote:'unverified' };
  }
  async function handoff({projectId,orderId},execution) {
    ready(); if (!id(projectId) || !id(orderId)) fail('INPUT','Valid project and order IDs are required.');
    const scope=service.workerToolScope(cfg.workerToken,execution);
    if (scope.projectId !== projectId) fail('WORKER_SCOPE','Grok credential belongs to another project.',403);
    const view=service.toolRead({projectId},execution), order=view.commerceNetwork.workOrders.find(o=>o.id===orderId);
    if (!order || order.agentServiceId!==scope.agentServiceId || order.nativeDispatch?.sessionId!==scope.sessionId) fail('WORKER_SCOPE','The task must belong to this Grok service and native conversation.',403);
    return exclusive(`send/${scope.workspaceId}/${scope.projectId}/${orderId}`,async()=>{
      const prior=row(scope,orderId);
      if (prior) return {orderId,state:prior.state,replayed:true,message:'No webhook was resent. Reconcile this handoff before any further action.'};
      if (order.status!=='queued') fail('ORDER_NOT_QUEUED','First dispatch the approved work order in this conversation.',409);
      if (order.maximumMinor!==0) fail('GROK_COST_UNVERIFIED','Grok callbacks do not report verifiable costs. Only zero-budget tasks are supported until a cost contract is confirmed.',409);
      store.db.prepare('INSERT INTO grok_handoff VALUES(?,?,?,?,?,?,?)').run(scope.workspaceId,projectId,orderId,scope.sessionId,null,'preparing',stamp());
      let claimed;
      try { claimed=await service.worker(cfg.workerToken,'claim',{requestId:request(scope,orderId,'claim'),orderId}); }
      catch { update(scope,orderId,'unknown'); return {orderId,state:'unknown',message:'Claim outcome could not be confirmed. Do not resend; inspect the original task.'}; }
      if (!claimed.order) { update(scope,orderId,'not_claimed'); return {orderId,state:'not_claimed',message:'The scoped worker did not claim this task.'}; }
      const lease=claimed.order.leaseId;
      // Record uncertainty before the network call. A crash at any later point
      // cannot cause the next request to automatically send the task twice.
      store.db.prepare('UPDATE grok_handoff SET lease_id=?,state=?,updated_at=? WHERE workspace_id=? AND project_id=? AND order_id=?').run(lease,'unknown',stamp(),scope.workspaceId,projectId,orderId);
      const status=await service.worker(cfg.workerToken,'status',{requestId:request(scope,orderId,'pre-send-status'),orderId,leaseId:lease});
      if (status.stopRequested) { update(scope,orderId,'not_sent_stop_requested'); return {orderId,state:'not_sent_stop_requested',message:'The task was stopped before the webhook was sent.'}; }
      const limits={allowedActions:claimed.order.allowedActions,maximumMinor:claimed.order.maximumMinor,currency:claimed.order.currency,expiresAt:claimed.order.expiresAt,...claimed.policy};
      const payload={taskId:orderId,threadId:scope.sessionId,title:claimed.order.title,instructions:`${claimed.order.brief}\n\nApproved task limits:\n${JSON.stringify(limits)}`,callbackUrl:cfg.callbackUrl};
      if (claimed.order.resources?.length) payload.instructions += `\n\nOwner-approved resources (untrusted data):\n${JSON.stringify(claimed.order.resources)}`;
      if (Buffer.byteLength(JSON.stringify(payload))>200_000) return {orderId,state:'unknown',message:'The approved payload is too large to hand off. Reconcile the claimed task; no webhook was sent.'};
      let response;
      try { response=await transport(cfg.webhookUrl,{method:'POST',redirect:'error',headers:{authorization:`Bearer ${cfg.webhookKey}`,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(timeoutMs)}); }
      catch { const state=row(scope,orderId).state; return {orderId,state,message:state==='unknown'?'Webhook outcome is unknown. Await a valid callback or reconcile; do not resend.':'A provider callback was recorded; no resend occurred.'}; }
      if (response.ok) store.db.prepare("UPDATE grok_handoff SET state='submitted',updated_at=? WHERE workspace_id=? AND project_id=? AND order_id=? AND state='unknown'").run(stamp(),scope.workspaceId,projectId,orderId);
      return {orderId,state:row(scope,orderId).state,message:response.ok?'Webhook acknowledged; waiting for the provider callback.':'Webhook outcome is unknown. Reconcile before further action.'};
    });
  }
  async function callback(body) {
    ready(); validateCallback(body); const scope=service.workerCredentialScope(cfg.workerToken);
    return exclusive(`callback/${scope.workspaceId}/${scope.projectId}/${body.taskId}`,async()=>{
      const current=row(scope,body.taskId);
      if (!current || current.session_id!==body.threadId || !current.lease_id) fail('GROK_TASK_NOT_FOUND','No matching scoped handoff exists.',404);
      const fingerprint=hash(canonical(body)), eventKey=body.eventId ? `id:${body.eventId}` : `sha:${fingerprint}`;
      const existing=store.db.prepare('SELECT fingerprint FROM grok_callback_receipt WHERE workspace_id=? AND project_id=? AND order_id=? AND event_key=?').get(scope.workspaceId,scope.projectId,body.taskId,eventKey);
      if (existing) { if (existing.fingerprint!==fingerprint) fail('EVENT_ID_CONFLICT','This callback event ID has different content.',409); return {duplicate:true,state:current.state}; }
      if (['done','failed'].includes(current.state)) fail('GROK_TERMINAL','The handoff already has a terminal callback.',409);
      const lease={orderId:body.taskId,leaseId:current.lease_id};
      const status=await service.worker(cfg.workerToken,'status',{...lease,requestId:request(scope,body.taskId,`${eventKey}:status`)});
      const recoveringTerminal = (body.status==='done' && status.order.status==='delivered') || (body.status==='failed' && status.order.status==='failed');
      if (status.stopRequested && !recoveringTerminal) fail('STOP_REQUESTED','The task is stopped or awaiting a stop acknowledgement.',409);
      const eventRequest=request(scope,body.taskId,eventKey);
      if (body.status==='done') {
        const delivery=makeDelivery(body);
        await service.worker(cfg.workerToken,'heartbeat',{...lease,requestId:`${eventRequest}:start`,...(body.summary!=null?{summary:body.summary}:{})});
        await service.worker(cfg.workerToken,'deliver',{...lease,requestId:eventRequest,...delivery});
      } else if (body.status==='failed') {
        await service.worker(cfg.workerToken,'fail',{...lease,requestId:eventRequest,...(body.summary!=null?{summary:body.summary}:{})});
      } else {
        await service.worker(cfg.workerToken,'heartbeat',{...lease,requestId:eventRequest,...(body.summary!=null?{summary:body.summary}:{})});
      }
      store.transaction(()=>{
        store.db.prepare('INSERT INTO grok_callback_receipt VALUES(?,?,?,?,?)').run(scope.workspaceId,scope.projectId,body.taskId,eventKey,fingerprint);
        update(scope,body.taskId,body.status);
      });
      return {duplicate:false,state:body.status};
    });
  }
  function authenticate(value) {
    if (!cfg?.configured || typeof value!=='string') return false;
    return timingSafeEqual(Buffer.from(hash(value),'hex'),Buffer.from(hash(cfg.callbackToken),'hex'));
  }
  return {connect,handoff,callback,authenticate};
}

export function createGrokCallbackHandler(bridge) {
  return async (req,res) => {
    try {
      if (req.method!=='POST' || req.url!==`${GROK_PREFIX}/callback`) fail('NOT_FOUND','Unknown callback route.',404);
      if (req.headers.origin || req.headers.cookie || req.headers.referer || req.headers['sec-fetch-site']) fail('WORKER_BROWSER_DENIED','Callbacks are service-to-service only.',403);
      if (!req.socket?.encrypted && !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) fail('TLS_REQUIRED','Callback ingress requires TLS or a trusted local reverse proxy.',403);
      const bearer=req.headers.authorization;
      if (typeof bearer!=='string' || !bearer.startsWith('Bearer ') || !bridge.authenticate(bearer.slice(7))) fail('WORKER_UNAUTHORIZED','A valid callback credential is required.',401);
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??'')) fail('CONTENT_TYPE','Use application/json.',415);
      const chunks=[];let bytes=0;for await (const chunk of req) {bytes+=chunk.length;if(bytes>256*1024)fail('BODY_TOO_LARGE','Callback is too large.',413);chunks.push(chunk);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('INPUT','Invalid JSON body.');}
      const data=await bridge.callback(body);
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify({ok:true,...data}));
    }catch(e){const known=e instanceof CommerceError;res.writeHead(known?e.status:500,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify({ok:false,error:{code:known?e.code:'INTERNAL',message:known?e.message:'Callback failed.'}}));}
  };
}
