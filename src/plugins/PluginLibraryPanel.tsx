import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, requestId } from '../api';
import type { Session } from '../api';
import { parsePluginLibraryView, parsePluginReceipt, pluginStatusText } from './contracts';
import type { PluginLibraryView, PluginPackage, PluginRelease } from './contracts';
import './plugin-library.css';

type Review = { path: string; body: Record<string, unknown>; title: string; detail: string; needsNote?: boolean };
const rejectedBeforeCommit = new Set(['PLUGIN_LIBRARY_INVALID_REQUEST', 'PLUGIN_LIBRARY_ROLE_REQUIRED', 'PLUGIN_LIBRARY_SIGNED_ADMIN_REQUIRED', 'PLUGIN_CONTROL_NOT_CONFIGURED', 'PLUGIN_CONTROL_STALE', 'PLUGIN_RELEASE_VERIFICATION_FAILED', 'PLUGIN_RELEASE_VERSION_IMMUTABLE', 'PLUGIN_RELEASE_INDEPENDENT_REVIEW_REQUIRED', 'PLUGIN_RELEASE_APPROVAL_REQUIRED', 'PLUGIN_RELEASE_STATE_CONFLICT', 'PLUGIN_RELEASE_CHANGED', 'PLUGIN_INVENTORY_CHANGED']);
const describeError = (error: unknown) => error instanceof ApiError && error.status === 404 ? '当前服务未启用插件管理接口。请核对该版本的部署与配置；未使用示例清单代替。' : error instanceof Error ? error.message : '操作未确认，请核对服务状态。';
const profileLabel = (name: string) => name === 'config.json' ? '默认本地工具' : name === 'config.business.json' ? '经营工具组合' : name;

