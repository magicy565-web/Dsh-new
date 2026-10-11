import { useState } from 'react';
import { Icon } from '../icons';
import { useRead, useWrite, WriteNotice, Notice, stamp } from '../library/common';
import './supply-network.css';

type Supplier = { id: string; displayName: string; country: string; website: string; published: boolean; revision: number; updatedAt: string };
type Listing = { id: string; supplierId: string; title: string; sku: string; currency: string; unitPrice: string; moq: number; leadDays: number; incoterm: string; details: string; featured: boolean; published: boolean; revision: number; updatedAt: string };
type Inquiry = { id: string; listingId: string; quantity: number; destination: string; status: string; createdAt: string; sentAt: string | null };
type SupplyStatus = { pilot: boolean; multiTenant: boolean; supplierCount: number; publishedSuppliers: number; listingCount: number; publishedListings: number; inquiryCount: number; shopifyObservation: null | { observedAt: string; count: number } };
type WorkerConnection = { installed: boolean; approved: boolean; onlineVerified: boolean; lastSeenAt?: string | null; pending?: number; claimed?: number; completed?: number };
type Shopify = { status: string; configured: boolean; scopes: string[]; shop: { name: string } | null };
type Props = { readOnly: boolean; isAdmin: boolean; shopify: Shopify | undefined };
const initialSupplier = { displayName: '', country: '', website: '' };
const initialListing = { supplierId: '', title: '', sku: '', unitPrice: '', currency: 'USD', moq: '100', leadDays: '30', incoterm: 'FOB', details: '' };

