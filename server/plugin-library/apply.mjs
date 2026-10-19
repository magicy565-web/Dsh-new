import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { readPluginInventory, packageSnapshot } from './inventory.mjs';
import { controlDigest } from './control-store.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const PLUGIN_SELECTION_BARRIER = '.plugin-selection-transaction.json';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const configurationName = value => typeof value === 'string' && /^config(?:\.[a-z0-9-]+)?\.json$/u.test(value);
function validateIntent(intent) {
  if (!intent || !configurationName(intent.configuration) || typeof intent.pluginId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(intent.pluginId)
    || typeof intent.packageSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(intent.packageSha256))
    fail('PLUGIN_APPLY_IDENTITY_REFUSED', 'The stored plugin and configuration identity requires review.');
}
async function safeRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || root !== path.resolve(root)
    || await fs.realpath(root) !== root || !(await fs.lstat(root)).isDirectory())
    fail('PLUGIN_APPLY_ROOT_REFUSED', 'Use the canonical reviewed plugin source directory.');
}
async function fileBytes(file, maximum = 65536) {
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > maximum || (before.mode & 0o022) !== 0)
      fail('PLUGIN_APPLY_FILE_REFUSED', 'The reviewed file must be a bounded, non-writable-by-others regular file.');
    const buffer = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < buffer.length) { const read = await handle.read(buffer, length, buffer.length - length, length); if (!read.bytesRead) break; length += read.bytesRead; }
    const after = await handle.stat();
    if (length > maximum || length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      fail('PLUGIN_APPLY_SOURCE_CHANGED', 'The source changed while it was being read.');
    return buffer.subarray(0, length);
  } finally { await handle.close(); }
}
async function syncDirectory(directory) { const handle = await fs.open(directory, constants.O_RDONLY); try { await handle.sync(); } finally { await handle.close(); } }

export function planToolSelection({ intent, inventory, configurationBytes }) {
  validateIntent(intent);
  if (!['enable-tools', 'disable-tools'].includes(intent.action))
    fail('PLUGIN_FULL_MODULE_EXECUTOR_REQUIRED', 'Physical installation, upgrade and removal require the module-specific accepted executor. No source or data was changed.');
  const item = inventory.packages.find(item => item.id === intent.pluginId);
  const profile = inventory.profiles.find(item => item.configuration === intent.configuration);
  if (!item || !profile || inventory.snapshotSha256 !== intent.inventorySha256 || item.packageSha256 !== intent.packageSha256 || profile.sha256 !== sha(configurationBytes))
    fail('PLUGIN_APPLY_SOURCE_CHANGED', 'The package or exact profile bytes changed since the administrator reviewed them.');
  if (intent.action === 'disable-tools' && intent.configuration === 'config.business.json' && intent.pluginId === 'workspace-goal-intelligence')
    fail('PLUGIN_CORE_DEPENDENCY_REQUIRED', 'The current business profile requires its original Brain module. It is not an accepted optional backend.');
  const current = JSON.parse(configurationBytes.toString('utf8'));
  if (!current || Object.getPrototypeOf(current) !== Object.prototype || Object.keys(current).some(key => !['extensions', 'disabledExtensions'].includes(key))
    || !Array.isArray(current.extensions) || !Array.isArray(current.disabledExtensions)
    || [...current.extensions, ...current.disabledExtensions].some(value => typeof value !== 'string'))
    fail('PLUGIN_APPLY_CONFIGURATION_REFUSED', 'The original selector configuration requires review.');
  const next = structuredClone(current);
  const disabledIdentity = value => value.replace(/^extension-module:/u, '');
  if (intent.action === 'enable-tools') {
    if (!next.extensions.includes('./' + item.id)) next.extensions.push('./' + item.id);
    next.disabledExtensions = next.disabledExtensions.filter(value => ![item.id, item.name].includes(disabledIdentity(value)));
  } else if (!next.disabledExtensions.some(value => disabledIdentity(value) === item.id)) next.disabledExtensions.push('extension-module:' + item.id);
  const after = Buffer.from(JSON.stringify(next, null, 2) + '\n');
  return { pluginId: item.id, configuration: intent.configuration, beforeSha256: sha(configurationBytes), afterSha256: sha(after), after };
}

