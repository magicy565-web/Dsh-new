// Isolated synthetic records only. Existing Store and enterprise Session API.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { taskFixture } from './pi-task-helpers.mjs';
import { request } from '../agent-service.helpers.mjs';
import { createWorkspaceClient } from '../../pi/extensions/workspace.mjs';
import { createWorkspaceLibraryClient } from '../../pi/extensions/workspace-library-client.mjs';

export const RECIPIENT = Object.freeze({ kind: 'pi-coding-agent', provider: 'workspace-agent-test-faux', model: 'workspace-agent-test', destination: 'faux://keyless-synthetic' });
export const COMPANY = Object.freeze({ legalName: '合成企业有限公司', displayName: '合成企业', description: '隔离验收用企业资料，来自原始公司记录。' });
export const PRODUCT = Object.freeze({ name: '合成保温杯', description: '原始产品记录：500ml 的隔离测试保温杯。', category: '杯具', status: 'draft' });
export const PRIVATE = 'UNREVIEWED_SYNTHETIC_SUPPLY_POLICY_MUST_NOT_REACH_PI';
export const API = '/api/library/model-read';

export async function libraryFixture(t, options = {}) {
  const directory = options.directory || await fs.mkdtemp('/tmp/workspace-pi-library-read-');
  const workspaceId = options.workspaceId || 'pi-enterprise-test';
  const seed = await taskFixture(t, { directory, enterprise: true, workspaceId });
  const actor = { subject: 'member-a', role: 'admin' };
  let company = seed.app.businessLibrary.getCompany().company;
  if (options.seed !== false) company = (await seed.app.businessLibrary.updateCompany({ requestId: randomUUID(), expectedRevision: company.revision, changes: COMPANY }, actor)).company;
  let product = null;
  if (options.seed !== false) product = (await seed.app.businessLibrary.createProduct({ requestId: randomUUID(), ...PRODUCT,
    supply: { packaging: PRIVATE } }, actor)).product;
  const configuredPolicy = typeof options.policy === 'function' ? options.policy({ company, product }) : options.policy;
  const policy = options.policy === null ? null : {
    enabled: true, reviewed: true, workspaceId, subject: 'member-a', expiresAt: '2099-01-01T00:00:00.000Z', recipient: RECIPIENT,
    company: { revision: company.revision, fields: ['legalName', 'displayName', 'description'] },
    products: product ? [{ id: product.id, revision: product.revision }] : [], productFields: ['name', 'description', 'category', 'status'],
    ...(configuredPolicy || {}),
  };
  await seed.app.close();
  const f = await taskFixture(t, { directory, enterprise: true, workspaceId, libraryModelReadPolicy: policy, responses: options.responses || [] });
  if (!options.directory) t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return Object.assign(f, { company, product, policy });
}

export function libraryClient(f, { subject = 'member-a', recipient = RECIPIENT, calls = [], fail = false } = {}) {
  return createWorkspaceLibraryClient({ recipient, request: async (route, options) => {
    calls.push({ method: options.method, route });
    if (fail) throw new Error('Synthetic loopback Session transport failed.');
    const value = await f.workspace(route, { subject, headers: options.headers });
    return new Response(value.bytes, { status: value.status, headers: { 'content-type': value.headers['content-type'] } });
  } });
}

export function workspaceClient(f, options = {}) {
  return createWorkspaceClient({ baseURL: f.baseURL, token: f.token, libraryClient: options.libraryClient || libraryClient(f, options),
    fetchImpl: async (url, init) => {
      const target = new URL(url).pathname + new URL(url).search;
      const value = await request(f.baseURL, target, { method: init.method, rawBody: init.body, headers: { ...init.headers, Host: 'workspace.example' } });
      return new Response(value.bytes, { status: value.status, headers: { 'content-type': value.headers['content-type'] } });
    } });
}

export function toolReceipt(runtime) {
  const row = runtime.session.agent.state.messages.filter(message => message.role === 'toolResult').at(-1);
  assert.ok(row, 'Actual official Pi tool receipt required.');
  return { row, value: JSON.parse(row.content.filter(block => block.type === 'text').map(block => block.text).join('\n')) };
}
