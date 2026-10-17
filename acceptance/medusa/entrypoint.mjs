import fs from 'node:fs';
import { spawn } from 'node:child_process';
function secret(name) {
  const value = fs.readFileSync('/run/secrets/' + name, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(value)) throw Error('REQUIRED_SERVICE_SECRET_INVALID');
  return value;
}
function run(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: 'inherit', env: process.env });
    const stop = signal => { child.kill(signal); };
    const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM');
    process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
      if (code === 0) resolve(); else reject(Error(signal ? 'SERVICE_STOPPED' : 'NATIVE_MEDUSA_COMMAND_FAILED'));
    });
  });
}
try {
  // No default secrets or secret-bearing Docker environment/argv. Only files
  // explicitly created by the operator's separate bootstrap are consumed.
  process.env.DATABASE_URL = 'postgres://medusa:' + secret('postgres_password') + '@postgres:5432/medusa_catalog';
  process.env.REDIS_URL = 'redis://:' + secret('redis_password') + '@redis:6379';
  process.env.JWT_SECRET = secret('jwt_secret'); process.env.COOKIE_SECRET = secret('cookie_secret');
  process.env.AGENT_CONTEXT_READ_TOKEN = secret('agent_context_read_token');
  const mode = process.argv[2] || 'serve', medusa = '/app/node_modules/.bin/medusa';
  if (mode === 'admin') await run(process.execPath, ['/opt/medusa/create-user.mjs', ...process.argv.slice(3)]);
  else if (mode === 'migrate') await run(medusa, ['db:migrate']);
  else if (mode === 'serve') { await run(medusa, ['db:migrate']); await run(medusa, ['start', '--host', '0.0.0.0']); }
  else throw Error('EXPLICIT_MEDUSA_MODE_REQUIRED');
} catch { console.error('MEDUSA_SERVICE_START_OR_COMMAND_REFUSED; inspect operator configuration and native migration status.'); process.exitCode = 1; }
