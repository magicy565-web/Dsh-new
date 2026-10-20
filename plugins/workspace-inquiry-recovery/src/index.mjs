// Harness plugin: historical inquiry recovery.
// The domain service stays in server/inquiry-recovery.mjs for P0; P1 extracts it
// into a package so this plugin owns no server/* import.
import { createInquiryRecoveryService, inquiryRecoveryHttp } from '../../../server/inquiry-recovery.mjs';
import { HarnessError, ERROR } from '../../../packages/harness-contracts/src/index.mjs';

const ROUTES = [
  ['GET', '/api/inquiry-recovery/status'],
  ['GET', '/api/inquiry-recovery/opportunities'],
  ['GET', '/api/inquiry-recovery/selections'],
  ['GET', '/api/inquiry-recovery/conflicts'],
  ['GET', '/api/inquiry-recovery/leads/:leadId'],
  ['POST', '/api/inquiry-recovery/import'],
  ['POST', '/api/inquiry-recovery/leads/:leadId/identity'],
  ['POST', '/api/inquiry-recovery/leads/:leadId/select'],
];

export async function apply(ctx, config = {}) {
  if (!ctx?.http?.route) throw new HarnessError(ERROR.pluginFailed, 'workspace-inquiries requires ctx.http.route.');
  if (!ctx?.storage?.read) throw new HarnessError(ERROR.pluginMissingDependency, 'workspace-inquiries requires ctx.storage.');
  if (!ctx?.tools?.register) throw new HarnessError(ERROR.pluginMissingDependency, 'workspace-inquiries requires ctx.tools.');
  if (config.staleDays !== undefined && (!Number.isInteger(config.staleDays) || config.staleDays < 1 || config.staleDays > 365))
    throw new HarnessError(ERROR.manifestInvalid, 'staleDays must be an integer between 1 and 365.');

  const recovery = createInquiryRecoveryService({
    store: ctx.storage,
    artifacts: config.artifacts ?? null,
    workspaceId: config.workspaceId ?? 'local',
    staleDays: config.staleDays ?? 7,
  });

  const handler = method => async (_req, _res, context) => {
    const result = await inquiryRecoveryHttp({
      recovery, method,
      pathname: context?.pathname ?? '',
      body: context?.body ?? {},
      query: context?.query ?? {},
      actor: context?.actor,
    });
    if (!result) throw new HarnessError(ERROR.pluginFailed, 'The inquiry recovery route did not match its own registration.');
    return result;
  };
  for (const [method, path] of ROUTES) ctx.http.route({ method, path, handler: handler(method) });

  ctx.tools.register({
    name: 'inquiry_recovery_status',
    description: 'Read the historical-inquiry recovery summary: lead counts by decision (follow_up / need_evidence / nurture / hold) and import/conflict counters. No customer data is returned.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    approval: 'never',
    readOnly: true,
    authority: 'workspace',
    handler: async (_args, execution) => {
      const status = recovery.status(execution?.actor);
      return { engineVersion: status.engineVersion, staleDays: status.staleDays, asOf: status.asOf, counts: status.counts };
    },
  });

  ctx.tools.register({
    name: 'inquiry_recovery_opportunities',
    description: 'List evidence-bound recovery opportunities as bounded cards: leadId, company, decision, days stale, missing items and the suggested next action. Full history and draft bodies are only available through the HTTP surface.',
    parameters: {
      type: 'object',
      properties: {
        asOf: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Evaluation date (YYYY-MM-DD); defaults to today.' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum cards to return; defaults to 10.' },
      },
      additionalProperties: false,
    },
    approval: 'never',
    readOnly: true,
    authority: 'workspace',
    handler: async (args, execution) => {
      const listing = recovery.opportunities({ asOfDate: args?.asOf }, execution?.actor);
      const limit = args?.limit ?? 10;
      return {
        asOf: listing.asOf, staleDays: listing.staleDays, summary: listing.summary,
        cards: listing.cards.slice(0, limit).map(card => ({
          leadId: card.leadId, company: card.company.name, product: card.request.product,
          decision: card.decision, daysStale: card.daysStale, reasons: card.reasons, missing: card.missing,
          nextStep: card.nextStep.action, draftReady: card.draft !== null,
        })),
        omitted: Math.max(0, listing.cards.length - limit),
      };
    },
  });

  if (ctx.health?.register) ctx.health.register('inquiries', () => {
    const status = recovery.status({ subject: 'health-probe', role: 'admin' });
    return { status: 'ok', detail: { leads: status.counts.leads, conflicts: status.counts.conflicts } };
  });

  return async () => {
    // The kernel removes the routes and tools registered by this plugin.
  };
}

export default { apply };
