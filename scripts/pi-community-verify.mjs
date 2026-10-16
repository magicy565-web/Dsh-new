// Read-only public/synthetic acceptance for the three already audited packages.
// No model credentials, package installation, untrusted lifecycle scripts, or
// host HOME/config are inherited. Published subagents owns all child execution.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('..', import.meta.url));
const installRoot = process.env.PI_COMMUNITY_INSTALL_ROOT;
if (!installRoot || !path.isAbsolute(installRoot)) throw new Error('Set PI_COMMUNITY_INSTALL_ROOT to the audited isolated npm installation root; this verifier never downloads packages.');
assert.equal(process.version, 'v24.19.0');
const piRoot = path.join(repo, 'node_modules/@earendil-works/pi-coding-agent');
assert.equal(JSON.parse(await fs.readFile(piRoot + '/package.json')).version, '1.1.0');
const pinned = [['pi-web-access', '0.40.0'], ['pi-quiver', '6.13.2'], ['pi-subagents', '0.78.0']];
const packagePaths = pinned.map(([name]) => path.join(installRoot, name, 'node_modules', name));
for (let i = 0; i < pinned.length; i++) assert.equal(JSON.parse(await fs.readFile(packagePaths[i] + '/package.json')).version, pinned[i][1]);
const root = await fs.mkdtemp('/tmp/pi-community-verify-'), cwd = root + '/run', agentDir = root + '/agent';
for (const dir of [cwd, agentDir + '/agents', agentDir + '/extensions/subagent']) await fs.mkdir(dir, { recursive: true });
const env = { PATH: process.env.PATH, HOME: root + '/home', TMPDIR: cwd, PI_CODING_AGENT_DIR: agentDir,
  NPM_CONFIG_PREFIX: root + '/npm-global', PI_OFFLINE: '1', NO_COLOR: '1', TERM: 'dumb',
  PI_COMMUNITY_CHILD_MARKER: cwd + '/child-marker.jsonl', PI_COMMUNITY_PRODUCT_FILE: cwd + '/public-product.md',
  PI_COMMUNITY_CHILD_LAUNCH_FILE: cwd + '/child-launches.jsonl',
  PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT: piRoot };
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'CODEX_PROXY_CERT']) if (process.env[key]) env[key] = process.env[key];
if (!env.NODE_EXTRA_CA_CERTS && env.CODEX_PROXY_CERT) env.NODE_EXTRA_CA_CERTS = env.CODEX_PROXY_CERT;
await fs.mkdir(env.HOME, { recursive: true });
async function command(executable, args, commandEnv = env, input = '', timeoutMs = 45000) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: commandEnv, detached: true, stdio: ['pipe', 'pipe', 'pipe'] }); let output = '', error = '', expired = false;
    const timer = setTimeout(() => {
      expired = true; child.kill('SIGTERM'); // Original Pi abort + shutdown first.
      void cleanupFixtureChildren().finally(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} });
    }, timeoutMs);
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject); child.on('close', code => { clearTimeout(timer); if (expired) reject(new Error('Acceptance command exceeded its bounded deadline; fixture-owned child cleanup requested')); else resolve({ code, output, error }); }); child.stdin.end(input);
  });
}
async function cleanupFixtureChildren() {
  // Published runners are detached themselves. Only use launch/PID receipts
  // owned by this mkdtemp fixture; never enumerate or kill global Node processes.
  await new Promise(resolve => setTimeout(resolve, 300));
  const owned = new Set();
  const marker = await fs.readFile(env.PI_COMMUNITY_CHILD_MARKER, 'utf8').catch(() => '');
  for (const row of marker.trim().split('\n').filter(Boolean)) { try { owned.add(JSON.parse(row).pid); } catch {} }
  const launches = await fs.readFile(env.PI_COMMUNITY_CHILD_LAUNCH_FILE, 'utf8').catch(() => '');
  for (const row of launches.trim().split('\n').filter(Boolean)) {
    try { const dir = JSON.parse(row).asyncDir; if (dir.startsWith(root + '/')) owned.add(JSON.parse(await fs.readFile(dir + '/status.json')).pid); } catch {}
  }
  const targets = [];
  for (const pid of owned) {
    if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) continue;
    try { const processCwd = await fs.realpath('/proc/' + pid + '/cwd'); if (processCwd === cwd || processCwd.startsWith(root + '/')) targets.push(pid); } catch {}
  }
  for (const pid of targets) { try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch {} } }
  await new Promise(resolve => setTimeout(resolve, 300));
  for (const pid of targets) { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch {} } }
}
process.once('SIGTERM', () => void cleanupFixtureChildren().finally(() => process.exit(1)));
const cli = piRoot + '/dist/bundle/cli.js', receipts = [];
async function pi(...args) { const result = await command(process.execPath, [cli, ...args]); receipts.push({ args, ...result }); assert.equal(result.code, 0, result.error); return result; }
for (const file of ['host.mjs', 'child-faux.js', 'cli-faux.js']) {
  let code = await fs.readFile(path.join(repo, 'test/fixtures/pi-community-tools', file), 'utf8');
  for (const specifier of ['@earendil-works/pi-coding-agent', '@earendil-works/pi-ai', '@earendil-works/pi-ai/providers/faux']) code = code.replaceAll(`from '${specifier}'`, `from '${import.meta.resolve(specifier)}'`);
  await fs.writeFile(root + '/' + file, code);
}
await fs.writeFile(cwd + '/public-product.md', '# Public synthetic factory product\nCup-A: stainless steel reusable cup. Export carton specification supplied; all details synthetic.\n');
await fs.writeFile(agentDir + '/agents/public-fixture.md', `---\nname: public-fixture\ndescription: Explicit keyless public synthetic export-material acceptance\nmodel: community-keyless/child\ntools: read, community_wait\nextensions: ${root}/child-faux.js\n---\nRead only the named public synthetic file. No private data or paid models.\n`);
await fs.writeFile(agentDir + '/extensions/subagent/config.json', JSON.stringify({ toolActivation: 'eager' }));
await fs.writeFile(agentDir + '/settings.json', JSON.stringify({ compaction: { enabled: false }, subagents: { disableBuiltins: true }, quiver: {
  slack: { enabled: false }, sessionAutoName: { enabled: false }, fastMode: { enabled: false }, swordHeader: { enabled: false }, providerStallWatchdog: { enabled: false },
} }));
await fs.writeFile(agentDir + '/web-search.json', JSON.stringify({ tools: { sourceCheck: { enabled: false }, getSearchContent: { enabled: false } },
  webSearch: { enabled: true, allowedProviders: ['duckduckgo'] }, searchRouting: { providers: ['duckduckgo'], useCurrentModel: false, fallbackOn: ['network'] },
  fetchRouting: { providers: ['http'], allowRemoteHostedProviders: false }, fetch: { defaultMode: 'raw', allowedModes: ['raw'] }, workflow: 'none' }));
