export type Session = { mode: 'local' | 'enterprise'; authenticated: boolean; workspaceId: string; user: { id: string; role: 'admin' | 'operator' | 'viewer' } | null; csrfToken: string | null; expiresAt: string | null; idleExpiresAt: string | null };
let csrfToken: string | null = null;
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (path === '/session/login') headers['X-Workspace-Login'] = '1';
  // Bound only read-only status requests. A mutation's result must never be
  // described as cancelled merely because the browser stopped waiting for it.
  const bounded = method === 'GET' && ['/bootstrap', '/diagnostics', '/personal-worker', '/conversations/runtime', '/medusa/catalog/status'].includes(path);
  const controller = bounded ? new AbortController() : undefined;
  async function read(): Promise<T> {
    let response: Response;
    try { response = await fetch(`/api${path}`, { method, credentials: 'same-origin', ...(method === 'GET' ? { cache: 'no-store' as const } : {}), ...(controller ? { signal: controller.signal } : {}), headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch { throw new ApiError('暂时无法连接服务，请检查网络后重试', 0, 'NETWORK_ERROR'); }
    let result: any;
    try { result = await response.json(); } catch { if (response.status === 401 && !path.startsWith('/session')) { csrfToken = null; window.dispatchEvent(new CustomEvent('workspace-session-required')); } throw new ApiError('服务返回了无法识别的响应，请重试或联系部署管理员', response.status, 'INVALID_RESPONSE'); }
    if (!response.ok) {
      const code = result.code || result.error?.code;
      if ((response.status === 401 || code === 'MEMBERSHIP_REQUIRED' || code === 'CSRF_REJECTED') && !path.startsWith('/session')) {
        csrfToken = null;
        window.dispatchEvent(new CustomEvent('workspace-session-required'));
      }
      throw new ApiError(typeof result.error === 'string' ? result.error : result.error?.message || result.message || '操作未完成，请重试', response.status, code);
    }
    return result as T;
  }
  if (!bounded) return read();
  let timeout: number | undefined;
  try {
    return await Promise.race([read(), new Promise<never>((_, reject) => { timeout = window.setTimeout(() => { reject(new ApiError('读取服务状态超时，请检查服务进程后重试', 0, 'STATUS_TIMEOUT')); controller!.abort(); }, 10000); })]);
  } finally { if (timeout !== undefined) window.clearTimeout(timeout); }
}
export async function loadSession() { const session = await api<Session>('/session'); csrfToken = session.csrfToken; return session; }
export async function loginSession() { const session = await api<Session>('/session/login', 'POST', {}); csrfToken = session.csrfToken; return session; }
export async function logoutSession() { await api('/session/logout', 'POST', {}); csrfToken = null; }
export const requestId = () => crypto.randomUUID();
