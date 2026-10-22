// Purchase orders: a commitment, so approval is a separate, administrator-only step.
//
// Money is integer minor units; the server computes totals. The model may draft
// an order (behind a tool approval), but it can never approve one: approval is
// an administrator action over HTTP only.
import { randomUUID } from 'node:crypto';

export const PO_STATE_VERSION = 1;
export const STATE_KEY = 'harnessPurchaseOrders';

export const PO_STATUSES = Object.freeze(['draft', 'approved', 'ordered', 'received', 'cancelled']);
const TRANSITIONS = Object.freeze({
  draft: Object.freeze(['approved', 'cancelled']),
  approved: Object.freeze(['ordered', 'cancelled']),
  ordered: Object.freeze(['received', 'cancelled']),
  received: Object.freeze([]),
  cancelled: Object.freeze([]),
});
const ADMIN_ONLY = new Set(['approved']);

export const PO_LIMITS = Object.freeze({ orders: 2_000, lines: 50, supplier: 200, note: 2_000, description: 300 });

export class PurchaseError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'PurchaseError';
    this.status = status;
    this.code = code;
  }
}

const fail = (status, code, message) => { throw new PurchaseError(status, code, message); };
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const isIso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

const defaultState = () => ({ version: PO_STATE_VERSION, orders: [] });

function validateState(value) {
  if (!isPlain(value) || value.version !== PO_STATE_VERSION || !Array.isArray(value.orders)
    || value.orders.length > PO_LIMITS.orders)
    fail(500, 'PURCHASE_INVALID', 'Stored purchase orders are invalid or full.');
  const ids = new Set();
  for (const order of value.orders) {
    if (!isPlain(order) || !UUID.test(order.id ?? '') || typeof order.workspaceId !== 'string' || !order.workspaceId
      || typeof order.number !== 'string' || !order.number
      || typeof order.supplier !== 'string' || !order.supplier
      || typeof order.currency !== 'string' || !/^[A-Z]{3}$/u.test(order.currency)
      || !PO_STATUSES.includes(order.status)
      || !Array.isArray(order.lines) || order.lines.length === 0 || order.lines.length > PO_LIMITS.lines
      || !Number.isSafeInteger(order.totalMinor) || order.totalMinor < 0
      || !isIso(order.createdAt) || !isIso(order.updatedAt)
      || typeof order.createdBy !== 'string' || !order.createdBy)
      fail(500, 'PURCHASE_INVALID', 'Stored purchase order is invalid.');
    if (ids.has(order.id)) fail(500, 'PURCHASE_INVALID', 'Duplicate purchase order id.');
    ids.add(order.id);
  }
  return true;
}

function lineOf(value, index) {
  if (!isPlain(value)) fail(400, 'PURCHASE_INPUT', `lines.${index} must be an object.`);
  if (Object.keys(value).some(key => !['description', 'quantity', 'unitPriceMinor'].includes(key)))
    fail(400, 'PURCHASE_INPUT', `lines.${index} has an unsupported field.`);
  const description = value.description;
  if (typeof description !== 'string' || !description.trim() || description.length > PO_LIMITS.description)
    fail(400, 'PURCHASE_INPUT', `lines.${index}.description must be non-empty text of at most ${PO_LIMITS.description} characters.`);
  const quantity = value.quantity;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000)
    fail(400, 'PURCHASE_INPUT', `lines.${index}.quantity must be an integer between 1 and 1000000.`);
  const unitPriceMinor = value.unitPriceMinor;
  if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 0 || unitPriceMinor > 100_000_000_000)
    fail(400, 'PURCHASE_INPUT', `lines.${index}.unitPriceMinor must be a non-negative integer of minor units.`);
  return { description: description.trim(), quantity, unitPriceMinor, amountMinor: quantity * unitPriceMinor };
}

