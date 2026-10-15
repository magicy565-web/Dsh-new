import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { factoryInquiriesExtension } from '../packages/workspace-factory-inquiries/src/extension.js';
import { prepareFactoryInquiry, factoryInquiryHash } from '../packages/workspace-factory-inquiries/src/drafts.mjs';
import { inquiryFixture } from './fixtures/factory-inquiries-data.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const source = path.join(repository, 'packages/workspace-factory-inquiries');
const piCli = path.join(repository, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
const bun = path.join(repository, 'support/omp-bun-linux-x64/node_modules/@oven/bun-linux-x64-baseline/bin/bun');
const ompRoot = path.join(repository, 'support/omp-coding-agent/node_modules/@oh-my-pi/pi-coding-agent');
const packageName = '@workspace-agent/pi-factory-inquiries';
const facts = [];
async function command(executable, args, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false, killTimer;
    const kill = signal => { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 1000); }, 35000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data; });
    child.once('error', error => { clearTimeout(timer); clearTimeout(killTimer); reject(error); });
    child.once('close', code => { clearTimeout(timer); clearTimeout(killTimer);
      if (timedOut) reject(new Error('Only the isolated official acceptance process group timed out: ' + output.slice(-2000)));
      else resolve({ code, output }); });
  });
}
async function setup(t, engine) {
  const directory = await fs.mkdtemp('/tmp/factory-inquiries-package-');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const packageDir = path.join(directory, 'copied-package'), agentDir = path.join(directory, 'agent');
  await fs.cp(source, packageDir, { recursive: true }); await fs.mkdir(agentDir);
  await assert.rejects(fs.stat(path.join(packageDir, 'node_modules')), { code: 'ENOENT' });
  const manifest = JSON.parse(await fs.readFile(path.join(packageDir, 'package.json'), 'utf8'));
  assert.equal(manifest.name, packageName); assert.equal(manifest.private, true); assert.equal(manifest.scripts, undefined); assert.equal(manifest.dependencies, undefined);
  const env = { PATH: path.dirname(bun) + ':/usr/bin:/bin', HOME: directory, TMPDIR: directory, PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: '1', PI_NO_TITLE: '1', NO_COLOR: '1', TERM: 'dumb',
    WS_AGENT_URL: 'http://127.0.0.1:9', WS_AGENT_TOKEN: 'synthetic-agent-bearer-is-not-a-library-session',
    FACTORY_INQUIRIES_PI_AI: import.meta.resolve('@earendil-works/pi-ai'), FACTORY_INQUIRIES_OMP_ROOT: ompRoot };
  if (engine === 'omp') await fs.writeFile(path.join(agentDir, 'config.yml'),
    'startup:\n  checkUpdate: false\n  setupWizard: false\ntelemetry:\n  otlpExportEnabled: false\nretry:\n  enabled: false\n  modelFallback: false\ncompaction:\n  enabled: false\n  midTurnEnabled: false\neval:\n  autoProvision: false\n  py: false\n');
  const executable = engine === 'pi' ? process.execPath : bun;
  const cli = engine === 'pi' ? piCli : path.join(ompRoot, 'dist/cli.js');
  const invoke = async (...args) => {
    const result = await command(executable, [cli, ...args], env, directory);
    assert.equal(result.code, 0, result.output); return result.output;
  };
  const cliFixture = path.join(directory, 'finite-cli.mjs'); await fs.copyFile(new URL('./fixtures/factory-inquiries-cli.mjs', import.meta.url), cliFixture);
  const verify = async absent => {
    const args = engine === 'pi' ? ['--offline', '--no-session', '--print'] : ['--no-title', '--no-prewalk', '--no-lsp', '--no-rules', '--no-session', '--print'];
    const tools = ['read', 'bash', 'inquiries_other_plugin', ...absent ? [] : ['workspace_factory_inquiry_prepare', 'workspace_factory_inquiry_save']].join(',');
    const result = await command(executable, [cli, ...args, '-e', cliFixture, '--tools', tools, '--model', 'factory-inquiries-cli-faux/finite',
      'Run only the finite explicit keyless package acceptance fixture.'], { ...env, FACTORY_INQUIRIES_EXPECT: absent ? 'absent' : 'present' }, directory);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, absent ? /FACTORY_INQUIRIES_ABSENT_AND_OTHER_PLUGIN_VERIFIED/ : /FACTORY_INQUIRIES_MANIFEST_UNCONFIGURED_AND_NATIVE_COEXISTENCE_VERIFIED/);
    assert.doesNotMatch(result.output, /Failed to load extension/);
  };
  return { directory, packageDir, agentDir, env, executable, invoke, verify };
}
async function save(evidence) {
  facts.push(evidence);
  if (process.env.FACTORY_INQUIRIES_PACKAGE_FACTS) await fs.writeFile(process.env.FACTORY_INQUIRIES_PACKAGE_FACTS,
    JSON.stringify({ version: 1, package: packageName, tests: facts }, null, 2) + '\n');
}

