// Quotes: a small, explicit commercial document domain.
//
// The server owns the arithmetic: a client cannot send a total, only lines.
// Money is stored as integer minor units to avoid float drift.
import { randomUUID } from 'node:crypto';
export const QUOTE_STATE_VERSION = 1;
export const STATE_KEY = 'harnessQuotes';

export const QUOTE_STATUSES = Object.freeze(['draft', 'sent', 'accepted', 'rejected']);
const TRANSITIONS = Object.freeze({
  draft: Object.freeze(['sent', 'rejected']),
  sent: Object.freeze(['accepted', 'rejected']),
  accepted: Object.freeze([]),
  rejected: Object.freeze([]),
});

export const QUOTE_LIMITS = Object.freeze({ quotes: 2_000, lines: 50, customer: 200, note: 2_000, description: 300 });

export class QuoteError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'QuoteError';
    this.status = status;
    this.code = code;
  }
}

const fail = (status, code, message) => { throw new QuoteError(status, code, message); };
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const isIso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

const defaultState = () => ({ version: QUOTE_STATE_VERSION, quotes: [] });

function validateState(value) {
  if (!isPlain(value) || value.version !== QUOTE_STATE_VERSION || !Array.isArray(value.quotes)
    || value.quotes.length > QUOTE_LIMITS.quotes)
    fail(500, 'QUOTE_INVALID', 'Stored quotes are invalid or full.');
  const ids = new Set();
  for (const quote of value.quotes) {
    if (!isPlain(quote) || !UUID.test(quote.id ?? '') || typeof quote.workspaceId !== 'string' || !quote.workspaceId
      || typeof quote.number !== 'string' || !quote.number
      || typeof quote.customer !== 'string' || !quote.customer
      || typeof quote.currency !== 'string' || !/^[A-Z]{3}$/u.test(quote.currency)
      || !QUOTE_STATUSES.includes(quote.status)
      || !Array.isArray(quote.lines) || quote.lines.length === 0 || quote.lines.length > QUOTE_LIMITS.lines
      || !Number.isSafeInteger(quote.totalMinor) || quote.totalMinor < 0
      || !isIso(quote.createdAt) || !isIso(quote.updatedAt)
      || typeof quote.createdBy !== 'string' || !quote.createdBy)
      fail(500, 'QUOTE_INVALID', 'Stored quote is invalid.');
    if (ids.has(quote.id)) fail(500, 'QUOTE_INVALID', 'Duplicate quote id.');
    ids.add(quote.id);
  }
  return true;
}

function lineOf(value, index) {
  if (!isPlain(value)) fail(400, 'QUOTE_INPUT', `lines.${index} must be an object.`);
  const keys = Object.keys(value);
  if (keys.some(key => !['description', 'quantity', 'unitPriceMinor'].includes(key)))
    fail(400, 'QUOTE_INPUT', `lines.${index} has an unsupported field.`);
  const description = value.description;
  if (typeof description !== 'string' || !description.trim() || description.length > QUOTE_LIMITS.description)
    fail(400, 'QUOTE_INPUT', `lines.${index}.description must be non-empty text of at most ${QUOTE_LIMITS.description} characters.`);
  const quantity = value.quantity;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000)
    fail(400, 'QUOTE_INPUT', `lines.${index}.quantity must be an integer between 1 and 1000000.`);
  const unitPriceMinor = value.unitPriceMinor;
  if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 0 || unitPriceMinor > 1_000_000_000_00)
    fail(400, 'QUOTE_INPUT', `lines.${index}.unitPriceMinor must be a non-negative integer of minor units.`);
  return { description: description.trim(), quantity, unitPriceMinor, amountMinor: quantity * unitPriceMinor };
}

