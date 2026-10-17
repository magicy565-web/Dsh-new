import { useCallback, useState } from 'react';
import { ProductDocuments, ProductFacts, ProductImages, SKUFields, SupplyFields } from './ProductFields';
import { MedusaProductPanel } from './MedusaProductPanel';
import { Icon } from '../icons';
import { Modal } from '../Modal';
import { useLibraryView } from './viewState';
import { checkLabel, checkMessage, checkStatus } from './readinessText';
import { SourceNotice } from './SourceNotice';
import { Empty, Field, Notice, pid, stamp, useDirty, useRead, useWrite, WriteNotice } from './common';
import { emptyProduct } from './types';
import type { Product, ListResult, Readiness } from './types';

type Props = { route: string[]; readOnly: boolean; navigate: (path: string) => void; onDirty: (dirty: boolean) => void };
export function Products({ route, readOnly, navigate, onDirty }: Props) {
  const id = route[1];
  if (id === 'new') return <><button className="bl-back" aria-label="产品库" onClick={() => navigate('products')}><Icon name="back" size={18} />产品库</button><ProductEditor key="new" product={emptyProduct()} readOnly={readOnly} navigate={navigate} onDirty={onDirty} /></>;
  if (id) return <ProductRoute key={`${id}/${route[2] || ''}`} id={id} edit={route[2] === 'edit'} readOnly={readOnly} navigate={navigate} onDirty={onDirty} />;
  return <ProductList readOnly={readOnly} navigate={navigate} />;
}
function ProductList({ readOnly, navigate }: Pick<Props, 'readOnly' | 'navigate'>) {
  const { view, setView } = useLibraryView();
  const { query, status, cursor } = view.products;
  const [filterOpen, setFilterOpen] = useState(false);
  const setQuery = (query: string) => setView(current => ({ ...current, products: { ...current.products, query, cursor: null } }));
  const setStatus = (status: string) => setView(current => ({ ...current, products: { ...current.products, status, cursor: null } }));
  const setCursor = (cursor: string | null) => setView(current => ({ ...current, products: { ...current.products, cursor } }));
  const params = new URLSearchParams({ q: query, ...(status ? { status } : {}), limit: '100', ...(cursor ? { cursor } : {}) });
  const read = useRead<ListResult<Product>>(`/library/products?${params}`);
  return <><div className="bl-heading"><div className="bl-count-summary"><span>{read.loading ? '正在读取' : read.value ? `${read.value.items.length} 个产品${read.value.nextCursor ? ' · 当前页' : ''}` : '产品'}</span></div><button className="primary-button" disabled={readOnly} onClick={() => navigate('products/new')}><Icon name="plus" size={16} />新建产品</button></div><div className="bl-toolbar"><label className="bl-search"><Icon name="search" size={18} /><input aria-label="搜索产品" maxLength={200} placeholder="搜索名称、简介或分类" value={query} onChange={e => { setQuery(e.target.value); setCursor(null); }} /></label><button className="bl-filter-button" aria-label="筛选产品" onClick={() => setFilterOpen(true)}><Icon name="filter" size={20} /></button>{filterOpen && <Modal title="筛选产品" onClose={() => setFilterOpen(false)} className="bl-sheet"><div className="bl-sheet-handle" /><h2>筛选产品</h2><Field label="产品状态"><select aria-label="产品状态筛选" value={status} onChange={e => setStatus(e.target.value)}><option value="draft">草稿</option><option value="archived">已归档</option><option value="">全部状态</option></select></Field><button className="primary-button full-width" onClick={() => setFilterOpen(false)}>查看筛选结果</button></Modal>}</div><Notice error={read.error} retry={read.retry} />{read.loading ? <p className="bl-loading" role="status">正在读取产品…</p> : read.value?.items.length ? <div className="bl-list">{read.value.items.map(product => <button className="bl-row bl-product-row" key={product.id} onClick={() => navigate(`products/${pid(product.id)}`)}><span className="bl-product-thumb"><ProductThumbnail product={product} /></span><span><strong>{product.name}</strong><small>{product.description || '尚未填写简介'}</small><em>{product.source?.kind === 'public_reference' ? '公开参考 · 非本企业在售' : product.category || '未分类'} · {product.status === 'archived' ? '已归档' : '草稿'}</em></span><Icon name="chevron" size={18} /></button>)}</div> : !read.error && <Empty title={query ? '没有找到相关产品' : '你的第一个产品，从这里开始'}><p>{query ? '试试其他关键词或筛选条件。' : '保存后可以随时回来完善，不必一次填完。'}</p></Empty>}{read.value?.nextCursor && <button className="text-button" onClick={() => setCursor(read.value!.nextCursor)}>下一页</button>}{cursor && <button className="text-button" onClick={() => setCursor(null)}>返回第一页</button>}</>;
}
function ProductThumbnail({ product }: { product: Product }) {
  const asset = product.images.find(image => image.isPrimary)?.asset || product.images[0]?.asset;
  const read = useRead<{ encoding: string; content: string; version: { mimeType: string } }>(asset ? `/artifacts/${pid(asset.artifactId)}/content?version=${asset.version}` : null);
  return read.value?.encoding === 'base64' && read.value.version.mimeType.startsWith('image/') ? <img src={`data:${read.value.version.mimeType};base64,${read.value.content}`} alt={product.name} /> : <><Icon name="box" size={26} /><small>{asset ? read.error ? '图片不可读' : '读取图片' : '缺少图片'}</small></>;
}
function ProductRoute({ id, edit, readOnly, navigate, onDirty }: Omit<Props, 'route'> & { id: string; edit: boolean }) {
  const read = useRead<{ product: Product }>(`/library/products/${pid(id)}`);
  return <><button className="bl-back" aria-label="产品库" onClick={() => navigate('products')}><Icon name="back" size={18} />产品库</button><Notice error={read.error} retry={read.retry} />{read.loading ? <p role="status">正在读取产品…</p> : read.value ? edit && !readOnly ? <ProductEditor key={read.value.product.revision} product={read.value.product} readOnly={readOnly} navigate={navigate} onDirty={onDirty} reload={read.retry} /> : <ProductDetail product={read.value.product} readOnly={readOnly} navigate={navigate} /> : null}</>;
}
function ProductDetail({ product, readOnly, navigate }: { product: Product } & Pick<Props, 'readOnly' | 'navigate'>) {
  const readiness = useRead<{ readiness: Readiness }>(`/library/products/${pid(product.id)}/readiness`);
  return <><div className="bl-heading"><div><span className="bl-tag">{product.status === 'archived' ? '已归档' : '产品草稿'}</span><h2>{product.name}</h2><p>修订 {product.revision} · {stamp(product.updatedAt)}</p></div></div><SourceNotice source={product.source} product />{!product.images.length && <div className="bl-product-image-empty"><Icon name="box" size={30} /><p>尚无产品图片</p></div>}<p className="bl-description">{product.description || '尚未填写产品简介'}</p><details className="bl-section bl-group"><summary>发布准备检查<small>{readiness.value ? ({ incomplete: '资料待补齐', needs_review: '需要审核', ready_for_review: '已完成当前检查' })[readiness.value.readiness.overall] : '读取中'}</small></summary><p className="bl-help">仅检查已保存资料的完整性、有效期和人工审核记录；不是 GEO 认证。</p><Notice error={readiness.error} retry={readiness.retry} />{readiness.loading ? <p role="status">正在检查…</p> : readiness.value && <ul className="bl-checks">{readiness.value.readiness.checks.map(check => <li key={check.key} className={`bl-check-${check.status}`}><span>{checkStatus[check.status]}</span><div><strong>{checkLabel(check)}</strong><p>{checkMessage(check)}</p></div></li>)}</ul>}</details><ProductFacts product={product} /><MedusaProductPanel product={product} readOnly={readOnly} /><div className="bl-detail-action"><button className="primary-button" disabled={readOnly} onClick={() => navigate(`products/${pid(product.id)}/edit`)}>编辑产品</button></div></>;
}
function ProductEditor({ product, readOnly, navigate, onDirty, reload }: { product: Product; reload?: () => void } & Omit<Props, 'route'>) {
  const [draft, setDraft] = useState(product);
  const writer = useWrite();
  const [uploadActive, setUploadActive] = useState(false);
  const onUploadBusy = useCallback((value: boolean) => setUploadActive(value), []);
  useDirty(JSON.stringify(draft) !== JSON.stringify(product) || writer.busy || writer.uncertain || uploadActive, onDirty);
  async function save() { const { id, revision, companyId, createdAt, updatedAt, source, ...changes } = draft; const result = await writer.write<{ product: Product }>(id ? `/library/products/${pid(id)}` : '/library/products', id ? 'PATCH' : 'POST', id ? { expectedRevision: revision, changes } : changes); if (result) { onDirty(false); navigate(`products/${pid(result.product.id)}`); } }
  return <form className="bl-editor" onSubmit={e => { e.preventDefault(); if (draft.name.trim() && !readOnly && !uploadActive) void save(); }}><div className="bl-heading"><div><h2>{product.id ? '编辑产品' : '新建产品'}</h2><p>资料不完整也可以保存为草稿。价格与政策默认仅限企业内部。</p></div></div><SourceNotice source={product.source} product /><fieldset disabled={readOnly || writer.busy || writer.uncertain}><Field label="产品名称"><input aria-label="产品名称" required maxLength={200} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field><Field label="产品简介"><textarea aria-label="产品简介" rows={4} maxLength={8000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></Field><div className="bl-fields"><Field label="产品分类"><input aria-label="产品分类" maxLength={200} value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} /></Field><Field label="状态"><select aria-label="产品状态" value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as Product['status'] })}><option value="draft">草稿</option><option value="archived">已归档</option></select></Field></div><SKUFields draft={draft} setDraft={setDraft} /><SupplyFields draft={draft} setDraft={setDraft} /><ProductImages draft={draft} setDraft={setDraft} onBusy={onUploadBusy} /><ProductDocuments draft={draft} setDraft={setDraft} /></fieldset><WriteNotice writer={writer} onReload={reload} /><div className="bl-actions"><button type="button" className="secondary-button" onClick={() => navigate(product.id ? `products/${pid(product.id)}` : 'products')}>取消</button><button type="submit" className="primary-button" disabled={readOnly || writer.busy || uploadActive || !draft.name.trim()}>{writer.busy ? '正在保存…' : writer.uncertain ? '重试原保存请求' : '保存产品'}</button></div></form>;
}
