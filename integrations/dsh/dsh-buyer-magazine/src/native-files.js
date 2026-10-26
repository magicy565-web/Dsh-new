import { createHash } from 'node:crypto';
import { compileDraft, fail, failure, MAX_HTML_BYTES } from './core.js';

const checkpoint = signal => { if (signal?.aborted) fail('MAGAZINE_CANCELLED'); };
const sameTarget = (fs, a, b) => fs.contains(a, b) && fs.contains(b, a);

/** A native workspace mutation only. Presentation remains the separate official tool. */
export async function generateInSession(ctx, issueJson, exec) {
  if (!exec?.agent?.session?.header?.cwd || !exec.agent.ctx || !exec.signal) fail('MAGAZINE_SESSION_REQUIRED');
  checkpoint(exec.signal);
  const draft = compileDraft(issueJson, { signal: exec.signal });
  const { fs } = ctx;
  try {
    const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
    const cwdTarget = await fs.resolve(cwd, { signal: exec.signal });
    const sessionRoot = await fs.resolve(exec.agent.session.header.cwd, { signal: exec.signal });
    if (!fs.contains(sessionRoot, cwdTarget)) fail('MAGAZINE_WORKSPACE_DENIED');
    // Only compiler-produced basenames, never a model-supplied directory or path.
    if (!/^buyer-magazine-[A-Za-z0-9_-]+-[a-f0-9]{12}\.html$/.test(draft.name)) fail('MAGAZINE_TARGET_CONFLICT');
    const options = { cwd: fs.processPath(cwdTarget), signal: exec.signal };
    const target = await fs.resolve(draft.name, options);
    const checkBoundary = async () => {
      checkpoint(exec.signal);
      const policy = ctx.sandboxPolicy.resolve({ session: exec.agent.session });
      if (!['workspace-write', 'danger-full-access'].includes(policy.mode)) fail('MAGAZINE_WORKSPACE_DENIED');
      const policyRoot = await fs.resolve(policy.workspaceRoot, { signal: exec.signal });
      const freshCwd = await fs.resolve(await ctx.workingDirectory.ensure(exec.agent, exec.signal), { signal: exec.signal });
      const fresh = await fs.resolve(draft.name, options);
      if (!sameTarget(fs, policyRoot, sessionRoot) || !sameTarget(fs, freshCwd, cwdTarget) ||
          !sameTarget(fs, fresh, target) || !fs.contains(sessionRoot, fresh) || !fs.contains(cwdTarget, fresh)) fail('MAGAZINE_WORKSPACE_DENIED');
      const entry = await fs.lstat(draft.name, { cwd: options.cwd }, exec.signal);
      if (entry && entry.type !== 'file') fail('MAGAZINE_TARGET_CONFLICT');
      return { policy, target: fresh };
    };
    let boundary = await checkBoundary();
    const existing = await fs.stat(target, exec.signal);
    let reused = false;
    if (existing) {
      if (existing.type !== 'file' || existing.size !== draft.data.length) fail('MAGAZINE_TARGET_CONFLICT');
      const bytes = await fs.readBytes(target, exec.signal, MAX_HTML_BYTES);
      const after = await fs.stat(target, exec.signal);
      if (after?.type !== 'file' || after.version !== existing.version || bytes.length !== draft.data.length ||
          createHash('sha256').update(bytes).digest('hex') !== draft.sha256) fail('MAGAZINE_TARGET_CONFLICT');
      await checkBoundary();
      reused = true;
    } else {
      ctx.emit('fs/observed', target, { kind: 'absent' }, exec);
      const intent = await ctx.waterfall('fs/write-intent', target, exec, () => ({ kind: 'createIfAbsent' }));
      if (intent?.kind !== 'createIfAbsent') fail('MAGAZINE_WRITE_DENIED');
      boundary = await checkBoundary();
      const outcome = await fs.writeText(boundary.target, draft.data.toString('utf8'), intent, exec.signal, boundary.policy);
      checkpoint(exec.signal);
      ctx.emit('fs/observed', boundary.target, { kind: 'present', version: outcome.version }, exec);
    }
    await checkBoundary();
    const confirmed = await fs.stat(target, exec.signal);
    if (confirmed?.type !== 'file' || confirmed.size !== draft.data.length) fail('MAGAZINE_TARGET_CONFLICT');
    const confirmedBytes = await fs.readBytes(target, exec.signal, MAX_HTML_BYTES);
    const stable = await fs.stat(target, exec.signal);
    if (stable?.version !== confirmed.version || createHash('sha256').update(confirmedBytes).digest('hex') !== draft.sha256) fail('MAGAZINE_TARGET_CONFLICT');
    await checkBoundary();
    checkpoint(exec.signal);
    if (reused) ctx.emit('fs/observed', target, { kind: 'present', version: stable.version }, exec);
    return { path: fs.processPath(target), name: draft.name, bytes: draft.data.length, sha256: draft.sha256,
      status: 'generated', presentation: 'pending-official-present', reused, draftOnly: true,
      externalImageCount: draft.externalImageCount, warningCount: draft.warningCount };
  } catch (error) {
    checkpoint(exec.signal);
    if (failure(error).code !== 'MAGAZINE_FAILED') throw error;
    // Never expose raw backend messages, causes, paths outside the generated file,
    // or return writeText's before/after source. Do not retry or widen permissions.
    fail('MAGAZINE_WRITE_FAILED');
  }
}