export function createQuoteService({ storage, workspaceId = 'local', resolveWorkspace = null, clock = Date.now, audit = null } = {}) {
  if (!storage || typeof storage.read !== 'function' || typeof storage.update !== 'function')
    throw new TypeError('Quotes require the harness storage seam.');

  function resolveActor(context) {
    const input = context?.actor ?? { subject: 'local-operator', role: 'admin', workspaceId };
    if (!isPlain(input) || typeof input.subject !== 'string' || !input.subject
      || !['admin', 'operator', 'viewer'].includes(input.role))
      fail(401, 'QUOTE_SESSION_REQUIRED', 'A current harness actor is required.');
    if (resolveWorkspace) {
      const resolved = resolveWorkspace(input);
      if (!isPlain(resolved) || typeof resolved.workspaceId !== 'string' || !resolved.workspaceId)
        fail(403, 'QUOTE_WORKSPACE_REQUIRED', 'The workspace could not be resolved.');
      return { workspaceId: resolved.workspaceId, subject: resolved.subject, role: resolved.role };
    }
    const id = input.workspaceId ?? workspaceId;
    if (id !== workspaceId) fail(403, 'QUOTE_FORBIDDEN', 'These quotes belong to another workspace.');
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
  const view = quote => {
    const lines = quote.lines.map(line => ({ ...line, amount: (line.amountMinor / 100).toFixed(2) }));
    return { ...structuredClone(quote), lines, total: (quote.totalMinor / 100).toFixed(2), terminal: TRANSITIONS[quote.status].length === 0 };
  };

  return Object.freeze({
    resolveActor,

    status(context) {
      const actor = resolveActor(context);
      const state = partition(actor.workspaceId).read();
      const byStatus = Object.fromEntries(QUOTE_STATUSES.map(status => [status, 0]));
      for (const quote of state.quotes) byStatus[quote.status] = (byStatus[quote.status] ?? 0) + 1;
      return { workspaceId: actor.workspaceId, total: state.quotes.length, byStatus };
    },

    async create(context, body = {}) {
      const actor = resolveActor(context);
      if (actor.role === 'viewer') fail(403, 'QUOTE_FORBIDDEN', 'A viewer cannot create a quote.');
      if (!isPlain(body)) fail(400, 'QUOTE_INPUT', 'A quote must be an object.');
      if (Object.keys(body).some(key => !['requestId', 'customer', 'currency', 'lines', 'note'].includes(key)))
        fail(400, 'QUOTE_INPUT', 'A quote has an unsupported field.');
      if (typeof body.requestId !== 'string' || !body.requestId || body.requestId.length > 128)
        fail(400, 'QUOTE_INPUT', 'requestId is required.');
      if (typeof body.customer !== 'string' || !body.customer.trim() || body.customer.length > QUOTE_LIMITS.customer)
        fail(400, 'QUOTE_INPUT', `customer must be non-empty text of at most ${QUOTE_LIMITS.customer} characters.`);
      if (typeof body.currency !== 'string' || !/^[A-Z]{3}$/u.test(body.currency))
        fail(400, 'QUOTE_INPUT', 'currency must be a three-letter uppercase code.');
      if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > QUOTE_LIMITS.lines)
        fail(400, 'QUOTE_INPUT', `lines must contain 1-${QUOTE_LIMITS.lines} entries.`);
      const note = body.note === undefined ? null : body.note;
      if (note !== null && (typeof note !== 'string' || note.length > QUOTE_LIMITS.note))
        fail(400, 'QUOTE_INPUT', `note must be text of at most ${QUOTE_LIMITS.note} characters.`);
      const lines = body.lines.map(lineOf);
      const totalMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0);
      if (!Number.isSafeInteger(totalMinor)) fail(400, 'QUOTE_INPUT', 'The quote total is too large.');

      const store = partition(actor.workspaceId);
      let quote = null;
      let replayed = false;
      await store.update(state => {
        const previous = state.quotes.find(item => item.requestId === body.requestId);
        if (previous) { quote = view(previous); replayed = true; return null; }
        if (state.quotes.length >= QUOTE_LIMITS.quotes) fail(409, 'QUOTE_FULL', 'This workspace has too many quotes.');
        const now = at();
        const created = {
          id: randomUUID(), workspaceId: actor.workspaceId, requestId: body.requestId,
          number: `Q-${new Date(clock()).toISOString().slice(0, 10).replace(/-/gu, '')}-${String(state.quotes.length + 1).padStart(3, '0')}`,
          customer: body.customer.trim(), currency: body.currency, lines, totalMinor, note,
          status: 'draft', createdBy: actor.subject, createdAt: now, updatedAt: now,
        };
        state.quotes.push(created);
        quote = view(created);
        return null;
      });
      if (audit?.record) await audit.record({ kind: 'quotes', action: 'quotes.create', actor: actor.subject, ref: quote.id });
      return { quote, replayed };
    },

    list(context, query = {}) {
      const actor = resolveActor(context);
      const status = query.status === undefined ? 'all' : query.status;
      if (!['all', ...QUOTE_STATUSES].includes(status)) fail(400, 'QUOTE_INPUT', 'status is invalid.');
      const state = partition(actor.workspaceId).read();
      const items = state.quotes
        .filter(quote => status === 'all' || quote.status === status)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map(view);
      return { workspaceId: actor.workspaceId, status, total: items.length, items };
    },

    read(context, id) {
      const actor = resolveActor(context);
      const state = partition(actor.workspaceId).read();
      const quote = state.quotes.find(item => item.id === id);
      if (!quote) fail(404, 'QUOTE_NOT_FOUND', 'No such quote in this workspace.');
      return { quote: view(quote) };
    },

    async setStatus(context, id, body = {}) {
      const actor = resolveActor(context);
      if (actor.role === 'viewer') fail(403, 'QUOTE_FORBIDDEN', 'A viewer cannot change a quote.');
      if (!isPlain(body) || Object.keys(body).some(key => key !== 'status'))
        fail(400, 'QUOTE_INPUT', 'A status change has an unsupported field.');
      if (!QUOTE_STATUSES.includes(body.status)) fail(400, 'QUOTE_INPUT', 'status is invalid.');
      const store = partition(actor.workspaceId);
      let quote = null;
      await store.update(state => {
        const current = state.quotes.find(item => item.id === id);
        if (!current) fail(404, 'QUOTE_NOT_FOUND', 'No such quote in this workspace.');
        const allowed = TRANSITIONS[current.status] ?? [];
        if (!allowed.includes(body.status)) fail(409, 'QUOTE_TRANSITION', `A quote in ${current.status} cannot become ${body.status}.`);
        current.status = body.status;
        current.updatedAt = at();
        quote = view(current);
        return null;
      });
      if (audit?.record) await audit.record({ kind: 'quotes', action: 'quotes.status', actor: actor.subject, ref: id, detail: { status: body.status } });
      return { quote };
    },
  });
}
