import { createHash } from 'node:crypto';
import { pluginFields, pluginFail, pluginId } from './workspace-plugin-config.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'expired']);
const deny = message => pluginFail('WORKSPACE_DOT_HISTORY_REVIEW', message);

/** Host-only inspection of settled history. Never creates or accepts a task. */
export async function inspectReviewedDotHistory({ ctx, service, operators, ownerSubject, authorizePublicTask, review }) {
  pluginFields(review, ['expectedEpoch', 'configurationHash', 'requestId', 'connectionId', 'authorizationEpoch', 'historyHash']);
  const lifecycle = service.status();
  if (!pluginId(review.requestId) || !pluginId(review.connectionId) || !Number.isSafeInteger(review.authorizationEpoch)
    || !['paused', 'active'].includes(lifecycle.phase) || lifecycle.epoch !== review.expectedEpoch
    || lifecycle.configurationHash !== review.configurationHash
    || lifecycle.phase === 'paused' && lifecycle.previousConfigurationHash !== lifecycle.configurationHash
    || lifecycle.unfinishedDelegations || lifecycle.reconciliationRequired || lifecycle.pendingOperations) {
    deny('Review the unchanged paused Host, current epoch and original connection with no unfinished operations.');
  }
  const owner = operators.find(actor => actor.subject === ownerSubject);
  if (!owner) deny('Preserve the original reviewed Worker owner.');
  const view = await service.bindActor(owner).view(), connection = view.worker?.connection;
  if (!connection || connection.provider !== 'dot' || connection.id !== review.connectionId
    || connection.authorizationEpoch !== review.authorizationEpoch || !connection.pausedAt
    || connection.drainingAt || connection.revokedAt) deny('Review the exact paused original dot connection.');
  const native = [], nativeSnapshots = [], taskJobs = new Set();
  for (const actor of operators) {
    const agent = ctx.agents.get(actor.nativeAgentId);
    if (!agent || !agent.session || typeof agent.session.ownEvents !== 'function') deny('Every original native Session must be live.');
    const tasks = await service.bindDotTasks(actor).view(), events = agent.session.ownEvents();
    const goal = ctx.goals.get(agent);
    nativeSnapshots.push({ agent, goalHash: hash(goal ?? null), eventsHash: hash(events) });
    let pendingQuestion = null;
    if (goal && !(goal.phase === 'complete' && tasks.some(task => task.goalId === goal.id
      && task.acceptedHash && goal.revision === task.goalRevision + 2))) {
      // An original browser request may have been persisted before the paused
      // business service rejected dispatch. Preserve it; recovery does not retry it.
      const index = events.findIndex(event => event.type === 'goal/change'
        && event.data.operation === 'create' && event.data.goal?.id === goal.id);
      const admission = events[index - 1], created = events[index];
      const messages = admission?.type === 'agent/inbox/spliced' ? admission.data.inserted : [];
      let input;
      try { input = JSON.parse(messages[0]?.content?.[0]?.text); } catch { /* Deny below. */ }
      if (goal.phase !== 'active' || goal.revision !== 1 || tasks.some(task => task.goalId === goal.id)
        || messages.length !== 1 || messages[0].role !== 'user' || messages[0].source?.kind !== 'user'
        || !pluginId(input?.requestId) || input?.confirmed !== true || input?.dataScope !== 'public-only'
        || input?.content !== goal.objective || !created?.data.goal
        || Object.entries(created.data.goal).some(([key, value]) => JSON.stringify(goal[key]) !== JSON.stringify(value))
        || goal.maxGoalRounds !== 1 || goal.roundsStarted !== 0 || goal.activation !== 'disarmed'
        || created.data.roundsStarted !== 0 || goal.createdAt !== created.data.createdAt || goal.updatedAt !== created.data.updatedAt
        || messages[0].id !== 'xy-input-' + hash([agent.id, input.requestId])
        || events.slice(index + 1).some(event => event.type === 'goal/change')
        || typeof authorizePublicTask !== 'function' || await authorizePublicTask({ agent, goal: structuredClone(goal) }) !== true) {
        deny('Preserve only the exact original confirmed public input and unchanged undispatched Goal.');
      }
      pendingQuestion = { requestId: input.requestId, inputHash: hash(input), messageId: messages[0].id,
        goalId: goal.id, goalRevision: goal.revision, goalStateHash: hash(goal) };
    }
    const records = [];
    for (const task of tasks) {
      const receipt = task.receipt;
      if (!task.ready || !task.jobId || taskJobs.has(task.jobId) || !receipt || !terminal.has(receipt.state)
        || receipt.taskRef !== task.jobId || receipt.goalId !== task.goalId
        || receipt.nativeAgentId !== actor.nativeAgentId || receipt.goalRevision !== task.goalRevision
        || receipt.requestId !== task.requestId || hash(receipt) !== task.receiptHash
        || task.returnedHash !== task.receiptHash) deny('Every original task must have its exact terminal receipt durably returned.');
      if (receipt.state === 'succeeded') {
        if (task.acceptedHash !== task.receiptHash || task.acceptedBy !== actor.subject || task.closedHash) deny('Successful history requires its original requester acceptance.');
      } else if (task.closedHash !== task.receiptHash || task.closedBy !== actor.subject || task.acceptedHash) {
        deny('Unsuccessful history requires its original requester closure.');
      }
      for (const file of receipt.files ?? []) {
        await service.bindDotTasks(actor).download({ artifactId: file.id, version: file.version, sha256: file.sha256 });
      }
      const returned = events.flatMap(event => event.type === 'agent/inbox/spliced' ? event.data.inserted : [])
        .filter(message => message.id === 'workspace-dot-result-' + task.jobId);
      if (returned.length !== 1 || returned[0].source?.kind !== 'workspace-dot'
        || returned[0].content?.[0]?.text !== JSON.stringify(receipt)) deny('Preserve the exact original Session receipt.');
      const settled = events.some(event => event.type === 'goal/change' && (receipt.state === 'succeeded'
        ? event.data.operation === 'complete' && event.data.goal?.id === task.goalId
          && event.data.goal.phase === 'complete' && event.data.goal.revision === task.goalRevision + 2
        : event.data.operation === 'clear' && event.data.cleared?.id === task.goalId
          && event.data.cleared.revision === task.goalRevision + 2));
      if (!settled) deny('Original durable Goal acceptance or closure must match each historical receipt.');
      taskJobs.add(task.jobId);
      records.push({ requestId: task.requestId, goalId: task.goalId, goalRevision: task.goalRevision,
        jobId: task.jobId, receiptHash: task.receiptHash, acceptedHash: task.acceptedHash ?? null,
        closedHash: task.closedHash ?? null });
    }
    native.push({ subject: actor.subject, nativeAgentId: actor.nativeAgentId,
      goal: goal ? { id: goal.id, phase: goal.phase, revision: goal.revision } : null,
      pendingQuestion,
      tasks: records.sort((a, b) => a.requestId.localeCompare(b.requestId)) });
  }
  if (!taskJobs.size || view.delegations.length !== taskJobs.size
    || view.delegations.some(job => !taskJobs.has(job.id) || !terminal.has(job.state)
      || job.connectionId !== connection.id || job.reconciliationRequired)) {
    deny('Review all original delegations; empty, orphaned or paginated history cannot use this recovery.');
  }
  const jobs = view.delegations.map(job => ({ id: job.id, state: job.state, attemptId: job.attemptId,
    fence: job.fence, completionHash: job.completionHash ?? null })).sort((a, b) => a.id.localeCompare(b.id));
  const summary = { ownerSubject, lifecycle: { phase: lifecycle.phase, epoch: lifecycle.epoch, configurationHash: lifecycle.configurationHash },
    workerId: view.worker.id, connectionId: connection.id,
    grantId: connection.grantId, authorizationEpoch: connection.authorizationEpoch,
    native: native.sort((a, b) => a.nativeAgentId.localeCompare(b.nativeAgentId)), jobs };
  const final = service.status();
  if (nativeSnapshots.some(item => ctx.agents.get(item.agent.id) !== item.agent
    || hash(ctx.goals.get(item.agent) ?? null) !== item.goalHash || hash(item.agent.session.ownEvents()) !== item.eventsHash)
    || final.phase !== lifecycle.phase || final.epoch !== lifecycle.epoch
    || final.configurationHash !== lifecycle.configurationHash || final.unfinishedDelegations
    || final.reconciliationRequired || final.pendingOperations) deny('The original Host changed during inspection.');
  return { historyHash: hash(summary), summary, connection, owner };
}

/** A new private action; the strict empty-mount recovery remains unchanged. */
export async function resumeReviewedDotHistory(options) {
  const inspected = await inspectReviewedDotHistory(options);
  if (!/^[a-f0-9]{64}$/.test(options.review.historyHash) || options.review.historyHash !== inspected.historyHash) {
    deny('The approved exact history digest changed.');
  }
  const { service, review } = options;
  const resumedScope = inspected.summary.lifecycle.phase === 'paused';
  if (resumedScope) await service.resume({ expectedEpoch: review.expectedEpoch, configurationHash: review.configurationHash,
    requestId: review.requestId + '-scope' });
  try {
    const connection = (await service.bindActor(inspected.owner).resumeConnection({ connectionId: review.connectionId,
      requestId: review.requestId + '-connection' })).worker.connection;
    return { lifecycle: service.status(), connection, historyHash: inspected.historyHash };
  } catch (error) {
    if (resumedScope) {
      const current = service.status();
      await service.pause({ expectedEpoch: current.epoch, configurationHash: current.configurationHash,
        requestId: review.requestId + '-failed' });
    }
    throw error;
  }
}
