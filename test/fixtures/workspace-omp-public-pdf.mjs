import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createWorkspaceOmpPublicTools, snapshotWorkspaceOmpPublicFiles } from '../../server/workspace-omp-public-tools.mjs';

export const publicPdfHash = bytes => createHash('sha256').update(bytes).digest('hex');
function serializePdf(objects) {
  const chunks = [Buffer.from('%PDF-1.4\n')], offsets = [0]; let length = chunks[0].length;
  objects.forEach((object, index) => { offsets.push(length); const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]); chunks.push(chunk); length += chunk.length; });
  const xref = offsets.map((offset, index) => index ? String(offset).padStart(10, '0') + ' 00000 n \n' : '0000000000 65535 f \n').join('');
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(chunks);
}
// Public synthetic PDF bytes only. The image-only page contains a raster pattern,
// no text object, OCR layer, embedded attachment, script, URL or external font.
export function publicPdfBytes(text = null) {
  const stream = (dictionary, bytes) => Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`), bytes, Buffer.from('\nendstream')]);
  const image = Buffer.alloc(96 * 32 * 3, 255);
  for (let y = 8; y < 24; y++) for (let x = 8; x < 88; x++) if ((x + y) % 9 < 4) image.fill(0, (y * 96 + x) * 3, (y * 96 + x) * 3 + 3);
  const escaped = text?.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const content = Buffer.from(text === null ? 'q 400 0 0 140 72 500 cm /Im0 Do Q' : `BT /F1 14 Tf 72 700 Td (${escaped}) Tj ET`);
  const objects = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from('<< /Type /Pages /Count 1 /Kids [3 0 R] >>'),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << ${text === null ? '/XObject << /Im0 6 0 R >>' : '/Font << /F1 4 0 R >>'} >> /Contents 5 0 R >>`),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'), stream('', content),
    stream('/Type /XObject /Subtype /Image /Width 96 /Height 32 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode', deflateSync(image))];
  return serializePdf(objects);
}

