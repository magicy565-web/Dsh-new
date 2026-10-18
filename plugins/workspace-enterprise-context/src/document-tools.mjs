// Narrow composition of the existing enterprise tools for a new business
// Session. No profile, ledger, grant, receipt refresh or restoration path.
import { isDeepStrictEqual as equal } from 'node:util';
import { enterpriseContextMessagePairs } from './native-host.mjs';

export const NATIVE_DOCUMENT_METHODS = Object.freeze(['parseUpload', 'structuredMemoryLookup', 'structuredMemoryRemember']);
export const NATIVE_DOCUMENT_TOOLS = Object.freeze(NATIVE_DOCUMENT_METHODS.map(method =>
  'workspace_enterprise_context_' + method.replace(/[A-Z]/g, c => '_' + c.toLowerCase())));
const refuse = () => { throw Object.assign(Error('OSS_NATIVE_DOCUMENT_RECEIPT_REFUSED'), { code: 'OSS_NATIVE_DOCUMENT_RECEIPT_REFUSED' }); };
const query = value => Object.fromEntries(['subjectType', 'subjectId', 'factKey'].map(key => [key, value?.[key]]));

export function nativeDocumentReceiptRows(messages) {
  if (!Array.isArray(messages)) refuse();
  const paired = new Map(enterpriseContextMessagePairs(messages).map(row => [row.result, row.call]));
  const rows = [];
  for (const message of messages) {
    if (message?.role !== 'toolResult') continue;
    const named = message.toolName?.startsWith('workspace_enterprise_context_');
    if (!named && message.details?.plugin !== 'workspace-enterprise-context-oss') continue;
    const call = paired.get(message), receipt = message.details;
    if (!named || !NATIVE_DOCUMENT_TOOLS.includes(message.toolName) || !call
      || message.content?.length !== 1 || message.content[0].type !== 'text'
      || message.content[0].text !== JSON.stringify(receipt)
      || receipt?.plugin !== 'workspace-enterprise-context-oss' || receipt.visibility !== 'internal'
      || receipt.canonicalFacts !== 'Workspace Library' || receipt.externalActions !== false) refuse();
    const args = { ...call.arguments }; delete args.i;
    if (message.isError) {
      if (!['blocked', 'unconfigured', 'unavailable'].includes(receipt.status)
        || !/^[A-Z][A-Z0-9_]{0,80}$/.test(receipt.reason || '')
        || Object.keys(receipt).some(key => !['plugin', 'visibility', 'canonicalFacts', 'externalActions', 'status', 'reason'].includes(key))) refuse();
    } else {
      const proof = receipt.authorization;
      const method = proof?.kind === 'parse' ? 'parseUpload' : proof?.kind === 'memory' ? proof.operation : null;
      if (!NATIVE_DOCUMENT_METHODS.includes(method)
        || call.name !== 'workspace_enterprise_context_' + method.replace(/[A-Z]/g, c => '_' + c.toLowerCase())) refuse();
      const expected = method === 'parseUpload' ? proof.source?.asset
        : { ...proof.query, ...(method === 'structuredMemoryRemember' ? { statement: proof.statement } : {}) };
      if (!equal(args, expected)) refuse();
    }
    rows.push({ message, receipt, args });
  }
  return rows;
}

function assertWire(rows, wireBody) {
  if (wireBody === undefined) return;
  let body; try { body = JSON.parse(wireBody); } catch { refuse(); }
  if (!Array.isArray(body.messages)) refuse();
  const calls = new Map();
  for (const message of body.messages) {
    if (message.role === 'assistant') for (const call of message.tool_calls || []) {
      if (!call.id || calls.has(call.id)) refuse();
      calls.set(call.id, call);
    }
    if (message.role !== 'tool') continue;
    const call = calls.get(message.tool_call_id); calls.delete(message.tool_call_id);
    let receipt; try { receipt = JSON.parse(message.content); } catch {
      if (call?.function?.name?.startsWith('workspace_enterprise_context_')) refuse();
      continue;
    }
    if (!call?.function?.name?.startsWith('workspace_enterprise_context_') && receipt?.plugin !== 'workspace-enterprise-context-oss') continue;
    let args; try { args = JSON.parse(call.function.arguments); } catch { refuse(); }
    if (!args || typeof args !== 'object' || Array.isArray(args)) refuse(); delete args.i;
    if (!rows.some(row => row.message.toolCallId === message.tool_call_id && row.message.toolName === call.function.name
      && equal(row.args, args) && equal(row.receipt, receipt))) refuse();
  }
}

export function createNativeDocumentTools(control, exactQueries, describe = null) {
  const queries = structuredClone(exactQueries);
  const selected = input => { if (!queries.some(row => equal(row, query(input)))) refuse(); };
  const result = {
    async describe(signal, model) {
      if (typeof describe !== 'function') refuse();
      const metadata = await describe(signal, model);
      control.assertDisclosureCurrent({ messages: [], context: [] }, model, signal);
      return { ...metadata, queries: structuredClone(queries) };
    },
    ...Object.fromEntries(NATIVE_DOCUMENT_METHODS.map(method => [method, async (input, signal, model) => {
      const keys = method === 'parseUpload' ? ['artifactId', 'version', 'sha256']
        : ['subjectType', 'subjectId', 'factKey', ...(method === 'structuredMemoryRemember' ? ['statement'] : [])];
      if (!input || Object.keys(input).sort().join(',') !== keys.sort().join(',')) refuse();
      if (method !== 'parseUpload') selected(input);
      return control[method](input, signal, model);
    }])),
    async revalidate(messages, signal, model) {
      for (const { message, receipt } of nativeDocumentReceiptRows(messages)) {
        signal?.throwIfAborted();
        if (message.isError) continue;
        if (receipt.authorization.kind === 'memory') selected(receipt.authorization.query);
        control.verifyBody(receipt.authorization, receipt);
        await control.check(receipt.authorization, signal, model);
      }
      result.assertDisclosureCurrent({ messages, context: messages }, model, signal);
    },
    assertDisclosureCurrent(payload, model, signal) {
      const rows = [...nativeDocumentReceiptRows(payload.messages || []), ...nativeDocumentReceiptRows(payload.context || [])];
      for (const { message, receipt } of rows) if (!message.isError && receipt.authorization.kind === 'memory') selected(receipt.authorization.query);
      control.assertDisclosureCurrent(payload, model, signal);
      assertWire(rows, payload.wireBody);
      signal?.throwIfAborted();
      return true;
    },
  };
  return Object.freeze(result);
}
