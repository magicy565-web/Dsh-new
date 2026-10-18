import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, requestId } from '../api';
import type { Session } from '../api';
import './space.css';
import { SpaceSources } from './SpaceSources';
import type { SpaceSource, SourceResolution } from './SpaceSources';

type Space = { id: string; name: string; revision: number };
type Share = { subject: string; role: 'viewer' | 'editor'; expiresAt: string | null };
type Node = { id: string; kind: 'page' | 'folder'; parentId: string | null; title: string; revision: number; version: number | null; archived: boolean };
type Detail = Space & { nodes: Node[]; canEdit: boolean; canShare: boolean; shares?: Share[] };
type Version = { version: number; title: string; content: string; createdBy: string; createdAt: string; sha256: string; restoredFrom: number | null; sources?: SpaceSource[] };
type Page = Node & { sourceResolution: SourceResolution[]; selected: Version; history: Omit<Version, 'content'>[]; comments: { id: string; version: number; body: string; createdBy: string }[] };
type Result = { operation: { replayed: boolean; receipt: { spaceId: string; entityId: string; operation: string } } };
type Pending = { path: string; body: Record<string, unknown>; after: (value: Result) => Promise<void> };
type ViewLoad = { epoch: number; id: number };
const endpoint = '/library/spaces';
const message = (error: unknown) => error instanceof Error ? error.message : '操作未完成。';
const bytes = (value: string) => new TextEncoder().encode(value).length;