export function createPurchaseService({ storage, workspaceId = 'local', resolveWorkspace = null, clock = Date.now, audit = null } = {}) {
  if (!storage || typeof storage.read !== 'function' || typeof storage.update !== 'function')
    throw new TypeError('Purchase orders require the harness storage seam.');

  function resolveActor(context) {
    const input = context?.actor ?? { subject: 'local-operator', role: 'admin', workspaceId };
    if (!isPlain(input) || typeof input.subject !== 'string' || !input.subject
      || !['admin', 'operator', 'viewer'].includes(input.role))
      fail(401, 'PURCHASE_SESSION_REQUIRED', 'A current harness actor is required.');
    if (resolveWorkspace) {
      const resolved = resolveWorkspace(input);
      if (!isPlain(resolved) || typeof resolved.workspaceId !== 'string' || !resolved.workspaceId)
        fail(403, 'PURCHASE_WORKSPACE_REQUIRED', 'The workspace could not be resolved.');
      return { workspaceId: resolved.workspaceId, subject: resolved.subject, role: resolved.role };
    }
    const id = input.workspaceId ?? workspaceId;
    if (id !== workspaceId) fail(403, 'PURCHASE_FORBIDDEN', 'These purchase orders belong to another workspace.');
    return { workspaceId: id, subject: input.subject, role: input.role };
  }

  function partition(id) {
    return {
      read() {
        const state = storage.read() ?? {};
        const value = state.workspaces?.[id]?.[STATE_KEY];
        if (value === undefined) return defaultState();
        validateState(value);
        return value;
      },
      async update(mutator) {
        return storage.update(root => {
          const workspaces = (root.workspaces ??= {});
          const workspace = (workspaces[id] ??= {});
          const current = workspace[STATE_KEY] === undefined ? defaultState() : workspace[STATE_KEY];
          validateState(current);
          const draft = structuredClone(current);
          const result = mutator(draft);
          validateState(draft);
          workspace[STATE_KEY] = draft;
          return result;
        });
      },
    };
  }

  const at = () => new Date(clock()).toISOString();
  const view = order => ({
    ...structuredClone(order),
    lines: order.lines.map(line => ({ ...line, amount: (line.amountMinor / 100).toFixed(2) })),
    total: (order.totalMinor / 100).toFixed(2),
    terminal: TRANSITIONS[order.status].length === 0,
  });

  return Object.freeze({
    resolveActor,

    status(context) {
      const actor = resolveActor(context);
      const state = partition(actor.workspaceId).read();
      const byStatus = Object.fromEntries(PO_STATUSES.map(status => [status, 0]));
      for (const order of state.orders) byStatus[order.status] = (byStatus[order.status] ?? 0) + 1;
      return { workspaceId: actor.workspaceId, total: state.orders.length, byStatus };
    },

    async create(context, body = {}) {
      const actor = resolveActor(context);
      if (actor.role === 'viewer') fail(403, 'PURCHASE_FORBIDDEN', 'A viewer cannot create a purchase order.');
      if (!isPlain(body)) fail(400, 'PURCHASE_INPUT', 'A purchase order must be an object.');
      if (Object.keys(body).some(key => !['requestId', 'supplier', 'currency', 'lines', 'note', 'sourceQuoteId'].includes(key)))
        fail(400, 'PURCHASE_INPUT', 'A purchase order has an unsupported field.');
      if (typeof body.requestId !== 'string' || !body.requestId || body.requestId.length > 128)
        fail(400, 'PURCHASE_INPUT', 'requestId is required.');
      if (typeof body.supplier !== 'string' || !body.supplier.trim() || body.supplier.length > PO_LIMITS.supplier)
        fail(400, 'PURCHASE_INPUT', `supplier must be non-empty text of at most ${PO_LIMITS.supplier} characters.`);
      if (typeof body.currency !== 'string' || !/^[A-Z]{3}$/u.test(body.currency))
        fail(400, 'PURCHASE_INPUT', 'currency must be a three-letter uppercase code.');
      if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > PO_LIMITS.lines)
        fail(400, 'PURCHASE_INPUT', `lines must contain 1-${PO_LIMITS.lines} entries.`);
      const note = body.note === undefined ? null : body.note;
      if (note !== null && (typeof note !== 'string' || note.length > PO_LIMITS.note))
        fail(400, 'PURCHASE_INPUT', `note must be text of at most ${PO_LIMITS.note} characters.`);
      const lines = body.lines.map(lineOf);
      const totalMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0);
      if (!Number.isSafeInteger(totalMinor)) fail(400, 'PURCHASE_INPUT', 'The order total is too large.');
      const sourceQuoteId = body.sourceQuoteId === undefined || body.sourceQuoteId === null ? null : body.sourceQuoteId;
      if (sourceQuoteId !== null && (typeof sourceQuoteId !== 'string' || !UUID.test(sourceQuoteId)))
        fail(400, 'PURCHASE_INPUT', 'sourceQuoteId must be a quote id.');

      const store = partition(actor.workspaceId);
      let order = null;
      let replayed = false;
      await store.update(state => {
        const previous = state.orders.find(item => item.requestId === body.requestId);
        if (previous) { order = view(previous); replayed = true; return null; }
        if (sourceQuoteId !== null && state.orders.some(item => item.sourceQuoteId === sourceQuoteId))
          fail(409, 'PURCHASE_QUOTE_CONVERTED', 'This quote has already been converted into a purchase order.');
        if (state.orders.length >= PO_LIMITS.orders) fail(409, 'PURCHASE_FULL', 'This workspace has too many purchase orders.');
        const now = at();
        const created = {
          id: randomUUID(), workspaceId: actor.workspaceId, requestId: body.requestId,
          number: `PO-${new Date(clock()).toISOString().slice(0, 10).replace(/-/gu, '')}-${String(state.orders.length + 1).padStart(3, '0')}`,
          supplier: body.supplier.trim(), currency: body.currency, lines, totalMinor, note, sourceQuoteId,
          status: 'draft', createdBy: actor.subject, createdAt: now, updatedAt: now,
          approvedBy: null, approvedAt: null,
        };
        state.orders.push(created);
        order = view(created);
        return null;
      });
      if (audit?.record) await audit.record({ kind: 'purchases', action: 'purchases.create', actor: actor.subject, ref: order.id });
      return { order, replayed };
    },

    /**
     * Convert an accepted quote into a draft purchase order.
     * `lookupQuote(id)` is the quotes service's internal lookup (no actor).
     */
    async createFromQuote(context, body = {}, lookupQuote = null) {
      const actor = resolveActor(context);
      if (actor.role === 'viewer') fail(403, 'PURCHASE_FORBIDDEN', 'A viewer cannot create a purchase order.');
      if (typeof lookupQuote !== 'function')
        fail(503, 'PURCHASE_QUOTES_UNAVAILABLE', 'The quotes plugin is not available.');
      if (!isPlain(body)) fail(400, 'PURCHASE_INPUT', 'A conversion must be an object.');
      if (Object.keys(body).some(key => !['requestId', 'quoteId', 'supplier', 'note'].includes(key)))
        fail(400, 'PURCHASE_INPUT', 'A conversion has an unsupported field.');
      if (typeof body.requestId !== 'string' || !body.requestId || body.requestId.length > 128)
        fail(400, 'PURCHASE_INPUT', 'requestId is required.');
      if (typeof body.quoteId !== 'string' || !UUID.test(body.quoteId))
        fail(400, 'PURCHASE_INPUT', 'quoteId must be a quote id.');
      const quote = lookupQuote(body.quoteId);
      if (!quote) fail(404, 'PURCHASE_QUOTE_NOT_FOUND', 'No such quote in this workspace.');
      if (quote.status !== 'accepted')
        fail(409, 'PURCHASE_QUOTE_NOT_ACCEPTED', 'Only an accepted quote can become a purchase order.');

      const payload = {
        requestId: body.requestId,
        supplier: body.supplier,
        currency: quote.currency,
        lines: quote.lines.map(line => ({ description: line.description, quantity: line.quantity, unitPriceMinor: line.unitPriceMinor })),
        note: body.note === undefined ? `来自报价 ${quote.number}` : body.note,
        sourceQuoteId: quote.id,
      };
      const created = await this.create({ actor }, payload);
      if (audit?.record) await audit.record({ kind: 'purchases', action: 'purchases.from-quote', actor: actor.subject, ref: created.order.id, detail: { quoteId: quote.id } });
      return { order: created.order, replayed: created.replayed, quote: { id: quote.id, number: quote.number, total: quote.total, currency: quote.currency } };
    },

    list(context, query = {}) {
      const actor = resolveActor(context);
      const status = query.status === undefined ? 'all' : query.status;
      if (!['all', ...PO_STATUSES].includes(status)) fail(400, 'PURCHASE_INPUT', 'status is invalid.');
      const state = partition(actor.workspaceId).read();
      const items = state.orders
        .filter(order => status === 'all' || order.status === status)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map(view);
      return { workspaceId: actor.workspaceId, status, total: items.length, items };
    },

    read(context, id) {
      const actor = resolveActor(context);
      const state = partition(actor.workspaceId).read();
      const order = state.orders.find(item => item.id === id);
      if (!order) fail(404, 'PURCHASE_NOT_FOUND', 'No such purchase order in this workspace.');
      return { order: view(order) };
    },

    async setStatus(context, id, body = {}) {
      const actor = resolveActor(context);
      if (actor.role === 'viewer') fail(403, 'PURCHASE_FORBIDDEN', 'A viewer cannot change a purchase order.');
      if (!isPlain(body) || Object.keys(body).some(key => key !== 'status'))
        fail(400, 'PURCHASE_INPUT', 'A status change has an unsupported field.');
      const next = body.status;
      if (!PO_STATUSES.includes(next)) fail(400, 'PURCHASE_INPUT', 'status is invalid.');
      if (ADMIN_ONLY.has(next) && actor.role !== 'admin')
        fail(403, 'PURCHASE_APPROVAL_REQUIRED', 'Only an administrator can approve a purchase order.');
      const store = partition(actor.workspaceId);
      let order = null;
      await store.update(state => {
        const current = state.orders.find(item => item.id === id);
        if (!current) fail(404, 'PURCHASE_NOT_FOUND', 'No such purchase order in this workspace.');
        const allowed = TRANSITIONS[current.status] ?? [];
        if (!allowed.includes(next)) fail(409, 'PURCHASE_TRANSITION', `An order in ${current.status} cannot become ${next}.`);
        current.status = next;
        current.updatedAt = at();
        if (next === 'approved') { current.approvedBy = actor.subject; current.approvedAt = current.updatedAt; }
        order = view(current);
        return null;
      });
      if (audit?.record) await audit.record({ kind: 'purchases', action: 'purchases.status', actor: actor.subject, ref: id, detail: { status: next } });
      return { order };
    },
  });
}