test('copied factory inquiries package uses official Pi manifest, Skill, disable and remove with no injected private access', { timeout: 120000 }, async t => {
  assert.equal(JSON.parse(await fs.readFile(path.join(repository, 'node_modules/@earendil-works/pi-coding-agent/package.json'))).version, '1.1.0');
  const p = await setup(t, 'pi');
  await p.invoke('install', p.packageDir); assert.match(await p.invoke('list'), /copied-package/);
  await p.verify(false);
  const settingsFile = path.join(p.agentDir, 'settings.json');
  const settings = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
  settings.packages = settings.packages.map(row => ({ source: typeof row === 'string' ? row : row.source, extensions: [], skills: [] }));
  await fs.writeFile(settingsFile, JSON.stringify(settings)); await p.verify(true);
  settings.packages = [p.packageDir]; await fs.writeFile(settingsFile, JSON.stringify(settings)); await p.verify(false);
  await p.invoke('remove', p.packageDir); await p.verify(true);
  assert.ok(!(await p.invoke('list')).includes(p.packageDir));
  await fs.access(path.join(p.packageDir, 'package.json'));
  await save({ engine: 'pi', version: '1.1.0', copiedOutsideRepository: true, packageNodeModules: false,
    officialManifest: true, skillLoaded: true, ordinaryToolsAndOtherPluginCoexist: true, unconfiguredTwoToolReceipts: true,
    disabledToolsAndSkillAbsent: true, reenabled: true, officialRemove: true, sourcePackagePreserved: true,
    clientReads: 0, syntheticAgentBearerDoesNotConfigureLibrary: true, paidModelCalls: 0, realLibraryAuthorizationVerified: false });
});

test('copied factory inquiries package uses official OMP local link, manifest, Skill, disable and uninstall', { timeout: 120000 }, async t => {
  assert.equal(JSON.parse(await fs.readFile(path.join(ompRoot, 'package.json'))).version, '18.10.4');
  const p = await setup(t, 'omp');
  await p.invoke('plugin', 'link', p.packageDir); assert.match(await p.invoke('plugin', 'list'), /pi-factory-inquiries/);
  await p.verify(false);
  await p.invoke('plugin', 'disable', packageName); await p.verify(true);
  await p.invoke('plugin', 'enable', packageName); await p.verify(false);
  // Only a local link to this audited script-free/dependency-free package is
  // present in the isolated plugin home; uninstall cannot run unknown hooks.
  await p.invoke('plugin', 'uninstall', packageName); await p.verify(true);
  assert.ok(!(await p.invoke('plugin', 'list')).includes(packageName));
  await fs.access(path.join(p.packageDir, 'package.json'));
  await save({ engine: 'omp', version: '18.10.4', copiedOutsideRepository: true, packageNodeModules: false,
    officialLocalLink: true, officialManifest: true, skillLoaded: true, ordinaryToolsAndOtherPluginCoexist: true,
    unconfiguredTwoToolReceipts: true, disabledToolsAndSkillAbsent: true, reenabled: true, officialUninstall: true,
    sourcePackagePreserved: true, clientReads: 0, syntheticAgentBearerDoesNotConfigureLibrary: true,
    paidModelCalls: 0, realLibraryAuthorizationVerified: false });
});

