import { conversationView, WorkspaceClient, ClientError } from '../../shared/client';
import type { Card, FileReference, References } from '../../shared/client';
import type { Artifact, Message, Run } from '../../../../src/types';
import type { Company, Product, LibraryDocument } from '../../../../src/library/types';
import { presentMuseDraft } from '../../shared/muse-drafts';
import type { MuseDraft } from '../../shared/muse-drafts';
import type { DraftPresentation } from '../../shared/muse-draft-view';
import { inquiryScope, procurementMessage } from '../../shared/procurement';
import type { Inquiry } from '../../shared/procurement';
import { presentSupplier, presentMonitor, supplierErrorText } from '../../shared/supplier';
import type { SupplierService, SupplierMonitor } from '../../shared/supplier';
import {presentShopReadiness,presentShopReadinessContract} from '../../shared/shop-readiness-view';
import type {ShopReadinessView} from '../../shared/shop-readiness-view';
import { supplierFieldLabels } from '../../shared/supplier-view';
import {presentPublication,publicationScopeText,canReviewDraftRepair,mediaSnapshotText} from '../../shared/publication';
import type {PublicationState,PublicationOperation,PublicationResponse} from '../../shared/publication';
import {notificationText,notificationScopeText,notificationExecutable,notificationSourceText} from '../../shared/notification';
import type {SubscriptionChallenge,NotificationOperation,NotificationResponse,NotificationPhase} from '../../shared/notification';
import type {ShopifyReview} from '../../components/shopify-operation-review/index';
import type { SupplierProfile, PublicListingField } from '../../shared/supplier-view';
type SupplierReview = {kind:'images'|'save-product'|'shopify-draft'|'shopify-observation'|'monitors'|'monitor-check'|'monitor-stop'|'cancel'|'reject';serviceId:string;revision:number;profileHash:string;detail:string;data:Record<string,unknown>;facts?:Partial<SupplierProfile>};
let timer: ReturnType<typeof setTimeout> | undefined;
let reading = false, visible = false, epoch = 0, readFailures = 0;
const client = () => getApp<{ globalData: { client: WorkspaceClient } }>().globalData.client;
const message = (error: unknown) => error instanceof ClientError && supplierErrorText(error.code) !== error.code ? supplierErrorText(error.code) : error instanceof Error ? error.message : '操作未完成，请重试读取。';
const labels: Record<string, string> = { approve: '批准此项', deny: '拒绝此项', resume: '执行此项', dispatch: '派发原单', accept: '验收原单', refresh: '核对进度', cancel: '请求停止', recover: '恢复原任务' };
const fileReference = (artifact: Artifact): FileReference => ({ id: artifact.id, version: artifact.currentVersion, sha256: artifact.sha256, filename: artifact.filename, mimeType: artifact.mimeType });