/** Mount inside the ORIGINAL authenticated Library shell; no mock/demo mode. */
type PanelProps = { session: Session; onDirty?: (dirty: boolean) => void };
export function SpacePanel(props: PanelProps) {
  const { session } = props;
  return <SpaceContent key={JSON.stringify([session.workspaceId, session.user?.id, session.authenticated, session.expiresAt])} {...props} />;
}
function SpaceContent({ session, onDirty }: PanelProps) {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [space, setSpace] = useState<Detail | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [title, setTitle] = useState(''), [content, setContent] = useState('');
  const [sourceDraft, setSourceDraft] = useState<SpaceSource[]>([]);
  const [spaceName, setSpaceName] = useState(''), [newTitle, setNewTitle] = useState('');
  const [kind, setKind] = useState<'page' | 'folder'>('page'), [parentId, setParentId] = useState('');
  const [comment, setComment] = useState(''), [recipient, setRecipient] = useState('');
  const [shareRole, setShareRole] = useState<'viewer' | 'editor'>('viewer');
  const [shareExpiry, setShareExpiry] = useState(''), [moveTo, setMoveTo] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const pending = useRef<Pending | null>(null);
  const recoveryKey = `workspace-space-pending-v1:${JSON.stringify([session.workspaceId, session.user?.id])}`;
  const recoveryRequest = useRef<string | null>(null);
  function forgetRequest() { recoveryRequest.current = null; try { sessionStorage.removeItem(recoveryKey); } catch { /* Storage may be unavailable. No content is persisted. */ } }
  function rememberRequest(id: string) { recoveryRequest.current = id; try { sessionStorage.setItem(recoveryKey, id); } catch { /* Same-request reconciliation still works until refresh. */ } }
  const epoch = useRef(0), loadId = useRef(0), mounted = useRef(true);
  const spaceReadIds = useRef(new Map<string, number>());
  const activePage = useRef<{ id: string; version: number } | null>(null);
  activePage.current = page ? { id: page.id, version: page.selected.version } : null;
  const activeSpaceId = useRef<string | null>(null), reportedDirty = useRef<boolean | null>(null);
  activeSpaceId.current = space?.id ?? null;
  const tree = useMemo(() => {
    if (!space) return [] as { node: Node; depth: number }[];
    const ordered: { node: Node; depth: number }[] = [], visited = new Set<string>();
    const visit = (parentId: string | null, depth: number) => {
      for (const node of space.nodes.filter(node => node.parentId === parentId).sort((a, b) => a.title.localeCompare(b.title))) {
        if (visited.has(node.id) || depth > 20) continue;
        visited.add(node.id);
        if (showArchive || !node.archived) ordered.push({ node, depth });
        visit(node.id, depth + 1);
      }
    };
    visit(null, 0); return ordered;
  }, [space, showArchive]);
  const historical = !!page && page.selected.version !== page.version;
  const sourcesDirty = !!page && JSON.stringify(sourceDraft) !== JSON.stringify(page.selected.sources ?? []);
  const dirty = !!page && (title !== page.selected.title || content !== page.selected.content || sourcesDirty);
  const canWrite = session.mode === 'enterprise' && session.authenticated && !!session.user && ['admin', 'operator'].includes(session.user.role);
  useEffect(() => { const value = dirty || uncertain; if (reportedDirty.current !== value) { reportedDirty.current = value; onDirty?.(value); } }, [dirty, uncertain, onDirty]);
  function clearDenied(reason: unknown) {
    if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) {
      epoch.current++; loadId.current++; setBusy(false);
      setSpace(null); setPage(null); setSourceDraft([]); setTitle(''); setContent(''); setComment(''); setRecipient('');
      setSpaces([]); pending.current = null; forgetRequest(); setUncertain(false);
    }
  }
  const leaveDraft = () => !dirty || window.confirm('当前文字还未保存。放弃这些修改并切换吗？');
  const beginLoad = (): ViewLoad => ({ epoch: epoch.current, id: ++loadId.current });
  const isCurrentLoad = (load: ViewLoad) => mounted.current && load.epoch === epoch.current && load.id === loadId.current;
  function beginSpaceRead(id: string) {
    const ticket = (spaceReadIds.current.get(id) ?? 0) + 1;
    spaceReadIds.current.set(id, ticket);
    return () => spaceReadIds.current.get(id) === ticket;
  }
  function withCurrentPermissions(prior: Detail | null, value: Detail, isLatestRead: () => boolean): Detail {
    // A newer Space GET owns permissions; a directory refresh must not replace them.
    return isLatestRead() || prior?.id !== value.id ? value : { ...value, canEdit: prior.canEdit, canShare: prior.canShare };
  }

  async function loadSpaces() { const current = epoch.current; const value = await api<{ spaces: Space[] }>(endpoint); if (!mounted.current || current !== epoch.current) return; setSpaces(value.spaces); }
  async function openSpace(id: string, force = false) {
    if (!force && !leaveDraft()) return;
    const load = beginLoad(), isLatestRead = beginSpaceRead(id);
    setBusy(true); setError('');
    try {
      const result = await api<{ space: Detail }>(`${endpoint}/${id}`);
      if (!isCurrentLoad(load)) return;
      setSpace(prior => isCurrentLoad(load) ? withCurrentPermissions(prior, result.space, isLatestRead) : prior); setPage(null); setSourceDraft([]); setTitle(''); setContent(''); setParentId(''); setMoveTo('');
      return load;
    } catch (reason) { if (isCurrentLoad(load) && isLatestRead()) { clearDenied(reason); setError(message(reason)); } }
    finally { if (isCurrentLoad(load)) setBusy(false); }
  }
  async function refreshSpace(id: string) {
    if (id !== activeSpaceId.current) return;
    const load = beginLoad(), isLatestRead = beginSpaceRead(id);
    try {
      const result = await api<{ space: Detail }>(`${endpoint}/${id}`);
      if (!isCurrentLoad(load) || id !== activeSpaceId.current) return;
      setSpace(prior => isCurrentLoad(load) && id === activeSpaceId.current && prior?.id === id ? withCurrentPermissions(prior, result.space, isLatestRead) : prior);
      return load;
    } catch (reason) { if (isCurrentLoad(load) && id === activeSpaceId.current && isLatestRead()) throw reason; }
  }
  async function openPage(id: string, version?: number, force = false, inSpace = space?.id, continuation?: ViewLoad) {
    if (!inSpace || !force && !leaveDraft()) return;
    const load = continuation ?? beginLoad();
    if (!isCurrentLoad(load)) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ page: Page }>(`${endpoint}/${inSpace}/nodes/${id}${version ? `?version=${version}` : ''}`);
      if (!isCurrentLoad(load)) return;
      setPage(result.page); setSourceDraft(result.page.selected.sources ?? []); setTitle(result.page.selected.title); setContent(result.page.selected.content); setComment(''); setMoveTo(result.page.parentId ?? '');
    } catch (reason) { if (isCurrentLoad(load)) { clearDenied(reason); setError(message(reason)); } }
    finally { if (isCurrentLoad(load)) setBusy(false); }
  }
  useEffect(() => {
    mounted.current = true;
    const current = ++epoch.current;
    function clear() {
      epoch.current++; loadId.current++; pending.current = null; forgetRequest();
      setSpaces([]); setSpace(null); setPage(null); setSourceDraft([]); setTitle(''); setContent(''); setComment(''); setRecipient('');
      setBusy(false); setUncertain(false); setMoveTo(''); setShareExpiry(''); setError('会话已失效，请重新登录。未保存的私有内容不会留在浏览器存储中。');
    }
    window.addEventListener('workspace-session-required', clear);
    if (session.mode === 'enterprise' && session.authenticated) {
      try {
        const id = sessionStorage.getItem(recoveryKey);
        if (id && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(id)) { recoveryRequest.current = id; setUncertain(true); setError('上次提交的结果尚待核对。请核对同一请求后继续。'); }
      } catch { /* No private page content is stored. */ }
      setBusy(true);
      api<{ spaces: Space[] }>(endpoint).then(value => { if (mounted.current && current === epoch.current) setSpaces(value.spaces); })
        .catch(reason => { if (mounted.current && current === epoch.current) setError(reason instanceof ApiError && reason.status === 404 ? 'Space 页面接口尚未接入当前 Host；没有使用本地演示数据。' : message(reason)); })
        .finally(() => { if (mounted.current && current === epoch.current) setBusy(false); });
    }
    return () => { mounted.current = false; epoch.current++; loadId.current++; pending.current = null; window.removeEventListener('workspace-session-required', clear); };
  }, [session.workspaceId, session.user?.id, session.authenticated, session.mode]);


  // Original Host emits invalidations when any Store state changes. Revalidate
  // membership without copying page content into browser storage. No claim of
  // instantaneous revocation: the server always checks permissions again.
  useEffect(() => {
    if (session.mode !== 'enterprise' || !session.authenticated) return;
    let closed = false, serial = 0;
    let timer: number | undefined;
    async function verifyVisibleSpace() {
      const id = activeSpaceId.current, ticket = ++serial;
      if (!id) return;
      const load = { epoch: epoch.current, id: loadId.current }, isLatestRead = beginSpaceRead(id);
      const isCurrent = () => !closed && ticket === serial && id === activeSpaceId.current
        && isCurrentLoad(load) && isLatestRead();
      try {
        const value = await api<{ space: Detail }>(`${endpoint}/${id}`);
        if (!isCurrent()) return;
        setSpace(prior => isCurrent() && prior?.id === id ? { ...prior, canEdit: value.space.canEdit, canShare: value.space.canShare } : prior);
        const selected = activePage.current;
        if (selected && isCurrent()) {
          const result = await api<{ page: Page }>(`${endpoint}/${id}/nodes/${selected.id}?version=${selected.version}`);
          if (isCurrent()) setPage(prior => isCurrent() && prior?.id === selected.id && prior.selected.version === selected.version ? { ...prior, sourceResolution: result.page.sourceResolution } : prior);
        }
      }
      catch (reason) {
        if (!isCurrent()) return;
        if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) {
          clearDenied(reason);
          setError('Space 访问权限已变化，已清除当前私有内容。请重新核对企业会话。');
        }
      }
    }
    function scheduleCheck() {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => { void verifyVisibleSpace(); }, 250);
    }
    function visible() { if (document.visibilityState === 'visible') scheduleCheck(); }
    const source = typeof EventSource !== 'undefined' ? new EventSource('/api/events') : null;
    source?.addEventListener('change', scheduleCheck);
    window.addEventListener('focus', scheduleCheck);
    document.addEventListener('visibilitychange', visible);
    return () => {
      closed = true; if (timer !== undefined) window.clearTimeout(timer);
      source?.removeEventListener('change', scheduleCheck); source?.close();
      window.removeEventListener('focus', scheduleCheck);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [session.workspaceId, session.user?.id, session.authenticated, session.mode]);

  async function perform(command: Pending) {
    const current = epoch.current;
    setBusy(true); setError(''); setNotice(''); pending.current = command; rememberRequest(String(command.body.requestId));
    let committed = false;
    try {
      const result = await api<Result>(command.path, 'POST', command.body);
      if (!mounted.current || current !== epoch.current) return;
      committed = true; pending.current = null; forgetRequest(); setUncertain(false);
      await command.after(result);
      if (current === epoch.current) setNotice(result.operation.replayed ? '已核对同一请求，未重复提交。' : '已保存。');
    } catch (reason) {
      if (!mounted.current || current !== epoch.current) return;
      clearDenied(reason);
      const knownRefusal = reason instanceof ApiError && reason.status >= 400 && reason.status < 500 && reason.code !== 'SPACE_RESPONSE_CHANGED';
      const unknown = !committed && !knownRefusal;
      if (!unknown) { pending.current = null; forgetRequest(); }
      setUncertain(unknown);
      setError(committed ? `保存已确认，但页面刷新失败：${message(reason)}` : unknown ? '提交结果尚未确认。请使用“核对同一请求”，不要创建新请求；输入已保留。' : message(reason));
    } finally { if (mounted.current && current === epoch.current) setBusy(false); }
  }
  async function reconcileAfterRefresh() {
    const id = recoveryRequest.current; if (!id || busy) return;
    const current = epoch.current; setBusy(true); setError('');
    try {
      const result = await api<Result>(`${endpoint}/operations/${id}`);
      if (!mounted.current || current !== epoch.current) return;
      forgetRequest(); pending.current = null; setUncertain(false);
      await loadSpaces(); const load = await openSpace(result.operation.receipt.spaceId, true);
      const receipt = result.operation.receipt;
      if (load && receipt.entityId !== receipt.spaceId && receipt.operation !== 'createNode') await openPage(receipt.entityId, undefined, true, receipt.spaceId, load);
      if (current === epoch.current) setNotice('已找到上次提交的回执，未重复写入。请从已保存内容继续。');
    } catch (reason) {
      if (mounted.current && current === epoch.current) {
        if (!(reason instanceof ApiError && reason.code === 'SPACE_OPERATION_PENDING')) clearDenied(reason);
        setError(reason instanceof ApiError && reason.code === 'SPACE_OPERATION_PENDING' ? '尚未查到已提交回执，原请求可能仍在处理中。请稍后继续核对。' : message(reason));
      }
    } finally { if (current === epoch.current) setBusy(false); }
  }
  function send(path: string, body: Record<string, unknown>, after: Pending['after']) {
    if (busy || pending.current || recoveryRequest.current) return;
    void perform({ path, body: { requestId: requestId(), ...body }, after });
  }
  async function reloadPage() { if (space && page) { const load = await refreshSpace(space.id); if (load) await openPage(page.id, undefined, true, space.id, load); } }

  if (session.mode !== 'enterprise' || !session.authenticated) return <section className="space-panel"><h2>Space 页面</h2><p>请通过原企业登录入口进入。此功能不提供绕过权限的本地演示模式。</p></section>;
  return <section className="space-panel" aria-label="企业 Space 页面">
    <header className="space-heading"><div><p className="space-label">企业知识与协作</p><h2>Space</h2><p>把方案、工作记录和团队讨论留在同一个地方。</p></div><span className="space-private">仅受邀成员</span></header>
    <div className="space-feedback" aria-live="polite">{error && <p role="alert">{error}</p>}{notice && <p>{notice}</p>}{busy && <p role="status">正在处理…</p>}{uncertain && <button type="button" disabled={busy} onClick={() => pending.current ? void perform(pending.current) : void reconcileAfterRefresh()}>核对同一请求</button>}</div>
    <fieldset disabled={busy || uncertain} className="space-workspace">
      <legend className="space-sr">Space 操作</legend>
      <label>选择 Space<select value={space?.id ?? ''} onChange={event => event.target.value && void openSpace(event.target.value)}><option value="">请选择</option>{spaces.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      {canWrite && <details><summary>新建 Space</summary><form onSubmit={event => { event.preventDefault(); if (!leaveDraft()) return; send(endpoint, { name: spaceName.trim() }, async result => { setSpaceName(''); await loadSpaces(); await openSpace(result.operation.receipt.spaceId, true); }); }}><label>Space 名称<input required value={spaceName} onChange={event => setSpaceName(event.target.value)} maxLength={200} /></label><button disabled={!spaceName.trim() || bytes(spaceName) > 200}>创建 Space</button></form></details>}
      {!spaces.length && !busy && !error && <p className="space-empty">还没有可访问的 Space。创建一个，或请同事邀请你。</p>}
      {space && <>
        <div className="space-section-title"><h3>{space.name}</h3><button type="button" onClick={() => void openSpace(space.id)}>刷新目录</button></div>
        <label className="space-checkbox"><input type="checkbox" checked={showArchive} onChange={event => setShowArchive(event.target.checked)} />显示已归档内容</label>
        <nav aria-label="页面和文件夹" className="space-node-list">{tree.map(({ node, depth }) => <div className="space-node-row" key={node.id}><button type="button" style={{ paddingInlineStart: `${14 + depth * 14}px` }} aria-current={page?.id === node.id ? 'page' : undefined} onClick={() => node.kind === 'page' ? void openPage(node.id) : setParentId(node.id)}><span>{node.kind === 'folder' ? '文件夹' : '页面'}</span><strong>{node.title}</strong>{node.archived && <small>已归档</small>}</button>{space.canEdit && <button type="button" aria-label={`${node.archived ? '恢复' : '归档'} ${node.title}`} onClick={() => { if (window.confirm(`确定${node.archived ? '恢复' : '归档'}“${node.title}”？`)) send(`${endpoint}/${space.id}/nodes/${node.id}/archive`, { expectedRevision: node.revision, archived: !node.archived }, async () => { const load = await refreshSpace(space.id); if (load && page?.id === node.id) await openPage(node.id, undefined, true, space.id, load); }); }}>{node.archived ? '恢复' : '归档'}</button>}</div>)}</nav>
        {space.canEdit && <details><summary>添加页面或文件夹</summary><form onSubmit={event => { event.preventDefault(); if (!leaveDraft()) return; send(`${endpoint}/${space.id}/nodes`, { kind, parentId: parentId || null, title: newTitle.trim(), ...(kind === 'page' ? { content: '' } : {}) }, async result => { setNewTitle(''); const load = await refreshSpace(space.id); if (load && kind === 'page') await openPage(result.operation.receipt.entityId, undefined, true, space.id, load); }); }}><div className="space-form-row"><label>类型<select value={kind} onChange={event => setKind(event.target.value as 'page' | 'folder')}><option value="page">页面</option><option value="folder">文件夹</option></select></label><label>放在<select value={parentId} onChange={event => setParentId(event.target.value)}><option value="">Space 根目录</option>{tree.filter(({ node }) => node.kind === 'folder' && !node.archived).map(({ node, depth }) => <option key={node.id} value={node.id}>{'　'.repeat(depth)}{node.title}</option>)}</select></label></div><label>标题<input required value={newTitle} onChange={event => setNewTitle(event.target.value)} /></label><button disabled={!newTitle.trim() || bytes(newTitle) > 200}>添加</button></form></details>}
        {page && <article className="space-editor" aria-label="页面编辑器"><div className="space-section-title"><h3>{historical ? `历史版本 ${page.selected.version}` : '编辑页面'}</h3><span>{dirty ? '有未保存修改' : `已保存 · v${page.selected.version}`}</span></div>
          <label>标题<input value={title} disabled={!space.canEdit || historical || page.archived} onChange={event => setTitle(event.target.value)} /></label>
          <label>正文<textarea rows={14} value={content} disabled={!space.canEdit || historical || page.archived} onChange={event => setContent(event.target.value)} spellCheck /></label>
          <p className="space-hint">纯文本 / Markdown 源文。不会执行 HTML；不会自动把页面发给模型或第三方。</p>
          {space.canEdit && !historical && !page.archived && <div className="space-actions"><button type="button" className="space-primary" disabled={!dirty || !title.trim() || bytes(title) > 200 || bytes(content) > 65536} onClick={() => send(`${endpoint}/${space.id}/nodes/${page.id}/save`, { expectedRevision: page.revision, title, content, ...(sourcesDirty ? { sources: sourceDraft } : {}) }, reloadPage)}>保存修改</button><button type="button" onClick={() => { if (leaveDraft()) void openPage(page.id, undefined, true); }}>重新读取已保存版本</button></div>}
          <SpaceSources key={`${space.id}:${page.id}:${page.selected.version}`} spaceId={space.id} selected={sourceDraft} resolution={page.sourceResolution ?? []} editable={space.canEdit && !historical && !page.archived} onChange={setSourceDraft} onDenied={clearDenied} beforeNavigate={leaveDraft} />
          {space.canEdit && !page.archived && <details><summary>移动页面</summary><label>移到文件夹<select value={moveTo} onChange={event => setMoveTo(event.target.value)}><option value="">Space 根目录</option>{tree.filter(({ node }) => node.kind === 'folder' && !node.archived).map(({ node, depth }) => <option key={node.id} value={node.id}>{'　'.repeat(depth)}{node.title}</option>)}</select></label><button type="button" disabled={moveTo === (page.parentId ?? '') || dirty} onClick={() => send(`${endpoint}/${space.id}/nodes/${page.id}/move`, { expectedRevision: page.revision, parentId: moveTo || null }, reloadPage)}>保存位置</button></details>}
          <details><summary>历史版本 · {page.history.length}</summary><ol className="space-history">{[...page.history].reverse().map(version => <li key={version.version}><button type="button" onClick={() => void openPage(page.id, version.version)}>v{version.version} · {version.title}</button><small>{version.createdBy} · {new Date(version.createdAt).toLocaleString()}</small></li>)}</ol></details>
          {historical && space.canEdit && !page.archived && <button type="button" onClick={() => { if (window.confirm('把此历史内容保存为一个新版本？不会删除已有历史。')) send(`${endpoint}/${space.id}/nodes/${page.id}/restore`, { expectedRevision: page.revision, version: page.selected.version }, reloadPage); }}>恢复此内容为新版本</button>}
          <section aria-label="页面评论"><h4>讨论</h4>{page.comments.length ? page.comments.map(item => <blockquote key={item.id}><p>{item.body}</p><footer>{item.createdBy} · 针对 v{item.version}</footer></blockquote>) : <p className="space-hint">还没有评论。</p>}{space.canEdit && !page.archived && <form onSubmit={event => { event.preventDefault(); send(`${endpoint}/${space.id}/nodes/${page.id}/comments`, { expectedRevision: page.revision, version: page.selected.version, body: comment }, async () => { setComment(''); await reloadPage(); }); }}><label>针对当前所看版本的评论<textarea rows={3} value={comment} onChange={event => setComment(event.target.value)} /></label><button disabled={!comment.trim() || bytes(comment) > 4000 || dirty}>添加评论</button></form>}</section>
        </article>}
        {space.canShare && <details className="space-sharing"><summary>成员与分享</summary><p className="space-hint">邀请会共享整个 Space，包括所有页面历史和评论；不会授予外部资料或第三方 Agent 权限。</p>{space.shares?.map(share => <div className="space-share-row" key={share.subject}><span>{share.subject} · {share.role === 'editor' ? '可编辑' : '只读'}{share.expiresAt ? ` · 截止 ${new Date(share.expiresAt).toLocaleString()}` : ''}</span><button type="button" onClick={() => { if (window.confirm(`撤销 ${share.subject} 的 Space 访问权？`)) send(`${endpoint}/${space.id}/revoke`, { expectedRevision: space.revision, subject: share.subject }, async () => { await refreshSpace(space.id); }); }}>撤销</button></div>)}<form onSubmit={event => { event.preventDefault(); send(`${endpoint}/${space.id}/share`, { expectedRevision: space.revision, subject: recipient.trim(), role: shareRole, expiresAt: shareExpiry ? new Date(shareExpiry).toISOString() : null }, async () => { setRecipient(''); setShareExpiry(''); await refreshSpace(space.id); }); }}><label>现有企业成员的准确账号<input required value={recipient} onChange={event => setRecipient(event.target.value)} autoComplete="off" /></label><label>访问权限<select value={shareRole} onChange={event => setShareRole(event.target.value as 'viewer' | 'editor')}><option value="viewer">只读</option><option value="editor">可编辑</option></select></label><label>分享截止时间（可选）<input type="datetime-local" value={shareExpiry} onChange={event => setShareExpiry(event.target.value)} /></label><button disabled={!recipient.trim() || !!shareExpiry && (!Number.isFinite(Date.parse(shareExpiry)) || Date.parse(shareExpiry) <= Date.now())}>确认分享整个 Space</button></form></details>}
      </>}
    </fieldset>
  </section>;
}
