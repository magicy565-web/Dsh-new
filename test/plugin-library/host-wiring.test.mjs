import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { TestApiError } from './fixtures.mjs';
const source = await fs.readFile(new URL('../../server/index.mjs', import.meta.url), 'utf8');
// Execute the unchanged original responder body plus its new final-check seam.
// This focused production-helper test is not a full createApp/SDK acceptance.
function originalResponder() {
  const start = source.indexOf('async function respond('), end = source.indexOf('\nasync function readBody(', start);
  assert.ok(start > 0 && end > start);
  return vm.runInNewContext('(' + source.slice(start, end) + ')', { ApiError: TestApiError }, { timeout: 1000 });
}
test('original response helper checks live authority after audit and before output', async () => {
  const respond = originalResponder(); let current = true, written = false;
  const res = { accessFinish: async () => { current = false; }, writeHead() { written = true; }, end() { written = true; } };
  await assert.rejects(respond(res, 200, { privateDescriptor: 'fixture' }, () => { if (!current) throw new TestApiError(403, 'REVOKED', 'Revoked.'); }), error => error.code === 'REVOKED');
  assert.equal(written, false);
});
test('original response helper preserves filtering, audit and JSON response order', async () => {
  const respond = originalResponder(), order = []; let payload;
  await respond({ filterWorkspaceResponse(value) { order.push('filter'); return { ...value, filtered: true }; }, accessFinish: async () => order.push('audit'), writeHead(status, headers) { order.push('headers'); assert.equal(status, 200); assert.equal(headers['Cache-Control'], 'no-store'); }, end(body) { order.push('body'); payload = JSON.parse(body); } }, 200, { ok: true }, () => order.push('current'));
  assert.deepEqual(order, ['filter', 'audit', 'current', 'headers', 'body']); assert.deepEqual(payload, { ok: true, filtered: true });
});
test('original Host independently assembles and closes management without Medusa ownership', async () => {
  const assembly = await fs.readFile(new URL('../../server/workspace-backend-plugins.mjs', import.meta.url), 'utf8');
  assert.equal(assembly.includes('createPluginLibraryModule'), false);
  assert.match(source, /pluginLibraryModule = await createPluginLibraryModule\(\{ ApiError, access, workspaceId:/);
  assert.match(source, /environment: capabilityEnvironment, backendSelection, clock: accessClock/);
  assert.match(source, /Promise\.allSettled\(\[pluginLibraryModule\?\.close\(\), medusaModule\?\.close\(\)/);
  const mutation = source.indexOf('pluginLibraryModule.handle({req,res,pathname,context,body,respond})');
  const signature = source.lastIndexOf('access.verifyBody(context, req.bodyBytes || Buffer.alloc(0));', mutation);
  const privacy = source.lastIndexOf('agentPrivacy.guardHttp(pathname, context, body);', mutation);
  assert.ok(signature > 0 && signature < privacy && privacy < mutation);
});
