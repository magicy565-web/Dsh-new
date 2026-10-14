// Narrow admission around published OMP tools. No search/parser/browser engine,
// credential discovery, generic filesystem tool or task ledger lives here.
import fs from 'node:fs/promises';
import path from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Type } from '@earendil-works/pi-ai';
import { validatePublicBusinessInput } from '../packages/workspace-procurement/src/workspace.mjs';
import { looksLikeCredential } from '../packages/workspace-procurement/src/public-input.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const response = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], details: value });
const denied = reason => { throw new Error(reason); };
const abort = signal => { if (signal?.aborted) denied('Public tool cancelled.'); };
const publicText = (value, maximum) => {
  if (typeof value !== 'string' || value.length > maximum || looksLikeCredential(value)) denied('Only bounded public text without credentials is admitted.');
  validatePublicBusinessInput(value); return value;
};
export function workspaceOmpPublicURL(value) {
  publicText(value, 2000);
  let url; try { url = new URL(value); } catch { denied('A public HTTPS source URL is required.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || url.hash
    || isIP(url.hostname) || !url.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|invalid|test|example|onion)$/iu.test(url.hostname)
    || !/^[a-z0-9.-]+$/iu.test(url.hostname) || url.hostname.endsWith('.')) denied('A public HTTPS hostname without credentials is required.');
  return url;
}
export function workspaceOmpPublicIPv4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31 || a === 192 && [0, 168].includes(b)
    || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19, 51].includes(b) || a === 203 && b === 0);
}
function plainPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.split(path.sep).some(segment => segment.startsWith('.')
    || /^(?:auth|secrets?|credentials?|workspace-data|sessions?|runs?|store)(?:\.|$)/iu.test(segment)))
    denied('Choose public material files in a separate visible public directory.');
  return value;
}
// Trusted startup selects exact public text files and pins their bytes. Neither
// the model nor a tool argument can select a new path or widen the selection.
export async function snapshotWorkspaceOmpPublicFiles({ root, files = [] } = {}) {
  if (!files.length) return [];
  plainPath(root);
  if (!Array.isArray(files) || files.length > 8 || await fs.realpath(root) !== root) denied('The public file root must be explicit and must not be a symlink.');
  const result = [], seen = new Set();
  for (const file of files) {
    if (!file || Object.keys(file).some(key => !['id', 'path', 'sha256'].includes(key))
      || !/^[a-z][a-z0-9-]{0,63}$/u.test(file.id) || seen.has(file.id) || !/^[a-f0-9]{64}$/u.test(file.sha256)) denied('Use unique public document IDs and exact SHA256 pins.');
    plainPath(file.path);
    const relative = path.relative(root, file.path);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !/\.(?:md|txt|csv)$/iu.test(file.path)
      || await fs.realpath(file.path) !== file.path) denied('Only explicitly pinned public Markdown, text or CSV within that root is admitted.');
    const stat = await fs.lstat(file.path);
    if (!stat.isFile() || stat.size > 65536) denied('Public material exceeds its text file allowance.');
    const bytes = await fs.readFile(file.path), content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (digest(bytes) !== file.sha256) denied('Public material changed after selection.');
    publicText(content, 65536); seen.add(file.id);
    result.push({ id: file.id, sha256: file.sha256, content });
  }
  return result;
}

