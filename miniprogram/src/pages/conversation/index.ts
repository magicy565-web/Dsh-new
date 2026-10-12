import { conversationView, WorkspaceClient } from '../../shared/client';
import type { Card, FileReference, References } from '../../shared/client';
import type { Message } from '../../../../src/types';
import type { Company, Product, LibraryDocument } from '../../../../src/library/types';
let timer: ReturnType<typeof setTimeout> | undefined;
let reading = false, visible = false;
const client = () => getApp<{ globalData: { client: WorkspaceClient } }>().globalData.client;
const message = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试读取。';

Page({
  data: { conversationId: '', draft: '', messages: [] as Message[], cards: [] as Card[], files: [] as FileReference[], busy: false, loading: false, error: '', authenticated: false,
    uncertain: false, referencesOpen: false, company: null as Company | null, products: [] as Product[], documents: [] as LibraryDocument[], references: null as References | null },
  onShow() { visible = true; void this.open(); },
  onHide() { visible = false; if (timer !== undefined) clearTimeout(timer); },
  onUnload() { visible = false; if (timer !== undefined) clearTimeout(timer); },
  async open() {
    try {
      const session = await client().initialize();
      this.setData({ authenticated: session.authenticated });
      if (session.authenticated) await this.refresh();
    } catch (error) { this.setData({ error: message(error) }); }
  },
  async login() {
    try { await client().login(); this.setData({ authenticated: true, error: '' }); await this.refresh(); }
    catch (error) { this.setData({ error: message(error) }); }
  },
  async refresh() {
    if (reading || !visible) return;
    reading = true;
    try {
      const snapshot = await client().bootstrap();
      const id = this.data.conversationId || await client().mainConversation(snapshot);
      const view = conversationView(snapshot, id);
      this.setData({ conversationId: id, ...view, error: '', uncertain: client().uncertain });
    } catch (error) { this.setData({ error: message(error) }); }
    finally { reading = false; if (timer !== undefined) clearTimeout(timer); if (visible) timer = setTimeout(() => { void this.refresh(); }, 2000); }
  },
  draft(event: WechatMiniprogram.Input) { this.setData({ draft: event.detail.value }); },
  async send() {
    if (this.data.loading || this.data.busy) return;
    this.setData({ loading: true, error: '' });
    try { await client().send(this.data.conversationId, this.data.draft, this.data.files); this.setData({ draft: '', files: [] }); await this.refresh(); }
    catch (error) { this.setData({ error: message(error), uncertain: client().uncertain }); }
    finally { this.setData({ loading: false }); }
  },
  async retry() {
    this.setData({ loading: true });
    try { await client().retrySend(); this.setData({ draft: '', files: [], uncertain: false }); await this.refresh(); }
    catch (error) { this.setData({ error: message(error) }); }
    finally { this.setData({ loading: false }); }
  },
  async card(event: WechatMiniprogram.TouchEvent) {
    const card = this.data.cards.find(value => value.id === event.currentTarget.dataset.id);
    if (!card) return;
    if (card.file) {
      try {
        const filePath = await client().download(card.file);
        if (card.file.mimeType?.startsWith('image/')) wx.previewImage({ urls: [filePath] });
        else if (card.file.mimeType === 'application/pdf') wx.openDocument({ filePath, fileType: 'pdf', showMenu: true });
        else wx.getFileSystemManager().readFile({ filePath, encoding: 'utf8', success: result => wx.showModal({ title: card.title, content: String(result.data).slice(0, 2000), showCancel: false }) });
      } catch (error) { this.setData({ error: message(error) }); }
      return;
    }
    wx.showModal({ title: card.title, content: card.detail.slice(0, 3000), confirmText: card.operation === 'approve' ? '批准此项' : card.operation === 'resume' ? '执行此项' : card.operation === 'cancel' ? '请求停止' : '恢复原任务',
      success: async result => { if (!result.confirm) return; try { await client().action(card, true); await this.refresh(); } catch (error) { this.setData({ error: message(error) }); } } });
  },
  chooseFile() {
    wx.chooseMessageFile({ count: 1, type: 'all', success: async result => {
      const file = result.tempFiles[0];
      if (!file) return;
      try { const reference = await client().upload(this.data.conversationId, file.name, file.path, file.size); this.setData({ files: [...this.data.files, reference] }); }
      catch (error) { this.setData({ error: message(error) }); }
    } });
  },
  chooseImage() {
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], success: async result => {
      const file = result.tempFiles[0]; if (!file) return;
      const extension = file.tempFilePath.split('.').pop()?.toLowerCase();
      if (!extension || !['jpg', 'jpeg', 'png', 'webp'].includes(extension)) { this.setData({ error: '请使用 JPG、PNG 或 WebP 图片。' }); return; }
      try { const reference = await client().upload(this.data.conversationId, `图片-${Date.now()}.${extension}`, file.tempFilePath, file.size); this.setData({ files: [...this.data.files, reference], error: '图片已保存；当前模型未开放图像解析，请补充必要的文字说明。' }); }
      catch (error) { this.setData({ error: message(error) }); }
    } });
  },
  async openReferences() {
    try {
      const [library, selected] = await Promise.all([client().library(), client().references(this.data.conversationId)]);
      this.setData({ ...library, references: selected.libraryReferences, referencesOpen: true });
    } catch (error) { this.setData({ error: message(error) }); }
  },
  closeReferences() { this.setData({ referencesOpen: false }); },
  async reference(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.references) return;
    const id = event.currentTarget.dataset.id, kind = event.currentTarget.dataset.kind;
    const value: References = { ...this.data.references, products: [...this.data.references.products], documents: [...this.data.references.documents] };
    if (kind === 'product') {
      const product = this.data.products.find(item => item.id === id); if (!product) return;
      const existing = value.products.find(item => item.productId === id);
      value.products = existing ? value.products.filter(item => item.productId !== id) : [...value.products, { productId: id, productRevision: product.revision }];
    } else {
      const document = this.data.documents.find(item => item.id === id); if (!document) return;
      const existing = value.documents.find(item => item.documentId === id);
      value.documents = existing ? value.documents.filter(item => item.documentId !== id) : [...value.documents, { documentId: id, documentVersion: document.currentVersion }];
    }
    try { await client().saveReferences(value); const selected = await client().references(value.conversationId); this.setData({ references: selected.libraryReferences }); }
    catch (error) { this.setData({ error: message(error) }); }
  },
});
