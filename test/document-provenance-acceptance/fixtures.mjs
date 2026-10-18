// All documents, identities, grants and parser responses here are SYNTHETIC.
// No extraction engine, model, SDK or production authorization is simulated as real.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { openStore } from '../../server/store.mjs';
import { createEnterpriseContextSessionBinding } from '../../server/workspace-enterprise-context-host.mjs';
import { libraryReadHash } from '../../server/library-model-read-contract.mjs';

export const BASE = 'da04f977535b724d2ea22077f80670f1962b4f39';
export const sha = value => createHash('sha256').update(value).digest('hex');
export const model = Object.freeze({ provider: 'synthetic-provenance', id: 'no-model', baseUrl: 'https://synthetic.invalid' });
export const recipient = Object.freeze({ kind: 'pi-coding-agent', provider: model.provider, model: model.id, destination: model.baseUrl });
export const code = expected => error => error.code === expected;
export const texts = Object.freeze([
  'SYNTHETIC ACCEPTANCE ONLY\nCUP-A | steel | MOQ 120\n',
  'SYNTHETIC ACCEPTANCE ONLY\nBOWL-B | ceramic | MOQ 780\n',
]);

// Existing contract: the classification target and each evidence source are
// independently identified. These are schema fixtures, not genuine read receipts.
export function crossDocumentClassification() {
  return { requestId: 'synthetic-cross-document-classification', sources: texts.map((text, i) => ({
    asset: { artifactId: i ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', version: 1, sha256: sha(text) },
    readHash: sha('synthetic-read-' + i),
  })), records: [{ key: 'classify-A-using-only-B', kind: 'document', sourceIndex: 0,
    values: { title: 'BOWL-B' }, evidence: [{ path: 'title', sourceIndex: 1,
      start: texts[1].indexOf('BOWL-B'), end: texts[1].indexOf('BOWL-B') + 6, quote: 'BOWL-B' }],
    missing: [], conflicts: [] }] };
}

// A well-formed two-page PDF generated solely for transport identity checks.
// No assertion here claims that any PDF engine recognized its text or table.
export function syntheticPdf() {
  const streams = texts.map(text => `BT /F1 11 Tf 40 720 Td (${text.replaceAll('\n', ' ').replace(/[()\\]/g, '\\$&')}) Tj ET`);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...streams.map(s => `<< /Length ${Buffer.byteLength(s)} >>\nstream\n${s}\nendstream`),
  ];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(pdf + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}
export const payload = text => ({ status: 'success', document: { text_content: text }, errors: [] });

export async function parserFixture(t) {
  const state = { calls: [], response: payload(texts[0]), httpStatus: 200, raw: null, onResponse: null, error: null };
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/convert/file');
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const form = await new Request('http://synthetic-loopback', { method: 'POST', body: Buffer.concat(chunks), headers: { 'content-type': req.headers['content-type'] } }).formData();
      const file = form.get('files'), bytes = Buffer.from(await file.arrayBuffer());
      state.calls.push({ bytes, sha256: sha(bytes), filename: file.name, mimeType: file.type,
        formats: form.getAll('to_formats'), imageExport: form.get('image_export_mode') });
      if (state.onResponse) await state.onResponse(bytes);
      res.writeHead(state.httpStatus, { 'content-type': 'application/json' });
      res.end(state.raw ?? JSON.stringify(state.response));
    } catch (error) { state.error = error; res.writeHead(500); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); if (state.error) throw state.error; });
  return { state, connection: { reviewed: true, baseURL: 'http://127.0.0.1:' + server.address().port,
    apiKey: 'synthetic-acceptance-parser-value', timeoutMs: 2000 } };
}