/** Offline only: the CLI holds the same exclusive control-store lock as the managed Host. */
export async function applyToolSelection({ control, root, requestId, expectedRevision, confirmPackageSha256, subject }) {
  await safeRoot(root);
  const state = control.read();
  const intent = state.intents.find(item => item.requestId === requestId);
  validateIntent(intent);
  if (intent.packageSha256 !== confirmPackageSha256) fail('PLUGIN_APPLY_CONFIRMATION_REQUIRED', 'Use the independently reviewed package SHA-256.');
  if (state.revision !== expectedRevision) fail('PLUGIN_CONTROL_STALE', 'Use the current control revision.');
  if (intent.status !== 'awaiting-verified-executor') fail('PLUGIN_APPLY_RECONCILE_REQUIRED', 'Inspect or explicitly reconcile an already progressed request; do not reapply it.');
  if (state.intents.some(item => item.status === 'applying') || state.receipts.length > 1997 || state.events.length > 1997)
    fail('PLUGIN_APPLY_RECONCILE_REQUIRED', 'Another incomplete operation or control capacity requires review first.');
  const barrierPath = path.join(root, PLUGIN_SELECTION_BARRIER);
  try { await fs.lstat(barrierPath); fail('PLUGIN_APPLY_RECONCILE_REQUIRED', 'A source transaction barrier exists. No barrier was removed.'); }
  catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
  const inventory = await readPluginInventory({ root });
  const configPath = path.join(root, intent.configuration);
  const before = await fileBytes(configPath);
  const plan = planToolSelection({ intent, inventory, configurationBytes: before });
  const barrier = { schemaVersion: 1, intentId: intent.id, requestId, configuration: plan.configuration, beforeSha256: plan.beforeSha256, afterSha256: plan.afterSha256 };
  await control.transact({ requestId: 'apply-prepare:' + intent.id, expectedRevision, subject, operation: { type: 'selection.prepare', ...barrier } }, next => {
    const current = next.intents.find(item => item.id === intent.id);
    if (current.status !== 'awaiting-verified-executor') fail('PLUGIN_APPLY_RECONCILE_REQUIRED', 'The original intent changed.');
    current.status = 'applying'; current.application = barrier;
    return { intent: current, executed: false };
  });
  const marker = await fs.open(barrierPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), 0o600);
  try { await marker.writeFile(JSON.stringify(barrier)); await marker.sync(); } finally { await marker.close(); }
  await syncDirectory(root);
  const temporary = path.join(root, '.selection.' + randomUUID() + '.tmp');
  let writer;
  try {
    if (sha(await fileBytes(configPath)) !== plan.beforeSha256 || (await packageSnapshot(path.join(root, intent.pluginId))).sha256 !== confirmPackageSha256)
      fail('PLUGIN_APPLY_SOURCE_CHANGED', 'The reviewed source changed before application. Explicit reconciliation is required.');
    writer = await fs.open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), 0o600);
    await writer.writeFile(plan.after); await writer.sync(); await writer.close(); writer = null;
    if (sha(await fileBytes(configPath)) !== plan.beforeSha256) fail('PLUGIN_APPLY_SOURCE_CHANGED', 'The original configuration changed before commit.');
    await fs.rename(temporary, configPath); await syncDirectory(root);
    return await reconcileToolSelection({ control, root, requestId, expectedRevision: control.read().revision, subject });
  } finally {
    await writer?.close().catch(() => {});
    await fs.unlink(temporary).catch(cause => { if (cause.code !== 'ENOENT') throw cause; });
  }
}

/** Explicit recovery observes bytes; it never guesses, reexecutes a tool or rolls back remote writes. */
export async function reconcileToolSelection({ control, root, requestId, expectedRevision, subject }) {
  await safeRoot(root);
  const state = control.read();
  if (state.revision !== expectedRevision) fail('PLUGIN_CONTROL_STALE', 'Use the current control revision.');
  const intent = state.intents.find(item => item.requestId === requestId);
  validateIntent(intent);
  if (!intent.application || !['applying', 'selection-applied', 'not-applied'].includes(intent.status))
    fail('PLUGIN_APPLY_NOT_PREPARED', 'No prepared selection transaction exists for this request.');
  const application = intent.application;
  if (!configurationName(application.configuration) || application.configuration !== intent.configuration
    || application.intentId !== intent.id || application.requestId !== requestId || application.schemaVersion !== 1
    || !/^[a-f0-9]{64}$/u.test(application.beforeSha256) || !/^[a-f0-9]{64}$/u.test(application.afterSha256))
    fail('PLUGIN_APPLY_RECONCILE_REQUIRED', 'The stored application identity requires review.');
  const barrierPath = path.join(root, PLUGIN_SELECTION_BARRIER);
  let marker;
  try { marker = JSON.parse((await fileBytes(barrierPath)).toString('utf8')); }
  catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
  if (marker && controlDigest(marker) !== controlDigest(application)) fail('PLUGIN_APPLY_RECONCILE_REQUIRED', 'The barrier belongs to another or altered transaction.');
  const currentSha = sha(await fileBytes(path.join(root, application.configuration)));
  const applied = currentSha === application.afterSha256;
  if (!applied && currentSha !== application.beforeSha256) fail('PLUGIN_APPLY_RECONCILE_REQUIRED', 'Configuration bytes match neither side of the reviewed change. Nothing was reset.');
  if (intent.status === 'selection-applied' && !applied || intent.status === 'not-applied' && applied)
    fail('PLUGIN_APPLY_SOURCE_CHANGED', 'Configuration changed after the recorded result. A new review is required.');
  if (applied && (await packageSnapshot(path.join(root, intent.pluginId))).sha256 !== intent.packageSha256)
    fail('PLUGIN_APPLY_SOURCE_CHANGED', 'Package bytes changed after the configuration write. Keep the barrier and review the code.');
  let result = { intent, selectionApplied: applied, backendChanged: false, codeInstalled: false, dataDeleted: false, restartRequired: true };
  if (intent.status === 'applying') result = await control.transact({ requestId: 'apply-finish:' + intent.id, expectedRevision, subject, operation: { type: 'selection.reconcile', intentId: intent.id, observedSha256: currentSha } }, next => {
    const current = next.intents.find(item => item.id === intent.id);
    current.status = applied ? 'selection-applied' : 'not-applied'; current.executed = applied;
    return { intent: current, selectionApplied: applied, backendChanged: false, codeInstalled: false, dataDeleted: false, restartRequired: true };
  });
  if (marker) { await fs.unlink(barrierPath); await syncDirectory(root); }
  return result;
}
