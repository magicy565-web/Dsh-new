import type { Session } from './api';
const identityKey = 'workspace.session.last-owner';
const returnKey = 'workspace.session.return';
const continuationKey = 'workspace.session.login-intent';
const owner = (session: Session) => JSON.stringify([session.workspaceId, session.user?.id]);
export function configuredLoginPath() {
  const value = import.meta.env.VITE_WORKSPACE_LOGIN_PATH;
  return typeof value === 'string' && /^\/[A-Za-z0-9/_-]+$/.test(value) && !value.startsWith('//') ? value : null;
}
function safeRoute(value: unknown): value is string {
  return typeof value === 'string' && /^\/(?:chat(?:\/[A-Za-z0-9_.:@-]+)?|home|commerce|workers|services|activity|ideas|goals(?:\/[A-Za-z0-9_.:@-]+)?|library(?:\/[A-Za-z0-9_/-]+)?)?$/.test(value);
}
export function rememberLoginReturn() {
  try { sessionStorage.setItem(continuationKey, String(Date.now())); sessionStorage.setItem(returnKey, JSON.stringify({ owner: sessionStorage.getItem(identityKey), path: safeRoute(location.pathname) ? location.pathname : '/' })); } catch { /* Login remains available without storage. */ }
}
export function consumeLoginContinuation() {
  try { const saved = Number(sessionStorage.getItem(continuationKey)); sessionStorage.removeItem(continuationKey); return saved > 0 && Date.now() >= saved && Date.now() - saved < 10 * 60 * 1000; } catch { return false; }
}
export function acceptSessionNavigation(session: Session) {
  if (!session.authenticated || !session.user) return;
  try {
    const saved = JSON.parse(sessionStorage.getItem(returnKey) || 'null');
    sessionStorage.removeItem(returnKey);
    if (saved?.owner === owner(session) && safeRoute(saved.path)) history.replaceState(null, '', saved.path);
    sessionStorage.setItem(identityKey, owner(session));
  } catch { /* Never infer identity from browser storage. */ }
}
export function forgetSessionNavigation() { try { sessionStorage.removeItem(identityKey); sessionStorage.removeItem(returnKey); sessionStorage.removeItem(continuationKey); } catch { /* No stored navigation. */ } }
