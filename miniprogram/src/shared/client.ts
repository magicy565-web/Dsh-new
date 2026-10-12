import type { Artifact, Bootstrap, InputContext, Message, Run } from '../../../src/types';
import type { Company, Product, LibraryDocument } from '../../../src/library/types';

export type Session = { authenticated: boolean; csrfToken: string | null; user: { id: string; role: string } | null; expiresAt: string | null; mode: string };
export type FileReference = { id: string; version: number; sha256: string; filename: string; mimeType?: string };
export type References = { conversationId: string; revision: number; products: { productId: string; productRevision: number }[]; documents: { documentId: string; documentVersion: number }[] };
export type Card = { id: string; title: string; detail: string; runId?: string; proposalId?: string; operation?: 'approve' | 'resume' | 'recover' | 'cancel'; file?: FileReference; kind: string };
type Transport = Pick<typeof wx, 'request' | 'downloadFile' | 'getFileSystemManager' | 'login'>;
export type Options = { baseUrl: string; allowLoopback?: boolean; loginBroker?: (code: string) => Promise<{ session: Session; token: string }> };
const blank = (): InputContext => ({ artifacts: [], skills: [], memoryIds: [], connectorActions: [] });
const extensionTypes: Record<string, string> = { txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
export class ClientError extends Error { constructor(public code: string, message: string) { super(message); } }

/** Same business API and shared schema as the web client; no DOM, cookie jar,
 * SSE or execution loop. Polling only invalidates a server-owned snapshot. */
export class WorkspaceClient {
  session: Session | null = null;
  private token = '';
  private pendingSend: { conversationId: string; body: Record<string, unknown> } | null = null;
  private sequence = 0;
  constructor(private platform: Transport, private options: Options) {}
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
            reject(new ClientError(error?.code || 'API_ERROR', error?.message || '操作未完成，请核对服务状态。'));
          } else resolve(result.data as T);
        }, fail: () => reject(new ClientError(method === 'GET' ? 'NETWORK_ERROR' : 'RESULT_UNCERTAIN', method === 'GET' ? '暂时无法连接，请重试读取。' : '操作结果尚未确认；请核对原请求，不要新建重复操作。')) });
    });
  }
  async initialize() { this.session = await this.request<Session>('/session'); return this.session; }
  async login() {
    if (!this.options.loginBroker) throw new ClientError('LOGIN_INTEGRATION_REQUIRED', '微信身份尚未接入企业授权；需要部署方绑定真实账号。');
    const code = await new Promise<string>((resolve, reject) => this.platform.login({ success: result => result.code ? resolve(result.code) : reject(new ClientError('LOGIN_REQUIRED', '微信登录未取得授权码。')), fail: () => reject(new ClientError('LOGIN_REQUIRED', '微信登录未完成。')) }));
    const result = await this.options.loginBroker(code);
    if (!/^[A-Za-z0-9_-]{43}$/.test(result.token) || !result.session.authenticated) throw new ClientError('LOGIN_REQUIRED', '企业授权未完成。');
    this.token = result.token; this.session = result.session;
    return this.session;
  }
  async bootstrap() { return this.request<Bootstrap & { museBinding?: { conversationId?: string } }>('/bootstrap'); }
  async mainConversation(snapshot: Bootstrap & { museBinding?: { conversationId?: string } }) {
    const native = snapshot.museBinding?.conversationId;
    if (native && snapshot.conversations.some(value => value.id === native)) return native;
    if (snapshot.conversations.length) return snapshot.conversations[0].id;
    const result = await this.request<{ conversation: { id: string } }>('/conversations', 'POST', { title: '主会话' });
    return result.conversation.id;
  }
  private requestId() { return `mini_${Date.now()}_${++this.sequence}_${Math.random().toString(36).slice(2, 14)}`; }
  async send(conversationId: string, content: string, artifacts: FileReference[] = []) {
    if (!content.trim()) throw new ClientError('INPUT_REQUIRED', '说说你想完成的事。');
    if (this.pendingSend) throw new ClientError('RESULT_UNCERTAIN', '先核对上一条原请求的结果。');
    const inputContext = blank();
    // Existing policy does not parse PDF/images or export private library assets.
    inputContext.artifacts = artifacts.filter(value => ['text/plain', 'text/markdown', 'text/csv', 'application/json'].includes(value.mimeType || '')).map(value => ({ id: value.id, version: value.version }));
    this.pendingSend = { conversationId, body: { content: content.trim(), requestId: this.requestId(), inputContext, workspaceExecution: true, provider: 'pi' } };
    return this.retrySend();
  }
  async retrySend() {
    if (!this.pendingSend) throw new ClientError('NO_PENDING_REQUEST', '没有需要核对的原请求。');
    const pending = this.pendingSend;
    const result = await this.request<{ run: Run }>(`/conversations/${encodeURIComponent(pending.conversationId)}/messages`, 'POST', pending.body);
    this.pendingSend = null; return result;
  }
  get uncertain() { return Boolean(this.pendingSend); }
  async action(card: Card, confirmed: boolean) {
    if (!confirmed || !card.runId) throw new ClientError('APPROVAL_REQUIRED', '需要明确确认本次具体操作。');
    const id = encodeURIComponent(card.runId);
    if (card.operation === 'approve') return this.request(`/runs/${id}/action-decision`, 'POST', { proposalId: card.proposalId, decision: 'approved', confirmed: true });
    if (card.operation === 'resume') return this.request(`/runs/${id}/resume`, 'POST', { proposalId: card.proposalId, requestId: this.requestId() });
    if (card.operation === 'recover') return this.request(`/runs/${id}/retry`, 'POST', { requestId: this.requestId() });
    if (card.operation === 'cancel') return this.request(`/runs/${id}/cancel`, 'POST', {});
    throw new ClientError('INVALID_ACTION', '未知操作。');
  }
  async library() {
    const [products, company, documents] = await Promise.all([this.request<{ items: Product[] }>('/library/products'), this.request<{ company: Company }>('/library/company'), this.request<{ items: LibraryDocument[] }>('/library/documents')]);
    return { products: products.items, company: company.company, documents: documents.items };
  }
  references(id: string) { return this.request<{ libraryReferences: References }>(`/conversations/${encodeURIComponent(id)}/library-references`); }
  saveReferences(value: References) { return this.request(`/conversations/${encodeURIComponent(value.conversationId)}/library-references`, 'POST', { products: value.products, documents: value.documents, expectedRevision: value.revision, requestId: this.requestId() }); }
  async upload(conversationId: string, filename: string, filePath: string, size: number) {
    const extension = filename.split('.').pop()?.toLowerCase() || '';
    if (!extensionTypes[extension] || size > 5 * 1024 * 1024) throw new ClientError('FILE_UNSUPPORTED', '请选择 5MiB 以内的图片、PDF、文本或表格文件。');
    const base64 = await new Promise<string>((resolve, reject) => this.platform.getFileSystemManager().readFile({ filePath, encoding: 'base64', success: result => resolve(String(result.data)), fail: () => reject(new ClientError('FILE_READ_FAILED', '文件无法读取。')) }));
    const result = await this.request<{ artifact: Artifact }>('/artifacts', 'POST', { filename, mimeType: extensionTypes[extension], base64, sourceConversationId: conversationId, requestId: this.requestId() });
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

export function conversationView(snapshot: Bootstrap, conversationId: string) {
  const messages: Message[] = snapshot.messages.filter(value => value.conversationId === conversationId);
  const runs = (snapshot.runs || []).filter(value => value.conversationId === conversationId);
  const cards: Card[] = [];
  for (const run of runs) {
    if (run.status === 'running' || run.status === 'queued') cards.push({ id: run.id, kind: 'progress', title: run.status === 'queued' ? '任务已排队' : '正在处理', detail: '服务端持续保存进度，离开页面后可回来查看。', runId: run.id, operation: 'cancel' });
    if (run.status === 'interrupted') cards.push({ id: run.id, kind: 'progress', title: '任务已中断', detail: '恢复原持久提交前，会重新核对权限与输入。', runId: run.id, operation: 'recover' });
    for (const proposal of run.proposals || []) if (proposal.status === 'pending' || proposal.status === 'approved') cards.push({ id: proposal.id, kind: 'approval', title: proposal.status === 'approved' ? '已批准，等待明确继续' : '请确认具体操作', detail: `${proposal.action} · ${proposal.resource}\n${JSON.stringify(proposal.payload)}`, runId: run.id, proposalId: proposal.id, operation: proposal.status === 'approved' ? 'resume' : 'approve' });
  }
  for (const message of messages) {
    const reference = message.artifactReference;
    const artifact = (snapshot.artifacts || []).find(value => value.id === reference?.id && value.sourceRunId === message.runId && value.sourceConversationId === conversationId);
    const version = artifact?.versions.find(value => value.version === reference?.version && value.sha256 === reference?.sha256);
    if (reference && version) cards.push({ id: `${reference.id}:${reference.version}`, kind: 'file', title: version.filename, detail: `原文件 v${reference.version} · 点击校验后打开`, file: { ...reference, filename: version.filename, mimeType: version.mimeType } });
  }
  return { messages, cards, busy: runs.some(value => value.status === 'running' || value.status === 'queued') };
}
