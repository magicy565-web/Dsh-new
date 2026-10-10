import path from 'node:path';
import { readBody, respond } from '../server/index.mjs';
import { validateNativeMuseConfiguration, validateNativeMuseReconciliationReview } from '../server/muse-worker-native.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { rename, unlink } from 'node:fs/promises';
import { openPrivateFile, privateDirectory, syncDirectory } from '../server/store.mjs';
import { assertOwnerControlledFile, writePrivateNewFile } from '../server/file-permissions.mjs';
import { accessConfigFromEnvironment } from '../server/access.mjs';
import { dotConfigFromEnvironment } from '../server/dot-auth.mjs';
import { normalizeWorkspacePluginConfig, pluginFields, pluginId } from '../server/workspace-plugin-config.mjs';

const sources = Object.freeze({ llm: 'packages/llm/llm/src/index.ts', sessions: 'packages/core/session/src/index.ts',
  projections: 'packages/session/session-projection/src/index.ts', prompt: 'packages/core/system-prompt/src/index.ts',
  tools: 'packages/core/tools/src/index.ts', agents: 'packages/core/agent/src/index.ts',
  persistence: 'packages/session/session-persistence-jsonl/src/index.ts', loop: 'packages/core/agent-loop/src/index.ts',
  goals: 'packages/goal/goal/src/index.ts' });

async function readPrivateJSON(filename) {
  if (!path.isAbsolute(filename ?? '')) throw Error('Native Host configuration requires an explicit absolute private file.');
  const file = await openPrivateFile(filename);
  try { await assertOwnerControlledFile(file); if ((await file.stat()).size > 100000) throw Error('Native Host configuration exceeds its limit.'); return JSON.parse(await file.readFile('utf8')); }
  finally { await file.close(); }
}

export function validateNativeDotHostConfig(value) {
  pluginFields(value, ['version', 'harnessRoot', 'sessionDirectory', 'mountDirectory', 'staticDirectory', 'port', 'plugin', 'dotOwnerSubject', 'initialEnrollment']);
  if (value.version !== 1 || !['harnessRoot', 'sessionDirectory', 'mountDirectory', 'staticDirectory'].every(k => path.isAbsolute(value[k] ?? ''))
    || !Number.isSafeInteger(value.port) || value.port < 0 || value.port > 65535 || !pluginId(value.dotOwnerSubject)) throw Error('Invalid native cloud Host paths or ownership.');
  const plugin = normalizeWorkspacePluginConfig(value.plugin);
  if (!plugin.enabled || !plugin.operators.some(o => o.subject === value.dotOwnerSubject)
    || new Set(plugin.operators.map(o => o.subject)).size !== plugin.operators.length) throw Error('Native cloud users need unique reviewed original Sessions.');
  if (value.initialEnrollment !== undefined) {
    const e = value.initialEnrollment;
    pluginFields(e, ['grantId', 'oauthSubject', 'expiresAt', 'reviewedDotURL']);
    if (![e.grantId, e.oauthSubject].every(pluginId) || !Number.isSafeInteger(e.expiresAt)
      || !/^https:\/\/chatgpt\.com\/dots\/[0-9a-f-]{36}$/.test(e.reviewedDotURL)) throw Error('Initial admission needs the reviewed existing dot profile and OAuth account.');
  }
  return { ...structuredClone(value), plugin };
}

/** Admit only the original, explicitly confirmed public browser question.
 * A native model-created Goal cannot manufacture this user admission.
 */
export function admittedNativePublicQuestion({ agent, goal }) {
  const events = agent.session.ownEvents();
  const index = events.findIndex(e => e.type === 'goal/change' && e.data.operation === 'create' && e.data.goal.id === goal.id);
  if (index < 1 || events[index - 1].type !== 'agent/inbox/spliced') return false;
  const messages = events[index - 1].data.inserted;
  if (messages.length !== 1 || messages[0].source?.kind !== 'user' || !messages[0].id.startsWith('xy-input-')) return false;
  try { const input = JSON.parse(messages[0].content[0].text);
    return input.confirmed === true && input.dataScope === 'public-only' && input.content === goal.objective;
  } catch { return false; }
}

