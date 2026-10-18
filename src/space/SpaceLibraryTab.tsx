import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Session } from '../api';
import { SpacePanel } from './SpacePanel';

/** Reuses the original login; no new token, account, mock data or persistence. */
export function SpaceLibraryTab({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true, invalidated = false;
    const clear = () => { invalidated = true; setSession(null); setLoading(false); setError('企业会话已失效，请通过原登录入口重新进入。'); };
    window.addEventListener('workspace-session-required', clear);
    api<Session>('/session').then(value => { if (active && !invalidated) setSession(value); })
      .catch(reason => { if (active && !invalidated) setError(reason instanceof Error ? reason.message : '无法读取企业会话。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; window.removeEventListener('workspace-session-required', clear); };
  }, []);
  useEffect(() => () => onDirty(false), [onDirty]);
  if (loading) return <p role="status">正在核对企业会话…</p>;
  if (error || !session) return <p role="alert">{error || '请通过原企业登录入口进入。'}</p>;
  return <SpacePanel session={session} onDirty={onDirty} />;
}
