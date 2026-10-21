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
type Pin = {
  product: { id: string; title: string; subtitle: string | null; handle: string | null; description: string | null; status: string | null; variants: { id: string; title: string | null; sku: string | null }[] };
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
const citationStatusLabel = { current: '当前', stale: '已过期', missing: '缺失' } as const;
const documentKinds = [['spec_sheet', '规格书'], ['certificate', '证书'], ['test_report', '检测报告'], ['case_study', '案例'], ['other', '其他']] as const;

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

export function ProductLibrary({ readOnly }: { readOnly: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [payload, setPayload] = useState<ListPayload | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [roomLoading, setRoomLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
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
      const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}&limit=50` : '?limit=50';
      Promise.all([api<Status>('/product-library/status'), api<ListPayload>(`/product-library/products${suffix}`)])
        .then(([nextStatus, nextPayload]) => {
          if (!active) return;
          setStatus(nextStatus); setPayload(nextPayload);
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
    setRoom(null); setEditor(null); setComment(null); setUploadOpen(false);
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

  return <div className="pl-page">
    <header className="pl-heading">
      <div>
        <span className="ys-eyebrow"><i aria-hidden="true" />Medusa · 已审核上下文</span>
        <h2>产品资料库</h2>
        <p>每件商品一间资料空间：只引用已审核的 Product Context，页面和附件都带版本与来源。</p>
      </div>
      <div className="pl-status">
        <span className={status?.configured ? 'pl-dot on' : 'pl-dot'} />
        <span>{status ? status.configured ? 'Medusa 已连接' : 'Medusa 未配置' : '读取中…'}</span>
        {status && <small>{status.rooms} 间 / {status.pages} 页 / {status.approvedPages} 已通过</small>}
      </div>
    </header>

    {error && <div className="pl-error" role="alert"><Icon name="warning" size={16} />{error}<button onClick={() => setError('')} aria-label="关闭错误"><Icon name="close" size={14} /></button></div>}
    {notice && <div className="pl-notice" role="status"><Icon name="check" size={16} />{notice}</div>}
    {payload?.source.warning === 'PRODUCT_LIBRARY_SOURCE_UNCONFIGURED' && <div className="pl-warning" role="status"><Icon name="info" size={16} />产品资料库还没有连接 Medusa：只显示已打开的资料空间。</div>}

    <div className="pl-toolbar">
      <div className="pl-search"><Icon name="search" size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索已审核商品…" aria-label="搜索产品资料库" /></div>
      <button className="pl-secondary" onClick={refresh} disabled={loading || busy}><Icon name="refresh" size={15} />刷新</button>
    </div>

    {loading && !payload ? <p className="pl-empty" role="status">正在读取 Medusa 与产品资料库…</p> : !payload?.items.length ? <div className="pl-empty-block"><Icon name="box" size={30} /><h3>还没有已审核的商品</h3><p>在 Medusa 后台为商品建立并审核 Product Context 后，这里会出现可用的资料空间。</p></div> : <div className="pl-layout">
      <aside className="pl-list" aria-label="已审核商品">
        {payload.items.map(item => <button key={item.productId} className={`pl-item ${item.productId === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(item.productId)}>
          <span className="pl-item-top"><strong>{item.title}</strong>{item.inLibrary ? <em className="pl-badge ready">已建空间</em> : <em className="pl-badge">未打开</em>}</span>
          <span className="pl-item-meta">{item.status || 'draft'} · {item.variantCount} 个变体</span>
          <span className="pl-item-stats"><span>就绪度 {item.readinessScore}</span><span>rev {item.reviewVersion}</span><span>{item.pageCount} 页 / {item.documentCount} 附件</span></span>
        </button>)}
      </aside>

      <section className="pl-detail" aria-live="polite">
        {roomLoading && <p className="pl-empty">正在打开资料空间…</p>}
        {!roomLoading && !room && selectedRow && <div className="pl-empty-block">
          <Icon name="library" size={30} />
          <h3>{selectedRow.title}</h3>
          <p>该商品已有已审核的 Product Context，但还没有建立资料空间。打开后即可写页面、评论和上传证据附件。</p>
          <button className="pl-primary" onClick={() => void openRoom()} disabled={readOnly || busy}>{busy ? '打开中…' : '打开资料空间'}</button>
        </div>}
        {!roomLoading && room && <>
          <div className="pl-room-head">
            <div>
              <span className="pl-kicker">PRODUCT ROOM</span>
              <h3>{room.pin.product.title}</h3>
              <p>{room.pin.product.description || '暂无商品描述。'}</p>
            </div>
            <div className="pl-room-actions">
              <span className="pl-chip">就绪度 {room.pin.context.readinessScore}</span>
              <span className="pl-chip">rev {room.pin.context.reviewVersion}</span>
              <button className="pl-secondary" onClick={() => void syncRoom()} disabled={readOnly || busy}><Icon name="refresh" size={15} />同步 Medusa</button>
              <button className="pl-primary" onClick={startNewPage} disabled={readOnly || !!editor}><Icon name="plus" size={15} />新建页面</button>
            </div>
          </div>
          <p className="pl-pin">pin {room.pin.hash.slice(0, 16)}… · {new Date(room.pin.pinnedAt).toLocaleString('zh-CN')} · 商品 {room.pin.product.id}</p>

          <section className="pl-context">
            <h4>已审核 Product Context</h4>
            <dl>
              <div><dt>买家画像</dt><dd>{room.pin.context.buyerProfile || '未填写'}</dd></div>
              <div><dt>目标市场</dt><dd>{room.pin.context.targetMarkets.join('、') || '未填写'}</dd></div>
              <div><dt>使用场景</dt><dd>{room.pin.context.useCases.join('、') || '未填写'}</dd></div>
              <div><dt>卖点</dt><dd>{room.pin.context.sellingPoints.join('、') || '未填写'}</dd></div>
              <div><dt>商务条款</dt><dd>{room.pin.context.commercialPolicy ? Object.entries(room.pin.context.commercialPolicy).map(([key, value]) => `${key}: ${value}`).join(' · ') : '未填写'}</dd></div>
              <div><dt>证据</dt><dd>{room.pin.context.evidence.length ? room.pin.context.evidence.map(item => `${item.label}（${item.status}）`).join('；') : '未填写'}</dd></div>
            </dl>
          </section>

          <section className="pl-section">
            <div className="pl-section-head"><h4>页面 {counts ? `(${counts.pages}/${counts.approved} 已通过)` : ''}</h4></div>
            {!room.pages.length && <p className="pl-empty">还没有页面。写第一份市场简报或上架说明。</p>}
            {room.pages.map(page => <article className="pl-card" key={page.id}>
              <header>
                <div><strong>{page.title}</strong><span className={`pl-badge ${page.status === 'approved' ? 'ready' : ''}`}>{page.status === 'approved' ? '已通过' : '草稿'}</span></div>
                <small>v{page.version} · rev {page.revision} · {new Date(page.updatedAt).toLocaleString('zh-CN')}</small>
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
              {!!page.comments.length && <ul className="pl-comments">{page.comments.map(item => <li key={item.id}><span>{item.createdBy}</span>{item.body}<small>{new Date(item.createdAt).toLocaleString('zh-CN')}</small></li>)}</ul>}
              {comment?.pageId === page.id && <div className="pl-comment-form">
                <textarea value={comment.body} onChange={event => setComment({ pageId: page.id, body: event.target.value })} placeholder="写一条评论…" maxLength={4000} aria-label="评论内容" />
                <div><button className="pl-secondary" onClick={() => setComment(null)}>取消</button><button className="pl-primary" onClick={() => void submitComment(page)} disabled={busy || !comment.body.trim()}>提交评论</button></div>
              </div>}
            </article>)}
          </section>

          {editor && <section className="pl-editor">
            <div className="pl-section-head"><h4>{editor.mode === 'new' ? '新建页面' : '保存新版本'}</h4><button className="pl-link" onClick={() => setEditor(null)}>取消</button></div>
            {editor.mode === 'edit' && <p className="pl-hint">编辑已通过的页面会撤回审核，需要重新通过。</p>}
            <label>标题<input value={editor.title} onChange={event => setEditor({ ...editor, title: event.target.value })} maxLength={200} /></label>
            <label>正文<textarea value={editor.body} onChange={event => setEditor({ ...editor, body: event.target.value })} maxLength={65536} rows={8} placeholder="写清市场判断、证据与下一步…" /></label>
            <fieldset><legend>引用来源（保存时服务端会固定 value hash）</legend>
              {options.map(option => <label className="pl-check" key={option.key}><input type="checkbox" checked={editor.selected.includes(option.key)} onChange={event => setEditor({ ...editor, selected: event.target.checked ? [...editor.selected, option.key] : editor.selected.filter(key => key !== option.key) })} />{option.label}</label>)}
            </fieldset>
            <div className="pl-editor-actions"><button className="pl-secondary" onClick={() => setEditor(null)}>取消</button><button className="pl-primary" onClick={() => void saveEditor()} disabled={busy || !editor.title.trim()}>{busy ? '保存中…' : '保存页面'}</button></div>
          </section>}

          <section className="pl-section">
            <div className="pl-section-head"><h4>附件 {counts ? `(${counts.documents})` : ''}</h4><button className="pl-secondary" onClick={() => setUploadOpen(value => !value)} disabled={readOnly}><Icon name="upload" size={15} />上传附件</button></div>
            {!room.documents.length && !uploadOpen && <p className="pl-empty">没有附件。可上传 PDF、图片、CSV、Markdown 或文本（≤512 KiB）。</p>}
            {!!room.documents.length && <div className="pl-docs">{room.documents.map(document => <div className="pl-doc" key={document.id}>
              <Icon name="file" size={20} />
              <div><strong>{document.label}</strong><small>{document.filename} · {formatBytes(document.size)} · {document.kind}{document.evidenceId ? ` · ${document.evidenceId}` : ''}</small><code>{document.sha256.slice(0, 20)}…</code></div>
              <a className="pl-icon-button" href={document.downloadPath} aria-label={`下载 ${document.label}`}><Icon name="download" size={17} /></a>
            </div>)}</div>}
            {uploadOpen && <div className="pl-upload">
              <label>文件<input type="file" accept=".txt,.md,.csv,.json,.pdf,.png,.jpg,.jpeg,.webp" onChange={event => { setUploadFile(event.target.files?.[0] ?? null); setUploadLabel(event.target.files?.[0]?.name ?? ''); }} /></label>
              <label>名称<input value={uploadLabel} onChange={event => setUploadLabel(event.target.value)} maxLength={240} /></label>
              <label>类型<select value={uploadKind} onChange={event => setUploadKind(event.target.value)}>{documentKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>关联证据<select value={uploadEvidence} onChange={event => setUploadEvidence(event.target.value)}><option value="">不关联</option>{room.pin.context.evidence.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
              <div className="pl-editor-actions"><button className="pl-secondary" onClick={() => setUploadOpen(false)}>取消</button><button className="pl-primary" onClick={() => void attachDocument()} disabled={busy || !uploadFile}>{busy ? '上传中…' : '上传并校验'}</button></div>
            </div>}
          </section>
        </>}
      </section>
    </div>}
  </div>;
}