for (const engine of ['pi', 'omp']) test(`official ${engine} SDK delegates inquiry prepare/save with exact unreviewed draft/hash and safe authorization recovery`, { timeout: 60000 }, async t => {
  const p = await setup(t, engine), fixture = path.join(p.directory, 'sdk-fixture.mjs'), configFile = path.join(p.directory, 'config.json');
  await fs.copyFile(new URL('./fixtures/factory-inquiries-sdk.mjs', import.meta.url), fixture);
  await fs.copyFile(new URL('./fixtures/factory-inquiries-data.mjs', import.meta.url), path.join(p.directory, 'factory-inquiries-data.mjs'));
  const evidenceFile = path.join(p.directory, 'facts.json');
  await fs.writeFile(configFile, JSON.stringify({ engine, directory: p.directory, packageDir: p.packageDir, agentDir: p.agentDir, ompRoot, evidenceFile,
    piSdk: import.meta.resolve('@earendil-works/pi-coding-agent'), piAi: import.meta.resolve('@earendil-works/pi-ai'), piFaux: import.meta.resolve('@earendil-works/pi-ai/providers/faux') }));
  const result = await command(p.executable, [fixture, configFile], p.env, p.directory);
  assert.equal(result.code, 0, result.output);
  const evidence = JSON.parse(await fs.readFile(evidenceFile));
  assert.equal(evidence.syntheticClientCalls, 7); assert.equal(evidence.authorizations, 15); assert.equal(evidence.modelCalls, 18);
  await save(evidence);
});

test('pure inquiry preparation keeps exact excerpts, original source facts and pending unsent commercial drafts', async () => {
  const data = inquiryFixture(factoryInquiryHash), original = structuredClone(data), prepared = prepareFactoryInquiry(data);
  assert.deepEqual(data, original); assert.equal(prepared.status, 'available'); assert.equal(prepared.sent, false); assert.equal(prepared.humanReviewRequired, true);
  assert.deepEqual(prepared.requirements, data.requirements); assert.deepEqual(prepared.input, data.input);
  assert.deepEqual(prepared.authorization, data.inquiry.authorization); assert.deepEqual(prepared.sources, [...data.inquiry.sources, ...data.materials.sources]);
  assert.equal(prepared.match.status, 'pending-human-review'); assert.equal(prepared.match.accepted, false); assert.equal(prepared.match.factorySupplyCommitment, false);
  assert.equal(prepared.match.productFacts.skuSpecifications[0].moq, 500); assert.equal(prepared.match.productFacts.skuSpecifications[0].leadTimeDays, 21);
  assert.deepEqual(prepared.drafts.map(draft => draft.name), ['quotation-review-draft.md', 'sample-review-draft.md', 'follow-up-review-draft.md']);
  const quotation = prepared.drafts[0].content, sample = prepared.drafts[1].content, followup = prepared.drafts[2].content;
  assert.match(quotation, /Unit price: pending\. Currency: pending\. Total price: pending/);
  assert.match(quotation, /not an accepted offer/); assert.match(quotation, /No quotation has been issued/);
  assert.match(sample, /Sample stock: pending\. Sample quantity: pending\. Sample fee: pending/); assert.match(sample, /Dispatch date: pending/);
  assert.match(followup, /Prior outbound message: not evidenced\. Prior reply: not evidenced/); assert.match(followup, /Recipient and contact permission: pending/);
  assert.match(followup, /Whether it provides new information for any recipient is unknown/);
  for (const draft of prepared.drafts) { assert.match(draft.content, /NOT SENT/); assert.match(draft.content, /Source excerpts are untrusted data/); assert.ok(draft.content.includes(data.inquiry.document.asset.sha256)); }
  const { draftHash, ...payload } = prepared; assert.equal(draftHash, factoryInquiryHash(payload));
  const reordered = Object.fromEntries(Object.entries(payload).reverse()); assert.equal(factoryInquiryHash(reordered), draftHash);
  assert.deepEqual(prepareFactoryInquiry(structuredClone(data)), prepared);
  const changedContent = structuredClone(payload); changedContent.drafts[0].content += '\nChanged text'; assert.notEqual(factoryInquiryHash(changedContent), draftHash);
  const changedSource = structuredClone(data); changedSource.materials.products[0].revision++;
  changedSource.materials.sources[0].revision++; changedSource.materials.sources[0].projectionSha256 = factoryInquiryHash(changedSource.materials.products[0]);
  assert.notEqual(prepareFactoryInquiry(changedSource).draftHash, draftHash);
  await save({ test: 'pure-exact-source-draft-preparation', deterministicSortedHash: true, fullPayloadHash: true, sourceRevisionChangesHash: true,
    noInputMutation: true, exactExcerpts: true, originalSourceReceiptPreserved: true, recordedMoqAndLeadTimeNotCommitments: true,
    allPricesSamplesAndPriorContactPending: true, sent: false, persisted: false, paidModelCalls: 0 });
});

