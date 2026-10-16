import { TradeError, createTenderClient, createErpNextClient, prepareQuotation, validateTenderInput, validateErpRead,
  TENDER_INPUT, ERP_READ_INPUT, QUOTATION_INPUT } from './free-trade.mjs';
import {registerNativeTrade} from './native-host.mjs';
function frozen(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
const EMPTY = { type: 'object', properties: {}, additionalProperties: false };
/** Ordinary install: public tender search + supplied-field quote preparation. No private binding. */
export function freeTradeExtension({ tenders = createTenderClient(), erp = createErpNextClient(), authorize, enterprise = false } = {}) {
  return pi => {
    const definitions = [
      { name: 'workspace_free_trade_status', label: 'Free trade capabilities', parameters: EMPTY,
        description: 'Report configured/unconfigured adapters, not verified connectivity or completed business work.',
        run: async () => ({ status: 'ok', tenderSources: tenders.status(), erpnext: erp.status(), mode: enterprise ? 'enterprise-controlled' : 'public-only', externalWrites: false }) },
      { name: 'workspace_tender_search', label: 'Discover public procurement opportunities', parameters: TENDER_INPUT,
        description: 'Search ONE page of official EU TED (expert query, page starts at 1) or SAM.gov (postedFrom/postedTo YYYY-MM-DD, pageIndex starts at 0). Use only public product terms, never private customer/pricing data. No auto pagination, outreach, qualification or bid submission. Published awards are not open buying demand.',
        validate: validateTenderInput, run: (input, signal) => tenders.search(input, signal) },
      { name: 'workspace_erpnext_read', label: 'Read authorized ERPNext commercial record', parameters: ERP_READ_INPUT,
        description: 'Read one exact Quotation, Sales Order, Sales Partner or Item Price and selected allowed fields. Requires original reviewed enterprise binding and exact receiver. No wildcard read, new ERP, pricing engine or external writes.',
        private: true, validate: validateErpRead, run: (input, signal, ctx) => erp.read(input, signal, ctx.model) },
      { name: 'workspace_erpnext_prepare_quotation', label: 'Prepare unreviewed ERPNext quotation data', parameters: QUOTATION_INPUT,
        description: 'Map explicitly supplied customer, company, currency, dates, SKU quantities/rates/UOM to a Quotation draft payload. No default prices, tax calculation, persistence, approval, submit, email or order. Missing commercial terms must be requested, not invented.',
        validate: input => { prepareQuotation(input); return frozen(structuredClone(input)); },
        run: async input => prepareQuotation(input) }
    ];
    for (const definition of definitions) pi.registerTool({ name: definition.name, label: definition.label, description: definition.description,
      parameters: definition.parameters, approval: 'read', async execute(_id, raw, signal, _update, ctx) {
        let value; let phase = 'input';
        try {
          signal?.throwIfAborted();
          const input = definition.validate ? definition.validate(raw) : raw;
          if (definition.name === 'workspace_free_trade_status' && (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length)) throw new TradeError('INPUT_INVALID');
          const protectedCall = (enterprise || definition.private) && definition.name !== 'workspace_free_trade_status';
          async function check() {
            if (!protectedCall) return;
            phase = 'authorization';
            if (typeof authorize !== 'function') throw new TradeError('ORIGINAL_REVIEWED_HOST_REQUIRED', 'unconfigured');
            if (!ctx?.model) throw new TradeError('EXACT_MODEL_RECEIVER_REQUIRED');
            if (await authorize({ tool: definition.name, input }, signal, ctx.model) !== true) throw new TradeError('ORIGINAL_AUTHORIZATION_REFUSED');
            signal?.throwIfAborted();
          }
          await check(); phase = 'operation'; value = await definition.run(input, signal, ctx);
          await check(); signal?.throwIfAborted();
        } catch (error) {
          value = { status: error instanceof TradeError ? error.status : 'blocked',
            reason: signal?.aborted ? 'OPERATION_CANCELLED' : error instanceof TradeError ? error.code : phase === 'authorization' ? 'ORIGINAL_AUTHORIZATION_REFUSED' : 'ADAPTER_OPERATION_FAILED',
            ...(error instanceof TradeError && error.retryAfterSeconds !== null ? { retryAfterSeconds: error.retryAfterSeconds } : {}), externalWrites: false };
        }
        const receipt = { plugin: 'workspace-free-trade', ...value };
        const encoded = JSON.stringify(receipt);
        if (Buffer.byteLength(encoded) > 65536) {
          const blocked = { plugin: 'workspace-free-trade', status: 'blocked', reason: 'TOOL_OUTPUT_TOO_LARGE', externalWrites: false };
          return { content: [{ type: 'text', text: JSON.stringify(blocked) }], details: blocked, isError: true };
        }
        return { content: [{ type: 'text', text: encoded }], details: receipt,
          ...(['blocked','unavailable','unconfigured'].includes(receipt.status) ? { isError: true } : {}) };
      } });
  };
}
export default async function extension(pi) {
  let host;pi.events?.emit('workspace:plugin-host',{accept:value=>{host=value;}});
  return registerNativeTrade(pi,host,freeTradeExtension);
}
