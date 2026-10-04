import { randomUUID } from 'node:crypto';

const emptySelection = () => ({ artifacts: [], skills: [], memoryIds: [], connectorActions: [] });
export const isTemplateSchedule = schedule => schedule.goalMode === 'template';

/** The template includes explicit selected inputs, never implicit conversation history. */
export function scheduleGoalDefinition(schedule, source, state, defineGoal) {
  if (!isTemplateSchedule(schedule)) return defineGoal(source, state);
  const selected = source.inputContext ?? state.conversations?.find(item => item.id === source.conversationId)?.inputContext;
  return defineGoal({ ...source, inputContext: { ...emptySelection(), ...structuredClone(selected || {}) } }, state);
}

export function templateOccurrenceCount(schedule, state) {
  return Math.max(schedule.occurrenceCount || 0, state.capabilities.scheduleRuns.filter(run => run.scheduleId === schedule.id && run.goalMode === 'template' && run.goalId).length);
}

export function templateApprovalDetails(schedule, state) {
  const created = templateOccurrenceCount(schedule, state);
  return {
    maxOccurrences: schedule.maxOccurrences, createdOccurrences: created,
    remainingOccurrences: Math.max(0, schedule.maxOccurrences - created),
    budgetScope: 'per-occurrence', historyPolicy: 'fresh-conversation-selected-inputs-only',
    missedOccurrencePolicy: 'latest-only-no-backlog', overlapPolicy: 'skip-running-stop-unresolved',
    connectorApprovalPolicy: 'separate-exact-approval-per-action',
  };
}

export function assertTemplateDefinition(definition, state, fail) {
  if (!Number.isSafeInteger(definition.maxSteps) || definition.maxSteps < 1 || definition.maxSteps > 8 || !Number.isSafeInteger(definition.maxOutputTokens) || definition.maxOutputTokens < 1600 || definition.maxOutputTokens > 128000) fail(400, 'INVALID_TEMPLATE_BUDGET', 'The source goal must have a bounded 1–8 step and 1600–128000 output-token budget.');
  if (typeof definition.title !== 'string' || !definition.title.trim() || definition.title.length > 160 || typeof definition.description !== 'string' || definition.description.length > 20000) fail(400, 'INVALID_TEMPLATE_GOAL', 'The source goal needs a valid title and description.');
  for (const id of definition.inputContext.memoryIds || []) {
    const memory = state.memories?.find(item => item.id === id);
    if (memory?.conversationId) fail(400, 'TEMPLATE_MEMORY_SCOPE', 'Fresh occurrences cannot inherit conversation-scoped memory. Select workspace-scoped memories on the source goal instead.');
  }
}

/** No new goal while previous work can still execute or requires human intervention. */
export function previousTemplateOccurrence(schedule, state) {
  const previous = [...state.capabilities.scheduleRuns].reverse().find(run => run.scheduleId === schedule.id && run.goalMode === 'template' && run.goalId);
  if (!previous) return { status: 'ready' };
  const goal = state.goals.find(item => item.id === previous.goalId);
  if (goal && ['review_required', 'completed'].includes(goal.status)) return { status: 'ready', goalId: goal.id };
  if (goal && ['running', 'queued'].includes(goal.status)) return { status: 'busy', goalId: goal.id };
  if (previous.status === 'dispatching') return { status: 'busy', goalId: previous.goalId };
  return { status: 'blocked', goalId: previous.goalId, error: { code: 'PREVIOUS_OCCURRENCE_UNRESOLVED', message: 'The previous occurrence is waiting for approval, failed, paused, cancelled, missing, or uncertain. Resolve it and review a new schedule approval before creating another goal.' } };
}

/** Called only within the durable claim transaction, before any model admission. */
export function createTemplateOccurrence(state, schedule, claim, definition, at) {
  const occurrence = { scheduleId: schedule.id, scheduleRunId: claim.id, scheduleRevision: schedule.revision, sourceGoalId: schedule.goalId, dueAt: claim.dueAt, ordinal: templateOccurrenceCount(schedule, state) + 1 };
  const conversation = { id: randomUUID(), title: `${definition.title.slice(0, 125)} · ${claim.dueAt}`, inputContext: structuredClone(definition.inputContext), createdAt: at, updatedAt: at, status: 'idle', lastError: null, activeRunId: null, scheduleOccurrence: occurrence };
  const goal = { id: randomUUID(), title: definition.title, description: definition.description, conversationId: conversation.id, inputContext: structuredClone(definition.inputContext), status: 'draft', stepCount: 0, maxSteps: definition.maxSteps, maxOutputTokens: definition.maxOutputTokens, outputTokens: 0, output: '', nextStep: '', lastError: null, createdAt: at, updatedAt: at, revision: 0, runId: null, requestId: claim.requestId, actionRequests: [], scheduleOccurrence: occurrence };
  state.conversations.push(conversation); state.goals.push(goal);
  state.messages.push({ id: randomUUID(), conversationId: conversation.id, role: 'user', content: `${definition.title}${definition.description ? `\n\n${definition.description}` : ''}`, status: 'complete', createdAt: at, requestId: `${claim.requestId}-input`, goalId: goal.id });
  schedule.occurrenceCount = occurrence.ordinal;
  return goal;
}
