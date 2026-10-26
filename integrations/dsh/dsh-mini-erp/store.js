import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export class ErpError extends Error {
  constructor(code, message) { super(message); this.code = code; this.name = 'ErpError'; }
}
const fail = (code, message) => { throw new ErpError(code, message); };
const text = (v, name, max = 500) => { if (typeof v !== 'string' || !v.trim() || v.length > max) fail('INPUT', `${name}: non-empty text, max ${max}`); return v.trim(); };
const id = (v, name = 'id') => { text(v, name, 100); if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(v)) fail('INPUT', `${name}: invalid identifier`); return v; };
const integer = (v, name, min = 0, max = 1_000_000_000) => { if (!Number.isSafeInteger(v) || v < min || v > max) fail('INPUT', `${name}: integer between ${min} and ${max}`); return v; };
const fields = (body, keys) => { for (const key of Object.keys(body)) if (!keys.includes(key)) fail('INPUT', `Unexpected field: ${key}`); };
const canonical = value => JSON.stringify(value, Object.keys(value).sort());
const currency = value => { if (!['USD', 'EUR', 'GBP', 'CNY'].includes(value)) fail('INPUT', 'Supported two-decimal currencies: USD, EUR, GBP, CNY'); return value; };

export class ErpStore {
  constructor(file, { clock = Date.now } = {}) {
    this.clock = clock;
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) { this.db.close(); fail('VERSION', 'Database was created by a newer ERP version'); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        workspace TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, currency TEXT NOT NULL,
        unit_price INTEGER NOT NULL CHECK(unit_price>=0), stock INTEGER NOT NULL CHECK(stock>=0),
        revision INTEGER NOT NULL, source TEXT NOT NULL, PRIMARY KEY(workspace,id));
      CREATE TABLE IF NOT EXISTS buyers (
        workspace TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, contact TEXT NOT NULL,
        PRIMARY KEY(workspace,id));
      CREATE TABLE IF NOT EXISTS offers (
        workspace TEXT NOT NULL, id TEXT NOT NULL, product_id TEXT NOT NULL, territory TEXT NOT NULL,
        channel TEXT NOT NULL, term TEXT NOT NULL, conditions TEXT NOT NULL, capacity INTEGER NOT NULL CHECK(capacity>0),
        valid_until INTEGER NOT NULL, source TEXT NOT NULL, PRIMARY KEY(workspace,id),
        UNIQUE(workspace,product_id,territory,channel),
        FOREIGN KEY(workspace,product_id) REFERENCES products(workspace,id));
      CREATE TABLE IF NOT EXISTS orders (
        workspace TEXT NOT NULL, id TEXT NOT NULL, buyer_id TEXT NOT NULL, product_id TEXT NOT NULL,
        offer_id TEXT, quantity INTEGER NOT NULL CHECK(quantity>0), currency TEXT NOT NULL,
        unit_price INTEGER NOT NULL, total INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('reserved','confirmed','cancelled','expired')),
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY(workspace,id), FOREIGN KEY(workspace,buyer_id) REFERENCES buyers(workspace,id),
        FOREIGN KEY(workspace,product_id) REFERENCES products(workspace,id),
        FOREIGN KEY(workspace,offer_id) REFERENCES offers(workspace,id));
      CREATE INDEX IF NOT EXISTS order_product ON orders(workspace,product_id,status,expires_at);
      CREATE INDEX IF NOT EXISTS order_offer ON orders(workspace,offer_id,status,expires_at);
      CREATE TABLE IF NOT EXISTS requests (
        workspace TEXT NOT NULL, request_id TEXT NOT NULL, payload TEXT NOT NULL, receipt TEXT NOT NULL,
        PRIMARY KEY(workspace,request_id));
      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, workspace TEXT NOT NULL, request_id TEXT NOT NULL,
        action TEXT NOT NULL, entity_id TEXT NOT NULL, actor TEXT NOT NULL, created_at INTEGER NOT NULL);
      PRAGMA user_version=1;
    `);
  }
  close() { this.db.close(); }
  now() { return integer(this.clock(), 'clock', 0, Number.MAX_SAFE_INTEGER - 604800000); }
  row(table, workspace, entityId) {
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE workspace=? AND id=?`).get(workspace, id(entityId));
    if (!row) fail('NOT_FOUND', `${table}: record not found in current workspace`);
    return row;
  }
  consumed(workspace, productId, now) {
    return this.db.prepare("SELECT COALESCE(SUM(quantity),0) AS used FROM orders WHERE workspace=? AND product_id=? AND (status='confirmed' OR (status='reserved' AND expires_at>?))").get(workspace, productId, now).used;
  }
  product(workspace, productId, now) {
    const p = this.row('products', workspace, productId);
    return { id: p.id, name: p.name, currency: p.currency, unitPriceMinor: p.unit_price, stockTotal: p.stock,
      available: p.stock - this.consumed(workspace, p.id, now), revision: p.revision, source: p.source, asOf: new Date(now).toISOString() };
  }
  offer(workspace, offerId, now) {
    const o = this.row('offers', workspace, offerId);
    const used = this.db.prepare("SELECT COUNT(*) AS used FROM orders WHERE workspace=? AND offer_id=? AND (status='confirmed' OR (status='reserved' AND expires_at>?))").get(workspace, o.id, now).used;
    return { id: o.id, productId: o.product_id, territory: o.territory, channel: o.channel, term: o.term,
      conditions: o.conditions, capacity: o.capacity, availableSlots: o.valid_until <= now ? 0 : o.capacity - used,
      validUntil: new Date(o.valid_until).toISOString(), source: o.source, asOf: new Date(now).toISOString() };
  }
  order(workspace, orderId, now) {
    const o = this.row('orders', workspace, orderId);
    return { id: o.id, buyerId: o.buyer_id, productId: o.product_id, offerId: o.offer_id,
      quantity: o.quantity, currency: o.currency, unitPriceMinor: o.unit_price, totalMinor: o.total,
      status: o.status === 'reserved' && o.expires_at <= now ? 'expired' : o.status,
      expiresAt: new Date(o.expires_at).toISOString(), createdAt: new Date(o.created_at).toISOString(),
      updatedAt: new Date(o.updated_at).toISOString(), paymentStatus: 'not_tracked' };
  }
  read(workspace, input) {
    id(workspace, 'workspace');
    fields(input, ['entity', 'id', 'limit', 'afterId']);
    const tables = { product: 'products', buyer: 'buyers', offer: 'offers', order: 'orders' };
    if (!Object.hasOwn(tables, input.entity)) fail('INPUT', 'entity: product, buyer, offer or order');
    if (input.afterId !== undefined) id(input.afterId, 'afterId');
    let now;
    const get = key => input.entity === 'buyer'
      ? (({ id, name, contact }) => ({ id, name, contact }))(this.row('buyers', workspace, key))
      : this[input.entity](workspace, key, now);
    // All quantities and related rows in a read come from one SQLite snapshot.
    this.db.exec('BEGIN');
    try {
      now = this.now();
      const limit = integer(input.limit ?? 50, 'limit', 1, 100);
      const rows = input.id ? [] : this.db.prepare(`SELECT id FROM ${tables[input.entity]} WHERE workspace=? AND id>? ORDER BY id LIMIT ?`).all(workspace, input.afterId ?? '', limit + 1);
      const result = input.id ? get(input.id) : {
        items: rows.slice(0, limit).map(r => get(r.id)),
        hasMore: rows.length > limit, nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      };
      this.db.exec('COMMIT'); return { workspaceId: workspace, asOf: new Date(now).toISOString(), ...result };
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  write(workspace, input, actor = 'local-operator') {
    id(workspace, 'workspace'); text(actor, 'actor', 300);
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INPUT', 'Command object required');
    id(input.requestId, 'requestId');
    const payload = canonical(input);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const now = this.now();
      const prior = this.db.prepare('SELECT payload,receipt FROM requests WHERE workspace=? AND request_id=?').get(workspace, input.requestId);
      if (prior) {
        if (prior.payload !== payload) fail('IDEMPOTENCY_CONFLICT', 'requestId was already used for a different command');
        const receipt = JSON.parse(prior.receipt);
        const current = receipt.entity === 'buyer' ? (({ id, name, contact }) => ({ id, name, contact }))(this.row('buyers', workspace, receipt.id)) : this[receipt.entity](workspace, receipt.id, now);
        this.db.exec('COMMIT'); return { ...receipt, replayed: true, current };
      }
      this.db.prepare("UPDATE orders SET status='expired',updated_at=? WHERE workspace=? AND status='reserved' AND expires_at<=?").run(now, workspace, now);
      const result = this.command(workspace, input, now);
      const receipt = { workspaceId: workspace, requestId: input.requestId, action: input.action, entity: result.entity, id: result.id, recordedAt: new Date(now).toISOString() };
      const current = result.entity === 'buyer' ? (({ id, name, contact }) => ({ id, name, contact }))(this.row('buyers', workspace, result.id)) : this[result.entity](workspace, result.id, now);
      this.db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(workspace, input.requestId, payload, JSON.stringify(receipt));
      this.db.prepare('INSERT INTO events(workspace,request_id,action,entity_id,actor,created_at) VALUES(?,?,?,?,?,?)').run(workspace, input.requestId, input.action, result.id, actor, now);
      this.db.exec('COMMIT'); return { ...receipt, replayed: false, current };
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  command(w, b, now) {
    const common = ['action', 'requestId'];
    switch (b.action) {
      case 'add_product': {
        fields(b, [...common, 'id', 'name', 'currency', 'unitPriceMinor', 'stockTotal', 'source']);
        this.db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,1,?)').run(w, id(b.id), text(b.name, 'name'), currency(b.currency), integer(b.unitPriceMinor, 'unitPriceMinor'), integer(b.stockTotal, 'stockTotal'), text(b.source, 'source', 2000));
        return { entity: 'product', id: b.id };
      }
      case 'update_product': {
        fields(b, [...common, 'id', 'expectedRevision', 'unitPriceMinor', 'stockTotal', 'source']);
        const p = this.row('products', w, b.id);
        if (integer(b.expectedRevision, 'expectedRevision', 1) !== p.revision) fail('REVISION_CONFLICT', 'Read the product again before updating');
        if (integer(b.stockTotal, 'stockTotal') < this.consumed(w, p.id, now)) fail('STOCK_CONFLICT', 'Total allocation cannot be less than reserved plus confirmed quantities');
        this.db.prepare('UPDATE products SET unit_price=?,stock=?,source=?,revision=revision+1 WHERE workspace=? AND id=?').run(integer(b.unitPriceMinor, 'unitPriceMinor'), b.stockTotal, text(b.source, 'source', 2000), w, p.id);
        return { entity: 'product', id: p.id };
      }
      case 'add_buyer': {
        fields(b, [...common, 'id', 'name', 'contact']);
        this.db.prepare('INSERT INTO buyers VALUES(?,?,?,?)').run(w, id(b.id), text(b.name, 'name'), text(b.contact, 'contact'));
        return { entity: 'buyer', id: b.id };
      }
      case 'add_offer': {
        fields(b, [...common, 'id', 'productId', 'territory', 'channel', 'term', 'conditions', 'capacity', 'validUntil', 'source']);
        this.row('products', w, b.productId);
        const until = Date.parse(text(b.validUntil, 'validUntil'));
        if (!Number.isFinite(until) || until <= now) fail('INPUT', 'validUntil must be a future timestamp');
        this.db.prepare('INSERT INTO offers VALUES(?,?,?,?,?,?,?,?,?,?)').run(w, id(b.id), b.productId, text(b.territory, 'territory').toUpperCase(), text(b.channel, 'channel').toLowerCase(), text(b.term, 'term'), text(b.conditions, 'conditions', 2000), integer(b.capacity, 'capacity', 1), until, text(b.source, 'source', 2000));
        return { entity: 'offer', id: b.id };
      }
      case 'reserve': {
        fields(b, [...common, 'buyerId', 'productId', 'expectedRevision', 'quantity', 'offerId', 'holdMinutes']);
        const p = this.row('products', w, b.productId); this.row('buyers', w, b.buyerId);
        if (integer(b.expectedRevision, 'expectedRevision', 1) !== p.revision) fail('REVISION_CONFLICT', 'Product terms changed; read again');
        const qty = integer(b.quantity, 'quantity', 1), minutes = integer(b.holdMinutes ?? 60, 'holdMinutes', 1, 10080);
        if (p.stock - this.consumed(w, p.id, now) < qty) fail('OUT_OF_STOCK', 'Insufficient available product allocation');
        let expiry = now + minutes * 60000;
        if (b.offerId !== undefined) {
          const o = this.row('offers', w, b.offerId);
          if (o.product_id !== p.id) fail('OFFER_PRODUCT_MISMATCH', 'Offer belongs to a different product');
          if (!this.offer(w, o.id, now).availableSlots) fail('NO_SLOTS', 'Offer is closed or fully reserved');
          if (this.db.prepare("SELECT id FROM orders WHERE workspace=? AND offer_id=? AND buyer_id=? AND (status='confirmed' OR (status='reserved' AND expires_at>?))").get(w, o.id, b.buyerId, now)) fail('ALREADY_HELD', 'Buyer already holds this offer');
          expiry = Math.min(expiry, o.valid_until);
        }
        const total = p.unit_price * qty;
        if (!Number.isSafeInteger(total)) fail('INPUT', 'Order total exceeds safe integer range');
        const key = randomUUID();
        this.db.prepare("INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?, 'reserved',?,?,?)").run(w, key, b.buyerId, p.id, b.offerId ?? null, qty, p.currency, p.unit_price, total, now, expiry, now);
        return { entity: 'order', id: key };
      }
      case 'confirm': case 'cancel': {
        fields(b, [...common, 'orderId']); const o = this.row('orders', w, b.orderId);
        const desired = b.action === 'confirm' ? 'confirmed' : 'cancelled';
        if (o.status !== desired && o.status !== 'reserved') fail('ORDER_STATE', `Cannot ${b.action} an order in state ${o.status}`);
        if (o.status === 'reserved') this.db.prepare('UPDATE orders SET status=?,updated_at=? WHERE workspace=? AND id=?').run(desired, now, w, o.id);
        return { entity: 'order', id: o.id };
      }
      default: fail('INPUT', 'Unknown ERP action');
    }
  }
}
