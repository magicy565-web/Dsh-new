import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { AssistantRuntimeProvider, MessageNotSentError, useAuiState, useExternalStoreRuntime, type AppendMessage, type AssistantRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import type { Artifact, Message, Run } from '../types';
import { isWorkspaceRefreshNotification, workspaceThreadMessages } from './workspaceRuntimeAdapter';

const convertedMessage = (message: ThreadMessageLike) => message;

export type WorkspaceAssistantRuntimeProps = {
  children: ReactNode;
  messages: Message[];
  runs: Run[];
  artifacts: Artifact[];
  conversationId?: string;
  isRunning: boolean;
  isSendDisabled?: boolean;
  readOnly?: boolean;
  onNew: (text: string) => Promise<void>;
  onCancel: () => Promise<void>;
  onRefresh?: () => Promise<void>;
};

/** Original message metadata is consumed by the existing verified file/business views. */
export function useWorkspaceMessage(): Message | undefined {
  return useAuiState(state => state.message.metadata.custom.workspaceMessage as Message | undefined);
}

export function WorkspaceAssistantRuntime({ children, messages, runs, artifacts, conversationId,
  isRunning, isSendDisabled = false, readOnly = false, onNew, onCancel, onRefresh }: WorkspaceAssistantRuntimeProps) {
  const converted = useMemo(() => workspaceThreadMessages(messages, { conversationId, runs, artifacts }),
    [messages, runs, artifacts, conversationId]);
  const refresh = useRef(onRefresh); refresh.current = onRefresh;
  const currentConversation = useRef(conversationId); currentConversation.current = conversationId;
  const runtimeRef = useRef<AssistantRuntime | null>(null);
  const hasRefresh = Boolean(onRefresh);
  useEffect(() => {
    if (!hasRefresh || typeof EventSource === 'undefined') return;
    let closed = false, reading = false, refreshAgain = false;
    const source = new EventSource('/api/events');
    const read = () => {
      if (closed || !refresh.current) return;
      if (reading) { refreshAgain = true; return; }
      reading = true;
      refreshAgain = false;
      void refresh.current().catch(() => {}).finally(() => {
        reading = false;
        if (refreshAgain && !closed) read();
      });
    };
    const changed = (event: MessageEvent<string>) => { if (isWorkspaceRefreshNotification(event.data)) read(); };
    source.addEventListener('change', changed as EventListener);
    // Initial connection and reconnection only refetch existing state. No submit/resume here.
    source.addEventListener('open', read);
    return () => { closed = true; source.close(); };
  }, [conversationId, hasRefresh]);

  const runtime = useExternalStoreRuntime({
    messages: converted,
    convertMessage: convertedMessage,
    isRunning,
    isSendDisabled,
    isDisabled: readOnly,
    onNew: async (message: AppendMessage) => {
      if (readOnly || isRunning || isSendDisabled) throw new MessageNotSentError('当前会话不可发送新消息。');
      if (message.role !== 'user' || message.content.some(part => part.type !== 'text') || message.attachments?.length)
        throw new MessageNotSentError('请使用原任务输入选择器添加确切文件版本。这里只接收文字消息。');
      const text = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n').trim();
      if (!text) return;
      // The original callback owns selected inputs, stable request IDs, admission and refresh.
      const submittedConversation = conversationId;
      try { await onNew(text); }
      catch (error) {
        // An unknown HTTP outcome is not evidence that nothing was submitted.
        // Keep its exact text available for the original callback's stable-ID retry.
        const composer = runtimeRef.current?.thread.composer;
        if (currentConversation.current === submittedConversation && composer && !composer.getState().text.trim()) composer.setText(text);
        throw error;
      }
    },
    onCancel: async () => { if (!readOnly && isRunning) await onCancel(); },
  });
  runtimeRef.current = runtime;
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
