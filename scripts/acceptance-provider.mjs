#!/usr/bin/env node
/** Explicit, bounded paid-service acceptance. Never runs as part of npm test. */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { sourceFingerprint } from '../server/source-fingerprint.mjs';
export { sourceFingerprint } from '../server/source-fingerprint.mjs';
import { createApp } from '../server/index.mjs';
import { createDeepSeekProvider, ProviderError, SUPPORTED_MODELS } from '../server/provider.mjs';
import { createFastAITokenProvider } from '../server/relay-provider.mjs';
import { assertRelayAcceptanceBilling } from '../server/relay-billing.mjs';
const sleep = delay => new Promise(resolve => setTimeout(resolve, delay));
export const ACCEPTANCE_LIMITS = Object.freeze({ requests: 5, outputTokensPerRequest: 512, totalInputCharacters: 32_000, timeoutMs: 240_000 });
export async function runProviderAcceptance({ provider, model = 'deepseek-flash', evidenceKind = 'scripted-model-fixture', timeoutMs = ACCEPTANCE_LIMITS.timeoutMs } = {}) {
  if (!provider?.configured || !(provider.models || SUPPORTED_MODELS).includes(model)) throw new Error('A configured supported provider is required.');
  const startedAt = new Date().toISOString(), deadline = Date.now() + timeoutMs;
  const dataDirectory = await fs.mkdtemp(path.join(tmpdir(), 'workspace-provider-acceptance-'));
  const calls = [], checks = []; let inputCharacters = 0, app, base;
  const bounded = { ...provider, async complete(options) {
    const characters = options.messages.reduce((sum, message) => sum + (typeof message.content === 'string' ? message.content.length : 0), 0);
    if (calls.length >= ACCEPTANCE_LIMITS.requests || inputCharacters + characters > ACCEPTANCE_LIMITS.totalInputCharacters) throw new ProviderError('ACCEPTANCE_LIMIT', 'Acceptance request/input limit reached; no further paid call was made.');
    if (Date.now() >= deadline) throw new ProviderError('ACCEPTANCE_TIMEOUT', 'Acceptance time limit reached.');
    inputCharacters += characters; const call = { number: calls.length + 1, inputCharacters: characters, maxOutputTokens: ACCEPTANCE_LIMITS.outputTokensPerRequest, outcome: 'started' }; calls.push(call);
    try { const result = await provider.complete({ ...options, maxTokens: Math.min(options.maxTokens || ACCEPTANCE_LIMITS.outputTokensPerRequest, ACCEPTANCE_LIMITS.outputTokensPerRequest) }); call.outcome = 'succeeded'; call.usage = result.usage || null; return result; }
    catch (error) { call.outcome = error instanceof ProviderError ? error.code : 'UNKNOWN_PROVIDER_ERROR'; throw error; }
  } };
  const report = { schemaVersion: 1, evidenceKind, model, startedAt, limits: ACCEPTANCE_LIMITS, sourceFingerprint: await sourceFingerprint(), checks, calls, result: 'failed', noExternalTools: true, temporaryWorkspace: true };
  async function launch() { app = await createApp({ dataDirectory, provider: bounded, maxConcurrentRuns: 1 }); const address = await app.listen(0); base = `http://127.0.0.1:${address.port}`; }
  async function api(route, method = 'GET', body) { const response = await fetch(`${base}/api${route}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.code || 'HTTP_ACCEPTANCE_ERROR'); return data; }
  async function until(check) { while (Date.now() < deadline) { const value = await check(); if (value) return value; await sleep(25); } throw new Error('Acceptance timed out; no automatic retry was attempted.'); }
  async function complete(runId) { const run = await until(async () => { const { run } = await api(`/runs/${runId}`); return !['queued', 'running'].includes(run.status) && run; }); assert.equal(run.status, 'succeeded', `Run did not succeed: ${run.error?.code || run.status}`); return run; }
  async function answer(conversationId, content, requestId = randomUUID()) { const sent = await api(`/conversations/${conversationId}/messages`, 'POST', { content, requestId }); await complete(sent.run.id); return sent; }
  try {
    await launch(); await api('/settings', 'PATCH', { model, language: 'en' });
    const { conversation } = await api('/conversations', 'POST', { title: 'Isolated provider acceptance' });
    const marker = `ACCEPTANCE-${randomUUID().slice(0, 8)}`;
    const first = await answer(conversation.id, `Remember this harmless acceptance marker: ${marker}. Reply only with the marker.`);
    const messages = (await api(`/conversations/${conversation.id}`)).messages;
    assert.ok(messages.some(item => item.role === 'assistant' && item.status === 'complete' && item.content.includes(marker))); checks.push('Real HTTP chat stored a provider response containing the acceptance marker');
    const count = calls.length;
    const duplicate = await api(`/conversations/${conversation.id}/messages`, 'POST', { content: `Remember this harmless acceptance marker: ${marker}. Reply only with the marker.`, requestId: first.run.requestId });
    assert.equal(duplicate.run.id, first.run.id); assert.equal(calls.length, count); checks.push('Duplicate request reused the durable run without another provider call');
    await answer(conversation.id, 'What was the acceptance marker I asked you to remember? Reply only with that marker.');
    assert.ok((await api(`/conversations/${conversation.id}`)).messages.at(-1).content.includes(marker)); checks.push('Second turn used prior conversation context');
    const { goal } = await api('/goals', 'POST', { title: 'Write a one-sentence release checklist', description: 'Write one concise sentence about checking tests and backups. This text-only task is complete after the sentence. Do not propose follow-up steps.', maxSteps: 1, maxOutputTokens: 1600 });
    await api(`/goals/${goal.id}`, 'PATCH', { action: 'start', requestId: randomUUID() });
    const finished = await until(async () => { const { goal: current } = await api(`/goals/${goal.id}`); return current.status !== 'running' && current; });
    assert.equal(finished.status, 'review_required', `Structured goal not review-ready: ${finished.lastError?.code || finished.status}`); assert.ok(finished.output?.trim()); checks.push('One-step structured provider goal reached human review without marking itself approved');
    const { artifact } = await api('/artifacts', 'POST', { filename: 'acceptance.txt', content: 'Isolated persistence acceptance' });
    await app.close(); app = null; await launch();
    assert.equal((await api(`/artifacts/${artifact.id}/content`)).content, 'Isolated persistence acceptance');
    await answer(conversation.id, 'After the server restart, repeat only the acceptance marker from our earlier messages.');
    assert.ok((await api(`/conversations/${conversation.id}`)).messages.at(-1).content.includes(marker)); checks.push('Graceful restart retained artifact bytes and conversation context for a new provider request');
    const cancelling = await api(`/conversations/${conversation.id}/messages`, 'POST', { content: 'For cancellation acceptance, write a detailed numbered checklist of 100 separate testing ideas.', requestId: randomUUID() });
    await until(() => calls.length === 5); await api(`/runs/${cancelling.run.id}/cancel`, 'POST', {});
    const cancelled = await until(async () => { const { run } = await api(`/runs/${cancelling.run.id}`); return !['queued', 'running'].includes(run.status) && run; });
    assert.equal(cancelled.status, 'cancelled', 'Request completed before cancellation could be verified; review rather than auto-retry.'); checks.push('In-flight provider cancellation stopped the run without automatic retry');
    report.result = 'passed';
  } catch (error) { report.failure = { code: error instanceof ProviderError ? error.code : 'ACCEPTANCE_ASSERTION', message: 'Acceptance did not establish every required condition. Inspect the failing local test step; no automatic paid retry was made.', detail: String(error.message).slice(0, 300).replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]') }; }
  finally { await app?.close(); await fs.rm(dataDirectory, { recursive: true, force: true }); report.finishedAt = new Date().toISOString(); report.requestCount = calls.length; report.inputCharacters = inputCharacters; }
  return report;
}
async function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--execute-paid-requests') || process.env.WORKSPACE_ACCEPTANCE_APPROVED !== '1') throw new Error('Live acceptance is disabled. Obtain explicit provider/budget authorization first, then use WORKSPACE_ACCEPTANCE_APPROVED=1 and --execute-paid-requests.');
  const outputIndex = args.indexOf('--output'), modelIndex = args.indexOf('--model'), providerIndex = args.indexOf('--provider');
  const providerName = providerIndex >= 0 ? args[providerIndex + 1] : process.env.WORKSPACE_RUNTIME || 'fastaitoken';
  if (!['fastaitoken', 'deepseek-api'].includes(providerName)) throw new Error('Choose an explicitly approved text API provider.');
  const billing = providerName === 'fastaitoken' ? assertRelayAcceptanceBilling(process.env) : undefined;
  const output = outputIndex >= 0 ? args[outputIndex + 1] : 'evidence/live-provider.json';
  const model = modelIndex >= 0 ? args[modelIndex + 1] : providerName === 'fastaitoken' ? process.env.FASTAITOKEN_MODEL : 'deepseek-flash';
  const provider = providerName === 'fastaitoken' ? createFastAITokenProvider({ apiKey: process.env.FASTAITOKEN_API_KEY || '', model: model || '' }) : createDeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY || '' });
  if (!output || !provider.configured || !(provider.models || SUPPORTED_MODELS).includes(model)) throw new Error('A newly authorized key and approved model must be configured securely.');
  await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true, mode: 0o700 });
  const evidenceFile = await fs.open(output, 'wx', 0o600); // Refuse existing report before any paid request.
  let report;
  try { report = await runProviderAcceptance({ provider, model, evidenceKind: `real-provider-${providerName}` }); if (billing) report.billingPrerequisites = billing; await evidenceFile.writeFile(`${JSON.stringify(report, null, 2)}\n`); await evidenceFile.sync(); }
  finally { await evidenceFile.close(); }
  console.log(JSON.stringify({ result: report.result, requestCount: report.requestCount, evidence: path.resolve(output), evidenceKind: report.evidenceKind })); if (report.result !== 'passed') process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Live acceptance was not completed. Check explicit approval, configuration and a new report destination. No credential values are logged.'); process.exitCode = 1; });
