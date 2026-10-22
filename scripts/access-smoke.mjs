// End-to-end smoke for local sign-in.
//
// Builds the local composition plus workspace-access, then proves the kernel
// stops trusting x-harness-* headers: private routes need a session cookie,
// sign-in is loopback-only and the role comes from the workspace seam.
//
// Usage: node scripts/access-smoke.mjs
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { createHarness } from '../packages/harness-kernel/src/app.mjs';

const root = path.resolve(import.meta.dirname, '..');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) }); };

const composition = parse(await readFile(path.join(root, 'harness.local.yml'), 'utf8'));
composition.server = { host: '127.0.0.1', port: 0 };
composition.plugins = [...composition.plugins, { id: 'access', name: 'workspace-access', config: { workspaceId: 'local' } }];
const compositionPath = path.join(root, '.harness-access-smoke.yml');
await writeFile(compositionPath, stringify(composition), 'utf8');

const harness = await createHarness({ compositionPath, root, logger: { info() {}, warn() {}, error() {} } });
try {
  const { address } = await harness.start();
  const base = address.url;

  const anonymous = await fetch(`${base}/api/chat/status`, {
    headers: { 'x-harness-actor': 'spoofed', 'x-harness-role': 'admin' },
  });
  check('a private route refuses an anonymous caller', anonymous.status === 401, anonymous.status);
  const anonymousBody = await anonymous.json();
  check('the refusal is explicit', anonymousBody.error?.code === 'HARNESS_UNAUTHENTICATED', anonymousBody.error?.code);

  const page = await fetch(`${base}/chat`);
  check('even the page shell needs a session', page.status === 401, page.status);

  const login = await fetch(`${base}/api/access/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subject: 'local-operator' }),
  });
  check('a workspace member can sign in', login.status === 200, login.status);
  const cookie = (login.headers.getSetCookie?.() ?? [login.headers.get('set-cookie')])[0] ?? '';
  const sessionCookie = cookie.split(';')[0];
  check('sign-in sets an HttpOnly session cookie', /dsh_session=[a-f0-9]{64}/u.test(sessionCookie), sessionCookie.slice(0, 20));
  check('the cookie is HttpOnly and SameSite=Strict', /HttpOnly/u.test(cookie) && /SameSite=Strict/u.test(cookie));

  const signedIn = await fetch(`${base}/api/chat/status`, { headers: { cookie: sessionCookie } });
  check('a signed-in member reaches a private route', signedIn.status === 200, signedIn.status);
  const pageSignedIn = await fetch(`${base}/chat`, { headers: { cookie: sessionCookie } });
  check('the chat page loads for the member', pageSignedIn.status === 200, pageSignedIn.status);

  const session = await fetch(`${base}/api/access/session`, { headers: { cookie: sessionCookie } }).then(response => response.json());
  check('the role comes from the workspace seam', session.actor?.role === 'admin' && session.actor?.subject === 'local-operator', session.actor);

  const unknown = await fetch(`${base}/api/access/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subject: 'stranger' }),
  });
  check('a non-member cannot sign in', unknown.status === 403, unknown.status);

  const logout = await fetch(`${base}/api/access/logout`, { method: 'POST', headers: { cookie: sessionCookie } });
  check('sign-out succeeds', logout.status === 200, logout.status);
  const afterLogout = await fetch(`${base}/api/chat/status`, { headers: { cookie: sessionCookie } });
  check('a revoked session no longer works', afterLogout.status === 401, afterLogout.status);
} finally {
  await harness.stop().catch(() => {});
  await unlink(compositionPath).catch(() => {});
}

const failed = results.filter(item => !item.ok);
for (const item of results) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.detail === undefined ? '' : ` (${JSON.stringify(item.detail)})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
