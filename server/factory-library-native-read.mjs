// Runs only under the existing fixed official Bun runtime. No model/session loop,
// credentials, URLs, ?q vision calls, PDF browser rendering or downloaded OCR.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [packageRoot, directory, filename] = process.argv.slice(2);
const load = relative => import(pathToFileURL(path.join(packageRoot, 'src', relative)).href);
try {
  if (!/^selected\.(?:txt|md|csv|json|pdf|png|jpg|jpeg|webp)$/.test(filename)) throw Error();
  // A local reader is allowed to resolve only its one staged file. Prevent
  // runtime discovery/telemetry/remote parsers from making network requests.
  globalThis.fetch = async () => { throw Error('Network disabled for private source reading.'); };
  const { Settings } = await load('config/settings.ts');
  const settings = await Settings.init({ cwd: directory, agentDir: directory, inMemory: true,
    overrides: { 'startup.checkUpdate': false, 'startup.setupWizard': false, 'telemetry.otlpExportEnabled': false } });
  const { ReadTool } = await load('tools/read.ts');
  const read = new ReadTool({ cwd: directory, settings, getSessionId: () => 'factory-library-ingestion-local-reader', getArtifactsDir: () => directory });
  const result = await read.execute('factory-library-source', { path: path.join(directory, filename) });
  if (result.isError || !Array.isArray(result.content) || result.content.some(b => !['text', 'image'].includes(b.type))) throw Error();
  const text = result.content.filter(b => b.type === 'text').map(b => b.text).join('\n').replaceAll(directory, '[authorized-source]');
  if (/\[Cannot read |Error reading |Unsupported file/u.test(text)) throw Error();
  const truncated = Boolean(result.details?.truncation?.truncated || result.details?.meta?.truncation);
  const images = result.content.filter(b => b.type === 'image');
  const ocrHints = [...text.matchAll(/Text extraction is incomplete for PDF pages ([\d, ]+)\./gu)].flatMap(m => m[1].split(',').map(v => Number(v.trim())));
  process.stdout.write(JSON.stringify({ status: truncated || ocrHints.length ? 'partial' : 'available', text,
    nativeContent: images, format: filename.endsWith('.pdf') ? 'pdf' : images.length ? 'image' : 'text',
    textTruncated: truncated, pagesNeedingOcr: truncated ? null : [...new Set(ocrHints)],
    ocrStatus: images.length ? 'visual-only-not-ocr' : filename.endsWith('.pdf') ? 'native-hints-only-no-ocr' : 'not-applicable',
    notice: 'Exact native extracted-text offsets only; no inferred page numbers or whole-document completeness. Images/quotes do not authenticate certificates or confirm model interpretations.' }));
  process.exit(0);
} catch { process.exit(1); }
