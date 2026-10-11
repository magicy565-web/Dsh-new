import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { cloudId, cloudSha } from './museControl';
import { conversationApiPath } from '../conversationRoutes';

type Operation = 'prepare' | 'approve' | 'dispatch' | 'refresh' | 'cancel' | 'accept';
type Command = { operation: Operation; path: string; label: string; body: Record<string, unknown> };
const fields = (body: Record<string, unknown>, names: string[]) => Object.keys(body).every(key => names.includes(key));
function valid(command: Command, prefix: string, conversationId: string) {
  if (!command || typeof command.label !== 'string' || command.label.length > 180 || !command.body || typeof command.body !== 'object' || Array.isArray(command.body)) return false;
  if (command.operation === 'prepare') return command.path === prefix && fields(command.body, ['provider', 'conversationId', 'requestId', 'content', 'order']) && command.body.provider === 'muse' && command.body.conversationId === conversationId && cloudId(command.body.requestId);
  if (!command.path.startsWith(prefix + '/')) return false;
  const [orderId, operation, ...rest] = command.path.slice(prefix.length + 1).split('/');
  if (rest.length || !cloudId(orderId) || operation !== command.operation || !['approve', 'dispatch', 'refresh', 'cancel', 'accept'].includes(operation)) return false;
  return operation === 'refresh' ? !Object.keys(command.body).length : fields(command.body, ['confirmed', 'expectedReviewHash', ...(operation === 'accept' ? ['receiptHash'] : [])]) && command.body.confirmed === true && cloudSha(command.body.expectedReviewHash) && (operation !== 'accept' || cloudSha(command.body.receiptHash));
}

// Browser reconciliation only. The original Host owns every order, approval,
// request, task and lease; this record is never an execution queue or authority.
export function useMuseConversationCommand(scope: string, conversationId: string) {
  const prefix = conversationApiPath(conversationId, '/muse-delegations');
  const key = 'workspace.muse-conversation.pending.v1:' + encodeURIComponent(scope);
  const [pending, setPending] = useState<Command | null>(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(key) || 'null'); return saved?.version === 1 && saved.scope === scope && valid(saved.command, prefix, conversationId) ? saved.command : null; } catch { return null; }
  });
  const pendingRef = useRef(pending), lock = useRef(false), alive = useRef(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [storageError, setStorageError] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function persist(command: Command | null) {
    pendingRef.current = command;
    try { if (command) sessionStorage.setItem(key, JSON.stringify({ version: 1, scope, command })); else sessionStorage.removeItem(key); if (alive.current) setStorageError(false); }
    catch { if (alive.current) setStorageError(true); }
    if (alive.current) setPending(command);
  }
  async function perform(command: Command): Promise<Command | undefined> {
    if (lock.current || !valid(command, prefix, conversationId)) return;
    lock.current = true; persist(command); setBusy(true); setError('');
    try { await api(command.path, 'POST', command.body); persist(null); if (alive.current) return command; }
    catch (cause) {
      const unknown = cause instanceof ApiError && (cause.status === 0 || cause.code === 'INVALID_RESPONSE');
      if (!unknown) persist(null);
      if (alive.current) setError(unknown ? '提交结果待核对。请核对原请求，不要新建订单或再次派发。' : cause instanceof Error ? cause.message : '操作未完成。');
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return { pending, busy, error, storageError, uncertain: !!pending && !busy,
    write: (command: Command) => pendingRef.current ? Promise.resolve(undefined) : perform(command),
    retry: () => pendingRef.current ? perform(pendingRef.current) : Promise.resolve(undefined),
    clearError: () => setError('') };
}
