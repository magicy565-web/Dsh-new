// A thin workflow over injected ORIGINAL capabilities. No search/browser/model
// execution engine, private Library reader, file store or credential discovery.
export const FACTORY_CUSTOMER_TOOLS = Object.freeze([
  'workspace_factory_customers_status', 'workspace_factory_customers_research', 'workspace_factory_customers_save',
]);
const searchTool = 'workspace_public_search', browserTool = 'workspace_public_browser';
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = maxLength => ({ type: 'string', minLength: 1, maxLength });
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const invalid = () => { throw new Error('Use only bounded explicitly public factory brief text and the exact documented selectors. Private Library receipts, assets, paths and authentication content are not admitted.'); };
function publicText(value, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum
    || /workspace-(?:factory-materials|library)|\b(?:authorization|scopeFingerprint|assets?|artifactId|artifactVersion|documentVersion|sessionFile|recipient|workspaceId|cookie|csrfToken|client_secret|api_key|access_token|refresh_token|password)\b\s*["']?\s*[:=]|\bBearer\s+|\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[baprs]-[A-Za-z0-9-]{10,}|\bAKIA[A-Z0-9]{16}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|file:\/\/|(?:^|[\s"'])(?:\/(?:tmp|home|root|workspace|etc|var)\/|[A-Za-z]:\\)/iu.test(value)) invalid();
  return value;
}
const sourceURL = value => {
  publicText(value, 2000); let url; try { url = new URL(value); } catch { invalid(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port || !url.hostname.includes('.')) invalid();
  return url.href;
};
const time = value => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) || !Number.isFinite(Date.parse(value))) invalid(); return value; };
const response = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], details: value,
  ...(['blocked', 'unavailable', 'unconfigured'].includes(value.status) ? { isError: true } : {}) });
const base = () => ({ plugin: 'workspace-factory-customers', audience: 'Chinese-factory',
  verifiedBuyer: false, purchasingIntentVerified: false, contactPermission: false, matchedCustomer: false,
  externalActions: false, privateLibrary: 'not-admitted', sources: [] });