export function publicLongPdfBytes() {
  const stream = (dictionary, bytes) => Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`), bytes, Buffer.from('\nendstream')]);
  const row = 'PUBLIC SYNTHETIC FACTORY MATERIAL. Capacity unknown. Candidate evidence unverified. ';
  const text = Buffer.from('BT /F1 8 Tf 72 720 Td 6 TL\n' + Array.from({ length: 100 }, () => `(${row}) Tj T*`).join('\n') + '\nET');
  const image = Buffer.alloc(96 * 32 * 3, 255);
  for (let y = 8; y < 24; y++) for (let x = 8; x < 88; x++) if ((x + y) % 9 < 4) image.fill(0, (y * 96 + x) * 3, (y * 96 + x) * 3 + 3);
  const textPages = 20, pageRefs = Array.from({ length: textPages + 1 }, (_, index) => `${index + 7} 0 R`).join(' ');
  const objects = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from(`<< /Type /Pages /Count ${textPages + 1} /Kids [${pageRefs}] >>`),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'), stream('/Filter /FlateDecode', deflateSync(text)),
    stream('/Type /XObject /Subtype /Image /Width 96 /Height 32 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode', deflateSync(image)),
    stream('', Buffer.from('q 400 0 0 140 72 500 cm /Im0 Do Q'))];
  for (let page = 0; page < textPages; page++) objects.push(Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>'));
  objects.push(Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 6 0 R >>'));
  return serializePdf(objects);
}

async function main() {
  const packageRoot = process.env.WORKSPACE_OMP_PACKAGE_ROOT, cwd = process.cwd();
  assert.equal(Bun.version, '1.3.14');
  assert.equal(JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'))).version, '18.10.4');
  const load = relative => import(pathToFileURL(path.join(packageRoot, 'src', relative)).href);
  let fetchCalls = 0, authorizations = 0;
  const noNetwork = async () => { fetchCalls++; throw new Error('PDF acceptance forbids any network request.'); };
  globalThis.fetch = noNetwork;
  const { Settings } = await load('config/settings.ts'), { AuthStorage } = await load('session/auth-storage.ts'), { ModelRegistry } = await load('config/model-registry.ts');
  const settings = await Settings.init({ cwd, agentDir: cwd + '/agent', inMemory: true, overrides: {
    'browser.relay': false, 'browser.tern': false, 'browser.cmux': false, 'eval.autoProvision': false } });
  const authStorage = await AuthStorage.create(cwd + '/empty-auth.db');
  const modelRegistry = new ModelRegistry(authStorage, cwd + '/no-models.yml', { settings, ignoreLocalModelConfig: true, fetch: noNetwork });
  const toolSession = { cwd, settings, authStorage, modelRegistry, getSessionId: () => 'public-pdf-test', getArtifactsDir: () => cwd };
  const fixtures = { product: publicPdfBytes('PUBLIC SYNTHETIC FACTORY PRODUCT. Capacity unknown. Distributor candidate evidence only.'),
    scan: publicPdfBytes(), credential: publicPdfBytes('password=syntheticForbiddenPdfValue123'), malformed: Buffer.from('%PDF-1.4\nSYNTHETIC TRUNCATED NOT A PDF\n'),
    long: publicLongPdfBytes() };
  const sourceRoot = path.join(cwd, 'public-pdf-input'); await fs.mkdir(sourceRoot);
  const selections = [];
  for (const [id, bytes] of Object.entries(fixtures)) { const filename = path.join(sourceRoot, (id === 'credential' ? 'public-filter-probe' : id) + '.pdf'); await fs.writeFile(filename, bytes); selections.push({ id, path: filename, sha256: publicPdfHash(bytes) }); }
  const snapshots = await snapshotWorkspaceOmpPublicFiles({ root: sourceRoot, files: selections });
  assert.equal(snapshots.length, 5);
  for (const snapshot of snapshots) { assert.equal(snapshot.format, 'pdf'); assert.equal(Buffer.from(snapshot.contentBase64, 'base64').length, fixtures[snapshot.id].length); assert.equal('path' in snapshot, false); }
  const configured = await createWorkspaceOmpPublicTools({ packageRoot, toolSession, authorize: async () => { authorizations++; },
    configuration: { searchProvider: 'disabled', publicFiles: snapshots }, fetchImpl: noNetwork });
  const document = configured.tools.find(tool => tool.name === 'workspace_public_document');
  function textOnly(receipt) {
    assert.ok(receipt.content.length > 0); assert.ok(receipt.content.every(block => block.type === 'text'));
    const serialized = JSON.stringify(receipt); assert.equal(serialized.includes('contentBase64'), false); assert.equal(serialized.includes('%PDF-'), false);
    assert.equal(serialized.includes(cwd), false);
    for (const bytes of Object.values(fixtures)) assert.equal(serialized.includes(bytes.toString('base64')), false);
  }
  try {
    assert.ok(fixtures.long.length <= 65536);
    const { pdfToMarkdown } = await import(pathToFileURL(path.join(packageRoot, '../pi-natives/native/index.js')).href);
    const longInspection = await pdfToMarkdown(fixtures.long);
    assert.equal(longInspection.pageCount, 21);
    // The pinned native detector does not flag this mixed image-only last page.
    // This is an observed limitation, never evidence that every page has text.
    assert.deepEqual(longInspection.pagesNeedingOcr, []);
    const { ReadTool } = await load('tools/read.ts');
    const nativeLong = await new ReadTool(toolSession).execute('native-pdf-truncation-metadata', { path: selections.find(file => file.id === 'long').path });
    assert.ok(nativeLong.details?.truncation?.truncated || nativeLong.details?.meta?.truncation);
    assert.equal(nativeLong.content.some(block => block.text?.includes('Text extraction is incomplete for PDF pages 21.')), false);
    console.log('PDF_NATIVE_TRUNCATION_METADATA ' + JSON.stringify({ truncation: nativeLong.details?.truncation, metaTruncation: nativeLong.details?.meta?.truncation }));
    const text = await document.execute('pdf-text', { documentId: 'product' }); textOnly(text);
    assert.match(text.content.map(block => block.text).join('\n'), /Capacity unknown/); assert.equal(text.details.status, 'document_read');
    assert.equal(text.details.ocrStatus, 'native_hint_only');
    assert.match(text.content.map(block => block.text).join('\n'), /OCR page hints are heuristic/);
    assert.match(text.content.map(block => block.text).join('\n'), /absence of hints does not verify every page/);
    assert.equal(text.details.documentId, 'product'); assert.equal(text.details.sha256, selections[0].sha256);
    const scan = await document.execute('pdf-scan', { documentId: 'scan' }); textOnly(scan);
    assert.equal(scan.details.status, 'partial_ocr_required'); assert.deepEqual(scan.details.pagesNeedingOcr, [1]);
    assert.equal(scan.details.ocrStatus, 'native_hint_only');
    assert.match(scan.content.map(block => block.text).join('\n'), /OCR page hints are heuristic/);
    const long = await document.execute('pdf-long', { documentId: 'long' }); textOnly(long);
    assert.equal(long.details.status, 'partial_truncated'); assert.equal(long.details.pagesNeedingOcr, null);
    assert.equal(long.details.ocrStatus, 'unknown_after_truncation'); assert.equal(long.details.textTruncated, true);
    const longText = long.content.map(block => block.text).join('\n');
    assert.match(longText, /truncated/); assert.match(longText, /OCR requirements are unknown/);
    assert.equal(longText.includes('Text extraction is incomplete for PDF pages 21.'), false);
    const malformed = await document.execute('pdf-malformed', { documentId: 'malformed' }); textOnly(malformed);
    assert.equal(malformed.isError, true); assert.equal(malformed.details.status, 'unavailable');
    let credentialReceipt;
    try { credentialReceipt = await document.execute('pdf-credential', { documentId: 'credential' }); }
    catch (error) { assert.match(error.message, /public text|credentials/); assert.equal(error.message.includes('syntheticForbiddenPdfValue123'), false); }
    if (credentialReceipt) { textOnly(credentialReceipt); assert.equal(credentialReceipt.isError, true); assert.equal(JSON.stringify(credentialReceipt).includes('syntheticForbiddenPdfValue123'), false); }
    await assert.rejects(document.execute('not-selected', { documentId: 'unselected' }), /not explicitly selected/);
    await assert.rejects(document.execute('arbitrary-path', { documentId: 'product', path: selections[0].path }), /not explicitly selected/);
    const selectedDirectories = (await fs.readdir(cwd)).filter(name => name.startsWith('selected-public-materials-'));
    assert.equal(selectedDirectories.length, 1);
    await fs.writeFile(path.join(cwd, selectedDirectories[0], 'product.pdf'), publicPdfBytes('CHANGED PUBLIC BYTES'));
    await assert.rejects(document.execute('changed-bytes', { documentId: 'product' }), /changed/);
    await assert.rejects(createWorkspaceOmpPublicTools({ packageRoot, toolSession, authorize: async () => {}, configuration: {
      searchProvider: 'disabled', publicFiles: [{ ...snapshots[0], sha256: '0'.repeat(64) }] } }), /snapshot|hash/);
    assert.equal(fetchCalls, 0);
    const facts = { ompVersion: '18.10.4', bunVersion: Bun.version, realPublishedReadTool: true, syntheticPublicFixtures: true,
      documentRead: text.details.status, ocrHints: { status: text.details.ocrStatus, modelVisibleHeuristicNotice: true },
      scan: { status: scan.details.status, pagesNeedingOcr: scan.details.pagesNeedingOcr, ocrStatus: scan.details.ocrStatus },
      long: { status: long.details.status, pagesNeedingOcr: long.details.pagesNeedingOcr, ocrStatus: long.details.ocrStatus, textTruncated: long.details.textTruncated,
        nativeFullInspection: { pageCount: longInspection.pageCount, pagesNeedingOcr: longInspection.pagesNeedingOcr,
          knownSyntheticImageOnlyPage: 21, completeOcrAssessmentClaim: false },
        nativeTruncation: nativeLong.details?.truncation, nativeMetaTruncation: nativeLong.details?.meta?.truncation },
      malformed: malformed.details.status, credentialTextRejected: true, unselectedRejected: true, alteredSnapshotRejected: true,
      allOutputTextOnly: true, binaryReturned: false, imageReturned: false, fetchCalls, paidModelCalls: 0, authorizations,
      fixtures: Object.entries(fixtures).map(([id, bytes]) => ({ id, bytes: bytes.length, sha256: publicPdfHash(bytes) })) };
    await fs.writeFile(process.env.WORKSPACE_OMP_PUBLIC_PDF_EVIDENCE, JSON.stringify(facts, null, 2) + '\n');
    console.log('PUBLIC_OMP_PDF_VERIFIED');
  } finally { await configured.close(); authStorage.close(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
