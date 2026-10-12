import { conversationView, WorkspaceClient, ClientError } from '../../shared/client';
import type { Card, FileReference, References } from '../../shared/client';
import type { Artifact, Message } from '../../../../src/types';
import type { Company, Product, LibraryDocument } from '../../../../src/library/types';
import { presentMuseDraft } from '../../shared/muse-drafts';
import type { MuseDraft } from '../../shared/muse-drafts';
import type { DraftPresentation } from '../../shared/muse-draft-view';
import { inquiryScope, procurementMessage } from '../../shared/procurement';
import type { Inquiry } from '../../shared/procurement';
import { presentSupplier, presentMonitor, supplierErrorText } from '../../shared/supplier';
import type { SupplierService, SupplierMonitor } from '../../shared/supplier';
import { supplierFieldLabels } from '../../shared/supplier-view';
import type { SupplierProfile, PublicListingField } from '../../shared/supplier-view';
type SupplierReview = {kind:'images'|'save-product'|'shopify-draft'|'shopify-observation'|'monitors'|'monitor-check'|'monitor-stop';serviceId:string;revision:number;profileHash:string;detail:string;data:Record<string,unknown>;facts?:Partial<SupplierProfile>};
let timer: ReturnType<typeof setTimeout> | undefined;
let reading = false, visible = false, epoch = 0, readFailures = 0;
const client = () => getApp<{ globalData: { client: WorkspaceClient } }>().globalData.client;
const message = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试读取。';
const labels: Record<string, string> = { approve: '批准此项', deny: '拒绝此项', resume: '执行此项', dispatch: '派发原单', accept: '验收原单', refresh: '核对进度', cancel: '请求停止', recover: '恢复原任务' };
const fileReference = (artifact: Artifact): FileReference => ({ id: artifact.id, version: artifact.currentVersion, sha256: artifact.sha256, filename: artifact.filename, mimeType: artifact.mimeType });

