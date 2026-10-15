import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { once } from 'node:events';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { createPiProvider } from '../server/pi-provider.mjs';
import { createApp } from '../server/index.mjs';

test('actual SIGKILL fixture: recover pending Pi work and cached answer before business acknowledgment without duplicate admission', async t => {
  for (const mode of ['pending', 'answered', 'metadata-gap']) {
    const directory = await fs.mkdtemp('/tmp/workspace-pi-kill-');
    const child = spawn(process.execPath, ['test/fixtures/pi-crash-child.mjs', directory, mode], { env: { PATH: process.env.PATH, HOME: directory, TMPDIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = once(child, 'exit');
    let stderr = '', app;
    child.stderr.on('data', data => { stderr += data; });
    t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; await app?.close(); await fs.rm(directory, { recursive: true, force: true }); });
    const ready = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('Crash fixture did not admit work: ' + stderr)), 15000);
      child.stdout.on('data', data => { output += data; if (output.includes('\n')) { clearTimeout(timeout); resolve(JSON.parse(output.split('\n')[0])); } });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('Crash fixture exited early: ' + stderr)); });
    });
    child.kill('SIGKILL'); const [, signal] = await exited; assert.equal(signal, 'SIGKILL');
    const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
    faux.setResponses(mode === 'pending' ? [fauxAssistantMessage('Recovered process-crash fixture')] : []);
    app = await createApp({ dataDirectory: directory, provider: createPiProvider({ models, providerId: 'faux', model: 'faux-1' }) });
    assert.equal(app.runtime.getRun(ready.runId).run.status, 'interrupted');
    if (mode === 'metadata-gap') assert.equal(app.runtime.getRun(ready.runId).run.piNativeTaskId, undefined);
    assert.equal(faux.state.callCount, 0);
    await app.runtime.retryRun(ready.runId, { requestId: 'explicit-crash-recover' });
    for (let i = 0; i < 500 && app.runtime.getRun(ready.runId).run.status === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    const run = app.runtime.getRun(ready.runId).run;
    assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
    assert.equal(run.piNativeTaskId, ready.nativeTaskId);
    assert.equal(app.runtime.listRuns().runs.length, 1);
    assert.equal(app.runtime.bootstrap().messages.filter(value => value.role === 'user').length, 1);
    assert.equal(faux.state.callCount, mode === 'pending' ? 1 : 0);
    await app.close();
  }
});
