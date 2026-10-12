import type { Artifact, Bootstrap, InputContext, Message, Run } from '../../../src/types';
import type { Company, Product, LibraryDocument } from '../../../src/library/types';
import type { Journal, Pending } from './journal';
import { validMuseDraft } from './muse-drafts';
import type { MuseDraft } from './muse-drafts';
import { inquiryValid } from './procurement';
import type { Inquiry } from './procurement';
import { publicListingFields } from './supplier-view';
import type { SupplierProfile, PublicListingField } from './supplier-view';
import { validSupplier,validSupplierSample } from './supplier';
import {validNotification,notificationExecutable} from './notification';
import type {NotificationBinding,SubscriptionChallenge,SubscriptionReference,NotificationResponse,NotificationOperation} from './notification';
import { validPublication, canReviewDraftRepair } from './publication';
import type { PublicationOperation, PublicationState, PublicationResponse } from './publication';
import type { SupplierService, SupplierMonitor, SupplierSummary } from './supplier';

export type Session = { authenticated: boolean; csrfToken: string | null; user: { id: string; role: string } | null; expiresAt: string | null; mode: string };
export type FileReference = { id: string; version: number; sha256: string; filename: string; mimeType?: string };
export type References = { conversationId: string; revision: number; products: { productId: string; productRevision: number }[]; documents: { documentId: string; documentVersion: number }[] };
export type Card = { id: string; title: string; detail: string; runId?: string; proposalId?: string; conversationId?: string; stateKey?: string; operation?: 'approve' | 'deny' | 'resume' | 'recover' | 'cancel' | 'dispatch' | 'accept' | 'refresh'; file?: FileReference; kind: string; muse?: boolean; orderId?: string; reviewHash?: string; receiptHash?: string };
export type MuseDelegation = { conversationId: string; orderId: string; reviewHash: string; review: { product: string; market: string; objective: string; budgetCredits: number }; phase: string; receiptHash: string | null; returnedHash: string | null; receipt: { files: FileReference[] } | null };
type Transport = Pick<typeof wx, 'request' | 'downloadFile' | 'getFileSystemManager' | 'login'> & Partial<Pick<typeof wx,'requestSubscribeMessage'>>;
export type Options = { baseUrl: string; notificationBinding?: (context:{conversationId:string;serviceId:string;monitorId:string})=>Promise<NotificationBinding|null>; goalMode?: 'muse'; allowLoopback?: boolean; journal?: Journal; loginBroker?: (code: string) => Promise<{ session: Session; token: string }> };
const blank = (): InputContext => ({ artifacts: [], skills: [], memoryIds: [], connectorActions: [] });
const extensionTypes: Record<string, string> = { txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
export class ClientError extends Error { constructor(public code: string, message: string, public status?: number) { super(message); } }

/** Same business API and shared schema as the web client; no DOM, cookie jar,
 * SSE or execution loop. Polling only invalidates a server-owned snapshot. */
export class WorkspaceClient {
  session: Session | null = null;
  private token = '';
  private pending: Pending | null = null;
  private owner = '';
  private conversationId = '';
  private inFlight: { key: string; promise: Promise<unknown> } | null = null;
  private publicationRequests: Pending[] = [];
  private notificationSubscriptions:SubscriptionReference[]=[];
  private completed = new Map<string, unknown>();
  private opening: Promise<string> | null = null;
  private loggingIn: Promise<Session> | null = null;
  private snapshot: Bootstrap | null = null;
  private originalMuseId = '';
  private intakeCapable = false;
  private drafts: MuseDraft[] = [];
  constructor(private platform: Transport, private options: Options) {}
  get requiresOriginalMuse() { return this.options.goalMode === 'muse'; }
  get museDraftCapable() { return this.intakeCapable; }
  get supplierCapable() { return this.snapshot?.runtime?.capabilities?.includes('private-supplier-profile-proposals') === true; }
  private base() {
    const url = this.options.baseUrl;
    if (!/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/i.test(url) && !(this.options.allowLoopback && /^http:\/\/127\.0\.0\.1:[0-9]+$/.test(url))) throw new ClientError('SERVICE_SETUP_REQUIRED', '开发版尚未绑定已授权的企业服务。');
    return url;
  }
  private headers(mutating = false) {
    return { 'content-type': 'application/json', 'X-Workspace-Client': 'wechat', ...(this.token ? { 'X-Workspace-Session': this.token } : {}), ...(mutating && this.session?.csrfToken ? { 'X-CSRF-Token': this.session.csrfToken, Origin: this.base() } : {}) };
  }
  request<T>(path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', data?: Record<string, unknown>): Promise<T> {
    const base = this.base();
    if (!/^\/[a-zA-Z0-9_?&=.%:/-]+$/.test(path) || path.startsWith('//')) throw new ClientError('INVALID_PATH', '无效的业务接口。');
    return new Promise((resolve, reject) => {
      this.platform.request<Record<string, unknown>>({ url: `${base}/api${path}`, method, data, header: this.headers(method !== 'GET'), timeout: 10000, redirect: 'manual',
        success: result => {
          if (result.statusCode < 200 || result.statusCode >= 300) {
            if (result.statusCode === 401 || result.statusCode === 403 && (result.data?.error as { code?: string })?.code === 'CSRF_REJECTED') { this.token = ''; this.session = null; }
            const error = result.data?.error as { code?: string; message?: string } | undefined;
            reject(new ClientError(result.statusCode >= 500 && method !== 'GET' ? 'RESULT_UNCERTAIN' : error?.code || 'API_ERROR', error?.message || '操作未完成，请核对服务状态。', result.statusCode));
          } else resolve(result.data as T);
        }, fail: () => reject(new ClientError(method === 'GET' ? 'NETWORK_ERROR' : 'RESULT_UNCERTAIN', method === 'GET' ? '暂时无法连接，请重试读取。' : '操作结果尚未确认；请核对原请求，不要新建重复操作。')) });
    });
  }
  async initialize() {
    this.session = await this.request<Session>('/session');
    if (this.session.authenticated) {
      const owner = this.session.user?.id || (this.options.allowLoopback && this.session.mode === 'local' ? 'local' : '');
      if (!owner) throw new ClientError('LOGIN_REQUIRED', '企业会话缺少可核对的账号。');
      if (owner !== this.owner) {
        this.pending = null; this.publicationRequests=[]; this.notificationSubscriptions=[]; this.completed.clear(); this.conversationId = ''; this.owner = ''; this.snapshot = null; this.originalMuseId = ''; this.drafts = [];
        const saved = this.options.journal?.read(owner, this.base());
        if (saved && (saved.version !== 1 || typeof saved.conversationId !== 'string' || saved.pending && (!['send', 'action', 'upload', 'references', 'create', 'intake', 'prepare', 'reject', 'procurement-bind', 'procurement-reply', 'supplier-intake', 'supplier-profile', 'supplier-preview', 'supplier-operation', 'publication-review', 'publication-decision', 'publication-execute', 'publication-reconcile','notification-challenge','notification-record','notification-review','notification-decision','notification-execute','notification-cancel','notification-revoke'].includes(saved.pending.kind) || typeof saved.pending.path !== 'string' || typeof saved.pending.key !== 'string' || !saved.pending.body || typeof saved.pending.body !== 'object'))) throw new ClientError('RECOVERY_RECORD_INVALID', '原请求恢复记录无法核对，未启用新的提交。');
        if (saved?.version === 1 && saved.owner === owner && saved.baseUrl === this.base()) {
          this.conversationId = saved.conversationId;
          this.notificationSubscriptions=Array.isArray(saved.notificationSubscriptions)?saved.notificationSubscriptions.filter(item=>typeof item.monitorId==='string'&&typeof item.subscriptionId==='string'&&typeof item.recipientBindingId==='string'&&Number.isInteger(item.bindingRevision)&&/^[a-f0-9]{64}$/.test(item.monitorHash)).slice(-20):[];
          this.publicationRequests=Array.isArray(saved.publicationRequests)?saved.publicationRequests.filter(item=>item.kind.startsWith('publication-')&&typeof item.path==='string'&&item.body&&typeof item.body.requestId==='string').slice(-30):[];
          if (saved.pending && typeof saved.pending.path === 'string' && typeof saved.pending.key === 'string' && saved.pending.body && typeof saved.pending.body === 'object') this.pending = saved.pending;
        }
        this.owner = owner;
      }
    }
    return this.session;
  }
  login() {
    if (this.loggingIn) return this.loggingIn;
    this.loggingIn = this.performLogin().finally(() => { this.loggingIn = null; });
    return this.loggingIn;
  }
  private async performLogin() {
    if (!this.options.loginBroker) throw new ClientError('LOGIN_INTEGRATION_REQUIRED', '微信身份尚未接入企业授权；需要部署方绑定真实账号。');
    this.base(); // No WeChat-code acquisition without a configured service.
    const code = await new Promise<string>((resolve, reject) => this.platform.login({ success: result => result.code ? resolve(result.code) : reject(new ClientError('LOGIN_REQUIRED', '微信登录未取得授权码。')), fail: () => reject(new ClientError('LOGIN_REQUIRED', '微信登录未完成。')) }));
    const result = await this.options.loginBroker(code);
    if (!/^[A-Za-z0-9_-]{43}$/.test(result.token) || !result.session.authenticated) throw new ClientError('LOGIN_REQUIRED', '企业授权未完成。');
    this.token = result.token;
    try {
      // The broker cannot grant a role. Verify the actual existing enterprise
      // session through the same signed ingress before presenting login success.
      const actual = await this.initialize();
      if (!actual.authenticated || !actual.user || actual.user.id !== result.session.user?.id) throw new ClientError('LOGIN_IDENTITY_MISMATCH', '微信身份与实际企业会话未核对一致。');
      this.session = actual;
      return actual;
    } catch (error) { this.token = ''; this.session = null; this.owner = ''; this.pending = null; this.publicationRequests=[]; this.notificationSubscriptions=[]; this.snapshot = null; this.completed.clear(); throw error; }
  }
  async bootstrap() { const snapshot = await this.request<Bootstrap & { museBinding?: { conversationId?: string; originalBinding?: boolean } }>('/bootstrap'); this.snapshot = snapshot; this.originalMuseId = snapshot.museBinding?.originalBinding === true ? snapshot.museBinding.conversationId || '' : ''; this.intakeCapable = snapshot.runtime?.capabilities?.includes('inert-muse-draft-proposals') === true; return snapshot; }
  existingBusinessConversation(snapshot: Bootstrap & { museBinding?: { conversationId?: string; originalBinding?: boolean } }) {
    const native = snapshot.museBinding?.originalBinding ? snapshot.museBinding.conversationId : '';
    return [this.pending?.conversationId, native, this.conversationId].find(id => id && snapshot.conversations.some(value => value.id === id && (id === native || value.createdBy === this.owner))) || snapshot.conversations.find(value => value.createdBy === this.owner)?.id || '';
  }
  async mainConversation(snapshot: Bootstrap & { museBinding?: { conversationId?: string; originalBinding?: boolean } }, purpose: 'goal' | 'business' = 'goal') {
    const native = snapshot.museBinding?.conversationId;
    if (purpose === 'goal' && this.requiresOriginalMuse && (snapshot.museBinding?.originalBinding !== true || !native || !snapshot.conversations.some(value => value.id === native))) throw new ClientError('MUSE_ORIGINAL_BINDING_REQUIRED', '当前账号尚未读取到原 Muse 会话绑定，请由服务负责人恢复授权关联。');
    if (this.requiresOriginalMuse && native && snapshot.museBinding?.originalBinding && snapshot.conversations.some(value => value.id === native)) { this.conversationId = native; this.save(); return native; }
    const known = purpose === 'business' ? this.existingBusinessConversation(snapshot) : [this.pending?.conversationId, native, this.conversationId].find(id => id && snapshot.conversations.some(value => value.id === id)) || snapshot.conversations[0]?.id;
    if (known) {
      if (this.pending?.kind === 'create') {
        const exact = snapshot.conversations.find(value => value.creationRequestId === this.pending?.body.requestId && value.createdBy === this.owner);
        if (exact) { this.pending = null; this.conversationId = exact.id; this.save(); return exact.id; }
      }
      this.conversationId = known; this.save(); return known;
    }
    if (this.pending) throw new ClientError('RESULT_UNCERTAIN', '原会话创建或操作结果尚未确认，请重新读取云端状态。');
    if (this.opening) return this.opening;
    const requestId = this.requestId();
    this.opening = this.commit({ kind: 'create', path: '/conversations', body: { title: '主会话', requestId }, key: requestId }).then(result => {
      this.conversationId = (result as { conversation: { id: string } }).conversation.id; this.save(); return this.conversationId;
    }).finally(() => { this.opening = null; });
    return this.opening;
  }
  private requestId() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, letter => { const value = Math.floor(Math.random() * 16); return (letter === 'x' ? value : (value & 3) | 8).toString(16); }); }
  async send(conversationId: string, content: string, artifacts: FileReference[] = []) {
    if (!content.trim()) throw new ClientError('INPUT_REQUIRED', '说说你想完成的事。');
    if (this.requiresOriginalMuse) return this.sendMuseDraft(conversationId, content, artifacts);
    if (this.pending) throw new ClientError('RESULT_UNCERTAIN', '先核对上一条原请求的结果。');
    const original = this.snapshot?.conversations.find(value => value.id === conversationId)?.inputContext;
    const inputContext: InputContext = original ? JSON.parse(JSON.stringify(original)) : blank();
    // Existing policy does not parse PDF/images or export private library assets.
    inputContext.artifacts = [...inputContext.artifacts, ...artifacts.filter(value => ['text/plain', 'text/markdown', 'text/csv', 'application/json'].includes(value.mimeType || '')).map(value => ({ id: value.id, version: value.version }))].filter((value, index, values) => values.findIndex(item => item.id === value.id && item.version === value.version) === index);
    const body = { content: content.trim(), requestId: this.requestId(), inputContext, workspaceExecution: true, provider: 'pi' };
    return this.commit({ kind: 'send', conversationId, path: `/conversations/${encodeURIComponent(conversationId)}/messages`, body, key: body.requestId }) as Promise<{ run: Run }>;
  }
  private save() {
    if (this.owner) this.options.journal?.write({ version: 1, owner: this.owner, baseUrl: this.base(), conversationId: this.conversationId, pending: this.pending, publicationRequests:this.publicationRequests,notificationSubscriptions:this.notificationSubscriptions });
  }
  private commit(command: Pending): Promise<unknown> {
    if (this.inFlight?.key === command.key) return this.inFlight.promise;
    if (this.completed.has(command.key)) return Promise.resolve(this.completed.get(command.key));
    if (this.pending || this.inFlight) return Promise.reject(new ClientError('RESULT_UNCERTAIN', '先核对上一条原请求的结果。'));
    this.pending = command;
    if(command.kind.startsWith('publication-'))this.publicationRequests=[...this.publicationRequests.filter(item=>item.body.requestId!==command.body.requestId),JSON.parse(JSON.stringify(command))].slice(-30);
    try { this.save(); } catch (error) { this.pending = null; return Promise.reject(error); }
    return this.executePending();
  }
  private executePending(): Promise<unknown> {
    const command = this.pending;
    if (!command) return Promise.reject(new ClientError('NO_PENDING_REQUEST', '没有需要核对的原请求。'));
    if (this.inFlight) return this.inFlight.promise;
    const promise = this.request(command.path, 'POST', command.body).then(result => {
      if(command.kind==='notification-record')this.rememberSubscription(command,result);
      if(command.kind==='notification-revoke')this.notificationSubscriptions=this.notificationSubscriptions.filter(item=>item.subscriptionId!==command.body.subscriptionId);
      this.pending = null; if ((['action', 'prepare', 'reject', 'procurement-bind', 'procurement-reply', 'supplier-preview', 'supplier-operation','publication-review','publication-decision','publication-execute'].includes(command.kind) || command.kind.startsWith('notification-')) && !command.path.endsWith('/refresh')) this.completed.set(command.key, result); this.save(); return result;
    }).catch(error => {
      // A response-lost or server-error request retains its exact original body.
      if (error instanceof ClientError && !['RESULT_UNCERTAIN', 'NETWORK_ERROR'].includes(error.code) && error.status !== 401 && error.code !== 'CSRF_REJECTED') { this.pending = null; this.save(); }
      throw error;
    }).finally(() => { this.inFlight = null; });
    this.inFlight = { key: command.key, promise }; return promise;
  }
  async retryPending() {
    if (!this.pending) throw new ClientError('NO_PENDING_REQUEST', '没有需要核对的原请求。');
    if (this.inFlight) return this.inFlight.promise;
    const command = this.pending;
    if(command.kind==='notification-execute')return this.readPendingNotification(command);
    if(command.kind==='publication-execute')return this.readPendingPublication(command);
    // Decisions have no server idempotency key. Read their exact resulting state
    // before replaying the same decision; never infer consent from message text.
    if (command.kind === 'action' && command.path.endsWith('/action-decision')) {
      const runId = decodeURIComponent(command.path.split('/')[2]);
      const { run } = await this.request<{ run: Run }>(`/runs/${encodeURIComponent(runId)}`);
      const proposal = run.proposals?.find(value => value.id === command.body.proposalId);
      if (proposal?.status === command.body.decision || command.body.decision === 'approved' && ['executing', 'succeeded', 'failed', 'uncertain', 'interrupted'].includes(proposal?.status || '')) {
        this.pending = null; this.save(); return { run, reconciled: true };
      }
      if (proposal?.status !== 'pending') throw new ClientError('ACTION_RECONCILIATION_REQUIRED', '原审批已发生变化，请核对云端回执。');
    }
    if (command.kind === 'create' && typeof command.body.requestId !== 'string') throw new ClientError('CONVERSATION_RECONCILIATION_REQUIRED', '旧创建请求缺少原 requestId，不能盲目重建。');
    const result = await this.executePending();
    if (command.kind === 'create') { this.conversationId = (result as { conversation: { id: string } }).conversation.id; this.save(); }
    return result;
  }
  retrySend() { return this.retryPending() as Promise<{ run: Run }>; }
  get uncertain() { return Boolean(this.pending); }
  get pendingKind() { return this.pending?.kind || ''; }
  get pendingDraft() { return ['send', 'intake', 'procurement-reply', 'supplier-intake'].includes(this.pending?.kind || '') ? String(this.pending!.body.content) : ''; }
  get pendingInquiryId() { return this.pending?.kind.startsWith('procurement-') ? decodeURIComponent(this.pending.path.split('/')[3]) : ''; }
  get publicationRequestHistory(){return JSON.parse(JSON.stringify(this.publicationRequests)) as Pending[];}
  get pendingNotificationMonitorId(){return this.pending?.kind.startsWith('notification-')?String(this.pending.body.monitorId||''):'';}
  get pendingPublicationOperationId(){return this.pending?.kind.startsWith('publication-')?String(this.pending.body.operationId||''):'';}
  get pendingSupplierId() { return (this.pending?.kind.startsWith('supplier-')||this.pending?.kind.startsWith('publication-')||this.pending?.kind.startsWith('notification-')) ? decodeURIComponent(this.pending.path.split('/')[4] || '') : ''; }
  get pendingSummary() { return this.pending ? `${this.pending.review ? `${this.pending.review.title}\n${this.pending.review.detail}\n\n` : ''}原请求 ${this.pending.path}\n${this.pending.kind === 'upload' ? String(this.pending.body.filename) : JSON.stringify(this.pending.body, null, 2)}` : ''; }
  async logout() { await this.request('/session/logout', 'POST', {}); this.token = ''; this.session = null; this.owner = ''; this.pending = null; this.publicationRequests=[]; this.notificationSubscriptions=[]; this.conversationId = ''; this.originalMuseId = ''; this.drafts = []; this.completed.clear(); }
  private assertOriginalMuse(conversationId: string) { if (!this.originalMuseId || conversationId !== this.originalMuseId) throw new ClientError('MUSE_ORIGINAL_BINDING_REQUIRED', '当前账号尚未读取到原 Muse 会话绑定；没有发送替代 Pi 请求。'); if (!this.intakeCapable) throw new ClientError('MUSE_DRAFT_UNAVAILABLE', '当前服务尚未提供原 Muse 草案能力，未发送替代 Pi 请求。'); }
  async museDrafts(conversationId: string) {
    this.assertOriginalMuse(conversationId);
    const result = await this.request<{ drafts: MuseDraft[] }>(`/conversations/${encodeURIComponent(conversationId)}/muse-drafts`);
    if (!Array.isArray(result.drafts) || !result.drafts.every(draft => validMuseDraft(draft, conversationId))) throw new ClientError('MUSE_DRAFT_RESPONSE_INVALID', '服务端草案格式无法核对，未启用准备操作。');
    this.drafts = result.drafts; return result;
  }
  async sendMuseDraft(conversationId: string, content: string, artifacts: FileReference[] = []) {
    this.assertOriginalMuse(conversationId);
    if (this.pending) throw new ClientError('RESULT_UNCERTAIN', '先核对上一条原请求的结果。');
    if (!content.trim()) throw new ClientError('INPUT_REQUIRED', '说说目标或需要补充的信息。');
    const active = [...this.drafts].reverse().find(value => value.conversationId === conversationId && !['prepared', 'rejected'].includes(value.phase));
    if (active && ['pending', 'preparing', 'rejecting'].includes(active.phase)) throw new ClientError('MUSE_DRAFT_BUSY', '请先读取当前草案或原操作的核对结果。');
    if (content.trim().length > 4000) throw new ClientError('MUSE_DRAFT_INPUT', '本次文字请控制在4000字以内。');
    const inputContext = blank();
    inputContext.artifacts = artifacts.filter(value => ['text/plain', 'text/markdown', 'text/csv', 'application/json'].includes(value.mimeType || '')).map(value => ({ id: value.id, version: value.version }));
    const selected = (await this.references(conversationId)).libraryReferences.products;
    const productReference = selected.length === 1 ? selected[0] : null;
    const requestId = this.requestId(), body = { requestId, content: content.trim(), productReference, ...(inputContext.artifacts.length ? { inputContext } : {}), ...(active ? { expectedRevision: active.revision } : {}) };
    const path = `/conversations/${encodeURIComponent(conversationId)}/muse-drafts${active ? `/${encodeURIComponent(active.id)}/messages` : ''}`;
    return this.commit({ kind: 'intake', conversationId, path, body, key: requestId }) as Promise<{ draftId: string; revision: number; run: Run }>;
  }
  async prepareMuseDraft(draft: MuseDraft, budgetConfirmed: boolean, deadlineConfirmed: boolean, publicDataConfirmed: boolean) {
    this.assertOriginalMuse(draft.conversationId);
    if (!budgetConfirmed || !deadlineConfirmed || !publicDataConfirmed || draft.phase !== 'ready_for_review' || draft.missingFields.length || !draft.draftHash) throw new ClientError('MUSE_DRAFT_CONFIRMATION', '请审阅完整草案并分别确认预算、期限与公开文字范围。');
    const body = { requestId: this.requestId(), expectedRevision: draft.revision, expectedDraftHash: draft.draftHash, confirmed: true, budgetConfirmed: true, deadlineConfirmed: true, publicDataConfirmed: true };
    return this.commit({ kind: 'prepare', conversationId: draft.conversationId, path: `/conversations/${encodeURIComponent(draft.conversationId)}/muse-drafts/${encodeURIComponent(draft.id)}/prepare`, body, key: JSON.stringify(['prepare', draft.id, draft.revision, draft.draftHash]), review: { title: '准备待审原订单', detail: JSON.stringify(draft.scope, null, 2) } });
  }
  async rejectMuseDraft(draft: MuseDraft, confirmed: boolean) {
    this.assertOriginalMuse(draft.conversationId);
    if (!confirmed || ['preparing', 'rejecting', 'rejected'].includes(draft.phase)) throw new ClientError('MUSE_DRAFT_CONFIRMATION', '请先核对原操作，再明确拒绝本次草案。');
    const body = { requestId: this.requestId(), expectedRevision: draft.revision, expectedDraftHash: draft.draftHash, confirmed: true };
    return this.commit({ kind: 'reject', conversationId: draft.conversationId, path: `/conversations/${encodeURIComponent(draft.conversationId)}/muse-drafts/${encodeURIComponent(draft.id)}/reject`, body, key: JSON.stringify(['reject', draft.id, draft.revision, draft.draftHash]), review: { title: '拒绝原草案', detail: draft.publicText } });
  }
  async action(card: Card, confirmed: boolean, conversationId?: string) {
    if (!confirmed) throw new ClientError('APPROVAL_REQUIRED', '需要明确确认本次具体操作。');
    if (card.muse) {
      if (!conversationId || !card.orderId || !card.reviewHash || !['approve', 'dispatch', 'accept', 'cancel', 'refresh'].includes(card.operation || '')) throw new ClientError('INVALID_ACTION', '需要核对原 Muse 订单与本次具体操作。');
      if (!/^[a-f0-9]{64}$/.test(card.reviewHash) || card.conversationId && card.conversationId !== conversationId || card.operation === 'accept' && !/^[a-f0-9]{64}$/.test(card.receiptHash || '')) throw new ClientError('INVALID_ACTION', '原订单范围或回执需要重新核对。');
      const path = `/conversations/${encodeURIComponent(conversationId)}/muse-delegations/${encodeURIComponent(card.orderId)}/${card.operation}`;
      const body = { confirmed: true, expectedReviewHash: card.reviewHash, ...(card.operation === 'accept' ? { receiptHash: card.receiptHash } : {}) };
      return this.commit({ kind: 'action', conversationId, path, body, key: JSON.stringify([path, body]), review: { title: card.title, detail: card.detail } });
    }
    if (!card.runId) throw new ClientError('INVALID_ACTION', '需要核对原运行。');
    const id = encodeURIComponent(card.runId);
    if (['approve', 'deny', 'resume'].includes(card.operation || '') && !card.proposalId || card.conversationId && conversationId && card.conversationId !== conversationId) throw new ClientError('INVALID_ACTION', '需要核对本次准确审批对象。');
    const path = `/runs/${id}/${card.operation === 'approve' || card.operation === 'deny' ? 'action-decision' : card.operation === 'recover' ? 'retry' : card.operation}`;
    const key = JSON.stringify([this.owner, path, card.proposalId || '', card.operation, card.stateKey || '']);
    const body = card.operation === 'approve' || card.operation === 'deny' ? { proposalId: card.proposalId, decision: card.operation === 'approve' ? 'approved' : 'denied', confirmed: true } : card.operation === 'resume' ? { proposalId: card.proposalId, requestId: this.requestId() } : card.operation === 'recover' ? { requestId: this.requestId() } : {};
    if (['approve', 'deny', 'resume', 'recover', 'cancel'].includes(card.operation || '')) return this.commit({ kind: 'action', conversationId, path, body, key, review: { title: card.title, detail: card.detail } });
    throw new ClientError('INVALID_ACTION', '未知操作。');
  }
  async library() {
    const [products, company, documents] = await Promise.all([this.request<{ items: Product[] }>('/library/products'), this.request<{ company: Company }>('/library/company'), this.request<{ items: LibraryDocument[] }>('/library/documents')]);
    return { products: products.items, company: company.company, documents: documents.items };
  }
  async procurement(conversationId = '') {
    const [inbox, associated] = await Promise.all([this.request<{ inquiries: Inquiry[] }>('/supply/inquiries'), conversationId ? this.request<{ inquiries: Inquiry[] }>(`/conversations/${encodeURIComponent(conversationId)}/procurement`) : Promise.resolve({ inquiries: [] as Inquiry[] })]);
    if (!Array.isArray(inbox.inquiries) || !Array.isArray(associated.inquiries)) throw new ClientError('PROCUREMENT_RESPONSE_INVALID', '原采购共享范围无法核对，未启用关联或回复。');
    const activeInbox = inbox.inquiries.filter(value => value.share?.status === 'active'), activeAssociated = associated.inquiries.filter(value => value.share?.status === 'active');
    if ([...activeInbox, ...activeAssociated].some(value => !inquiryValid(value))) throw new ClientError('PROCUREMENT_RESPONSE_INVALID', '原采购共享范围无法核对，未启用关联或回复。');
    return { inbox: activeInbox.filter(value => !value.merchantConversation), associated: activeAssociated };
  }
  async bindProcurement(inquiry: Inquiry, conversationId: string, confirmed: boolean) {
    if (!confirmed || !conversationId || !inquiryValid(inquiry) || inquiry.merchantConversation) throw new ClientError('SUPPLY_CONFIRMATION_REQUIRED', '请明确确认当前已共享需求与本会话。');
    const body = { requestId: this.requestId(), expectedRevision: inquiry.revision, conversationId, confirmed: true };
    return this.commit({ kind: 'procurement-bind', conversationId, path: `/supply/inquiries/${encodeURIComponent(inquiry.id)}/conversation`, body, key: JSON.stringify(['procurement-bind', inquiry.id, inquiry.revision, conversationId]), review: { title: '关联本会话', detail: JSON.stringify(inquiry.share?.snapshot) } });
  }
  async replyProcurement(inquiry: Inquiry, conversationId: string, content: string, confirmed: boolean) {
    if (!confirmed || !inquiryValid(inquiry) || inquiry.merchantConversation?.conversationId !== conversationId) throw new ClientError('SUPPLY_CONFIRMATION_REQUIRED', '请先关联本会话并明确确认本次回复原采购方的范围。');
    if (!content.trim() || content.trim().length > 2400) throw new ClientError('SUPPLY_INPUT_INVALID', '回复请使用1至2400字的明确文字。');
    const body = { requestId: this.requestId(), expectedRevision: inquiry.revision, expectedShareHash: inquiry.share!.reviewHash, content: content.trim(), confirmed: true };
    return this.commit({ kind: 'procurement-reply', conversationId, path: `/supply/inquiries/${encodeURIComponent(inquiry.id)}/reply`, body, key: JSON.stringify(['procurement-reply', inquiry.id, inquiry.revision, inquiry.share!.reviewHash, body.content]), review: { title: '回复原采购方', detail: content.trim() } });
  }
  private supplierPath(conversationId: string, serviceId = '') {
    if (!conversationId) throw new ClientError('CONVERSATION_REQUIRED', '请先读取原业务会话。');
    return `/conversations/${encodeURIComponent(conversationId)}/supplier-services${serviceId ? `/${encodeURIComponent(serviceId)}` : ''}`;
  }
  async supplierServices(conversationId: string) {
    const value = await this.request<{services: SupplierService[]}>(this.supplierPath(conversationId));
    if (!Array.isArray(value.services) || value.services.some(item=>!validSupplier(item,conversationId))) throw new ClientError('SUPPLIER_RESPONSE_INVALID','原商品服务范围无法核对，请重新读取。');
    return value.services;
  }
  async supplierDetail(conversationId: string, id: string) {
    const value = await this.request<{service: SupplierService}>(this.supplierPath(conversationId,id));
    if (!validSupplier(value.service,conversationId)) throw new ClientError('SUPPLIER_RESPONSE_INVALID','原商品修订无法核对。'); return value.service;
  }
  supplierCatalog() { return this.request<{name:string;services:{id:string;writesEnabled:boolean;shopify:{configured:boolean}}[]}>('/agent-services'); }
  async supplierMonitors(conversationId: string, id: string) {
    const value = await this.request<{monitors:SupplierMonitor[]}>(this.supplierPath(conversationId,id)+'/monitors');
    if (!Array.isArray(value.monitors) || value.monitors.some(item=>item.serviceId!==id || item.conversationId!==conversationId || !/^[a-f0-9]{64}$/.test(item.scopeHash) || !item.scope || typeof item.scheduleEnabled!=='boolean'||!validSupplierSample(item.latestSample)||!validSupplierSample(item.summary)||item.notification&&!validNotification(item.notification,conversationId,id,item.id))) throw new ClientError('SUPPLIER_MONITOR_INVALID','原监测范围无法核对。');
    return value.monitors;
  }
  supplierSummary(conversationId:string,id:string,monitorId:string) {return this.request<{summary:SupplierSummary|null}>(this.supplierPath(conversationId,id)+'/monitor-summary/'+encodeURIComponent(monitorId));}
  async supplierIntake(conversationId: string, content: string, target?: { id: string; revision: number }) {
    if (!content.trim() || content.trim().length > 4000) throw new ClientError('SUPPLIER_INPUT_REQUIRED', '请使用1至4000字说明商品信息或需要补充的事实。');
    if (target && (!target.id || !Number.isInteger(target.revision) || target.revision < 1)) throw new ClientError('SUPPLIER_REVISION_REQUIRED', '请先读取原商品修订。');
    const requestId = this.requestId(), body = { requestId, content: content.trim(), ...(target ? { expectedRevision: target.revision } : {}) };
    return this.commit({ kind: 'supplier-intake', conversationId, path: this.supplierPath(conversationId, target?.id) + (target ? '/messages' : ''), body, key: requestId });
  }
  async supplierProfile(conversationId: string, target: { id: string; revision: number }, facts: Partial<SupplierProfile>) {
    if (!target.id || !Number.isInteger(target.revision) || target.revision < 1) throw new ClientError('SUPPLIER_REVISION_REQUIRED', '请先读取原商品修订。');
    const body = { requestId: this.requestId(), expectedRevision: target.revision, facts };
    return this.commit({ kind: 'supplier-profile', conversationId, path: this.supplierPath(conversationId, target.id) + '/profile', body, key: body.requestId, review: { title: '保存原商品事实', detail: JSON.stringify(facts, null, 2) } });
  }
  async supplierPreview(conversationId: string, target: { id: string; revision: number }, fields: PublicListingField[], confirmed: boolean) {
    if (!confirmed || !target.id || !Number.isInteger(target.revision) || target.revision < 1 || !fields.length || new Set(fields).size !== fields.length || fields.some(field => !publicListingFields.includes(field))) throw new ClientError('SUPPLIER_CONFIRMATION_REQUIRED', '请明确确认当前原商品修订和本次预览的准确字段。');
    const body = { requestId: this.requestId(), expectedRevision: target.revision, confirmed: true, publicFields: [...fields] };
    return this.commit({ kind: 'supplier-preview', conversationId, path: this.supplierPath(conversationId, target.id) + '/preview', body, key: JSON.stringify(['supplier-preview', conversationId, target.id, target.revision, fields]), review: { title: '本次商品预览范围', detail: JSON.stringify({ serviceId: target.id, revision: target.revision, publicFields: fields }, null, 2) } });
  }
  async supplierOperation(conversationId:string,id:string,action:'save-product'|'shopify-draft'|'shopify-observation'|'monitors'|'monitor-check'|'monitor-stop'|'cancel'|'reject',data:Record<string,unknown>,detail:string) {
    if (!id || data.confirmed!==true) throw new ClientError('SUPPLIER_CONFIRMATION_REQUIRED','请明确确认当前原商品或监测的准确范围。');
    if (['monitor-check','monitor-stop'].includes(action)) {if (typeof data.monitorId!=='string' || !/^[a-f0-9]{64}$/.test(String(data.expectedMonitorHash))) throw new ClientError('SUPPLIER_MONITOR_INVALID','请读取原监测对象和 hash。');}
    else if (!Number.isInteger(data.expectedRevision) || Number(data.expectedRevision)<1) throw new ClientError('SUPPLIER_REVISION_REQUIRED','请读取原商品修订。');
    if (['cancel','reject'].includes(action) && !/^[a-f0-9]{64}$/.test(String(data.expectedProfileHash))) throw new ClientError('SUPPLIER_REVISION_REQUIRED','请审阅原商品的准确 profile hash。');
    const body={...data,requestId:this.requestId()},key=action==='monitor-check'?body.requestId:JSON.stringify(['supplier-operation',conversationId,id,action,data]);
    return this.commit({kind:'supplier-operation',conversationId,path:this.supplierPath(conversationId,id)+'/'+action,body,key,review:{title:action,detail}});
  }
  async supplierImage(conversationId:string,service:SupplierService,index:number) {
    const source=service.profile.images[index];if(!Number.isInteger(index)||index<0||!source)throw new ClientError('FILE_REFERENCE_INVALID','原图片引用需要重新核对。');if(source.kind!=='artifact') throw new ClientError('SUPPLIER_IMAGE_UNAVAILABLE','公开 URL 尚未授权观察，请使用可核对的原图片。');
    const filePath=await new Promise<string>((resolve,reject)=>this.platform.downloadFile({url:this.base()+'/api'+this.supplierPath(conversationId,service.id)+'/images/'+index,header:this.headers(),success:result=>result.statusCode===200?resolve(result.tempFilePath):reject(new ClientError('SUPPLIER_IMAGE_UNAVAILABLE','原图片权限或版本无法核对。')),fail:()=>reject(new ClientError('FILE_DOWNLOAD_FAILED','原图片读取未完成。'))}));
    const hash=await new Promise<string>((resolve,reject)=>this.platform.getFileSystemManager().getFileInfo({filePath,digestAlgorithm:'sha256',success:result=>resolve(result.digest),fail:()=>reject(new ClientError('FILE_VERIFY_FAILED','原图片 SHA 校验未完成。'))}));
    if(hash!==source.asset.sha256) throw new ClientError('FILE_HASH_MISMATCH','原图片字节与 SHA 不符，已拒绝显示。');return filePath;
  }
  subscriptionReference(monitor:SupplierMonitor){return this.notificationSubscriptions.find(item=>item.monitorId===monitor.id&&item.monitorHash===monitor.scopeHash&&item.state==='available')||null;}
  private rememberSubscription(command:Pending,result:unknown){const r=result as Record<string,unknown>;if(r.status==='blocked')return;
    if(typeof r.subscriptionId!=='string'||typeof r.recipientBindingId!=='string'||!Number.isInteger(r.bindingRevision)||!['available','revoked'].includes(String(r.state)))throw new ClientError('NOTIFICATION_SUBSCRIPTION_REQUIRED','可信设施没有返回可核对的原订阅引用。');
    const value={monitorId:String(command.body.monitorId),monitorHash:String(command.body.expectedMonitorHash),subscriptionId:r.subscriptionId,recipientBindingId:r.recipientBindingId,bindingRevision:Number(r.bindingRevision),state:String(r.state),evidenceKind:String(r.evidenceKind)};
    this.notificationSubscriptions=[...this.notificationSubscriptions.filter(item=>item.monitorId!==value.monitorId),value].slice(-20);
  }
  async notificationStatus(cid:string,sid:string,mid:string){const r=await this.request<NotificationResponse>(this.supplierPath(cid,sid)+'/notification-status/'+encodeURIComponent(mid));if(!validSupplier(r.service,cid)||r.service.id!==sid||r.monitorId!==mid||!validNotification(r.notification,cid,sid,mid))throw new ClientError('NOTIFICATION_SCOPE_CHANGED','原通知对象/回执无法核对。');return r;}
  async prepareNotificationSubscription(cid:string,monitor:SupplierMonitor,confirmed:boolean){
    if(!confirmed||monitor.stoppedAt)throw new ClientError('NOTIFICATION_CANCELLED','请明确确认未停止的原监测。');
    const current=await this.notificationStatus(cid,monitor.serviceId,monitor.id);
    if(current.notification.delivery.submittedAt||current.notification.delivery.cancelledAt)throw new ClientError('NOTIFICATION_ALREADY_ATTEMPTED','原七天通知已经交接/取消，不再次申请订阅或发送。');
    if(!current.notification.configured||!current.notification.enabled||!current.notification.confirmedSubscriptionProvider)throw new ClientError('NOTIFICATION_SUBSCRIPTION_PROVIDER_REQUIRED','缺可信原生订阅设施或原通知配置；没有调用微信订阅。');
    if(!this.options.notificationBinding||!this.platform.requestSubscribeMessage)throw new ClientError('NOTIFICATION_NATIVE_HOST_REQUIRED','既有宿主尚未提供可信收件人绑定读取/原生订阅 API；不接受自报 OpenID 或授权。');
    const reference=await this.options.notificationBinding({conversationId:cid,serviceId:monitor.serviceId,monitorId:monitor.id});
    if(!reference?.recipientBindingId||!Number.isInteger(reference.bindingRevision)||reference.bindingRevision<1)throw new ClientError('NOTIFICATION_RECIPIENT_CHANGED','既有宿主没有提供当前原收件人绑定引用。');
    const body={requestId:this.requestId(),monitorId:monitor.id,expectedMonitorHash:monitor.scopeHash,recipientBindingId:reference.recipientBindingId,expectedBindingRevision:reference.bindingRevision,confirmed:true};
    return this.commit({kind:'notification-challenge',conversationId:cid,path:this.supplierPath(cid,monitor.serviceId)+'/notification-subscription-challenge',body,key:body.requestId,review:{title:'准备原生一次性订阅',detail:'仅为原七天总结准备服务端challenge；后续用户另一次点击微信原生订阅。'}}) as Promise<SubscriptionChallenge&{status?:string;code?:string}>;
  }
  // Called directly from the separate explicit native-subscribe tap. No await,
  // HTTP, settings lookup, user identity or proof construction precedes wx API.
  requestNativeSubscription(cid:string,monitor:SupplierMonitor,challenge:SubscriptionChallenge,confirmed:boolean){
    if(!confirmed||this.pending||monitor.stoppedAt||!this.platform.requestSubscribeMessage||challenge.userGestureRequired!==true||!/^wx[a-f0-9]{16}$/i.test(challenge.appId)||!challenge.templateId||!challenge.challengeId||!Number.isFinite(Date.parse(challenge.expiresAt))||Date.parse(challenge.expiresAt)<=Date.now())throw new ClientError('NOTIFICATION_SUBSCRIPTION_REQUIRED','原challenge失效或原生订阅不可用，请重新准备。');
    const body={requestId:this.requestId(),monitorId:monitor.id,expectedMonitorHash:monitor.scopeHash,challengeId:challenge.challengeId,confirmed:true};
    return new Promise<string>((resolve,reject)=>this.platform.requestSubscribeMessage!({tmplIds:[challenge.templateId],success:r=>{const decision=r[challenge.templateId];if(!['accept','reject','ban','filter'].includes(decision))reject(new ClientError('NOTIFICATION_SUBSCRIPTION_REQUIRED','没有这个准确模板的原生决定；设置/errMsg不构成授权。'));else resolve(decision);},fail:()=>reject(new ClientError('NOTIFICATION_NATIVE_REQUEST_FAILED','微信原生订阅未完成；没有保存accept或通知授权。'))})).then(decision=>this.commit({kind:'notification-record',conversationId:cid,path:this.supplierPath(cid,monitor.serviceId)+'/notification-subscription-record',body:{...body,decision},key:body.requestId,review:{title:'核对原生订阅决定',detail:'服务端既有可信设施须核对准确会话/challenge/AppID/模板；客户端决定本身不是授权。'}}));
  }
  async reviewNotification(cid:string,monitor:SupplierMonitor,confirmed:boolean){const grant=this.subscriptionReference(monitor),summary=monitor.summary;
    if(!confirmed||!grant||monitor.stoppedAt||!summary||Date.parse(summary.endAt)>Date.now())throw new ClientError('NOTIFICATION_SUBSCRIPTION_REQUIRED','先核对完成七天窗口的总结和可信设施返回的原一次性订阅。');
    const body={requestId:this.requestId(),monitorId:monitor.id,expectedMonitorHash:monitor.scopeHash,recipientBindingId:grant.recipientBindingId,expectedBindingRevision:grant.bindingRevision,subscriptionId:grant.subscriptionId,expectedSummaryRevision:summary.revision,expectedSummaryHash:summary.contentHash,confirmed:true};
    return this.commit({kind:'notification-review',conversationId:cid,path:this.supplierPath(cid,monitor.serviceId)+'/notification-review',body,key:body.requestId,review:{title:'准备独立七天总结通知审批',detail:JSON.stringify({monitor:monitor.id,subscription:grant,summary},null,2)}}) as Promise<NotificationResponse>;
  }
  async notificationAction(cid:string,monitor:SupplierMonitor,action:'approved'|'denied'|'execute'|'cancel'|'revoke',confirmed:boolean,operation?:NotificationOperation){
    if(!confirmed)throw new ClientError('NOTIFICATION_SCOPE_CHANGED','请明确确认准确原通知动作。');
    const grant=this.subscriptionReference(monitor),decision=action==='approved'||action==='denied';
    if((decision||action==='execute')&&(!operation||operation.scope.monitorId!==monitor.id||operation.scope.monitorHash!==monitor.scopeHash)||action==='execute'&&(!monitor.notification||!notificationExecutable(monitor,monitor.notification))||action==='revoke'&&!grant)throw new ClientError('NOTIFICATION_SCOPE_CHANGED','原通知或订阅范围已变/已使用，不能执行这一动作。');
    const suffix=decision?'decision':action==='revoke'?'subscription-revoke':action,kind=decision?'notification-decision':action==='revoke'?'notification-revoke':action==='cancel'?'notification-cancel':'notification-execute';
    const body={requestId:this.requestId(),monitorId:monitor.id,...(decision||action==='execute'?{operationId:operation!.id,expectedScopeHash:operation!.scopeHash}: {expectedMonitorHash:monitor.scopeHash}),...(decision?{decision:action}:{}),...(action==='revoke'?{subscriptionId:grant!.subscriptionId}:{}),confirmed:true};
    const r=await this.commit({kind,conversationId:cid,path:this.supplierPath(cid,monitor.serviceId)+'/notification-'+suffix,body,key:JSON.stringify([kind,monitor.id,operation?.id,operation?.scopeHash,action,grant?.subscriptionId]),review:{title:'原七天总结通知动作',detail:JSON.stringify(body)}}) as NotificationResponse;
    if(action==='revoke'){this.notificationSubscriptions=this.notificationSubscriptions.filter(item=>item.subscriptionId!==grant!.subscriptionId);this.save();}return r;
  }
  private async readPendingNotification(command:Pending){const cid=command.conversationId||'',sid=decodeURIComponent(command.path.split('/')[4]||''),r=await this.notificationStatus(cid,sid,String(command.body.monitorId)),op=r.notification.review;
    if(!op||op.id!==command.body.operationId||op.scopeHash!==command.body.expectedScopeHash)throw new ClientError('NOTIFICATION_SCOPE_CHANGED','原通知操作无法核对；保留原请求，不重发。');
    const monitor=(await this.supplierMonitors(cid,sid)).find(item=>item.id===String(command.body.monitorId));if(!monitor||monitor.scopeHash!==op.scope.monitorHash)throw new ClientError('NOTIFICATION_SCOPE_CHANGED','原监测对象已变，保留准确请求。');
    if(!op.connectorRunId&&notificationExecutable(monitor,r.notification))return {...r,notAdmitted:true};
    if(op.status==='running'&&!['unknown','platform_accepted','failed','cancelled'].includes(r.notification.delivery.status))return {...r,waiting:true};
    this.pending=null;this.save();return r;
  }
  async executeUnadmittedNotification(confirmed:boolean){const command=this.pending;if(!confirmed||command?.kind!=='notification-execute')throw new ClientError('NOTIFICATION_SCOPE_CHANGED','必须再次明确确认同一原通知执行请求。');const r=await this.readPendingNotification(command);if(!r.notAdmitted||this.pending!==command)throw new ClientError('NOTIFICATION_ALREADY_ATTEMPTED','原通知已变化/执行，只能读取状态。');return this.executePending();}
  async publication(conversationId:string,serviceId:string) {
    const value=await this.request<{service:SupplierService;publication:PublicationState}>(this.supplierPath(conversationId,serviceId)+'/publication');
    if(!validSupplier(value.service,conversationId)||value.service.id!==serviceId||value.publication?.schema!=='workspace.supplier-publication.v1'||!Array.isArray(value.publication.operations)||value.publication.operations.some(op=>!validPublication(op,conversationId,serviceId))||value.publication.automaticRetry!==false)throw new ClientError('PUBLICATION_RESPONSE_INVALID','原 Shopify 审批/回执范围无法核对，未启用写入。');return value;
  }
  async reviewPublication(conversationId:string,service:SupplierService,action:'draft'|'publish',publicationId?:string,confirmed=false) {
    if(!confirmed||!service.preview||service.preview.phase!=='preview_ready'||service.preview.missingFields.length||!['draft','publish'].includes(action)||action==='publish'&&!/^gid:\/\/shopify\/Publication\/\d+$/.test(publicationId||'')||action==='draft'&&publicationId!==undefined)throw new ClientError('SUPPLIER_CONFIRMATION_REQUIRED','请审阅当前完整预览、明确草稿/图片传输或这一个精确渠道。');
    const body={requestId:this.requestId(),expectedRevision:service.revision,expectedPreviewHash:service.preview.previewHash,action,...(action==='publish'?{publicationId}:{}),confirmed:true};
    return this.commit({kind:'publication-review',conversationId,path:this.supplierPath(conversationId,service.id)+'/shopify-review',body,key:body.requestId,review:{title:'准备独立 Shopify 审批',detail:JSON.stringify({preview:service.preview,action,publicationId},null,2)}}) as Promise<PublicationResponse>;
  }
  async reviewDraftRepair(conversationId:string,service:SupplierService,original:PublicationOperation,expectedRemoteContentHash:string,approveObservedMedia:boolean,confirmed=false){
    if(!confirmed||!validPublication(original,conversationId,service.id)||!canReviewDraftRepair(original)||service.revision!==original.scope.serviceRevision||service.preview?.phase!=='preview_ready'||service.preview.previewHash!==original.scope.previewHash||original.receipt?.remoteContentHash!==expectedRemoteContentHash||original.receipt.issues?.includes('media_identity_unconfirmed')&&!approveObservedMedia)throw new ClientError('SHOPIFY_REPAIR_RECONCILIATION_REQUIRED','请先只读核对准确原草稿，审阅远端哈希，并另行确认需要采用的观察媒体身份。');
    const body={requestId:this.requestId(),expectedRevision:service.revision,expectedPreviewHash:service.preview.previewHash,action:'repair_draft',draftOperationId:original.id,expectedRemoteContentHash,approveObservedMedia,confirmed:true};
    return this.commit({kind:'publication-review',conversationId,path:this.supplierPath(conversationId,service.id)+'/shopify-review',body,key:body.requestId,review:{title:'准备原草稿缺失步骤修复审批',detail:JSON.stringify({original,expectedRemoteContentHash,approveObservedMedia},null,2)}}) as Promise<PublicationResponse>;
  }
  async publicationAction(conversationId:string,serviceId:string,operation:PublicationOperation,action:'approved'|'denied'|'execute'|'reconcile',confirmed=false) {
    if(!confirmed||!validPublication(operation,conversationId,serviceId))throw new ClientError('SUPPLIER_CONFIRMATION_REQUIRED','请明确确认这一个原操作及 scope hash。');
    if(action==='approved'&&(operation.stale||operation.status!=='pending_approval'||operation.approvalStatus!=='pending')||action==='denied'&&(operation.status!=='pending_approval'||operation.approvalStatus!=='pending')||action==='execute'&&(!operation.canExecute||operation.stale)||action==='reconcile'&&!operation.canReconcile)throw new ClientError('SUPPLIER_PUBLICATION_STALE','当前原操作不能执行这一动作，请重新读取。');
    const decision=['approved','denied'].includes(action),suffix=decision?'shopify-decision':action==='execute'?'shopify-execute':'shopify-reconcile',kind=decision?'publication-decision':action==='execute'?'publication-execute':'publication-reconcile';
    const body={requestId:this.requestId(),operationId:operation.id,expectedScopeHash:operation.scopeHash,...(decision?{decision:action}:{}),confirmed:true};
    const key=action==='reconcile'?body.requestId:JSON.stringify([kind,operation.id,operation.scopeHash,action]);
    return this.commit({kind,conversationId,path:this.supplierPath(conversationId,serviceId)+'/'+suffix,body,key,review:{title:action==='execute'?'独立执行已批准的原操作':action==='reconcile'?'只读核对原结果':'原写入审批决定',detail:JSON.stringify(operation.scope,null,2)}}) as Promise<PublicationResponse>;
  }
  private async readPendingPublication(command:Pending):Promise<PublicationResponse> {
    const cid=command.conversationId||'',sid=decodeURIComponent(command.path.split('/')[4]||''),query=await this.publication(cid,sid),op=query.publication.operations.find(item=>item.id===command.body.operationId&&item.scopeHash===command.body.expectedScopeHash);
    if(!op)throw new ClientError('PUBLICATION_RECONCILIATION_REQUIRED','未找到准确原操作；保留原请求，不重新写入。');
    if(op.status==='running')return{service:query.service,operation:op,queryOnly:true,waiting:true};
    if(!op.connectorRunId&&op.canExecute)return{service:query.service,operation:op,queryOnly:true,notAdmitted:true};
    let result:PublicationResponse={service:query.service,operation:op,queryOnly:true};
    if(op.canReconcile&&['uncertain','partial'].includes(op.status)){
      if(!command.reconciliation){command.reconciliation={path:this.supplierPath(cid,sid)+'/shopify-reconcile',body:{requestId:this.requestId(),operationId:op.id,expectedScopeHash:op.scopeHash,confirmed:true}};this.publicationRequests=[...this.publicationRequests.filter(item=>item.body.requestId!==command.body.requestId),JSON.parse(JSON.stringify(command))].slice(-30);this.save();}
      result=await this.request<PublicationResponse>(command.reconciliation.path,'POST',command.reconciliation.body);
    }
    this.pending=null;this.completed.set(command.key,result);this.save();return result;
  }
  async executeUnadmittedPublication(confirmed:boolean) {
    const command=this.pending;if(!confirmed||command?.kind!=='publication-execute')throw new ClientError('SUPPLIER_CONFIRMATION_REQUIRED','必须明确确认重提同一原执行请求。');
    const cid=command.conversationId||'',sid=decodeURIComponent(command.path.split('/')[4]||''),query=await this.publication(cid,sid),op=query.publication.operations.find(item=>item.id===command.body.operationId&&item.scopeHash===command.body.expectedScopeHash);
    if(!op||!op.canExecute||op.connectorRunId||op.stale)throw new ClientError('PUBLICATION_RECONCILIATION_REQUIRED','原操作已变化或已进入执行，只能读取核对。');return this.executePending() as Promise<PublicationResponse>;
  }
  references(id: string) { return this.request<{ libraryReferences: References }>(`/conversations/${encodeURIComponent(id)}/library-references`); }
  museDelegations(id: string) { return this.request<{ delegations: MuseDelegation[] }>(`/conversations/${encodeURIComponent(id)}/muse-delegations`); }
  saveReferences(value: References) { const body = { references: { products: value.products, documents: value.documents }, expectedRevision: value.revision, requestId: this.requestId() }; return this.commit({ kind: 'references', conversationId: value.conversationId, path: `/conversations/${encodeURIComponent(value.conversationId)}/library-references`, body, key: JSON.stringify(value) }); }
  async upload(conversationId: string, filename: string, filePath: string, size: number) {
    const extension = filename.split('.').pop()?.toLowerCase() || '';
    if (this.pending) throw new ClientError('RESULT_UNCERTAIN', '先核对上一条原请求的结果。');
    if (!extensionTypes[extension] || !Number.isFinite(size) || size <= 0 || size > 5 * 1024 * 1024) throw new ClientError('FILE_UNSUPPORTED', '请选择 5MiB 以内的图片、PDF、文本或表格文件。');
    const base64 = await new Promise<string>((resolve, reject) => this.platform.getFileSystemManager().readFile({ filePath, encoding: 'base64', success: result => resolve(String(result.data)), fail: () => reject(new ClientError('FILE_READ_FAILED', '文件无法读取。')) }));
    const body = { filename, mimeType: extensionTypes[extension], base64, sourceConversationId: conversationId, requestId: this.requestId() };
    const result = await this.commit({ kind: 'upload', conversationId, path: '/artifacts', body, key: body.requestId }) as { artifact: Artifact };
    return { id: result.artifact.id, version: result.artifact.currentVersion, sha256: result.artifact.sha256, filename: result.artifact.filename, mimeType: result.artifact.mimeType };
  }
  async download(file: FileReference, muse = false) {
    if (!/^[a-zA-Z0-9_.:-]{1,160}$/.test(file.id) || !Number.isInteger(file.version) || file.version < 1 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new ClientError('FILE_REFERENCE_INVALID', '文件引用需要核对。');
    const path = muse ? `/muse-worker-files/${encodeURIComponent(file.id)}` : `/artifacts/${encodeURIComponent(file.id)}/download`;
    const tempFilePath = await new Promise<string>((resolve, reject) => this.platform.downloadFile({ url: `${this.base()}/api${path}?version=${file.version}&sha256=${file.sha256}`, header: this.headers(), timeout: 20000, success: result => result.statusCode === 200 ? resolve(result.tempFilePath) : reject(new ClientError('FILE_DENIED', '当前账号无法读取此文件版本。')), fail: () => reject(new ClientError('FILE_DOWNLOAD_FAILED', '文件读取未完成，请重试原版本。')) }));
    const digest = await new Promise<string>((resolve, reject) => this.platform.getFileSystemManager().getFileInfo({ filePath: tempFilePath, digestAlgorithm: 'sha256', success: result => resolve(result.digest), fail: () => reject(new ClientError('FILE_VERIFY_FAILED', '文件校验未完成。')) }));
    if (digest !== file.sha256) throw new ClientError('FILE_HASH_MISMATCH', '文件与原回执不一致，已拒绝打开。');
    return tempFilePath;
  }
}

