import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, requestId } from '../api';
import { Icon } from '../icons';
import './product-library.css';

type Status = { configured: boolean; source: string; workspaceId: string; rooms: number; pages: number; approvedPages: number };
type ProductRow = {
  productId: string; title: string; handle: string | null; status: string | null; thumbnail: string | null;
  variantCount: number; readinessScore: number; reviewVersion: number; inLibrary: boolean;
  pageCount: number; approvedPages: number; documentCount: number;
};
type ListPayload = {
  source: { configured: boolean; kind: string; live: boolean; warning?: string };
  items: ProductRow[]; total: number;
};
type Citation = { source: 'product' | 'context' | 'evidence'; field: string; label: string; status: 'current' | 'stale' | 'missing'; preview: string | null };
type PageComment = { id: string; version: number; body: string; createdBy: string; createdAt: string };
type LibraryPage = {
  id: string; status: 'draft' | 'approved'; revision: number; version: number; title: string; body: string;
  citations: Citation[]; createdAt: string; updatedAt: string; approvedAt: string | null; approvedBy: string | null;
  history: { version: number; title: string; sha256: string; createdAt: string; createdBy: string }[];
  comments: PageComment[];
};
type LibraryDocument = {
  id: string; artifactId: string; filename: string; mimeType: string; size: number; sha256: string;
  label: string; kind: string; evidenceId: string | null; createdBy: string; createdAt: string; revision: number;
  downloadPath: string;
};
type SearchHit = {
  productId: string; productTitle: string; kind: 'product' | 'page' | 'document'; id: string;
  title: string; snippet: string; status: string; version?: number; size?: number; sha256?: string;
};
type SearchPayload = { query: string; total: number; items: SearchHit[] };
type Pin = {
  product: { id: string; title: string; subtitle: string | null; handle: string | null; description: string | null; status: string | null; thumbnail: string | null; variants: { id: string; title: string | null; sku: string | null }[] };
  context: {
    reviewVersion: number; sourceHash: string; readinessScore: number; buyerProfile: string | null;
    targetMarkets: string[]; useCases: string[]; sellingPoints: string[];
    evidence: { id: string; label: string; type: string; status: string; sha256: string | null }[];
    commercialPolicy: Record<string, string | number> | null; missingEvidence: string[]; agentSummary: string | null;
    updatedAt: string | null;
  };
  hash: string; pinnedAt: string;
};
type Room = {
  productId: string; pin: Pin; pages: LibraryPage[]; documents: LibraryDocument[];
  counts: { pages: number; approved: number; comments: number; documents: number };
  canEdit: boolean; canApprove: boolean;
  source: { configured: boolean; kind: string; live: boolean; warning?: string | null };
};
type Editor = { mode: 'new' | 'edit'; pageId?: string; title: string; body: string; selected: string[] };
type Tab = 'overview' | 'pages' | 'documents';

