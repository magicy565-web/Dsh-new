import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { Harness, ProviderDoc, createRegistry, defineDoc } from '@earendil-works/pi-durable';
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node';
import { createApp } from '../../server/index.mjs';
import { createPiProvider } from '../../server/pi-provider.mjs';
import { signWorkspaceRequest } from '../../server/auth-ingress.mjs';
import { request } from '../agent-service.helpers.mjs';

export const TOKEN_A = 'pi-public-synthetic-test-member-a';
export const TOKEN_B = 'pi-public-synthetic-test-member-b';
export const PI_API = '/api/agent/v1/pi';
const sha = value => createHash('sha256').update(value).digest('hex');
export async function until(check) {
  for (let i = 0; i < 600; i++) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('Original Pi task fixture did not settle.');
}
export async function api(f, route, body, { token = f.token || TOKEN_A, headers = {} } = {}) {
  return request(f.baseURL, route, { method: body === undefined ? 'GET' : 'POST', token,
    headers: { ...(f.enterprise ? { Host: 'workspace.example' } : {}), ...headers }, ...(body === undefined ? {} : { body }) });
}
export async function submit(f, requestId, extras = {}) {
  const response = await api(f, PI_API + '/tasks', { title: 'Public synthetic task', content: 'Explicit public task text.', requestId, ...extras });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  return response.json;
}
export async function terminal(f, id) {
  await until(() => !['running', 'queued'].includes(f.app.runtime.getRun(id).run.status));
  const response = await api(f, PI_API + '/tasks/' + id);
  assert.equal(response.status, 200, JSON.stringify(response.json)); return response.json;
}
export async function taskFixture(t, { directory: selectedDirectory, enterprise = false, workspaceId = 'pi-enterprise-test', responses = [], principals: selectedPrincipals, accessClock, libraryModelReadPolicy = null, businessAgentOptions = null, marketValidationOptions = {}, listenPort = 0, timeoutMs = 60000 } = {}) {
  const directory = selectedDirectory || await fs.mkdtemp('/tmp/workspace-pi-task-test-');
  const faux = fauxProvider({ api: 'faux' }); faux.setResponses(responses);
  const models = createModels(); models.setProvider(faux.provider);
  const keys = enterprise ? generateKeyPairSync('ed25519') : null;
  const access = enterprise ? { mode: 'enterprise', publicOrigin: 'https://workspace.example', workspaceId, issuer: 'pi-test-ingress', keyId: 'pi-test-key',
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }), members: [{ subject: 'member-a', role: 'admin' }, { subject: 'member-b', role: 'operator' }] } : {};
  const principals = selectedPrincipals || (enterprise ? [
    { subject: 'member-a', workspaceId: access.workspaceId, tokenSha256: sha(TOKEN_A), scopes: ['agent:read', 'agent:submit'] },
    { subject: 'member-b', workspaceId: access.workspaceId, tokenSha256: sha(TOKEN_B), scopes: ['agent:read', 'agent:submit'] },
  ] : [{ subject: 'local-operator', workspaceId: 'local', tokenSha256: sha(TOKEN_A), scopes: ['agent:read', 'agent:submit'] }]);
  const app = await createApp({ dataDirectory: directory, capabilityEnvironment: {}, access, accessClock, libraryModelReadPolicy, businessAgentOptions, marketValidationOptions,
    provider: createPiProvider({ models, providerId: 'faux', model: 'faux-1', timeoutMs }), agentConfig: { env: {}, principals } });
  const address = await app.listen(listenPort);
  const sessions = new Map();
  const f = { directory, app, faux, enterprise, token: TOKEN_A, baseURL: `http://127.0.0.1:${address.port}`,
    // Clearing a fixture cache triggers the same original signed login on the
    // next request; it never installs an identity or bypasses Session expiry.
    clearWorkspaceSession(subject) { sessions.delete(subject); },
    async workspace(route, { subject = 'member-b', body, headers = {} } = {}) {
      if (!sessions.has(subject)) {
        const target = '/api/session/login';
        const login = await request(this.baseURL, target, { method: 'POST', body: {}, headers: { Host: 'workspace.example', Origin: access.publicOrigin, 'X-Workspace-Login': '1',
          'X-Workspace-Assertion': signWorkspaceRequest({ privateKey: keys.privateKey, ...access, subject, method: 'POST', target, body: '{}', ...(accessClock ? { now: accessClock() } : {}) }) } });
        assert.equal(login.status, 200, JSON.stringify(login.json));
        sessions.set(subject, { Cookie: login.headers['set-cookie'][0].split(';')[0], 'X-CSRF-Token': login.json.csrfToken });
      }
      const method = body === undefined ? 'GET' : 'POST';
      return request(this.baseURL, route, { method, headers: { Host: 'workspace.example', ...(method === 'POST' ? { Origin: access.publicOrigin } : {}),
        ...sessions.get(subject), ...headers, 'content-type': 'application/json', 'X-Workspace-Assertion': signWorkspaceRequest({ privateKey: keys.privateKey, ...access, subject, method, target: route, body: body === undefined ? '' : JSON.stringify(body), ...(accessClock ? { now: accessClock() } : {}) }) },
        ...(body === undefined ? {} : { body }) });
    },
  };
  t.after(async () => { await app.close(); if (!selectedDirectory) await fs.rm(directory, { recursive: true, force: true }); });
  return f;
}
const RecordDoc = defineDoc({ kind: 'workspace.pi-invocations', version: 1, scope: 'conversation', history: 'latest', fork: 'initial', initial: () => ({ records: {}, active: null }) });
// Call only after the original application has released its storage writer.
export async function inspectPi(directory, conversationId) {
  const storage = await openNodeJsonlStorage(path.join(directory, 'pi', sha(conversationId)), BACKGROUND_CONTEXT, { fsync: true });
  const harness = await Harness.open(storage, { models: createModels(), registry: createRegistry() }, BACKGROUND_CONTEXT);
  try {
    const root = await harness.root(BACKGROUND_CONTEXT);
    const record = await harness.snapshot(RecordDoc, root.id, BACKGROUND_CONTEXT);
    const provider = await harness.snapshot(ProviderDoc, root.id, BACKGROUND_CONTEXT);
    const conversations = await harness.commit(tx => tx.scanConversations({}, 100), BACKGROUND_CONTEXT);
    const tasks = await harness.commit(tx => tx.scanTasks({}, 100), BACKGROUND_CONTEXT);
    const submissions = await storage.scanSubmissions({}, 100, undefined, BACKGROUND_CONTEXT);
    return { record, provider, conversations: conversations.items, tasks: tasks.items, submissions: submissions.items.filter(row => row.type === 'input') };
  } finally { await harness.close(BACKGROUND_CONTEXT); }
}
