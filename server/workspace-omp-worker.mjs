// Bun subprocess hosting the unmodified official OMP AgentSession. fd 3 is a
// bounded host transport, not an execution queue or business-record registry.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createWorkspaceOmpSession, OMP_ENGINE_SCOPE } from './workspace-omp-session.mjs';
const write = value => fs.writeSync(3, JSON.stringify(value) + '\n');
const input = createInterface({ input: fs.createReadStream(null, { fd: 3 }), crlfDelay: Infinity });
const pending = new Map(); let nextId = 1, created, running = false;
const request = (method, args = []) => new Promise((resolve, reject) => {
  const id = nextId++; pending.set(id, { resolve, reject }); write({ type: 'request', id, method, args });
});
const clientMethods = ['businessPresets', 'businessSubmit', 'businessTasks', 'businessStatus', 'businessResult'];
const client = Object.fromEntries(clientMethods.map(method => [method, (...args) => request(method, args.map(arg => arg instanceof AbortSignal ? null : arg))]));
async function start(config) {
  if (running) throw new Error('A worker hosts one official OMP turn only.'); running = true;
  created = await createWorkspaceOmpSession({ ...config, client, factoryTasks: true,
    authorize: () => request('authorize'), onModelRequest: event => request('modelRequest', [event]),
    onModelAbort: () => { if (config.syntheticResponses) write({ type: 'nativeModelAbort' }); } });
  created.session.subscribe(event => {
    if (['tool_execution_start', 'tool_execution_end'].includes(event.type)) write({ type: 'event', event: {
      type: event.type, toolName: event.toolName, toolCallId: event.toolCallId, isError: event.isError } });
  });
  // The official journal's missing-file fingerprint must remain intact.
  // Use its explicit persistence API; never write a fabricated/external header.
  await created.manager.ensureOnDisk(); await created.manager.flush();
  await request('saveSession', [{ engineScope: OMP_ENGINE_SCOPE, agentSessionId: created.manager.getSessionId(), sessionFile: created.manager.getSessionFile() }]);
  const startIndex = created.session.messages.length;
  await created.session.prompt(config.content, { expandPromptTemplates: false });
  await request('authorize'); await created.manager.flush();
  const messages = created.session.messages.slice(startIndex), last = messages.at(-1);
  if (last?.role !== 'assistant' || last.stopReason !== 'stop') throw new Error('The official OMP session did not produce a complete new answer.');
  const answers = messages.filter(row => row.role === 'assistant');
  const sum = key => answers.every(row => Number.isSafeInteger(row.usage?.[key]) && row.usage[key] >= 0) ? answers.reduce((n, row) => n + row.usage[key], 0) : null;
  if (sum('output') !== null && sum('output') > config.maxTokens) throw new Error('OMP exceeded the original reserved output allowance.');
  write({ type: 'result', result: { content: JSON.stringify({ done: true, content: created.session.getLastAssistantText() }),
    usage: { promptTokens: sum('input'), completionTokens: sum('output'), totalTokens: sum('totalTokens') },
    runtime: { kind: 'pi-durable', execution: 'agent-session', engine: 'omp', engineScope: OMP_ENGINE_SCOPE,
      agentSessionId: created.manager.getSessionId(), modelCalls: created.modelCalls(), originalRunId: config.runId } } });
  await created.close(); input.close(); process.exit(0);
}
input.on('line', line => {
  if (Buffer.byteLength(line) > 2_000_000) { process.exitCode = 1; input.close(); return; }
  let value; try { value = JSON.parse(line); } catch { process.exitCode = 1; input.close(); return; }
  if (value.type === 'reply') {
    const operation = pending.get(value.id); if (!operation) return; pending.delete(value.id);
    if (value.error) operation.reject(new Error(value.error)); else operation.resolve(value.result);
  } else if (value.type === 'abort') void created?.session.abort();
  else if (value.type === 'start') void start(value.config).catch(async error => {
    write({ type: 'error', error: 'The official OMP public session failed; no task completion or model fallback is implied.',
      ...(value.config.syntheticResponses ? { diagnostic: error.message } : {}) });
    await created?.close().catch(() => {}); process.exit(1);
  });
});
process.once('SIGTERM', () => void (async () => { await created?.session.abort(); await created?.close().catch(() => {}); process.exit(1); })());
