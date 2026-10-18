import { workspaceOmpConfiguration, workspaceOmpConfigured } from './workspace-omp-configuration.mjs';
import { existsSync } from 'node:fs';
import { createWorkspaceClient } from '../plugins/workspace-procurement/src/workspace.mjs';
import { createWorkspaceOmpEngineAdapter, workspaceOmpPaths } from './workspace-omp-bridge.mjs';

export { workspaceOmpConfiguration, workspaceOmpConfigured } from './workspace-omp-configuration.mjs';
export function workspaceOmpPublicToolConfiguration(environment = {}) {
  const searchProvider = environment.WORKSPACE_OMP_PUBLIC_SEARCH_PROVIDER || 'duckduckgo';
  if (!['duckduckgo', 'startpage', 'disabled'].includes(searchProvider)) throw new Error('Use one explicitly reviewed keyless public search provider.');
  let files = [];
  if (environment.WORKSPACE_OMP_PUBLIC_FILES_JSON) {
    try { files = JSON.parse(environment.WORKSPACE_OMP_PUBLIC_FILES_JSON); } catch { throw new Error('Public material selection must be exact JSON with IDs, paths and SHA256 pins.'); }
    if (!Array.isArray(files) || files.length > 8 || files.length && !environment.WORKSPACE_OMP_PUBLIC_DOCUMENT_ROOT) throw new Error('Public material selection requires a separate explicit public document root.');
  }
  const browserExecutable = environment.WORKSPACE_OMP_BROWSER_BIN === 'disabled' ? null
    : environment.WORKSPACE_OMP_BROWSER_BIN || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : null);
  return { searchProvider, browserExecutable, publicDocumentRoot: environment.WORKSPACE_OMP_PUBLIC_DOCUMENT_ROOT, files };
}
export function createWorkspaceOmpBusinessOptions({ environment = {}, baseURL, resolveReviewedBusinessBinding = null, paidAcceptance = null, modelBudget = null, pluginConfiguration = null } = {}) {
  const configuration = workspaceOmpConfiguration(environment), paths = workspaceOmpPaths(environment);
  const profile = environment.WORKSPACE_OMP_PROFILE || 'public';
  if (!['business', 'public', 'factory-materials', 'factory-customers', 'factory-inquiries', 'factory-ingestion', 'market-validation', 'shopify-product'].includes(profile)) throw Error('Use the fixed public or factory-materials OMP profile.');
  if (resolveReviewedBusinessBinding !== null && (profile !== 'business' || typeof resolveReviewedBusinessBinding !== 'function')) throw Error('Reviewed document bindings require the original business profile.');
  // Only narrow the original business plugin set. No alternate roots, loader
  // configurations, all-off mode or disabling the required Brain/Skill path.
  if (pluginConfiguration !== null && (profile !== 'business' || !pluginConfiguration
    || Object.keys(pluginConfiguration).join(',') !== 'disabled' || !Array.isArray(pluginConfiguration.disabled)
    || new Set(pluginConfiguration.disabled).size !== pluginConfiguration.disabled.length
    || pluginConfiguration.disabled.some(id => !['workspace-factory-materials','workspace-market-validation','workspace-shopify-product','workspace-medusa-catalog','workspace-marketplace'].includes(id))))
    throw Error('Reviewed business plugins accept only original optional-plugin disables; Brain and Skill remain required.');
  const selectedPlugins = pluginConfiguration === null ? {} : {disabled:[...pluginConfiguration.disabled]};
  const model = { provider: configuration.providerId, id: configuration.model, api: 'openai-completions', baseUrl: configuration.baseUrl };
  return { recipient: { kind: 'pi-coding-agent', provider: model.provider, model: model.id, destination: model.baseUrl },
    engineAdapter: createWorkspaceOmpEngineAdapter({ paths, configuration, nativeBusiness:profile==='business', paidAcceptance, modelBudget, pluginConfiguration:selectedPlugins, factoryMaterials: ['factory-materials', 'factory-inquiries', 'market-validation', 'shopify-product'].includes(profile), factoryInquiries: profile === 'factory-inquiries', factoryIngestion: profile === 'factory-ingestion', marketValidation: profile === 'market-validation', shopifyProduct: profile === 'shopify-product', factoryCustomers: profile === 'factory-customers', publicTools: workspaceOmpPublicToolConfiguration(environment), infrastructure: environment }),
    resolveBinding: async ({ actor, conversation, sessionReadonlyClient } = {}) => {
      if (!workspaceOmpConfigured(configuration)) return null;
      const client = environment.WS_AGENT_TOKEN ? createWorkspaceClient({ baseURL: environment.WS_AGENT_URL || baseURL, token: environment.WS_AGENT_TOKEN })
        : (profile === 'public' || resolveReviewedBusinessBinding) && sessionReadonlyClient ? sessionReadonlyClient(actor) : null;
      if (!client) return null;
      if (!resolveReviewedBusinessBinding) return { client, model };
      const selected = await resolveReviewedBusinessBinding({ actor, conversation, client, model: { ...model } });
      if (!selected || Object.keys(selected).some(key => !['enterpriseContextHost','brainMemoryFactKeys','brainDocumentTools'].includes(key))) throw Error('Use only the original reviewed document/fact capability.');
      return { ...selected, client, model };
    },
    resolveControlBinding: async ({ actor, sessionReadonlyClient } = {}) => environment.WS_AGENT_TOKEN ? {
      client: createWorkspaceClient({ baseURL: environment.WS_AGENT_URL || baseURL, token: environment.WS_AGENT_TOKEN }), model,
    } : sessionReadonlyClient ? { client: sessionReadonlyClient(actor), model } : null,
  };
}