export function conversationView(snapshot: Bootstrap, conversationId: string, delegations: MuseDelegation[] = []) {
  const messages: Message[] = snapshot.messages.filter(value => value.conversationId === conversationId);
  const runs = (snapshot.runs || []).filter(value => value.conversationId === conversationId);
  const cards: Card[] = [];
  for (const run of runs) {
    const scope = { runId: run.id, conversationId, stateKey: run.finishedAt || run.startedAt || run.createdAt || run.status };
    const steps = (run.plan || []).map(step => `${step.title} · ${step.status}`).join('\n');
    if (run.status === 'running' || run.status === 'queued') cards.push({ id: run.id, kind: 'progress', title: run.status === 'queued' ? '任务已排队' : '正在处理', detail: steps || '云端保存进度，离开后可回来查看。', operation: 'cancel', ...scope });
    if (run.status === 'interrupted') cards.push({ id: run.id, kind: 'progress', title: '任务已中断', detail: '恢复原持久提交前，会重新核对权限与输入。', operation: 'recover', ...scope });
    if (['failed', 'blocked', 'cancelled', 'paused', 'succeeded'].includes(run.status)) cards.push({ id: run.id, kind: 'progress', title: ({ failed: '任务未完成', blocked: '任务需要处理', cancelled: '任务已取消', paused: '任务已暂停', succeeded: '任务已完成' } as Record<string, string>)[run.status], detail: run.error?.message || steps || '已读取云端状态。', ...scope });
    if (run.status === 'awaiting_approval') cards.push({ id: `${run.id}:stop`, kind: 'progress', title: '等待你的决定', detail: '批准只保存决定；执行需要再次明确继续。', operation: 'cancel', ...scope });
    for (const proposal of run.proposals || []) if (run.status === 'awaiting_approval' && (proposal.status === 'pending' || proposal.status === 'approved')) cards.push({ id: proposal.id, kind: 'approval', title: proposal.status === 'approved' ? '已批准，等待明确继续' : '请确认具体操作', detail: `${proposal.action} · ${proposal.resource}\n${JSON.stringify(proposal.payload, null, 2)}\n连接器 ${proposal.connectorId} · 修订 ${proposal.connectorRevision}\n审批 ${proposal.approvalId} · 提案 ${proposal.id}`, proposalId: proposal.id, operation: proposal.status === 'approved' ? 'resume' : 'approve', ...scope });
  }
  for (const message of messages) {
    const reference = message.artifactReference;
    const artifact = (snapshot.artifacts || []).find(value => value.id === reference?.id && value.sourceRunId === message.runId && value.sourceConversationId === conversationId);
    const version = artifact?.versions.find(value => value.version === reference?.version && value.sha256 === reference?.sha256);
    if (reference && version) cards.push({ id: `${reference.id}:${reference.version}`, kind: 'file', title: version.filename, detail: `原文件 v${reference.version} · 点击校验后打开`, file: { ...reference, filename: version.filename, mimeType: version.mimeType } });
    const receipt = message.museReceipt as { schema?: string; nativeAgentId?: string; orderId?: string; files?: FileReference[] } | undefined;
    if (message.role === 'assistant' && typeof message.museReceiptHash === 'string' && /^[a-f0-9]{64}$/.test(message.museReceiptHash) && receipt?.schema === 'workspace.muse.session-receipt.v1' && receipt.nativeAgentId === conversationId && receipt.orderId === message.museOrderId && Array.isArray(receipt.files)) {
      for (const file of receipt.files) if (typeof file.id === 'string' && file.version === 1 && /^[a-f0-9]{64}$/.test(file.sha256)) cards.push({ id: `muse-message-file:${message.id}:${file.id}`, kind: 'file', title: file.filename, detail: '原 Muse 会话回执文件 · 校验后打开', file: { ...file, mimeType: file.mimeType || extensionTypes[file.filename.split('.').pop()?.toLowerCase() || ''] }, muse: true });
    }
  }
  for (const artifact of snapshot.artifacts || []) {
    const version = artifact.versions?.find(item => item.version === artifact.currentVersion && item.sha256 === artifact.sha256);
    if (artifact.sourceConversationId === conversationId && !artifact.sourceRunId && version && !cards.some(card => card.file?.id === artifact.id)) cards.push({ id: `resource:${artifact.id}`, kind: 'input', title: version.filename, detail: '已保存的会话输入文件 · 图片/PDF未解析', file: { id: artifact.id, version: version.version, sha256: version.sha256, filename: version.filename, mimeType: version.mimeType } });
  }
  for (const item of delegations) {
    if (item.conversationId !== conversationId || !/^[a-f0-9]{64}$/.test(item.reviewHash)) continue;
    const scope = { muse: true, conversationId, orderId: item.orderId, reviewHash: item.reviewHash, receiptHash: item.receiptHash || undefined };
    const detail = `${item.review.product} · ${item.review.market}\n${item.review.objective}\n上限 ${item.review.budgetCredits} credits\n原订单 ${item.orderId}\n范围 SHA ${item.reviewHash}`;
    if (item.phase === 'review_required') cards.push({ id: `muse:${item.orderId}`, kind: 'approval', title: '审阅原 Muse 订单', detail, operation: 'approve', ...scope });
    else if (item.phase === 'approved') cards.push({ id: `muse:${item.orderId}`, kind: 'approval', title: '原订单已批准，等待派发', detail, operation: 'dispatch', ...scope });
    else if (item.phase === 'result_returned' && item.receiptHash && item.returnedHash === item.receiptHash) cards.push({ id: `muse:${item.orderId}`, kind: 'approval', title: '验收原 Muse 回执', detail: `${detail}\n回执 SHA ${item.receiptHash}\n请核对文件与范围；外部结论仍需独立验证。`, operation: 'accept', ...scope });
    else {
      const phase = ({ queued: '已排队，等待领取', claimed: '已领取，执行待核对', result_ready: '回执待核对', reconciliation_required: '原尝试待核对', cancel_requested: '等待停止确认', cancelled: '原任务已取消', enterprise_accepted: '原回执已验收', failed: '原任务失败', dispatching: '派发结果待确认', lease_expired: '执行租约已过期', deadline_expired: '原任务已超时', input_required: '需要补充信息' } as Record<string, string>)[item.phase] || '进度待核对';
      const terminal = ['enterprise_accepted', 'cancelled', 'failed'].includes(item.phase);
      cards.push({ id: `muse:${item.orderId}`, kind: 'progress', title: `Muse · ${phase}`, detail: `${detail}\n已派发不等于原执行端已开始工作。`, ...(!terminal ? { operation: 'refresh' as const } : {}), ...scope });
      if (!terminal && item.phase !== 'cancel_requested') cards.push({ id: `muse-stop:${item.orderId}`, kind: 'progress', title: '请求停止原 Muse 任务', detail: '停止要等待原执行端确认。', operation: 'cancel', ...scope });
    }
    if (['result_returned', 'enterprise_accepted'].includes(item.phase) && item.receiptHash && item.returnedHash === item.receiptHash) {
      for (const file of item.receipt?.files || []) if (typeof file.id === 'string' && file.version === 1 && /^[a-f0-9]{64}$/.test(file.sha256)) cards.push({ id: `muse-file:${item.orderId}:${file.id}:${file.version}`, kind: 'file', title: file.filename || 'Muse 原文件', detail: '原回执文件 · 校验确切版本与 SHA 后打开', file, muse: true });
    }
  }
  const unique = cards.filter((card, index) => !card.file || cards.findIndex(item => item.file?.id === card.file?.id && item.file?.version === card.file?.version && item.file?.sha256 === card.file?.sha256 && item.muse === card.muse) === index);
  return { messages, cards: unique, resourceCards: unique.filter(card => card.kind === 'input'), awaitingApproval: runs.some(run => run.status === 'awaiting_approval'), busy: runs.some(value => ['running', 'queued', 'awaiting_approval'].includes(value.status)) };
}
