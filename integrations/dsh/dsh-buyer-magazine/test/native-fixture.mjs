import { posix } from 'node:path';

/** In-memory capability fixture, not a real Host or Agent. */
export function memoryHost() {
  const state = { root: '/synthetic-workspace', cwd: '/synthetic-workspace', mode: 'workspace-write', writes: 0, observations: [], intentCalls: 0, policies: [], version: 0 };
  const files = new Map([[state.root, { type: 'directory', version: 'dir-v1' }]]);
  const fs = {
    async resolve(path, options = {}) {
      options.signal?.throwIfAborted();
      const name = posix.resolve(options.cwd ?? state.root, path);
      const entry = files.get(name);
      const canonical = entry?.type === 'symlink' ? entry.target : name;
      return { targetKey: canonical, displayPath: canonical };
    },
    processPath(target) { return target.displayPath; },
    contains(parent, child) { const path = posix.relative(parent.targetKey, child.targetKey); return path === '' || (!path.startsWith('../') && path !== '..' && !posix.isAbsolute(path)); },
    async lstat(path, options, signal) { signal?.throwIfAborted(); return files.get(posix.resolve(options.cwd, path)); },
    async stat(target, signal) { signal?.throwIfAborted(); const entry = files.get(target.targetKey); return entry && { type: entry.type, version: entry.version, size: entry.data?.length }; },
    async readBytes(target, signal, limit) { signal?.throwIfAborted(); const data = files.get(target.targetKey)?.data; if (!data || data.length > limit) throw new Error('synthetic bounded read failure'); return Buffer.from(data); },
    async writeText(target, content, intent, signal, policy) {
      state.beforeWrite?.(); signal?.throwIfAborted(); state.policies.push(policy);
      if (intent.kind !== 'createIfAbsent' || files.has(target.targetKey)) throw new Error('synthetic create-only conflict');
      const data = Buffer.from(content); const version = 'file-v' + ++state.version;
      files.set(target.targetKey, { type: 'file', data, version }); state.writes++;
      state.afterWrite?.(); return { operation: 'create', version, before: null, after: content };
    },
  };
  const ctx = {
    fs,
    workingDirectory: { async ensure(_agent, signal) { signal.throwIfAborted(); return state.cwd; } },
    sandboxPolicy: { resolve({ session }) { return { mode: state.mode, workspaceRoot: session.header.cwd }; } },
    emit(name, target, observation, actor) { state.observations.push({ name, target, observation, actor }); },
    async waterfall(name, target, actor, next) { state.intentCalls++; state.intentHook?.(); return state.intent ?? next(); },
  };
  const controller = new AbortController();
  const exec = { agent: { session: { header: { cwd: state.root } }, ctx: {} }, signal: controller.signal };
  return { ctx, exec, controller, state, files };
}
