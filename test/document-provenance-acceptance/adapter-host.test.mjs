import test from 'node:test';
import assert from 'node:assert/strict';
import { createDoclingSourceReader } from '../../plugins/workspace-enterprise-context/src/oss.mjs';
import { code, texts, sha, payload, syntheticPdf, parserFixture, hostFixture, model } from './fixtures.mjs';

test('PDF and CSV transport pins actual bytes; page/table metadata is outside the current projection contract', async t => {
  const f = await parserFixture(t), read = createDoclingSourceReader(f.connection);
  const samples = [{ bytes: syntheticPdf(), mimeType: 'application/pdf', filename: 'selected.pdf' },
    { bytes: Buffer.from('SYNTHETIC ACCEPTANCE ONLY\nSKU,MOQ\nCUP-A,120\nBOWL-B,780\n'), mimeType: 'text/csv', filename: 'selected.csv' }];
  f.state.response = { ...payload(texts.join('\n')), document: { text_content: texts.join('\n'),
    // Explicit invented stand-in metadata, not an observed real Docling schema.
    pages: [{ page_no: 1 }, { page_no: 2 }], tables: [{ row: 1, column: 2, value: '120' }] } };
  for (const sample of samples) {
    const result = await read(sample), sent = f.state.calls.at(-1);
    assert.deepEqual(sent.bytes, sample.bytes); assert.equal(sent.sha256, sha(sample.bytes));
    assert.equal(sent.filename, sample.filename); assert.equal(sent.mimeType, sample.mimeType);
    assert.deepEqual(sent.formats, ['md', 'text']); assert.equal(sent.imageExport, 'placeholder');
    assert.equal(result.sourceSha256, sha(sample.bytes)); assert.equal(result.text, texts.join('\n'));
    assert.equal(result.extractionPolicy, 'self-hosted-docling-serve-v1');
    assert.equal(Object.hasOwn(result, 'pages'), false); assert.equal(Object.hasOwn(result, 'tables'), false);
  }
  assert.equal(f.state.calls.length, 2);
});

test('interleaved A/B/A parses retain independent document and exact asset lineage', async t => {
  const f = await hostFixture(t), receipts = [];
  for (const index of [0, 1, 0]) {
    const pin = f.rows[index], result = await f.control.parseUpload(pin.asset, undefined, model);
    assert.equal(result.text, texts[index]); assert.equal(result.sourceSha256, pin.asset.sha256);
    assert.deepEqual(result.source, { documentId: pin.documentId, revision: 1, documentVersion: 1, asset: pin.asset });
    assert.deepEqual(result.authorization.sources, [result.source]);
    f.control.verifyBody(result.authorization, result); await f.control.check(result.authorization, undefined, model);
    receipts.push(result);
  }
  assert.notEqual(receipts[0].authorization.bodyHash, receipts[1].authorization.bodyHash);
  assert.equal(f.state.calls.length, 3); // Receipt reuse never reparses.
  const substituted = structuredClone(receipts[0]); substituted.source = receipts[1].source;
  assert.throws(() => f.control.verifyBody(substituted.authorization, substituted), code('OSS_PRIVATE_CACHED_BODY_CHANGED'));
});

test('a tuple assembled from different selected assets is refused before download or HTTP', async t => {
  const f = await hostFixture(t), [a, b] = f.rows;
  for (const candidate of [{ ...a.asset, sha256: b.asset.sha256 }, { ...a.asset, version: 2 },
    { ...a.asset, artifactId: b.asset.artifactId }])
    await assert.rejects(f.control.parseUpload(candidate, undefined, model), code('OSS_CUSTOMER_SOURCE_NOT_SELECTED'));
  assert.equal(f.hostState.downloads, 0); assert.equal(f.state.calls.length, 0);
});

test('actual byte hash defeats metadata-only substitution before parser dispatch', async t => {
  const f = await hostFixture(t); f.hostState.corruptBytes = true;
  await assert.rejects(f.control.parseUpload(f.rows[0].asset, undefined, model), code('OSS_SOURCE_VERSION_CHANGED'));
  assert.equal(f.state.calls.length, 0);
});

