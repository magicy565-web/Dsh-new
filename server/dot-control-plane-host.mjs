import { createHash } from 'node:crypto';
import { projectControlSnapshot, replayControlEvents, recommendGoalSteps, controlScopeKey } from './dot-control-plane.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{0,199}$/i.test(value);
const nativeId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_.:@/-]{0,127}$/i.test(value)
  && !['__proto__', 'constructor', 'prototype'].includes(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const date = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8.64e15 ? value
  : typeof value === 'string' ? Date.parse(value) : NaN;
const latest = values => {
  const times=values.map(date).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
};
const fail = code => { throw Object.assign(new Error(code),{code}); };
const sameActor = (row, actor) => row?.subject === actor.subject && row?.nativeAgentId === actor.nativeAgentId;
const arrays = (state, name) => Array.isArray(state[name]) ? state[name] : [];
const owner = (row, actor) => row.createdBy === actor.subject || sameActor(row,actor);
const receiptHash = value => object(value) ? hash(value) : null;

/**
 * Map confirmed existing records. Native binding and principal are trusted Host
 * inputs; neither may be supplied by model/tool arguments. No view() method that
 * refreshes, reconciles, acknowledges, submits or renews is accepted here.
 */
export function adaptWorkspaceControlSource({state,principal,binding=null,sourceId='workspace-host',
  observedAt,sharedWorkspace=false,museView=[],verifiedRunIds=[]}={}) {
  controlScopeKey(principal);
  if (!object(state) || !id(sourceId) || !Number.isFinite(date(observedAt)) || !Array.isArray(museView)
    || !Array.isArray(verifiedRunIds)) fail('CONTROL_HOST_INPUT_INVALID');
  const actor=binding?.actor ?? {subject:principal.userId,nativeAgentId:null};
  if (binding && (actor.subject!==principal.userId || !nativeId(actor.subject)
    || !nativeId(actor.nativeAgentId) || !id(binding.workerId))) fail('CONTROL_HOST_OWNER_MISMATCH');
  const visibility=sharedWorkspace===true && !binding ? 'workspace' : 'private';
  const records=[], conversations=arrays(state,'conversations');
  const permitted = row => owner(row,actor) || visibility==='workspace';
  const boundConversation = row => {
    const conversationId=row.conversationId ?? row.museSession?.nativeAgentId;
    if (!conversationId) return 'not_supported';
    const matches=conversations.filter(conversation=>conversation.id===conversationId);
    if (matches.length!==1) return 'missing';
    return binding ? sameActor(matches[0],actor) ? 'verified' : 'mismatch' : 'verified';
  };
  const common = (row,collection) => ({
    id:row.id,requestId:row.requestId,workerId:row.workerId,
    conversationId:row.conversationId ?? row.museSession?.nativeAgentId,
    updatedAt:row.updatedAt,updatedAtOrigin:row.updatedAt ? 'updatedAt' : null,
    status:row.status,goalId:row.goalId,revision:row.revision,deadlineAt:row.deadlineAt,
    error:row.error ?? row.lastError,origin:{collection,recordId:row.id},
  });
  for (const goal of arrays(state,'goals').filter(permitted)) {
    const linkage=boundConversation(goal);
    records.push({...common(goal,'goals'),kind:'goal',domain:'workspace',runId:goal.runId,
      linkage:{conversation:linkage},reconciliationRequired:['missing','mismatch'].includes(linkage)});
  }
  for (const run of arrays(state,'runs').filter(row=>permitted(row)
    || visibility==='private' && records.some(goal=>goal.kind==='goal' && goal.id===row.goalId))) {
    const linkage=boundConversation(run), updatedAt=latest([run.updatedAt,run.finishedAt,run.startedAt,run.createdAt,
      ...(run.events??[]).map(event=>event.createdAt)]);
    records.push({...common(run,'runs'),kind:'attempt',domain:'runtime',attemptId:run.id,
      startedAt:run.startedAt,updatedAt,updatedAtOrigin:run.updatedAt?'updatedAt':'run-timestamps',
      executionVerified:verifiedRunIds.includes(run.id),linkage:{conversation:linkage},
      reconciliationRequired:['missing','mismatch'].includes(linkage)});
  }
  for (const order of arrays(state,'workerOrders').filter(row=>permitted(row)
    && (!binding || row.createdBy===actor.subject && row.workerId===binding.workerId))) {
    const mapped=order.museConversation;
    const native=order.museSession;
    if (binding && native && (!sameActor(native,actor) || native.workerId!==binding.workerId)) continue;
    if (binding && mapped && (!sameActor(mapped,actor) || mapped.workerId!==binding.workerId)) continue;
    const conversation=boundConversation(order);
    let requestVerified=true;
    if (mapped) {
      const messages=arrays(state,'messages').filter(message=>message.id===mapped.messageId);
      requestVerified=mapped.requestId===order.requestId && mapped.subject===order.createdBy
        && mapped.workerId===order.workerId && mapped.nativeAgentId===native?.nativeAgentId
        && messages.length===1 && messages[0].conversationId===mapped.nativeAgentId && messages[0].role==='user'
        && messages[0].museOrderId===order.id && messages[0].museReviewHash===mapped.reviewHash
        && hash(messages[0].content)===mapped.contentHash;
    }
    const orderLink={conversation:requestVerified?conversation:'mismatch'};
    const invalidOrder=!requestVerified || ['missing','mismatch'].includes(conversation);
    records.push({...common(order,'workerOrders'),kind:'order',domain:native?'muse':'workspace',
      approvalRequired:order.status==='draft' && !!mapped,orderUpdatedAt:order.updatedAt,
      acceptedAt:order.acceptedAt,linkage:orderLink,reconciliationRequired:invalidOrder});
    const collection=native?'museTasks':'dotTasks';
    const tasks=arrays(state,collection).filter(task=>task.orderId===order.id && task.workerId===order.workerId);
    if (!native && !tasks.length) continue;
    const task=tasks.length===1?tasks[0]:null;
    const views=museView.filter(view=>view.orderId===order.id);
    const view=views.length===1?views[0]:null;
    const hasTask=task!==null;
    const taskMatches=hasTask && task.id===order.id && (task.id===order.remoteJobId
      || !!native && order.remoteJobId===null && ['dispatching','dispatch_uncertain'].includes(order.status))
      && task.serviceId===order.serviceId && task.deadlineAt===order.deadlineAt
      && task.maxCredits===order.budgetCredits && task.dataScope==='public'
      && !['draft','approved'].includes(order.status);
    const viewMatches=!!view && view.workerId===order.workerId && view.requestId===order.requestId
      && view.nativeAgentId===native?.nativeAgentId && view.status===order.status
      && view.updatedAt===order.updatedAt && view.taskRef===(task?.id??null)
      && view.attemptId===(task?.attemptId??null) && view.fence===(task?.fence??0)
      && view.executionStatus===(task?.status??null) && view.leaseUntil===(task?.leaseUntil??null)
      && view.taskUpdatedAt===(task?.updatedAt??null);
    let returnedHash=null, receipt=null, resultLink='not_supported';
    if (native && viewMatches) {
      receipt=view.receipt;
      const returned=arrays(state.workspaceMuseSessionReceipts??{},'receipts').filter(row=>row.orderId===order.id
        && row.workerId===order.workerId && sameActor(row,actor));
      if (view.returnedHash) {
        const saved=returned.length===1?returned[0]:null;
        const messages=arrays(state,'messages').filter(message=>message.id===saved?.nativeMessageId);
        const valid=!!saved && saved.receiptHash===view.receiptHash && view.returnedHash===view.receiptHash
          && receiptHash(receipt)===view.receiptHash && receiptHash(saved.receipt)===view.receiptHash
          && messages.length===1 && messages[0].conversationId===native.nativeAgentId
          && messages[0].museOrderId===order.id && messages[0].museReceiptHash===view.receiptHash
          && receiptHash(messages[0].museReceipt)===view.receiptHash;
        resultLink=valid?'verified':'mismatch'; if(valid) returnedHash=view.returnedHash;
      } else resultLink=receipt?'verified':'not_supported';
    }
    const invalid=invalidOrder || tasks.length>1 || hasTask&&!taskMatches
      || native&&!viewMatches || resultLink==='mismatch';
    records.push({...common(order,collection),id:task?.id??order.id,kind:'task',domain:native?'muse':'dot',
      orderId:order.id,taskRef:task?.id??null,attemptId:task?.attemptId??null,fence:task?.fence??null,
      executionStatus:task?.status??null,leaseUntil:task?.leaseUntil??null,
      approvalRequired:order.status==='draft' && !!mapped,acceptedAt:order.acceptedAt,
      orderUpdatedAt:order.updatedAt,taskUpdatedAt:task?.updatedAt??null,
      updatedAt:latest([order.updatedAt,task?.updatedAt]),updatedAtOrigin:'order-and-task',
      receipt:!invalid?receipt:null,receiptHash:!invalid?view?.receiptHash:null,returnedHash,
      linkage:{...orderLink,task:hasTask?taskMatches?'verified':'mismatch':'not_supported',receipt:resultLink},
      reconciliationRequired:invalid});
  }
  // Never adopt orphan tasks, receipts or events that cannot bind to an authorized original order.
  const meta=state.meta;
  const known=object(meta) && Number.isSafeInteger(meta.sequence) && meta.sequence>=0 && id(meta.createdAt)
    && Number.isFinite(date(meta.updatedAt));
  return {id:sourceId,workspaceId:principal.workspaceId,visibility,userId:visibility==='private'?actor.subject:undefined,
    epoch:known?meta.createdAt:null,sequence:known?meta.sequence:null,
    observedAt:new Date(date(observedAt)).toISOString(),
    updatedAt:known?meta.updatedAt:latest(records.map(record=>record.updatedAt)),
    availability:'available',complete:true,records};
}

/**
 * Binds only the original read methods. readContext must recheck original scope
 * on every call. A full state digest detects torn reads when no persistent
 * sequence exists; the digest is NOT a replay cursor and never leaves the reader.
 */
export function createWorkspaceControlReader({readContext,readState,readMuseSession=async()=>[],
  sourceId='workspace-host',now=Date.now,maxAgeMs=60_000}={}) {
  if (typeof readContext!=='function' || typeof readState!=='function' || typeof readMuseSession!=='function'
    || typeof now!=='function' || !id(sourceId)) fail('CONTROL_HOST_READER_REQUIRED');
  async function read() {
    const context=await readContext(); // Authentication/epoch failures must propagate, not fall back to cached foreign data.
    controlScopeKey(context.principal);
    const observedAt=now();
    let source;
    try {
      const before=await readState();
      const museView=await readMuseSession();
      const after=await readState();
      const current=await readContext();
      if (controlScopeKey(current.principal)!==controlScopeKey(context.principal)
        || hash(current.binding??null)!==hash(context.binding??null)) fail('CONTROL_HOST_SCOPE_CHANGED');
      if (hash(before)!==hash(after)) fail('CONTROL_HOST_SNAPSHOT_CHANGED');
      source=adaptWorkspaceControlSource({...context,state:before,museView,sourceId,observedAt});
    } catch (error) {
      if (['CONTROL_HOST_SCOPE_CHANGED','WORKSPACE_PLUGIN_STALE','WORKSPACE_PLUGIN_OWNER','MUSE_OWNER_REQUIRED'].includes(error.code)) throw error;
      source={id:sourceId,workspaceId:context.principal.workspaceId,visibility:'private',userId:context.principal.userId,
        epoch:null,sequence:null,observedAt:null,updatedAt:null,availability:'unavailable',complete:false,records:[],
        reasonCode:id(error.code)?error.code:'CONTROL_HOST_UNAVAILABLE'};
    }
    return projectControlSnapshot({principal:context.principal,sources:[source],now:now(),maxAgeMs});
  }
  return Object.freeze({read,
    async replay(journal,options) {
      const snapshot=await read(),context=await readContext();
      return replayControlEvents(journal,{...options,principal:context.principal,snapshot});
    },
    async suggestions(options={}) { return recommendGoalSteps(await read(),{...options,now:now()}); },
  });
}