Page({
  data: { conversationId: '', subject: '', draft: '', messages: [] as Message[], cards: [] as Card[], files: [] as FileReference[], busy: false, awaitingApproval: false, loading: false, error: '', readError: '', authenticated: false,
    uncertain: false, pendingLabel: '', pendingSummary: '', resourceCards: [] as Card[], runtimeNotice: '', readAt: '', referencesOpen: false, reviewCard: null as Card | null, reviewLabel: '', preview: null as { title: string; content: string; verified: boolean } | null,
    company: null as Company | null, products: [] as Product[], documents: [] as LibraryDocument[], references: null as References | null,
    museDrafts: [] as MuseDraft[], draftCards: [] as ReturnType<typeof presentMuseDraft>[], selectedDraft: null as DraftPresentation | null, goalMode: false, goalBlocked: false, drafting: false, needsDraftInput: false, composerHint: '描述目标或需要补充的信息…',
    procurementOpen: false, procurementInbox: [] as Inquiry[], procurementAssociated: [] as Inquiry[], procurementError: '', replyInquiryId: '', savedGoal: null as { draft: string; files: FileReference[] } | null,
    supplierResourcesOpen:false, supplierMode: false, supplierAvailable: false, selectedSupplierId: '', supplierServices: [] as SupplierService[], supplierCards: [] as ReturnType<typeof presentSupplier>[], supplierReadError: '', supplierNotice: '', supplierCommand: '' as ''|'shopify-observation'|'monitors', supplierScope: null as {id:string;revision:number;profile:SupplierProfile}|null, supplierReview: null as SupplierReview|null, supplierMonitors: [] as ReturnType<typeof presentMonitor>[], verifiedProductImage: null as {serviceId:string;path:string;sha256:string;sourceNote:string}|null,
    procurementReview: null as { kind: 'bind' | 'reply'; inquiry: Inquiry; detail: string; content: string } | null },
  onShow() { visible = true; epoch++; void this.open(); },
  onHide() { visible = false; epoch++; if (timer !== undefined) clearTimeout(timer); },
  onUnload() { visible = false; epoch++; if (timer !== undefined) clearTimeout(timer); },
  clearAccount() { this.setData({ authenticated: false, subject: '', conversationId: '', messages: [], cards: [], files: [], resourceCards: [], draft: '', reviewCard: null, preview: null, referencesOpen: false, references: null, company: null, products: [], documents: [], uncertain: false, pendingSummary: '', museDrafts: [], draftCards: [], selectedDraft: null, goalBlocked: false, procurementOpen: false, procurementInbox: [], procurementAssociated: [], procurementReview: null, replyInquiryId: '', savedGoal: null, supplierResourcesOpen:false, supplierReadError:'', supplierMode:false, selectedSupplierId:'', supplierServices:[],supplierCards:[],supplierMonitors:[],supplierScope:null,supplierReview:null,supplierCommand:'',supplierNotice:'',verifiedProductImage:null }); },
  async open() {
    const opened = epoch;
    try {
      const session = await client().initialize();
      if (!visible || opened !== epoch) return;
      const subject = session.user?.id || '';
      if (subject !== this.data.subject) this.setData({ supplierResourcesOpen:false, supplierReadError:'', supplierMode:false, selectedSupplierId:'',supplierServices:[],supplierCards:[],supplierMonitors:[],supplierScope:null,supplierReview:null,supplierCommand:'',supplierNotice:'',verifiedProductImage:null, procurementOpen: false, procurementInbox: [], procurementAssociated: [], procurementReview: null, replyInquiryId: '', savedGoal: null, subject, conversationId: '', messages: [], cards: [], files: [], resourceCards: [], draft: '', referencesOpen: false, reviewCard: null, preview: null, references: null, company: null, products: [], documents: [] });
      this.setData({ authenticated: session.authenticated, readError: '' });
      this.setData({ goalMode: client().requiresOriginalMuse });
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
      const originalBound = snapshot.museBinding?.originalBinding === true;
      const id = client().requiresOriginalMuse && !originalBound ? client().existingBusinessConversation(snapshot) : await client().mainConversation(snapshot);
      const delegations = snapshot.museBinding?.conversationId === id ? (await client().museDelegations(id)).delegations : [];
      const drafts = client().requiresOriginalMuse && originalBound && client().museDraftCapable ? (await client().museDrafts(id)).drafts : [];
      if (!visible || opened !== epoch) return;
      const view = conversationView(snapshot, id, delegations);
      const pendingLabel = ({ send: '消息', action: '操作', upload: '文件上传', references: '资料引用', create: '会话创建', intake: '草案文字', prepare: '原订单准备', reject: '草案拒绝', 'procurement-bind': '采购关联', 'procurement-reply': '原采购回复', 'supplier-intake':'商品事实', 'supplier-profile':'原图片事实', 'supplier-preview':'商品预览', 'supplier-operation':'商品服务操作' } as Record<string, string>)[client().pendingKind] || '';
      const draftCards = drafts.map(presentMuseDraft);
      const selected = this.data.selectedDraft && draftCards.find(value => value.id === this.data.selectedDraft?.id && !['rejected', 'rejecting'].includes(value.phase));
      const active = [...draftCards].reverse().find(value => !['prepared', 'rejected'].includes(value.phase));
      const cards = view.cards.filter(card => card.kind !== 'input').map(card => {
        const draft = drafts.find(value => value.runId === card.runId);
        if (!draft || card.kind !== 'progress') return card;
        const status = snapshot.runs?.find(run => run.id === draft.runId)?.status || '';
        const title = ({ queued: '草案整理已排队', running: '正在整理委托草案', succeeded: '草案已保存', interrupted: '草案整理已中断', cancelled: '草案整理已取消', failed: '草案整理失败', blocked: '草案需要处理' } as Record<string, string>)[status] || '草案状态待核对';
        return { ...card, title, detail: card.detail + '\n此记录是草案整理结果；原任务进度以订单卡为准。' };
      });
      this.setData({ conversationId: id, ...view, messages: view.messages.map(value => value.source === 'procurement' ? { ...value, content: procurementMessage(value.content, value.supplyInquiryId) } : value), cards, readError: '', uncertain: client().uncertain, pendingLabel, pendingSummary: client().pendingSummary, readAt: new Date().toLocaleTimeString(),
        museDrafts: drafts, draftCards, selectedDraft: selected || null, goalBlocked: client().requiresOriginalMuse && (!originalBound || !client().museDraftCapable), busy: view.busy || drafts.some(value => ['pending', 'preparing', 'rejecting'].includes(value.phase)),
        drafting: drafts.some(value => value.phase === 'pending'), needsDraftInput: active?.phase === 'needs_information',
        composerHint: active?.phase === 'needs_information' ? '只需补充上面必要的信息…' : active?.editable ? '补充或修改这份草案…' : '描述要交给原 Muse 的业务目标…',
        ...(client().pendingDraft && !this.data.draft ? { draft: client().pendingDraft } : {}), ...(client().pendingKind === 'procurement-reply' ? { replyInquiryId: client().pendingInquiryId } : {}), runtimeNotice: client().requiresOriginalMuse && !originalBound ? '原 Muse 会话尚未绑定；目标处理已阻挡，采购需求仍可按需关联与回复。' : client().requiresOriginalMuse && !client().museDraftCapable ? '当前服务尚未提供原 Muse 草案能力；此意图已阻挡，请先完成服务接入。' : snapshot.runtime?.configured === false ? '云端模型尚未接入，发送后会保存请求并显示真实阻挡原因。' : '' });
      if (client().pendingKind.startsWith('supplier-')) this.setData({supplierMode:true,selectedSupplierId:client().pendingSupplierId || this.data.selectedSupplierId});
      this.setData({supplierAvailable:client().supplierCapable});
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
      const result = await client().retryPending() as { artifact?: Artifact; serviceId?:string; status?:string; error?:{code:string} };
      if (kind.startsWith('supplier-')) {this.setData({supplierReview:null,supplierScope:null,...(result.serviceId?{selectedSupplierId:result.serviceId}:{}),...(kind==='supplier-intake'?{draft:''}:{}),...(kind==='supplier-profile'?{files:this.data.files.filter(file=>!file.mimeType?.startsWith('image/'))}:{}),supplierNotice:result.error?supplierErrorText(result.error.code):''});}
      if (kind === 'send' || kind === 'intake') this.setData({ draft: '', files: [] });
      if (kind.startsWith('procurement-')) { this.setData({ procurementReview: null }); if (kind === 'procurement-reply') this.exitProcurementReply(true); }
      if (kind === 'upload' && result.artifact) this.setData({ files: [...this.data.files, fileReference(result.artifact)] });
      if (kind === 'action') this.setData({ reviewCard: null });
      if (kind === 'prepare' || kind === 'reject') this.setData({ selectedDraft: null });
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
  async refreshSupplier() {
    const opened=epoch,id=this.data.conversationId;
    try {
      const services=await client().supplierServices(id); if(!visible||opened!==epoch||id!==this.data.conversationId)return;
      const selected=services.find(item=>item.id===this.data.selectedSupplierId) || services[services.length-1];
      const scope=this.data.supplierScope && selected && selected.id===this.data.supplierScope.id ? {id:selected.id,revision:selected.revision,profile:selected.profile}:null;
      this.setData({supplierServices:services,supplierCards:services.map(presentSupplier),selectedSupplierId:selected?.id||'',supplierScope:scope,supplierReadError:''});
      const monitors=selected?await client().supplierMonitors(id,selected.id):[];
      if(visible&&opened===epoch&&id===this.data.conversationId&&selected?.id===this.data.selectedSupplierId)this.setData({supplierMonitors:monitors.map(presentMonitor)});
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
  exitSupplier() {if(!this.data.loading&&!client().uncertain)this.setData({supplierMode:false,supplierCommand:'',supplierScope:null,supplierReview:null});},
  async sendSupplier() {
    if(this.data.loading||this.data.busy||client().uncertain||!this.data.conversationId)return;
    const service=this.data.supplierServices.find(item=>item.id===this.data.selectedSupplierId);
    if(this.data.supplierCommand){
      if(!service)return;
      const products=this.data.draft.match(/gid:\/\/shopify\/Product\/\d+/g)||[],times=this.data.draft.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g)||[];
      if(products.length!==1){this.setData({error:'请明确提供一个既有 Shopify 商品 gid，不能用商品名或预览 ID 替代。'});return;}
      const data:Record<string,unknown>={expectedRevision:service.revision,shopifyProductId:products[0],confirmed:true};
      if(this.data.supplierCommand==='monitors'){
        const publication=this.data.draft.includes('已核验发布时间');
        if(publication&&times.length||!publication&&(times.length!==1||!Number.isFinite(Date.parse(times[0])))){this.setData({error:'请明确提供一个 UTC 开始时间，或明确选择“已核验发布时间”；两者不能同时使用。'});return;}
        if(publication){if(service.external?.published!==true||service.external.productId!==products[0]||service.external.publicationTimeSource!=='online_store_published_at'||!service.external.publishedAt){this.setData({error:'原服务没有可用的已核验在线商店发布时间。'});return;}data.startFromPublication=true;}else data.startAt=times[0];
        const variants=this.data.draft.match(/gid:\/\/shopify\/ProductVariant\/\d+/g)||[];if(variants.length)data.variantIds=variants;
      }else{const publication=this.data.draft.match(/gid:\/\/shopify\/Publication\/\d+/g)||[];if(publication.length>1){this.setData({error:'请明确一个渠道 publication ID。'});return;}if(publication.length)data.publicationId=publication[0];}
      this.setData({supplierReview:{kind:this.data.supplierCommand,serviceId:service.id,revision:service.revision,profileHash:service.profileHash,data,detail:`原商品 ${service.profile.name||service.id} · 修订 ${service.revision}\n${JSON.stringify(data,null,2)}\n${this.data.supplierCommand==='monitors'?'只配置七天原任务，仍需原 Schedule 审批；外部通知未配置。':'只观察已有商品和渠道；ACTIVE 不代表已发布，不创建或发布。'}`},error:''});return;
    }
    this.setData({loading:true,error:''});try{
      const result=await client().supplierIntake(this.data.conversationId,this.data.draft,service?{id:service.id,revision:service.revision}:undefined) as {serviceId:string};
      this.setData({draft:'',selectedSupplierId:result.serviceId,supplierNotice:'商品文字已提交原 Pi；图片仅存档，可在事实保存后单独确认原图片来源。'});await this.refresh();
    }catch(error){this.setData({error:message(error),uncertain:client().uncertain,pendingLabel:'商品事实'});}finally{this.setData({loading:false});}
  },
  openSupplierResources(event:WechatMiniprogram.TouchEvent){if(this.data.loading||client().uncertain)return;this.setData({selectedSupplierId:event.currentTarget.dataset.id,supplierResourcesOpen:true});void this.refreshSupplier();},
  closeSupplierResources(){this.setData({supplierResourcesOpen:false});},
  supplierAction(event:WechatMiniprogram.TouchEvent) {
    if(this.data.loading||client().uncertain)return;const service=this.data.supplierServices.find(item=>item.id===event.currentTarget.dataset.id);if(!service)return;
    const kind=event.currentTarget.dataset.kind;this.setData({supplierResourcesOpen:false,selectedSupplierId:service.id,supplierMode:true,supplierCommand:'',error:''});
    if(kind==='edit'){this.setData({composerHint:'只需说明要补充或修改的商品事实…',supplierScope:null});return;}
    if(kind==='details'){this.setData({preview:{title:'原商品内部资料',content:Object.entries(service.profile).filter(([field])=>field!=='images').map(([field,value])=>`${supplierFieldLabels[field]||field}：${value===null?'尚未提供':value}`).join('\n')+'\n\n'+service.questions.map(item=>item.question.replace(item.field,supplierFieldLabels[item.field]||item.field)).join('\n'),verified:false}});return;}
    if(kind==='preview'){this.setData({supplierScope:{id:service.id,revision:service.revision,profile:service.profile}});return;}
    if(kind==='shopify-observation'||kind==='monitors'){this.setData({supplierCommand:kind,draft:'',composerHint:kind==='monitors'?'提供既有 Shopify 商品 gid 和明确 UTC 开始时间…':'提供既有 Shopify 商品 gid，可附渠道 publication gid…'});void this.refreshSupplier();return;}
    if(kind==='images'){
      const files=this.data.files.filter(file=>file.mimeType?.startsWith('image/'));if(!files.length){this.setData({error:'先通过图片按钮选择原图片；不从文字或 PDF 假提取图片。'});return;}
      const images=[...service.profile.images,...files.map(file=>({kind:'artifact' as const,asset:{artifactId:file.id,version:file.version,sha256:file.sha256},sourceNote:`用户本次选择：${file.filename}（内部图片来源，未授予外发许可）`}))];
      this.setData({supplierReview:{kind:'images',serviceId:service.id,revision:service.revision,profileHash:service.profileHash,data:{},facts:{images},detail:`保存为原商品内部图片来源；不解析图片、不外发。\n${images.map(image=>image.kind==='artifact'?`${image.sourceNote}\n原文件 ${image.asset.artifactId} v${image.asset.version}\nSHA256 ${image.asset.sha256}`:`${image.sourceNote}\n${image.url}`).join('\n\n')}`}});return;
    }
    if(kind==='save-product'||kind==='shopify-draft'){
      if(kind==='shopify-draft'&&!service.preview){this.setData({error:'请先审阅并生成当前商品预览。'});return;}
      const data={expectedRevision:service.revision,confirmed:true,...(kind==='shopify-draft'?{expectedPreviewHash:service.preview!.previewHash}:{})};
      this.setData({supplierReview:{kind,serviceId:service.id,revision:service.revision,profileHash:service.profileHash,data,detail:`${service.profile.name||service.id} · 原修订 ${service.revision}\n范围 SHA256 ${service.profileHash}\n${kind==='save-product'?'保存到原内部资料库，供货单位/MOQ/批发价格/生产期保留原含义，不发布。':`预览 SHA256 ${service.preview!.previewHash}\nShopify 创建/发布当前未授权；本次只核对原服务阻挡状态。`}`}});
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