export async function createWorkspaceOmpPublicTools({ packageRoot, toolSession, authorize, configuration = {},
  // Injection is only for explicit synthetic tests. Production callers never
  // serialize a function or enable a fixture from environment variables.
  fetchImpl = globalThis.fetch, lookupImpl = lookup } = {}) {
  if (typeof authorize !== 'function') denied('Original Workspace authorization is required.');
  const load = relative => import(pathToFileURL(path.join(packageRoot, 'src', relative)).href);
  const tools = [], names = [], files = configuration.publicFiles || [], provider = configuration.searchProvider || 'duckduckgo';
  if (!['duckduckgo', 'startpage', 'disabled'].includes(provider)) denied('Only a reviewed keyless public search provider is admitted.');
  let searchCalls = 0, browserCalls = 0, browser;
  const checked = async signal => { abort(signal); await authorize(); abort(signal); };
  function register(tool) { tools.push(tool); names.push(tool.name); }
  if (provider !== 'disabled') {
    const { [provider === 'duckduckgo' ? 'searchDuckDuckGo' : 'searchStartpage']: search } = await load(`web/search/providers/${provider}.ts`);
    register({ name: 'workspace_public_search', label: 'Public source search',
      description: 'Read public search results with the explicitly fixed no-key OMP provider. Sources are unverified customer candidates, never buyer verification or permission to contact. Two calls per original Run, no paid or challenge fallback.',
      parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 600 }), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })) }, { additionalProperties: false }),
      async execute(_id, input, signal) {
        await checked(signal); publicText(input.query, 600);
        if (!input.query.trim() || Object.keys(input).some(key => !['query', 'limit'].includes(key)) || input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 5)) denied('Public search input exceeded its admitted fields.');
        if (++searchCalls > 2) denied('Original Run public search allowance exceeded.');
        const observedAt = new Date().toISOString(), boundedSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]);
        let transportBlocked = false;
        try {
          const found = await search({ query: input.query, limit: input.limit || 3, numSearchResults: input.limit || 3,
            signal: boundedSignal, timeoutMs: 15000, systemPrompt: '', authStorage: toolSession.authStorage,
            modelRegistry: toolSession.modelRegistry, fetch: async (target, init) => {
              await checked(boundedSignal);
              if (transportBlocked) denied('The public provider refused this request. No alternate request is admitted.');
              const url = new URL(String(target));
              if (url.protocol !== 'https:' || url.username || url.password || url.port
                || ![provider === 'duckduckgo' ? 'html.duckduckgo.com' : 'www.startpage.com'].includes(url.hostname)) denied('Search transport attempted a non-admitted endpoint.');
              const answer = await fetchImpl(url, { ...init, signal: boundedSignal, redirect: 'error' });
              const reader = answer.body?.getReader(); let bytes = 0; const chunks = [];
              try { if (reader) for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length;
                if (bytes > 262144) denied('Public search response exceeds its allowance.'); chunks.push(chunk.value); } }
              finally { await reader?.cancel().catch(() => {}); }
              const body = Buffer.concat(chunks);
              if ([401, 403, 429].includes(answer.status) || /component---src-pages-captcha|altcha-widget|anomaly-modal|g-recaptcha|sending automated queries/iu.test(body.toString())) transportBlocked = true;
              return new Response(body, { status: answer.status, headers: answer.headers });
            } });
          await checked(signal);
          if (transportBlocked) denied('The public provider refused this request.');
          const sources = found.sources.slice(0, input.limit || 3).flatMap(source => {
            try { const url = workspaceOmpPublicURL(source.url).href;
              return [{ url, title: publicText(source.title || url, 400), excerpt: publicText(source.snippet || source.excerpt || '', 6000), kind: 'public-web-unverified' }]; }
            catch { return []; }
          });
          return response({ status: sources.length ? 'sources_observed' : 'empty', provider, observedAt, sources,
            verifiedBuyer: false, contactPermission: false, challengeBypass: false });
        } catch (error) {
          await checked(signal);
          return { ...response({ status: boundedSignal.aborted ? 'timeout' : 'unavailable', provider, observedAt,
            sources: [], failure: transportBlocked ? 'PROVIDER_REFUSED' : boundedSignal.aborted ? 'TIMEOUT' : 'SOURCE_TRANSPORT_FAILED',
            ...(Number.isInteger(error.status) ? { httpStatus: error.status } : {}),
            reason: 'Public search did not return admissible sources. No alternative provider or challenge bypass ran.', verifiedBuyer: false, contactPermission: false }), isError: true };
        }
      } });
  }
  if (files.length) {
    const directory = await fs.mkdtemp(path.join(toolSession.cwd, 'selected-public-materials-')); await fs.chmod(directory, 0o700);
    const selected = new Map();
    for (const file of files) {
      if (!/^[a-z][a-z0-9-]{0,63}$/u.test(file.id) || selected.has(file.id) || digest(file.content) !== file.sha256) denied('Invalid exact public material snapshot.');
      publicText(file.content, 65536); const filename = path.join(directory, file.id + '.txt');
      await fs.writeFile(filename, file.content, { mode: 0o600, flag: 'wx' }); selected.set(file.id, { ...file, filename });
    }
    const { ReadTool } = await load('tools/read.ts'), read = new ReadTool(toolSession);
    register({ name: 'workspace_public_document', label: 'Selected public material',
      description: `Read only explicitly selected public text snapshots through the official OMP ReadTool. Exact IDs: ${[...selected.keys()].join(', ')}. No private Library, arbitrary path, PDF conversion or OCR.`,
      parameters: Type.Object({ documentId: Type.String() }, { additionalProperties: false }),
      async execute(id, input, signal) {
        await checked(signal); const file = selected.get(input.documentId);
        if (Object.keys(input).length !== 1 || !file) denied('This document was not explicitly selected as public material.');
        if (await fs.realpath(file.filename) !== file.filename || digest(await fs.readFile(file.filename)) !== file.sha256) denied('The selected public snapshot changed.');
        const result = await read.execute(id, { path: file.filename }, signal); await checked(signal);
        return { ...result, details: { documentId: file.id, sha256: file.sha256, provenance: 'explicit-public-material', independentVerification: false } };
      } });
  }
  if (configuration.browserExecutable) {
    const executable = configuration.browserExecutable;
    if (!path.isAbsolute(executable) || !['chromium', 'chromium-browser', 'google-chrome'].includes(path.basename(executable))) denied('Use an existing reviewed Chromium executable, never an arbitrary app or download.');
    await fs.access(executable);
    const { createBrowserPrelude } = await load('tools/browser.ts'); browser = createBrowserPrelude(toolSession);
    register({ name: 'workspace_public_browser', label: 'Public page inspection',
      description: 'Inspect one public HTTPS page with the official OMP browser, isolated profile, disabled page scripts and a frozen public IPv4 hostname. No account attachment, forms, downloads, local URLs or arbitrary JavaScript. Two pages per original Run.',
      parameters: Type.Object({ url: Type.String({ maxLength: 2000 }) }, { additionalProperties: false }),
      async execute(_id, input, signal) {
        await checked(signal); if (Object.keys(input).length !== 1) denied('Only a public URL is admitted.');
        const url = workspaceOmpPublicURL(input.url), addresses = await lookupImpl(url.hostname, { all: true, family: 4 });
        if (!addresses.length || addresses.some(row => !workspaceOmpPublicIPv4(row.address))) denied('Public hostname resolution includes a private or reserved address.');
        if (++browserCalls > 2) denied('Original Run public browser allowance exceeded.');
        const name = `public-${randomUUID()}`, profile = path.join(toolSession.cwd, `public-browser-${name}`);
        await fs.mkdir(profile, { mode: 0o700 });
        try {
          await checked(signal);
          const opened = await browser.invoke({ action: 'open', name, url: url.href, allowed_domains: [url.hostname],
            app: { path: executable, relay: false, tern: false, args: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
              '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--disable-quic',
              '--disable-extensions', '--use-mock-keychain', '--password-store=basic', '--blink-settings=scriptEnabled=false',
              `--host-resolver-rules=MAP ${url.hostname} ${addresses[0].address}, MAP * ~NOTFOUND`, `--user-data-dir=${profile}`] },
            allow_file_access: false, ignore_https_errors: false, dialogs: 'dismiss', timeout: 15 }, { signal });
          const finalURL = workspaceOmpPublicURL(opened.details.url || url.href);
          if (finalURL.hostname !== url.hostname) denied('Public browser navigation left its admitted hostname.');
          const body = await browser.invoke({ action: 'call', name, chain: [{ method: 'text', args: ['body'] }], timeout: 10 }, { signal });
          await checked(signal);
          const excerpt = publicText(String(body.details.value || '').slice(0, 12000), 12000);
          return response({ status: 'page_observed', url: finalURL.href, observedAt: new Date().toISOString(), excerpt,
            provenance: 'public-web-unverified', verifiedBuyer: false, contactPermission: false, pageScripts: false });
        } finally { await browser.invoke({ action: 'close', name, kill: true }, {}).catch(() => {}); }
      } });
  }
  return { tools, toolNames: names, capabilities: { search: provider === 'disabled' ? 'disabled' : 'supported_unverified', searchProvider: provider,
    publicDocuments: files.map(({ id, sha256 }) => ({ id, sha256 })), browser: browser ? 'supported_unverified' : 'unconfigured_existing_chromium_required',
    privateLibrary: 'disabled', arbitraryShell: 'disabled', externalActions: 'human_approval_required' },
    async close() { await browser?.invoke({ action: 'close', all: true, kill: true }, {}).catch(() => {}); } };
}