async function saveReviewedDotConfiguration(filename, config) {
  // Only a Host-owned private configuration path. No model or browser can
  // choose a file path, key, subject or connection binding here.
  const existing = await readPrivateJSON(filename);
  if (existing.resource !== config.resource || existing.workspaceId !== config.workspaceId) throw Error('The original dot configuration changed during enrollment.');
  const temporary = path.join(path.dirname(filename), `.native-binding-${randomUUID()}.json`);
  await writePrivateNewFile(temporary, JSON.stringify(config, null, 2) + '\n');
  try { await rename(temporary, filename); await syncDirectory(path.dirname(filename)); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}

/** Mount the reviewed native Harness, its one business writer and frontend.
 * No local model turn, legacy createApp, surrogate dot or shell worker runs.
 */
export async function startNativeDotHost({ configuration, environment = process.env, dotConfiguration, dotTransport, museConfiguration } = {}) {
  const config = validateNativeDotHostConfig(configuration ?? await readPrivateJSON(environment.WORKSPACE_NATIVE_HOST_FILE));
  const dotConfig = dotConfiguration ?? await dotConfigFromEnvironment(environment);
  if (dotConfig.enabled !== true) throw Error('The native cloud Host requires an explicitly enabled reviewed dot configuration.');
  const access = await accessConfigFromEnvironment(environment);
  if (access.mode === 'enterprise' && config.plugin.operators.some(o => !access.members.some(m => m.subject === o.subject))) throw Error('Every native Session owner must be an authorized Workspace member.');
  const museReview = museConfiguration ?? (environment.WORKSPACE_MUSE_REST_FILE
    ? await readPrivateJSON(environment.WORKSPACE_MUSE_REST_FILE) : null);
  if (museReview) {
    pluginFields(museReview, ['version', 'worker', 'actor']);
    if (museReview.version !== 1 || access.mode !== 'enterprise' || !/^https:\/\//.test(access.publicOrigin ?? ''))
      throw Error('Muse REST requires a reviewed original enterprise Host and HTTPS ingress.');
    validateNativeMuseConfiguration(museReview.worker, museReview.actor, config.plugin.operators);
  }
  const load = relative => import(pathToFileURL(path.join(config.harnessRoot, relative)).href);
  const { boot } = await load('packages/boot/app-boot/src/index.ts');
  const { SessionId } = await load('packages/core/session/src/index.ts');
  const { createWorkspaceNativePlugin } = await import('../server/workspace-native-plugin.mjs');
  const frontend = await import('../server/workspace-native-frontend-plugin.mjs');
  for (const directory of [config.plugin.dataDirectory, config.sessionDirectory, config.mountDirectory]) await privateDirectory(directory);
  const builtins = {};
  for (const [key, source] of Object.entries(sources)) builtins[key] = (await load(source)).default;
  builtins.owners = { name: 'workspace-cloud-session-owners', inject: ['agents', 'agentLoop', 'sessionPersistence', 'goals'], async apply(ctx) {
    await ctx.effect(async () => {
      const persisted = await ctx.sessionPersistence.list(), handles = [];
      try {
        for (const actor of config.plugin.operators) {
          const id = SessionId(actor.nativeAgentId);
          handles.push(persisted.some(s => s.header.id === id)
            ? await ctx.agents.resume({ resumeSessionId: id })
            : await ctx.agents.create({ sessionId: id, meta: { cwd: config.plugin.dataDirectory } }));
        }
        ctx.provide('workspaceCloudSessionOwners', true);
        return async () => { for (const handle of handles.reverse()) await handle.dispose(); };
      } catch (error) { for (const handle of handles.reverse()) await handle.dispose(); throw error; }
    }, 'retain the original cloud user Sessions');
  } };
  const plugin = createWorkspaceNativePlugin({ dot: { configuration: dotConfig, ownerSubject: config.dotOwnerSubject,
    transport: dotTransport, authorizePublicTask: admittedNativePublicQuestion } });
  builtins.business = { ...plugin, inject: [...plugin.inject, 'workspaceCloudSessionOwners'] };
  builtins.enrollment = { name: 'workspace-cloud-initial-enrollment', inject: ['workspaceBusiness', 'workspaceDotHost'], async apply(ctx) {
    const service = ctx.workspaceBusiness, actor = config.plugin.operators.find(o => o.subject === config.dotOwnerSubject);
    const worker = service.bindActor(actor), previous = (await worker.view()).worker?.connection;
    if (!previous && config.initialEnrollment) {
      const e = config.initialEnrollment;
      const admission = (await worker.view()).admissions.find(a => a.id === e.grantId && a.provider === 'dot');
      if (!admission || admission.agentId !== new URL(e.reviewedDotURL).pathname.split('/').at(-1)
        || e.expiresAt <= Date.now() || e.expiresAt > admission.expiresAt) throw Error('The initial enrollment no longer matches the reviewed original dot admission.');
      const connection = (await worker.register({ grantId: e.grantId, requestId: `initial-${e.grantId}` })).worker.connection;
      const bindings = [{ oauthSubject: e.oauthSubject, subject: config.dotOwnerSubject, grantId: e.grantId,
        connectionId: connection.id, authorizationEpoch: connection.authorizationEpoch, expiresAt: e.expiresAt }];
      const lifecycle = service.status();
      await ctx.workspaceDotHost.reviewBindings({ expectedEpoch: lifecycle.epoch, configurationHash: lifecycle.configurationHash, bindings });
      if (!dotConfiguration && environment.WORKSPACE_DOT_FILE) await saveReviewedDotConfiguration(environment.WORKSPACE_DOT_FILE, { ...dotConfig, bindings });
    }
    // A previously detached/paused/uncertain connection never registers again
    // or automatically resumes. Its task, fences and Events need Host review.
    ctx.provide('workspaceCloudEnrollmentInspected', true);
  } };
  builtins.review = { name: 'workspace-cloud-private-review', inject: ['workspaceBusiness', 'workspaceDotHost', 'workspaceCloudEnrollmentInspected'], async apply(ctx) {
    const filename = environment.WORKSPACE_NATIVE_REVIEW_FILE;
    if (filename && (!path.isAbsolute(filename) || !environment.WORKSPACE_DOT_FILE || dotConfiguration)) throw Error('Host reviews require explicitly selected private production files.');
    await ctx.effect(async () => {
      let active = true, pending;
      const inspect = async () => {
        if (!filename) return;
        let review;
        try { review = await readPrivateJSON(filename); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
        pluginFields(review, ['version', 'requestId', 'expectedEpoch', 'configurationHash', 'callbackCandidateIds', 'bindings', 'action', 'connectionId', 'authorizationEpoch']);
        if (review.version !== 1 || !/^[A-Za-z0-9_-]{1,100}$/.test(review.requestId) || !Array.isArray(review.callbackCandidateIds)) throw Error('Invalid private Host review.');
        const reviewHash = createHash('sha256').update(JSON.stringify(review)).digest('hex');
        const receiptFile = path.join(path.dirname(filename), `native-review-${review.requestId}.result.json`);
        let prior;
        try { prior = await readPrivateJSON(receiptFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (prior) {
          if (prior.requestId !== review.requestId || prior.reviewHash !== reviewHash || prior.accepted !== true) throw Error('A private Host review requestId cannot change its original command.');
          if (JSON.stringify(await readPrivateJSON(filename)) === JSON.stringify(review)) await unlink(filename);
          return;
        }
        const service = ctx.workspaceBusiness;
        if (review.action === 'muse-reconcile') {
          if (!museReview) throw Error('A private Muse reconciliation requires its original selected configuration.');
          const exact = validateNativeMuseReconciliationReview(review, service.status());
          await service.refreshMuseRest(exact);
          await writePrivateNewFile(receiptFile, JSON.stringify({ requestId: review.requestId, reviewHash,
            accepted: true, epoch: exact.expectedEpoch, configurationHash: exact.configurationHash,
            action: 'muse-reconcile', executionResumed: false, nativeExecutionVerified: false }) + '\n');
          if (JSON.stringify(await readPrivateJSON(filename)) === JSON.stringify(review)) await unlink(filename);
          return;
        }
        const current = await readPrivateJSON(environment.WORKSPACE_DOT_FILE);
        const candidates = service.dot.view(config.dotOwnerSubject).callbackCandidates;
        const urls = review.callbackCandidateIds.map(id => { const candidate = candidates.find(c => c.id === id && c.expiresAt > Date.now());
          if (!candidate) throw Error('The reviewed callback candidate expired or changed.'); return candidate.url; });
        if (review.action !== undefined && review.action !== 'resume-empty') throw Error('Unsupported private Host recovery action.');
        let bindings = review.bindings ?? current.bindings, expectedEpoch = review.expectedEpoch, configurationHash = review.configurationHash;
        if (review.action === 'resume-empty') {
          if (review.bindings !== undefined || review.callbackCandidateIds.length) throw Error('Empty-mount recovery does not authorize new bindings or callbacks.');
          const resumed = await ctx.workspaceDotHost.resumeEmptyMount({ expectedEpoch, configurationHash, requestId: review.requestId,
            connectionId: review.connectionId, authorizationEpoch: review.authorizationEpoch });
          bindings = current.bindings.map(b => {
            if (b.subject !== config.dotOwnerSubject || b.connectionId !== resumed.connection.id || b.grantId !== resumed.connection.grantId) throw Error('Preserve the exact original owner and connection binding.');
            return { ...b, authorizationEpoch: resumed.connection.authorizationEpoch };
          });
          ({ epoch: expectedEpoch, configurationHash } = resumed.lifecycle);
        }
        const callbackURLs = [...new Set([...current.callbackURLs, ...urls])];
        const result = await ctx.workspaceDotHost.reviewBindings({ expectedEpoch, configurationHash, bindings, callbackURLs });
        await saveReviewedDotConfiguration(environment.WORKSPACE_DOT_FILE, { ...current, bindings, callbackURLs });
        if (museReview) await service.refreshMuseRest({ expectedEpoch: result.epoch, configurationHash: result.configurationHash });
        await writePrivateNewFile(receiptFile, JSON.stringify({ requestId: review.requestId, reviewHash,
          accepted: true, epoch: result.epoch, configurationHash: result.configurationHash, nativeExecutionVerified: false }) + '\n');
        // Preserve a replacement review that arrived while the original applied.
        if (JSON.stringify(await readPrivateJSON(filename)) === JSON.stringify(review)) await unlink(filename);
      };
      const tick = () => { if (!active || pending) return; pending = inspect().catch(() => {
        console.error('A private native Host review was not applied completely. Preserve the same request and inspect its original state.');
      }).finally(() => { pending = undefined; }); };
      // With Muse enabled, finish any already-selected operator review before
      // capturing its native epoch. Later explicit reviews withdraw old handles.
      if (museReview) await inspect();
      const timer = setInterval(tick, 2000); timer.unref(); tick();
      return async () => { active = false; clearInterval(timer); await pending; };
    }, 'review operator-selected native bindings and real callback candidates');
    ctx.provide('workspaceCloudPrivateReview', true);
  } };
  if (museReview) builtins.museRest = { name: 'workspace-cloud-muse-rest',
    inject: ['workspaceBusiness', 'workspaceCloudPrivateReview'], async apply(ctx) {
      await ctx.effect(async () => {
        const binding = ctx.workspaceBusiness.attachMuseRest({ config: museReview.worker,
          actor: museReview.actor, expectedHost: new URL(access.publicOrigin).host, readBody, respond });
        try { await binding.initialize(); }
        catch (error) { await binding.close(); throw error; }
        return () => binding.close();
      }, 'workspace-muse-rest: withdraw and drain the original actor binding');
      ctx.provide('workspaceCloudMuseRestMounted', true);
    } };
  const cloudFrontend = frontend.createWorkspaceNativeFrontendPlugin({ cloudDot: true });
  builtins.frontend = { ...cloudFrontend, inject: [...cloudFrontend.inject, 'workspaceCloudPrivateReview', ...(museReview ? ['workspaceCloudMuseRestMounted'] : [])] };
  const configs = { persistence: { root: config.sessionDirectory, compression: 'none' }, loop: { agents: [] }, business: config.plugin,
    frontend: { enabled: true, port: config.port, dataDirectory: config.plugin.dataDirectory, staticDirectory: config.staticDirectory,
      operators: config.plugin.operators, access } };
  const mountFile = path.join(config.mountDirectory, `cordis-${randomUUID()}.json`);
  await writePrivateNewFile(mountFile, JSON.stringify(Object.keys(builtins).map(id => ({ id, name: `cordis:${id}`,
    ...(configs[id] ? { config: configs[id] } : {}) }))));
  let ctx;
  try {
    ctx = await boot('workspace-xy-cloud-native', mountFile, undefined, context => { ctx = context; Object.assign(ctx.loader.builtins, builtins); });
    if (!ctx.get('workspaceFrontend') || !ctx.get('workspaceDotHost')) throw Error('The native cloud mount did not become ready.');
    return { ctx, service: ctx.workspaceBusiness, frontend: ctx.workspaceFrontend,
      async close() { await ctx.fiber.dispose(); await unlink(mountFile); } };
  } catch (error) { if (ctx) await ctx.fiber.dispose(); await unlink(mountFile).catch(() => {}); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startNativeDotHost().then(host => {
    console.log('Workspace native cloud Host is listening on its reviewed loopback port. Real xy authorization and execution are separate.');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => host.close().then(() => process.exit(0)));
  }).catch(() => { console.error('Native cloud Host did not start. Inspect private Host configuration and native dependencies locally.'); process.exitCode = 1; });
}
