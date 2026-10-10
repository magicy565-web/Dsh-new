import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fields = (v, keys) => object(v) && Object.keys(v).every(key => keys.includes(key));
const sha256 = data => createHash('sha256').update(data).digest('hex');
const now = () => new Date().toISOString();
const leaseMs = 15 * 60_000;
const maxUploadBytes = 1024 * 1024;
const formats = new Set(['.json', '.md', '.txt', '.csv']);
const PUBLIC_SERVICES = Object.freeze(['buyer-discovery', 'channel-validation', 'sales-assets']);

export class DotWorkerError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new DotWorkerError(status, code, message); };
const bounded = (value, label, max = 1000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))
    fail(400, 'INVALID_INPUT', label + ' must be bounded nonempty text.');
  return value.trim();
};
const job = (state, ref) => {
  if (!id(ref)) fail(400, 'INVALID_TASK_REF', 'A stable task reference is required.');
  const found = (state.dotTasks || []).find(task => task.id === ref);
  if (!found) fail(404, 'DOT_TASK_NOT_FOUND', 'Dot task reference was not found.');
  return found;
};
const copy = data => structuredClone(data);
// Enterprise audit events contain metadata only, never dot credentials,
// downloaded bytes, contacts, raw prompts or private work materials.
function event(state, task, action) {
  const at=now();
  const record={id:randomUUID(),type:'dot_worker_'+action,title:'Dot Worker · '+action,
    detail:'Public order '+task.id,createdAt:at};
  task.events??=[];
  task.events.push({id:record.id,action,at,attemptId:task.attemptId,fence:task.fence});
  task.events=task.events.slice(-80);
  state.activity??=[];
  state.activity.push(record);
  state.activity=state.activity.slice(-2000);
}
const publicURL = input => {
  if (typeof input !== 'string' || input.length > 2048) fail(400, 'INVALID_SOURCE', 'Evidence must be a bounded public HTTPS URL.');
  let u;
  try { u = new URL(input); } catch { fail(400, 'INVALID_SOURCE', 'Evidence URL is invalid.'); }
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password ||
      u.hostname === 'localhost' || u.hostname.endsWith('.local') ||
      /^[0-9.]+$/.test(u.hostname) || u.hostname.includes(':'))
    fail(400, 'INVALID_SOURCE', 'Evidence must have a public HTTPS origin.');
  return u.toString();
};
const lease = (task, attemptId, fence, allowCancel = false) => {
  if (!id(attemptId) || !Number.isSafeInteger(fence) || fence < 1 ||
      task.attemptId !== attemptId || task.fence !== fence)
    fail(409, 'STALE_DOT_LEASE', 'The original Dot attempt fence does not match.');
  if (!allowCancel && (task.status !== 'claimed' || Date.parse(task.leaseUntil) <= Date.now()))
    fail(409, 'DOT_LEASE_EXPIRED', 'Dot execution authority is expired, stopped or revoked.');
};

/**
 * Pull-based bridge for a connected personal ChatGPT dot.
 * Dots currently have no verified public inbound task-creation API, so the
 * dot (via a reviewed Workspace plugin) must pull/claim/return public work.
 * This module never attempts to impersonate or remotely start a ChatGPT dot.
 */