for (const pkg of packagePaths) await pi('install', pkg);
const factoryPackage = root + '/factory-package'; await fs.cp(repo + '/plugins/workspace-procurement', factoryPackage, { recursive: true }); await pi('install', factoryPackage);
await pi('list');
await pi('mcp', 'add', 'community-web', '--', process.execPath, packagePaths[0] + '/dist/mcp-cli.js');
const mcpList = await pi('mcp', 'list'); assert.match(mcpList.output, /connected, 2 tools/);
const mcp = JSON.parse(await fs.readFile(agentDir + '/mcp.json')); mcp.mcpServers['community-web'].exposure = 'direct'; await fs.writeFile(agentDir + '/mcp.json', JSON.stringify(mcp));
const cliHelp = await pi('--offline', '-e', root + '/cli-faux.js', '--help'); assert.match(cliHelp.output, /community-keyless-cli/);
const cliSynthetic = await pi('--offline', '-e', root + '/cli-faux.js', '--no-session', '--model', 'community-cli/keyless', '--print', 'Run the explicit public synthetic plugin coexistence acceptance.');
assert.match(cliSynthetic.output, /OFFICIAL_CLI_COMMUNITY_FACTORY_COEXISTENCE_VERIFIED/);
const config = { cwd, agentDir, factoryPackage, mcp: true, evidenceFile: root + '/main.json' }; await fs.writeFile(root + '/config.json', JSON.stringify(config));
const main = await command(process.execPath, [root + '/host.mjs', root + '/config.json']);
if (main.code !== 0) { await cleanupFixtureChildren(); throw new Error(main.error); }
const mainEvidence = JSON.parse(await fs.readFile(config.evidenceFile)); assert.equal(mainEvidence.complete, true);
// Auxiliary data fixtures use installed Python/PyMuPDF/ReportLab/Pillow only.
const python = process.env.PI_COMMUNITY_PYTHON || '/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const generated = await command(python, ['-c', `from reportlab.pdfgen import canvas\nfrom PIL import Image,ImageDraw,ImageFont\nfrom pathlib import Path\nr=Path(${JSON.stringify(cwd)})\nlines=['PUBLIC SYNTHETIC FACTORY PRODUCT','Cup-A stainless steel reusable cup','Export carton specification supplied']\nc=canvas.Canvas(str(r/'product-text.pdf'));c.setFont('Helvetica',16)\nfor i,line in enumerate(lines):c.drawString(35,790-i*30,line)\nc.showPage();c.save()\nim=Image.new('RGB',(1600,800),'white');d=ImageDraw.Draw(im);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',36)\nfor i,line in enumerate(lines):d.text((45,55+i*100),line,fill='black',font=font)\nim.save(r/'product-scan.pdf','PDF',resolution=150)\n`]); assert.equal(generated.code, 0, generated.error);
const syntheticAgent = root + '/synthetic-agent'; await fs.mkdir(syntheticAgent, { recursive: true });
await fs.writeFile(syntheticAgent + '/settings.json', JSON.stringify({ packages: [packagePaths[1]] }));
const bin = root + '/synthetic-missing-runtime-bin'; await fs.mkdir(bin); await fs.symlink(process.execPath, bin + '/node');
const syntheticEnv = { ...env, PATH: bin, PI_CODING_AGENT_DIR: syntheticAgent };
const syntheticConfig = { cwd, agentDir: syntheticAgent, mode: 'documents-missing-runtime-synthetic', evidenceFile: root + '/documents.json' };
await fs.writeFile(root + '/documents-config.json', JSON.stringify(syntheticConfig));
const synthetic = await command(process.execPath, [root + '/host.mjs', root + '/documents-config.json'], syntheticEnv); assert.equal(synthetic.code, 0, synthetic.error);
const documents = JSON.parse(await fs.readFile(syntheticConfig.evidenceFile));
const textMd = await fs.readFile(cwd + '/product-text.pdf-bundle/product-text.md', 'utf8'); assert.match(textMd, /Cup-A stainless steel/);
const scanMd = await fs.readFile(cwd + '/product-scan.pdf-bundle/product-scan.md', 'utf8'); assert.ok(!scanMd.includes('Cup-A stainless steel'));
const auxiliary = [];
for (const pdf of ['product-text.pdf', 'product-scan.pdf']) {
  const staging = root + '/aux-' + pdf; await fs.mkdir(staging);
  const options = { path: cwd + '/' + pdf, pages: [1], stagingDir: staging, imageDpi: 150, imageFormat: 'png', ocr: false };
  const result = await command(python, [packagePaths[1] + '/scripts/doc_to_md.py', 'pdf-fallback'], env, JSON.stringify(options)); assert.equal(result.code, 0, result.error);
  auxiliary.push({ mode: 'published-script-pdf-fallback-not-normal-tool', pdf, result: JSON.parse(result.output) });
}
const ocrDir = root + '/aux-ocr'; await fs.mkdir(ocrDir);
const ocr = await command(python, [packagePaths[1] + '/scripts/doc_to_md.py', 'ocr-pages'], env, JSON.stringify({ path: cwd + '/product-scan.pdf', pages: [1], stagingDir: ocrDir, stem: 'product-scan', dpi: 150, ocrLanguage: 'eng', ocrBudgetMs: 20000 }));
assert.equal(ocr.code, 0, ocr.error); const ocrResult = JSON.parse(ocr.output); assert.deepEqual(ocrResult.written, [1]);
const recognized = await fs.readFile(ocrDir + '/p001/product-scan-p001.md', 'utf8'); assert.match(recognized, /OCR of page 1/); assert.match(recognized, /stainless steel reusable cup/i);
auxiliary.push({ mode: 'published-script-ocr-not-normal-tool', result: ocrResult, recognized });
await pi('mcp', 'remove', 'community-web');
for (const pkg of [...packagePaths, factoryPackage]) await pi('remove', pkg);
const listed = await pi('list'); for (const pkg of packagePaths) assert.ok(!listed.output.includes(pkg));
const finalSettings = JSON.parse(await fs.readFile(agentDir + '/settings.json')); assert.equal(finalSettings.packages.length, 0);
const output = process.env.PI_COMMUNITY_EVIDENCE_FILE || root + '/result.json';
await fs.writeFile(output, JSON.stringify({ schemaVersion: 1, auditedPackages: pinned, npmRoot: installRoot, main: mainEvidence, documents,
  auxiliary, packageManagement: receipts, removalVerified: true, normalDocToMd: mainEvidence.normalDocToMd,
  embeddedHostExit: 'Published extension retains SDK service timers; fixture exits explicitly after original child terminal/death verification and session.dispose.',
  retainedIsolatedDirectory: root, paidModelCalls: 0, privateFilesRead: 0, externalMessagesSent: 0 }, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, evidenceFile: output, isolatedDirectory: root, normalDocumentRuntime: 'blocked-not-executed', publicSearch: 'inspect actual tool receipt; network failure is not success' }));