export default function SupplyNetworkPanel({ readOnly, isAdmin, shopify }: Props) {
  const status = useRead<SupplyStatus>('/supply/status');
  const supplierData = useRead<{ suppliers: Supplier[] }>('/supply/suppliers');
  const listingData = useRead<{ listings: Listing[] }>('/supply/listings');
  const inquiryData = useRead<{ inquiries: Inquiry[] }>('/supply/inquiries');
  const dot = useRead<WorkerConnection>('/dot-worker-connection');
  const muse = useRead<WorkerConnection>('/muse-worker-connection');
  const writer = useWrite();
  const [tab, setTab] = useState<'catalog' | 'inquiries' | 'team'>('catalog');
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [showListingForm, setShowListingForm] = useState(false);
  const [supplierForm, setSupplierForm] = useState(initialSupplier);
  const [listingForm, setListingForm] = useState(initialListing);
  const [editingListing, setEditingListing] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editMoq, setEditMoq] = useState('');
  const [editLeadDays, setEditLeadDays] = useState('');
  const [selectedListing, setSelectedListing] = useState('');
  const [inquiryQuantity, setInquiryQuantity] = useState('100');
  const [destination, setDestination] = useState('');
  const [notes, setNotes] = useState('');
  const suppliers = supplierData.value?.suppliers || [];
  const listings = listingData.value?.listings || [];
  const inquiries = inquiryData.value?.inquiries || [];
  const reload = () => { status.retry(); supplierData.retry(); listingData.retry(); inquiryData.retry(); };
  const submit = async (path: string, body: Record<string, unknown>) => {
    const result = await writer.write(path, 'POST', body);
    if (result) reload();
    return !!result;
  };
  const createSupplier = async () => {
    if (await submit('/supply/suppliers', supplierForm)) { setSupplierForm(initialSupplier); setShowSupplierForm(false); }
  };
  const createListing = async () => {
    const body = { ...listingForm, moq: Number(listingForm.moq), leadDays: Number(listingForm.leadDays) };
    if (await submit('/supply/listings', body)) { setListingForm(initialListing); setShowListingForm(false); }
  };
  const publishSupplier = async (supplier: Supplier) => {
    if (!window.confirm(`将「${supplier.displayName}」设为公开可被采购 Agent 检索的供应商？`)) return;
    await submit(`/supply/suppliers/${encodeURIComponent(supplier.id)}/publish`, { expectedRevision: supplier.revision, confirmed: true });
  };
  const publishListing = async (listing: Listing) => {
    if (!window.confirm(`公开「${listing.title}」的单价、MOQ 和生产交期？这些属于商家自行声明，并非已核验报价。`)) return;
    await submit(`/supply/listings/${encodeURIComponent(listing.id)}/publish`, { expectedRevision: listing.revision, confirmed: true });
  };
  const unpublish = async (kind: 'suppliers' | 'listings', item: Supplier | Listing) => {
    if (!window.confirm('确认停止对外公开？已同步到其他 Agent 的历史结果无法远程撤回。')) return;
    await submit(`/supply/${kind}/${encodeURIComponent(item.id)}/unpublish`, { expectedRevision: item.revision, confirmed: true });
  };
  const startEdit = (listing: Listing) => {
    setEditingListing(listing.id); setEditPrice(listing.unitPrice); setEditMoq(String(listing.moq)); setEditLeadDays(String(listing.leadDays));
  };
  const updateListing = async (listing: Listing, changes: Record<string, unknown>) => {
    const result = await writer.write(`/supply/listings/${encodeURIComponent(listing.id)}`, 'PATCH', { expectedRevision: listing.revision, ...changes });
    if (result) { setEditingListing(null); reload(); }
  };
  const syncShopify = async () => {
    if (await submit('/supply/shopify/observe', {})) status.retry();
  };
  const createInquiry = async () => {
    if (await submit('/supply/inquiries', { listingId: selectedListing, quantity: Number(inquiryQuantity), destination, notes })) {
      setSelectedListing(''); setDestination(''); setNotes(''); setInquiryQuantity('100');
    }
  };
  return <section className="supply-network" aria-label="Workspace 供应链网络">
    <div className="supply-head">
      <div><span className="supply-eyebrow">AGENT-NATIVE SUPPLY</span><h2>供应链网络</h2><p>维护真实供货条件，让采购 Agent 找到可以询价的商品。</p></div>
      <span className="supply-pilot">单企业灰度</span>
    </div>
    <div className="supply-metrics">
      <div><small>供应商</small><strong>{status.value?.supplierCount ?? '—'}</strong><span>已公开 {status.value?.publishedSuppliers ?? '—'}</span></div>
      <div><small>供货商品</small><strong>{status.value?.listingCount ?? '—'}</strong><span>已公开 {status.value?.publishedListings ?? '—'}</span></div>
      <div><small>询价草稿</small><strong>{status.value?.inquiryCount ?? '—'}</strong><span>尚未对外发送</span></div>
    </div>
    <div className="supply-tabs" role="tablist" aria-label="供应链管理">
      <button role="tab" aria-selected={tab === 'catalog'} className={tab === 'catalog' ? 'selected' : ''} onClick={() => setTab('catalog')}>商品与供应</button>
      <button role="tab" aria-selected={tab === 'inquiries'} className={tab === 'inquiries' ? 'selected' : ''} onClick={() => setTab('inquiries')}>采购需求</button>
      <button role="tab" aria-selected={tab === 'team'} className={tab === 'team' ? 'selected' : ''} onClick={() => setTab('team')}>AI 团队</button>
    </div>
    <WriteNotice writer={writer} onReload={reload}/>
    {tab === 'catalog' && <div className="supply-body">
      <div className="supply-shopify">
        <div className="supply-shopify-copy"><Icon name="store" size={20}/><div><strong>Shopify 商品观察</strong><small>{shopify?.status === 'verified' ? `已核验店铺 · ${shopify.shop?.name || ''}` : '需要先在产品托管中核验店铺授权'}</small><small>{status.value?.shopifyObservation ? `最近同步 ${stamp(status.value.shopifyObservation.observedAt)} · ${status.value.shopifyObservation.count} 个商品` : '尚未同步 · 不会自动发布到采购网络'}</small></div></div>
        <button disabled={!isAdmin || readOnly || writer.busy || writer.uncertain || shopify?.status !== 'verified' || !shopify.scopes.some(x => ['read_products', 'write_products'].includes(x))} onClick={() => void syncShopify()}><Icon name="refresh" size={14}/> 同步</button>
      </div>
      <div className="supply-section-title"><h3>供应商档案</h3>{isAdmin && <button disabled={readOnly || writer.busy || writer.uncertain} onClick={() => setShowSupplierForm(x => !x)}><Icon name="plus" size={16}/> 新建</button>}</div>
      <Notice error={supplierData.error} retry={supplierData.retry}/>
      {showSupplierForm && <form className="supply-form" onSubmit={e => { e.preventDefault(); void createSupplier(); }}><label>企业名称<input required maxLength={120} value={supplierForm.displayName} onChange={e => setSupplierForm({ ...supplierForm, displayName: e.target.value })}/></label><label>国家 / 地区<input required maxLength={80} value={supplierForm.country} onChange={e => setSupplierForm({ ...supplierForm, country: e.target.value })}/></label><label>官网（可选 HTTPS）<input type="url" maxLength={300} placeholder="https://" value={supplierForm.website} onChange={e => setSupplierForm({ ...supplierForm, website: e.target.value })}/></label><button type="submit" disabled={writer.busy || writer.uncertain || readOnly}>保存为私有档案</button></form>}
      {suppliers.length ? <div className="supply-rows">{suppliers.map(supplier => <div className="supply-row" key={supplier.id}><span className="supply-symbol"><Icon name="building"/></span><div><strong>{supplier.displayName}</strong><small>{supplier.country} · {supplier.published ? '已公开 · 商家自报' : '仅企业内部可见'}</small></div>{isAdmin && <button disabled={writer.busy || readOnly || writer.uncertain} onClick={() => void (supplier.published ? unpublish('suppliers', supplier) : publishSupplier(supplier))}>{supplier.published ? '停止公开' : '确认公开'}</button>}</div>)}</div> : !supplierData.loading && !supplierData.error && <p className="supply-empty">还没有供应商，先添加你的第一个供货伙伴。</p>}
      <div className="supply-section-title"><h3>供货目录</h3><button disabled={readOnly || writer.busy || writer.uncertain || !suppliers.length} onClick={() => setShowListingForm(x => !x)}><Icon name="plus" size={16}/> 新增商品</button></div>
      <Notice error={listingData.error} retry={listingData.retry}/>
      {showListingForm && <form className="supply-form" onSubmit={e => { e.preventDefault(); void createListing(); }}>
        <label>所属供应商<select required value={listingForm.supplierId} onChange={e => setListingForm({ ...listingForm, supplierId: e.target.value })}><option value="">选择供应商</option>{suppliers.map(s => <option value={s.id} key={s.id}>{s.displayName}</option>)}</select></label>
        <label>商品名称<input required maxLength={140} value={listingForm.title} onChange={e => setListingForm({ ...listingForm, title: e.target.value })}/></label>
        <label>SKU<input required maxLength={80} value={listingForm.sku} onChange={e => setListingForm({ ...listingForm, sku: e.target.value })}/></label>
        <div className="supply-form-grid"><label>参考单价<input required inputMode="decimal" placeholder="2.40" value={listingForm.unitPrice} onChange={e => setListingForm({ ...listingForm, unitPrice: e.target.value })}/></label><label>币种<select value={listingForm.currency} onChange={e => setListingForm({ ...listingForm, currency: e.target.value })}><option>USD</option><option>EUR</option><option>CNY</option></select></label><label>MOQ<input required min={1} type="number" value={listingForm.moq} onChange={e => setListingForm({ ...listingForm, moq: e.target.value })}/></label><label>生产交期（天）<input min={1} type="number" required value={listingForm.leadDays} onChange={e => setListingForm({ ...listingForm, leadDays: e.target.value })}/></label></div>
        <label>报价贸易条款<select value={listingForm.incoterm} onChange={e => setListingForm({ ...listingForm, incoterm: e.target.value })}>{['FOB', 'EXW', 'FCA', 'CIF', 'CFR', 'DAP', 'DDP'].map(v => <option key={v}>{v}</option>)}</select></label><label>公开规格描述<textarea maxLength={1600} rows={3} value={listingForm.details} onChange={e => setListingForm({ ...listingForm, details: e.target.value })}/></label><button disabled={writer.busy || writer.uncertain || readOnly} type="submit">保存私有商品</button>
      </form>}
      {listings.length ? <div className="supply-rows">{listings.map(listing => <div className="supply-row" key={listing.id}><span className="supply-symbol"><Icon name="box"/></span><div><strong>{listing.title}</strong><small>{listing.currency} {listing.unitPrice} · MOQ {listing.moq} · {listing.incoterm} · {listing.leadDays} 天</small><small>{listing.published ? '公开参考价 · 未独立核验' : '私有 · 不会出现在采购 MCP'}{listing.featured ? ' · 主推' : ''}</small></div><button disabled={writer.busy || readOnly || writer.uncertain} onClick={() => startEdit(listing)}>修改</button>{isAdmin && <button disabled={writer.busy || readOnly || writer.uncertain} onClick={() => void (listing.published ? unpublish('listings', listing) : publishListing(listing))}>{listing.published ? '停止公开' : '确认公开'}</button>}</div>)}
      {editingListing && (() => { const item = listings.find(l => l.id === editingListing); return item ? <form className="supply-form" onSubmit={event => {event.preventDefault(); void updateListing(item, {unitPrice: editPrice, moq: Number(editMoq), leadDays: Number(editLeadDays)});}}><strong>修改供货条件 · {item.title}</strong><div className="supply-form-grid"><label>参考单价<input required inputMode="decimal" value={editPrice} onChange={e => setEditPrice(e.target.value)}/></label><label>MOQ<input required min={1} type="number" value={editMoq} onChange={e => setEditMoq(e.target.value)}/></label><label>生产交期（天）<input required min={1} type="number" value={editLeadDays} onChange={e => setEditLeadDays(e.target.value)}/></label></div><div className="supply-form-actions"><button disabled={writer.busy || writer.uncertain || readOnly}>更新并记录版本</button><button type="button" onClick={() => setEditingListing(null)}>取消</button><button type="button" disabled={writer.busy || writer.uncertain || readOnly} onClick={() => void updateListing(item, { featured: !item.featured })}>{item.featured ? '取消主推' : '标记主推'}</button></div></form> : null; })()}</div> : !listingData.loading && !listingData.error && <p className="supply-empty">新商品会先保存为私有草稿，经过确认才向采购 Agent 开放。</p>}
      <p className="supply-footnote">公开目录只传递经确认的商家声明。Shopify 的零售价、vendor 文本和订单不自动成为工厂报价或履约认证。</p>
    </div>}
    {tab === 'inquiries' && <div className="supply-body">
      <div className="supply-section-title"><h3>询价草稿</h3><span className="supply-muted">不会自动发送邮件或创建订单</span></div>
      <Notice error={inquiryData.error} retry={inquiryData.retry}/>
      <form className="supply-form" onSubmit={e => { e.preventDefault(); void createInquiry(); }}>
        <label>询价商品<select required value={selectedListing} disabled={readOnly} onChange={e => setSelectedListing(e.target.value)}><option value="">选择供货商品</option>{listings.map(l => <option value={l.id} key={l.id}>{l.title}</option>)}</select></label>
        <div className="supply-form-grid"><label>数量<input type="number" min={1} required value={inquiryQuantity} onChange={e => setInquiryQuantity(e.target.value)}/></label><label>目的地<input required maxLength={120} placeholder="USA, Los Angeles" value={destination} onChange={e => setDestination(e.target.value)}/></label></div>
        <label>需求备注<textarea rows={3} maxLength={1200} value={notes} onChange={e => setNotes(e.target.value)}/></label><button type="submit" disabled={readOnly || writer.busy || writer.uncertain || !selectedListing}>保存询价草稿</button>
      </form>
      {inquiries.map(q => <div className="supply-row" key={q.id}><Icon name="file" size={20}/><div><strong>{listings.find(l => l.id === q.listingId)?.title || '关联产品'}</strong><small>{q.quantity} 件 · {q.destination} · {stamp(q.createdAt)}</small></div><span className="supply-pill">未发送</span></div>)}
    </div>}
    {tab === 'team' && <div className="supply-body"><div className="supply-section-title"><h3>AI 经营团队</h3><span className="supply-muted">连接状态不是执行证明</span></div>
      {[{ name: 'Dot · 经营主控', icon: 'fingerprint' as const, data: dot }, { name: 'Muse · 运营执行', icon: 'bolt' as const, data: muse }].map(item => <div className="supply-row" key={item.name}><span className="supply-symbol"><Icon name={item.icon}/></span><div><strong>{item.name}</strong><small>{item.data.error ? '状态不可用' : !item.data.value?.installed ? '未配置真实连接' : item.data.value.approved ? '权限已审核 · 外部执行尚需独立验证' : '已配置 · 尚未授权执行'}</small>{item.data.value?.lastSeenAt && <small>最近请求 {stamp(item.data.value.lastSeenAt)}</small>}</div><span className="supply-pill">{item.data.value?.onlineVerified ? '已核验' : '未验收'}</span></div>)}
      <div className="supply-row"><span className="supply-symbol"><Icon name="work"/></span><div><strong>Grokbot · 生产队列</strong><small>尚未接入已核验生产连接器；不使用模拟任务冒充执行。</small></div><span className="supply-pill">待接入</span></div>
      <p className="supply-footnote">原 WorkerDesk 负责企业审批、预算、租约和成果验收。此面板只读连接状态，不会直接派遣未知外部 Worker。</p>
    </div>}
  </section>;
}
