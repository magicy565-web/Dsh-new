// Fixed official OMP ReadTool, no AgentSession/model registry/provider/auth.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [packageRoot, directory] = process.argv.slice(2);
const load = relative => import(pathToFileURL(path.join(packageRoot, 'src', relative)).href);
try {
  const { Settings } = await load('config/settings.ts');
  const settings = await Settings.init({ cwd: directory, agentDir: directory, inMemory: true,
    overrides: { 'startup.checkUpdate': false, 'startup.setupWizard': false, 'telemetry.otlpExportEnabled': false } });
  const { ReadTool } = await load('tools/read.ts');
  const read = new ReadTool({ cwd: directory, settings, getSessionId: () => 'factory-material-extraction', getArtifactsDir: () => directory });
  const result = await read.execute('factory-document-extract', { path: path.join(directory, 'selected.pdf') });
  if (result.isError || !Array.isArray(result.content) || result.content.some(b => b.type !== 'text' || /^\[Cannot read \.pdf file:/u.test(b.text))) throw Error();
  const text = result.content.map(b => b.text).join('\n');
  const truncated = Boolean(result.details?.truncation?.truncated || result.details?.meta?.truncation);
  const pages = [...new Set([...text.matchAll(/Text extraction is incomplete for PDF pages ([\d, ]+)\./gu)]
    .flatMap(m => m[1].split(',').map(v => Number(v.trim())).filter(v => Number.isSafeInteger(v) && v > 0)))];
  process.stdout.write(JSON.stringify({ status: truncated || pages.length ? 'partial' : 'available', format: 'pdf', text,
    textTruncated: truncated, pagesNeedingOcr: truncated ? null : pages, ocrStatus: truncated ? 'unknown_after_truncation' : 'native_hint_only',
    notice: truncated ? 'Extracted text is truncated; remaining text and OCR requirements are unknown. No OCR ran.'
      : 'Native PDF text only. OCR hints are heuristic; no hints do not prove complete page review. No OCR ran.' }));
  process.exit(0);
} catch { process.exit(1); }
