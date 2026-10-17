import { BrainError } from '../plugins/workspace-goal-intelligence/src/contracts.mjs';

const route = /^\/api\/conversations\/([A-Za-z0-9][A-Za-z0-9_.:-]{0,127})\/brain\/(sources|context|diagnosis|brief|decisions(?:\/[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127})?|reviews(?:\/[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127})?|feedback)$/u;

/**
 * Original enterprise-Session HTTP projection for the Brain UI.
 *
 * GET routes are read-only. POST routes are limited to explicit human-owned
 * outcome review/feedback memory writes; context/decision authoring remains
 * Agent-run gated. No route dispatches a Worker or mutates an external business
 * system. The original access layer has already
 * verified the request body before this handler is invoked.
 */
export async function handleGoalBrainHttp({ pathname, method, context, host, body = {}, res, respond } = {}) {
  const match = pathname?.match(route);
  if (!match) return false;
  if (!['GET', 'POST'].includes(method)) throw new BrainError('BRAIN_HTTP_METHOD_NOT_ALLOWED');

  const resource = match[2];
  const isWrite = method === 'POST';
  if (!host) {
    if (isWrite) throw new BrainError('BRAIN_REVIEWED_HOST_NOT_ENABLED');
    await respond(res, 200, { plugin: 'workspace-goal-intelligence', status: 'unconfigured', reason: 'BRAIN_REVIEWED_HOST_NOT_ENABLED', modelCalls: 0 });
    return true;
  }
  if (!context?.subject || !context.workspaceId || !context.session?.id) throw new BrainError('BRAIN_SESSION_REQUIRED');
  if (isWrite && !['reviews', 'feedback'].includes(resource)) throw new BrainError('BRAIN_EXECUTION_INTENT_REQUIRED');
  const identity = { workspaceId: context.workspaceId, subject: context.subject, role: context.role, sessionId: context.session.id };
  const session = host.bind({ identity, conversationId: match[1], canSubmit: false, uiWrite: isWrite });

  if (!isWrite) {
    if (resource === 'decisions' || resource.startsWith('decisions/')) {
      const id = resource.slice('decisions/'.length);
      if (!id) throw new BrainError('BRAIN_INPUT_INVALID');
      const data = await session.brain.decisionRead({ id }, undefined, session.binding.receiver);
      session.assertLive();
      await respond(res, 200, data);
      return true;
    }
    if (resource === 'reviews' || resource.startsWith('reviews/')) {
      const id = resource.slice('reviews/'.length);
      if (!id) throw new BrainError('BRAIN_INPUT_INVALID');
      const data = await session.brain.reviewRead(id, undefined, session.binding.receiver);
      session.assertLive();
      await respond(res, 200, data);
      return true;
    }
    const methodName = { sources: 'sourceCatalog', context: 'contextRead', diagnosis: 'diagnose', brief: 'brief' }[resource];
    if (!methodName) throw new BrainError('BRAIN_ROUTE_NOT_FOUND');
    const data = await session.brain[methodName]({}, undefined, session.binding.receiver);
    session.assertLive();
    await respond(res, 200, data);
    return true;
  }

  const writeMethod = { reviews: 'reviewSave', feedback: 'feedbackSave' }[resource];
  if (!writeMethod || !body || typeof body !== 'object' || Array.isArray(body)) throw new BrainError('BRAIN_INPUT_INVALID');
  const data = await session.brain[writeMethod](body, undefined, session.binding.receiver);
  session.assertLive();
  await respond(res, 200, data);
  return true;
}
