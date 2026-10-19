import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { canonical, openPluginControlStore } from '../../server/plugin-library/control-store.mjs';
import { readPluginInventory } from '../../server/plugin-library/inventory.mjs';
import { createPluginLibraryModule } from '../../server/plugin-library/http.mjs';

export class TestApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
export const workspaceId = 'plugin-library-fixture-enterprise';
export const epoch = 2000000000000;
export const code = expected => error => error?.code === expected;
export function signer() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const record = { keyId: 'fixture-ed25519', publisher: 'acme.labs', publicKey: publicKey.export({ format: 'pem', type: 'spki' }).toString() };
  const manifest = { schemaVersion: 1, id: 'thirdparty.acme.labs.example', name: 'Synthetic review fixture', version: '1.0.0', description: 'No actual image exists and no image is pulled.', license: 'MIT', publisher: 'acme.labs', execution: 'isolated-oci', artifact: { image: 'example.invalid/acme/fixture@sha256:' + 'a'.repeat(64), command: ['/app/main'], protocol: 'workspace-plugin-json-v1' }, permissions: { network: 'none', hostFilesystem: 'none', input: 'explicit-json', output: 'json' } };
  const envelope = value => ({ manifest: structuredClone(value), keyId: record.keyId, signature: sign(null, Buffer.from(canonical(value)), privateKey).toString('base64') });
  return { record, manifest, envelope };
}
export async function fixture(t, { pluginId = 'workspace-plugin-info' } = {}) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-stage2-')));
  const root = path.join(base, 'plugins'), directory = path.join(base, 'control');
  const resources = [], sessions = new Map(); let time = epoch;
  t.after(async () => { for (const resource of [...resources].reverse()) await resource.close(); await fs.rm(base, { recursive: true, force: true }); });
  await fs.mkdir(directory, { mode: 0o700 }); await fs.chmod(directory, 0o700);
  const packageDirectory = path.join(root, pluginId);
  await fs.mkdir(path.join(packageDirectory, 'src'), { recursive: true });
  await fs.mkdir(path.join(packageDirectory, 'skills', 'sample'), { recursive: true });
  const write = (relative, data) => fs.writeFile(path.join(root, relative), data, { mode: 0o600 });
  await write('config.json', JSON.stringify({ extensions: ['./' + pluginId], disabledExtensions: [] }));
  await write('config.business.json', JSON.stringify({ extensions: ['./' + pluginId], disabledExtensions: [] }));
  await write(pluginId + '/package.json', JSON.stringify({ name: '@workspace-agent/' + pluginId, version: '1.0.0', type: 'module', pi: { extensions: ['src/extension.js'], skills: ['skills/sample'] } }));
  await write(pluginId + '/README.md', 'Synthetic test package.');
  await write(pluginId + '/AGENTS.md', 'Synthetic maintenance text.');
  await write(pluginId + '/skills/sample/SKILL.md', '---\nname: sample\ndescription: Synthetic fixture\n---\nNo business execution.\n');
  await write(pluginId + '/src/extension.js', 'throw new Error("INVENTORY_EXECUTED_PLUGIN_CODE");\n');
  const clock = () => time;
  const admin = (subject = 'admin-a', role = 'admin') => {
    const session = { id: randomUUID(), subject, role, expiresAt: time + 600000 };
    sessions.set(session.id, { ...session, workspaceId });
    return { workspaceId, subject, role, session, claims: { exp: (time + 600000) / 1000 } };
  };
  // This is explicitly a synthetic live authority, not a replacement SDK or a
  // claim that the original signed ingress has been exercised by these tests.
  const access = { mode: 'enterprise', nativeSessionById(id) { const current = sessions.get(id); return current && current.expiresAt > time ? { ...current } : null; } };
  const open = async () => { const store = await openPluginControlStore({ directory, workspaceId, ApiError: TestApiError, clock }); resources.push(store); return store; };
  const module = async (publishers = [], overrides = {}) => {
    const value = await createPluginLibraryModule({ ApiError: TestApiError, workspaceId, root, access, clock, environment: { WORKSPACE_PLUGIN_LIBRARY_ENABLED: '1', WORKSPACE_PLUGIN_LIBRARY_STATE_DIRECTORY: directory, WORKSPACE_PLUGIN_LIBRARY_PUBLISHERS_JSON: JSON.stringify(publishers) }, ...overrides });
    if (value) resources.push(value); return value;
  };
  const request = async (control, action = 'disable-tools', overrides = {}) => {
    const inventory = await readPluginInventory({ root }), item = inventory.packages.find(item => item.id === pluginId);
    const intent = { id: randomUUID(), requestId: randomUUID(), subject: 'admin-a', type: 'plugin.change-request', action, pluginId, configuration: 'config.json', inventorySha256: inventory.snapshotSha256, packageSha256: item.packageSha256, status: 'awaiting-verified-executor', createdAt: new Date(time).toISOString(), expiresAt: new Date(time + 86400000).toISOString(), executed: false, dataDeleted: false, ...overrides };
    await control.transact({ requestId: intent.requestId, expectedRevision: control.read().revision, subject: intent.subject, operation: { type: 'fixture.record' } }, state => { state.intents.push(intent); return { intent }; });
    return intent;
  };
  return { base, root, directory, packageDirectory, pluginId, write, clock, admin, access, open, module, request, advance: milliseconds => { time += milliseconds; }, revoke: context => sessions.delete(context.session.id) };
}
export async function call(module, context, pathname = '/api/plugin-library', body, overrides = {}) {
  let response;
  const matched = await module.handle({ req: { method: body === undefined ? 'GET' : 'POST' }, res: {}, pathname, context, body,
    respond: async (res, status, value, beforeWrite) => { await res.accessFinish?.(status); beforeWrite?.(); response = { status, body: structuredClone(value) }; }, ...overrides });
  return { matched, ...response };
}
export async function requestBody(f, module, actor, action = 'disable-tools') {
  const view = (await call(module, actor)).body;
  return { requestId: randomUUID(), expectedRevision: view.revision, action, pluginId: f.pluginId, inventorySha256: view.inventory.snapshotSha256, packageSha256: view.inventory.packages[0].packageSha256, configuration: 'config.json' };
}