// The key discards old workspace/user state rather than rendering it for a new identity.
export function PluginLibraryPanel({ session, snapshotStale }: { session: Session; snapshotStale: boolean }) {
  return <PluginLibraryContent key={`${session.workspaceId}:${session.user?.id || ''}:${session.expiresAt || ''}`} session={session} snapshotStale={snapshotStale} />;
}
function PluginLibraryContent({ session, snapshotStale }: { session: Session; snapshotStale: boolean }) {
  const allowed = session.authenticated && ['admin', 'operator'].includes(session.user?.role || '');
  const owner = session.authenticated && session.mode === 'enterprise' && session.user?.role === 'admin';
  const storageKey = `workspace-plugin-request:${encodeURIComponent(session.workspaceId)}:${encodeURIComponent(session.user?.id || '')}`;
  const [view, setView] = useState<PluginLibraryView | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'packages' | 'releases' | 'requests'>('packages');
  const [query, setQuery] = useState('');
  const [profile, setProfile] = useState('config.json');
  const [envelope, setEnvelope] = useState('');
  const [publishedManifest, setPublishedManifest] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(() => {
    try { const value = sessionStorage.getItem(storageKey); return value && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value) ? value : null; } catch { return null; }
  });
  const generation = useRef(0), mounted = useRef(true), mutation = useRef(false);
  const ready = !!view && !loading && !stale && !snapshotStale;
  const canChange = ready && owner && !busy && !pending && view.capabilities.changeRequests;
  const load = useCallback(async () => {
    const ticket = ++generation.current;
    setLoading(true); setStale(true); setError('');
    if (!allowed) { setView(null); setLoading(false); return; }
    try {
      const result = parsePluginLibraryView(await api<unknown>('/plugin-library'), session.workspaceId);
      if (!mounted.current || ticket !== generation.current) return;
      setView(result); setStale(false);
      setProfile(current => result.inventory.profiles.some(item => item.configuration === current) ? current : result.inventory.profiles[0]?.configuration || 'config.json');
    } catch (cause) { if (mounted.current && ticket === generation.current) { setError(describeError(cause)); setStale(true); } }
    finally { if (mounted.current && ticket === generation.current) setLoading(false); }
  }, [allowed, session.workspaceId]);
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; generation.current++; }; }, [load]);
  function rememberPending(id: string | null) {
    // Only an opaque request ID is retained. No package code, review body,
    // enterprise data, tokens or publisher keys are written to browser storage.
    if (id) sessionStorage.setItem(storageKey, id); else sessionStorage.removeItem(storageKey);
    setPending(id);
  }
  function stage(value: Review) { setReview(value); setNote(''); setConfirmed(false); setError(''); }
  function changePlugin(item: PluginPackage, action: 'enable-tools' | 'disable-tools') {
    if (!canChange || !view) return;
    stage({ path: '/plugin-library/requests', title: `${action === 'enable-tools' ? '启用' : '停用'}工具：${item.title}`,
      detail: `配置：${profileLabel(profile)}。本次只提交工具选择申请，需管理员停机应用；不会安装代码、停止业务后端、删除资料或更改已有会话权限。包 SHA-256：${item.packageSha256}`,
      body: { expectedRevision: view.revision, action, pluginId: item.id, inventorySha256: view.inventory.snapshotSha256, packageSha256: item.packageSha256, configuration: profile } });
  }
  function importRelease() {
    if (!canChange || !view?.capabilities.publicationReview) return;
    try {
      if (!envelope.trim() || envelope.length > 32768) throw new Error('请粘贴不超过 32 KB 的签名发布清单。不要粘贴密钥或企业资料。');
      const parsed: unknown = JSON.parse(envelope);
      stage({ path: '/plugin-library/releases/import', title: '提交签名发布清单', detail: '服务端将核对固定发布者、公钥、版本与签名。提交后仍需另一位管理员独立审核；此步骤不会下载镜像或执行代码。', body: { expectedRevision: view.revision, envelope: parsed } });
    } catch (cause) { setError(describeError(cause)); }
  }
  function releaseAction(item: PluginRelease, action: 'review' | 'publish' | 'suspend', decision?: 'approve' | 'reject') {
    if (!canChange || !view) return;
    stage({ path: `/plugin-library/releases/${item.id}/${action}`, title: `${action === 'review' ? decision === 'approve' ? '批准审核' : '拒绝审核' : action === 'publish' ? '发布清单' : '下架清单'}：${item.name} ${item.version}`,
      detail: `发布者：${item.publisher}。指纹：${item.fingerprint}。审核与发布只管理此份不可变清单，不证明镜像已安全验收，不授予企业资料访问。`,
      needsNote: action !== 'publish', body: { expectedRevision: view.revision, fingerprint: item.fingerprint, ...(decision ? { decision } : {}) } });
  }
  async function sendReview() {
    if (!review || !canChange || !confirmed || review.body.expectedRevision !== view?.revision || review.needsNote && !note.trim() || mutation.current) return;
    const staged = review, id = requestId();
    mutation.current = true; setBusy(true); setError(''); setNotice('');
    let sent = false;
    try {
      // Persist ID before sending. If browser storage is unavailable, do not
      // launch a mutation whose exact identity would be lost on reload.
      rememberPending(id);
      sent = true;
      const result = await api<unknown>(staged.path, 'POST', { ...staged.body, ...(staged.needsNote ? { note: note.trim() } : {}), requestId: id });
      parsePluginReceipt(result);
      if (!mounted.current) return;
      rememberPending(null); setReview(null); setConfirmed(false); setEnvelope('');
      setNotice('已收到原请求回执。请以下方刷新后的状态为准；未自动执行插件或更改业务授权。');
      await load();
    } catch (cause) {
      if (!mounted.current) return;
      if (!sent) setError('浏览器无法保存请求编号，操作未发送。请恢复站点会话存储后重试。');
      else if (cause instanceof ApiError && rejectedBeforeCommit.has(cause.code || '')) {
        try { rememberPending(null); } catch { /* Keep ID visible when cleanup fails. */ }
        setReview(null); setError(`${cause.message} 请刷新并重新审阅。`); setStale(true);
      } else { setReview(null); setError('结果尚未确认。请使用原请求编号核对回执，不要重新创建相同操作。'); setStale(true); }
    } finally { mutation.current = false; if (mounted.current) setBusy(false); }
  }
  async function reconcile() {
    if (!pending || busy || !allowed) return;
    setBusy(true); setError('');
    try {
      parsePluginReceipt(await api<unknown>(`/plugin-library/requests/${encodeURIComponent(pending)}`));
      if (!mounted.current) return;
      rememberPending(null); setNotice('已查到原请求回执。未重复提交操作。'); await load();
    } catch (cause) { if (mounted.current) setError(cause instanceof ApiError && cause.status === 404 ? '暂未查到原请求回执。这不能证明请求没有提交；请保留编号，由管理员检查控制记录。' : describeError(cause)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function inspectManifest(item: PluginRelease) {
    if (!ready || busy) return;
    setBusy(true); setError('');
    try {
      const result = await api<unknown>(`/plugin-library/releases/${item.id}/manifest`);
      if (mounted.current) setPublishedManifest(JSON.stringify(result, null, 2));
    } catch (cause) { if (mounted.current) setError(describeError(cause)); }
    finally { if (mounted.current) setBusy(false); }
  }
  const visible = view?.inventory.packages.filter(item => `${item.title} ${item.name} ${item.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) || [];
  return <section className="plugin-library" aria-label="插件库管理">
    <header className="plugin-library-heading"><div><h3>插件库</h3><p>工具配置、业务后端和真实执行分开核对。</p></div><button type="button" disabled={loading || busy || !allowed} onClick={() => void load()}>刷新清单</button></header>
    {!allowed && <p role="status">当前账号无权查看插件配置。请使用企业管理员或操作员账号。</p>}
    {loading && allowed && <p role="status">正在读取当前服务的真实插件清单…</p>}
    {error && <p className="plugin-library-error" role="alert">{error}</p>}
    {notice && <p className="plugin-library-notice" role="status">{notice}</p>}
    {pending && <aside className="plugin-library-review" aria-label="待核对的原请求"><strong>保留原请求，避免重复提交</strong><code>{pending}</code><button type="button" disabled={busy} onClick={() => void reconcile()}>核对原请求回执</button></aside>}
    {view && <>
      {(!ready && !loading) && <p role="status">以下仅为上次快照，当前操作已禁用。</p>}
      <div className="plugin-library-summary"><span><strong>{view.inventory.packages.length}</strong> 个源码插件</span><span><strong>{view.publisherCount}</strong> 个受信发布者密钥</span><span>控制修订 {view.revision}</span></div>
      <nav className="plugin-library-tabs" aria-label="插件库视图">{(['packages', 'releases', 'requests'] as const).map(value => <button type="button" key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{value === 'packages' ? '已安装源码' : value === 'releases' ? '第三方发布' : '变更记录'}</button>)}</nav>
      {!owner && <p className="plugin-library-muted">当前为只读视图。变更需要有效的企业管理员签名会话；本地模式不提供写入授权。</p>}
      {view.mode === 'inventory-only' && <p className="plugin-library-muted">管理记录尚未配置：可查看源码，不可提交变更。</p>}
      {tab === 'packages' && <div>
        <div className="plugin-library-filters"><label>搜索当前清单<input value={query} maxLength={200} onChange={event => setQuery(event.target.value)} placeholder="插件名称或功能" /></label><label>查看工具组合<select value={profile} onChange={event => setProfile(event.target.value)}>{view.inventory.profiles.map(item => <option key={item.configuration} value={item.configuration}>{profileLabel(item.configuration)}</option>)}</select></label></div>
        <div className="plugin-library-grid">{visible.map(item => <article key={item.id} className="plugin-library-card">
          <div className="plugin-library-card-title"><h4>{item.title}</h4><span>{item.selectedIn.includes(profile) ? '此组合已选择' : '此组合未选择'}</span></div>
          <p>{item.description || '使用包内工具与 Skill，通过原 Host 授权访问业务能力。'}</p>
          <small>{item.version} · {item.skills.length} 个 Skill · {item.extensions.length} 个扩展入口</small>
          <p className="plugin-library-muted">{item.backend.ownership === 'package' ? `包内后端：${item.backend.selected === true ? '已选择，连接待验证' : item.backend.selected === false ? '未选择' : '当前状态未确认'}` : '完整业务后端装卸：尚未认证'}</p>
          <details><summary>来源与边界</summary><code>{item.name}</code><code>{item.packageSha256}</code><p>配置已选择不表示当前会话已加载。切换需要重启；不提供热卸载。</p><p>安装、升级、完整卸载仍需逐模块验收，不能由关闭工具代替。</p></details>
          <button type="button" disabled={!canChange || item.id === 'workspace-goal-intelligence' && profile === 'config.business.json' && item.selectedIn.includes(profile)} onClick={() => changePlugin(item, item.selectedIn.includes(profile) ? 'disable-tools' : 'enable-tools')}>{item.selectedIn.includes(profile) ? '申请停用工具' : '申请启用工具'}</button>
        </article>)}</div>
        {!visible.length && <p>当前清单没有匹配的插件。</p>}
      </div>}
      {tab === 'releases' && <div>
        <p>第三方清单经过签名校验、独立审核后才可发布。此版本不自动拉取或执行镜像，也不开放企业数据授权。</p>
        <label className="plugin-library-import">签名发布清单<textarea value={envelope} maxLength={32768} onChange={event => setEnvelope(event.target.value)} rows={5} spellCheck={false} placeholder="粘贴含 manifest、keyId、signature 的 JSON；不要填写私钥或企业资料" /></label>
        <button type="button" disabled={!canChange || !view.capabilities.publicationReview || !envelope.trim()} onClick={importRelease}>提交待审核清单</button>
        {!view.publisherCount && <p className="plugin-library-muted">尚未配置发布者公钥。不会自动信任导入内容中的公钥。</p>}
        <p className="plugin-library-muted">显示最近 {view.releases.length} 条，共 {view.releaseCount} 条发布记录。</p>
        <div className="plugin-library-grid">{view.releases.map(item => <article className="plugin-library-card" key={item.id}>
          <h4>{item.name} <small>{item.version}</small></h4><span>{pluginStatusText[item.status] || item.status}</span><p>{item.description}</p><small>{item.publisher} · {item.license}</small>
          <details><summary>审核依据</summary><code>{item.fingerprint}</code><p>提交人：{item.importedBy}</p><p>审核人：{item.reviewedBy || '尚未审核'}</p><p>{item.reviewNote || '尚无审核说明'}</p></details>
          <div className="plugin-library-actions">
            {item.status === 'submitted' && <><button type="button" disabled={!canChange || item.importedBy === session.user?.id} onClick={() => releaseAction(item, 'review', 'approve')}>独立审核通过</button><button type="button" disabled={!canChange || item.importedBy === session.user?.id} onClick={() => releaseAction(item, 'review', 'reject')}>拒绝</button></>}
            {item.status === 'approved' && <button type="button" disabled={!canChange} onClick={() => releaseAction(item, 'publish')}>发布清单</button>}
            {item.status === 'published' && <button type="button" disabled={!ready || busy} onClick={() => void inspectManifest(item)}>查看发布制品清单</button>}
            {['submitted', 'approved', 'published'].includes(item.status) && <button type="button" disabled={!canChange} onClick={() => releaseAction(item, 'suspend')}>下架</button>}
          </div>
        </article>)}</div>
        {!view.releases.length && <p>尚无第三方发布记录；不会展示虚构的推荐插件。</p>}
        {publishedManifest && <label className="plugin-library-import">已发布清单（只读，不执行）<textarea readOnly value={publishedManifest} rows={8} spellCheck={false}/></label>}
      </div>}
      {tab === 'requests' && <div>{view.intents.length ? <ol className="plugin-library-requests">{[...view.intents].reverse().map(item => <li key={item.id}><strong>{item.pluginId}</strong><span>{pluginStatusText[item.status] || item.status}</span><p>{item.action} · {profileLabel(item.configuration)}</p><code>{item.requestId}</code><small>不删除业务资料；仅工具配置的应用不等于后端卸载。</small></li>)}</ol> : <p>当前账号尚无插件变更记录。</p>}</div>}
    </>}
    {review && <section className="plugin-library-review" aria-label="审阅本次插件操作"><h4>{review.title}</h4><p>{review.detail}</p>{review.needsNote && <label>审核或下架依据<textarea value={note} maxLength={2000} rows={3} onChange={event => setNote(event.target.value)} /></label>}<label className="plugin-library-checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已核对当前版本、来源和操作边界。</label><div className="plugin-library-actions"><button type="button" disabled={!canChange || !confirmed || review.body.expectedRevision !== view?.revision || !!review.needsNote && !note.trim()} onClick={() => void sendReview()}>确认提交此操作</button><button type="button" disabled={busy} onClick={() => setReview(null)}>取消本次填写</button></div></section>}
  </section>;
}
