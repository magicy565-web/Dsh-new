import { useEffect, useRef, useState } from 'react';
import { api, ApiError, requestId } from '../api';

export type SupplyAction = 'supplier.create' | 'listing.create' | 'listing.update' | 'inquiry.create' | 'inquiry.bind' | 'inquiry.reply' | 'supplier.publish' | 'supplier.unpublish' | 'listing.publish' | 'listing.unpublish' | 'shopify.observe';
type Command = { action: SupplyAction; label: string; path: string; method: 'POST' | 'PATCH'; body: Record<string, unknown> };
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const routes: Record<SupplyAction, RegExp> = {
  'supplier.create': /^\/supply\/suppliers$/, 'listing.create': /^\/supply\/listings$/, 'inquiry.create': /^\/supply\/inquiries$/,
  'listing.update': new RegExp(`^/supply/listings/${uuid}$`, 'i'),
  'inquiry.bind': new RegExp(`^/supply/inquiries/${uuid}/conversation$`, 'i'), 'inquiry.reply': new RegExp(`^/supply/inquiries/${uuid}/reply$`, 'i'),
  'supplier.publish': new RegExp(`^/supply/suppliers/${uuid}/publish$`, 'i'), 'supplier.unpublish': new RegExp(`^/supply/suppliers/${uuid}/unpublish$`, 'i'),
  'listing.publish': new RegExp(`^/supply/listings/${uuid}/publish$`, 'i'), 'listing.unpublish': new RegExp(`^/supply/listings/${uuid}/unpublish$`, 'i'),
  'shopify.observe': /^\/supply\/shopify\/observe$/,
};
function restoredCommand(key: string, scope: string): Command | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null'), value = saved?.command;
    if (saved?.version !== 1 || saved.scope !== scope || !value || !Object.hasOwn(routes, value.action) || !routes[value.action as SupplyAction].test(value.path) || value.method !== (value.action === 'listing.update' ? 'PATCH' : 'POST') || typeof value.label !== 'string' || value.label.length > 180 || !value.body || typeof value.body !== 'object' || !new RegExp(`^${uuid}$`, 'i').test(value.body.requestId)) return null;
    return value;
  } catch { return null; }
}

// Only an explicit retry may replay an unknown commit. Credentials and CSRF are
// supplied by the existing API client; this scoped record contains neither.
export function useSupplyCommand(scope: string) {
  const key = `workspace.supply.pending.v1:${encodeURIComponent(scope)}`;
  const [pending, setPending] = useState<Command | null>(() => restoredCommand(key, scope));
  const pendingRef = useRef(pending), lock = useRef(false), alive = useRef(true);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(!!pending), [conflict, setConflict] = useState(false);
  const [error, setError] = useState(''), [storageError, setStorageError] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function persist(command: Command | null) {
    pendingRef.current = command;
    try { if (command) sessionStorage.setItem(key, JSON.stringify({ version: 1, scope, command })); else sessionStorage.removeItem(key); if (alive.current) setStorageError(false); }
    catch { if (alive.current) setStorageError(true); }
    if (alive.current) setPending(command);
  }
  async function perform(command: Command): Promise<Command | undefined> {
    if (lock.current) return;
    lock.current = true; persist(command); setBusy(true); setError(''); setConflict(false);
    try {
      await api(command.path, command.method, command.body);
      persist(null); if (alive.current) { setUncertain(false); return command; }
    } catch (cause) {
      const unknown = cause instanceof ApiError && (cause.status === 0 || cause.code === 'INVALID_RESPONSE');
      if (!unknown) persist(null);
      if (alive.current) {
        setUncertain(unknown); setConflict(cause instanceof ApiError && ['SUPPLY_REVISION_CONFLICT', 'REVISION_CONFLICT'].includes(cause.code || ''));
        setError(unknown ? '尚未确认保存结果，请用原请求核对，避免重复创建或发布。' : cause instanceof Error ? cause.message : '保存失败，请重试。');
      }
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return {
    pending, busy, uncertain, conflict, error, storageError,
    write: (action: SupplyAction, label: string, path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>) => pendingRef.current ? Promise.resolve(undefined) : perform({ action, label, path, method, body: { ...body, requestId: requestId() } }),
    retry: () => pendingRef.current ? perform(pendingRef.current) : Promise.resolve(undefined),
    clearError: () => { setError(''); setConflict(false); },
  };
}