const blocked = reason => response({ ...base(), status: 'blocked', reason });
const decode = result => {
  if (result?.details && typeof result.details === 'object') return result.details;
  try { return JSON.parse(result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')); }
  catch { throw new Error('The original public tool returned no structured receipt.'); }
};

export function factoryCustomersExtension({ client, authorize } = {}) {
  return pi => {
    const register = tool => pi.registerTool({ ...tool, async execute(...args) {
      try { return await tool.execute(...args); }
      catch { return blocked(args[2]?.aborted ? 'ORIGINAL_OPERATION_CANCELLED' : 'PUBLIC_INPUT_OR_ORIGINAL_HOST_OPERATION_REFUSED'); }
    } });
    const bound = typeof authorize === 'function' && typeof client?.status === 'function';
    async function authorized(signal, model) {
      try { signal?.throwIfAborted(); await authorize(signal, model); }
      catch { const error = new Error('Original Host authorization refused.'); error.code = 'ORIGINAL_AUTHORIZATION_REFUSED'; throw error; }
    }
    async function guarded(method, args, signal, model) {
      if (!model) throw new Error('The exact current official model receiver is required.');
      await authorized(signal, model);
      try { return await client[method](...args, signal, model); }
      finally { await authorized(signal, model); signal?.throwIfAborted(); }
    }
    async function capabilities(signal, model) {
      const value = await guarded('status', [], signal, model);
      if (!value || !Array.isArray(value.toolNames) || value.toolNames.some(name => typeof name !== 'string'))
        throw new Error('The original Host did not report its actual tool configuration.');
      return { toolNames: value.toolNames.filter(name => [searchTool, browserTool].includes(name)),
        businessSubmit: value.businessSubmit === true && typeof client.businessSubmit === 'function' };
    }
    register({ name: FACTORY_CUSTOMER_TOOLS[0], label: 'Factory customer research configuration',
      description: 'Report injected original public search/browser and factory-export save configuration. Configuration is not network observation, buyer verification, matching or contact permission.',
      parameters: schema({}),
      async execute(_id, input, signal, _update, ctx) {
        if (!exact(input, []) || Object.keys(input).length) invalid();
        if (!bound) return blocked('EXISTING_PUBLIC_HOST_CAPABILITIES_REQUIRED');
        const configured = await capabilities(signal, ctx?.model);
        return response({ ...base(), status: configured.toolNames.includes(searchTool) ? 'configured_unverified' : 'blocked',
          configuration: configured, observation: 'not-performed-by-status', onlineVerified: false });
      } });
    register({ name: FACTORY_CUSTOMER_TOOLS[1], label: 'Research public overseas customer source evidence',
      description: 'For a Chinese factory, use only injected original public search and optionally browser tools for public product/market evidence. Search hits are unverified candidate sources. Preserve URL, original tool and observation time; no private materials, contact scraping, invented buyer identity, purchasing intent or automatic matching.',
      parameters: schema({ product: string(1000), targetMarket: string(300), query: string(600),
        limit: { type: 'integer', minimum: 1, maximum: 2 }, inspectPages: { type: 'boolean' } }, ['product', 'targetMarket', 'query']),
      async execute(id, input, signal, _update, ctx) {
        if (!exact(input, ['product', 'targetMarket', 'query', 'limit', 'inspectPages'])) invalid();
        const publicBrief = { product: publicText(input.product, 1000), targetMarket: publicText(input.targetMarket, 300) };
        publicText(input.query, 600);
        if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 2)
          || input.inspectPages !== undefined && typeof input.inspectPages !== 'boolean') invalid();
        if (!bound || typeof client.invokeTool !== 'function') return blocked('EXISTING_PUBLIC_HOST_CAPABILITIES_REQUIRED');
        const configured = await capabilities(signal, ctx?.model);
        if (!configured.toolNames.includes(searchTool) || input.inspectPages && !configured.toolNames.includes(browserTool))
          return blocked('REQUESTED_ORIGINAL_PUBLIC_TOOL_NOT_CONFIGURED');
        const limit = input.limit ?? 2;
        const originalSearch = await guarded('invokeTool', [searchTool, { query: input.query, limit }], signal, ctx?.model);
        const found = decode(originalSearch);
        const nativeReceipts = [{ originalTool: searchTool, status: found.status,
          ...(found.failure ? { failure: publicText(found.failure, 200) } : {}), ...(Number.isInteger(found.httpStatus) ? { httpStatus: found.httpStatus } : {}) }];
        if (originalSearch.isError || !['sources_observed', 'empty'].includes(found.status))
          return response({ ...base(), status: 'blocked', reason: 'ORIGINAL_PUBLIC_SEARCH_UNAVAILABLE', researchCallId: id,
            publicBrief, nativeReceipts, inferences: [], missing: ['public-source-evidence'], facts: [] });
        if (!Array.isArray(found.sources) || found.sources.length > limit) throw new Error('Original public search exceeded its bounded source contract.');
        const sources = found.sources.map((source, index) => ({ id: `source-${index + 1}`, url: sourceURL(source.url),
          title: publicText(source.title, 400), excerpt: source.excerpt ? publicText(source.excerpt, 6000) : '',
          observedAt: time(found.observedAt), originalTool: searchTool, provenance: 'public-web-unverified' }));
        const facts = sources.map(source => ({ sourceId: source.id, reportedTitle: source.title, reportedText: source.excerpt,
          meaning: 'source-reported-text-only' }));
        let partial = false;
        if (input.inspectPages) for (const source of sources) {
          let originalPage;
          try { originalPage = await guarded('invokeTool', [browserTool, { url: source.url }], signal, ctx?.model); }
          catch (error) {
            if (error.code === 'ORIGINAL_AUTHORIZATION_REFUSED' || signal?.aborted) throw error;
            partial = true; nativeReceipts.push({ originalTool: browserTool, sourceId: source.id, status: 'unavailable', failure: 'ORIGINAL_PAGE_UNAVAILABLE' }); continue;
          }
          const page = decode(originalPage);
          const observation = { originalTool: browserTool, sourceId: source.id, status: page.status,
            ...(Number.isInteger(page.httpStatus) ? { httpStatus: page.httpStatus } : {}), ...(page.failure ? { failure: publicText(page.failure, 200) } : {}) };
          nativeReceipts.push(observation);
          if (originalPage.isError || page.status !== 'page_observed') { partial = true; continue; }
          const pageURL = sourceURL(page.url);
          if (new URL(pageURL).hostname !== new URL(source.url).hostname) throw new Error('The original browser receipt left its selected source hostname.');
          const pageText = page.excerpt ? publicText(page.excerpt, 12000) : '';
          // Browser observations augment a source, never mint a buyer.
          source.page = { url: pageURL, observedAt: time(page.observedAt), originalTool: browserTool, excerpt: pageText };
          facts.push({ sourceId: source.id, reportedText: pageText, meaning: 'source-reported-page-text-only' });
        }
        return response({ ...base(), sources, status: partial ? 'partial' : sources.length ? 'available' : 'empty',
          researchCallId: id, publicBrief, query: input.query, nativeReceipts, facts, inferences: [],
          matchEvidence: sources.map(source => ({ sourceId: source.id, productInput: publicBrief.product, assessment: 'pending-human-review' })),
          missing: ['buyer-identity', 'purchasing-intent', 'contact-permission', 'factory-product-fit', 'commercial-terms'],
          saved: false, detail: 'Public source evidence only. No customer has been matched, verified or contacted.' });
      } });
    register({ name: FACTORY_CUSTOMER_TOOLS[2], label: 'Save original factory export evidence documents',
      description: 'Only when the user requests saving, submit the existing factory-export preset with a same-transcript public research receipt. Stable requestId required. Original Host business-submit/budget/approval gates remain authoritative. No new store, sending, orders or contacts.',
      parameters: schema({ title: string(200), product: string(1000), spec: string(2000), targetMarket: string(300), researchCallId: string(200), requestId: string(128) },
        ['title', 'product', 'spec', 'targetMarket', 'researchCallId', 'requestId']),
      async execute(_id, input, signal, _update, ctx) {
        if (!exact(input, ['title', 'product', 'spec', 'targetMarket', 'researchCallId', 'requestId'])) invalid();
        for (const [key, maximum] of Object.entries({ title: 200, product: 1000, spec: 2000, targetMarket: 300, researchCallId: 200, requestId: 128 })) publicText(input[key], maximum);
        if (!bound) return blocked('EXISTING_PUBLIC_HOST_CAPABILITIES_REQUIRED');
        const configured = await capabilities(signal, ctx?.model);
        if (!configured.businessSubmit) return blocked('ORIGINAL_BUSINESS_SUBMIT_NOT_ENABLED');
        const entries = ctx?.sessionManager?.getEntries?.();
        const entry = Array.isArray(entries) && entries.findLast(row => row.message?.role === 'toolResult'
          && row.message.toolName === FACTORY_CUSTOMER_TOOLS[1] && row.message.toolCallId === input.researchCallId);
        if (!entry || entry.message.isError) return blocked('ORIGINAL_SAME_TRANSCRIPT_RESEARCH_RECEIPT_REQUIRED');
        let evidence; try { evidence = JSON.parse(entry.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')); } catch { return blocked('ORIGINAL_RESEARCH_RECEIPT_INVALID'); }
        if (evidence.plugin !== 'workspace-factory-customers' || !['available', 'partial'].includes(evidence.status)
          || evidence.researchCallId !== input.researchCallId || evidence.publicBrief?.product !== input.product
          || evidence.publicBrief?.targetMarket !== input.targetMarket || !Array.isArray(evidence.sources) || evidence.sources.length < 1 || evidence.sources.length > 2)
          return blocked('ORIGINAL_RESEARCH_RECEIPT_INVALID');
        // Rebuild public evidence from exact original receipts. Arbitrary input
        // objects, private authorization payloads and model claims are not saved.
        if (evidence.sources.some(source => source.originalTool !== searchTool || source.page && source.page.originalTool !== browserTool))
          return blocked('ORIGINAL_RESEARCH_SOURCE_TOOL_CHANGED');
        const sources = evidence.sources.map(source => ({ id: publicText(source.id, 100), url: sourceURL(source.url), title: publicText(source.title, 400),
          excerpt: source.excerpt ? publicText(source.excerpt, 6000) : '', observedAt: time(source.observedAt), originalTool: searchTool,
          ...(source.page ? { page: { url: sourceURL(source.page.url), observedAt: time(source.page.observedAt), originalTool: browserTool,
            excerpt: source.page.excerpt ? publicText(source.page.excerpt, 12000) : '' } } : {}) }));
        const saved = await guarded('businessSubmit', [{ type: 'factory-export', title: input.title, requestId: input.requestId,
          input: { product: input.product, spec: input.spec, target_market: input.targetMarket,
            customer_materials: JSON.stringify({ provenance: 'original-public-tool-receipts-unverified', researchCallId: input.researchCallId, sources,
              matchedCustomer: false, verifiedBuyer: false, purchasingIntentVerified: false, contactPermission: false,
              missing: ['buyer-identity', 'purchasing-intent', 'contact-permission', 'factory-product-fit', 'commercial-terms'] }) } }], signal, ctx?.model);
        return response({ ...base(), status: saved?.task?.taskId ? 'submitted' : 'blocked',
          originalReceipt: saved, researchCallId: input.researchCallId,
          detail: 'Only the original factory-export document task was requested. Document completion is not buyer verification, contact approval or a business outcome.' });
      } });
  };
}
export default function extension(pi) { return factoryCustomersExtension()(pi); }
