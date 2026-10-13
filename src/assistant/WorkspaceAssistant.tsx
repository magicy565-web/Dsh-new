import { createContext, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';
import { ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useAui } from '@assistant-ui/react';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import type { Artifact, Message, Run } from '../types';
import { ConversationFiles } from '../experience/ConversationFiles';
import { MuseMessageFiles } from '../experience/MuseFiles';
import type { MuseTask } from '../experience/museControl';
import { ProcurementMessage } from '../commerce/ConversationProcurement';
import { WorkspaceAssistantRuntime, useWorkspaceMessage } from './WorkspaceAssistantRuntime';
import './workspace-assistant.css';

type MessageContext = { artifacts: Artifact[]; runs: Run[]; museTasks: MuseTask[]; readOnly: boolean; busy: boolean; onCopy: (text: string) => Promise<void>; onSave: (message: Message) => Promise<void> };
const MessageContext = createContext<MessageContext>({ artifacts: [], runs: [], museTasks: [], readOnly: true, busy: false, onCopy: async () => {}, onSave: async () => {} });

function PreparedDraft({ text }: { text: string }) {
  const runtime = useAui();
  useEffect(() => { if (text) runtime.composer().setText(text); }, [text, runtime]);
  return null;
}

function WorkspaceTool({ toolName, artifact, result }: ToolCallMessagePartProps) {
  const value = result ?? artifact;
  const observation = value && typeof value === 'object' && 'workspaceObservation' in value ? value.workspaceObservation : undefined;
  const phase = observation && typeof observation === 'object' && 'phase' in observation ? observation.phase : undefined;
  const status = phase === 'started' ? '执行中' : phase === 'finished' ? '已完成' : phase === 'failed' ? '执行失败' : '状态待核对';
  return <details className="workspace-tool" data-tool-name={toolName} data-tool-phase={typeof phase === 'string' ? phase : 'unknown'}><summary>工具 · {toolName} · {status}</summary><p>来自原运行保存的工具状态。参数与结果正文不在此记录中；需要批准的动作请在任务运行卡中审阅。</p></details>;
}

function WorkspaceMessage() {
  const message = useWorkspaceMessage();
  const context = useContext(MessageContext);
  return <MessagePrimitive.Root className={`workspace-message workspace-message-${message?.role || 'assistant'}`}>
    <div className="workspace-message-label">{message?.role === 'user' ? '你的目标与补充' : message?.role === 'system' ? '运行记录' : 'Pi 工作结果'}</div>
    <div className="workspace-message-body">
      {message?.source === 'procurement' ? <ProcurementMessage message={message}/> : <MessagePrimitive.Content components={{ tools: { Fallback: WorkspaceTool } }}/>} 
      {message?.status === 'pending' && <p className="workspace-message-status" role="status">正在等待原运行返回…</p>}
      {message?.error?.message && <p className="workspace-message-error" role="status">{message.error.message}</p>}
      {message?.role === 'assistant' && <><ConversationFiles message={message} artifacts={context.artifacts} runs={context.runs} readOnly={context.readOnly}/><MuseMessageFiles message={message} tasks={context.museTasks} readOnly={context.readOnly}/></>}
    </div>
    {message?.role === 'assistant' && message.status === 'complete' && <div className="workspace-message-actions"><button type="button" aria-label="复制回复" onClick={() => void context.onCopy(message.content)}>复制回复</button><button type="button" aria-label="保存回复到资料库" disabled={context.readOnly || context.busy} onClick={() => void context.onSave(message)}>保存回复到资料库</button></div>}
  </MessagePrimitive.Root>;
}

export function WorkspaceAssistant({ conversationId, messages, runs, artifacts, museTasks, isRunning, isSendDisabled, readOnly, loading, configured, preparedDraft, mode, onMode, onNew, onCancel, onRefresh, onInputs, onGoal, onNote, onCopy, onSave, inputLabel, references, runCards, business, pendingSubmission, onRetrySubmission }: {
  conversationId?: string; messages: Message[]; runs: Run[]; artifacts: Artifact[]; museTasks: MuseTask[];
  isRunning: boolean; isSendDisabled: boolean; readOnly: boolean; loading: boolean; configured: boolean; preparedDraft: string; mode: 'task' | 'chat';
  onMode: (mode: 'task' | 'chat') => void; onNew: (text: string) => Promise<void>; onCancel: () => Promise<void>; onRefresh: () => Promise<void>;
  onInputs: () => void; onGoal: () => void; onNote: () => void; inputLabel: string; references: ReactNode; runCards: ReactNode; business: ReactNode;
  onCopy: (text: string) => Promise<void>; onSave: (message: Message) => Promise<void>;
  pendingSubmission?: string; onRetrySubmission: () => Promise<void>;
}) {
  return <WorkspaceAssistantRuntime conversationId={conversationId} messages={messages} runs={runs} artifacts={artifacts} isRunning={isRunning} isSendDisabled={isSendDisabled} readOnly={readOnly || loading} onNew={onNew} onCancel={onCancel} onRefresh={onRefresh}>
    <MessageContext.Provider value={{ artifacts, runs, museTasks, readOnly, busy: isSendDisabled, onCopy, onSave }}>
      <PreparedDraft text={preparedDraft}/>
      <ThreadPrimitive.Root className="workspace-assistant" data-testid="workspace-assistant" aria-label="Pi 工作任务">
        <header className="workspace-assistant-heading"><div><span className="workspace-assistant-eyebrow">WORKSPACE · PI</span><h1>{mode === 'task' ? '把业务目标推进为成果' : '先聊清楚，再开始任务'}</h1><p>{mode === 'task' ? '明确目标，选择可发送的输入，查看实际运行、审批与文件。' : '普通聊天用于讨论；切换到目标任务后才生成计划与文件草稿。'}</p></div><button type="button" className="secondary-button" onClick={onGoal} disabled={readOnly || isRunning || isSendDisabled}>新建长期目标</button></header>
        <ThreadPrimitive.Viewport className="workspace-thread-viewport">
          {loading ? <p className="workspace-thread-notice" role="status">正在读取当前会话与运行…</p> : messages.length === 0 && <section className="workspace-thread-empty"><h2>这次希望完成什么？</h2><p>写下成果、范围和限制。产品与企业资料可以先关联到会话；内部文件、价格与成本不会因此发送给 Pi 或外部 Worker。</p><button type="button" className="secondary-button" onClick={onInputs} disabled={readOnly}>审阅可发送的任务输入</button></section>}
          <ThreadPrimitive.Messages components={{ UserMessage: WorkspaceMessage, AssistantMessage: WorkspaceMessage }}/>
          {runCards}
          {business}
          <ThreadPrimitive.ScrollToBottom className="workspace-scroll-latest" aria-label="查看最新进展">查看最新进展</ThreadPrimitive.ScrollToBottom>
        </ThreadPrimitive.Viewport>
        <div className="workspace-assistant-dock">
          {references}
          <div className="workspace-input-toolbar"><div className="workspace-mode" role="group" aria-label="提交方式"><button type="button" aria-pressed={mode === 'task'} onClick={() => onMode('task')} disabled={isRunning || !!pendingSubmission}>目标任务</button><button type="button" aria-pressed={mode === 'chat'} onClick={() => onMode('chat')} disabled={isRunning || !!pendingSubmission}>普通聊天</button></div><button type="button" aria-label="选择任务输入" onClick={onInputs} disabled={isRunning}>{inputLabel}</button><button type="button" onClick={onNote} disabled={readOnly || isRunning}>保存笔记</button></div>
          <p className="workspace-input-boundary">资料库引用只用于本地关联。任务输入仅使用你另外明确选择、允许发送的公开文本与已授权动作。</p>
          {!configured && <p className="workspace-thread-notice" role="status">Pi 模型尚未由部署方配置。目标可以保存；提交后会显示真实阻挡原因。</p>}
          {pendingSubmission && <div className="workspace-submission-recovery" role="alert"><p>上次提交结果尚未确认，原内容与请求标识已保留。</p><details><summary>查看原提交内容</summary><pre>{pendingSubmission}</pre></details><button type="button" className="secondary-button" disabled={readOnly || isRunning || isSendDisabled} onClick={() => void onRetrySubmission().catch(() => {})}>核对原提交结果</button></div>}
          <ComposerPrimitive.Root className="composer workspace-composer">
            <ComposerPrimitive.Input aria-label={mode === 'task' ? '输入目标任务' : '输入消息'} placeholder={mode === 'task' ? '描述要完成的成果、范围与限制…' : '讨论业务问题…'} rows={2} maxLength={20000} disabled={readOnly || loading || !!pendingSubmission}/>
            {isRunning ? <ComposerPrimitive.Cancel className="workspace-composer-cancel" aria-label="停止任务" disabled={readOnly || isSendDisabled}>停止任务</ComposerPrimitive.Cancel> : <ComposerPrimitive.Send className="workspace-composer-send" aria-label={mode === 'task' ? '提交目标任务' : '发送消息'} disabled={readOnly || loading || isSendDisabled || !!pendingSubmission}>{mode === 'task' ? '提交任务' : '发送'}</ComposerPrimitive.Send>}
          </ComposerPrimitive.Root>
        </div>
      </ThreadPrimitive.Root>
    </MessageContext.Provider>
  </WorkspaceAssistantRuntime>;
}