export async function hostFixture(t) {
  const parser = await parserFixture(t), directory = await fs.mkdtemp('/tmp/document-provenance-host-');
  const store = await openStore(directory);
  t.after(async () => { await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const rows = texts.map((text, i) => ({ documentId: randomUUID(), revision: 1, documentVersion: 1,
    asset: { artifactId: randomUUID(), version: 1, sha256: sha(text) }, bytes: Buffer.from(text), index: i }));
  await store.update(state => {
    state.artifacts = rows.map(row => ({ id: row.asset.artifactId, metadata: { businessLibrary: { visibility: 'internal' } },
      versions: [{ version: 1, sha256: row.asset.sha256 }] }));
    state.businessLibrary.documents = rows.map(row => ({ id: row.documentId, revision: 1, currentVersion: 1, status: 'active',
      versions: [{ version: 1, asset: row.asset }] }));
  });
  // Deliberately synthetic authority seam, NOT createLibraryModelRead or signed
  // ingress. The separate upload-library suite requires those actual services.
  const state = { live: true, transfer: true, downloads: 0, corruptBytes: false, afterDownload: null };
  const identity = { sessionId: 'synthetic-session', subject: 'synthetic-member', role: 'admin', workspaceId: 'synthetic-provenance' };
  const access = { mode: 'enterprise', nativeSessionById: id => id === identity.sessionId && state.live ? identity : null };
  const sourceService = { factoryDocumentForSession({ asset }) {
    const pin = rows.find(row => libraryReadHash(row.asset) === libraryReadHash(asset));
    if (!pin) throw Object.assign(Error('SYNTHETIC_SOURCE_NOT_SELECTED'), { code: 'SYNTHETIC_SOURCE_NOT_SELECTED' });
    const doc = store.read().businessLibrary.documents.find(row => row.id === pin.documentId);
    if (doc.status !== 'active' || doc.revision !== pin.revision || doc.currentVersion !== pin.documentVersion
      || libraryReadHash(doc.versions.find(row => row.version === pin.documentVersion)?.asset) !== libraryReadHash(asset))
      throw Object.assign(Error('SYNTHETIC_CURRENT_SOURCE_CHANGED'), { code: 'SYNTHETIC_CURRENT_SOURCE_CHANGED' });
    return { documentId: pin.documentId, revision: pin.revision, documentVersion: pin.documentVersion,
      authorization: { scopeFingerprint: 'synthetic-original-policy', expiresAt: '2099-01-01T00:00:00Z' } };
  } };
  const artifacts = { async download(id, { version }) {
    state.downloads++;
    const row = rows.find(row => row.asset.artifactId === id && row.asset.version === version);
    assert.ok(row, 'Host must download an exact selected asset/version');
    if (state.afterDownload) await state.afterDownload();
    return { bytes: state.corruptBytes ? rows[1 - row.index].bytes : row.bytes, mimeType: 'text/plain', version: { sha256: row.asset.sha256 } };
  } };
  parser.state.onResponse = bytes => { const row = rows.find(row => row.asset.sha256 === sha(bytes)); assert.ok(row); parser.state.response = payload(texts[row.index]); };
  const bind = sources => createEnterpriseContextSessionBinding({ identity, access, instanceId: 'synthetic-instance',
    sessionClient: { readOnlySession: true, bindingIdentity: async () => ({ ...identity, instanceId: 'synthetic-instance' }) },
    libraryModelRead: sourceService, artifacts, store, recipient,
    selection: { enabled: true, reviewed: true, customerId: 'synthetic-buyer', sources: sources.map(({ documentId, asset }) => ({ documentId, asset })) },
    connection: parser.connection, authorizeParserTransfer: async request => state.transfer === true
      && request.recipient.destination === parser.connection.baseURL + '/v1/convert/file'
      && request.purpose === 'document-extraction' && request.transfer === 'complete-file'
      && sources.some(row => row.documentId === request.documentId && row.revision === request.documentRevision
        && row.documentVersion === request.documentVersion && libraryReadHash(row.asset) === libraryReadHash(request.target)) });
  const control = (await bind(rows)).open('synthetic-native');
  return { ...parser, hostState: state, rows, store, control, bind,
    change: async index => store.update(snapshot => { snapshot.businessLibrary.documents[index].revision++; }) };
}
