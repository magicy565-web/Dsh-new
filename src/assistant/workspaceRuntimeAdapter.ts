import type { ThreadMessageLike } from '@assistant-ui/react';
import type { Artifact, Message, Run } from '../types';

export type WorkspaceMessageContext = {
  conversationId?: string;
  runs: Run[];
  artifacts: Artifact[];
  toolEventMessageIds?: ReadonlyMap<string, string>;
};

const toolNames = new Set(['workspace_input', 'workspace_propose_action', 'workspace_propose_muse_draft',
  'workspace_propose_supplier_profile', 'workspace_research', 'workspace_complete_preset_stage']);
type ToolObservation = { sequence: number; type: 'pi.tool.started' | 'pi.tool.finished' | 'pi.tool.failed'; toolName: string; toolCallId: string; createdAt?: string };
function toolObservation(value: unknown): value is ToolObservation {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return Number.isSafeInteger(event.sequence) && (event.sequence as number) > 0
    && ['pi.tool.started', 'pi.tool.finished', 'pi.tool.failed'].includes(String(event.type))
    && typeof event.toolName === 'string' && toolNames.has(event.toolName)
    && typeof event.toolCallId === 'string' && /^[a-f0-9]{64}$/.test(event.toolCallId);
}

/** Display only the original persisted ToolTask observations, never model text. */
export function workspaceToolObservationParts(run: Run): Exclude<ThreadMessageLike['content'], string> {
  const observations = (run.events || []).filter(toolObservation).sort((a, b) => a.sequence - b.sequence);
  const calls = new Map<string, ToolObservation>();
  for (const event of observations) {
    const previous = calls.get(event.toolCallId);
    if (previous && (previous.toolName !== event.toolName || previous.type !== 'pi.tool.started' && event.type === 'pi.tool.started')) continue;
    calls.set(event.toolCallId, event);
  }
  return [...calls.values()].map(event => {
    const phase = event.type === 'pi.tool.started' ? 'started' : event.type === 'pi.tool.finished' ? 'finished' : 'failed';
    const observation = { phase, sequence: event.sequence, createdAt: event.createdAt,
      source: 'persisted-workspace-tool-event', argumentsAvailable: false, resultAvailable: false };
    return { type: 'tool-call' as const, toolCallId: event.toolCallId, toolName: event.toolName,
      artifact: { workspaceObservation: observation },
      ...(phase !== 'started' ? { result: { workspaceObservation: observation }, isError: phase === 'failed' } : {}) };
  });
}

/** The existing Workspace Store remains the only message and run authority. */
export function workspaceMessageToThreadMessage(message: Message, context: WorkspaceMessageContext): ThreadMessageLike {
  const run = context.runs.find(value => value.id === message.runId && value.conversationId === message.conversationId);
  const reference = message.artifactReference;
  const artifact = context.artifacts.find(value => value.id === reference?.id
    && value.id === message.artifactId && value.sourceRunId === run?.id
    && value.sourceConversationId === message.conversationId);
  const version = artifact?.versions.find(value => value.version === reference?.version && value.sha256 === reference?.sha256);
  const verifiedArtifactReference = run && artifact && version && message.status === 'complete' && run.outputArtifactId === artifact.id
    ? { ...reference!, filename: version.filename, sourceRunId: run.id, sourceConversationId: message.conversationId }
    : undefined;
  const text = message.content || (message.error ? `${message.error.message} (${message.error.code})` : '');
  const showTools = message.role === 'assistant' && run
    && (!context.toolEventMessageIds || context.toolEventMessageIds.get(run.id) === message.id);
  const status: ThreadMessageLike['status'] = message.status === 'pending' && ['running', 'queued'].includes(run?.status || '')
    ? { type: 'running' } : message.status === 'cancelled'
      ? { type: 'incomplete', reason: 'cancelled' } : ['blocked', 'failed'].includes(message.status || '')
        ? { type: 'incomplete', reason: 'error', error: message.error?.message || run?.error?.message || '运行未完成。' }
        : { type: 'complete', reason: 'stop' };
  return {
    id: message.id,
    role: message.role,
    createdAt: new Date(message.createdAt),
    content: [{ type: 'text', text }, ...(showTools ? workspaceToolObservationParts(run) : [])],
    ...(message.role === 'assistant' ? { status } : {}),
    metadata: {
      custom: {
        workspaceMessage: message,
        workspaceMessageStatus: message.status,
        workspaceRequestId: message.requestId,
        verifiedArtifactReference,
        workspaceRun: run ? {
          id: run.id, conversationId: run.conversationId, status: run.status,
          // Persisted event records are data. They never authorize a tool call.
          events: run.events || [], plan: run.plan || [], proposals: run.proposals || [],
          selectedInput: run.inputContext, error: run.error,
        } : undefined,
      },
    },
  };
}

export function workspaceThreadMessages(messages: Message[], context: WorkspaceMessageContext): ThreadMessageLike[] {
  if (!context.conversationId) return [];
  const ownMessages = messages.filter(message => message.conversationId === context.conversationId);
  const toolEventMessageIds = new Map<string, string>();
  for (const message of ownMessages) if (message.role === 'assistant' && message.runId) toolEventMessageIds.set(message.runId, message.id);
  return ownMessages.map(message => workspaceMessageToThreadMessage(message, { ...context, toolEventMessageIds }));
}

/** Parse only the original change-notification contract; never interpret it as a Pi event. */
export function isWorkspaceRefreshNotification(data: string): boolean {
  try {
    const value: unknown = JSON.parse(data);
    return typeof value === 'object' && value !== null && 'bootstrap' in value
      && value.bootstrap === '/api/bootstrap' && 'sequence' in value
      && Number.isSafeInteger(value.sequence) && (value.sequence as number) >= 0;
  } catch { return false; }
}
