import { useCallback, useEffect, useRef, useState } from 'react';
import App from './App';
import { loadSession, loginSession, logoutSession } from './api';
import type { Session } from './api';
import { acceptSessionNavigation, configuredLoginPath, forgetSessionNavigation, rememberLoginReturn } from './sessionNavigation';
import { Orb } from './icons';

export default function SessionGate() {
  const [session, setSession] = useState<Session | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [expired, setExpired] = useState(false);
  const lock = useRef(false), generation = useRef(0);
  const check = useCallback(async () => {
    if (lock.current) return;
    lock.current = true; const current = ++generation.current; setLoading(true); setError('');
    try { const value = await loadSession(); if (current === generation.current) { acceptSessionNavigation(value); setSession(value); setExpired(false); } }
    catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : '无法验证访问状态'); }
    finally { lock.current = false; if (current === generation.current) setLoading(false); }
  }, []);
  useEffect(() => { void check(); const required = () => { generation.current++; setSession(null); setExpired(true); setLoading(false); }; window.addEventListener('workspace-session-required', required); return () => { window.removeEventListener('workspace-session-required', required); }; }, [check]);
  async function login() {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { const loginPath = configuredLoginPath(); if (loginPath) { rememberLoginReturn(); window.location.assign(loginPath); return; } const result = await loginSession(); acceptSessionNavigation(result); setSession(result); setExpired(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '登录未完成'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function logout() {
    if (lock.current) return; lock.current = true; setBusy(true);
    try { await logoutSession(); forgetSessionNavigation(); generation.current++; setSession(previous => previous ? { ...previous, authenticated: false, user: null, csrfToken: null } : null); setExpired(false); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '退出登录未完成'); throw cause; }
    finally { lock.current = false; setBusy(false); }
  }
  if (session?.authenticated) return <App session={session} onLogout={logout} />;
  return <main className="session-gate"><section aria-label="工作空间访问"><Orb /><h1>{loading ? '正在验证访问权限' : expired ? '会话已失效' : '打开共享工作空间'}</h1><p>{loading ? '正在安全地检查本地服务和登录状态。' : '企业身份验证由部署方的安全登录入口处理。此页面不会索取密码或密钥。'}</p>{expired && <p>为保护共享数据，已关闭当前工作空间视图。重新登录后可继续查看已保存的内容。</p>}{error && <p role="alert" className="management-error">{error}</p>}{!loading && <div className="session-actions"><button className="primary-button" disabled={busy} onClick={() => void login()}>{busy ? '正在登录…' : '使用企业身份继续'}</button><button className="secondary-button" disabled={busy} onClick={() => void check()}>重新检查访问</button></div>}<p className="field-help">如无法进入，请通过管理员提供的正式访问地址完成身份验证。不要把令牌粘贴到此页面。</p></section></main>;
}
