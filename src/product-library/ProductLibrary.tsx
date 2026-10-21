import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const [pageId, setPageId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [comment, setComment] = useState('');
  const [commentOpen, setCommentOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadLabel, setUploadLabel] = useState('');
  const [uploadKind, setUploadKind] = useState('spec_sheet');
  const [uploadEvidence, setUploadEvidence] = useState('');
  const pendingPage = useRef<string | null>(null);
  const previousProduct = useRef<string | null>(null);

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
      const preferred = pendingPage.current;
      pendingPage.current = null;
      setPageId(current => {
        if (current && next.pages.some(page => page.id === current)) return current;
        if (preferred && next.pages.some(page => page.id === preferred)) return preferred;
        return next.pages[0]?.id ?? null;
      });
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 404) { setRoom(null); setPageId(null); }
      else setError(errorText(reason));
    } finally { setRoomLoading(false); }
  }, []);

  useEffect(() => {
    if (!selectedId) { setRoom(null); setPageId(null); previousProduct.current = null; return; }
    const changedProduct = previousProduct.current !== selectedId;
    previousProduct.current = selectedId;
    if (changedProduct) {
      setRoom(null); setPageId(null); setEditor(null); setCommentOpen(false); setComment(''); setUploadOpen(false);
    }
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
      const result = await api<{ changed: boolean; changedFields: string[] }>(`/product-library/products/${encodeURIComponent(selectedId)}/sync`, 'POST', { requestId: requestId() });
      return result.changed ? `已重新同步：${result.changedFields.join('、')}` : '已是最新，无需同步。';
    });
  }

  function startNewPage() {
    if (!room) return;
    setEditor({ mode: 'new', title: '', body: '', selected: defaultCitations(room) });
  }
  function startEditPage(page: LibraryPage) {
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
        const result = await api<{ pageId: string }>(`/product-library/products/${encodeURIComponent(room.productId)}/pages`, 'POST', {
          requestId: requestId(), title, body: editor.body, citations,
        });
        setPageId(result.pageId);
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
    if (!room || !comment.trim()) return;
    await run(async () => {
      await api(`/product-library/products/${encodeURIComponent(room.productId)}/pages/${encodeURIComponent(page.id)}/comments`, 'POST', {
        requestId: requestId(), expectedRevision: page.revision, version: page.version, body: comment.trim(),
      });
      setComment(''); setCommentOpen(false);
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

  function openHit(hit: SearchHit) {
    setSelectedId(hit.productId);
    if (hit.kind === 'page') pendingPage.current = hit.id;
    setQuery('');
  }

  const options = room ? contextOptions(room) : [];
  const activePage = room?.pages.find(page => page.id === pageId) ?? null;

  return <div className="pl-workspace">
    <aside className="pl-rail">
      <div className="pl-rail-head">
        <div className="pl-rail-title"><span className="pl-overline">PRODUCT LIBRARY</span><h2>产品资料库</h2></div>
        <p className="pl-rail-status"><span className={status?.configured ? 'pl-dot on' : 'pl-dot'} />{status ? status.configured ? 'Medusa 已连接' : 'Medusa 未配置' : '读取中…'}{status && <em>{status.rooms} 空间 · {status.pages} 页</em>}</p>
        <div className="pl-search"><Icon name="search" size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索商品、页面或附件…" aria-label="搜索产品资料库" />{query && <button onClick={() => setQuery('')} aria-label="清空搜索"><Icon name="close" size={13} /></button>}</div>
      </div>
      <div className="pl-rail-scroll">
        {query.trim() && hits && hits.items.length > 0 && <div className="pl-hits">
          <div className="pl-hits-head">搜索结果 · {hits.total}</div>
          {hits.items.map(hit => <button key={`${hit.kind}:${hit.id}`} onClick={() => openHit(hit)}>
            <span className={`pl-hit-kind ${hit.kind}`}>{hit.kind === 'page' ? '页面' : hit.kind === 'document' ? '附件' : '商品'}</span>
            <strong>{hit.title}</strong><small>{hit.productTitle}</small><p>{hit.snippet}</p>
          </button>)}
        </div>}
        <div className="pl-rail-section"><span>商品</span><small>{payload?.items.length ?? 0}</small></div>
        {loading && !payload ? <div className="pl-skeleton"><span /><span /><span /></div> : !payload?.items.length ? <div className="pl-rail-empty"><Icon name="box" size={20} /><p>没有已审核商品</p></div> : payload.items.map(item => <button key={item.productId} className={`pl-product ${item.productId === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(item.productId)}>
          <span className={`pl-product-avatar ${tone(item.productId)}`}>{initials(item.title)}</span>
          <span className="pl-product-body"><strong>{item.title}</strong><small>{item.status || 'draft'} · {item.variantCount} 变体</small><span className="pl-progress"><i style={{ width: `${Math.max(4, Math.min(100, item.readinessScore))}%` }} /></span></span>
        </button>)}
        {room && <div className="pl-pages-nav">
          <div className="pl-rail-section"><span>页面</span><button className="pl-rail-add" onClick={startNewPage} disabled={readOnly || !!editor} aria-label="新建页面"><Icon name="plus" size={15} /></button></div>
          {room.pages.map(page => <button key={page.id} className={`pl-page-nav ${page.id === pageId ? 'selected' : ''}`} onClick={() => { setPageId(page.id); setEditor(null); setCommentOpen(false); }}>
            <span className={`pl-status-dot ${page.status}`} /><span>{page.title}</span><small>v{page.version}</small>
          </button>)}
          {!room.pages.length && <p className="pl-rail-empty">还没有页面</p>}
        </div>}
      </div>
      <div className="pl-rail-foot"><span>{status?.source ?? '—'}</span>{payload?.source.warning && <em>未配置</em>}</div>
    </aside>

    <main className="pl-document">
      {error && <div className="pl-error" role="alert"><Icon name="warning" size={15} />{error}<button onClick={() => setError('')} aria-label="关闭错误"><Icon name="close" size={13} /></button></div>}
      {notice && <div className="pl-notice" role="status"><Icon name="check" size={15} />{notice}</div>}
      {roomLoading ? <div className="pl-doc-loading"><div className="pl-skeleton"><span /><span /><span /></div></div> : !room ? <div className="pl-doc-empty">
        <span className="pl-doc-empty-icon"><Icon name="library" size={26} /></span>
        <h2>{selectedRow?.title ?? '产品资料库'}</h2>
        <p>{selectedRow ? '该商品已有已审核的 Product Context，但还没有建立资料空间。打开后即可写页面、评论和上传证据附件。' : '左侧选择一件已审核商品。'}</p>
        {selectedRow && <button className="pl-primary" onClick={() => void openRoom()} disabled={readOnly || busy}>{busy ? '打开中…' : '打开资料空间'}</button>}
      </div> : editor ? <div className="pl-editor-doc">
        <div className="pl-editor-head"><div><span className="pl-overline">{editor.mode === 'new' ? 'NEW PAGE' : 'NEW VERSION'}</span><h2>{editor.mode === 'new' ? '新建页面' : '保存新版本'}</h2>{editor.mode === 'edit' && <p>编辑已通过的页面会撤回审核，需要重新通过。</p>}</div><button className="pl-secondary" onClick={() => setEditor(null)}>取消</button></div>
        <label>标题<input value={editor.title} onChange={event => setEditor({ ...editor, title: event.target.value })} maxLength={200} placeholder="例如：美国市场上市简报" /></label>
        <label>正文<textarea value={editor.body} onChange={event => setEditor({ ...editor, body: event.target.value })} maxLength={65536} rows={14} placeholder="写清市场判断、证据与下一步…" /></label>
        <fieldset><legend>引用来源 · 保存时固定 value hash</legend>
          {options.map(option => <label className="pl-check" key={option.key}><input type="checkbox" checked={editor.selected.includes(option.key)} onChange={event => setEditor({ ...editor, selected: event.target.checked ? [...editor.selected, option.key] : editor.selected.filter(key => key !== option.key) })} />{option.label}</label>)}
        </fieldset>
        <div className="pl-editor-actions"><button className="pl-secondary" onClick={() => setEditor(null)}>取消</button><button className="pl-primary" onClick={() => void saveEditor()} disabled={busy || !editor.title.trim()}>{busy ? '保存中…' : '保存页面'}</button></div>
      </div> : activePage ? <>
        <header className="pl-doc-head">
          <div className="pl-breadcrumb"><span>{room.pin.product.title}</span><Icon name="chevron" size={12} /><span>页面</span></div>
          <div className="pl-doc-title-row"><h1>{activePage.title}</h1><span className={`pl-badge ${activePage.status === 'approved' ? 'ready' : ''}`}>{activePage.status === 'approved' ? '已通过' : '草稿'}</span></div>
          <div className="pl-doc-meta"><span>v{activePage.version}</span><span>rev {activePage.revision}</span><span>{formatDate(activePage.updatedAt)}</span>{activePage.approvedBy && <span>审核人 {activePage.approvedBy}</span>}</div>
          <div className="pl-doc-actions">
            <button className="pl-secondary" onClick={() => { setCommentOpen(value => !value); }} disabled={readOnly}><Icon name="chat" size={15} />评论</button>
            <button className="pl-secondary" onClick={() => startEditPage(activePage)} disabled={readOnly || !!editor}>新版本</button>
            {room.canApprove && <button className="pl-secondary" onClick={() => void toggleApproval(activePage)} disabled={busy}>{activePage.status === 'approved' ? '撤回审核' : '通过审核'}</button>}
            <button className="pl-secondary" onClick={() => void syncRoom()} disabled={readOnly || busy} title="与 Medusa 重新同步"><Icon name="refresh" size={15} /></button>
          </div>
        </header>
        <article className="pl-doc-content">
          <div className="pl-citations">{activePage.citations.map(citation => <span key={keyOf(citation.source, citation.field)} className={`pl-citation ${citation.status}`} title={citation.preview || ''}>{citation.label} · {citationStatusLabel[citation.status]}</span>)}</div>
          <div className="pl-doc-body">{activePage.body || '（空页面）'}</div>
          <section className="pl-doc-comments">
            <div className="pl-doc-comments-head"><h4>评论 {activePage.comments.length}</h4>{activePage.comments.length > 0 && <small>按时间顺序</small>}</div>
            {activePage.comments.map(item => <div className="pl-doc-comment" key={item.id}><span className="pl-comment-avatar">{initials(item.createdBy)}</span><div><strong>{item.createdBy}</strong><span>{formatDate(item.createdAt)}</span><p>{item.body}</p></div></div>)}
            {commentOpen && <div className="pl-comment-form"><textarea value={comment} onChange={event => setComment(event.target.value)} placeholder="写一条评论…" maxLength={4000} aria-label="评论内容" /><div><button className="pl-secondary" onClick={() => { setCommentOpen(false); setComment(''); }}>取消</button><button className="pl-primary" onClick={() => void submitComment(activePage)} disabled={busy || !comment.trim()}>提交评论</button></div></div>}
            {!commentOpen && <button className="pl-link" onClick={() => setCommentOpen(true)} disabled={readOnly}>添加评论</button>}
          </section>
        </article>
      </> : <div className="pl-doc-empty">
        <span className="pl-doc-empty-icon"><Icon name="file" size={26} /></span>
        <h2>{room.pin.product.title}</h2>
        <p>还没有页面。写第一份市场简报、上架说明或证据审阅。</p>
        <button className="pl-primary" onClick={startNewPage} disabled={readOnly}><Icon name="plus" size={15} />新建页面</button>
      </div>}
    </main>

    <aside className="pl-info">
      {room ? <>
        <section className="pl-info-card">
          <header><span>商品上下文</span><small>rev {room.pin.context.reviewVersion}</small></header>
          <div className="pl-info-field"><small>买家画像</small><p>{room.pin.context.buyerProfile || '未填写'}</p></div>
          <div className="pl-info-field"><small>目标市场</small><p>{room.pin.context.targetMarkets.join('、') || '未填写'}</p></div>
          <div className="pl-info-field"><small>使用场景</small><p>{room.pin.context.useCases.join('、') || '未填写'}</p></div>
          <div className="pl-info-field"><small>核心卖点</small><p>{room.pin.context.sellingPoints.join('、') || '未填写'}</p></div>
          <div className="pl-info-field"><small>商务条款</small><p>{policyText(room.pin.context.commercialPolicy)}</p></div>
          <div className="pl-info-evidence">{room.pin.context.evidence.length ? room.pin.context.evidence.map(item => <span key={item.id} className={`pl-evidence ${item.status}`}><Icon name="certificate" size={12} />{item.label}</span>) : <p>未填写证据</p>}</div>
        </section>
        <section className="pl-info-card">
          <header><span>来源</span><Icon name="shield" size={15} /></header>
          <div className="pl-info-row"><small>商品</small><code>{room.pin.product.id}</code></div>
          <div className="pl-info-row"><small>商品状态</small><span>{room.pin.product.status || 'draft'}</span></div>
          <div className="pl-info-row"><small>变体</small><span>{room.pin.product.variants.length}</span></div>
          <div className="pl-info-row"><small>同步</small><span>{formatDate(room.pin.pinnedAt)}</span></div>
          <p className="pl-hash">pin {room.pin.hash.slice(0, 22)}…</p>
        </section>
        <section className="pl-info-card">
          <header><span>附件</span><small>{room.documents.length}</small></header>
          {room.documents.map(document => <div className="pl-info-doc" key={document.id}>
            <span className="pl-doc-icon"><Icon name="file" size={16} /></span>
            <div><strong>{document.label}</strong><small>{formatBytes(document.size)} · {documentKindLabel(document.kind)}</small></div>
            <a href={document.downloadPath} aria-label={`下载 ${document.label}`}><Icon name="download" size={15} /></a>
          </div>)}
          {!room.documents.length && <p className="pl-info-empty">没有附件</p>}
          <button className="pl-secondary full" onClick={() => setUploadOpen(value => !value)} disabled={readOnly}><Icon name="upload" size={14} />上传附件</button>
          {uploadOpen && <div className="pl-upload">
            <label className="pl-file-drop">文件<input type="file" accept=".txt,.md,.csv,.json,.pdf,.png,.jpg,.jpeg,.webp" onChange={event => { setUploadFile(event.target.files?.[0] ?? null); setUploadLabel(event.target.files?.[0]?.name ?? ''); }} /><span>{uploadFile ? `${uploadFile.name} · ${formatBytes(uploadFile.size)}` : '选择文件（≤512 KiB）'}</span></label>
            <label>名称<input value={uploadLabel} onChange={event => setUploadLabel(event.target.value)} maxLength={240} /></label>
            <label>类型<select value={uploadKind} onChange={event => setUploadKind(event.target.value)}>{documentKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>关联证据<select value={uploadEvidence} onChange={event => setUploadEvidence(event.target.value)}><option value="">不关联</option>{room.pin.context.evidence.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <div className="pl-editor-actions"><button className="pl-secondary" onClick={() => setUploadOpen(false)}>取消</button><button className="pl-primary" onClick={() => void attachDocument()} disabled={busy || !uploadFile}>{busy ? '上传中…' : '上传并校验'}</button></div>
          </div>}
        </section>
      </> : <div className="pl-info-card"><header><span>说明</span></header><p className="pl-info-copy">选择商品后，这里会显示已审核的 Product Context、来源与附件。</p></div>}
    </aside>
  </div>;
}
