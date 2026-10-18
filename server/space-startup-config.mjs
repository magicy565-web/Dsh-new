/** Explicit operator opt-in; never derived from a request, plugin or model. */
export function spaceStartupOptions(environment, accessConfig) {
  const value = environment?.WORKSPACE_SPACE_ENABLED;
  if (value !== undefined && value !== '0' && value !== '1') throw new Error('WORKSPACE_SPACE_ENABLED must be exactly 0 or 1.');
  const enabled = value === '1';
  if (enabled && accessConfig?.mode !== 'enterprise') throw new Error('Space requires the original signed enterprise Host before enablement.');
  return Object.freeze({ enabled });
}

/** Private operator configuration narrows the existing Space authority only. */
export async function loadSpaceStartupOptions(environment = {}, accessConfig) {
  const options = spaceStartupOptions(environment, accessConfig);
  const filename = environment.WORKSPACE_SPACE_MEDUSA_REVIEW_FILE;
  const tokenFile = environment.WORKSPACE_SPACE_MEDUSA_READ_TOKEN_FILE;
  if (filename === undefined && tokenFile === undefined) return options;
  const invalid = () => { throw new Error('Space Medusa requires an explicit private review and dedicated read-token file for the original enterprise member; no private value was logged.'); };
  const [{ default: path }, { openPrivateFile }] = await Promise.all([import('node:path'), import('./store.mjs')]);
  if (!options.enabled || accessConfig?.mode !== 'enterprise' || typeof filename !== 'string' || !path.isAbsolute(filename)
    || typeof tokenFile !== 'string' || !path.isAbsolute(tokenFile) || filename === tokenFile) invalid();
  async function readPrivate(filename, maximum) {
    let handle;
    try {
      handle = await openPrivateFile(filename);
      const stat = await handle.stat();
      if (stat.size < 1 || stat.size > maximum || process.platform !== 'win32' && ((stat.mode & 0o077) !== 0
        || ![0, process.getuid()].includes(stat.uid))) invalid();
      const bytes = await handle.readFile();
      if (bytes.length < 1 || bytes.length > maximum) invalid();
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), identity: { dev: stat.dev, ino: stat.ino } };
    } catch { invalid(); } finally { await handle?.close(); }
  }
  let review, reviewFile;
  try { reviewFile = await readPrivate(filename, 16000); review = JSON.parse(reviewFile.text); } catch { invalid(); }
  const allowed = ['version', 'reviewed', 'sourceId', 'workspaceId', 'subject', 'role', 'baseURL', 'allowLoopbackHTTP', 'timeoutMs'];
  const members = accessConfig.members instanceof Map ? accessConfig.members
    : new Map((accessConfig.members || []).map(member => [member.subject, member.role]));
  if (!review || Object.getPrototypeOf(review) !== Object.prototype || Object.keys(review).some(key => !allowed.includes(key))
    || review.version !== 1 || review.reviewed !== true || review.workspaceId !== accessConfig.workspaceId
    || typeof review.subject !== 'string' || !['admin', 'operator', 'viewer'].includes(review.role)
    || members.get(review.subject) !== review.role
    || review.allowLoopbackHTTP !== undefined && typeof review.allowLoopbackHTTP !== 'boolean') invalid();
  const { subject, role, workspaceId } = review;
  const credential = await readPrivate(tokenFile, 4096);
  if (credential.identity.dev === reviewFile.identity.dev && credential.identity.ino === reviewFile.identity.ino) invalid();
  const connection = Object.freeze({ reviewed: true, sourceId: review.sourceId, workspaceId, baseURL: review.baseURL,
    ...(review.allowLoopbackHTTP !== undefined ? { allowLoopbackHTTP: review.allowLoopbackHTTP } : {}),
    ...(review.timeoutMs !== undefined ? { timeoutMs: review.timeoutMs } : {}), readToken: credential.text });
  if (environment.WORKSPACE_MEDUSA_SECRET_API_KEY && connection.readToken === environment.WORKSPACE_MEDUSA_SECRET_API_KEY) invalid();
  const { createMedusaApprovedSource } = await import('../plugins/workspace-medusa-catalog/src/approved-source.mjs');
  // Validate the original reader's origin/token contract before accepting startup.
  try { createMedusaApprovedSource({ connection, authorizeOriginal: () => false }); } catch { invalid(); }
  return Object.freeze({ enabled: true, medusaSourceFactory(assertCurrent) {
    if (typeof assertCurrent !== 'function') invalid();
    return createMedusaApprovedSource({ connection, authorizeOriginal: actor => actor?.workspaceId === workspaceId
      && actor.subject === subject && actor.role === role && assertCurrent(actor) === true });
  } });
}
