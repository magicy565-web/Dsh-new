// Manual operator action only. Password never enters argv, env, log or file.
import { spawn } from 'node:child_process';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const help = 'Manual only: docker compose exec api node /opt/medusa/entrypoint.mjs admin --confirm-create-admin\nUse a private interactive terminal; enter email and hidden password at the prompts. Startup never creates administrators.';
async function hidden(prompt) {
  process.stdout.write(prompt); emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const done = (error) => { process.stdin.off('keypress', key); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); error ? reject(error) : resolve(value); };
    const key = (text, info = {}) => {
      if (info.ctrl && info.name === 'c') return done(Error('MANUAL_ADMIN_CANCELLED'));
      if (info.name === 'return') return done();
      if (info.name === 'backspace') value = value.slice(0, -1);
      else if (typeof text === 'string' && !/[\x00-\x1f\x7f]/.test(text) && value.length < 256) value += text;
    };
    process.stdin.on('keypress', key);
  });
}
try {
  if (process.argv[2] === '--manual-child' && process.argv.length === 3) {
    const { email, password, confirmed } = JSON.parse(readFileSync(3, 'utf8'));
    if (confirmed !== true || typeof email !== 'string' || !email.includes('@') || typeof password !== 'string' || password.length < 16) throw Error();
    const require = createRequire('/app/package.json');
    const nativeUser = require('@medusajs/medusa/commands/user').default;
    await nativeUser({ directory: '/app', email, password, keepAlive: false });
  } else if (process.argv.includes('--help')) console.log(help);
  else {
    if (process.argv.length !== 3 || process.argv[2] !== '--confirm-create-admin' || !process.stdin.isTTY || !process.stdout.isTTY) throw Error('INTERACTIVE_MANUAL_ADMIN_CONFIRMATION_REQUIRED');
    const input = createInterface({ input: process.stdin, output: process.stdout });
    const email = await new Promise(resolve => input.question('Admin email: ', resolve)); input.close();
    const password = await hidden('Admin password (16+ characters, hidden): '), repeat = await hidden('Repeat password (hidden): ');
    if (!email.includes('@') || /[\r\n\0]/.test(email) || password.length < 16 || password !== repeat) throw Error('MANUAL_ADMIN_INPUT_REFUSED');
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [import.meta.filename, '--manual-child'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe'], env: process.env });
      child.once('error', reject); child.once('exit', resolve); child.stdio[3].end(JSON.stringify({ email, password, confirmed: true }));
    });
    if (code !== 0) throw Error('NATIVE_ADMIN_CREATION_REFUSED');
    console.log('Native Medusa administrator created by the explicit manual action.');
  }
} catch { console.error('MANUAL_ADMIN_REFUSED. ' + help); process.exitCode = 2; }
