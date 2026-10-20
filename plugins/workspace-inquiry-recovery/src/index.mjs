// Harness plugin: historical inquiry recovery.
// The domain lives in packages/domain-inquiry-recovery; this plugin only wires
// seams (storage/artifacts/tools/approval) and HTTP routes.
import { randomUUID } from 'node:crypto';
import { createInquiryRecoveryService, inquiryRecoveryHttp } from '../../../packages/domain-inquiry-recovery/src/index.mjs';
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

// Mutating business actions that are recorded in ctx.audit (metadata only).
const AUDITED_ACTIONS = new Map([
  ['POST /api/inquiry-recovery/import', 'import'],
  ['POST /api/inquiry-recovery/leads/:leadId/identity', 'identity-review'],
  ['POST /api/inquiry-recovery/leads/:leadId/select', 'select'],
]);

export async function apply(ctx, config = {}) {
  if (!ctx?.http?.route) throw new HarnessError(ERROR.pluginFailed, 'workspace-inquiries requires ctx.http.route.');
  if (!ctx?.storage?.read) throw new HarnessError(ERROR.pluginMissingDependency, 'workspace-inquiries requires ctx.storage.');
  if (!ctx?.tools?.register) throw new HarnessError(ERROR.pluginMissingDependency, 'workspace-inquiries requires ctx.tools.');
  if (config.staleDays !== undefined && (!Number.isInteger(config.staleDays) || config.staleDays < 1 || config.staleDays > 365))
    throw new HarnessError(ERROR.manifestInvalid, 'staleDays must be an integer between 1 and 365.');

  const recovery = createInquiryRecoveryService({
    store: ctx.storage,
    artifacts: ctx.artifacts ?? config.artifacts ?? null,
    workspaceId: config.workspaceId ?? 'local',
    staleDays: config.staleDays ?? 7,
  });

  // ctx.audit is optional: when it is mounted the plugin records metadata-only
  // business events (never message bodies) and serves a read-only audit route.
  const audit = () => {
    try { return ctx.reflect?.get?.('audit', false) ?? null; } catch { return null; }
  };
  const recordInquiryAudit = async (method, registeredPath, result, context) => {
    const service = audit();
    if (!service) return;
    const action = AUDITED_ACTIONS.get(`${method} ${registeredPath}`);
    if (!action) return;
    const status = result?.status ?? 200;
    if (status >= 400) return;
    const params = context?.params ?? {};
    const body = result?.body ?? {};
    const detail = { status };
    if (typeof params.leadId === 'string') detail.leadId = params.leadId;
    if (action === 'import' && typeof body.requestId === 'string') detail.requestId = body.requestId;
    if (action === 'select' && typeof body.selectionId === 'string') detail.selectionId = body.selectionId;
    try {
      await service.record({
        kind: 'inquiry', action, actor: context?.actor ?? null, ok: true,
        ref: typeof params.leadId === 'string' ? params.leadId : (typeof body.requestId === 'string' ? body.requestId : null),
        detail,
      });
    } catch {
      // Audit must never fail a business request; the seam logs nothing here.
    }
  };

  // ctx.workspace is optional: when it is mounted every route resolves the actor's
  // membership first, so a non-member of the configured tenant is refused with 403
  // instead of reading another workspace's inquiry data.
  const workspace = () => {
    try { return ctx.reflect?.get?.('workspace', false) ?? null; } catch { return null; }
  };
  const authorize = actor => {
    const service = workspace();
    if (!service) return;
    service.resolve(actor, config.workspaceId ? { workspaceId: config.workspaceId } : {});
  };

  const handler = (method, registeredPath) => async (_req, _res, context) => {
    authorize(context?.actor);
    const result = await inquiryRecoveryHttp({
      recovery, method,
      pathname: context?.pathname ?? '',
      body: context?.body ?? {},
      query: context?.query ?? {},
      actor: context?.actor,
    });
    if (!result) throw new HarnessError(ERROR.pluginFailed, 'The inquiry recovery route did not match its own registration.');
    await recordInquiryAudit(method, registeredPath, result, context);
    return result;
  };
  for (const [method, path] of ROUTES) ctx.http.route({ method, path, handler: handler(method, path) });

  // Approval surface for the single write tool. A ticket is one-shot, actor-bound
  // and expires; the tools seam consumes it before the handler runs.
  const APPROVABLE = new Set(['inquiry_recovery_select']);
  ctx.http.route({
    method: 'POST', path: '/api/inquiry-recovery/approvals',
    handler: async (_req, _res, context) => {
      const body = context?.body ?? {};
      if (!APPROVABLE.has(body.tool)) throw new HarnessError(ERROR.toolRefused, `Tool ${JSON.stringify(body.tool)} is not approvable here.`);
      const request = await ctx.approval.request({ actor: context.actor, tool: body.tool, args: body.args ?? {}, reason: body.reason ?? '' });
      return { status: 201, body: { id: request.id, status: request.status, expiresAt: request.expiresAt ?? null } };
    },
  });
  ctx.http.route({
    method: 'POST', path: '/api/inquiry-recovery/approvals/:approvalId/decide',
    handler: async (_req, _res, context) => {
      const decision = context?.body?.decision;
      if (!['approve', 'deny'].includes(decision)) throw new HarnessError(ERROR.toolRefused, 'decision must be approve or deny.');
      const result = await ctx.approval.decide(context.params.approvalId, decision, context.actor);
      return { status: 200, body: { id: result.id, status: result.status } };
    },
  });
  ctx.http.route({
    method: 'GET', path: '/api/inquiry-recovery/approvals',
    handler: async (_req, _res, context) => ({ status: 200, body: { approvals: ctx.approval.list({ status: context?.query?.status }) } }),
  });

  // Read-only audit trail for this plugin's business events. Requires the audit
  // seam; metadata only, so no draft or message content can be served here.
  ctx.http.route({
    method: 'GET', path: '/api/inquiry-recovery/audit',
    handler: async (_req, _res, context) => {
      const service = audit();
      if (!service) throw new HarnessError(ERROR.pluginMissingDependency, 'ctx.audit is not mounted; the audit trail is unavailable in this composition.');
      if (context?.actor?.role !== 'admin') throw new HarnessError(ERROR.toolRefused, 'admin role is required to read the inquiry audit trail.');
      const limit = context?.query?.limit === undefined ? 100 : Number(context.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new HarnessError(ERROR.toolInvalid, 'limit must be an integer between 1 and 200.');
      return { status: 200, body: { events: service.list({ kind: 'inquiry', limit }), total: service.summary().byKind.inquiry ?? 0 } };
    },
  });

  ctx.tools.register({
    name: 'inquiry_recovery_status',
    description: 'Read the historical-inquiry recovery summary: lead counts by decision (follow_up / need_evidence / nurture / hold) and import/conflict counters. No customer data is returned.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    approval: 'never',
    readOnly: true,
    authority: 'workspace',
    handler: async (_args, execution) => {
      authorize(execution?.actor);
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
      authorize(execution?.actor);
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

  ctx.tools.register({
    name: 'inquiry_recovery_select',
    description: 'Produce an unsent follow-up draft and a non-enabled Goal draft for one stale, evidence-complete lead. Requires a one-shot approval ticket for this exact tool; nothing is sent, priced or enabled.',
    parameters: {
      type: 'object',
      properties: {
        leadId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$', description: 'Imported lead to select.' },
        expectedRevision: { type: 'integer', minimum: 1, description: 'Revision returned by the opportunities tool; a stale value is refused.' },
        sourceHash: { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'sourceHash returned for that revision.' },
        asOf: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Evaluation date; defaults to today.' },
      },
      required: ['leadId', 'expectedRevision', 'sourceHash'],
      additionalProperties: false,
    },
    approval: 'always',
    authority: 'workspace',
    handler: async (args, execution) => {
      authorize(execution?.actor);
      const selection = await recovery.selectLead(args.leadId, {
        requestId: randomUUID(), expectedRevision: args.expectedRevision, sourceHash: args.sourceHash, asOf: args.asOf,
      }, execution.actor);
      return {
        selectionId: selection.id, leadId: selection.leadId, decision: selection.decision, daysStale: selection.daysStale,
        draft: { filename: selection.draft.filename, sha256: selection.draft.sha256, sent: false, humanReviewRequired: true, humanReviewed: false },
        artifact: selection.artifact,
        goalDraft: { title: selection.goalDraft.title, enabled: false, notWritten: true },
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
