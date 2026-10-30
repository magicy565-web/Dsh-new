import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizeShop, reject, nonceHash } from './core.js';

const VERSION = 1;
function requireKey(hex) {
  if (typeof hex !== 'string' || !/^[a-fA-F0-9]{64}$/.test(hex)) reject('KEY_NOT_CONFIGURED', 'Set a 32-byte SHOPIFY_BINDING_AES256_KEY in the private host environment.', 503);
  return Buffer.from(hex, 'hex');
}
function encrypt(key, workspaceId, shop, kind, plain) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from('shopify-binding:' + VERSION + ':' + workspaceId + ':' + shop + ':' + kind));
  const bytes = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), bytes]).toString('base64');
}
function decrypt(key, workspaceId, shop, kind, encoded) {
  try {
    const raw = Buffer.from(encoded, 'base64');
    if (raw.length < 29) throw new Error('ciphertext too short');
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from('shopify-binding:' + VERSION + ':' + workspaceId + ':' + shop + ':' + kind));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch { reject('TOKEN_UNREADABLE', 'Shopify credential cannot be decrypted. Reauthorize with an approved operator.', 503); }
}
function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = operation(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
function statusRow(row) {
  if (!row) return { status: 'unbound', shop: null, shopName: null, adminUrl: null, revision: 0 };
  return { status: row.status, shop: row.shop_domain, shopName: row.shop_name,
    adminUrl: 'https://' + row.shop_domain + '/admin', scopes: JSON.parse(row.scopes),
    revision: row.revision, connectedAt: row.connected_at, updatedAt: row.updated_at };
}
export class ShopifyBindingStore {
  constructor({ filename, encryptionKey }) {
    this.key = requireKey(encryptionKey);
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS shopify_binding (
        workspace_id TEXT PRIMARY KEY,
        shop_domain TEXT NOT NULL UNIQUE,
        shop_gid TEXT NOT NULL,
        shop_name TEXT NOT NULL,
        access_ciphertext TEXT,
        refresh_ciphertext TEXT,
        access_expires_at INTEGER,
        refresh_expires_at INTEGER,
        scopes TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('connected','uninstalled','reauthorization_required')),
        revision INTEGER NOT NULL,
        connected_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS shopify_oauth_pending (
        state_hash TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL UNIQUE,
        shop_domain TEXT NOT NULL,
        session_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS shopify_webhook_receipt (
        event_id TEXT PRIMARY KEY,
        shop_domain TEXT NOT NULL,
        occurred_at INTEGER NOT NULL
      );`);
    if (filename !== ':memory:') chmodSync(filename, 0o600);
  }
  close() { this.db.close(); }
  get(workspaceId) {
    return this.db.prepare('SELECT * FROM shopify_binding WHERE workspace_id=?').get(workspaceId) ?? null;
  }
  status(workspaceId) { return statusRow(this.get(workspaceId)); }
  checkAvailable(workspaceId, shop) {
    const sameWorkspace = this.get(workspaceId);
    if (sameWorkspace && sameWorkspace.shop_domain !== shop) reject('WORKSPACE_ALREADY_BOUND', 'This enterprise already owns a different Shopify store. A separately reviewed migration is required.', 409);
    const sameShop = this.db.prepare('SELECT workspace_id FROM shopify_binding WHERE shop_domain=?').get(shop);
    if (sameShop && sameShop.workspace_id !== workspaceId) reject('SHOP_ALREADY_BOUND', 'This Shopify store is already assigned to another enterprise instance.', 409);
  }
  start(workspaceId, sessionId, shop, nonce, now) {
    shop = normalizeShop(shop);
    return transaction(this.db, () => {
      this.checkAvailable(workspaceId, shop);
      this.db.prepare('DELETE FROM shopify_oauth_pending WHERE workspace_id=?').run(workspaceId);
      this.db.prepare('INSERT INTO shopify_oauth_pending VALUES(?,?,?,?,?)').run(nonceHash(nonce), workspaceId, shop, sessionId, now + 600_000);
      return { shop };
    });
  }
  consume(nonce, shop, now) {
    return transaction(this.db, () => {
      const hash = nonceHash(nonce);
      const row = this.db.prepare('SELECT * FROM shopify_oauth_pending WHERE state_hash=?').get(hash);
      if (!row) reject('STATE_INVALID', 'Authorization state was not found or was already consumed.', 403);
      this.db.prepare('DELETE FROM shopify_oauth_pending WHERE state_hash=?').run(hash);
      if (row.expires_at < now || row.shop_domain !== shop) reject('STATE_INVALID', 'Authorization state or expected shop does not match.', 403);
      this.checkAvailable(row.workspace_id, shop);
      return row;
    });
  }
  bind({ workspaceId, shop, shopGid, shopName, accessToken, refreshToken, expiresIn, refreshExpiresIn, scopes, now }) {
    return transaction(this.db, () => {
      this.checkAvailable(workspaceId, shop);
      const previous = this.get(workspaceId);
      if (previous && previous.shop_gid !== shopGid) reject('SHOP_ID_MISMATCH', 'Previously bound Shopify store identity changed.', 409);
      const connectedAt = previous?.connected_at ?? new Date(now).toISOString();
      const changedAt = new Date(now).toISOString();
      this.db.prepare(`INSERT INTO shopify_binding(workspace_id,shop_domain,shop_gid,shop_name,access_ciphertext,refresh_ciphertext,access_expires_at,refresh_expires_at,scopes,status,revision,connected_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,'connected',?,?,?)
        ON CONFLICT(workspace_id) DO UPDATE SET shop_gid=excluded.shop_gid,shop_name=excluded.shop_name,
        access_ciphertext=excluded.access_ciphertext,refresh_ciphertext=excluded.refresh_ciphertext,
        access_expires_at=excluded.access_expires_at,refresh_expires_at=excluded.refresh_expires_at,
        scopes=excluded.scopes,status='connected',revision=excluded.revision,updated_at=excluded.updated_at`)
        .run(workspaceId, shop, shopGid, shopName, encrypt(this.key, workspaceId, shop, 'access', accessToken),
          encrypt(this.key, workspaceId, shop, 'refresh', refreshToken),
          now + expiresIn * 1000, now + refreshExpiresIn * 1000,
          JSON.stringify(scopes), (previous?.revision ?? 0) + 1, connectedAt, changedAt);
      return this.status(workspaceId);
    });
  }
  tokens(workspaceId) {
    const row = this.get(workspaceId);
    if (!row || row.status !== 'connected') reject('SHOP_NOT_CONNECTED', 'This enterprise has no authorized Shopify Admin connection.', 409);
    return { ...statusRow(row), workspaceId, shopGid: row.shop_gid,
      accessToken: decrypt(this.key, workspaceId, row.shop_domain, 'access', row.access_ciphertext),
      refreshToken: decrypt(this.key, workspaceId, row.shop_domain, 'refresh', row.refresh_ciphertext),
      accessExpiresAt: row.access_expires_at, refreshExpiresAt: row.refresh_expires_at };
  }
  rotate(workspaceId, expectedRevision, value, now) {
    return transaction(this.db, () => {
      const row = this.get(workspaceId);
      if (!row || row.status !== 'connected' || row.revision !== expectedRevision) reject('BINDING_CHANGED', 'Shopify binding changed during token refresh.', 409);
      this.db.prepare(`UPDATE shopify_binding SET access_ciphertext=?,refresh_ciphertext=?,access_expires_at=?,refresh_expires_at=?,scopes=?,revision=revision+1,updated_at=? WHERE workspace_id=?`)
        .run(encrypt(this.key, workspaceId, row.shop_domain, 'access', value.accessToken),
          encrypt(this.key, workspaceId, row.shop_domain, 'refresh', value.refreshToken),
          now + value.expiresIn * 1000, now + value.refreshExpiresIn * 1000,
          JSON.stringify(value.scopes), new Date(now).toISOString(), workspaceId);
      return this.status(workspaceId);
    });
  }
  uninstall(shop, eventId, now) {
    return transaction(this.db, () => {
      if (this.db.prepare('SELECT event_id FROM shopify_webhook_receipt WHERE event_id=?').get(eventId)) return false;
      this.db.prepare('INSERT INTO shopify_webhook_receipt VALUES(?,?,?)').run(eventId, shop, now);
      this.db.prepare(`UPDATE shopify_binding SET status='uninstalled',access_ciphertext=NULL,refresh_ciphertext=NULL,
        access_expires_at=NULL,refresh_expires_at=NULL,revision=revision+1,updated_at=? WHERE shop_domain=? AND status='connected'`)
        .run(new Date(now).toISOString(), shop);
      return true;
    });
  }
}
