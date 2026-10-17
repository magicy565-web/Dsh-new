// Deployment contracts only; no real service credentials or admin created.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { bootstrap } from '../acceptance/medusa/write-env.mjs';
const env = { PATH: process.env.PATH, HOME: '/tmp', NO_COLOR: '1' };
test('Docker plugin inputs include automatic top-level npm pack files before enforcing the locked archive integrity', async () => {
  const prefix = 'packages/medusa-enterprise-product-context';
  const packed = spawnSync('npm', ['pack', './' + prefix, '--dry-run', '--ignore-scripts', '--json'], { env, encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  const files = JSON.parse(packed.stdout)[0].files.map(f => f.path).filter(p => !p.includes('/'));
  assert.ok(files.includes('README.md')); // npm includes this even with a restrictive package files list.
  const dockerfile = await fs.readFile('acceptance/medusa/api.Dockerfile', 'utf8');
  const allowlist = (await fs.readFile('acceptance/medusa/api.Dockerfile.dockerignore', 'utf8')).split('\n').filter(s => s.startsWith('!')).map(s => s.slice(1));
  const inputs = dockerfile.split('\n').filter(s => s.startsWith('COPY ') && !s.includes('--from=')).flatMap(s => s.trim().split(/\s+/).slice(1, -1).filter(p => !p.startsWith('--')));
  const matches = (pattern, file) => new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*') + '$').test(file);
  for (const file of files) {
    const source = prefix + '/' + file;
    assert.ok(inputs.some(p => matches(p, source)), file + ' absent from Docker COPY');
    assert.ok(allowlist.some(p => matches(p, source)), file + ' absent from Docker build context');
  }
  assert.match(dockerfile, /COPY --chmod=0600 packages\/medusa-enterprise-product-context\/package\*\.json/);
  assert.match(dockerfile, /COPY --chmod=0600 packages\/medusa-enterprise-product-context\/README\.md/);
  assert.match(dockerfile, /RUN umask 077 && npm run build --prefix packages\/medusa-enterprise-product-context/);
});
test('bootstrap requires explicit approval, preserves existing synthetic files and refuses temporary/partial state', async t => {
  const directory = await fs.mkdtemp('/workspace/deployment-contract-'); await fs.chmod(directory, 0o700);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let entropyCalls = 0; const entropy = size => { entropyCalls++; return Buffer.alloc(size, 0x11); };
  assert.throws(() => bootstrap({ directory }, { entropy }), /CONFIRMATION/); assert.equal(entropyCalls, 0);
  assert.equal(bootstrap({ directory, check: true }, { entropy }).status, 'unconfigured'); assert.equal(entropyCalls, 0);
  const missing = spawnSync(process.execPath, ['acceptance/medusa/write-env.mjs', '--state-dir', directory, '--check'], { env, encoding: 'utf8' });
  assert.equal(missing.status, 2); assert.equal(JSON.parse(missing.stdout).status, 'unconfigured');
  assert.deepEqual(await fs.readdir(directory), []);
  assert.equal(bootstrap({ directory, confirmed: true }, { entropy }).adminCreated, false); assert.equal(entropyCalls, 6);
  const names = await fs.readdir(directory + '/secrets'), before = await Promise.all(names.map(name => fs.readFile(directory + '/secrets/' + name)));
  assert.equal((await fs.stat(directory + '/secrets')).mode & 0o777, 0o700);
  assert.equal(names.some(n => /admin|password.*admin|\.env/.test(n)), false);
  assert.equal(bootstrap({ directory, confirmed: true }, { entropy }).generated, false); assert.equal(entropyCalls, 6);
  for (const [i,name] of names.entries()) assert.deepEqual(await fs.readFile(directory + '/secrets/' + name), before[i]);
  const docling = JSON.parse(await fs.readFile(directory + '/secrets/docling.json'));
  assert.equal(docling.eng_kind, 'local'); assert.equal(docling.eng_loc_num_workers, 1);
  assert.equal(docling.enable_remote_services, false); assert.equal(docling.allow_external_plugins, false);
  assert.throws(() => bootstrap({ directory: '/tmp', confirmed: true }, { entropy }), /PERSISTENT/);
  await fs.unlink(directory + '/secrets/cookie_secret');
  assert.throws(() => bootstrap({ directory, confirmed: true }, { entropy })); assert.equal(entropyCalls, 6);
});
test('administrator setup refuses noninteractive input; passwords are not accepted as CLI arguments', () => {
  const result = spawnSync(process.execPath, ['acceptance/medusa/create-user.mjs', '--confirm-create-admin'], { env, encoding: 'utf8' });
  assert.equal(result.status, 2); assert.match(result.stderr, /MANUAL_ADMIN_REFUSED/);
});
test('actual Compose parser retains loopback bindings, nonroot isolation, per-service files and persistent volumes', () => {
  const read = file => {
    const result = spawnSync('docker', ['compose','-f',file,'config','--format','json'], { env: { ...env, DOCKER_CONFIG: '/tmp/workspace-deployment-docker-20261017', WORKSPACE_SERVICES_STATE_DIR: '/workspace/fixture-no-service-files' }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  };
  const medusa = read('acceptance/medusa/compose.yaml'), parser = read('acceptance/docling/compose.yaml');
  assert.equal(medusa.services.postgres.ports, undefined); assert.equal(medusa.services.redis.ports, undefined);
  assert.equal(medusa.services.api.ports, undefined); assert.equal(parser.services.docling.ports, undefined);
  for (const service of [...Object.values(medusa.services), ...Object.values(parser.services)]) {
    assert.notEqual(service.user, 'root'); assert.notEqual(service.user, '0'); assert.equal(service.read_only, true);
    assert.ok(service.cap_drop.includes('ALL')); assert.ok(service.security_opt.includes('no-new-privileges:true'));
    assert.ok(!JSON.stringify(service.environment || {}).includes('api_key'));
    assert.ok(!(service.volumes || []).some(v => v.type === 'bind'));
    for (const port of service.ports || []) assert.equal(port.host_ip, '127.0.0.1');
  }
  assert.deepEqual(medusa.services.ui.ports.map(p => [p.published, p.target]), [['4173',8080],['9000',9000]]);
  assert.deepEqual(parser.services.ingress.ports.map(p => [p.published, p.target]), [['5001',8080]]);
  for (const [project, proxy, backendNetwork] of [[medusa,'ui','private'],[parser,'ingress','parser']]) {
    assert.equal(project.networks[backendNetwork].internal, true);
    assert.notEqual(project.networks.ingress.internal, true);
    assert.equal(project.networks.ingress.driver_opts['com.docker.network.bridge.host_binding_ipv4'], '127.0.0.1');
    assert.equal(project.networks.ingress.driver_opts['com.docker.network.bridge.gateway_mode_ipv4'], 'nat');
    for (const [name,service] of Object.entries(project.services)) {
      if (name === proxy) {
        assert.deepEqual(Object.keys(service.networks).sort(), [backendNetwork,'ingress'].sort());
        assert.equal(service.secrets, undefined); assert.equal(service.configs.length, 1);
        assert.equal(service.configs[0].target, '/etc/nginx/conf.d/default.conf');
      } else assert.deepEqual(Object.keys(service.networks), [backendNetwork]);
    }
  }
  assert.equal(parser.services.docling.environment.DOCLING_DEVICE, 'cpu');
  assert.match(parser.services.docling.image, /v1\.37\.0@sha256:6eda9c/);
  assert.deepEqual(Object.keys(parser.services), ['docling','ingress']);
  assert.match(parser.services.ingress.image, /nginx-unprivileged:1\.28-alpine@sha256:7377697/);
  assert.equal(Number(parser.services.docling.mem_limit), 3221225472); assert.equal(Number(parser.services.ingress.mem_limit), 67108864);
  assert.ok(Object.values(medusa.services.api.environment).every(v => !String(v).includes('postgres://')));
  assert.equal(medusa.services.api.secrets.length, 5);
  assert.equal(medusa.services.api.environment.XDG_CONFIG_HOME, '/tmp/medusa-config');
  assert.equal(medusa.services.api.environment.XDG_CACHE_HOME, '/tmp/medusa-cache');
});
test('strict Medusa smoke refuses nonloopback or missing isolated write intent without requests', () => {
  for (const config of [{ MEDUSA_BACKEND_URL: 'https://example.invalid' }, { MEDUSA_BACKEND_URL: 'http://127.0.0.1:9000' }]) {
    const result = spawnSync(process.execPath, ['scripts/medusa-catalog-live-smoke.mjs'], { env: { ...env, ...config }, encoding: 'utf8' });
    assert.equal(result.status, 2); assert.ok(!result.stdout.includes('skipped'));
  }
});
test('strict smoke fails on a refused created fixture, never changes arbitrary inventory and redacts synthetic credentials', async t => {
  const password = 'synthetic-password-never-real', token = 'synthetic-agent-never-real', adminToken = 'synthetic-admin-never-real';
  const paths = [];
  const server = createServer((req,res) => {
    paths.push(req.url); res.setHeader('content-type','application/json');
    if (req.url === '/auth/user/emailpass') res.end(JSON.stringify({ token: adminToken }));
    else if (req.url === '/admin/products?limit=1') { res.statusCode = 401; res.end('{}'); }
    else { res.statusCode = 503; res.end(JSON.stringify({ message: password + token + adminToken })); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const child = spawn(process.execPath, ['scripts/medusa-catalog-live-smoke.mjs'], { env: { ...env, MEDUSA_BACKEND_URL: 'http://127.0.0.1:' + server.address().port,
    MEDUSA_ADMIN_EMAIL: 'fixture@example.test', MEDUSA_ADMIN_PASSWORD: password, AGENT_CONTEXT_READ_TOKEN: token, MEDUSA_LIVE_ALLOW_WRITES: 'isolated' } });
  let out = ''; child.stdout.on('data', b => { out += b; });
  assert.equal(await new Promise(resolve => child.once('exit',resolve)), 1);
  const report = JSON.parse(out); assert.equal(report.ok, false); assert.equal(report.status, 'failed');
  for (const value of [password,token,adminToken]) assert.ok(!out.includes(value));
  assert.deepEqual(paths, ['/auth/user/emailpass','/admin/products?limit=1','/admin/collections']);
  assert.deepEqual(report.cleanup, []);
});
