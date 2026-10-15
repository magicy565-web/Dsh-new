import { createHash, timingSafeEqual } from 'node:crypto';

export class AgentHttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
const sha = value => createHash('sha256').update(value).digest();
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9._@:+|/-]{1,128}$/.test(value);
const allowedScopes = new Set(['agent:read', 'agent:submit']);
const uiFingerprint = (identity, binding) => sha(JSON.stringify({ ...identity, expiresAt: binding.expiresAt || null, credentialDigest: binding.tokenSha256 })).toString('hex');

/** Credentials bind existing Workspace members. They never establish accounts or roles. */
export function createAgentAuth({ principals, env = process.env, access, reservedTokenDigests = [] } = {}) {
  if (!access?.serviceIdentity || !access?.beginServiceCredential) throw new Error('Agent credentials require the original Workspace access controller.');
  if (env.WS_AGENT_TOKENS || env.WS_AGENT_TOKEN_DIGESTS) throw new Error('Legacy Agent account maps are not identities. Bind their credential digests to existing members with WS_AGENT_PRINCIPALS.');
  let configured = principals;
  if (configured === undefined) {
    try { configured = JSON.parse(env.WS_AGENT_PRINCIPALS || '[]'); }
    catch { throw new Error('WS_AGENT_PRINCIPALS must be a JSON array of existing member bindings.'); }
  }
  if (!Array.isArray(configured) || configured.length > 500) throw new Error('Agent principal bindings must be a bounded array.');
  if (!Array.isArray(reservedTokenDigests) || reservedTokenDigests.some(digest => digest != null && typeof digest !== 'string')) throw new Error('Reserved worker credential digests must be an array.');
  const reserved = new Set(reservedTokenDigests.filter(Boolean).map(digest => digest.toLowerCase()));
  const seen = new Set();
  const rows = configured.map(binding => {
    if (!binding || Object.keys(binding).some(key => !['subject', 'workspaceId', 'tokenSha256', 'scopes', 'expiresAt', 'legacyAccountId'].includes(key)) ||
      !identifier(binding.subject) || !identifier(binding.workspaceId) || !/^[a-f0-9]{64}$/.test(binding.tokenSha256 || '') || seen.has(binding.tokenSha256) ||
      !Array.isArray(binding.scopes) || !binding.scopes.includes('agent:read') || binding.scopes.some(scope => !allowedScopes.has(scope)) ||
      binding.expiresAt !== undefined && (!Number.isFinite(Date.parse(binding.expiresAt)) || new Date(binding.expiresAt).toISOString() !== binding.expiresAt) ||
      binding.legacyAccountId !== undefined && !identifier(binding.legacyAccountId)) throw new Error('Invalid Agent member/scopes/digest binding.');
    if (reserved.has(binding.tokenSha256)) throw new Error('Agent member credentials must not reuse an existing Dot, Muse or sourcing Worker token digest.');
    access.serviceIdentity(binding);
    seen.add(binding.tokenSha256);
    return { binding: Object.freeze(structuredClone(binding)), digest: Buffer.from(binding.tokenSha256, 'hex') };
  });
  function sessionActor(context, { write = false } = {}) {
    if (access.mode !== 'enterprise' || !context?.session || !context.claims)
      throw new AgentHttpError(403, 'Agent UI 需要原企业 Session。', { code: 'AGENT_UI_SESSION_REQUIRED' });
    return boundActor(context, { write });
  }
  function boundActor(context, { write = false } = {}) {
    const matches = rows.filter(row => row.binding.subject === context.subject && row.binding.workspaceId === context.workspaceId);
    if (!matches.length) throw new AgentHttpError(403, '当前成员没有现有 Agent principal 绑定。', { code: 'AGENT_PRINCIPAL_REQUIRED' });
    let selected;
    for (const row of matches) {
      try { access.serviceIdentity(row.binding); selected = row; if (!write || row.binding.scopes.includes('agent:submit')) break; }
      catch { /* An expired or revoked binding never lends scopes to another row. */ }
    }
    if (!selected) throw new AgentHttpError(403, '当前成员的 Agent 绑定已过期或撤销。', { code: 'AGENT_BINDING_REVOKED' });
    if (write && !selected.binding.scopes.includes('agent:submit'))
      throw new AgentHttpError(403, '当前成员没有 agent:submit 授权。', { code: 'AGENT_SUBMIT_SCOPE_REQUIRED' });
    if (write && !['admin', 'operator'].includes(context.role))
      throw new AgentHttpError(403, '当前企业角色不能执行 Agent 任务。', { code: 'AGENT_SUBMIT_ROLE_REQUIRED' });
    const identity = access.serviceIdentity(selected.binding, { write });
    if (identity.role !== context.role) throw new AgentHttpError(403, '原 Session 成员角色已变化。', { code: 'AGENT_BINDING_REVOKED' });
    return { ...identity, legacyAccountId: selected.binding.legacyAccountId || null,
      uiPermissionFingerprint: uiFingerprint(identity, selected.binding) };
  }
  return Object.freeze({
    configured: rows.length > 0,
    legacyBindings: rows.filter(row => row.binding.legacyAccountId).map(row => ({ subject: row.binding.subject, workspaceId: row.binding.workspaceId, legacyAccountId: row.binding.legacyAccountId })),
    resolveTaskActor(task) {
      const row = rows.find(row => row.binding.subject === task.subject && row.binding.workspaceId === task.workspaceId && row.binding.scopes.includes('agent:submit'));
      if (!row) throw new AgentHttpError(403, '原任务所属成员的 Agent 执行授权已撤销。', { code: 'AGENT_AUTHORIZATION_REVOKED' });
      const identity = access.serviceIdentity(row.binding, { write: true });
      return { ...identity, uiPermissionFingerprint: uiFingerprint(identity, row.binding) };
    },
    async authenticate(req, res, pathname) {
      const header = req.headers.authorization;
      const match = typeof header === 'string' && /^Bearer ([A-Za-z0-9._~-]{16,512})$/i.exec(header);
      const digest = sha(match ? match[1] : 'invalid-bearer');
      let selected;
      for (const row of rows) if (timingSafeEqual(row.digest, digest) && match) selected = row;
      if (!selected) throw new AgentHttpError(401, '未鉴权：请通过安全凭据注入提供有效的 Bearer token。');
      const context = await access.beginServiceCredential(req, res, pathname, selected.binding);
      return { ...context, legacyAccountId: selected.binding.legacyAccountId || null };
    },
    piTaskContext(actor, { delegation = false } = {}) {
      const identity = access.serviceIdentity(actor.credentialBinding, { write: true });
      return { version: 1, subject: identity.subject, workspaceId: identity.workspaceId, role: identity.role,
        authorityFingerprint: uiFingerprint(identity, actor.credentialBinding), allowSubagents: delegation === true };
    },
    authorizePiTask(context) {
      if (!context || context.version !== 1) throw new AgentHttpError(403, '原 Pi 任务授权缺失。', { code: 'PI_TASK_AUTHORIZATION_REVOKED' });
      const selected = rows.find(row => {
        try { const identity = access.serviceIdentity(row.binding, { write: true });
          return identity.subject === context.subject && identity.workspaceId === context.workspaceId && identity.role === context.role
            && uiFingerprint(identity, row.binding) === context.authorityFingerprint;
        } catch { return false; }
      });
      if (!selected) throw new AgentHttpError(403, '原成员、角色或本次 Pi 任务授权已变化。', { code: 'PI_TASK_AUTHORIZATION_REVOKED' });
      return access.serviceIdentity(selected.binding, { write: true });
    },
    watchStream(context, close) { return access.watchServiceStream(context, close); },
    sessionActor,
    // Host-internal reduced identity, never accepted from an HTTP request body.
    sessionReadActor(identity) {
      if (access.mode === 'enterprise') {
        const live = access.nativeSessionById(identity?.sessionId);
        if (!live || live.subject !== identity.subject || live.workspaceId !== identity.workspaceId || live.role !== identity.role)
          throw new AgentHttpError(401, 'Original Session expired or changed.', { code: 'SESSION_REQUIRED' });
      } else if (identity?.subject !== 'local-operator' || identity.workspaceId !== 'local' || identity.role !== 'admin' || identity.sessionId != null)
        throw new AgentHttpError(401, 'Use the original local Session identity.', { code: 'SESSION_REQUIRED' });
      return boundActor(identity);
    },
    watchSessionStream(context, close) {
      const sessionWatch = access.watchStream(context, close);
      const valid = () => { try { sessionActor(context); return sessionWatch.valid(); } catch { return false; } };
      const timer = setInterval(() => { if (!valid()) close(); }, 250); timer.unref();
      return { valid, stop: () => { clearInterval(timer); sessionWatch.stop(); } };
    },
    recordDenial(error) { return access.recordDenial(error); },
  });
}
