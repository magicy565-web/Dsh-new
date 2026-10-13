import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import http from 'node:http';
import { Readable } from 'node:stream';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createApp } from '../../server/index.mjs';
import { createPiProvider } from '../../server/pi-provider.mjs';
import { signWorkspaceRequest } from '../../server/auth-ingress.mjs';

export const PUBLIC_INPUT = 'PUBLIC_SELECTED_VERSION_ONE: synthetic public product instructions only.';
export const NEWER_INPUT = 'UNSELECTED_VERSION_TWO: do not substitute this version.';
export const OUTPUT_TEXT = '# Actual local Pi fixture\nThe original selected version was used. No external model or business action ran.\n';
export async function assistantWorkspaceFixture({ configured = true, enterpriseViewer = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'assistant-workspace-browser-'));
  const faux = fauxProvider();
  const observed = [];
  const provider = () => {
    if (!configured) return createPiProvider();
    const models = createModels(); models.setProvider(faux.provider);
    return createPiProvider({ models, providerId: 'faux', model: 'faux-1' });
  };
  const keys = enterpriseViewer ? generateKeyPairSync('ed25519') : null;
  const access = enterpriseViewer ? { mode: 'enterprise', publicOrigin: 'https://workspace.example', workspaceId: 'assistant-browser-fixture', issuer: 'offline-fixture-ingress', keyId: 'offline-fixture-key', publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }), members: [{ subject: 'fixture-admin', role: 'admin' }, { subject: 'fixture-viewer', role: 'viewer' }] } : undefined;
  const options = () => ({ dataDirectory: directory, provider: provider(), capabilityEnvironment: {}, ...(access ? { access } : {}) });
  let app;
  try {
  app = await createApp(options());
  let base;
  async function listen() { const address = await app.listen(0); base = `http://127.0.0.1:${address.port}`; }
  await listen();
  async function signedRequest(path, method = 'GET', body = '', headers = {}) {
    const requestHeaders = { ...headers, Host: 'workspace.example', 'X-Workspace-Assertion': signWorkspaceRequest({ privateKey: keys.privateKey, ...access, subject: 'fixture-viewer', method, target: path, body }), ...(!['GET', 'HEAD'].includes(method) ? { Origin: access.publicOrigin } : {}) };
    return new Promise((resolve, reject) => {
      const request = http.request(new URL(path, base), { method, headers: requestHeaders }, response => resolve(new Response(Readable.toWeb(response), { status: response.statusCode, headers: response.headers })));
      request.once('error', reject);
      request.setTimeout(15000, () => request.destroy(Error('Signed loopback fixture deadline exceeded.')));
      request.end(body);
    });
  }
  let session = null;
  if (enterpriseViewer) {
    const response = await signedRequest('/api/session/login', 'POST', '{}', { 'Content-Type': 'application/json', 'X-Workspace-Login': '1' });
    assert.equal(response.status, 200);
    session = { ...await response.json(), cookie: response.headers.get('set-cookie').split(';')[0] };
    assert.equal(session.user.role, 'viewer');
  }
  const conversation = (await app.runtime.createConversation({ title: 'Assistant workspace fixture' })).conversation;
  const file = (await app.artifacts.create({ filename: 'public-selected.txt', content: PUBLIC_INPUT })).artifact;
  await app.artifacts.update(file.id, { content: NEWER_INPUT });
  const privateFile = (await app.artifacts.create({ filename: 'internal-document.txt', content: 'PRIVATE_LIBRARY_FILE_MUST_REMAIN_LOCAL' })).artifact;
  const owner = { subject: 'local-operator', role: 'admin' };
  const asset = { artifactId: privateFile.id, version: 1, sha256: privateFile.sha256 };
  const document = (await app.businessLibrary.createDocument({ requestId: randomUUID(), title: 'Local exact document', slotKey: 'specification', asset }, owner)).document;
  const product = (await app.businessLibrary.createProduct({ requestId: randomUUID(), name: 'PRIVATE_LIBRARY_PRODUCT_MUST_REMAIN_LOCAL', documents: [{ documentId: document.id, documentVersion: 1, purpose: 'Local association' }] }, owner)).product;
  function complete(filename) {
    faux.setResponses([
      ctx => { observed.push(JSON.stringify(ctx)); return fauxAssistantMessage(fauxToolCall('workspace_input', { kind: 'artifact', id: file.id }), { stopReason: 'toolUse' }); },
      ctx => {
        const serialized = JSON.stringify(ctx); observed.push(serialized);
        assert.ok(serialized.includes(PUBLIC_INPUT), 'The real Pi tool returns selected original bytes.');
        assert.equal(serialized.includes(NEWER_INPUT), false);
        assert.equal(serialized.includes('PRIVATE_LIBRARY_'), false);
        return fauxAssistantMessage(JSON.stringify({ done: true, content: 'The synthetic local result file is ready for review.', plan: [{ id: 'read', title: 'Read exact selected source', status: 'completed' }, { id: 'save', title: 'Save local result file', status: 'completed' }], artifact: { filename, content: OUTPUT_TEXT } }));
      },
    ]);
  }
  return {
    directory, faux, observed, conversation, file, product, document, complete, session, signedRequest,
    get app() { return app; }, get base() { return base; },
    async reopen() { await app.close(); app = await createApp(options()); await listen(); },
    async close() { await app.close(); await rm(directory, { recursive: true, force: true }); },
  };
  } catch (error) {
    await app?.close(); await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
