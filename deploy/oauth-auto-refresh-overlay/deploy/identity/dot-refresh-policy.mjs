const CLIENT = 'workspace-dot-chatgpt';
const DAY = 86400;

// Opt-in policy for the already registered ChatGPT client only. Existing
// token records, signing keys and the web login session are never migrated.
export function dotRefreshPolicy(config) {
  const value = config.dotPersistentAuthorization;
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(k => !['version', 'refreshIdleSeconds', 'grantSeconds'].includes(k))
    || value.version !== 1 || !Number.isSafeInteger(value.refreshIdleSeconds)
    || !Number.isSafeInteger(value.grantSeconds)
    || value.refreshIdleSeconds < DAY || value.grantSeconds < value.refreshIdleSeconds
    || value.refreshIdleSeconds > 30 * DAY || value.grantSeconds > 180 * DAY) {
    throw Error('Review a bounded version1 ChatGPT refresh policy: idle1..30 days, grant<=180 days.');
  }
  const original = source => source?.clientId === CLIENT
    && source.scopes?.has('workspace.dot')
    && source.resourceIndicators?.size === 1
    && source.resourceIndicators.has(config.resource);
  return Object.freeze({
    grantSeconds: value.grantSeconds,
    refreshIdleSeconds: value.refreshIdleSeconds,
    consent: `允许 xy 读取交办任务、执行任务并回传文件与结果。连接可后台自动续期，不依赖网页登录会话；连续 ${value.refreshIdleSeconds / DAY} 天未刷新或授权满 ${value.grantSeconds / DAY} 天需重新授权。可撤销连接，平台不授权新增付费消费。`,
    options: {
      expiresWithSession: (_ctx, source) => original(source) ? false : !source.scopes.has('offline_access'),
      rotateRefreshToken: true,
      async loadExistingGrant(ctx) {
        // Do not reuse old short consent when the registered client starts a
        // new authorization-code flow. Refresh itself never enters this flow.
        const grantId = ctx.oidc.result?.consent?.grantId
          || (ctx.oidc.client.clientId !== CLIENT ? ctx.oidc.session.grantIdFor(ctx.oidc.client.clientId) : undefined);
        return grantId ? ctx.oidc.provider.Grant.find(grantId) : undefined;
      },
    },
    grantTTL: (_ctx, token) => token.clientId === CLIENT && token.getResourceScope(config.resource).split(' ').includes('workspace.dot') ? value.grantSeconds : DAY,
    refreshTTL: (_ctx, token) => original(token) && !token.expiresWithSession
      ? Math.min(value.refreshIdleSeconds, Math.max(1, value.grantSeconds - token.totalLifetime()))
      : DAY,
  });
}