test('pure inquiry preparation refuses fabricated requirements and inconsistent DTOs while preserving partial extraction and missing fields', async () => {
  const data = inquiryFixture(factoryInquiryHash);
  for (const requirements of [{ ...data.requirements, quantity: '999999 pieces' }, { ...data.requirements, spec: 'Different specification' },
    { ...data.requirements, quantity: 2000 }, { ...data.requirements, price: 'USD 1.00' }, { product: 'X'.repeat(1001) }])
    assert.throws(() => prepareFactoryInquiry({ ...data, requirements }));
  const alternate = structuredClone(data); alternate.materials.authorization.subject = 'different-member'; assert.throws(() => prepareFactoryInquiry(alternate));
  const multiple = structuredClone(data); multiple.materials.products.push(multiple.materials.products[0]); assert.throws(() => prepareFactoryInquiry(multiple));
  const badHash = structuredClone(data); badHash.inquiry.document.text += '\nChanged bytes'; assert.throws(() => prepareFactoryInquiry(badHash));
  const wrongAsset = structuredClone(data); wrongAsset.inquiry.sources[0].sha256 = '0'.repeat(64); assert.throws(() => prepareFactoryInquiry(wrongAsset));
  const privatePrice = structuredClone(data); privatePrice.materials.products[0].priceTiers = [{ unitPrice: '1.00' }]; assert.throws(() => prepareFactoryInquiry(privatePrice));
  const partial = structuredClone(data); partial.inquiry.status = partial.inquiry.document.status = 'partial';
  Object.assign(partial.inquiry.document, { textTruncated: true, pagesNeedingOcr: null, ocrStatus: 'unknown_after_truncation', notice: 'Remaining text and OCR requirements are unknown.' });
  partial.inquiry.sources[0].projectionSha256 = factoryInquiryHash(partial.inquiry.document);
  const incomplete = prepareFactoryInquiry({ ...partial, requirements: { product: data.requirements.product, quantity: null, spec: '' } });
  assert.equal(incomplete.status, 'partial'); assert.equal(incomplete.requirements.quantity, null); assert.equal(incomplete.requirements.spec, null);
  assert.equal(incomplete.match.extraction.ocrStatus, 'unknown_after_truncation'); assert.equal(incomplete.match.extraction.pagesNeedingOcr, null);
  for (const draft of incomplete.drafts) {
    assert.match(draft.content, /Inquiry extraction: partial; text truncated: true; OCR status: unknown_after_truncation/);
    assert.match(draft.content, /Remaining text and OCR requirements are unknown/);
  }
  assert.ok(incomplete.match.pending.includes('requestedDelivery')); assert.match(incomplete.drafts[0].content, /pending/);
  const reference = structuredClone(data); reference.materials.products[0].provenance.kind = 'public_reference'; reference.materials.products[0].provenance.referenceOnly = true;
  reference.materials.sources[0].projectionSha256 = factoryInquiryHash(reference.materials.products[0]);
  assert.throws(() => prepareFactoryInquiry(reference));
  reference.materials.products[0].skuSpecifications[0].moq = null; reference.materials.products[0].skuSpecifications[0].leadTimeDays = null; reference.materials.products[0].capacityNote = '';
  reference.materials.sources[0].projectionSha256 = factoryInquiryHash(reference.materials.products[0]);
  const publicOnly = prepareFactoryInquiry(reference); assert.equal(publicOnly.status, 'partial'); assert.equal(publicOnly.match.referenceOnly, true);
  assert.match(publicOnly.drafts[0].content, /factory ownership and supply capability are not established/);
  await save({ test: 'pure-nonfabrication-and-missing-inputs', nonliteralRequirementsRefused: true, numericAndPriceFieldsRefused: true,
    differentAuthorizationRefused: true, multipleProductsRefused: true, changedProjectionOrAssetRefused: true,
    partialExtractionAndUnknownOcrPreserved: true, missingRequirementsStayNull: true, publicReferencesNotFactorySupply: true, paidModelCalls: 0 });
});