export function createDotWorkerBridge({
  store, artifacts, workerId = 'dot-xy', ownerId = 'xy',
  enabled = false, externalBudgetVerified = false, scopeReviewed = false,
  services = PUBLIC_SERVICES,
} = {}) {
  if (typeof store?.read !== 'function' || typeof store?.update !== 'function' ||
      typeof artifacts?.create !== 'function' || typeof artifacts?.download !== 'function' ||
      !id(workerId) || !id(ownerId) || !Array.isArray(services) ||
      !services.length || services.some(name => !PUBLIC_SERVICES.includes(name)) ||
      new Set(services).size !== services.length)
    throw new TypeError('Dot bridge requires a durable store, artifact service and fixed public service scopes.');
  const approved = enabled === true && externalBudgetVerified === true && scopeReviewed === true;
  const read = () => store.read().dotTasks || [];
  const mutate = fn => store.update(state => { state.dotTasks ??= []; return fn(state); });
  function taskSnapshot(task) {
    return { taskRef: task.id, orderId: task.orderId, serviceId: task.serviceId,
      status: task.status, attemptId: task.attemptId, fence: task.fence,
      leaseUntil: task.leaseUntil, cancellationRequested: task.status === 'cancel_requested',
      canExecute: approved && task.status === 'claimed' && Date.parse(task.leaseUntil) > Date.now(),
      deliverySubmitted: task.status === 'submitted', updatedAt: task.updatedAt };
  }
  function guardPayload(task) {
    if (task.dataScope !== 'public' || task.serviceId === 'rfq-recovery')
      fail(403, 'PRIVATE_DATA_FORBIDDEN', 'Only reviewed public data can reach a personal dot.');
  }
  const adapter = {
    services: [...services], displayName: 'ChatGPT dot · ' + ownerId,
    ready: approved, budgetEnforced: approved,
    async submit(input) {
      if (!approved) fail(409, 'DOT_NOT_APPROVED', 'Real dot identity, scope and enforceable budget must be reviewed first.');
      if (!fields(input, ['orderId','idempotencyKey','serviceId','inputs','acceptance','deadlineAt','maxCredits','dataScope']) ||
          !id(input.orderId) || input.idempotencyKey !== input.orderId ||
          !services.includes(input.serviceId) || input.dataScope !== 'public' ||
          !object(input.inputs) || !fields(input.inputs, ['product','market','objective']) ||
          !['product','market','objective'].every(key => typeof input.inputs[key] === 'string') ||
          !Array.isArray(input.acceptance) || input.acceptance.length > 12 ||
          !Number.isSafeInteger(input.maxCredits) || input.maxCredits < 1 ||
          !Number.isFinite(Date.parse(input.deadlineAt)) || Date.parse(input.deadlineAt) <= Date.now())
        fail(400, 'DOT_TASK_SCOPE_INVALID', 'Only the exact approved public business order may be queued.');
      const taskData = {
        id: input.orderId, orderId: input.orderId, serviceId: input.serviceId, workerId,
        inputs: { ...input.inputs }, acceptance: [...input.acceptance], maxCredits: input.maxCredits,
        deadlineAt: input.deadlineAt, dataScope: 'public',
      };
      const fingerprint = sha256(JSON.stringify(taskData));
      return mutate(state => {
        const previous = state.dotTasks.find(row => row.id === taskData.id);
        if (previous) {
          if (previous.fingerprint !== fingerprint) fail(409, 'DOT_IDEMPOTENCY_CONFLICT', 'The same task reference already belongs to different work.');
          return { jobId: previous.id, queued: previous.status === 'pending', duplicate: true };
        }
        if (state.dotTasks.length >= 200) fail(409, 'DOT_QUEUE_LIMIT', 'The reviewed dot worker queue is full.');
        const at = now();
        const item={ ...taskData, fingerprint, status: 'pending', createdAt: at, updatedAt: at,
          attemptId: null, claimRequestId: null, fence: 0, leaseUntil: null,
          files: [], uploadReceipts: [], eventAcks: [], summary: null, sources: [],
          toolEvidence: [], blockedReason: null };
        state.dotTasks.push(item);
        event(state,item,'queued');
        return { jobId: taskData.id, queued: true, duplicate: false };
      });
    },
    async get(jobId, orderId) {
      const item = job(store.read(), jobId);
      if (item.orderId !== orderId || item.workerId !== workerId) fail(409,'DOT_JOB_MISMATCH','Dot task does not match this exact Work Order.');
      const result = { jobId, orderId };
      if (item.status === 'submitted') {
        const sourceEvidence = item.sources.map((url,i)=>({title:'Dot public source '+(i+1),url,detail:'Referenced by the dot; independently unverified.'}));
        const manifest = item.files.filter(file => file.filename.toLowerCase().endsWith('.json'));
        let structured;
        for (const file of manifest) {
          const bytes = await artifacts.download(file.artifactId);
          if (bytes.bytes.length > maxUploadBytes) continue;
          try {
            const parsed = JSON.parse(bytes.bytes.toString('utf8'));
            if (parsed.schema === 'workspace.worker.delivery.v1' && parsed.orderId === orderId) { structured = parsed; break; }
          } catch { /* Unstructured file is inert and cannot count as schema-backed evidence. */ }
        }
        const first = item.files[0];
        return { ...result, status: 'completed',
          deliverables: structured?.deliverables || (first ? [{
            name: first.filename, type: 'file', summary: item.summary.slice(0,1450), sha256: first.sha256,
          }] : []),
          evidence: structured?.evidence || sourceEvidence,
          prospects: structured?.prospects || [],
        };
      }
      if (item.status === 'stopped') return { ...result, status: 'cancelled' };
      if (!approved) return { ...result, status: 'input_required' };
      if (item.status === 'blocked' || (item.status === 'claimed' && Date.parse(item.leaseUntil) <= Date.now()))
        return { ...result, status: 'input_required' };
      if (item.status === 'pending') return { ...result, status: 'queued' };
      return { ...result, status: 'working' };
    },
    async cancel(jobId) {
      return mutate(state => {
        const item = job(state,jobId);
        if (item.status === 'pending') {
          item.status = 'stopped'; item.updatedAt = now();event(state,item,'cancelled_before_claim');
          return { status:'cancelled' };
        }
        if (item.status === 'submitted') return { status: 'cancel_requested' };
        if (!['stopped','cancel_requested'].includes(item.status)) item.status = 'cancel_requested';
        item.updatedAt = now();event(state,item,'cancel_requested');
        return { status:item.status === 'stopped' ? 'cancelled':'cancel_requested' };
      });
    },
    async reconcile(orderId) {
      const item = read().find(row=>row.orderId===orderId);
      if (!item) fail(409,'DOT_TASK_UNCONFIRMED','No durable Dot queue receipt matches the original order.');
      return this.get(item.id,orderId);
    },
  };

  const identity = () => ({ workerId, dot: ownerId,
    contract: 'workspace.dot.pull.v1', approved, connected: false,
    note: 'Identity and a stored task receipt do not verify that the dot is currently working.',
    allowedServices: [...services] });

  const inbox = () => ({ workerId, tasks: (approved ? read() : []).filter(item=>item.status==='pending')
    .map(item=>({ taskRef:item.id,serviceId:item.serviceId,deadlineAt:item.deadlineAt,status:'pending' })) });

  const readTask = taskRef => {
    if (!approved) fail(403,'DOT_NOT_APPROVED','The dot Worker scope or budget authorization has been revoked.');
    const item = job(store.read(),taskRef); guardPayload(item);
    return { ...taskSnapshot(item), dataScope:'public', inputs:copy(item.inputs),
      acceptance:copy(item.acceptance), maxCredits:item.maxCredits, deadlineAt:item.deadlineAt,
      instructions:'Do not send messages or spend money. Use your authorized tools; submit genuine tool receipts and exact source URLs.' };
  };

  async function claimTask({taskRef,requestId}) {
    if (!approved || !id(requestId)) fail(403,'DOT_NOT_APPROVED','A reviewed worker and stable claim request are required.');
    return mutate(state => {
      const item = job(state,taskRef);guardPayload(item);
      const active = state.dotTasks.find(x => x.id !== item.id &&
        ['claimed','blocked','cancel_requested'].includes(x.status) && x.attemptId);
      if (active) fail(409,'DOT_SLOT_BUSY','The one-dot single active attempt is occupied.');
      if (item.status === 'claimed' && item.claimRequestId === requestId &&
          Date.parse(item.leaseUntil) > Date.now())
        return { ...taskSnapshot(item), claimed:true, duplicate:true };
      if (item.status !== 'pending') fail(409,'DOT_TASK_UNAVAILABLE','This task cannot be claimed or restarted.');
      if (Date.parse(item.deadlineAt) <= Date.now()) fail(409,'DOT_DEADLINE_EXPIRED','This business order has expired.');
      item.attemptId = randomUUID();item.claimRequestId=requestId;
      item.fence += 1;item.leaseUntil=new Date(Date.now()+leaseMs).toISOString();
      item.status='claimed';item.updatedAt=now();event(state,item,'claimed');
      return { ...taskSnapshot(item), claimed:true, duplicate:false };
    });
  }
  const status = taskRef => taskSnapshot(job(store.read(),taskRef));

  async function heartbeat({taskRef,attemptId,fence,requestId}) {
    if (!approved) fail(403,'DOT_NOT_APPROVED','The dot Worker is not currently authorized to execute.');
    if (!id(requestId)) fail(400,'INVALID_REQUEST_ID','Stable retry identity required.');
    return mutate(state => {
      const item=job(state,taskRef);lease(item,attemptId,fence);
      if(item.lastHeartbeatRequestId===requestId)
        return { ...taskSnapshot(item), leaseUntil:item.lastHeartbeatReceiptUntil, duplicate:true };
      item.leaseUntil=new Date(Date.now()+leaseMs).toISOString();item.updatedAt=now();
      item.lastHeartbeatRequestId=requestId;item.lastHeartbeatReceiptUntil=item.leaseUntil;
      return { ...taskSnapshot(item), duplicate:false };
    });
  }
  async function uploadFile({taskRef,attemptId,fence,uploadId,filename,base64,sha256:expected}) {
    if (!approved) fail(403,'DOT_NOT_APPROVED','The dot Worker is not currently authorized to deliver.');
    if (!id(uploadId) || typeof filename!=='string' || filename.length>160 ||
        !formats.has(filename.toLowerCase().match(/\.[a-z]+$/)?.[0]) ||
        typeof base64!=='string' || base64.length>1_398_104 ||
        typeof expected!=='string' || !/^[0-9a-f]{64}$/.test(expected))
      fail(400,'INVALID_UPLOAD','A bounded public TXT, MD, CSV or JSON upload with checksum is required.');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
      fail(400,'INVALID_UPLOAD','Only canonical base64 uploads are accepted.');
    const bytes=Buffer.from(base64,'base64');
    if (bytes.length>maxUploadBytes || bytes.toString('base64')!==base64 || sha256(bytes)!==expected)
      fail(400,'INVALID_UPLOAD','Uploaded file exceeds 1 MiB or does not match its SHA-256.');
    const initial=job(store.read(),taskRef);lease(initial,attemptId,fence);
    const previous=initial.files.find(x=>x.uploadId===uploadId);
    if (previous) {
      if (previous.sha256!==expected || previous.filename!==filename) fail(409,'DOT_UPLOAD_CONFLICT','Upload ID was reused with different bytes.');
      return { uploadId, artifactId:previous.artifactId, sha256:expected, duplicate:true };
    }
    const artifactRequest='dot-upload-'+sha256(taskRef+'|'+attemptId+'|'+uploadId);
    const saved=await artifacts.create({
      filename,base64,title:'dot · '+filename,description:'Unverified file submitted by an invited external dot Worker.',
      metadata:{ dotTaskRef:taskRef, dotWorkerId:workerId, externalClaimsVerified:false },
      requestId:artifactRequest,
    },{
      check:state=>lease(job(state,taskRef),attemptId,fence),
    });
    return mutate(state => {
      const item=job(state,taskRef);lease(item,attemptId,fence);
      const prior=item.files.find(x=>x.uploadId===uploadId);
      if(prior) {
        if(prior.sha256!==expected || prior.filename!==filename)fail(409,'DOT_UPLOAD_CONFLICT','Upload ID conflict.');
        return {uploadId,artifactId:prior.artifactId,sha256:expected,duplicate:true};
      }
      if(item.files.length>=20)fail(409,'DOT_UPLOAD_LIMIT','This Dot attempt already has 20 artifacts.');
      item.files.push({uploadId,filename,sha256:expected,artifactId:saved.artifact.id,attemptId,at:now()});
      item.updatedAt=now();event(state,item,'file_uploaded');
      return {uploadId,artifactId:saved.artifact.id,sha256:expected,duplicate:false};
    });
  }
  async function submitResult({taskRef,attemptId,fence,requestId,summary,sources,toolEvidence}) {
    if (!approved) fail(403,'DOT_NOT_APPROVED','Dot authorization was revoked before this delivery.');
    if(!id(requestId)||!Array.isArray(sources)||sources.length<1||sources.length>20 ||
       !Array.isArray(toolEvidence)||toolEvidence.length<1||toolEvidence.length>20)
      fail(400,'DOT_EVIDENCE_REQUIRED','Result must contain sources and original tool receipt references.');
    const safeSummary=bounded(summary,'result summary',8000);
    const cleanSources=sources.map(publicURL);
    const receipts=toolEvidence.map(x=>{
      if(!fields(x,['tool','receiptId'])||!id(x.tool)||!id(x.receiptId))
        fail(400,'DOT_EVIDENCE_INVALID','Tool receipts require a tool name and original receipt ID.');
      return {tool:x.tool,receiptId:x.receiptId};
    });
    const payload={summary:safeSummary,sources:cleanSources,toolEvidence:receipts};
    const contentHash=sha256(JSON.stringify(payload));
    return mutate(state => {
      const item=job(state,taskRef);
      if(item.status==='submitted' && item.submitRequestId===requestId) {
        if(item.submitHash!==contentHash)fail(409,'DOT_RESULT_CONFLICT','Result request ID was reused with different evidence.');
        return {taskRef,status:'submitted',duplicate:true,reviewRequired:true};
      }
      lease(item,attemptId,fence);
      if(!item.files.length)fail(409,'DOT_FILE_REQUIRED','Upload at least one real file produced with native tools.');
      item.status='submitted';item.summary=safeSummary;item.sources=cleanSources;item.toolEvidence=receipts;
      item.submitRequestId=requestId;item.submitHash=contentHash;item.updatedAt=now();
      event(state,item,'result_submitted');
      return {taskRef,status:'submitted',duplicate:false,reviewRequired:true,independentlyVerified:false};
    });
  }
  async function reportBlocked({taskRef,attemptId,fence,requestId,message}) {
    if(!id(requestId))fail(400,'INVALID_REQUEST_ID','Blocker needs stable request identity.');
    const detail=bounded(message,'blocker',2000);
    return mutate(state=>{
      const item=job(state,taskRef);
      if(item.status==='blocked'&&item.blockRequestId===requestId) {
        if(item.blockedReason!==detail)fail(409,'DOT_BLOCKER_CONFLICT','Blocker request ID was reused with different information.');
        return taskSnapshot(item);
      }
      lease(item,attemptId,fence);
      item.status='blocked';item.blockedReason=detail;item.blockRequestId=requestId;item.updatedAt=now();
      event(state,item,'blocked');
      return taskSnapshot(item);
    });
  }
  async function confirmStop({taskRef,attemptId,fence,requestId}) {
    if(!id(requestId)) fail(400,'INVALID_REQUEST_ID','Stop acknowledgement needs a stable identity.');
    return mutate(state=>{
      const item=job(state,taskRef);lease(item,attemptId,fence,true);
      if(item.status==='stopped'&&item.stopRequestId===requestId)return taskSnapshot(item);
      if(item.status!=='cancel_requested')fail(409,'DOT_NOT_CANCELLED','Only an actual cancellation can be acknowledged.');
      item.status='stopped';item.stopRequestId=requestId;item.updatedAt=now();
      event(state,item,'stop_confirmed');
      return taskSnapshot(item);
    });
  }
  async function ackEvent({taskRef,eventId}) {
    if(!id(eventId))fail(400,'INVALID_EVENT','Stable event ID required.');
    return mutate(state=>{
      const item=job(state,taskRef);
      if(!item.eventAcks.includes(eventId)){
        if(item.eventAcks.length>=100)fail(409,'DOT_EVENT_LIMIT','Event acknowledgement limit reached.');
        item.eventAcks.push(eventId);item.updatedAt=now();
      }
      return {taskRef,eventId,acknowledged:true};
    });
  }

  return {
    adapter, identity, inbox, readTask, claimTask, status, heartbeat,
    uploadFile, submitResult, reportBlocked, confirmStop, ackEvent,
    info:()=>({installed:true,approved,workerId,ownerId,onlineVerified:false,
      pending:read().filter(x=>x.status==='pending').length,
      claimed:read().filter(x=>x.status==='claimed').length,
      completed:read().filter(x=>x.status==='submitted').length,
      lastSeenAt:store.read().dotLastSeenAt||null,
    }),
    adminTasks:()=>read().map(item=>({
      taskRef:item.id,serviceId:item.serviceId,status:item.status,
      createdAt:item.createdAt,updatedAt:item.updatedAt,deadlineAt:item.deadlineAt,
      leaseUntil:item.leaseUntil,attemptId:item.attemptId,fence:item.fence,
      fileCount:item.files.length,evidenceCount:item.toolEvidence.length,
      events:copy(item.events||[]),independentlyVerified:false,
    })),
    async recordSeen(){
      await mutate(state=>{state.dotLastSeenAt=now();});
    },
  };
}

/** A one-worker dedicated bearer channel, distinct from browser sessions. */
export function createDotWorkerAuth({tokenDigest}) {
  if(typeof tokenDigest!=='string'||!/^[0-9a-f]{64}$/.test(tokenDigest))return null;
  const expected=Buffer.from(tokenDigest,'hex');
  return request=>{
    if(request.headers.origin||request.headers.cookie||request.headers.referer)
      fail(403,'DOT_BROWSER_FORBIDDEN','Dot tool endpoints accept only private server-to-server requests.');
    const match=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.authorization||'');
    if(!match)fail(401,'DOT_AUTH_REQUIRED','Use the approved plugin credential for this dot.');
    const actual=Buffer.from(sha256(match[1]),'hex');
    if(!timingSafeEqual(expected,actual))
      fail(401,'DOT_AUTH_FAILED','Dot credential was not accepted.');
    return true;
  };
}
