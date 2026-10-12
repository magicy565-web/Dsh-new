// Deterministic loopback provider for actual Pi native tool-call tests only.
// OpenAI-compatible wire format, no model, remote request, real key or spending.
import http from 'node:http';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { facts, publicFields } from './supplier-owner.mjs';

const textOf = content => typeof content === 'string' ? content : (content || []).filter(item => item.type === 'text').map(item => item.text).join('');
const parse = value => { try { return JSON.parse(textOf(value)); } catch { return null; } };
export async function syntheticProvider({ profileDirectory, reportFile }) {
  const report = { synthetic: true, requests: 0, requestsWithOnlyNativeTools: [], returnedErrors: [], stages: [], externalRequests: 0, realModelVerified: false };
  async function save() { await writeFile(reportFile + '.tmp', JSON.stringify(report), { mode: 0o600 }); await rename(reportFile + '.tmp', reportFile); }
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions' || report.requests >= 40) throw Error('SYNTHETIC_PROVIDER_ROUTE_OR_LIMIT');
      const chunks = []; let size = 0;
      for await (const bytes of req) { size += bytes.length; if (size > 2_000_000) throw Error('SYNTHETIC_PROVIDER_BODY_LIMIT'); chunks.push(bytes); }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (body.model !== 'deterministic-workspace' || body.stream !== true) throw Error('SYNTHETIC_PROVIDER_MODEL_REQUIRED');
      report.requests++;
      report.requestsWithOnlyNativeTools.push((body.tools || []).map(tool => tool.function.name));
      const messages = body.messages || [];
      const userIndex = messages.findLastIndex(message => message.role === 'user');
      const user = textOf(messages[userIndex]?.content);
      const match = user.match(/\[fixture:([a-z-]+)\]/);
      if (!match) throw Error('SYNTHETIC_PROMPT_REQUIRED');
      const stage = match[1]; report.stages.push(stage);
      const returns = messages.slice(userIndex + 1).filter(message => message.role === 'tool');
      for (const returned of returns) if (/INTERACTIVE_TUI_REQUIRED|USER_CONFIRMATION_DECLINED|not found|not available|HUMAN_COMMAND_REQUIRED|Validation failed|additional propert/i.test(textOf(returned.content))) report.returnedErrors.push(textOf(returned.content).slice(0, 1000));
      let supplier, delegation;
      for (const message of messages.filter(message => message.role === 'tool')) {
        const value = parse(message.content); if (!value) continue;
        if (value.delegation) delegation = value.delegation;
        if (value.service) supplier = value.service;
        else if (value.profile && value.id) supplier = value;
        else if (value.serviceId) supplier = { ...supplier, id: value.serviceId, revision: value.revision || supplier?.revision || 1 };
      }
      const makeCall = (name, args, suffix = '') => ({ id: `synthetic-${stage}-${returns.length}${suffix}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
      let calls = [], final = `SYNTHETIC_DONE_${stage.toUpperCase().replaceAll('-', '_')}`;
      if (['intake-no', 'intake-yes', 'unattended', 'extra-field'].includes(stage) && returns.length === 0) {
        calls = [makeCall('workspace_supplier_owner_intake', { facts, ...(stage === 'extra-field' ? { confirmed: true, approved: true } : {}) })];
      } else if (stage === 'listing') {
        if (!supplier?.id) throw Error('SYNTHETIC_ORIGINAL_SERVICE_RESULT_REQUIRED');
        if (returns.length === 0) calls = [makeCall('workspace_supplier_owner_get', { serviceId: supplier.id })];
        else if (returns.length === 1) calls = [makeCall('workspace_supplier_owner_preview', { serviceId: supplier.id, expectedRevision: supplier.revision, publicFields })];
      } else if (stage === 'profile' && returns.length === 0) {
        calls = [makeCall('workspace_supplier_owner_profile', { serviceId: supplier.id, expectedRevision: supplier.revision, facts: { description: 'Confirmed synthetic model edit' } })];
      } else if (stage === 'muse-draft' && returns.length === 0) {
        calls = [makeCall('workspace_muse_draft', { serviceId: 'channel-validation', product: 'Synthetic public shirt', market: 'US', objective: 'Synthetic original Muse draft only', budgetCredits: 5, deadlineAt: new Date(Date.now() + 86400000).toISOString() })];
      } else if (stage === 'forbidden' && returns.length === 0) {
        calls = [makeCall('workspace_muse_dispatch', { orderId: delegation?.orderId, confirmed: true, expectedReviewHash: delegation?.reviewHash }, '-dispatch'),
          makeCall('workspace_supplier_owner_publication_execute', { serviceId: supplier?.id, confirmed: true, approved: true }, '-publish'),
          makeCall('schedule_activate', { enabled: true, confirmed: true }, '-schedule')];
      }
      await save();
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      const chunk = (delta, finish = null) => res.write('data: ' + JSON.stringify({ id: 'synthetic-completion-' + report.requests, object: 'chat.completion.chunk', created: 1,
        model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
      chunk({ role: 'assistant', content: '' });
      if (calls.length) { chunk({ tool_calls: calls.map((call, index) => ({ index, ...call })) }); chunk({}, 'tool_calls'); }
      else { chunk({ content: final }); chunk({}, 'stop'); }
      res.end('data: [DONE]\n\n');
    } catch (error) {
      report.failure = error.message; await save();
      res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await mkdir(profileDirectory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(profileDirectory, 'models.json'), JSON.stringify({ providers: { 'synthetic-workspace': {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'SYNTHETIC-NONSECRET-TEST-MARKER',
    models: [{ id: 'deterministic-workspace', name: 'Synthetic deterministic provider (no model)', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 64000, maxTokens: 2048 }],
  } } }), { mode: 0o600 });
  await writeFile(path.join(profileDirectory, 'settings.json'), JSON.stringify({ defaultProvider: 'synthetic-workspace', defaultModel: 'deterministic-workspace', defaultThinkingLevel: 'off',
    compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off' }), { mode: 0o600 });
  await save();
  return { report, async close() { await new Promise(resolve => server.close(resolve)); } };
}
