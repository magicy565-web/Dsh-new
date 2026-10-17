import { useState } from 'react';
import { useRead, useWrite, Notice, pid, WriteNotice } from './common';
import type { Product } from './types';
import './medusa.css';

type CatalogStatus = {
  provider: string; configured: boolean; connection: string; reason: string | null;
  mode: string; publicListing: false; publicationEnabled: false;
};
type Preview = {
  productId: string; revision: number; title: string; description: string; category: string;
  status: string; sourceHash: string; handle: string; eligible: boolean; ignoredFields: string[];
};
type Remote = { status: 'missing' | 'linked' | 'stale' | 'foreign' | 'not_draft' | 'unconfigured'; product: null | {
  id: string; title: string; description: string; status: string; sourceRevision: number | null;
} };
type PreviewResponse = { medusa: CatalogStatus; preview: Preview };
type RemoteResponse = PreviewResponse & { remote: Remote };
type DraftResponse = RemoteResponse & { created: boolean; requestId: string };

const labels: Record<Remote['status'], string> = {
  missing: '尚无对应草稿', linked: '草稿已核对', stale: '远端与本地版本不同',
  foreign: '远端商品未获本项目归属确认', not_draft: '远端商品不再是草稿', unconfigured: '尚未接入',
};

/** Original Library detail controls remain the UI authority, not Medusa Admin. */
export function MedusaProductPanel({ product, readOnly }: { product: Product; readOnly: boolean }) {
  const [inspect, setInspect] = useState(false);
  const [review, setReview] = useState(false);
  const [checked, setChecked] = useState(false);
  const [remoteRevision, setRemoteRevision] = useState(0);
  const preview = useRead<PreviewResponse>(readOnly ? null : '/medusa/products/' + pid(product.id) + '/preview');
  const remote = useRead<RemoteResponse>(inspect && !readOnly ? '/medusa/products/' + pid(product.id) + '/remote' : null, remoteRevision);
  const session = useRead<{ user: { role: string } | null }>(readOnly ? null : '/session');
  const writer = useWrite('workspace-medusa-draft-' + product.id);
  const value = preview.value?.preview;
  if (readOnly) return null;

  async function save() {
    if (!value || !checked || !review || writer.busy || writer.uncertain) return;
    const result = await writer.write<DraftResponse>('/medusa/products/' + pid(product.id) + '/draft', 'POST', {
      expectedRevision: value.revision, sourceHash: value.sourceHash, confirmed: true,
    });
    if (result) { setReview(false); setChecked(false); setInspect(true); setRemoteRevision(v => v + 1); }
  }
  function inspectRemote() { setInspect(true); setRemoteRevision(v => v + 1); }

  return <section className="bl-medusa" aria-label="Medusa 内部商品预览">
    <header className="bl-medusa-head">
      <div>
        <span className="bl-medusa-eyebrow">内部商品预览 · 可选连接</span>
        <h3>Medusa 产品草稿</h3>
        <p>保留 Workspace 产品库作为原始资料，Medusa 只保存已确认的内部预览草稿。</p>
      </div>
      <span className={'bl-medusa-state ' + (preview.value?.medusa.configured ? 'configured' : '')}>
        {preview.loading ? '核对中' : preview.value?.medusa.configured ? '连接已配置' : '尚未配置'}
      </span>
    </header>
    <Notice error={preview.error} retry={preview.retry}/>
    {!preview.loading && value && <>
      <div className="bl-medusa-details">
        <div><span>产品</span><strong>{value.title}</strong></div>
        <div><span>来源</span><strong>Workspace · 修订 {value.revision}</strong></div>
        <div><span>远端状态</span><strong>草稿，不会公开上架</strong></div>
      </div>
      <details className="bl-medusa-copy">
        <summary>查看将保存到 Medusa 的完整内容</summary>
        <dl><dt>名称</dt><dd>{value.title}</dd><dt>描述</dt><dd>{value.description || '（空）'}</dd></dl>
      </details>
      <p className="bl-medusa-disclosure">仅同步名称、描述及原始版本标记；不会同步内部阶梯价格、MOQ、供应商政策、图片、证书、库存或 Shopify 店铺操作。</p>
      {!value.eligible && <p className="bl-medusa-attention">本产品不是企业自有可编辑草稿，只允许预览，不能创建远端草稿。</p>}
      {!preview.value?.medusa.configured && <p className="bl-medusa-attention">连接未配置。可以先在 Workspace 编辑、预览产品；管理员需单独配置自托管 Medusa v2 和专属密钥。</p>}
      <div className="bl-medusa-actions">
        <button type="button" className="secondary-button" onClick={inspectRemote} disabled={remote.loading || !preview.value?.medusa.configured}>
          {remote.loading ? '正在核对…' : '核对 Medusa 草稿'}
        </button>
        {value.eligible && preview.value?.medusa.configured && session.value?.user?.role === 'admin' &&
          <button type="button" className="primary-button" onClick={() => { setReview(!review); setChecked(false); }} disabled={writer.busy || writer.uncertain}>
            保存内部草稿
          </button>}
      </div>
    </>}
    {inspect && <div className="bl-medusa-remote" aria-live="polite">
      <Notice error={remote.error} retry={remote.retry}/>
      {remote.loading ? <p>正在读取远端原始回执…</p> : remote.value &&
        <><strong>{labels[remote.value.remote.status]}</strong>
          <p>{remote.value.remote.product ? 'Medusa ID：' + remote.value.remote.product.id : '没有对应的远端产品记录。'}</p>
          {remote.value.remote.status === 'linked' && <small>仅证明当前 Medusa 草稿与选定 Workspace 修订一致，不代表已发布或有库存。</small>}
          {['stale', 'foreign', 'not_draft'].includes(remote.value.remote.status) && <small>已停止写入。请由管理员核对远端差异，本界面不会自动覆盖。</small>}
        </>}
    </div>}
    {review && value && <div className="bl-medusa-review">
      <h4>确认保存本次内部草稿</h4>
      <p>将向专属 Medusa 实例提交名称和完整描述。不会上架、收款、同步渠道或创建库存。</p>
      <label><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}/>
        我已核对待保存的内容，允许本次内部数据复制。</label>
      <div className="bl-medusa-actions">
        <button type="button" className="secondary-button" onClick={() => setReview(false)}>取消</button>
        <button type="button" className="primary-button" disabled={!checked || writer.busy || writer.uncertain} onClick={() => void save()}>
          {writer.busy ? '正在保存…' : '确认保存草稿'}
        </button>
      </div>
    </div>}
    <WriteNotice writer={writer}/>
    {writer.uncertain && <div className="bl-medusa-actions"><button type="button" className="secondary-button" onClick={inspectRemote}>先只读核对远端</button><button type="button" className="secondary-button" disabled={writer.busy} onClick={() => void writer.retry<DraftResponse>().then(result => { if (result) { setInspect(true); setReview(false); setRemoteRevision(v => v + 1); } })}>以原请求号确认结果</button></div>}
  </section>;
}
