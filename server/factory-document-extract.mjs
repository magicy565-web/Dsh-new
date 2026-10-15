import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { workspaceOmpPaths, checkWorkspaceOmpPaths } from './workspace-omp-bridge.mjs';
const policy = 'original-library-native-text-hints-v1';
const unavailable = reason => ({ status: 'blocked', text: '', extractionPolicy: policy, reason, textTruncated: false, pagesNeedingOcr: null, ocrStatus: 'not_performed' });
// Existing artifact bytes only. No network, agent, model, ambient credentials,
// OCR download or alternate artifact store; owned temporary bytes are removed.
export async function extractFactoryDocument({ bytes, mimeType, signal }) {
  signal?.throwIfAborted();
  if (!Buffer.isBuffer(bytes) || bytes.length > 65536) return unavailable('FACTORY_DOCUMENT_EXTRACT_LIMIT');
  if (mimeType !== 'application/pdf') {
    if (!/^text\/(?:plain|markdown|csv)(?:;|$)/i.test(mimeType || '')) return unavailable('FACTORY_DOCUMENT_FORMAT_REQUIRES_REVIEW');
    try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (/\u0000/.test(text)) return unavailable('FACTORY_DOCUMENT_INVALID_TEXT');
      return { status: 'available', format: 'text', text, extractionPolicy: policy, textTruncated: false, pagesNeedingOcr: null, ocrStatus: 'not_applicable' };
    } catch { return unavailable('FACTORY_DOCUMENT_INVALID_TEXT'); }
  }
  if (bytes.subarray(0, 5).toString() !== '%PDF-') return unavailable('FACTORY_DOCUMENT_INVALID_PDF');
  const paths = workspaceOmpPaths();
  try { await checkWorkspaceOmpPaths(paths); } catch { return unavailable('FACTORY_DOCUMENT_NATIVE_READER_UNAVAILABLE'); }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-factory-document-'));
  try {
    await fs.chmod(directory, 0o700);
    const filename = path.join(directory, 'selected.pdf'); await fs.writeFile(filename, bytes, { mode: 0o600, flag: 'wx' });
    signal?.throwIfAborted();
    const result = await new Promise(resolve => {
      const child = spawn(paths.bun, [new URL('./factory-document-extract-worker.mjs', import.meta.url).pathname, paths.packageRoot, directory],
        { cwd: directory, env: { PATH: path.dirname(paths.bun) + ':/usr/bin:/bin', HOME: directory, TMPDIR: directory, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'ignore'] });
      let output = '', invalid = false;
      const kill = () => { invalid = true; child.kill('SIGKILL'); };
      const timer = setTimeout(kill, 15000); signal?.addEventListener('abort', kill, { once: true }); if (signal?.aborted) kill();
      child.stdout.on('data', chunk => { if (output.length + chunk.length > 512000) kill(); else output += chunk; });
      child.on('error', () => { invalid = true; });
      child.on('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', kill);
        try { resolve(code === 0 && !invalid ? JSON.parse(output) : null); } catch { resolve(null); } });
    });
    signal?.throwIfAborted();
    if (!result || typeof result.text !== 'string' || Buffer.byteLength(result.text) > 100000 || !['available', 'partial', 'blocked'].includes(result.status))
      return unavailable('FACTORY_DOCUMENT_NATIVE_EXTRACTION_FAILED');
    return { ...result, extractionPolicy: policy };
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