test('source changes after download withhold complete-file dispatch', async t => {
  const f = await hostFixture(t); f.hostState.afterDownload = () => f.change(0);
  await assert.rejects(f.control.parseUpload(f.rows[0].asset, undefined, model), code('SYNTHETIC_CURRENT_SOURCE_CHANGED'));
  assert.equal(f.state.calls.length, 0);
});

test('B changing during its response withholds B text while prior A proof remains individually valid', async t => {
  const f = await hostFixture(t), a = await f.control.parseUpload(f.rows[0].asset, undefined, model);
  f.state.onResponse = async () => { await f.change(1); f.state.response = payload(texts[1]); };
  await assert.rejects(f.control.parseUpload(f.rows[1].asset, undefined, model), code('SYNTHETIC_CURRENT_SOURCE_CHANGED'));
  await f.control.check(a.authorization, undefined, model);
  await assert.rejects(f.control.finalCheck(undefined, model), code('SYNTHETIC_CURRENT_SOURCE_CHANGED'));
  assert.equal(f.state.calls.length, 2);
});

test('cached A cannot survive a new current revision even when its physical bytes still exist', async t => {
  const f = await hostFixture(t), a = await f.control.parseUpload(f.rows[0].asset, undefined, model);
  await f.change(0);
  await assert.rejects(f.control.check(a.authorization, undefined, model), code('SYNTHETIC_CURRENT_SOURCE_CHANGED'));
  await assert.rejects(f.control.finalCheck(undefined, model), code('SYNTHETIC_CURRENT_SOURCE_CHANGED'));
  assert.equal(f.state.calls.length, 1);
});

test('narrowed B-only binding cannot inherit A parse proof or substitute its native Session', async t => {
  const f = await hostFixture(t), a = await f.control.parseUpload(f.rows[0].asset, undefined, model);
  const other = (await f.bind([f.rows[1]])).open('synthetic-other-native');
  await assert.rejects(other.check(a.authorization, undefined, model), code('OSS_PRIVATE_RECEIPT_REFUSED'));
  const forged = { ...a.authorization, nativeSessionId: 'synthetic-other-native' };
  await assert.rejects(other.check(forged, undefined, model), code('OSS_PRIVATE_RECEIPT_REFUSED'));
  assert.equal(f.state.calls.length, 1);
});

test('revoked Session and revoked file-transfer consent independently deny cached provenance', async t => {
  for (const kind of ['session', 'transfer']) await t.test(kind, async t => {
    const f = await hostFixture(t), result = await f.control.parseUpload(f.rows[0].asset, undefined, model);
    f.hostState[kind === 'session' ? 'live' : 'transfer'] = false;
    const reason = kind === 'session' ? 'OSS_SESSION_REVOKED' : 'OSS_DOCLING_TRANSFER_NOT_APPROVED';
    await assert.rejects(f.control.check(result.authorization, undefined, model), code(reason));
    await assert.rejects(f.control.finalCheck(undefined, model), code(reason));
    assert.equal(f.state.calls.length, 1);
  });
});

test('empty/wrong-shape/invalid JSON responses yield no authenticated parse receipt and no retry', async t => {
  const f = await hostFixture(t); f.state.onResponse = null;
  const candidates = [payload('   '), { status: 'success', document: {} }, payload(['not text']), null];
  for (const candidate of candidates) {
    f.state.response = candidate; f.state.raw = candidate === null ? '{INVALID SYNTHETIC JSON' : null;
    await assert.rejects(f.control.parseUpload(f.rows[0].asset, undefined, model),
      code(candidate === null ? 'OSS_RESPONSE_INVALID' : 'DOCLING_RESULT_UNVERIFIED'));
  }
  assert.equal(f.state.calls.length, 4);
});

test('unsupported format is refused before HTTP; partial text remains explicitly partial', async t => {
  const f = await parserFixture(t), read = createDoclingSourceReader(f.connection);
  await assert.rejects(read({ bytes: Buffer.from('{}'), mimeType: 'application/json' }), code('DOCLING_UPLOAD_UNSUPPORTED'));
  assert.equal(f.state.calls.length, 0);
  f.state.response = { ...payload(texts[0]), status: 'partial_success', errors: ['synthetic page incomplete'] };
  const result = await read({ bytes: syntheticPdf(), mimeType: 'application/pdf' });
  assert.equal(result.status, 'partial'); assert.equal(result.textTruncated, true); assert.equal(result.errors, 1);
});