Page({
  data: { shopReadinessCanVerify:false, shopReadiness:null as ShopReadinessView|null,conversationId: '', subject: '', draft: '', messages: [] as Message[], cards: [] as Card[], files: [] as FileReference[], busy: false, awaitingApproval: false, loading: false, error: '', readError: '', authenticated: false,
    uncertain: false, pendingLabel: '', pendingSummary: '', resourceCards: [] as Card[], runtimeNotice: '', readAt: '', referencesOpen: false, reviewCard: null as Card | null, reviewLabel: '', preview: null as { title: string; content: string; verified: boolean } | null,
    company: null as Company | null, products: [] as Product[], documents: [] as LibraryDocument[], references: null as References | null,
    museDrafts: [] as MuseDraft[], draftCards: [] as ReturnType<typeof presentMuseDraft>[], selectedDraft: null as DraftPresentation | null, goalMode: false, goalBlocked: false, drafting: false, needsDraftInput: false, composerHint: '描述目标或需要补充的信息…',
    procurementOpen: false, procurementInbox: [] as Inquiry[], procurementAssociated: [] as Inquiry[], procurementError: '', replyInquiryId: '', savedGoal: null as { draft: string; files: FileReference[] } | null,
    publicationState:null as PublicationState|null,publicationCards:[] as ReturnType<typeof presentPublication>[],publicationError:'',shopifyReview:null as ShopifyReview|null,publicationNotAdmitted:false,notificationNotAdmitted:false,
    newSupplier:false, supplierResourcesOpen:false, supplierMode: false, supplierAvailable: false, selectedSupplierId: '', supplierServices: [] as SupplierService[], supplierCards: [] as ReturnType<typeof presentSupplier>[], supplierReadError: '', supplierNotice: '', supplierCommand: '' as ''|'shopify-observation'|'monitors'|'shopify-publish', supplierScope: null as {id:string;revision:number;profile:SupplierProfile}|null, supplierReview: null as SupplierReview|null, supplierMonitors: [] as ReturnType<typeof presentMonitor>[], verifiedProductImage: null as {serviceId:string;path:string;sha256:string;sourceNote:string}|null,
    procurementReview: null as { kind: 'bind' | 'reply'; inquiry: Inquiry; detail: string; content: string } | null },
  onShow() { visible = true; epoch++; void this.open(); },
  onHide() { visible = false; epoch++; this.setData({shopReadiness:null}); if (timer !== undefined) clearTimeout(timer); },
  onUnload() { visible = false; epoch++; this.setData({shopReadiness:null}); if (timer !== undefined) clearTimeout(timer); },
  clearAccount() { this.setData({ shopReadiness:null,shopReadinessCanVerify:false,authenticated: false, subject: '', conversationId: '', messages: [], cards: [], files: [], resourceCards: [], draft: '', reviewCard: null, preview: null, referencesOpen: false, references: null, company: null, products: [], documents: [], uncertain: false, pendingSummary: '', museDrafts: [], draftCards: [], selectedDraft: null, goalBlocked: false, procurementOpen: false, procurementInbox: [], procurementAssociated: [], procurementReview: null, replyInquiryId: '', savedGoal: null, publicationState:null,publicationCards:[],publicationError:'',shopifyReview:null,publicationNotAdmitted:false,notificationNotAdmitted:false,newSupplier:false, supplierResourcesOpen:false, supplierReadError:'', supplierMode:false, selectedSupplierId:'', supplierServices:[],supplierCards:[],supplierMonitors:[],supplierScope:null,supplierReview:null,supplierCommand:'',supplierNotice:'',verifiedProductImage:null }); },
  async open() {
    const opened = epoch;
    try {
      const session = await client().initialize();
      if (!visible || opened !== epoch) return;
      const subject = session.user?.id || '';
      if (subject !== this.data.subject) this.setData({shopReadiness:null, publicationState:null,publicationCards:[],publicationError:'',shopifyReview:null,publicationNotAdmitted:false,notificationNotAdmitted:false,newSupplier:false, supplierResourcesOpen:false, supplierReadError:'', supplierMode:false, selectedSupplierId:'',supplierServices:[],supplierCards:[],supplierMonitors:[],supplierScope:null,supplierReview:null,supplierCommand:'',supplierNotice:'',verifiedProductImage:null, procurementOpen: false, procurementInbox: [], procurementAssociated: [], procurementReview: null, replyInquiryId: '', savedGoal: null, subject, conversationId: '', messages: [], cards: [], files: [], resourceCards: [], draft: '', referencesOpen: false, reviewCard: null, preview: null, references: null, company: null, products: [], documents: [] });
      this.setData({ authenticated: session.authenticated, shopReadinessCanVerify:session.user?.role==='admin', readError: '' });
      this.setData({ goalMode: client().requiresOriginalMuse });
      if (session.authenticated) await this.refresh();
    } catch (error) { if (visible && opened === epoch) { this.clearAccount(); this.setData({ readError: message(error) }); } }
  },
  showShopReadinessDetails(){const value=this.data.shopReadiness;if(value)this.setData({preview:{title:value.title,content:value.detail,verified:false}});},
  async refreshShopReadiness(){
    const opened=epoch,subject=this.data.subject;
    try{const value=await client().shopReadiness();if(visible&&opened===epoch&&subject===this.data.subject)this.setData({shopReadiness:presentShopReadinessContract(value)});}
    catch(error){if(visible&&opened===epoch&&subject===this.data.subject)this.setData({shopReadiness:presentShopReadiness({kind:'unknown',detail:message(error)})});}
  },
  async verifyShopReadiness(){
    if(this.data.loading||!this.data.authenticated||!this.data.shopReadinessCanVerify)return;
    const opened=epoch,subject=this.data.subject;this.setData({loading:true,shopReadiness:presentShopReadiness({kind:'not_checked',detail:'正在核验原配置的店铺身份与读取授权范围；不创建或发布商品。'})});
    try{await client().verifyShopReadiness();}catch(error){if(visible&&opened===epoch&&subject===this.data.subject)this.setData({error:message(error)});}
    finally{if(visible&&opened===epoch&&subject===this.data.subject)await this.refreshShopReadiness();this.setData({loading:false});}
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
      const originalBound = snapshot.museBinding?.originalBinding === true;
      const id = client().requiresOriginalMuse && !originalBound ? client().existingBusinessConversation(snapshot) : await client().mainConversation(snapshot);
      const delegations = snapshot.museBinding?.conversationId === id ? (await client().museDelegations(id)).delegations : [];
      const drafts = client().requiresOriginalMuse && originalBound && client().museDraftCapable ? (await client().museDrafts(id)).drafts : [];
      if (!visible || opened !== epoch) return;
      const view = conversationView(snapshot, id, delegations);
      const pendingLabel = ({ send: '消息', action: '操作', upload: '文件上传', references: '资料引用', create: '会话创建', intake: '草案文字', prepare: '原订单准备', reject: '草案拒绝', 'procurement-bind': '采购关联', 'procurement-reply': '原采购回复', 'supplier-intake':'商品事实', 'supplier-profile':'原图片事实', 'supplier-preview':'商品预览', 'supplier-operation':'商品服务操作','publication-review':'Shopify审阅','publication-decision':'原写入审批','publication-execute':'原外部执行','publication-reconcile':'只读回执核对','notification-challenge':'原生订阅准备','notification-record':'原生决定核对','notification-review':'通知审阅','notification-decision':'通知审批','notification-execute':'通知执行','notification-cancel':'通知停止','notification-revoke':'订阅撤销' } as Record<string, string>)[client().pendingKind] || '';
      const draftCards = drafts.map(presentMuseDraft);
      const selected = this.data.selectedDraft && draftCards.find(value => value.id === this.data.selectedDraft?.id && !['rejected', 'rejecting'].includes(value.phase));
      const active = [...draftCards].reverse().find(value => !['prepared', 'rejected'].includes(value.phase));
      const cards = view.cards.filter(card => card.kind !== 'input').map(card => {
        const supplierRun=snapshot.runs?.find(run=>run.id===card.runId) as (Run & {supplierDraftContext?:{serviceId:string}})|undefined;
        if(card.kind==='progress'&&supplierRun?.supplierDraftContext?.serviceId){const title=({queued:'商品事实整理已排队',running:'Pi 正在整理商品事实',succeeded:'原商品事实已保存',failed:'商品事实整理未完成',blocked:'商品事实整理受阻',interrupted:'原商品整理已中断',cancelled:'原商品整理已取消'} as Record<string,string>)[supplierRun.status]||'原商品整理状态待核对';return{...card,title,detail:card.detail+'\n此原运行只整理内部事实；预览、Shopify 和七天结果以各自记录为准。'};}
        const draft = drafts.find(value => value.runId === card.runId);
        if (!draft || card.kind !== 'progress') return card;
        const status = snapshot.runs?.find(run => run.id === draft.runId)?.status || '';
        const title = ({ queued: '草案整理已排队', running: '正在整理委托草案', succeeded: '草案已保存', interrupted: '草案整理已中断', cancelled: '草案整理已取消', failed: '草案整理失败', blocked: '草案需要处理' } as Record<string, string>)[status] || '草案状态待核对';
        return { ...card, title, detail: card.detail + '\n此记录是草案整理结果；原任务进度以订单卡为准。' };
      });
      this.setData({ conversationId: id, ...view, messages: view.messages.map(value => value.source === 'procurement' ? { ...value, content: procurementMessage(value.content, value.supplyInquiryId) } : value), cards, readError: '', uncertain: client().uncertain, pendingLabel, pendingSummary: client().pendingSummary, readAt: new Date().toLocaleTimeString(),
        museDrafts: drafts, draftCards, selectedDraft: selected || null, goalBlocked: client().requiresOriginalMuse && (!originalBound || !client().museDraftCapable), busy: view.busy || drafts.some(value => ['pending', 'preparing', 'rejecting'].includes(value.phase)),
        drafting: drafts.some(value => value.phase === 'pending'), needsDraftInput: active?.phase === 'needs_information',
        composerHint: this.data.supplierMode ? this.data.supplierCommand === 'shopify-publish' ? '请输入一个真实既有渠道 Publication gid，不用商品 ID 替代…' : this.data.supplierCommand === 'monitors' ? '提供既有 Shopify 商品 gid 和明确 UTC 开始时间…' : this.data.supplierCommand === 'shopify-observation' ? '提供既有 Shopify 商品 gid，可附渠道 publication gid…' : '补充或修改商品事实；未知可保留…' : active?.phase === 'needs_information' ? '只需补充上面必要的信息…' : active?.editable ? '补充或修改这份草案…' : '描述要交给原 Muse 的业务目标…',
        ...(client().pendingDraft && !this.data.draft ? { draft: client().pendingDraft } : {}), ...(client().pendingKind === 'procurement-reply' ? { replyInquiryId: client().pendingInquiryId } : {}), runtimeNotice: client().requiresOriginalMuse && !originalBound ? '原 Muse 会话尚未绑定；目标处理已阻挡，采购需求仍可按需关联与回复。' : client().requiresOriginalMuse && !client().museDraftCapable ? '当前服务尚未提供原 Muse 草案能力；此意图已阻挡，请先完成服务接入。' : snapshot.runtime?.configured === false ? '云端模型尚未接入，发送后会保存请求并显示真实阻挡原因。' : '' });
      if (client().pendingKind.startsWith('supplier-')||client().pendingKind.startsWith('publication-')||client().pendingKind.startsWith('notification-')) this.setData({supplierMode:true,selectedSupplierId:client().pendingSupplierId || this.data.selectedSupplierId});
      this.setData({supplierAvailable:client().supplierCapable});
      if (this.data.supplierMode && client().supplierCapable) await this.refreshShopReadiness();
      if (id && client().supplierCapable) await this.refreshSupplier();
      if (this.data.procurementOpen || this.data.replyInquiryId || client().pendingInquiryId) await this.refreshProcurement();
      readFailures = 0;
    } catch (error) {
      readFailures++;
      if (visible && opened === epoch) {
        this.setData({ readError: message(error) });
        if (client().requiresOriginalMuse) this.setData({ goalBlocked: true, selectedDraft: null });
        if (error instanceof ClientError && (error.status === 401 || error.code === 'CSRF_REJECTED')) { this.clearAccount(); this.setData({ error: message(error), readError: '' }); }
      }
    } finally {
      reading = false; if (timer !== undefined) clearTimeout(timer);
      if (visible && this.data.authenticated) timer = setTimeout(() => { void this.refresh(); }, Math.min(30000, 2000 * 2 ** Math.min(readFailures, 4)));
    }
  },
  draft(event: WechatMiniprogram.Input) { this.setData({ draft: event.detail.value }); },
  async send() {
    if (this.data.replyInquiryId) { this.reviewProcurementReply(); return; }
    if (this.data.supplierMode) { await this.sendSupplier(); return; }
    if (!this.data.authenticated || !this.data.conversationId || this.data.loading || this.data.busy || this.data.goalBlocked || client().uncertain) return;
    this.setData({ loading: true, error: '' });
    try { await client().send(this.data.conversationId, this.data.draft, this.data.files); this.setData({ draft: '', files: [] }); await this.refresh(); }
    catch (error) { this.setData({ error: message(error), uncertain: client().uncertain, pendingLabel: client().requiresOriginalMuse ? '草案文字' : '消息' }); }
    finally { this.setData({ loading: false }); }
  },
  async retry() {
    if (this.data.loading || !this.data.authenticated) return;
    const kind = client().pendingKind;
    this.setData({ loading: true, error: '' });
    try {
      const result = await client().retryPending() as { operation?:PublicationOperation;notAdmitted?:boolean;waiting?:boolean; artifact?: Artifact; serviceId?:string; status?:string; error?:{code:string} };
      if(kind.startsWith('publication-'))this.setData({shopifyReview:null,publicationNotAdmitted:result.notAdmitted===true,supplierNotice:result.notAdmitted?'原执行尚未被接收，原审批未使用；只在再次明确确认后提交同一请求。':result.waiting?'原操作仍在进行；保留请求，只读等待。':'已读取原操作结果；未盲重试外部写入。'});
      if(kind.startsWith('notification-'))this.setData({shopifyReview:null,notificationNotAdmitted:result.notAdmitted===true,supplierNotice:result.notAdmitted?'原通知执行未接收；须再次明确确认同一请求。':result.waiting?'原通知正在处理，只能读取等待。':'已读取原通知状态；未重发消息。'});
      if (kind.startsWith('supplier-')) {this.setData({supplierReview:null,supplierScope:null,...(result.serviceId?{selectedSupplierId:result.serviceId}:{}),...(kind==='supplier-intake'?{draft:''}:{}),...(kind==='supplier-profile'?{files:this.data.files.filter(file=>!file.mimeType?.startsWith('image/'))}:{}),supplierNotice:result.error?supplierErrorText(result.error.code):''});}
      if (kind === 'send' || kind === 'intake') this.setData({ draft: '', files: [] });
      if (kind.startsWith('procurement-')) { this.setData({ procurementReview: null }); if (kind === 'procurement-reply') this.exitProcurementReply(true); }
      if (kind === 'upload' && result.artifact) this.setData({ files: [...this.data.files, fileReference(result.artifact)] });
      if (kind === 'action') this.setData({ reviewCard: null });
      if (kind === 'prepare' || kind === 'reject') this.setData({ selectedDraft: null });
      if (kind === 'references') await this.openReferences();
      this.setData({ uncertain: client().uncertain }); await this.refresh();if(kind==='notification-challenge'&&!client().uncertain)this.setData({shopifyReview:null,supplierNotice:'原challenge请求已核对；请重新准备当前可信会话的challenge，再明确点击微信原生订阅。旧会话challenge不构成订阅授权。'});
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
  async refreshSupplier() {
    const opened=epoch,id=this.data.conversationId;
    try {
      const services=await client().supplierServices(id); if(!visible||opened!==epoch||id!==this.data.conversationId)return;
      const selected=this.data.newSupplier?undefined:services.find(item=>item.id===this.data.selectedSupplierId) || [...services].reverse().find(item=>!['cancelled','rejected'].includes(item.phase));
      const scope=this.data.supplierScope && selected && selected.id===this.data.supplierScope.id ? {id:selected.id,revision:selected.revision,profile:selected.profile}:null;
      this.setData({supplierServices:services,supplierCards:services.map(presentSupplier),selectedSupplierId:selected?.id||'',supplierScope:scope,supplierReadError:''});
      const originalMonitors=selected?await client().supplierMonitors(id,selected.id):[];if(visible&&opened===epoch&&id===this.data.conversationId&&selected?.id===this.data.selectedSupplierId)this.setData({supplierMonitors:originalMonitors.map(item=>this.monitorPresentation(item))});const monitors=await Promise.all(originalMonitors.map(async item=>{try{const first=await client().notificationStatus(id,item.serviceId,item.id,'first_sample');return {...item,firstNotification:first.notification};}catch{return item;}}));
      if(visible&&opened===epoch&&id===this.data.conversationId&&selected?.id===this.data.selectedSupplierId){this.setData({supplierMonitors:monitors.map(item=>this.monitorPresentation(item))});const review=this.data.shopifyReview;if(review?.action==='notification'){const monitor=monitors.find(item=>item.id===review.monitorId),n=review.phase==='first_sample'?monitor?.firstNotification:monitor?.notification,op=n?.review,source=n?.source||(review.phase==='first_sample'?null:monitor?.summary);if(!monitor||monitor.scopeHash!==review.monitorHash||monitor.stoppedAt||review.stage==='prepare'&&(source?.contentHash!==review.summaryHash||source?.revision!==review.summaryRevision)||(review.stage==='decision'||review.stage==='execute')&&(!op||op.id!==review.operationId||op.scopeHash!==review.scopeHash||op.scope.expectedSummaryHash!==source?.contentHash||op.scope.expectedSummaryRevision!==source?.revision||review.stage==='execute'&&!notificationExecutable(monitor,n!)))this.setData({shopifyReview:null,error:'原监测/通知来源范围已变，请重新读取后审阅。'});}if(selected)await this.refreshPublication();else this.setData({publicationState:null,publicationCards:[]});}
    } catch(error){if(visible&&opened===epoch)this.setData({supplierReadError:message(error),supplierScope:null});}
  },
  async beginSupplier() {
    if(!this.data.authenticated||this.data.loading||client().uncertain)return;
    if(this.data.replyInquiryId)this.exitProcurementReply();
    this.setData({loading:true,error:''});
    try {const snapshot=await client().bootstrap();if(!client().supplierCapable)throw new Error('当前业务服务尚未提供供应商 Pi 能力。');
      const id=await client().mainConversation(snapshot,'business');this.setData({conversationId:id,supplierMode:true,supplierCommand:'',replyInquiryId:'',composerHint:'说说商品、市场、供货与零售信息；未知可保留…'});await this.refresh();
    }catch(error){this.setData({error:message(error),uncertain:client().uncertain});}finally{this.setData({loading:false});}
  },
  startNewSupplier(){if(!this.data.loading&&!client().uncertain)this.setData({newSupplier:true,supplierMode:true,selectedSupplierId:'',supplierScope:null,supplierReview:null,supplierCommand:'',supplierMonitors:[],verifiedProductImage:null,composerHint:'描述另一件明确商品；不会复用已停止的整理范围…'});},
  exitSupplier() {if(!this.data.loading&&!client().uncertain)this.setData({supplierMode:false,supplierCommand:'',supplierScope:null,supplierReview:null});},
  async sendSupplier() {
    if(this.data.loading||this.data.busy||client().uncertain||!this.data.conversationId)return;
    const service=this.data.newSupplier?undefined:this.data.supplierServices.find(item=>item.id===this.data.selectedSupplierId);
    if(service&&['cancelled','rejected'].includes(service.phase)){this.setData({error:'此商品整理已停止或拒绝，请明确选择新商品，不恢复旧范围。'});return;}
    if(this.data.supplierCommand){
      if(!service)return;
      if(this.data.supplierCommand==='shopify-publish'){const ids=this.data.draft.match(/gid:\/\/shopify\/Publication\/\d+/g)||[];if(ids.length!==1){this.setData({error:'请提供一个真实的既有渠道 Publication gid，不猜渠道或用商品 ID 替代。'});return;}await this.prepareShopify(service.id,'publish',ids[0]);return;}
      const products=this.data.draft.match(/gid:\/\/shopify\/Product\/\d+/g)||[],times=this.data.draft.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g)||[];
      if(products.length!==1){this.setData({error:'请明确提供一个既有 Shopify 商品 gid，不能用商品名或预览 ID 替代。'});return;}
      const data:Record<string,unknown>={expectedRevision:service.revision,shopifyProductId:products[0],confirmed:true};
      if(this.data.supplierCommand==='monitors'){
        const publication=this.data.draft.includes('已核验发布时间');
        if(publication&&times.length||!publication&&(times.length!==1||!Number.isFinite(Date.parse(times[0]))||new Date(times[0]).toISOString()!==(times[0].includes('.')?times[0]:times[0].replace('Z','.000Z')))){this.setData({error:'请明确提供一个 UTC 开始时间，或明确选择“已核验发布时间”；两者不能同时使用。'});return;}
        if(publication){if(service.external?.published!==true||service.external.productId!==products[0]||service.external.publicationTimeSource!=='online_store_published_at'||!service.external.publishedAt){this.setData({error:'原服务没有可用的已核验在线商店发布时间。'});return;}data.startFromPublication=true;}else data.startAt=times[0];
        const variants=this.data.draft.match(/gid:\/\/shopify\/ProductVariant\/\d+/g)||[];if(variants.length)data.variantIds=variants;
      }else{const publication=this.data.draft.match(/gid:\/\/shopify\/Publication\/\d+/g)||[];if(publication.length>1){this.setData({error:'请明确一个渠道 publication ID。'});return;}if(publication.length)data.publicationId=publication[0];}
      this.setData({supplierReview:{kind:this.data.supplierCommand,serviceId:service.id,revision:service.revision,profileHash:service.profileHash,data,detail:`原商品 ${service.profile.name||service.id} · 修订 ${service.revision}\n${JSON.stringify(data,null,2)}\n${this.data.supplierCommand==='monitors'?'只配置七天原任务，仍需原 Schedule 审批；外部通知未配置。':'只观察已有商品和渠道；ACTIVE 不代表已发布，不创建或发布。'}`},error:''});return;
    }
    this.setData({loading:true,error:''});try{
      const result=await client().supplierIntake(this.data.conversationId,this.data.draft,service?{id:service.id,revision:service.revision}:undefined) as {serviceId:string};
      this.setData({draft:'',newSupplier:false,selectedSupplierId:result.serviceId,supplierNotice:'商品文字已提交原 Pi；图片仅存档，可在事实保存后单独确认原图片来源。'});await this.refresh();
    }catch(error){this.setData({error:message(error),uncertain:client().uncertain,pendingLabel:'商品事实'});}finally{this.setData({loading:false});}
  },
  openSupplierResources(event:WechatMiniprogram.TouchEvent){if(this.data.loading||client().uncertain)return;this.setData({selectedSupplierId:event.currentTarget.dataset.id,supplierResourcesOpen:true});void this.refreshSupplier();},
  closeSupplierResources(){this.setData({supplierResourcesOpen:false});},
  async refreshPublication(){
    const opened=epoch,cid=this.data.conversationId,sid=this.data.selectedSupplierId;if(!sid){this.setData({publicationState:null,publicationCards:[],shopifyReview:null});return;}
    try{const value=await client().publication(cid,sid);if(!visible||opened!==epoch||cid!==this.data.conversationId||sid!==this.data.selectedSupplierId)return;
      const services=this.data.supplierServices.map(item=>item.id===sid?value.service:item);this.setData({publicationState:value.publication,publicationCards:value.publication.operations.map(presentPublication),publicationError:'',supplierServices:services,supplierCards:services.map(presentSupplier)});
      const review=this.data.shopifyReview;
      if(review&&review.action!=='notification'){if(review.stage==='prepare'){const original=review.draftOperationId?value.publication.operations.find(item=>item.id===review.draftOperationId):null;if(value.service.revision!==review.revision||value.service.preview?.previewHash!==review.previewHash||review.action==='repair_draft'&&(!original||!canReviewDraftRepair(original)||original.receipt?.remoteContentHash!==review.expectedRemoteContentHash||JSON.stringify(original.receipt?.mediaSnapshot||[])!==review.expectedMediaSnapshot))this.setData({shopifyReview:null,error:'原商品或预览已变，请重新审阅本次外发范围。'});}
        else{const op=value.publication.operations.find(item=>item.id===review.operationId&&item.scopeHash===review.scopeHash);this.setData({shopifyReview:op?this.publicationReview(op,review.stage):null});}}
    }catch(error){if(visible&&opened===epoch&&sid===this.data.selectedSupplierId)this.setData({publicationError:error instanceof ClientError&&error.status===404?'当前服务没有部署新 Shopify 审批契约，未启用写入。':message(error),shopifyReview:null});}
  },
  publicationReview(op:PublicationOperation,stage:'decision'|'execute'|'reconcile'|'retry'|'native'|'cancel'|'revoke'):ShopifyReview{
    return{key:JSON.stringify([op.id,op.scopeHash,stage,op.status,op.approvalStatus,op.stale,op.canExecute]),stage,action:op.action,serviceId:op.scope.serviceId,revision:op.scope.serviceRevision,previewHash:op.scope.previewHash,operationId:op.id,scopeHash:op.scopeHash,publicationId:op.scope.publicationId||undefined,draftOperationId:op.scope.draftOperationId||undefined,expectedRemoteContentHash:op.scope.repair?.beforeRemoteContentHash,observedMediaRequired:op.scope.repair?.approveObservedMedia===true,approveObservedMedia:op.scope.repair?.approveObservedMedia===true,hasImages:op.scope.transfer.images.length>0,
      allowConfirm:stage==='decision'?!op.stale&&op.status==='pending_approval'&&op.approvalStatus==='pending':stage==='reconcile'?op.canReconcile:op.canExecute&&!op.stale,
      title:stage==='decision'?'审批这一个原 Shopify 作用域':stage==='reconcile'?'只读核对原 Shopify 结果':stage==='retry'?'明确重提未接收的原执行请求':'独立执行已批准操作',detail:publicationScopeText(op.scope)+`\n原操作 ${op.id}\n审批 ${op.approvalId||'未生成'} · 状态 ${op.approvalStatus||'未知'}\nscope SHA256 ${op.scopeHash}${op.stale?'\n范围已失效，不能批准或执行。':''}`};
  },
  async prepareShopify(serviceId:string,action:'draft'|'publish',publicationId?:string){
    if(this.data.loading||client().uncertain)return;this.setData({selectedSupplierId:serviceId,supplierResourcesOpen:false,supplierMode:true});await this.refreshPublication();
    const service=this.data.supplierServices.find(item=>item.id===serviceId),state=this.data.publicationState;if(!service||!state||this.data.publicationError)return;
    const preview=service.preview;if(!preview||preview.phase!=='preview_ready'||preview.missingFields.length){this.setData({error:'请先补齐可用图片与零售字段，并审阅当前完整 Listing 预览。'});return;}
    const images=preview.images.map(image=>image.kind==='artifact'?`${image.sourceNote}\n原文件 ${image.asset.artifactId} v${image.asset.version}\nSHA256 ${image.asset.sha256}`:`${image.sourceNote}\n公开 URL ${image.url}（原始字节未核验）`).join('\n\n');
    const latestDraft=[...state.operations].reverse().find(op=>op.action==='draft'&&op.receipt?.complete&&op.status==='succeeded'&&op.scope.previewHash===preview.previewHash);
    if(action==='publish'&&!latestDraft){this.setData({error:'先核对这一预览的完整原 Shopify 草稿；部分或未知结果仅能只读核对。'});return;}
    this.setData({shopifyReview:{key:JSON.stringify([service.id,service.revision,preview.previewHash,action,publicationId||'',state.domain]),stage:'prepare',action,serviceId:service.id,revision:service.revision,previewHash:preview.previewHash,publicationId,hasImages:preview.images.length>0,allowConfirm:true,title:action==='draft'?'准备草稿与图片的独立审批':'准备精确渠道发布审批',
      detail:`${action==='draft'?'只创建 Shopify DRAFT，不发布渠道':'仅发布这一完整原草稿到下列渠道'}\n当前店铺 ${state.domain||'未配置'} · 写入${state.writesEnabled?'主机已配置，仍需原 Connector/审批':'未启用'} · Connector ${state.connectorStatus}\n原服务 ${service.id} · 修订 ${service.revision}\n商品 ${action==='publish'?latestDraft?.receipt?.productId:'尚未创建'}\n渠道 ${publicationId||'本次没有渠道发布'}\n${preview.product.title}\n${preview.saleUnit.consumerPrice} ${preview.market.currency} · ${preview.saleUnit.unitsPerPack} ${preview.saleUnit.unit}/包\n${preview.display.paragraphs.join('\n')}\nSKU ${preview.variants.map(item=>item.sku||'未提供').join('、')}\n本次已选图片：\n${images}\n预览 SHA256 ${preview.previewHash}\n图片外发仅限本次范围；远端 READY 不等于 CDN 字节一致。`},error:''});
  },
  async prepareDraftRepair(operationId:string){
    if(this.data.loading||client().uncertain)return;await this.refreshPublication();const original=this.data.publicationState?.operations.find(item=>item.id===operationId),service=this.data.supplierServices.find(item=>item.id===original?.scope.serviceId);
    if(!original||!service||!canReviewDraftRepair(original)||service.revision!==original.scope.serviceRevision||service.preview?.previewHash!==original.scope.previewHash){this.setData({error:'先只读核对准确原草稿；仅当前预览的已对账部分 DRAFT 可审阅修复。'});return;}
    const receipt=original.receipt!,observedMediaRequired=receipt.issues?.includes('media_identity_unconfirmed')===true;
    this.setData({supplierResourcesOpen:false,shopifyReview:{key:JSON.stringify([original.id,original.scopeHash,receipt.remoteContentHash,receipt.mediaSnapshot,service.revision,'repair_draft']),stage:'prepare',action:'repair_draft',serviceId:service.id,revision:service.revision,previewHash:original.scope.previewHash,draftOperationId:original.id,expectedRemoteContentHash:receipt.remoteContentHash,expectedMediaSnapshot:JSON.stringify(receipt.mediaSnapshot||[]),observedMediaRequired,hasImages:false,allowConfirm:true,title:'审阅原草稿缺失步骤修复',
      detail:`只修复这一已对账原 DRAFT，仍需后端检查并生成准确步骤；不创建商品、不上传图片、不激活或发布。\n店铺 ${original.scope.shopDomain} · ${original.scope.shopId}\n原草稿操作 ${original.id}\n原 scope SHA256 ${original.scopeHash}\n原商品 ${receipt.productId} · 原变体 ${(receipt.variantIds||[]).join('、')}\n原服务 ${service.id} · 修订 ${service.revision}\n原预览 SHA256 ${original.scope.previewHash}\n远端内容 SHA256 ${receipt.remoteContentHash}\n观察时间 ${receipt.observedAt||'未提供'}\n原差异 ${(receipt.issues||[]).join('、')}\n${service.preview.product.title}\nSKU ${service.preview.variants.map(item=>item.sku||'未提供').join('、')} · 消费售价 ${service.preview.saleUnit.consumerPrice} ${service.preview.market.currency}\n${observedMediaRequired?'原创建响应未确认媒体身份；采用以下观察媒体需另行明确批准':'以下媒体身份沿用原回执'}：\n${mediaSnapshotText(receipt.mediaSnapshot||[])}\n远端 READY 不代表 CDN 字节一致；remoteBytesVerified=false。`},error:''});
  },
  async beginDraftWrite(event:WechatMiniprogram.TouchEvent){await this.prepareShopify(event.currentTarget.dataset.id,'draft');},
  beginChannelPublish(event:WechatMiniprogram.TouchEvent){if(this.data.loading||client().uncertain)return;this.setData({selectedSupplierId:event.currentTarget.dataset.id,supplierMode:true,supplierCommand:'shopify-publish',supplierResourcesOpen:false,draft:'',composerHint:'输入真实既有渠道 Publication gid，之后单独审阅审批…'});void this.refreshPublication();},
  publicationCard(event:WechatMiniprogram.TouchEvent){
    if(this.data.loading||client().uncertain)return;const op=this.data.publicationState?.operations.find(item=>item.id===event.currentTarget.dataset.id);if(!op)return;
    if(event.currentTarget.dataset.kind==='repair'){void this.prepareDraftRepair(op.id);return;}const stage=event.currentTarget.dataset.kind as 'decision'|'execute'|'reconcile';if(!['decision','execute','reconcile'].includes(stage))return;this.setData({shopifyReview:this.publicationReview(op,stage),error:''});
  },
  closeShopifyReview(){if(!this.data.loading)this.setData({shopifyReview:null});},
  async confirmShopifyReview(event:WechatMiniprogram.CustomEvent<ShopifyReview & {confirmed:boolean}>,denied=false){
    if(this.data.loading||!event.detail.confirmed)return;const current=this.data.shopifyReview;if(!current||event.detail.key!==current.key||(!denied&&!current.allowConfirm)||client().uncertain&&current.stage!=='retry')return;const target=current;if(target.action==='notification'){await this.confirmNotificationReview(target,denied);return;}
    const service=this.data.supplierServices.find(item=>item.id===target.serviceId),op=this.data.publicationState?.operations.find(item=>item.id===target.operationId&&item.scopeHash===target.scopeHash);
    if(!service||target.stage==='prepare'&&(service.revision!==target.revision||service.preview?.previewHash!==target.previewHash)||target.stage!=='prepare'&&!op){this.setData({shopifyReview:null,error:'原对象或范围已变，请重新读取并审阅。'});return;}
    this.setData({loading:true,error:''});try{
      const result=target.stage==='prepare'?target.action==='repair_draft'?await client().reviewDraftRepair(this.data.conversationId,service,this.data.publicationState!.operations.find(item=>item.id===target.draftOperationId)!,target.expectedRemoteContentHash!,event.detail.approveObservedMedia===true,true):await client().reviewPublication(this.data.conversationId,service,target.action,target.publicationId,true):target.stage==='retry'?await client().executeUnadmittedPublication(true):await client().publicationAction(this.data.conversationId,service.id,op!,target.stage==='decision'?denied?'denied':'approved':target.stage==='execute'?'execute':'reconcile',true);
      this.setData({shopifyReview:null,publicationNotAdmitted:false,notificationNotAdmitted:false,supplierCommand:'',...(this.data.supplierCommand==='shopify-publish'?{draft:''}:{}),uncertain:client().uncertain,supplierNotice:result.error?message(new ClientError(result.error.code,result.error.message||result.error.code)):target.stage==='prepare'?'原独立审批已准备，尚未批准或执行。':target.stage==='decision'?denied?'已拒绝这一原写入审批。':'批准已保存，执行仍需独立确认。':result.operation?.status==='uncertain'?'原外部结果未知；后续只读核对，不能盲重试或补写。':'已读取原操作/回执，以本会话的具体状态为准。'});await this.refresh();
    }catch(error){this.setData({error:message(error),uncertain:client().uncertain,pendingLabel:target.stage==='execute'||target.stage==='retry'?'原 Shopify 执行':'原 Shopify 审批/核对'});}finally{this.setData({loading:false});}
  },
  async denyShopifyReview(event:WechatMiniprogram.CustomEvent<ShopifyReview & {confirmed:boolean}>){await this.confirmShopifyReview(event,true);},
  reviewUnadmittedPublication(){if(this.data.loading||!this.data.publicationNotAdmitted||client().pendingKind!=='publication-execute')return;const op=this.data.publicationState?.operations.find(item=>item.id===client().pendingPublicationOperationId);if(op&&!op.connectorRunId&&op.canExecute)this.setData({shopifyReview:this.publicationReview(op,'retry')});},
  supplierAction(event:WechatMiniprogram.TouchEvent) {
    if(this.data.loading||client().uncertain)return;const service=this.data.supplierServices.find(item=>item.id===event.currentTarget.dataset.id);if(!service)return;
    const kind=event.currentTarget.dataset.kind;this.setData({newSupplier:false,supplierResourcesOpen:false,selectedSupplierId:service.id,supplierMode:true,supplierCommand:'',error:''});
    if(kind==='edit'){this.setData({composerHint:'只需说明要补充或修改的商品事实…',supplierScope:null});return;}
    if(kind==='details'){this.setData({preview:{title:'原商品内部资料',content:Object.entries(service.profile).filter(([field])=>field!=='images').map(([field,value])=>`${supplierFieldLabels[field]||field}：${value===null?'尚未提供':value}`).join('\n')+'\n\n'+service.questions.map(item=>item.question.replace(item.field,supplierFieldLabels[item.field]||item.field)).join('\n'),verified:false}});return;}
    if(kind==='preview'){this.setData({supplierScope:{id:service.id,revision:service.revision,profile:service.profile}});return;}
    if(kind==='shopify-observation'||kind==='monitors'){this.setData({supplierCommand:kind,draft:'',composerHint:kind==='monitors'?'提供既有 Shopify 商品 gid 和明确 UTC 开始时间…':'提供既有 Shopify 商品 gid，可附渠道 publication gid…'});void this.refreshSupplier();return;}
    if(kind==='images'){
      const files=this.data.files.filter(file=>file.mimeType?.startsWith('image/'));if(!files.length){this.setData({error:'先通过图片按钮选择原图片；不从文字或 PDF 假提取图片。'});return;}
      const images=[...service.profile.images,...files.map(file=>({kind:'artifact' as const,asset:{artifactId:file.id,version:file.version,sha256:file.sha256},sourceNote:`用户本次选择：${file.filename}（内部图片来源，未授予外发许可）`}))];
      this.setData({supplierReview:{kind:'images',serviceId:service.id,revision:service.revision,profileHash:service.profileHash,data:{},facts:{images},detail:`保存为原商品内部图片来源；不解析图片、不外发。\n${images.map(image=>image.kind==='artifact'?`${image.sourceNote}\n原文件 ${image.asset.artifactId} v${image.asset.version}\nSHA256 ${image.asset.sha256}`:`${image.sourceNote}\n${image.url}`).join('\n\n')}`}});return;
    }
    if(kind==='save-product'||kind==='shopify-draft'||kind==='cancel'||kind==='reject'){
      if(kind==='shopify-draft'&&!service.preview){this.setData({error:'请先审阅并生成当前商品预览。'});return;}
      const data={expectedRevision:service.revision,confirmed:true,...(['cancel','reject'].includes(kind)?{expectedProfileHash:service.profileHash}:{}),...(kind==='shopify-draft'?{expectedPreviewHash:service.preview!.previewHash}:{})};
      this.setData({supplierReview:{kind,serviceId:service.id,revision:service.revision,profileHash:service.profileHash,data,detail:`${service.profile.name||service.id} · 原修订 ${service.revision}\n范围 SHA256 ${service.profileHash}\n${kind==='cancel'||kind==='reject'?'停止/拒绝这一原商品整理，保留事实历史、使预览失效；不取消别的会话运行，七天监测须另按原监测停止。':kind==='save-product'?'保存到原内部资料库，供货单位/MOQ/批发价格/生产期保留原含义，不发布。':`预览 SHA256 ${service.preview!.previewHash}\nShopify 创建/发布当前未授权；本次只核对原服务阻挡状态。`}`}});
    }
  },
  closeSupplierScope(){if(!this.data.loading)this.setData({supplierScope:null});},
  async confirmSupplierPreview(event:WechatMiniprogram.CustomEvent<{id:string;expectedRevision:number;confirmed:boolean;publicFields:PublicListingField[]}>) {
    if(this.data.loading||client().uncertain)return;const target=event.detail,service=this.data.supplierServices.find(item=>item.id===target.id&&item.revision===target.expectedRevision);if(!service){this.setData({supplierScope:null,error:'原商品修订已变，请重新审阅。'});return;}
    this.setData({loading:true,error:''});try{await client().supplierPreview(this.data.conversationId,service,target.publicFields,target.confirmed===true);this.setData({supplierScope:null,supplierNotice:'原服务商品预览已保存；尚未创建或发布到 Shopify。'});await this.refresh();}catch(error){this.setData({error:message(error),uncertain:client().uncertain,pendingLabel:'商品预览'});}finally{this.setData({loading:false});}
  },
  closeSupplierReview(){if(!this.data.loading)this.setData({supplierReview:null});},
  async confirmSupplierReview(){
    const review=this.data.supplierReview;if(!review||this.data.loading||client().uncertain)return;const service=this.data.supplierServices.find(item=>item.id===review.serviceId&&item.revision===review.revision&&item.profileHash===review.profileHash);
    if(!service){this.setData({supplierReview:null,error:'原商品范围已改变，请重新审阅。'});return;}
    this.setData({loading:true,error:''});try{
      const result=(review.kind==='images'?await client().supplierProfile(this.data.conversationId,service,review.facts!):await client().supplierOperation(this.data.conversationId,service.id,review.kind,review.data,review.detail)) as {status?:string;error?:{code:string};activation?:string};
      this.setData({supplierReview:null,supplierCommand:'',draft:'',...(review.kind==='images'?{files:this.data.files.filter(file=>!file.mimeType?.startsWith('image/')),verifiedProductImage:null}:{}),supplierNotice:result.error?supplierErrorText(result.error.code):result.activation==='disabled_requires_original_schedule_approval'?'七天原任务已保存配置；尚未启用，仍需原 Schedule 审批，外部通知未配置。':review.kind==='images'?'原图片来源已内部保存；没有外发授权。':'原服务操作已提交，以云端记录为准。'});await this.refresh();
    }catch(error){this.setData({error:message(error),uncertain:client().uncertain,pendingLabel:'商品服务操作'});}finally{this.setData({loading:false});}
  },
  monitorPresentation(monitor:SupplierMonitor){const n=monitor.notification,r=n?.review,grant=client().subscriptionReference(monitor),terminal=!!n?.delivery.submittedAt||!!n?.delivery.cancelledAt;
    const first=monitor.firstNotification,fr=first?.review,fg=client().subscriptionReference(monitor,'first_sample'),ft=!!first?.delivery.submittedAt||!!first?.delivery.cancelledAt;return {...presentMonitor(monitor),firstNotificationTitle:first?notificationText(first).title:'首次采样通知尚未读取，默认关闭',firstNotificationDetail:notificationText(first).detail,canFirstSubscribe:!monitor.stoppedAt&&!ft,canFirstReview:!!fg&&!!first?.source&&!monitor.stoppedAt&&!ft,canFirstDecide:fr?.status==='pending_approval'&&fr.approvalStatus==='pending',canFirstExecute:!!first&&notificationExecutable(monitor,first),canFirstRevoke:!!fg,canFirstCancel:!!first&&!first.delivery.cancelledAt,canSubscribe:!monitor.stoppedAt&&!terminal,canNotifyReview:!!grant&&!!monitor.summary&&!monitor.stoppedAt&&!terminal,canNotifyDecide:!!r&&r.status==='pending_approval'&&r.approvalStatus==='pending',canNotifyExecute:!!n&&notificationExecutable(monitor,n),canNotifyRevoke:!!grant,canNotifyCancel:!!n&&!n.delivery.cancelledAt};
  },
  showNativeSubscription(monitor:SupplierMonitor,challenge:SubscriptionChallenge){if(!challenge.challengeId||challenge.userGestureRequired!==true){this.setData({error:'可信设施没有返回准确原生challenge，未调用微信API。'});return;}
    this.setData({shopifyReview:{key:JSON.stringify([monitor.id,monitor.scopeHash,challenge.challengeId,'native']),stage:'native',action:'notification',phase:challenge.phase||'summary',monitorId:monitor.id,monitorHash:monitor.scopeHash,serviceId:monitor.serviceId,revision:0,previewHash:'',challenge,hasImages:false,allowConfirm:!monitor.stoppedAt,title:challenge.phase==='first_sample'?'点击原生订阅这次首次采样':'点击原生订阅这一七天总结',detail:`原监测 ${monitor.id}\n范围 SHA256 ${monitor.scopeHash}\nAppID ${challenge.appId} · 准确模板 ${challenge.templateId}\nchallenge ${challenge.challengeId}\n有效期 ${challenge.expiresAt}\n只有下方明确点击才调用 wx.requestSubscribeMessage；返回的准确模板决定仅为认证客户端报告，不是独立微信授权证明，实际授权待发送接口核验。没有通知批准或发送，首次采样与七天总结分别订阅/审批。\n${challenge.evidenceKind==='local_fixture'?'当前为本地fixture，不是真实微信订阅。':''}`},error:''});
  },
  async notificationCard(event:WechatMiniprogram.TouchEvent){
    if(this.data.loading||client().uncertain)return;const mid=event.currentTarget.dataset.id,kind=event.currentTarget.dataset.kind,phase:NotificationPhase=event.currentTarget.dataset.phase==='first_sample'?'first_sample':'summary',monitor=this.data.supplierMonitors.find(item=>item.id===mid);if(!monitor)return;
    if(kind==='details'){this.setData({preview:{title:'原监测、流量与通知完整证据',content:monitor.detail+'\n\n'+monitor.summaryText+'\n\n'+monitor.notificationDetail+'\n\n'+monitor.firstNotificationDetail+'\n\n'+(monitor.firstNotification?notificationSourceText(monitor.firstNotification):'首次来源尚未读取'),verified:false}});return;}
    this.setData({loading:true,error:''});try{const r=await client().notificationStatus(this.data.conversationId,monitor.serviceId,mid,phase);const updated={...monitor,...(phase==='first_sample'?{firstNotification:r.notification}:{notification:r.notification})};this.setData({supplierMonitors:this.data.supplierMonitors.map(item=>this.monitorPresentation(item.id===mid?updated:item))});
      if(kind==='status'){this.setData({supplierNotice:'已读取原通知状态，没有重发。'});return;}
      if(kind==='subscribe'){const challenge=await client().prepareNotificationSubscription(this.data.conversationId,updated,true,phase);if(challenge.status==='blocked'){this.setData({supplierNotice:challenge.code||'缺可信订阅设施'});return;}this.showNativeSubscription(updated,challenge);return;}
      const op=r.notification.review,stage=kind==='review'?'prepare':kind as 'decision'|'execute'|'cancel'|'revoke';if(!['prepare','decision','execute','cancel','revoke'].includes(stage))return;
      if((stage==='decision'||stage==='execute')&&!op){this.setData({error:'尚无独立原通知审批；监测 Schedule 审批不授予通知权限。'});return;}
      const grant=client().subscriptionReference(updated,phase),summary=r.notification.source||(phase==='first_sample'?null:updated.summary);
      this.setData({shopifyReview:{key:JSON.stringify([mid,updated.scopeHash,op?.id,op?.scopeHash,op?.status,stage,summary?.contentHash,grant?.subscriptionId]),stage,action:'notification',phase,monitorId:mid,monitorHash:updated.scopeHash,summaryHash:summary?.contentHash,summaryRevision:summary?.revision,serviceId:updated.serviceId,revision:0,previewHash:'',operationId:op?.id,scopeHash:op?.scopeHash,hasImages:false,
        allowConfirm:stage==='prepare'?!!grant&&!!summary&&!updated.stoppedAt&&!r.notification.delivery.submittedAt:stage==='decision'?op!.status==='pending_approval'&&op!.approvalStatus==='pending':stage==='execute'?notificationExecutable(updated,r.notification):stage==='revoke'?!!grant:true,title:stage==='prepare'?phase==='first_sample'?'准备首次采样独立通知审批':'准备七天总结独立通知审批':stage==='decision'?'批准或拒绝准确原通知':stage==='cancel'?'请求取消原通知':stage==='revoke'?'撤销原一次性订阅':'独立执行已批准通知',
        detail:stage==='prepare'?`${phase==='first_sample'?'仅发送这一原首次完成采样；不授予七天总结权限':'仅发送这一个已完成窗口七天总结；首次采样另行审批'}\n原监测 ${mid}\n范围 SHA256 ${updated.scopeHash}\n既有绑定 ${grant?.recipientBindingId||'缺失'} · 修订 ${grant?.bindingRevision||'缺失'}\n原认证客户端报告 ${grant?.subscriptionId||'缺失'} · ${grant?.evidenceKind||'未知'}\n总结 ${summary?.messageId||'尚无完成窗口总结'} · 修订 ${summary?.revision||'未知'}\n总结 SHA256 ${summary?.contentHash||'未知'}\n${phase==='first_sample'?'首次原采样来源，不是七天完成总结':updated.summaryText}\n${notificationSourceText(r.notification)}
弹窗结果不是独立微信授权证明；实际权限待发送接口核验。\n${r.notification.delivery.submittedAt?'已经交接，不可再发送。':''}`:stage==='cancel'||stage==='revoke'?`原监测 ${mid}\n范围 SHA256 ${updated.scopeHash}\n原订阅 ${grant?.subscriptionId||op?.scope.subscriptionId||'尚无'}\n${notificationText(r.notification).detail}\n请求取消不能撤回已交接的发送；撤销只针对原订阅。`:notificationScopeText(op!)+'\n'+notificationSourceText(r.notification)},error:''});
    }catch(error){this.setData({error:message(error),uncertain:client().uncertain});}finally{this.setData({loading:false});}
  },
  async confirmNotificationReview(target:ShopifyReview,denied=false){const monitor=this.data.supplierMonitors.find(item=>item.id===target.monitorId&&item.scopeHash===target.monitorHash);if(!monitor){this.setData({shopifyReview:null,error:'原监测范围已改变，请重新读取。'});return;}
    const phase=target.phase||'summary',n=phase==='first_sample'?monitor.firstNotification:monitor.notification,op=n?.review,source=n?.source||(phase==='first_sample'?null:monitor.summary);if(target.stage==='prepare'&&(target.summaryHash!==source?.contentHash||target.summaryRevision!==source?.revision)||(target.stage==='decision'||target.stage==='execute')&&(!op||op.id!==target.operationId||op.scopeHash!==target.scopeHash)){this.setData({shopifyReview:null,error:'原总结或通知范围已变，请重新审阅。'});return;}
    this.setData({loading:true,error:''});try{
      const r=target.stage==='native'?await client().requestNativeSubscription(this.data.conversationId,monitor,target.challenge!,true):target.stage==='prepare'?await client().reviewNotification(this.data.conversationId,monitor,true,phase):target.stage==='retry'?await client().executeUnadmittedNotification(true):await client().notificationAction(this.data.conversationId,monitor,target.stage==='decision'?denied?'denied':'approved':target.stage==='cancel'?'cancel':target.stage==='revoke'?'revoke':'execute',true,op||undefined,phase);
      const result=r as {status?:string;state?:string;code?:string};this.setData({shopifyReview:null,notificationNotAdmitted:false,uncertain:client().uncertain,supplierNotice:target.stage==='native'?result.status==='blocked'?'可信设施未就绪，原生决定没有成为授权。':result.state==='available'?'已记录当前登录的客户端订阅报告；不是独立微信授权证明，尚未批准或发送。':'原生决定已记录为拒绝/禁用，未授权通知。':target.stage==='decision'?denied?'已拒绝这一原通知。':'已保存原通知批准；执行仍需独立确认。':'已读取原通知结果，以准确回执为准；未触发额外重发。'});await this.refresh();
    }catch(error){this.setData({error:message(error),uncertain:client().uncertain,pendingLabel:'原七天总结通知'});}finally{this.setData({loading:false});}
  },
  reviewUnadmittedNotification(){if(this.data.loading||!this.data.notificationNotAdmitted||client().pendingKind!=='notification-execute')return;const monitor=this.data.supplierMonitors.find(item=>item.id===client().pendingNotificationMonitorId),phase=client().pendingNotificationPhase,op=(phase==='first_sample'?monitor?.firstNotification:monitor?.notification)?.review;if(monitor&&op&&!op.connectorRunId&&op.canExecute)this.setData({shopifyReview:{key:JSON.stringify([monitor.id,op.id,op.scopeHash,'retry']),stage:'retry',action:'notification',phase,monitorId:monitor.id,monitorHash:monitor.scopeHash,serviceId:monitor.serviceId,revision:0,previewHash:'',operationId:op.id,scopeHash:op.scopeHash,hasImages:false,allowConfirm:true,title:'明确重提未接收的原通知请求',detail:notificationScopeText(op)}});},
  monitorAction(event:WechatMiniprogram.TouchEvent){
    if(this.data.loading||client().uncertain)return;const monitor=this.data.supplierMonitors.find(item=>item.id===event.currentTarget.dataset.id),service=this.data.supplierServices.find(item=>item.id===monitor?.serviceId);if(!monitor||!service)return;
    const kind=event.currentTarget.dataset.kind==='stop'?'monitor-stop':'monitor-check';this.setData({supplierReview:{kind,serviceId:service.id,revision:service.revision,profileHash:service.profileHash,data:{monitorId:monitor.id,expectedMonitorHash:monitor.scopeHash,confirmed:true},detail:`${kind==='monitor-stop'?'停止原监测和原 Schedule':'只读取这一原商品的准确窗口'}\n${monitor.detail}\n原监测 ${monitor.id}\n范围 SHA256 ${monitor.scopeHash}`}});
  },
  async supplierImage(event:WechatMiniprogram.TouchEvent){
    if(this.data.loading)return;const service=this.data.supplierServices.find(item=>item.id===event.currentTarget.dataset.id),index=Number(event.currentTarget.dataset.index);if(!service)return;
    this.setData({loading:true,error:''});try{const path=await client().supplierImage(this.data.conversationId,service,index),source=service.profile.images[index];if(source.kind!=='artifact')return;this.setData({verifiedProductImage:{serviceId:service.id,path,sha256:source.asset.sha256,sourceNote:source.sourceNote}});await new Promise<void>((resolve,reject)=>wx.previewImage({urls:[path],success:()=>resolve(),fail:()=>reject(new Error('原图片已校验，微信预览未打开。'))}));}catch(error){this.setData({error:message(error),verifiedProductImage:null});}finally{this.setData({loading:false});}
  },
  async refreshProcurement() {
    const opened = epoch, id = this.data.conversationId;
    try { const value = await client().procurement(id); if (!visible || opened !== epoch || id !== this.data.conversationId) return;
      this.setData({ procurementInbox: value.inbox, procurementAssociated: value.associated, procurementError: '' });
      if (client().pendingKind === 'procurement-reply') this.setData({ replyInquiryId: client().pendingInquiryId });
      else if (this.data.replyInquiryId && !value.associated.some(item => item.id === this.data.replyInquiryId)) this.exitProcurementReply(true);
    } catch (error) { this.setData({ procurementError: message(error) }); }
  },
  async openProcurement() { if (!this.data.authenticated) return; this.setData({ procurementOpen: true }); await this.refreshProcurement(); },
  closeProcurement() { this.setData({ procurementOpen: false }); },
  async bindProcurement(event: WechatMiniprogram.TouchEvent) {
    if (this.data.loading || client().uncertain) return;
    const inquiry = this.data.procurementInbox.find(value => value.id === event.currentTarget.dataset.id); if (!inquiry) return;
    try {
      if (!this.data.conversationId) { this.setData({ loading: true }); const id = await client().mainConversation(await client().bootstrap(), 'business'); this.setData({ conversationId: id }); }
      this.setData({ procurementReview: { kind: 'bind', inquiry, detail: inquiryScope(inquiry), content: '' }, procurementOpen: false, error: '' });
    } catch (error) { this.setData({ error: message(error), uncertain: client().uncertain, pendingLabel: '主会话创建' }); }
    finally { this.setData({ loading: false }); }
  },
  beginProcurementReply(event: WechatMiniprogram.TouchEvent) {
    if (this.data.loading || client().uncertain) return;
    const inquiry = this.data.procurementAssociated.find(value => value.id === event.currentTarget.dataset.id); if (!inquiry) return;
    this.setData({ savedGoal: this.data.savedGoal || { draft: this.data.draft, files: this.data.files }, draft: '', files: [], replyInquiryId: inquiry.id, procurementOpen: false, error: '' });
  },
  exitProcurementReply(committed: unknown = false) {
    if (committed !== true && (this.data.loading || client().uncertain)) return;
    const saved = this.data.savedGoal;
    this.setData({ replyInquiryId: '', procurementReview: null, draft: saved?.draft || '', files: saved?.files || [], savedGoal: null });
  },
  reviewProcurementReply() {
    if (this.data.loading || client().uncertain) return;
    const inquiry = this.data.procurementAssociated.find(value => value.id === this.data.replyInquiryId);
    if (!inquiry) { this.setData({ error: '原共享状态已改变，请重新读取需求。' }); return; }
    if (!this.data.draft.trim() || this.data.draft.trim().length > 2400) { this.setData({ error: '原采购回复请使用1至2400字的明确文字。' }); return; }
    this.setData({ procurementReview: { kind: 'reply', inquiry, detail: inquiryScope(inquiry), content: this.data.draft.trim() }, error: '' });
  },
  closeProcurementReview() { if (!this.data.loading) this.setData({ procurementReview: null }); },
  async confirmProcurement() {
    const review = this.data.procurementReview; if (!review || this.data.loading || client().uncertain) return;
    this.setData({ loading: true, error: '' });
    try {
      if (review.kind === 'bind') await client().bindProcurement(review.inquiry, this.data.conversationId, true);
      else await client().replyProcurement(review.inquiry, this.data.conversationId, review.content, true);
      this.setData({ procurementReview: null }); if (review.kind === 'reply') this.exitProcurementReply(true);
      await this.refresh(); await this.refreshProcurement();
    } catch (error) { this.setData({ error: message(error), uncertain: client().uncertain, pendingLabel: review.kind === 'bind' ? '采购关联' : '原采购回复' }); }
    finally { this.setData({ loading: false }); }
  },
  openDraft(event: WechatMiniprogram.TouchEvent) {
    if (this.data.loading || client().uncertain) return;
    const draft = this.data.draftCards.find(value => value.id === event.currentTarget.dataset.id && (value.editable || value.rejectable));
    if (draft) this.setData({ selectedDraft: draft, error: '' });
  },
  closeDraft() { if (!this.data.loading) this.setData({ selectedDraft: null }); },
  editDraft() { if (!this.data.loading && !client().uncertain) this.setData({ selectedDraft: null, composerHint: '在这里说明要修改或补充的内容…' }); },
  async rejectDraft(event: WechatMiniprogram.CustomEvent<{ id: string; revision: number; draftHash: string }>) {
    if (this.data.loading || client().uncertain || !this.data.authenticated) return;
    const target = event.detail, draft = this.data.museDrafts.find(value => value.id === target.id && value.revision === target.revision && value.draftHash === target.draftHash);
    if (!draft) { this.setData({ selectedDraft: null, error: '草案已变更，请重新审阅当前版本。' }); return; }
    this.setData({ loading: true, error: '' });
    try { await client().rejectMuseDraft(draft, true); this.setData({ selectedDraft: null }); await this.refresh(); }
    catch (error) { this.setData({ error: message(error), uncertain: client().uncertain, pendingLabel: '草案拒绝' }); }
    finally { this.setData({ loading: false }); }
  },
  async prepareDraft(event: WechatMiniprogram.CustomEvent<{ id: string; revision: number; draftHash: string; budgetConfirmed: boolean; deadlineConfirmed: boolean; publicDataConfirmed: boolean }>) {
    if (this.data.loading || client().uncertain || this.data.goalBlocked || !this.data.authenticated) return;
    const target = event.detail, draft = this.data.museDrafts.find(value => value.id === target.id && value.revision === target.revision && value.draftHash === target.draftHash);
    if (!draft) { this.setData({ selectedDraft: null, error: '草案范围已变更，请重新审阅当前版本。' }); return; }
    this.setData({ loading: true, error: '' });
    try { await client().prepareMuseDraft(draft, target.budgetConfirmed === true, target.deadlineConfirmed === true, target.publicDataConfirmed === true); this.setData({ selectedDraft: null }); await this.refresh(); }
    catch (error) { this.setData({ error: message(error), uncertain: client().uncertain, pendingLabel: '原订单准备' }); }
    finally { this.setData({ loading: false }); }
  },
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
