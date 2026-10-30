// Debounced, single-flight layout writer with an explicit state machine:
// idle -> pending -> saving -> saved | conflict | offline | error, plus readonly.
// Positions are optimistic; the service receipt (a higher layout revision) is the only proof of a save.

export const SYNC_LABELS = Object.freeze({
  idle: '已同步', saved: '已同步', pending: '待保存', saving: '保存中', conflict: '布局冲突', offline: '已离线', error: '保存失败', readonly: '只读',
});

const isConflict = (error) => error?.status === 409 || /LAYOUT_CONFLICT|REVISION_CONFLICT/.test(error?.code ?? '');

export class LayoutSaver {
  #save; #projectId; #delay; #online; #onChange; #schedule; #cancel;
  #pending = new Map();
  #timer = null;
  #inflight = null;
  #disposed = false;
  #writable = true;

  constructor({ save, projectId, revision = 0, delay = 400, online = () => true, onChange = () => {}, schedule = setTimeout, cancel = clearTimeout }) {
    this.#save = save; this.#projectId = projectId; this.#delay = delay; this.#online = online;
    this.#onChange = onChange; this.#schedule = schedule; this.#cancel = cancel;
    this.revision = revision;
    this.status = 'idle';
    this.message = '';
  }

  get pendingCount() { return this.#pending.size; }
  get busy() { return this.#pending.size > 0 || this.#inflight !== null; }

  #set(status, message = '') {
    if (this.#disposed) return;
    this.status = status; this.message = message;
    this.#onChange({ status, message, pendingCount: this.#pending.size });
  }

  #arm() {
    if (this.#timer !== null) this.#cancel(this.#timer);
    this.#timer = this.#schedule(() => { this.#timer = null; void this.flush(); }, this.#delay);
  }

  /** Track the newest revision seen from the service. A revision never moves backwards. */
  setRevision(revision) { if (Number.isSafeInteger(revision) && revision > this.revision) this.revision = revision; }

  setWritable(writable) {
    this.#writable = writable;
    if (!writable) { this.#pending.clear(); this.#set('readonly', '当前服务未开放布局保存。'); }
    else if (this.status === 'readonly') this.#set('idle');
  }

  /** Queue `[{ id, position: { x, y } }]`. The newest position of a node wins. */
  queue(positions) {
    if (!this.#writable || this.#disposed || !positions.length) return;
    for (const { id, position } of positions) this.#pending.set(id, { x: position.x, y: position.y });
    if (this.status !== 'conflict') this.#set('pending');
    if (this.status === 'pending') this.#arm();
  }

  async flush() {
    if (this.#timer !== null) { this.#cancel(this.#timer); this.#timer = null; }
    if (this.#inflight) return this.#inflight;
    if (!this.#pending.size || this.#disposed || !this.#writable || this.status === 'conflict') return undefined;
    if (!this.#online()) { this.#set('offline', '网络已断开，改动会在恢复连接后保存。'); return undefined; }
    const patch = new Map(this.#pending);
    this.#pending.clear();
    this.#set('saving');
    this.#inflight = (async () => {
      try {
        const receipt = await this.#save({ projectId: this.#projectId, expectedLayoutRevision: this.revision, nodes: [...patch].map(([id, position]) => ({ id, position })) });
        if (!Number.isSafeInteger(receipt?.layoutRevision) || receipt.layoutRevision <= this.revision) throw new Error('尚未收到布局保存回执，请刷新核对。');
        this.revision = receipt.layoutRevision;
        if (this.#pending.size) { this.#set('pending'); this.#arm(); } else this.#set('saved');
      } catch (error) {
        for (const [id, position] of patch) if (!this.#pending.has(id)) this.#pending.set(id, position);
        if (isConflict(error)) this.#set('conflict', '团队成员更新了布局。载入最新会放弃你未保存的位置；保留我的会在最新布局上重新保存。');
        else if (!this.#online() || error?.name === 'TypeError') this.#set('offline', '网络已断开，改动会在恢复连接后保存。');
        else this.#set('error', error?.message || '布局未保存，请重试。');
      } finally { this.#inflight = null; }
    })();
    return this.#inflight;
  }

  /** Re-send now. Used by the retry button and when the connection returns. */
  async retry() {
    if (this.status === 'conflict') return undefined;
    if (this.#pending.size) this.#set('pending');
    return this.flush();
  }

  /** `reload` must resolve after the service state, and therefore `setRevision`, is current. */
  async resolveConflict(choice, reload) {
    if (choice === 'latest') this.#pending.clear();
    this.status = 'idle';
    await reload();
    if (choice === 'mine' && this.#pending.size) { this.#set('pending'); await this.flush(); } else this.#set('saved');
  }

  dispose() {
    if (this.#timer !== null) this.#cancel(this.#timer);
    this.#timer = null;
    this.#disposed = true;
  }
}
