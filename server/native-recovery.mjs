/** Native offline recovery through the reviewed public persistence API. No agent, model or profile boots here. */
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, readdir, realpath, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const RUNTIME_VERSION = '0.2.0-rc.2';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const generation = /^session(?:\.v([1-9][0-9]*))?\.jsonl(\.zstd)?$/;
const privateInfo = info => info.isDirectory() || (info.isFile() && (info.mode & 0o111) === 0);
// Semantic durable-log boundaries, not proof of an individual flush or derived-cache file.
const checkpointTypes = new Set(['request/header', 'turn/end', 'session/end-seed']);

async function directory(name, absent = false) {
  let info;
  try { info = await lstat(name); } catch (error) { if (absent && error.code === 'ENOENT') return false; throw error; }
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(name) !== name) fail('NATIVE_RECOVERY_LAYOUT', 'Native recovery requires canonical real directories.');
  return true;
}

/** Inventory only canonical session generations and their persistent POSIX lock files. */
async function inventory(root, compression) {
  if (!path.isAbsolute(root) || path.resolve(root) !== root) fail('NATIVE_RECOVERY_ROOT', 'Native recovery requires an absolute canonical session root.');
  if (!await directory(root, true)) return [];
  const result = [];
  for (const project of await readdir(root)) {
    const projectPath = path.join(root, project);
    await directory(projectPath);
    if (project !== '_no-cwd' && !/^--.+--$/.test(project)) fail('NATIVE_RECOVERY_LAYOUT', 'Unsupported native project directory.');
    for (const encodedId of await readdir(projectPath)) {
      const dir = path.join(projectPath, encodedId); await directory(dir);
      const names = await readdir(dir), versions = [];
      for (const name of names) {
        const info = await lstat(path.join(dir, name));
        if (!privateInfo(info) || !info.isFile() || info.isSymbolicLink()) fail('NATIVE_RECOVERY_LAYOUT', 'Native recovery accepts only non-executable regular session files.');
        if (name === 'session.lock') continue;
        const match = generation.exec(name);
        if (!match || (compression !== undefined && Boolean(match[2]) !== (compression === 'zstd'))) fail('NATIVE_RECOVERY_LAYOUT', 'Unsupported native session file or compression.');
        const version = Number(match[1] || 0);
        if (!Number.isSafeInteger(version) || version > 4) fail('NATIVE_RECOVERY_FORMAT', 'Native session format is newer than the reviewed recovery runtime.');
        versions.push(version);
      }
      if (versions.length === 0 || new Set(versions).size !== versions.length) fail('NATIVE_RECOVERY_LAYOUT', 'Native session directory has missing or duplicate generations.');
      const id = encodedId.replace(/~([0-9A-F]{4})/g, (_match, code) => String.fromCharCode(parseInt(code, 16)));
      if (!id || id.length > 1024) fail('NATIVE_RECOVERY_LAYOUT', 'Invalid native session identity.');
      result.push({ id, dir, versions: versions.sort((a, b) => a - b), names: names.sort() });
      if (result.length > 10_000) fail('NATIVE_RECOVERY_LIMIT', 'Native recovery session limit exceeded.');
    }
  }
  if (new Set(result.map(item => item.id)).size !== result.length) fail('NATIVE_RECOVERY_LAYOUT', 'Duplicate native session identity.');
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

/** Fold the public durable inbox-splice vocabulary without creating an Agent. */
function pendingInbox(events) {
  const state = { 'next-step': [], 'next-turn': [] };
  for (const event of events) {
    if (event.type !== 'agent/inbox/spliced') continue;
    const { target, start, removedCount = 0, inserted } = event.data;
    if (!Object.hasOwn(state, target) || !Number.isSafeInteger(start) || start < 0 || start > state[target].length
      || !Number.isSafeInteger(removedCount) || removedCount < 0 || start + removedCount > state[target].length || !Array.isArray(inserted)) fail('NATIVE_RECOVERY_INBOX', 'Native inbox history cannot be safely recovered.');
    state[target].splice(start, removedCount, ...inserted);
    const messages = [...state['next-step'], ...state['next-turn']];
    if (messages.some(item => !item || typeof item.id !== 'string') || new Set(messages.map(item => item.id)).size !== messages.length) fail('NATIVE_RECOVERY_INBOX', 'Native inbox history cannot be safely recovered.');
  }
  return state;
}

function verifyScope(header, options) {
  if (typeof header.cwd !== 'string' || !path.isAbsolute(header.cwd) || path.resolve(header.cwd) !== header.cwd) fail('NATIVE_RECOVERY_SCOPE', 'Native recovery requires the original absolute workspace directory.');
  if (options.workspaceDirectory !== undefined && header.cwd !== path.resolve(options.workspaceDirectory)) fail('NATIVE_RECOVERY_SCOPE', 'Native session belongs to a different workspace directory.');
}

/** Verify referenced native attachment bytes and configured spill locators in this copied tree. */
async function verifyReferences(events, root, originalWorkspace) {
  const attachmentRoot = path.join(path.dirname(root), 'attachments', 'v1');
  const originalSpills = path.join(path.dirname(originalWorkspace), 'harness', 'spills');
  const copiedSpills = path.join(path.dirname(root), 'spills');
  const verified = new Set();
  async function file(name, digest, byteCount) {
    if (verified.has(name)) return;
    let handle;
    try {
      if (await realpath(name) !== name) fail('NATIVE_RECOVERY_REFERENCE', 'A native referenced file has symbolic path components.');
      handle = await open(name, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile() || (info.mode & 0o111) || info.size > 512 * 1024 * 1024) fail('NATIVE_RECOVERY_REFERENCE', 'A native referenced file is not a supported regular file.');
      const value = await handle.readFile();
      if (value.length !== info.size || byteCount !== undefined && value.length !== byteCount || digest && createHash('sha256').update(value).digest('hex') !== digest) fail('NATIVE_RECOVERY_REFERENCE', 'A native attachment failed its persisted size or hash check.');
      verified.add(name);
    } catch (error) {
      if (error.code === 'ENOENT') fail('NATIVE_RECOVERY_REFERENCE_MISSING', 'A referenced native attachment or spill is missing from the recovery tree.');
      throw error;
    } finally { await handle?.close(); }
  }
  for (const event of events) {
    const pending = [event.data];
    while (pending.length) {
      const value = pending.pop();
      if (typeof value === 'string' && ['tool/result', 'tool/ptc-dispatch'].includes(event.type)) {
        const marker = ' Full formatted result stored at: ', end = '. Use read with offset/limit, or grep this path to search within it.';
        let offset = value.indexOf(marker);
        while (offset >= 0) {
          const finish = value.indexOf(end, offset + marker.length);
          if (finish < 0) fail('NATIVE_RECOVERY_SPILL_UNSUPPORTED', 'A native spill notice requires a reviewed recovery mapping.');
          const locator = value.slice(offset + marker.length, finish), relative = path.relative(originalSpills, locator);
          if (!path.isAbsolute(locator) || !relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) fail('NATIVE_RECOVERY_EXTERNAL_SPILL', 'Native history references an external spill. Configure the reviewed recovery spill root and retain the original bytes before backup.');
          await file(path.join(copiedSpills, relative));
          offset = value.indexOf(marker, finish + end.length);
        }
      }
      if (value === null || typeof value !== 'object') continue;
      if (['image', 'file'].includes(value.type) && value.attachment) {
        const ref = value.attachment, match = /^sha256:([a-f0-9]{64})$/.exec(ref.attachmentId);
        if (!match || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0) fail('NATIVE_RECOVERY_REFERENCE', 'A native attachment reference is invalid.');
        const hash = match[1];
        if (value.type === 'image') await file(path.join(attachmentRoot, 'objects', hash.slice(0, 2), hash), hash, ref.bytes);
        else {
          if (typeof ref.name !== 'string' || !ref.name || ref.name === '.' || ref.name === '..' || /[\\/\x00-\x1f]/.test(ref.name)) fail('NATIVE_RECOVERY_REFERENCE', 'A native file attachment name is invalid.');
          await file(path.join(attachmentRoot, 'file-objects', hash.slice(0, 2), hash), hash, ref.bytes);
          await file(path.join(attachmentRoot, 'files', hash.slice(0, 2), hash, ref.name), hash, ref.bytes);
        }
      }
      pending.push(...Object.values(value));
    }
  }
}

/** Inject native public exports for keyless fixtures; production uses loadNativeRecoveryAdapter. */
export function createNativeRecoveryAdapter({ Context, Jsonl, SessionStore, SESSION_FORMAT_VERSION,
  interruptedTurnClosers, setSandboxMode, setApprovalPolicy, foldGoal, tryLockExclusive }) {
  if (SESSION_FORMAT_VERSION !== 4 || [Context, Jsonl, SessionStore, interruptedTurnClosers, setSandboxMode, setApprovalPolicy, foldGoal].some(value => typeof value !== 'function')) fail('NATIVE_RECOVERY_RUNTIME', 'The reviewed native recovery exports are unavailable.');

  async function withContext(root, compression, action) {
    if (!['none', 'zstd'].includes(compression)) fail('NATIVE_RECOVERY_COMPRESSION', 'Native recovery requires explicit none or zstd compression.');
    const ctx = new Context();
    try {
      await ctx.plugin(SessionStore);
      await ctx.plugin(Jsonl, { root, compression });
      return await action(ctx);
    } finally { await ctx.fiber.dispose(); }
  }

  async function loadAll(ctx, entries, options, root) {
    const listed = await ctx.sessionPersistence.list();
    if (listed.length !== entries.length) fail('NATIVE_RECOVERY_UNREADABLE', 'One or more native sessions could not be listed; no history was replaced.');
    const records = [];
    for (const entry of entries) {
      const handle = await ctx.sessionPersistence.open(entry.id, 'read');
      try {
        const read = await handle.read();
        verifyScope(handle.header, options);
        if (handle.header.id !== entry.id) fail('NATIVE_RECOVERY_IDENTITY', 'Native stored session identity mismatch.');
        const events = read.events;
        const inbox = pendingInbox(events), goal = foldGoal(events);
        await verifyReferences(events, root, handle.header.cwd);
        const unsupported = events.some(event => event.type === 'image/offload' || event.type.startsWith('team/')
          || event.type.startsWith('tool-workflow/') || event.type === 'schedule/change'
          || event.type === 'user/message' && ['muse-worker', 'schedule'].includes(event.data.message?.source?.kind ?? event.data.source?.kind));
        if (unsupported) fail('NATIVE_RECOVERY_UNSUPPORTED_STATE', 'This native session requires an additional recovery owner for image projections, teams, workflows, schedules or worker delivery.');
        // Construct only a detached Session: no publication, Agent, profile, tools or model.
        ctx.sessions.prepare(entry.id, { seed: structuredClone(events), meta: structuredClone(handle.header), inheritedEventCount: handle.inheritedEventCount, eventState: 'detached' });
        records.push({ ...entry, header: structuredClone(handle.header), events, inbox, goal,
          inheritedEventCount: handle.inheritedEventCount });
      } finally { await handle.close(); }
    }
    const byId = new Map(records.map(record => [record.id, record]));
    for (const record of records) {
      if (record.header.parentSession !== undefined && !byId.has(record.header.parentSession)) fail('NATIVE_RECOVERY_LINEAGE', 'Native recovery is missing a parent session.');
      for (const event of record.events) if (event.type === 'subagent/catalog' && event.seq >= record.inheritedEventCount) {
        const child = byId.get(event.data.childId);
        if (!child || child.header.parentSession !== record.id || child.header.createdAt !== event.data.childCreatedAt) fail('NATIVE_RECOVERY_LINEAGE', 'Native recovery is missing a catalogued child or its recorded identity.');
      }
    }
    return records;
  }

  function summary(records, compression) {
    return { runtimeVersion: RUNTIME_VERSION, sessionFormatVersion: SESSION_FORMAT_VERSION, compression,
      sessions: records.map(record => ({ id: record.id, cwd: record.header.cwd,
        ...(record.header.parentSession === undefined ? {} : { parentSession: record.header.parentSession }),
        eventCount: record.events.length, checkpointCount: record.events.filter(event => checkpointTypes.has(event.type)).length,
        storedVersions: record.versions })) };
  }

  return {
    async inspect(root, compression, options = {}) {
      const entries = await inventory(root, compression);
      return withContext(root, compression, async ctx => summary(await loadAll(ctx, entries, options, root), compression));
    },
    async quarantine(root, compression, options = {}) {
      const entries = await inventory(root, compression);
      return withContext(root, compression, async ctx => {
        const records = await loadAll(ctx, entries, options, root); // All bodies and recovery states validate before any mutation.
        const migrations = [];
        for (const record of records) {
          const handle = await ctx.sessionPersistence.open(record.id, 'write');
          let detach;
          try {
            const before = (await handle.read()).events;
            const closers = interruptedTurnClosers(before);
            if (closers.length) await handle.append(closers);
            const seed = [...before, ...closers];
            // Avoid a constructor-owned, unpublished marker that the live writer would miss.
            if (seed.at(-1)?.type !== 'session/end-seed') {
              const marker = { type: 'session/end-seed', seq: seed.length, time: Date.now(), data: {} };
              await handle.append([marker]); seed.push(marker);
            }
            const session = ctx.sessions.prepare(record.id, { seed: structuredClone(seed), meta: structuredClone(handle.header), inheritedEventCount: handle.inheritedEventCount, eventState: 'detached' });
            detach = ctx.sessions.enter(session); // Deliberately never announce or create an Agent.
            session.append('permission/preset', { preset: 'custom' });
            setSandboxMode(session, 'read-only');
            setApprovalPolicy(session, 'never');
            for (const target of ['next-step', 'next-turn']) if (record.inbox[target].length) session.append('agent/inbox/spliced', { target, start: 0, removedCount: record.inbox[target].length, inserted: [], outcome: 'canceled' });
            if (record.goal.goal?.phase === 'active') {
              const goal = { ...record.goal.goal, phase: 'paused', revision: record.goal.goal.revision + 1 };
              const changed = session.append('goal/change', { kind: 'goal/change', version: 1, operation: 'pause', goal,
                roundsStarted: record.goal.roundsStarted, createdAt: record.goal.createdAt,
                updatedAt: Math.max(Date.now(), record.goal.updatedAt) });
              foldGoal([...before, changed]);
            }
            await ctx.sessionPersistence.flush();
            record.events = (await handle.read()).events;
            if (pendingInbox(record.events)['next-step'].length || pendingInbox(record.events)['next-turn'].length || foldGoal(record.events).goal?.phase === 'active') fail('NATIVE_RECOVERY_QUARANTINE', 'Native recovery did not safely stop pending work.');
            if (record.versions.at(-1) < SESSION_FORMAT_VERSION) migrations.push({ id: record.id, from: record.versions.at(-1), to: SESSION_FORMAT_VERSION });
            if (!record.versions.includes(SESSION_FORMAT_VERSION)) record.versions.push(SESSION_FORMAT_VERSION);
          } finally { await handle.close(); detach?.(); }
        }
        return { ...summary(records, compression), migrations, permissionsReset: true, inFlightReplayed: false };
      });
    },
    async acquireLeases(root) {
      if (!['linux', 'darwin'].includes(process.platform) || typeof tryLockExclusive !== 'function') fail('UNSUPPORTED_NATIVE_BACKUP_PLATFORM', 'Native offline backup requires the reviewed POSIX kernel-lock implementation.');
      const entries = await inventory(root), owned = [];
      let released = false;
      const release = async () => {
        if (released) return; released = true;
        const outcomes = await Promise.allSettled(owned.map(item => item.handle.close()));
        if (outcomes.some(item => item.status === 'rejected')) fail('NATIVE_RECOVERY_LEASE_RELEASE', 'Native recovery could not confirm all session locks were released.');
      };
      const verify = async () => {
        if (released) fail('NATIVE_RECOVERY_LEASE_RELEASED', 'Native backup session locks have been released.');
        const current = await inventory(root);
        if (JSON.stringify(current) !== JSON.stringify(entries)) fail('NATIVE_RECOVERY_SOURCE_CHANGED', 'Native session inventory changed during backup.');
        for (const item of owned) {
          const info = await lstat(item.file);
          if (!info.isFile() || info.isSymbolicLink() || info.ino !== item.info.ino || info.dev !== item.info.dev) fail('NATIVE_RECOVERY_SOURCE_CHANGED', 'Native session lock identity changed during backup.');
        }
      };
      try {
        for (const entry of entries) {
          const file = path.join(entry.dir, 'session.lock');
          const handle = await open(file, constants.O_RDWR | constants.O_NOFOLLOW);
          owned.push({ handle, file, info: await handle.stat() });
          if (!owned.at(-1).info.isFile()) fail('NATIVE_RECOVERY_LAYOUT', 'Native session lock must be a regular file.');
          try { await tryLockExclusive(handle.fd); }
          catch (error) { if (['EAGAIN', 'EWOULDBLOCK'].includes(error.code)) fail('NATIVE_RECOVERY_ACTIVE_WRITER', 'A native session is still owned by a live writer. Stop the native runtime before backup.'); throw error; }
        }
        await verify(); return { release, verify };
      } catch (error) { await release(); if (error.code === 'ENOENT') fail('NATIVE_RECOVERY_LOCK_MISSING', 'Native session lock is missing; offline writer ownership cannot be established.'); throw error; }
    },
  };
}

/** Resolve reviewed built package exports only; no source imports or old-version fallback. */
export async function loadNativeRecoveryAdapter(runtimePackagePath) {
  if (typeof runtimePackagePath !== 'string' || !path.isAbsolute(runtimePackagePath) || path.basename(runtimePackagePath) !== 'package.json') fail('NATIVE_RECOVERY_RUNTIME', 'A reviewed built base or SDK runtime package.json is required.');
  const manifest = JSON.parse(await readFile(runtimePackagePath, 'utf8'));
  if (!['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-jsonrpc-server'].includes(manifest.name) || manifest.version !== RUNTIME_VERSION) fail('NATIVE_RECOVERY_RUNTIME', 'Native recovery requires Harness 0.2.0-rc.2.');
  const require = createRequire(runtimePackagePath);
  const load = async name => {
    const pkg = JSON.parse(await readFile(require.resolve(`${name}/package.json`), 'utf8'));
    if (pkg.name !== name || pkg.version !== RUNTIME_VERSION) fail('NATIVE_RECOVERY_RUNTIME', 'Native recovery package versions do not match the reviewed runtime.');
    return import(pathToFileURL(require.resolve(name)).href);
  };
  const cordis = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
  const [session, jsonl, sandbox, approval, goal] = await Promise.all([
    load('@deepseek-ai/dsh-session'), load('@deepseek-ai/dsh-session-persistence-jsonl'),
    load('@deepseek-ai/dsh-sandbox-policy'), load('@deepseek-ai/dsh-user-approval'), load('@deepseek-ai/dsh-goal'),
  ]);
  const jsonlRequire = createRequire(require.resolve('@deepseek-ai/dsh-session-persistence-jsonl/package.json'));
  const flock = await import(pathToFileURL(jsonlRequire.resolve('@deepseek-ai/node-addon-system/flock')).href);
  return createNativeRecoveryAdapter({ Context: cordis.Context, Jsonl: jsonl.default, SessionStore: session.default,
    SESSION_FORMAT_VERSION: session.SESSION_FORMAT_VERSION, interruptedTurnClosers: session.interruptedTurnClosers,
    setSandboxMode: sandbox.setSandboxMode, setApprovalPolicy: approval.setApprovalPolicy, foldGoal: goal.foldGoal,
    tryLockExclusive: flock.tryLockExclusive });
}