// A private operator-supplied JSON file only assembles existing Host inputs.
// It is never read from HTTP/model content, and association is only narrowing.
export async function loadReviewedBusinessOptions(filename, environment = {}) {
  const [{ default: path }, { openPrivateFile }, { libraryReadHash: hash, libraryRecipientForModel }, { ApiError }] = await Promise.all([
    import('node:path'), import('./store.mjs'), import('./library-model-read-contract.mjs'), import('./runtime.mjs')]);
  const invalid = field => { throw Error('Reviewed business configuration requires ' + field + '; no private value was logged.'); };
  if (!path.isAbsolute(filename || '')) invalid('an absolute private configuration path');
  const file = await openPrivateFile(filename); let value;
  try { if ((await file.stat()).size > 128000) invalid('a bounded configuration'); value = JSON.parse(await file.readFile('utf8')); }
  catch { invalid('valid private JSON'); } finally { await file.close(); }
  if (!value || Object.keys(value).some(key => !['libraryModelReadPolicy','goalBrainOptions','selection','connection','parserTransfer','brainMemoryFactKeys','brainDocumentTools','paidAcceptance','modelBudget','pluginConfiguration'].includes(key))) invalid('only original Host input fields');
  const { libraryModelReadPolicy: policy, goalBrainOptions, selection, connection, parserTransfer } = value;
  if (!policy?.enabled || policy.reviewed !== true || !goalBrainOptions || !Array.isArray(goalBrainOptions.reviewedGoals)
    || selection?.enabled !== true || selection.reviewed !== true || !Array.isArray(selection.sources) || !selection.sources.length
    || selection.allowMemoryRead !== true || selection.allowMemoryWrite !== true || value.brainDocumentTools !== true
    || !Array.isArray(value.brainMemoryFactKeys) || !value.brainMemoryFactKeys.length) invalid('explicit Library, Goal, document and fact selections');
  if (!connection || Object.keys(connection).some(key => !['reviewed','baseURL','timeoutMs'].includes(key))
    || connection.reviewed !== true || !connection.baseURL || !environment.WORKSPACE_DOCLING_API_KEY) invalid('reviewed Docling connection and WORKSPACE_DOCLING_API_KEY');
  let destination; try { destination = new URL('/v1/convert/file', connection.baseURL).href; } catch { invalid('the original Docling destination'); }
  if (!parserTransfer || Object.keys(parserTransfer).sort().join(',') !== 'approved,purpose,recipient,transfer'
    || parserTransfer.approved !== true || parserTransfer.purpose !== 'document-extraction' || parserTransfer.transfer !== 'complete-file'
    || hash(parserTransfer.recipient) !== hash({ kind:'docling', destination })) invalid('explicit complete-file Docling transfer consent');
  const model = goalBrainOptions.originalReceiver;
  if (hash(libraryRecipientForModel(model)) !== hash(policy.recipient)) invalid('the same original model receiver');
  const pins = policy.factoryMaterials?.documents || [];
  for (const pin of selection.sources) if (!pins.some(row => row.id === pin.documentId && hash(row.asset) === hash(pin.asset))) invalid('exact reviewed document/version/SHA pins');
  return {
    libraryModelReadPolicy: policy, goalBrainOptions, ...(value.pluginConfiguration ? {pluginConfiguration:value.pluginConfiguration} : {}), ...(value.paidAcceptance ? { paidAcceptance:value.paidAcceptance } : {}), ...(value.modelBudget ? {modelBudget:value.modelBudget} : {}),
    resolveBinding: async ({ actor, conversation, model: receiver, enterpriseContextSessionBinding, conversationReferences }) => {
      if (actor.subject !== policy.subject || actor.workspaceId !== policy.workspaceId || hash(libraryRecipientForModel(receiver)) !== hash(policy.recipient)) throw new ApiError(403,'BUSINESS_AGENT_RECIPIENT_CHANGED','The existing member/model authorization does not cover this conversation.');
      const references = (await conversationReferences(conversation.id)).libraryReferences;
      const sources = selection.sources.filter(pin => {
        const approved = pins.find(row => row.id === pin.documentId && hash(row.asset) === hash(pin.asset));
        return references.documents.some(ref => ref.documentId === pin.documentId && ref.documentVersion === approved.documentVersion);
      });
      if (!sources.length) throw new ApiError(409,'BUSINESS_AGENT_DOCUMENT_SELECTION_REQUIRED','请先在新会话选择已由管理员审核的确切资料版本，再发送分析请求；资料关联不会自动创建授权。');
      const authorizeParserTransfer = async request => {
        request.signal?.throwIfAborted();
        const approved = pins.find(row => sources.some(pin => pin.documentId === row.id && hash(pin.asset) === hash(row.asset))
          && row.id === request.documentId && row.revision === request.documentRevision && row.documentVersion === request.documentVersion && hash(row.asset) === hash(request.target));
        return Boolean(approved && request.workspaceId === policy.workspaceId && request.subject === policy.subject
          && hash(libraryRecipientForModel(request.model)) === hash(policy.recipient)
          && hash(request.recipient) === hash(parserTransfer.recipient) && request.purpose === parserTransfer.purpose && request.transfer === parserTransfer.transfer);
      };
      return { enterpriseContextHost: await enterpriseContextSessionBinding({ recipient:policy.recipient,
        selection:{...selection,sources}, connection:{...connection,apiKey:environment.WORKSPACE_DOCLING_API_KEY}, authorizeParserTransfer }),
        brainMemoryFactKeys:value.brainMemoryFactKeys, brainDocumentTools:true };
    },
  };
}
