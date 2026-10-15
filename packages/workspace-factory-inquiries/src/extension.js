// The existing Host alone owns Session projection, exact source replay, artifact
// saving, permissions and cached-context reauthorization. No ambient discovery.
export const FACTORY_INQUIRY_TOOLS = Object.freeze(['workspace_factory_inquiry_prepare', 'workspace_factory_inquiry_save']);
const uuidPattern = '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$';
const uuid = value => typeof value === 'string' && new RegExp(uuidPattern).test(value);
const requirementFields = ['product', 'spec', 'quantity', 'targetMarket', 'requestedDelivery', 'requirements'];
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const properties = {
  inquiryDocumentId: { type: 'string', pattern: uuidPattern }, documentVersion: { type: 'integer', minimum: 1, maximum: 100 },
  productId: { type: 'string', pattern: uuidPattern }, requirements: object(Object.fromEntries(requirementFields.map(key => [key, { anyOf: [{ type: 'null' }, { type: 'string', maxLength: 1000 }] }]))),
};
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const gap = (status, reason) => ({ plugin: 'workspace-factory-inquiries', status, reason, sources: [], humanReviewRequired: true, sent: false });
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], details: value,
  ...(value.isError === true || ['blocked', 'unavailable'].includes(value.status) ? { isError: true } : {}) });
function valid(input, save) {
  if (!exact(input, [...Object.keys(properties), ...(save ? ['requestId', 'expectedDraftHash'] : [])])
    || !uuid(input.inquiryDocumentId) || !uuid(input.productId) || !Number.isInteger(input.documentVersion) || input.documentVersion < 1 || input.documentVersion > 100
    || !exact(input.requirements, requirementFields) || Object.values(input.requirements).some(value => value !== null && (typeof value !== 'string' || value.length > 1000))
    || save && (typeof input.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(input.requestId)
      || !/^[a-f0-9]{64}$/u.test(input.expectedDraftHash || '')))
    throw new Error('Use only exact original identifiers, bounded source excerpts and an unchanged exact draft hash; model arguments cannot approve drafts.');
}
export function factoryInquiriesExtension({ client, authorize } = {}) {
  return pi => {
    const configured = typeof authorize === 'function' && typeof client?.prepare === 'function' && typeof client?.save === 'function';
    const register = (method, tool) => pi.registerTool({ ...tool, async execute(_id, input, signal, _update, ctx) {
      try {
        valid(input, method === 'save');
        if (!configured) return result(gap('unconfigured', 'ORIGINAL_REVIEWED_SESSION_CLIENT_REQUIRED'));
        const model = ctx?.model; if (!model) throw new Error('Exact current model receiver required.');
        signal?.throwIfAborted(); await authorize(signal, model);
        let receipt;
        try { receipt = await client[method](input, signal, model); }
        finally { await authorize(signal, model); signal?.throwIfAborted(); }
        if (receipt?.plugin !== 'workspace-factory-inquiries' || !['available', 'partial', 'empty', 'blocked', 'unconfigured', 'unavailable', 'saved-draft'].includes(receipt.status))
          throw new Error('Original inquiry receipt unavailable.');
        return result(receipt);
      } catch { return result(gap('blocked', 'ORIGINAL_INQUIRY_OPERATION_REFUSED')); }
    } });
    register('prepare', { name: FACTORY_INQUIRY_TOOLS[0], label: 'Prepare source-bound factory inquiry review drafts',
      description: 'Read only Host-approved exact inquiry/product projections and prepare unsaved quotation, sample and follow-up review drafts. Requirement text must occur exactly in the original inquiry. Unknown prices, samples and commitments stay pending; no external contact or inferred sender.',
      parameters: object(properties, Object.keys(properties)) });
    register('save', { name: FACTORY_INQUIRY_TOOLS[1], label: 'Save unreviewed original inquiry drafts',
      description: 'Save only through the original Host Session/artifact authority after fresh exact source replay and expectedDraftHash comparison. Requires original execution intent, a stable requestId and an unchanged hash. This only saves unreviewed drafts: no human approval, sending, external actions or new permissions.',
      parameters: object({ ...properties, requestId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' },
        expectedDraftHash: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
      [...Object.keys(properties), 'requestId', 'expectedDraftHash']) });
  };
}
export default function extension(pi) { return factoryInquiriesExtension()(pi); }