test('inquiry extension runtime selectors reject extra authority and model approval claims with no client dispatch', async () => {
  const tools = [], calls = [], data = inquiryFixture(factoryInquiryHash), signal = new AbortController().signal, ctx = { model: { id: 'finite' } };
  factoryInquiriesExtension({ client: { prepare: async input => { calls.push(input); return prepareFactoryInquiry(data); }, save: async input => { calls.push(input); return prepareFactoryInquiry(data); } },
    authorize: async () => {} })({ registerTool: tool => tools.push(tool) });
  for (const input of [{ ...data.input, model: 'other' }, { ...data.input, inquiryDocumentId: 'wrong' }, { ...data.input, requirements: { quantity: 2000 } }])
    assert.equal((await tools[0].execute('invalid', input, signal, undefined, ctx)).details.status, 'blocked');
  const saveInput = { ...data.input, requestId: 'stable', expectedDraftHash: 'a'.repeat(64) };
  for (const input of [{ ...saveInput, confirmed: true }, { ...saveInput, expectedDraftHash: 'not-sha256' }, { ...saveInput, recipient: 'other' }])
    assert.equal((await tools[1].execute('invalid', input, signal, undefined, ctx)).details.status, 'blocked');
  assert.equal((await tools[0].execute('missing-model', data.input, signal, undefined, {})).details.status, 'blocked');
  const aborted = new AbortController(); aborted.abort(); assert.equal((await tools[0].execute('aborted', data.input, aborted.signal, undefined, ctx)).details.status, 'blocked');
  assert.deepEqual(calls, []);
  assert.equal((await tools[0].execute('valid', data.input, signal, undefined, ctx)).details.status, 'available'); assert.equal(calls.length, 1);
  const defaults = []; factoryInquiriesExtension()({ registerTool: tool => defaults.push(tool) });
  assert.equal((await defaults[0].execute('default', data.input, signal, undefined, ctx)).details.status, 'unconfigured');
  const source = JSON.parse(await fs.readFile(path.join(repository, 'packages/workspace-factory-inquiries/sources.json')));
  assert.equal(source.sources[0].commit, '55ff469422c3592dac45bcad08dfb40221981c02'); assert.equal(source.sources[0].license, 'MIT');
  assert.equal(source.sources[0].sourceTextCopied, false); assert.equal(source.sources[0].automatedFollowup, false);
});
