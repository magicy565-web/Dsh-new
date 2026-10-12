import { conversationView, WorkspaceClient, ClientError } from '../../shared/client';
import type { Card, FileReference, References } from '../../shared/client';
import type { Artifact, Message } from '../../../../src/types';
import type { Company, Product, LibraryDocument } from '../../../../src/library/types';
let timer: ReturnType<typeof setTimeout> | undefined;
let reading = false, visible = false, epoch = 0, readFailures = 0;
const client = () => getApp<{ globalData: { client: WorkspaceClient } }>().globalData.client;
const message = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试读取。';
const labels: Record<string, string> = { approve: '批准此项', deny: '拒绝此项', resume: '执行此项', dispatch: '派发原单', accept: '验收原单', refresh: '核对进度', cancel: '请求停止', recover: '恢复原任务' };
const fileReference = (artifact: Artifact): FileReference => ({ id: artifact.id, version: artifact.currentVersion, sha256: artifact.sha256, filename: artifact.filename, mimeType: artifact.mimeType });

Page({
  data: { conversationId: '', subject: '', draft: '', messages: [] as Message[], cards: [] as Card[], files: [] as FileReference[], busy: false, awaitingApproval: false, loading: false, error: '', readError: '', authenticated: false,
    uncertain: false, pendingLabel: '', pendingSummary: '', resourceCards: [] as Card[], runtimeNotice: '', readAt: '', referencesOpen: false, reviewCard: null as Card | null, reviewLabel: '', preview: null as { title: string; content: string; verified: boolean } | null,
    company: null as Company | null, products: [] as Product[], documents: [] as LibraryDocument[], references: null as References | null },
  onShow() { visible = true; epoch++; void this.open(); },
  onHide() { visible = false; epoch++; if (timer !== undefined) clearTimeout(timer); },
  onUnload() { visible = false; epoch++; if (timer !== undefined) clearTimeout(timer); },
  clearAccount() { this.setData({ authenticated: false, subject: '', conversationId: '', messages: [], cards: [], files: [], resourceCards: [], draft: '', reviewCard: null, preview: null, referencesOpen: false, references: null, company: null, products: [], documents: [], uncertain: false, pendingSummary: '' }); },
  async open() {
    const opened = epoch;
    try {
      const session = await client().initialize();
      if (!visible || opened !== epoch) return;
      const subject = session.user?.id || '';
      if (subject !== this.data.subject) this.setData({ subject, conversationId: '', messages: [], cards: [], files: [], resourceCards: [], draft: '', referencesOpen: false, reviewCard: null, preview: null, references: null, company: null, products: [], documents: [] });
      this.setData({ authenticated: session.authenticated, readError: '' });
      if (session.authenticated) await this.refresh();
    } catch (error) { if (visible && opened === epoch) { this.clearAccount(); this.setData({ readError: message(error) }); } }
  },
  async login() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try { await client().login(); await this.open(); }
    catch (error) { this.setData({ error: message(error) }); }
    finally { this.setData({ loading: false }); }
  },
  async logout() {
    if (this.data.loading) return;
    wx.showModal({ title: '退出企业空间', content: '退出后可重新登录读取云端进度，云端任务会继续。', confirmText: '退出登录', success: async result => {
      if (!result.confirm || this.data.loading) return;
      this.setData({ loading: true });
      try { await client().logout(); if (timer !== undefined) clearTimeout(timer); this.clearAccount(); this.setData({ error: '', readError: '' }); }
      catch (error) { this.setData({ error: message(error) }); }
      finally { this.setData({ loading: false }); }
    } });
  },
  async refresh() {
    if (reading || !visible || !this.data.authenticated) return;
    reading = true; const opened = epoch;
    try {
      const snapshot = await client().bootstrap();
      const id = await client().mainConversation(snapshot);
      const delegations = snapshot.museBinding?.conversationId === id ? (await client().museDelegations(id)).delegations : [];
      if (!visible || opened !== epoch) return;
      const view = conversationView(snapshot, id, delegations);
      const pendingLabel = ({ send: '消息', action: '操作', upload: '文件上传', references: '资料引用', create: '会话创建' } as Record<string, string>)[client().pendingKind] || '';
      this.setData({ conversationId: id, ...view, cards: view.cards.filter(card => card.kind !== 'input'), readError: '', uncertain: client().uncertain, pendingLabel, pendingSummary: client().pendingSummary, readAt: new Date().toLocaleTimeString(),
        ...(client().pendingDraft && !this.data.draft ? { draft: client().pendingDraft } : {}), runtimeNotice: snapshot.runtime?.configured === false ? '云端模型尚未接入，发送后会保存请求并显示真实阻挡原因。' : '' });
      readFailures = 0;
    } catch (error) {
      readFailures++;
      if (visible && opened === epoch) {
        this.setData({ readError: message(error) });
        if (error instanceof ClientError && (error.status === 401 || error.code === 'CSRF_REJECTED')) { this.clearAccount(); this.setData({ error: message(error), readError: '' }); }
      }
    } finally {
      reading = false; if (timer !== undefined) clearTimeout(timer);
      if (visible && this.data.authenticated) timer = setTimeout(() => { void this.refresh(); }, Math.min(30000, 2000 * 2 ** Math.min(readFailures, 4)));
    }
  },
  draft(event: WechatMiniprogram.Input) { this.setData({ draft: event.detail.value }); },
  async send() {
    if (!this.data.authenticated || !this.data.conversationId || this.data.loading || this.data.busy || client().uncertain) return;
    this.setData({ loading: true, error: '' });
    try { await client().send(this.data.conversationId, this.data.draft, this.data.files); this.setData({ draft: '', files: [] }); await this.refresh(); }
    catch (error) { this.setData({ error: message(error), uncertain: client().uncertain, pendingLabel: '消息' }); }
    finally { this.setData({ loading: false }); }
  },
  async retry() {
    if (this.data.loading || !this.data.authenticated) return;
    const kind = client().pendingKind;
    this.setData({ loading: true, error: '' });
    try {
      const result = await client().retryPending() as { artifact?: Artifact };
      if (kind === 'send') this.setData({ draft: '', files: [] });
      if (kind === 'upload' && result.artifact) this.setData({ files: [...this.data.files, fileReference(result.artifact)] });
      if (kind === 'action') this.setData({ reviewCard: null });
      if (kind === 'references') await this.openReferences();
      this.setData({ uncertain: false }); await this.refresh();
    } catch (error) { this.setData({ error: message(error), uncertain: client().uncertain }); }
    finally { this.setData({ loading: false }); }
  },
  async card(event: WechatMiniprogram.TouchEvent) {
    if (this.data.loading || client().uncertain) return;
    const card = [...this.data.cards, ...this.data.resourceCards].find(value => value.id === event.currentTarget.dataset.id);
    if (!card) return;
    if (!card.file) { if (card.operation) this.setData({ reviewCard: card, reviewLabel: labels[card.operation], error: '' }); return; }
    this.setData({ loading: true, error: '' });
    try {
      const filePath = await client().download(card.file, card.muse === true);
      if (card.file.mimeType?.startsWith('image/')) await new Promise<void>((resolve, reject) => wx.previewImage({ urls: [filePath], success: () => resolve(), fail: () => reject(new Error('微信图片预览未打开，请重试原文件。')) }));
      else if (card.file.mimeType === 'application/pdf') await new Promise<void>((resolve, reject) => wx.openDocument({ filePath, fileType: 'pdf', showMenu: true, success: () => resolve(), fail: () => reject(new Error('微信文档预览未打开，请重试原文件。')) }));
      else {
        const content = await new Promise<string>((resolve, reject) => wx.getFileSystemManager().readFile({ filePath, encoding: 'utf8', success: result => resolve(String(result.data)), fail: () => reject(new Error('原文件已下载并校验，文本预览无法读取。')) }));
        this.setData({ preview: { title: card.title, content: content.length > 20000 ? `${content.slice(0, 20000)}\n\n（预览仅显示前 20,000 字符；原下载文件已完整校验。）` : content, verified: true } });
      }
    } catch (error) { this.setData({ error: message(error) }); }
    finally { this.setData({ loading: false }); }
  },
  closePreview() { this.setData({ preview: null }); },
  reviewPending() { this.setData({ preview: { title: '原请求核对', content: client().pendingSummary, verified: false } }); },
  closeReview() { if (!this.data.loading) this.setData({ reviewCard: null }); },
  async confirmCard(event: WechatMiniprogram.TouchEvent) {
    const card = this.data.reviewCard;
    if (!card || this.data.loading || client().uncertain || !this.data.authenticated) return;
    const deny = event.currentTarget.dataset.decision === 'deny';
    if (deny && card.operation !== 'approve') return;
    const command: Card = deny ? { ...card, operation: card.muse ? 'cancel' : 'deny' } : card;
    this.setData({ loading: true, error: '' });
    try { await client().action(command, true, this.data.conversationId); this.setData({ reviewCard: null }); await this.refresh(); }
    catch (error) { this.setData({ error: message(error), uncertain: client().uncertain, pendingLabel: '操作' }); }
    finally { this.setData({ loading: false }); }
  },
  chooseFile() {
    if (this.data.loading || this.data.busy || client().uncertain || !this.data.conversationId) return;
    this.setData({ loading: true, error: '' });
    wx.chooseMessageFile({ count: 1, type: 'all', success: async result => {
      const file = result.tempFiles[0];
      try { if (file) await this.attach(file.name, file.path, file.size); }
      catch (error) { this.setData({ error: message(error), uncertain: client().uncertain, pendingLabel: '文件上传' }); }
      finally { this.setData({ loading: false }); }
    }, fail: error => { this.setData({ loading: false, ...(!/cancel/.test(error.errMsg) ? { error: '微信文件选择未完成。' } : {}) }); } });
  },
  chooseImage() {
    if (this.data.loading || this.data.busy || client().uncertain || !this.data.conversationId) return;
    this.setData({ loading: true, error: '' });
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], success: async result => {
      const file = result.tempFiles[0];
      try {
        if (!file) return;
        const extension = file.tempFilePath.split('.').pop()?.toLowerCase();
        if (!extension || !['jpg', 'jpeg', 'png', 'webp'].includes(extension)) throw new Error('请使用 JPG、PNG 或 WebP 图片。');
        await this.attach(`图片-${Date.now()}.${extension}`, file.tempFilePath, file.size);
      } catch (error) { this.setData({ error: message(error), uncertain: client().uncertain, pendingLabel: '文件上传' }); }
      finally { this.setData({ loading: false }); }
    }, fail: error => { this.setData({ loading: false, ...(!/cancel/.test(error.errMsg) ? { error: '微信图片选择未完成。' } : {}) }); } });
  },
  async attach(name: string, path: string, size: number) {
    const reference = await client().upload(this.data.conversationId, name, path, size);
    this.setData({ files: [...this.data.files, reference], error: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(reference.mimeType || '') ? '原文件已保存；当前模型未开放图片/PDF解析，请补充必要的文字说明。' : '' });
  },
  removeFile(event: WechatMiniprogram.TouchEvent) { if (!this.data.loading && !client().uncertain) this.setData({ files: this.data.files.filter(file => file.id !== event.currentTarget.dataset.id) }); },
  async openReferences() {
    if (!this.data.authenticated || !this.data.conversationId) return;
    const opened = epoch, id = this.data.conversationId;
    try {
      const [library, selected] = await Promise.all([client().library(), client().references(id)]);
      if (!visible || opened !== epoch || id !== this.data.conversationId) return;
      this.setData({ ...library, references: selected.libraryReferences, referencesOpen: true });
    } catch (error) { this.setData({ error: message(error) }); }
  },
  closeReferences() { this.setData({ referencesOpen: false }); },
  async reference(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.references || this.data.loading || this.data.busy || client().uncertain) return;
    const id = event.currentTarget.dataset.id, kind = event.currentTarget.dataset.kind;
    const value: References = { ...this.data.references, products: [...this.data.references.products], documents: [...this.data.references.documents] };
    if (kind === 'product') {
      const product = this.data.products.find(item => item.id === id); if (!product) return;
      value.products = value.products.some(item => item.productId === id) ? value.products.filter(item => item.productId !== id) : [...value.products, { productId: id, productRevision: product.revision }];
    } else if (kind === 'document') {
      const document = this.data.documents.find(item => item.id === id); if (!document) return;
      value.documents = value.documents.some(item => item.documentId === id) ? value.documents.filter(item => item.documentId !== id) : [...value.documents, { documentId: id, documentVersion: document.currentVersion }];
    } else return;
    this.setData({ loading: true, error: '' });
    try { await client().saveReferences(value); const selected = await client().references(value.conversationId); this.setData({ references: selected.libraryReferences }); }
    catch (error) { this.setData({ error: message(error), uncertain: client().uncertain, pendingLabel: '资料引用' }); }
    finally { this.setData({ loading: false }); }
  },
});
