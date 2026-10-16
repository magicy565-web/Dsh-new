// Actual original OMP Session, finite model only; no Host/provider credential.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseLocalArguments, runLocalFactory } from '../scripts/workspace-omp-local.mjs';
const model = { providerId: 'explicit-local-entry-finite', model: 'finite', baseUrl: 'https://synthetic.invalid' };
async function fixture(t) {
  const directory = await fs.mkdtemp('/tmp/omp-local-entry-');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'out')); await fs.writeFile(path.join(directory, 'product.md'), 'Synthetic public cup; delivery and capacity pending.\n');
  return { directory, args: ['--input', path.join(directory, 'product.md'), '--output-dir', path.join(directory, 'out')] };
}
test('one natural-language goal selects a persistent native Session without a fixed report default', async t => {
  const f = await fixture(t), goal = '先读资料，问我还缺哪些交期信息，暂不生成报告。';
  const options = parseLocalArguments([...f.args, goal]);
  assert.equal(options.task, goal); assert.equal(options.sessionFile, path.join(f.directory, 'out/factory-session.jsonl'));
  assert.equal(parseLocalArguments([goal, ...f.args]).task, goal);
  const emptyGoal = parseLocalArguments(f.args); assert.match(emptyGoal.task, /Ask what goal/); assert.ok(!emptyGoal.task.includes('report.md'));
  assert.equal(parseLocalArguments([...f.args, '--task', goal]).task, goal);
  const explicit = path.join(f.directory, 'private.jsonl');
  assert.equal(parseLocalArguments([...f.args, '--session', explicit, goal]).sessionFile, explicit);
  for (const extra of [[goal, '另一个目标'], [goal, '--task', goal], ['--task', goal, '--task', goal], ['--unknown'], ['']]) assert.throws(() => parseLocalArguments([...f.args, ...extra]));
});
test('explicit public-only CLI admits no private inputs or archive and selects the reviewed plugin config',async t=>{
 const f=await fixture(t),args=['--public-only','--plugin-config','config.free-trade.json','--output-dir',path.join(f.directory,'out'),'Only public procurement terms.'];
 const options=parseLocalArguments(args);assert.equal(options.publicOnly,true);assert.equal(options.pluginConfig,'config.free-trade.json');assert.deepEqual(options.inputs,[]);
 for(const extra of [['--input',path.join(f.directory,'product.md')],['--archive-dir',f.directory],['--enterprise','private']])assert.throws(()=>parseLocalArguments([...args,...extra]),/LOCAL_PUBLIC_ONLY_INPUT_REFUSED/);
 const output=await npm(f,[...args,'--check']);const receipt=output.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}).find(row=>row.localFilesReady);
 assert.equal(receipt.modelStatus,'model-unconfigured');assert.equal(receipt.preflightReady,false);
 assert.equal(receipt.status,receipt.environment.nativeLock.ready?'model-unconfigured':'environment-unavailable');assert.equal(receipt.modelRequests,0);assert.deepEqual(receipt.selectedInputs,[]);assert.deepEqual(await fs.readdir(path.join(f.directory,'out')),[]);
});
test('default native Session asks first, then restores that same Session and can write first using prior source', { timeout: 30000 }, async t => {
  const f = await fixture(t), names = ['read', 'write', 'workspace_factory_capabilities', 'workspace_factory_rfq_requirements', 'workspace_factory_match_prepare'];
  const first = await runLocalFactory({ options: parseLocalArguments([...f.args, '先读资料，问我缺项，暂不写文件。']), configuration: model, syntheticResponses: [
    { tool: 'read', arguments: { path: 'input-1' }, expectedToolNames: names }, { text: '请补充交期；产能仍待确认。' },
  ] });
  assert.equal(first.status, 'completed-local-turn', JSON.stringify(first)); assert.deepEqual(first.saved, []);
  assert.equal(first.workspaceHostUsed, false); assert.equal(first.wsBindingUsed, false); assert.equal(first.paidModelVerified, false);
  const second = await runLocalFactory({ options: parseLocalArguments([...f.args, '保留交期缺项，写一段产品介绍并保存 intro.md。']), configuration: model, syntheticResponses: [
    { tool: 'write', arguments: { path: 'intro.md', content: 'Synthetic public cup. Delivery and capacity pending.' }, expectedContextText: '请补充交期；产能仍待确认。', expectedToolNames: names },
    { text: '介绍已保存，缺项未作承诺。' },
  ] });
  assert.equal(second.status, 'saved-local-drafts', JSON.stringify(second)); assert.equal(second.localSession.id, first.localSession.id);
  assert.equal(second.localSession.resumed, true); assert.deepEqual(second.toolReceipts.map(r => r.tool), ['write']);
  assert.equal(second.saved[0].name, 'intro.md'); assert.equal(second.revalidatedPriorSources.length, 1);
  assert.deepEqual((await fs.readdir(path.join(f.directory, 'out'))).sort(), ['factory-session.jsonl', 'intro.md']);
  assert.equal((await fs.stat(first.localSession.file)).mode & 0o777, 0o600);
});
async function npm(f, args) {
  const child = spawn('npm', ['run', 'factory:local', '--', ...args], { cwd: path.resolve('.'),
    env: { PATH: process.env.PATH, HOME: f.directory, TMPDIR: f.directory, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; });
  const exit=await new Promise(resolve => child.once('close', resolve));
  const receipt=args.includes('--check')?output.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}).find(row=>row.localFilesReady):null;
  assert.equal(exit,receipt?.environment.nativeLock.ready===false?2:0,output); return output;
}
test('actual npm positional goal preflight and help need no Host/key and do not create a Session', { timeout: 20000 }, async t => {
  const f = await fixture(t), output = await npm(f, [...f.args, '先看资料并追问，暂不写报告。', '--check']);
  const receipt = output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).find(r => r.localFilesReady);
  assert.equal(receipt.modelStatus, 'model-unconfigured'); assert.equal(receipt.preflightReady,false);
  assert.equal(receipt.status,receipt.environment.nativeLock.ready?'model-unconfigured':'environment-unavailable'); assert.equal(receipt.modelRequests, 0); assert.equal(receipt.localSession.resumed, false);
  assert.equal(receipt.localSession.file, path.join(f.directory, 'out/factory-session.jsonl')); assert.deepEqual(await fs.readdir(path.join(f.directory, 'out')), []);
  const archive=path.join(f.directory,'owner-archive');await fs.mkdir(archive,{mode:0o700});
  const ownerArgs=['--output-dir',path.join(f.directory,'out'),'--archive-dir',archive,'--enterprise','enterprise-A','--project','project-one'];
  const ownerOutput=await npm(f,[...ownerArgs,'只查询现有档案。','--check']);
  const ownerReceipt=ownerOutput.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}).find(r=>r.localFilesReady);
  assert.equal(ownerReceipt.modelStatus,'model-unconfigured');assert.equal(ownerReceipt.preflightReady,false);
  assert.equal(ownerReceipt.status,ownerReceipt.environment.nativeLock.ready?'model-unconfigured':'environment-unavailable');assert.equal(ownerReceipt.modelRequests,0);assert.deepEqual(ownerReceipt.selectedInputs,[]);
  assert.deepEqual(await fs.readdir(archive),[]);assert.deepEqual(await fs.readdir(path.join(f.directory,'out')),[]);
  assert.throws(()=>parseLocalArguments(ownerArgs.slice(0,-2)),/LOCAL_REFERENCE_SCOPE_REQUIRED/);
  const help = await npm(f, ['--help']); assert.match(help, /一句话目标/); assert.match(help, /factory-session.jsonl/); assert.match(help, /每条命令执行一个目标后退出/); assert.match(help, /零模型请求/);
});