const keyOf = (source: string, field: string) => `${source}:${field}`;
const errorText = (error: unknown) => error instanceof ApiError ? error.message : error instanceof Error ? error.message : '操作未完成，请重试。';
const formatBytes = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${Math.round(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
const formatDate = (value: string) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const citationStatusLabel = { current: '当前', stale: '已过期', missing: '缺失' } as const;
const documentKinds = [['spec_sheet', '规格书'], ['certificate', '证书'], ['test_report', '检测报告'], ['case_study', '案例'], ['other', '其他']] as const;
const documentKindLabel = (kind: string) => documentKinds.find(([value]) => value === kind)?.[1] ?? kind;
const initials = (title: string) => (title.trim().replace(/\s+/g, ' ').slice(0, 2) || 'PL').toUpperCase();
const tone = (id: string) => `tone-${[...id].reduce((total, character) => total + character.charCodeAt(0), 0) % 4}`;

function contextOptions(room: Room): { key: string; label: string }[] {
  const context = room.pin.context;
  const options: { key: string; label: string }[] = [{ key: keyOf('product', 'title'), label: '商品标题' }];
  if (context.buyerProfile) options.push({ key: keyOf('context', 'buyer_profile'), label: '买家画像' });
  if (context.targetMarkets.length) options.push({ key: keyOf('context', 'target_markets'), label: '目标市场' });
  if (context.useCases.length) options.push({ key: keyOf('context', 'use_cases'), label: '使用场景' });
  if (context.sellingPoints.length) options.push({ key: keyOf('context', 'selling_points'), label: '卖点' });
  if (context.commercialPolicy) options.push({ key: keyOf('context', 'commercial_policy'), label: '商务条款' });
  for (const evidence of context.evidence) options.push({ key: keyOf('evidence', evidence.id), label: `证据 · ${evidence.label}` });
  return options;
}
function defaultCitations(room: Room): string[] {
  const available = new Set(contextOptions(room).map(option => option.key));
  const preferred = [keyOf('context', 'buyer_profile'), keyOf('context', 'target_markets'), keyOf('product', 'title')];
  const evidence = room.pin.context.evidence[0];
  if (evidence) preferred.push(keyOf('evidence', evidence.id));
  return preferred.filter(key => available.has(key));
}
function citationsFor(room: Room, selected: string[]) {
  const options = new Map(contextOptions(room).map(option => [option.key, option.label]));
  return selected.filter(key => options.has(key)).map(key => {
    const [source, ...rest] = key.split(':');
    return { source: source as Citation['source'], field: rest.join(':'), label: options.get(key)! };
  });
}
function policyText(policy: Record<string, string | number> | null) {
  if (!policy) return '未填写';
  const pieces = [];
  if (policy.moq !== undefined) pieces.push(`MOQ ${policy.moq}`);
  if (policy.currency) pieces.push(String(policy.currency));
  if (policy.price_min !== undefined && policy.price_max !== undefined) pieces.push(`${policy.price_min}–${policy.price_max}`);
  if (policy.lead_time_days !== undefined) pieces.push(`${policy.lead_time_days} 天交期`);
  if (policy.sample_policy) pieces.push(String(policy.sample_policy));
  return pieces.length ? pieces.join(' · ') : Object.entries(policy).map(([key, value]) => `${key}: ${value}`).join(' · ');
}

export function ProductLibrary({ readOnly }: { readOnly: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [payload, setPayload] = useState<ListPayload | null>(null);
  const [hits, setHits] = useState<SearchPayload | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [roomLoading, setRoomLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [tab, setTab] = useState<Tab>('overview');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [comment, setComment] = useState<{ pageId: string; body: string } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadLabel, setUploadLabel] = useState('');
  const [uploadKind, setUploadKind] = useState('spec_sheet');
  const [uploadEvidence, setUploadEvidence] = useState('');

  const selectedRow = useMemo(() => payload?.items.find(item => item.productId === selectedId) ?? null, [payload, selectedId]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true); setError('');
      const search = query.trim()
        ? api<SearchPayload>(`/product-library/search?q=${encodeURIComponent(query.trim())}&limit=20`)
        : Promise.resolve(null);
      Promise.all([api<Status>('/product-library/status'), api<ListPayload>('/product-library/products?limit=50'), search])
        .then(([nextStatus, nextPayload, nextHits]) => {
          if (!active) return;
          setStatus(nextStatus); setPayload(nextPayload); setHits(nextHits);
          setSelectedId(current => current && nextPayload.items.some(item => item.productId === current)
            ? current : nextPayload.items[0]?.productId ?? null);
        })
        .catch(reason => { if (active) setError(errorText(reason)); })
        .finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, refreshKey]);

  const loadRoom = useCallback(async (productId: string) => {
    setRoomLoading(true);
    try {
      const next = await api<Room>(`/product-library/products/${encodeURIComponent(productId)}`);
      setRoom(next);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 404) setRoom(null);
      else setError(errorText(reason));
    } finally { setRoomLoading(false); }
  }, []);

  useEffect(() => {
    if (!selectedId) { setRoom(null); return; }
    setRoom(null); setEditor(null); setComment(null); setUploadOpen(false); setTab('overview');
    void loadRoom(selectedId);
  }, [selectedId, refreshKey, loadRoom]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const refresh = () => setRefreshKey(value => value + 1);

  async function run(action: () => Promise<string>) {
    if (busy) return;
    setBusy(true); setError('');
    try { setNotice(await action()); refresh(); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }

  async function openRoom() {
    if (!selectedId) return;
    await run(async () => {
      await api(`/product-library/products/${encodeURIComponent(selectedId)}/open`, 'POST', { requestId: requestId() });
      return '资料空间已打开。';
    });
  }

  async function syncRoom() {
    if (!selectedId) return;
    await run(async () => {
      const result = await api<{ changed: boolean; changedFields: string[]; stalePages?: string[] }>(`/product-library/products/${encodeURIComponent(selectedId)}/sync`, 'POST', { requestId: requestId() });
      return result.changed ? `已重新同步：${result.changedFields.join('、')}` : '已是最新，无需同步。';
    });
  }

  function startNewPage() {
    if (!room) return;
    setTab('pages');
    setEditor({ mode: 'new', title: '', body: '', selected: defaultCitations(room) });
  }
  function startEditPage(page: LibraryPage) {
    setTab('pages');
    setEditor({
      mode: 'edit', pageId: page.id, title: page.title, body: page.body,
      selected: page.citations.map(citation => keyOf(citation.source, citation.field)),
    });
  }

  async function saveEditor() {
    if (!room || !editor) return;
    const title = editor.title.trim();
    if (!title) { setError('请填写页面标题。'); return; }
    await run(async () => {
      const citations = citationsFor(room, editor.selected);
      if (editor.mode === 'new') {
        await api(`/product-library/products/${encodeURIComponent(room.productId)}/pages`, 'POST', {
          requestId: requestId(), title, body: editor.body, citations,
        });
      } else {
        const page = room.pages.find(item => item.id === editor.pageId);
        if (!page) throw new Error('页面已不存在，请刷新。');
        await api(`/product-library/products/${encodeURIComponent(room.productId)}/pages/${encodeURIComponent(page.id)}/save`, 'POST', {
          requestId: requestId(), expectedRevision: page.revision, title, body: editor.body, citations,
        });
      }
      setEditor(null);
      return '页面已保存。';
    });
  }

  async function submitComment(page: LibraryPage) {
    if (!room || !comment || comment.pageId !== page.id || !comment.body.trim()) return;
    await run(async () => {
      await api(`/product-library/products/${encodeURIComponent(room.productId)}/pages/${encodeURIComponent(page.id)}/comments`, 'POST', {
        requestId: requestId(), expectedRevision: page.revision, version: page.version, body: comment.body.trim(),
      });
      setComment(null);
      return '评论已添加。';
    });
  }

  async function toggleApproval(page: LibraryPage) {
    if (!room) return;
    await run(async () => {
      const approved = page.status !== 'approved';
      await api(`/product-library/products/${encodeURIComponent(room.productId)}/pages/${encodeURIComponent(page.id)}/approve`, 'POST', {
        requestId: requestId(), expectedRevision: page.revision, approved,
      });
      return approved ? '页面已通过审核。' : '已撤回页面审核。';
    });
  }

  async function attachDocument() {
    if (!room || !uploadFile) return;
    if (uploadFile.size > 512 * 1024) { setError('附件上限 512 KiB。'); return; }
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
      };
      reader.onerror = () => reject(new Error('读取附件失败。'));
      reader.readAsDataURL(uploadFile);
    });
    await run(async () => {
      await api(`/product-library/products/${encodeURIComponent(room.productId)}/documents`, 'POST', {
        requestId: requestId(), filename: uploadFile.name, base64,
        label: uploadLabel.trim() || uploadFile.name, kind: uploadKind,
        ...(uploadEvidence ? { evidenceId: uploadEvidence } : {}),
      });
      setUploadOpen(false); setUploadFile(null); setUploadLabel(''); setUploadEvidence('');
      return '附件已上传并校验 SHA-256。';
    });
  }

  const options = room ? contextOptions(room) : [];
  const counts = room?.counts;
  const stats = [
    { label: '已审核商品', value: payload?.total ?? 0, icon: 'box' as const },
    { label: '资料空间', value: status?.rooms ?? 0, icon: 'library' as const },
    { label: '页面', value: status?.pages ?? 0, icon: 'file' as const },
    { label: '已通过', value: status?.approvedPages ?? 0, icon: 'checkmark' as const },
  ];

  return <div className="pl-page">
    <header className="pl-hero">
      <div className="pl-hero-copy">
        <span className="pl-overline"><i aria-hidden="true" />MEDUSA · PRODUCT KNOWLEDGE</span>
        <h2>产品资料库</h2>
        <p>把已审核的商品事实变成可协作的资料空间：页面有版本和引用，附件有 SHA-256，Agent 只读通过审核的上下文。</p>
        <div className="pl-hero-meta">
          <span className={status?.configured ? 'pl-connection on' : 'pl-connection'}><b />{status ? status.configured ? 'Medusa 已连接' : 'Medusa 未配置' : '读取中'}</span>
          <span>工作空间 {status?.workspaceId ?? 'local'}</span>
          <span>来源 {status?.source ?? '—'}</span>
        </div>
      </div>
      <div className="pl-stats">
        {stats.map(item => <div className="pl-stat" key={item.label}>
          <span className="pl-stat-icon"><Icon name={item.icon} size={18} /></span>
          <strong>{item.value}</strong>
          <small>{item.label}</small>
        </div>)}
      </div>
    </header>

    {error && <div className="pl-error" role="alert"><Icon name="warning" size={16} />{error}<button onClick={() => setError('')} aria-label="关闭错误"><Icon name="close" size={14} /></button></div>}
    {notice && <div className="pl-notice" role="status"><Icon name="check" size={16} />{notice}</div>}
    {payload?.source.warning === 'PRODUCT_LIBRARY_SOURCE_UNCONFIGURED' && <div className="pl-warning" role="status"><Icon name="info" size={16} />产品资料库还没有连接 Medusa：只显示已打开的资料空间。</div>}

    <div className="pl-toolbar">
      <div className="pl-search"><Icon name="search" size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索商品、页面或附件…" aria-label="搜索产品资料库" />{query && <button onClick={() => setQuery('')} aria-label="清空搜索"><Icon name="close" size={14} /></button>}</div>
      <span className="pl-toolbar-count">{payload ? `${payload.total} 件已审核商品` : '读取中…'}</span>
      <button className="pl-secondary" onClick={refresh} disabled={loading || busy}><Icon name="refresh" size={15} />刷新</button>
    </div>

    {query.trim() && hits && hits.items.length > 0 && <div className="pl-hits" aria-label="资料库搜索结果">
      <div className="pl-hits-head">资料库搜索 · {hits.total} 条</div>
      {hits.items.map(hit => <button key={`${hit.kind}:${hit.id}`} onClick={() => setSelectedId(hit.productId)}>
        <span className={`pl-hit-kind ${hit.kind}`}>{hit.kind === 'page' ? '页面' : hit.kind === 'document' ? '附件' : '商品'}</span>
        <strong>{hit.title}</strong>
        <small>{hit.productTitle}</small>
        <p>{hit.snippet}</p>
      </button>)}
    </div>}

    {loading && !payload ? <div className="pl-skeleton"><span /><span /><span /></div> : !payload?.items.length ? <div className="pl-empty-block"><span className="pl-empty-icon"><Icon name="box" size={28} /></span><h3>还没有已审核的商品</h3><p>在 Medusa 后台为商品建立并审核 Product Context 后，这里会出现可用的资料空间。</p></div> : <div className="pl-layout">
      <aside className="pl-sidebar" aria-label="已审核商品">
        <div className="pl-sidebar-head"><span>已审核商品</span><small>{payload.items.length}</small></div>
        <div className="pl-list">
          {payload.items.map(item => <button key={item.productId} className={`pl-item ${item.productId === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(item.productId)}>
            <span className={`pl-item-avatar ${tone(item.productId)}`}>{initials(item.title)}</span>
            <span className="pl-item-body">
              <span className="pl-item-title">{item.title}</span>
              <span className="pl-item-sub">{item.status || 'draft'} · {item.variantCount} 个变体</span>
              <span className="pl-progress"><i style={{ width: `${Math.max(4, Math.min(100, item.readinessScore))}%` }} /></span>
              <span className="pl-item-foot"><span>{item.readinessScore}% 就绪</span><span>{item.pageCount} 页 · {item.documentCount} 附件</span></span>
            </span>
            <Icon name="chevron" size={15} />
          </button>)}
        </div>
      </aside>

      <section className="pl-detail" aria-live="polite">
        {roomLoading && <div className="pl-skeleton"><span /><span /><span /></div>}
        {!roomLoading && !room && selectedRow && <div className="pl-empty-block">
          <span className="pl-empty-icon"><Icon name="library" size={28} /></span>
          <h3>{selectedRow.title}</h3>
          <p>该商品已有已审核的 Product Context，但还没有建立资料空间。打开后即可写页面、评论和上传证据附件。</p>
          <button className="pl-primary" onClick={() => void openRoom()} disabled={readOnly || busy}>{busy ? '打开中…' : '打开资料空间'}</button>
        </div>}
        {!roomLoading && room && <>
          <div className="pl-room-hero">
            <span className={`pl-room-avatar ${tone(room.productId)}`}>{initials(room.pin.product.title)}</span>
            <div className="pl-room-copy">
              <span className="pl-kicker">PRODUCT ROOM · {room.productId}</span>
              <h3>{room.pin.product.title}</h3>
              <p>{room.pin.product.description || '暂无商品描述。'}</p>
              <div className="pl-room-meta">
                <span className="pl-badge ready">{room.pin.product.status || 'draft'}</span>
                <span>{room.pin.product.variants.length} 个变体</span>
                <span>review rev {room.pin.context.reviewVersion}</span>
                <span>pin {room.pin.hash.slice(0, 10)}…</span>
              </div>
            </div>
            <div className="pl-room-side">
              <div className="pl-ring" style={{ background: `conic-gradient(#285cff ${Math.max(0, Math.min(100, room.pin.context.readinessScore))}%, #edf0f4 0)` }}><span>{room.pin.context.readinessScore}</span><small>就绪度</small></div>
              <div className="pl-room-actions">
                <button className="pl-secondary" onClick={() => void syncRoom()} disabled={readOnly || busy}><Icon name="refresh" size={15} />同步</button>
                <button className="pl-primary" onClick={startNewPage} disabled={readOnly || !!editor}><Icon name="plus" size={15} />新建页面</button>
              </div>
            </div>
          </div>

          <nav className="pl-tabs" role="tablist" aria-label="产品资料空间">
            {([['overview', '概览', null], ['pages', '页面', room.pages.length], ['documents', '附件', room.documents.length]] as [Tab, string, number | null][]).map(([key, label, count]) =>
              <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)}>{label}{count !== null && <em>{count}</em>}</button>)}
          </nav>

          {tab === 'overview' && <div className="pl-overview">
            <div className="pl-tiles">
              <article className="pl-tile"><span className="pl-tile-icon blue"><Icon name="people" size={18} /></span><small>买家画像</small><p>{room.pin.context.buyerProfile || '未填写'}</p></article>
              <article className="pl-tile"><span className="pl-tile-icon green"><Icon name="globe" size={18} /></span><small>目标市场</small><p>{room.pin.context.targetMarkets.join('、') || '未填写'}</p></article>
              <article className="pl-tile"><span className="pl-tile-icon amber"><Icon name="sparkle" size={18} /></span><small>使用场景</small><p>{room.pin.context.useCases.join('、') || '未填写'}</p></article>
              <article className="pl-tile"><span className="pl-tile-icon violet"><Icon name="bolt" size={18} /></span><small>核心卖点</small><p>{room.pin.context.sellingPoints.join('、') || '未填写'}</p></article>
              <article className="pl-tile wide"><span className="pl-tile-icon ink"><Icon name="money" size={18} /></span><small>商务条款</small><p>{policyText(room.pin.context.commercialPolicy)}</p></article>
              <article className="pl-tile wide"><span className="pl-tile-icon amber"><Icon name="certificate" size={18} /></span><small>证据</small><div className="pl-evidence-list">{room.pin.context.evidence.length ? room.pin.context.evidence.map(item => <span key={item.id} className={`pl-evidence ${item.status}`}><Icon name="certificate" size={13} />{item.label}<em>{item.status}</em></span>) : <p>未填写</p>}</div></article>
            </div>
            <aside className="pl-source-card">
              <div className="pl-source-head"><span>来源与一致性</span><Icon name="shield" size={16} /></div>
              <dl>
                <div><dt>审核版本</dt><dd>rev {room.pin.context.reviewVersion}</dd></div>
                <div><dt>同步时间</dt><dd>{formatDate(room.pin.pinnedAt)}</dd></div>
                <div><dt>商品状态</dt><dd>{room.pin.product.status || 'draft'}</dd></div>
                <div><dt>封面</dt><dd>{room.pin.product.thumbnail ? '已提供' : '未提供'}</dd></div>
              </dl>
              <p className="pl-hash">hash {room.pin.hash.slice(0, 24)}…</p>
              <p className="pl-hint">页面保存时会把每个引用固定到当前 pin；Medusa 侧更新后需要同步并重新保存页面。</p>
            </aside>
          </div>}

          {tab === 'pages' && <section className="pl-panel">
            <div className="pl-panel-head"><div><h4>页面</h4><p>{room.pages.length} 个版本化页面 · {counts?.approved ?? 0} 个已通过</p></div><button className="pl-primary small" onClick={startNewPage} disabled={readOnly || !!editor}><Icon name="plus" size={15} />新建页面</button></div>
            {editor && <div className="pl-editor">
              <div className="pl-panel-head"><div><h4>{editor.mode === 'new' ? '新建页面' : '保存新版本'}</h4>{editor.mode === 'edit' && <p>编辑已通过的页面会撤回审核。</p>}</div><button className="pl-link" onClick={() => setEditor(null)}>取消</button></div>
              <label>标题<input value={editor.title} onChange={event => setEditor({ ...editor, title: event.target.value })} maxLength={200} placeholder="例如：美国市场上市简报" /></label>
              <label>正文<textarea value={editor.body} onChange={event => setEditor({ ...editor, body: event.target.value })} maxLength={65536} rows={7} placeholder="写清市场判断、证据与下一步…" /></label>
              <fieldset><legend>引用来源</legend>
                {options.map(option => <label className="pl-check" key={option.key}><input type="checkbox" checked={editor.selected.includes(option.key)} onChange={event => setEditor({ ...editor, selected: event.target.checked ? [...editor.selected, option.key] : editor.selected.filter(key => key !== option.key) })} />{option.label}</label>)}
              </fieldset>
              <div className="pl-editor-actions"><button className="pl-secondary" onClick={() => setEditor(null)}>取消</button><button className="pl-primary" onClick={() => void saveEditor()} disabled={busy || !editor.title.trim()}>{busy ? '保存中…' : '保存页面'}</button></div>
            </div>}
            {!room.pages.length && !editor && <div className="pl-empty-inline"><Icon name="file" size={22} /><p>还没有页面。写第一份市场简报或上架说明。</p></div>}
            {room.pages.map(page => <article className={`pl-page-card ${page.status}`} key={page.id}>
              <header>
                <div><span className={`pl-status-dot ${page.status}`} /><strong>{page.title}</strong><span className={`pl-badge ${page.status === 'approved' ? 'ready' : ''}`}>{page.status === 'approved' ? '已通过' : '草稿'}</span></div>
                <small>v{page.version} · rev {page.revision} · {formatDate(page.updatedAt)}</small>
              </header>
              <div className="pl-citations">{page.citations.map(citation => <span key={keyOf(citation.source, citation.field)} className={`pl-citation ${citation.status}`} title={citation.preview || ''}>{citation.label} · {citationStatusLabel[citation.status]}</span>)}</div>
              <p className="pl-body">{page.body || '（空页面）'}</p>
              <footer>
                <span>{page.comments.length} 条评论{page.approvedBy ? ` · 审核人 ${page.approvedBy}` : ''}</span>
                <div>
                  <button className="pl-link" onClick={() => setComment({ pageId: page.id, body: '' })} disabled={readOnly}>评论</button>
                  <button className="pl-link" onClick={() => startEditPage(page)} disabled={readOnly || !!editor}>新版本</button>
                  {room.canApprove && <button className="pl-link" onClick={() => void toggleApproval(page)} disabled={busy}>{page.status === 'approved' ? '撤回审核' : '通过审核'}</button>}
                </div>
              </footer>
              {!!page.comments.length && <ul className="pl-comments">{page.comments.map(item => <li key={item.id}><span>{item.createdBy}</span>{item.body}<small>{formatDate(item.createdAt)}</small></li>)}</ul>}
              {comment?.pageId === page.id && <div className="pl-comment-form">
                <textarea value={comment.body} onChange={event => setComment({ pageId: page.id, body: event.target.value })} placeholder="写一条评论…" maxLength={4000} aria-label="评论内容" />
                <div><button className="pl-secondary" onClick={() => setComment(null)}>取消</button><button className="pl-primary" onClick={() => void submitComment(page)} disabled={busy || !comment.body.trim()}>提交评论</button></div>
              </div>}
            </article>)}
          </section>}

          {tab === 'documents' && <section className="pl-panel">
            <div className="pl-panel-head"><div><h4>附件</h4><p>{room.documents.length} 个文件 · 下载时重新校验 SHA-256</p></div><button className="pl-secondary" onClick={() => setUploadOpen(value => !value)} disabled={readOnly}><Icon name="upload" size={15} />上传附件</button></div>
            {uploadOpen && <div className="pl-upload">
              <label className="pl-file-drop">文件<input type="file" accept=".txt,.md,.csv,.json,.pdf,.png,.jpg,.jpeg,.webp" onChange={event => { setUploadFile(event.target.files?.[0] ?? null); setUploadLabel(event.target.files?.[0]?.name ?? ''); }} /><span>{uploadFile ? `${uploadFile.name} · ${formatBytes(uploadFile.size)}` : '选择 PDF / 图片 / CSV / Markdown / 文本（≤512 KiB）'}</span></label>
              <label>名称<input value={uploadLabel} onChange={event => setUploadLabel(event.target.value)} maxLength={240} /></label>
              <label>类型<select value={uploadKind} onChange={event => setUploadKind(event.target.value)}>{documentKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>关联证据<select value={uploadEvidence} onChange={event => setUploadEvidence(event.target.value)}><option value="">不关联</option>{room.pin.context.evidence.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
              <div className="pl-editor-actions"><button className="pl-secondary" onClick={() => setUploadOpen(false)}>取消</button><button className="pl-primary" onClick={() => void attachDocument()} disabled={busy || !uploadFile}>{busy ? '上传中…' : '上传并校验'}</button></div>
            </div>}
            {!room.documents.length && !uploadOpen ? <div className="pl-empty-inline"><Icon name="file" size={22} /><p>没有附件。证书、规格书或检测报告都可以放在这里。</p></div> : <div className="pl-docs">{room.documents.map(document => <div className="pl-doc" key={document.id}>
              <span className="pl-doc-icon"><Icon name="file" size={20} /></span>
              <div className="pl-doc-body"><strong>{document.label}</strong><small>{document.filename} · {formatBytes(document.size)}</small><span className="pl-doc-meta"><em>{documentKindLabel(document.kind)}</em>{document.evidenceId && <em>{document.evidenceId}</em>}<code>{document.sha256.slice(0, 16)}…</code></span></div>
              <a className="pl-icon-button" href={document.downloadPath} aria-label={`下载 ${document.label}`}><Icon name="download" size={17} /></a>
            </div>)}</div>}
          </section>}
        </>}
      </section>
    </div>}
  </div>;
}
