import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { snapshotWorkspaceOmpPublicFiles } from '../server/workspace-omp-public-tools.mjs';
import { workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
import { publicPdfBytes, publicPdfHash } from './fixtures/workspace-omp-public-pdf.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
test('explicit public PDF selection requires exact bytes, magic, size and non-symlink paths', async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-omp-pdf-selection-'); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'public.pdf'), bytes = publicPdfBytes('PUBLIC SYNTHETIC PRODUCT. Capacity unknown.'); await fs.writeFile(filename, bytes);
  const selected = { id: 'public-product', path: filename, sha256: publicPdfHash(bytes) };
  const snapshots = await snapshotWorkspaceOmpPublicFiles({ root: directory, files: [selected] });
  assert.deepEqual(snapshots, [{ id: selected.id, sha256: selected.sha256, format: 'pdf', contentBase64: bytes.toString('base64') }]);
  assert.equal(JSON.stringify(snapshots).includes(filename), false);
  await assert.rejects(snapshotWorkspaceOmpPublicFiles({ root: directory, files: [{ ...selected, sha256: '0'.repeat(64) }] }), /changed/);
  const link = path.join(directory, 'link.pdf'); await fs.symlink(filename, link);
  await assert.rejects(snapshotWorkspaceOmpPublicFiles({ root: directory, files: [{ ...selected, path: link }] }), /pinned|symlink/);
  const nonPdf = Buffer.from('SYNTHETIC PUBLIC TEXT WITHOUT PDF MAGIC'); await fs.writeFile(filename, nonPdf);
  await assert.rejects(snapshotWorkspaceOmpPublicFiles({ root: directory, files: [{ ...selected, sha256: publicPdfHash(nonPdf) }] }), /PDF|magic/);
  const tooLarge = Buffer.alloc(65537, 32); tooLarge.write('%PDF-1.4'); await fs.writeFile(filename, tooLarge);
  await assert.rejects(snapshotWorkspaceOmpPublicFiles({ root: directory, files: [{ ...selected, sha256: publicPdfHash(tooLarge) }] }), /allowance|size|exceed/);
});

test('actual OMP ReadTool extracts selected text PDF and reports scan OCR gap without network, binary or credentials', { timeout: 45000 }, async t => {
  const paths = workspaceOmpPaths({}), directory = await fs.mkdtemp('/tmp/workspace-omp-pdf-native-');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const evidence = path.join(directory, 'facts.json');
  const result = await new Promise((resolve, reject) => {
    const child = spawn(paths.bun, [path.join(repository, 'test/fixtures/workspace-omp-public-pdf.mjs')], {
      cwd: directory, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: path.dirname(paths.bun) + ':/usr/bin:/bin', HOME: directory, TMPDIR: directory,
        PI_CODING_AGENT_DIR: path.join(directory, 'agent'), WORKSPACE_OMP_PACKAGE_ROOT: paths.packageRoot,
        WORKSPACE_OMP_PUBLIC_PDF_EVIDENCE: evidence } });
    let output = '', timedOut = false, escalation;
    const signal = name => { try { process.kill(-child.pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
    const deadline = setTimeout(() => { timedOut = true; signal('SIGTERM'); escalation = setTimeout(() => signal('SIGKILL'), 1500); }, 35000);
    child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { output += bytes; });
    child.once('error', error => { clearTimeout(deadline); clearTimeout(escalation); reject(error); });
    child.once('close', (code, exitSignal) => { clearTimeout(deadline); clearTimeout(escalation); resolve({ code, exitSignal, timedOut, output }); });
  });
  assert.equal(result.timedOut, false, result.output); assert.equal(result.code, 0, result.output); assert.match(result.output, /PUBLIC_OMP_PDF_VERIFIED/);
  const facts = JSON.parse(await fs.readFile(evidence));
  assert.equal(facts.fetchCalls, 0); assert.equal(facts.paidModelCalls, 0); assert.equal(facts.realPublishedReadTool, true);
  assert.equal(facts.documentRead, 'document_read'); assert.equal(facts.scan.status, 'partial_ocr_required');
  assert.deepEqual(facts.scan.pagesNeedingOcr, [1]); assert.equal(facts.credentialTextRejected, true);
  if (process.env.WORKSPACE_OMP_PUBLIC_PDF_SAVE_EVIDENCE) await fs.copyFile(evidence, process.env.WORKSPACE_OMP_PUBLIC_PDF_SAVE_EVIDENCE);
});
