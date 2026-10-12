// Started by the Unix PTY test only. Host and Pi share the real PTY; original
// synthetic credentials remain in this process, never environment/argv/files.
import { writeFile } from 'node:fs/promises';
import { supplierFixture, actor, origin } from './supplier-owner.mjs';
import { launchWithExistingOwnerSession } from '../../owner-host-launch.mjs';

const directory = process.env.PI_SUPPLIER_FIXTURE_DIRECTORY;
if (!directory?.startsWith('/tmp/') || !process.env.PI_SUPPLIER_FIXTURE_STATE) throw new Error('SYNTHETIC_FIXTURE_PATH_REQUIRED');
const fixture = await supplierFixture({ directory, snapshotFile: process.env.PI_SUPPLIER_FIXTURE_STATE });
const session = (await fixture.http('/api/session')).body;
await writeFile(process.env.PI_SUPPLIER_FIXTURE_READY, JSON.stringify({ ready: true, synthetic: true }), { mode: 0o600 });
const child = launchWithExistingOwnerSession({ origin, token: fixture.token, session, conversationId: actor.nativeAgentId, mode: 'tui', fetchImpl: fixture.fetchImpl });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
try { process.exitCode = await new Promise((resolve, reject) => { child.once('exit', code => resolve(code ?? 1)); child.once('error', reject); }); }
finally { await fixture.close(); }
