import { useState } from 'react';
import { Icon } from '../icons';
import { useRead, useDirty, Notice, stamp } from '../library/common';
import type { Session } from '../api';
import { useSupplyCommand } from './useSupplyCommand';
import type { SupplyAction } from './useSupplyCommand';
import './supply-network.css';

type Supplier = { id: string; displayName: string; country: string; website: string; published: boolean; revision: number; updatedAt: string };
type Listing = { id: string; supplierId: string; title: string; sku: string; currency: string; unitPrice: string; moq: number; leadDays: number; incoterm: string; details: string; featured: boolean; published: boolean; revision: number; updatedAt: string };
type SupplyStatus = { pilot: boolean; multiTenant: boolean; supplierCount: number; publishedSuppliers: number; listingCount: number; publishedListings: number; inquiryCount: number; shopifyObservation: null | { observedAt: string; count: number } };
type Shopify = { status: string; configured: boolean; scopes: string[]; shop: { name: string } | null };
type Props = { readOnly: boolean; isAdmin: boolean; shopify: Shopify | undefined; onDirty: (dirty: boolean) => void };
const initialSupplier = { displayName: '', country: '', website: '' };
const initialListing = { supplierId: '', title: '', sku: '', unitPrice: '', currency: 'USD', moq: '100', leadDays: '30', incoterm: 'FOB', details: '' };

export default function SupplyNetworkPanel(props: Props) {
  const session = useRead<Session>('/session');
  if (session.loading) return <p role="status">正在读取产品资料…</p>;
  if (!session.value || (session.value.mode === 'enterprise' && !session.value.authenticated)) return <Notice error={session.error || '请先登录当前企业。'} retry={session.retry}/>;
  const scope = JSON.stringify([session.value.workspaceId, session.value.user?.id || 'local', session.value.user?.role || 'local']);
  return <SupplyNetworkContent key={scope} {...props} scope={scope} readOnly={props.readOnly || session.value.user?.role === 'viewer'} isAdmin={session.value.mode === 'local' || props.isAdmin}/>;
}

