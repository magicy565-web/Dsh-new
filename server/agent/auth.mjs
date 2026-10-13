import { createHash, timingSafeEqual } from 'node:crypto';

export class AgentHttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
const sha = value => createHash('sha256').update(value).digest();
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9._@:+|/-]{1,128}$/.test(value);
const allowedScopes = new Set(['agent:read', 'agent:submit']);

/** Credentials bind existing Workspace members. They never establish accounts or roles. */
export function createAgentAuth({ principals, env = process.env, access } = {}) {
  if (!access?.serviceIdentity || !access?.beginServiceCredential) throw new Error('Agent credentials require the original Workspace access controller.');
  if (env.WS_AGENT_TOKENS || env.WS_AGENT_TOKEN_DIGESTS) throw new Error('Legacy Agent account maps are not identities. Bind their credential digests to existing members with WS_AGENT_PRINCIPALS.');
  let configured = principals;
  if (configured === undefined) {
    try { configured = JSON.parse(env.WS_AGENT_PRINCIPALS || '[]'); }
    catch { throw new Error('WS_AGENT_PRINCIPALS must be a JSON array of existing member bindings.'); }
  }
  if (!Array.isArray(configured) || configured.length > 500) throw new Error('Agent principal bindings must be a bounded array.');
  const seen = new Set();
  const rows = configured.map(binding => {
    if (!binding || Object.keys(binding).some(key => !['subject', 'workspaceId', 'tokenSha256', 'scopes', 'expiresAt', 'legacyAccountId'].includes(key)) ||
      !identifier(binding.subject) || !identifier(binding.workspaceId) || !/^[a-f0-9]{64}$/.test(binding.tokenSha256 || '') || seen.has(binding.tokenSha256) ||
      !Array.isArray(binding.scopes) || !binding.scopes.includes('agent:read') || binding.scopes.some(scope => !allowedScopes.has(scope)) ||
      binding.expiresAt !== undefined && (!Number.isFinite(Date.parse(binding.expiresAt)) || new Date(binding.expiresAt).toISOString() !== binding.expiresAt) ||
      binding.legacyAccountId !== undefined && !identifier(binding.legacyAccountId)) throw new Error('Invalid Agent member/scopes/digest binding.');
    access.serviceIdentity(binding);
    seen.add(binding.tokenSha256);
    return { binding: Object.freeze(structuredClone(binding)), digest: Buffer.from(binding.tokenSha256, 'hex') };
  });
  return Object.freeze({
    configured: rows.length > 0,
    legacyBindings: rows.filter(row => row.binding.legacyAccountId).map(row => ({ subject: row.binding.subject, workspaceId: row.binding.workspaceId, legacyAccountId: row.binding.legacyAccountId })),
    resolveTaskActor(task) {
      const row = rows.find(row => row.binding.subject === task.subject && row.binding.workspaceId === task.workspaceId && row.binding.scopes.includes('agent:submit'));
      if (!row) throw new AgentHttpError(403, '原任务所属成员的 Agent 执行授权已撤销。', { code: 'AGENT_AUTHORIZATION_REVOKED' });
      return access.serviceIdentity(row.binding, { write: true });
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
    watchStream(context, close) { return access.watchServiceStream(context, close); },
    recordDenial(error) { return access.recordDenial(error); },
  });
}
