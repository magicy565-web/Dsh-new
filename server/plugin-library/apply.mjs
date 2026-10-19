import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { readPluginInventory, packageSnapshot } from './inventory.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const PLUGIN_SELECTION_BARRIER = '.plugin-selection-transaction.json';
const error = (code, message) => Object.assign(new Error(message), { code });
const fail = (code, message) => { throw error(code, message); };
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
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      fail('PLUGIN_APPLY_SOURCE_CHANGED', 'The source changed while it was being read.');
    return bytes;
  } finally { await handle.close(); }
}
async function syncDirectory(directory) { const handle = await fs.open(directory, constants.O_RDONLY); try { await handle.sync(); } finally { await handle.close(); } }

export function planToolSelection({ intent, inventory, configurationBytes }) {
  if (!['enable-tools', 'disable-tools'].includes(intent.action))
    fail('PLUGIN_FULL_MODULE_EXECUTOR_REQUIRED', 'Physical installation, upgrade and removal require the module-specific accepted executor. No source or data was changed.');
  if (!/^config(?:\.[a-z0-9-]+)?\.json$/u.test(intent.configuration)) fail('PLUGIN_APPLY_CONFIGURATION_REFUSED', 'Use an original configuration filename.');
  const item = inventory.packages.find(item => item.id === intent.pluginId);
  if (!item || inventory.snapshotSha256 !== intent.inventorySha256 || item.packageSha256 !== intent.packageSha256)
    fail('PLUGIN_APPLY_SOURCE_CHANGED', 'The package or profile inventory changed since the administrator reviewed it.');
  if (intent.action === 'disable-tools' && intent.configuration === 'config.business.json' && intent.pluginId === 'workspace-goal-intelligence')
    fail('PLUGIN_CORE_DEPENDENCY_REQUIRED', 'The current business profile requires its original Brain module. This dependency has not been migrated to an optional backend.');
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

/**
 * Run only through the offline CLI, which opens the SAME exclusive control
 * store as the configured Host. A live managed Host therefore prevents this
 * operation. This changes OMP tool selection only, not backend routing, data
 * authority, existing Session history, package files or business permissions.
 */
export async function applyToolSelection({ control, root, requestId, expectedRevision, confirmPackageSha256, subject }) {
  await safeRoot(root);
  const state = control.read();
  const intent = state.intents.find(item => item.requestId === requestId);
  if (!intent || intent.packageSha256 !== confirmPackageSha256) fail('PLUGIN_APPLY_CONFIRMATION_REQUIRED', 'Use the exact recorded request and independently reviewed package SHA-256.');
  if (state.revision !== expectedRevision) fail('PLUGIN_CONTROL_STALE', 'Use the current control revision.');
  if (intent.status !== 'awaiting-verified-executor') fail('PLUGIN_APPLY_RECONCILE_REQUIRED', 'This request has already progressed. Inspect or explicitly reconcile it instead of reapplying.');
  if (state.intents.some(item => item.status === 'applying') || state.receipts.length > 1997 || state.events.length > 1997)
    fail('PLUGIN_APPLY_RECONCILE_REQUIRED', 'Another incomplete operation or the control capacity must be reviewed first.');
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

/** Explicit recovery never guesses, reexecutes a tool, deletes a package or rolls back a remote write. */
export async function reconcileToolSelection({ control, root, requestId, expectedRevision, subject }) {
  await safeRoot(root);
  const state = control.read();
  if (state.revision !== expectedRevision) fail('PLUGIN_CONTROL_STALE', 'Use the current control revision.');
  const intent = state.intents.find(item => item.requestId === requestId);
  if (!intent || !intent.application || !['applying', 'selection-applied', 'not-applied'].includes(intent.status))
    fail('PLUGIN_APPLY_NOT_PREPARED', 'No prepared selection transaction exists for this request.');
  const application = intent.application;
  if (!/^config(?:\.[a-z0-9-]+)?\.json$/u.test(application.configuration) || application.intentId !== intent.id || application.requestId !== requestId)
    fail('PLUGIN_APPLY_RECONCILE_REQUIRED', 'The stored application identity requires review.');
  const barrierPath = path.join(root, PLUGIN_SELECTION_BARRIER);
  let marker;
  try { marker = JSON.parse((await fileBytes(barrierPath)).toString('utf8')); }
  catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
  if (marker && JSON.stringify(marker) !== JSON.stringify(application)) fail('PLUGIN_APPLY_RECONCILE_REQUIRED', 'The barrier belongs to another or altered transaction.');
  const currentSha = sha(await fileBytes(path.join(root, application.configuration)));
  const applied = currentSha === application.afterSha256;
  if (!applied && currentSha !== application.beforeSha256) fail('PLUGIN_APPLY_RECONCILE_REQUIRED', 'Configuration bytes match neither side of the reviewed change. Nothing was reset.');
  if (applied && (await packageSnapshot(path.join(root, intent.pluginId))).sha256 !== intent.packageSha256)
    fail('PLUGIN_APPLY_SOURCE_CHANGED', 'Package bytes changed after the reviewed configuration write. Keep the barrier and review the code.');
  let result = { intent, selectionApplied: applied, backendChanged: false, codeInstalled: false, dataDeleted: false, restartRequired: true };
  if (intent.status === 'applying') result = await control.transact({ requestId: 'apply-finish:' + intent.id, expectedRevision, subject, operation: { type: 'selection.reconcile', intentId: intent.id, observedSha256: currentSha } }, next => {
    const current = next.intents.find(item => item.id === intent.id);
    current.status = applied ? 'selection-applied' : 'not-applied'; current.executed = applied;
    return { intent: current, selectionApplied: applied, backendChanged: false, codeInstalled: false, dataDeleted: false, restartRequired: true };
  });
  if (marker) { await fs.unlink(barrierPath); await syncDirectory(root); }
  return result;
}