function SupplyNetworkContent({ readOnly, isAdmin, shopify, onDirty, scope }: Props & { scope: string }) {
  const status = useRead<SupplyStatus>('/supply/status');
  const supplierData = useRead<{ suppliers: Supplier[] }>('/supply/suppliers');
  const listingData = useRead<{ listings: Listing[] }>('/supply/listings');
  const writer = useSupplyCommand(scope);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [showListingForm, setShowListingForm] = useState(false);
  const [supplierForm, setSupplierForm] = useState(initialSupplier);
  const [listingForm, setListingForm] = useState(initialListing);
  const [editingListing, setEditingListing] = useState<Listing | null>(null);
  const [saved, setSaved] = useState(false);
  const [editPrice, setEditPrice] = useState('');
  const [editMoq, setEditMoq] = useState('');
  const [editLeadDays, setEditLeadDays] = useState('');
  const suppliers = supplierData.value?.suppliers || [];
  const listings = listingData.value?.listings || [];
  const blocked = readOnly || writer.busy || writer.uncertain;
  const unavailable = status.loading || !!status.error || supplierData.loading || !!supplierData.error || listingData.loading || !!listingData.error;
  useDirty(!!editingListing || Object.values(supplierForm).some(Boolean) || JSON.stringify(listingForm) !== JSON.stringify(initialListing) || writer.busy || writer.uncertain, onDirty);
  const reload = () => { status.retry(); supplierData.retry(); listingData.retry(); };
  function committed(action: SupplyAction) {
    if (action === 'supplier.create') { setSupplierForm(initialSupplier); setShowSupplierForm(false); }
    if (action === 'listing.create') { setListingForm(initialListing); setShowListingForm(false); }
    if (action === 'listing.update') setEditingListing(null);
    setSaved(true); reload();
  }
  async function retry() { if (readOnly || writer.busy) return; const command = await writer.retry(); if (command) committed(command.action); }
  function actionFor(path: string): SupplyAction {
    if (path === '/supply/shopify/observe') return 'shopify.observe';
    const kind = path.startsWith('/supply/suppliers') ? 'supplier' : path.startsWith('/supply/listings') ? 'listing' : 'inquiry';
    return (kind + (path.endsWith('/unpublish') ? '.unpublish' : path.endsWith('/publish') ? '.publish' : '.create')) as SupplyAction;
  }
  const submit = async (path: string, body: Record<string, unknown>) => {
    if (blocked || unavailable) return false;
    setSaved(false);
    const action = actionFor(path), label = ({ 'supplier.create': '保存供应商档案', 'listing.create': '保存供货商品', 'inquiry.create': '保存内部询价草稿', 'supplier.publish': '公开供应商资料', 'supplier.unpublish': '停止公开供应商', 'listing.publish': '公开供货条件', 'listing.unpublish': '停止公开商品', 'shopify.observe': '读取 Shopify 商品' } as Partial<Record<SupplyAction, string>>)[action] || '保存资料';
    const result = await writer.write(action, label, path, 'POST', body);
    if (result) committed(result.action);
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
    if (!window.confirm(`公开供应商「${supplier.displayName}」修订 ${supplier.revision}？国家/地区：${supplier.country}；官网：${supplier.website || '未填写'}。采购 Agent 可读取这些资料。`)) return;
    await submit(`/supply/suppliers/${encodeURIComponent(supplier.id)}/publish`, { expectedRevision: supplier.revision, confirmed: true });
  };
  const publishListing = async (listing: Listing) => {
    if (!window.confirm(`公开「${listing.title}」修订 ${listing.revision}：SKU ${listing.sku}；${listing.currency} ${listing.unitPrice}、MOQ ${listing.moq}、${listing.incoterm}、生产交期 ${listing.leadDays} 天；规格：${listing.details || '未填写'}？属于商家声明，并非已核验库存或成交报价。`)) return;
    await submit(`/supply/listings/${encodeURIComponent(listing.id)}/publish`, { expectedRevision: listing.revision, confirmed: true });
  };
  const unpublish = async (kind: 'suppliers' | 'listings', item: Supplier | Listing) => {
    if (!window.confirm('确认停止对外公开？已同步到其他 Agent 的历史结果无法远程撤回。')) return;
    await submit(`/supply/${kind}/${encodeURIComponent(item.id)}/unpublish`, { expectedRevision: item.revision, confirmed: true });
  };
  const startEdit = (listing: Listing) => {
    if (blocked) return;
    setEditingListing({ ...listing }); setEditPrice(listing.unitPrice); setEditMoq(String(listing.moq)); setEditLeadDays(String(listing.leadDays)); writer.clearError(); setSaved(false);
  };
  const updateListing = async (listing: Listing, changes: Record<string, unknown>) => {
    if (blocked || unavailable) return;
    setSaved(false);
    const result = await writer.write('listing.update', `更新 ${listing.title} 修订 ${listing.revision}`, `/supply/listings/${encodeURIComponent(listing.id)}`, 'PATCH', { expectedRevision: listing.revision, ...changes });
    if (result) committed(result.action);
  };
  const syncShopify = async () => {
    if (await submit('/supply/shopify/observe', {})) status.retry();
  };
  return <section className="supply-network" aria-label="Workspace 供应链网络">
    <div className="supply-head">
      <div><h2>产品与供货资料</h2><p>保存企业内部资料，明确确认后允许采购方读取供货条件。</p></div>
    </div>
    <button type="button" className="supply-retry" aria-label="刷新供货资料" disabled={writer.busy} onClick={reload}>刷新资料</button>
    <Notice error={status.error} retry={reload}/>
    {status.loading && <p role="status">正在读取供货资料…</p>}
    {saved && !unavailable && <p className="supply-feedback" role="status">已保存，刷新页面可重新读取。</p>}
    <Notice error={writer.conflict ? '资料已有新版本，你的输入已保留。请读取最新资料后重新编辑。' : writer.error}/>
    {writer.conflict && <button type="button" className="supply-retry" disabled={writer.busy} onClick={reload}>读取最新资料</button>}
    {writer.uncertain && <div className="supply-feedback" role="alert"><strong>保存结果待确认</strong><p>{writer.pending?.label}。请使用原请求核对，避免重复创建；刷新后也可继续核对。</p><button type="button" disabled={readOnly || writer.busy} onClick={() => void retry()}>{writer.busy ? '正在核对…' : '核对原请求结果'}</button></div>}
    {writer.storageError && <p role="alert">浏览器无法保留待确认请求，请留在当前页面核对后再离开。</p>}
    <div className="supply-body">
      {shopify?.status === 'verified' && <div className="supply-shopify">
        <div className="supply-shopify-copy"><Icon name="store" size={20}/><div><strong>Shopify 商品观察</strong><small>{shopify?.status === 'verified' ? `已核验店铺 · ${shopify.shop?.name || ''}` : '需要先在产品托管中核验店铺授权'}</small><small>{status.value?.shopifyObservation ? `最近同步 ${stamp(status.value.shopifyObservation.observedAt)} · ${status.value.shopifyObservation.count} 个商品` : '尚未同步 · 不会自动发布到采购网络'}</small></div></div>
        <button disabled={!isAdmin || readOnly || writer.busy || writer.uncertain || shopify?.status !== 'verified' || !shopify.scopes.some(x => ['read_products', 'write_products'].includes(x))} onClick={() => void syncShopify()}><Icon name="refresh" size={14}/> 同步</button>
      </div>}
      <div className="supply-section-title"><h3>供应商档案</h3>{isAdmin && <button disabled={blocked || unavailable} onClick={() => setShowSupplierForm(x => !x)}><Icon name="plus" size={16}/> 新建</button>}</div>
      <Notice error={supplierData.error} retry={supplierData.retry}/>
      {showSupplierForm && <form className="supply-form" onSubmit={e => { e.preventDefault(); void createSupplier(); }}><label>企业名称<input disabled={blocked} required maxLength={120} value={supplierForm.displayName} onChange={e => setSupplierForm({ ...supplierForm, displayName: e.target.value })}/></label><label>国家 / 地区<input disabled={blocked} required maxLength={80} value={supplierForm.country} onChange={e => setSupplierForm({ ...supplierForm, country: e.target.value })}/></label><label>官网（可选 HTTPS）<input disabled={blocked} type="url" maxLength={300} placeholder="https://" value={supplierForm.website} onChange={e => setSupplierForm({ ...supplierForm, website: e.target.value })}/></label><button type="submit" disabled={blocked || unavailable}>保存为私有档案</button></form>}
      {suppliers.length ? <div className="supply-rows">{suppliers.map(supplier => <div className="supply-row" key={supplier.id}><span className="supply-symbol"><Icon name="building"/></span><div><strong>{supplier.displayName}</strong><small>{supplier.country} · {supplier.published ? '已公开 · 商家自报' : '仅企业内部可见'}</small></div>{isAdmin && <button disabled={blocked || unavailable} onClick={() => void (supplier.published ? unpublish('suppliers', supplier) : publishSupplier(supplier))}>{supplier.published ? '停止公开' : '确认公开'}</button>}</div>)}</div> : !supplierData.loading && !supplierData.error && <p className="supply-empty">还没有供应商，先添加你的第一个供货伙伴。</p>}
      <div className="supply-section-title"><h3>供货目录</h3><button disabled={blocked || unavailable || !suppliers.length} onClick={() => setShowListingForm(x => !x)}><Icon name="plus" size={16}/> 新增商品</button></div>
      <Notice error={listingData.error} retry={listingData.retry}/>
      {showListingForm && <form className="supply-form" onSubmit={e => { e.preventDefault(); void createListing(); }}>
        <label>所属供应商<select disabled={blocked} required value={listingForm.supplierId} onChange={e => setListingForm({ ...listingForm, supplierId: e.target.value })}><option value="">选择供应商</option>{suppliers.map(s => <option value={s.id} key={s.id}>{s.displayName}</option>)}</select></label>
        <label>商品名称<input disabled={blocked} required maxLength={140} value={listingForm.title} onChange={e => setListingForm({ ...listingForm, title: e.target.value })}/></label>
        <label>SKU<input disabled={blocked} required maxLength={80} value={listingForm.sku} onChange={e => setListingForm({ ...listingForm, sku: e.target.value })}/></label>
        <div className="supply-form-grid"><label>参考单价<input disabled={blocked} required inputMode="decimal" placeholder="2.40" value={listingForm.unitPrice} onChange={e => setListingForm({ ...listingForm, unitPrice: e.target.value })}/></label><label>币种<select disabled={blocked} value={listingForm.currency} onChange={e => setListingForm({ ...listingForm, currency: e.target.value })}><option>USD</option><option>EUR</option><option>CNY</option></select></label><label>MOQ<input disabled={blocked} required min={1} type="number" value={listingForm.moq} onChange={e => setListingForm({ ...listingForm, moq: e.target.value })}/></label><label>生产交期（天）<input disabled={blocked} min={1} type="number" required value={listingForm.leadDays} onChange={e => setListingForm({ ...listingForm, leadDays: e.target.value })}/></label></div>
        <label>报价贸易条款<select disabled={blocked} value={listingForm.incoterm} onChange={e => setListingForm({ ...listingForm, incoterm: e.target.value })}>{['FOB', 'EXW', 'FCA', 'CIF', 'CFR', 'DAP', 'DDP'].map(v => <option key={v}>{v}</option>)}</select></label><label>公开规格描述<textarea disabled={blocked} maxLength={1600} rows={3} value={listingForm.details} onChange={e => setListingForm({ ...listingForm, details: e.target.value })}/></label><button disabled={blocked || unavailable} type="submit">保存私有商品</button>
      </form>}
      {listings.length ? <div className="supply-rows">{listings.map(listing => <div className="supply-row" key={listing.id}><span className="supply-symbol"><Icon name="box"/></span><div><strong>{listing.title}</strong><small>{listing.currency} {listing.unitPrice} · MOQ {listing.moq} · {listing.incoterm} · {listing.leadDays} 天</small><small>{listing.published ? '公开参考价 · 未独立核验' : '私有 · 不会出现在采购 MCP'}{listing.featured ? ' · 主推' : ''}</small></div><button disabled={blocked || unavailable || !!editingListing} onClick={() => startEdit(listing)}>修改</button>{isAdmin && <button disabled={blocked || unavailable} onClick={() => void (listing.published ? unpublish('listings', listing) : publishListing(listing))}>{listing.published ? '停止公开' : '确认公开'}</button>}</div>)}
      {editingListing && (() => { const item = editingListing; return item ? <form className="supply-form" onSubmit={event => {event.preventDefault(); void updateListing(item, {unitPrice: editPrice, moq: Number(editMoq), leadDays: Number(editLeadDays)});}}><strong>修改供货条件 · {item.title} · 编辑基于修订 {item.revision}</strong><p className="supply-footnote">{item.published ? '此商品已公开，保存会直接更新公开参考单价、MOQ 和生产交期。' : '本次保存仅更新企业内部资料，不会自动公开。'}</p><div className="supply-form-grid"><label>参考单价<input disabled={blocked} required inputMode="decimal" value={editPrice} onChange={e => setEditPrice(e.target.value)}/></label><label>MOQ<input disabled={blocked} required min={1} type="number" value={editMoq} onChange={e => setEditMoq(e.target.value)}/></label><label>生产交期（天）<input disabled={blocked} required min={1} type="number" value={editLeadDays} onChange={e => setEditLeadDays(e.target.value)}/></label></div><div className="supply-form-actions"><button disabled={blocked || unavailable}>更新并记录版本</button><button type="button" disabled={blocked} onClick={() => { setEditingListing(null); writer.clearError(); }}>取消</button><button type="button" disabled={blocked || unavailable} onClick={() => void updateListing(item, { featured: !item.featured })}>{item.featured ? '取消主推' : '标记主推'}</button></div></form> : null; })()}{editingListing && (() => { const latest = listings.find(l => l.id === editingListing.id); return latest && latest.revision !== editingListing.revision ? <div className="supply-feedback"><p>服务端修订 {latest.revision}：{latest.currency} {latest.unitPrice} · MOQ {latest.moq} · {latest.leadDays} 天。你的输入仍保留。</p><button type="button" disabled={blocked} onClick={() => startEdit(latest)}>使用最新条件重新编辑</button></div> : null; })()}</div> : !listingData.loading && !listingData.error && <p className="supply-empty">新商品会先保存为私有草稿，经过确认才向采购 Agent 开放。</p>}
      <p className="supply-footnote">公开目录只传递经确认的商家声明。Shopify 的零售价、vendor 文本和订单不自动成为工厂报价或履约认证。</p>
    </div>
  </section>;
}
