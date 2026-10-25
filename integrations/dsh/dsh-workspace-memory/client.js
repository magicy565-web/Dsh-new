window.__ModuleLoader__.load({
  id: 'dsh-workspace-memory',
  factory(require) {
    const React = require('react');
    const { useState, useEffect, useRef, useCallback } = React;
    const h = React.createElement, NS = 'workspace-memory', API = '/workspace-memory-api';
    const zh = {
      'panel': '经营记忆', 'intro': '把经过确认的经营信息留给下一次对话。',
      'boundary': '记忆按 DSH 工作区隔离。Agent 只能提出候选；审核与撤销由当前登录的管理员操作。',
      'workspace': '工作区', 'noWorkspace': '还没有工作区。请先在 DSH 原生界面选择一个文件夹。',
      'proposed': '待审核', 'active': '已确认', 'expired': '已过期', 'rejected': '已驳回', 'superseded': '已替换', 'revoked': '已撤销', 'all': '全部记录',
      'refresh': '刷新', 'search': '搜索陈述、对象或事实键', 'find': '搜索', 'new': '提出候选', 'empty': '此筛选下还没有记忆。', 'showing': '当前显示 / 匹配记录',
      'loading': '正在读取…', 'working': '正在保存…', 'saved': '已保存。', 'proposedNotice': '候选已保存，人工通过后才进入召回。',
      'back': '返回列表', 'subject': '对象类型', 'subjectId': '对象标识', 'subjectLabel': '对象名称', 'factKey': '事实键',
      'identifierHint': '同一对象和事实键表示同一条事实；新候选获批后替换旧记录。标识使用英文、数字或短横线。',
      'kind': '信息性质', 'statement': '记忆陈述', 'detail': '补充说明', 'source': '来源', 'operator': '人工陈述', 'document': '资料库文档',
      'conversation': '原生对话指针', 'openConversation': '查看来源对话', 'basis': '陈述依据', 'basisHint': '说明谁在何时、通过什么方式确认；不要把推测写成事实。',
      'selectDocument': '选择确切文档版本', 'noDocuments': '当前没有可引用的文本资料。可先在资料库中上传。',
      'sourceBoundary': '资料库属于当前 DSH profile；来源核验只证明确切字节和哈希，不证明陈述本身正确。',
      'expiresAt': '有效期至（可选）', 'submit': '保存为待审核候选', 'cancel': '取消',
      'review': '人工审核', 'reviewNote': '审核或撤销说明', 'approve': '通过并启用', 'reject': '驳回', 'revoke': '撤销记忆',
      'reviewBoundary': '通过后可被 Agent 召回；撤销、替换、过期和来源失效的记忆不会进入召回。历史记录保留。',
      'verified': '来源字节与哈希已核验', 'attested': '人工陈述 · 未独立核验', 'pointer': '对话指针 · 非已核验事实',
      'sourceUnavailable': '来源不可用', 'revision': '修订', 'history': '历史记录', 'noExpiry': '未设置有效期',
      'error': '操作失败，请刷新后重试。', 'conflict': '记录已变化，请刷新后重新审核。', 'cancelled': '操作已取消。',
      'archived': '来源资料已归档，请选择可用版本。', 'missing': '来源不可用，请检查资料库插件和文档版本。', 'expiredError': '这条候选已经过期，不能启用。',
      'company': '企业', 'product': '产品', 'customer': '客户', 'market': '市场', 'channel': '渠道', 'operation': '经营动作',
      'fact': '事实', 'observation': '观察', 'hypothesis': '假设', 'preference': '偏好', 'decision': '决策', 'outcome': '结果',
    };
    const en = {
      'panel': 'Business memory', 'intro': 'Keep confirmed business information available for the next conversation.',
      'boundary': 'Memory is scoped to a native DSH workspace. Agents propose; the signed-in administrator reviews and revokes.',
      'workspace': 'Workspace', 'noWorkspace': 'No workspace yet. Choose a folder in the native DSH interface first.',
      'proposed': 'Pending review', 'active': 'Confirmed', 'expired': 'Expired', 'rejected': 'Rejected', 'superseded': 'Superseded', 'revoked': 'Revoked', 'all': 'All records',
      'refresh': 'Refresh', 'search': 'Search statement, subject or fact key', 'find': 'Search', 'new': 'Propose memory', 'empty': 'No memories match this filter.', 'showing': 'Shown / matching records',
      'loading': 'Loading…', 'working': 'Saving…', 'saved': 'Saved.', 'proposedNotice': 'Candidate saved. It enters recall only after human approval.',
      'back': 'Back to list', 'subject': 'Subject type', 'subjectId': 'Subject identifier', 'subjectLabel': 'Subject name', 'factKey': 'Fact key',
      'identifierHint': 'A subject and fact key identify one fact. Approving a new candidate supersedes the old record. Use letters, numbers or hyphens in identifiers.',
      'kind': 'Information kind', 'statement': 'Memory statement', 'detail': 'Details', 'source': 'Source', 'operator': 'Operator statement', 'document': 'Library document',
      'conversation': 'Native conversation pointer', 'openConversation': 'View source conversation', 'basis': 'Basis of statement', 'basisHint': 'Explain who confirmed it, when and how. Keep hypotheses distinct from facts.',
      'selectDocument': 'Choose an exact document version', 'noDocuments': 'No text references available. Upload one in Library first.',
      'sourceBoundary': 'Library belongs to this DSH profile. Verification proves exact bytes and hash, not the truth of a statement.',
      'expiresAt': 'Valid until (optional)', 'submit': 'Save pending candidate', 'cancel': 'Cancel',
      'review': 'Human review', 'reviewNote': 'Review or revocation note', 'approve': 'Approve and activate', 'reject': 'Reject', 'revoke': 'Revoke memory',
      'reviewBoundary': 'Agents can recall approved memories. Revoked, superseded, expired or unavailable sources are excluded. History is retained.',
      'verified': 'Source bytes and hash verified', 'attested': 'Operator statement · not independently verified', 'pointer': 'Conversation pointer · not a verified fact',
      'sourceUnavailable': 'Source unavailable', 'revision': 'Revision', 'history': 'History', 'noExpiry': 'No expiry set',
      'error': 'Operation failed. Refresh and try again.', 'conflict': 'Memory changed. Refresh before reviewing again.', 'cancelled': 'Operation cancelled.',
      'archived': 'Source document is archived. Choose an available version.', 'missing': 'Source unavailable. Check the Library plugin and exact version.', 'expiredError': 'This candidate has expired and cannot be activated.',
      'company': 'Company', 'product': 'Product', 'customer': 'Customer', 'market': 'Market', 'channel': 'Channel', 'operation': 'Operation',
      'fact': 'Fact', 'observation': 'Observation', 'hypothesis': 'Hypothesis', 'preference': 'Preference', 'decision': 'Decision', 'outcome': 'Outcome',
    };
    const types = ['company', 'product', 'customer', 'market', 'channel', 'operation'];
    const kinds = ['fact', 'observation', 'hypothesis', 'preference', 'decision', 'outcome'];
    const styles = `.bm{max-width:1000px;margin:0 auto;padding:36px 32px 80px;color:var(--dsw-alias-label-primary);font:14px/1.6 system-ui,sans-serif;box-sizing:border-box;height:100%;overflow:auto}.bm *{box-sizing:border-box}.bm h1{font-size:26px;margin:0 0 4px}.bm h2{font-size:18px;margin:24px 0 12px}.bm p{margin:8px 0}.bm .muted{color:var(--dsw-alias-label-tertiary)}.bm .toolbar,.bm .actions,.bm .stats{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:20px 0}.bm .stats>div{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 20px;min-width:130px}.bm .stats strong{font-size:24px;display:block}.bm button,.bm input,.bm select,.bm textarea{font:inherit;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:inherit;padding:8px 12px}.bm button{cursor:pointer}.bm button.primary{background:#1677ff;color:white;border-color:#1677ff}.bm button:disabled{opacity:.45;cursor:default}.bm input,.bm select,.bm textarea{min-width:0;max-width:100%}.bm textarea{width:100%;min-height:96px;resize:vertical}.bm label{display:flex;flex-direction:column;gap:6px}.bm .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.bm .wide{grid-column:1/-1}.bm .list{border-top:1px solid var(--dsw-alias-border-l1)}.bm .row{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);border-radius:0;padding:18px 0}.bm .row p{white-space:pre-wrap;overflow-wrap:anywhere}.bm .badge{display:inline-block;font-size:12px;padding:2px 8px;border-radius:5px;background:var(--dsw-alias-bg-module-platform);margin-right:6px}.bm .error{color:#b83232;white-space:pre-wrap}.bm .notice{color:var(--dsw-alias-label-secondary)}.bm .record{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:16px}.bm .meta{font-size:12px;overflow-wrap:anywhere}.bm .history{border-top:1px solid var(--dsw-alias-border-l1);padding:10px 0}.bm .search{flex:1;min-width:180px}@media(max-width:700px){.bm{padding:24px 16px}.bm .grid{grid-template-columns:1fr}}`;
    async function request(path, { body, signal } = {}) {
      const response = await fetch(API + path, { ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}), signal });
      const value = await response.json();
      if (!response.ok || !value.ok) { const error = new Error(value.error?.message ?? 'Memory request failed'); error.code = value.error?.code; throw error; }
      return value.data;
    }
    const emptyDraft = () => ({ subjectType: 'company', subjectId: 'company', subjectLabel: '', factKey: '', kind: 'fact', statement: '', detail: '', sourceKind: 'operator', basis: '', sourceRef: '', expiry: '' });
    function Icon({ size = 18 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true }, h('path', { d: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5M2 8h3m-3 4h3m-3 4h3' }));
    }
    function Panel({ t, openConversation }) {
      const [workspaces, setWorkspaces] = useState(null), [workspace, setWorkspace] = useState('');
      const [data, setData] = useState(null), [filter, setFilter] = useState('proposed'), [query, setQuery] = useState(''), [search, setSearch] = useState('');
      const [draft, setDraft] = useState(null), [sources, setSources] = useState([]), [detail, setDetail] = useState(null), [note, setNote] = useState('');
      const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
      const lifetime = useRef(new AbortController()), identities = useRef(new Map()), selection = useRef(0);
      const view = useRef(''), reads = useRef(0);
      view.current = JSON.stringify([workspace, filter, search]);
      const explain = useCallback(error => {
        const keys = { MEMORY_REVISION_CONFLICT: 'conflict', MEMORY_CHANGED: 'conflict', MEMORY_CANCELLED: 'cancelled', REFERENCE_ARCHIVED: 'archived', MEMORY_SOURCE_UNAVAILABLE: 'missing', REFERENCE_UNAVAILABLE: 'missing', REFERENCE_CHANGED: 'missing', MEMORY_EXPIRED: 'expiredError' };
        return keys[error.code] ? t(keys[error.code]) : `${t('error')} ${error.message ?? ''}`;
      }, [t]);
      const base = `/workspaces/${workspace}`;
      const load = useCallback(async signal => {
        if (!workspace) return;
        const key = JSON.stringify([workspace, filter, search]);
        if (view.current !== key) return;
        const ticket = ++reads.current;
        const params = new URLSearchParams({ status: filter, ...(search ? { q: search } : {}) });
        const result = await request(`/workspaces/${workspace}/state?${params}`, { signal });
        if (!signal?.aborted && view.current === key && ticket === reads.current) setData(result);
      }, [workspace, filter, search]);
      useEffect(() => {
        const abort = new AbortController();
        request('/workspaces', { signal: abort.signal }).then(result => { setWorkspaces(result.items); setWorkspace(result.items[0]?.id ?? ''); }).catch(error => { if (!abort.signal.aborted) setError(explain(error)); });
        return () => { abort.abort(); lifetime.current.abort(); };
      }, [explain]);
      useEffect(() => {
        lifetime.current.abort(); lifetime.current = new AbortController(); selection.current++;
        identities.current.clear(); setDetail(null); setDraft(null); setData(null); setError(''); setNotice(''); setBusy(false); setNote('');
        return () => lifetime.current.abort();
      }, [workspace]);
      useEffect(() => { const abort = new AbortController(); load(abort.signal).catch(error => { if (!abort.signal.aborted) setError(explain(error)); }); return () => abort.abort(); }, [load, explain]);
      function command(path, body) {
        const key = JSON.stringify([workspace, path, body]);
        if (!identities.current.has(key)) identities.current.set(key, crypto.randomUUID());
        return request(base + path, { body: { ...body, requestId: identities.current.get(key) }, signal: lifetime.current.signal });
      }
      async function perform(operation) {
        const signal = lifetime.current.signal;
        setBusy(true); setError(''); setNotice('');
        try { await operation(signal); if (!signal.aborted) { await load(signal); setNotice(t('saved')); } }
        catch (error) { if (!signal.aborted) setError(explain(error)); }
        finally { if (!signal.aborted) setBusy(false); }
      }
      const field = (key, label, options = {}) => h('label', { className: options.wide ? 'wide' : undefined }, label,
        options.values ? h('select', { 'aria-label': label, value: draft[key], onChange: event => setDraft({ ...draft, [key]: event.target.value }), required: true }, options.values.map(value => h('option', { key: value, value }, t(value))))
          : h(options.area ? 'textarea' : 'input', { 'aria-label': label, value: draft[key], type: options.type ?? 'text', required: options.required, maxLength: options.maxLength, onChange: event => setDraft({ ...draft, [key]: event.target.value }) }));
      const sourceLabel = row => row.source.kind === 'document' ? t('verified') : row.source.kind === 'conversation' ? t('pointer') : t('attested');
      async function open(row) {
        const revision = ++selection.current, signal = lifetime.current.signal;
        setError(''); setNote('');
        try { const value = await request(`${base}/memories/${row.id}`, { signal }); if (!signal.aborted && selection.current === revision) setDetail(value); }
        catch (error) { if (!signal.aborted) setError(explain(error)); }
      }
      const button = (label, onClick, primary = false, disabled = false) => h('button', { key: label, type: 'button', disabled: busy || disabled, className: primary ? 'primary' : undefined, onClick }, label);
      const selectFilter = h('select', { 'aria-label': t('all'), value: filter, onChange: event => setFilter(event.target.value) }, ['proposed', 'active', 'all', 'rejected', 'superseded', 'revoked'].map(value => h('option', { key: value, value }, t(value))));
      const date = value => new Date(value).toLocaleString(undefined, { timeZone: 'Asia/Shanghai' });
      return h('div', { className: 'bm' }, h('style', null, styles), h('h1', null, t('panel')), h('p', { className: 'muted' }, t('intro')), h('p', { className: 'muted' }, t('boundary')),
        workspaces === null ? h('p', null, t('loading')) : !workspaces.length ? h('p', null, t('noWorkspace')) : h(React.Fragment, null,
          h('div', { className: 'toolbar' }, h('label', null, t('workspace'), h('select', { 'aria-label': t('workspace'), value: workspace, onChange: event => setWorkspace(event.target.value) }, workspaces.map(item => h('option', { key: item.id, value: item.id }, item.title))))),
          data ? h('div', { className: 'stats' }, ['proposed', 'active', 'expired'].map(key => h('div', { key }, h('span', { className: 'muted' }, t(key)), h('strong', null, data[key])))) : h('p', null, t('loading')),
          !draft && !detail ? h(React.Fragment, null,
            h('form', { className: 'toolbar', onSubmit: event => { event.preventDefault(); setSearch(query); } }, selectFilter, h('input', { className: 'search', placeholder: t('search'), 'aria-label': t('search'), value: query, onChange: event => setQuery(event.target.value) }), h('button', { type: 'submit' }, t('find')), button(t('refresh'), () => perform(load)), button(t('new'), () => perform(async signal => { const value = await request(base + '/sources', { signal }); if (!signal.aborted) { setSources(value.items); setDraft(emptyDraft()); } }), true)),
            data ? h('p', { className: 'muted meta' }, `${t('showing')}: ${data.items.length} / ${data.total}`) : null,
            h('div', { className: 'list' }, data?.items.length ? data.items.map(row => h('button', { className: 'row', key: row.id, type: 'button', onClick: () => open(row) },
              h('span', { className: 'badge' }, t(row.lifecycle)), h('span', { className: 'badge' }, t(row.kind)), !row.sourceState.available ? h('span', { className: 'badge' }, t('sourceUnavailable')) : null,
              h('p', null, row.statement), h('div', { className: 'muted meta' }, `${t(row.subjectType)} · ${row.subjectLabel} · ${row.factKey} · v${row.revision}`), h('div', { className: 'muted meta' }, `${row.source.label} · ${sourceLabel(row)}`))) : h('p', { className: 'muted' }, t('empty')))) : null,
          draft ? h('form', { onSubmit: event => { event.preventDefault(); perform(async signal => {
            const source = draft.sourceKind === 'document' ? { kind: 'document', ...JSON.parse(draft.sourceRef) } : { kind: 'operator', basis: draft.basis, label: t('operator') };
            await command('/proposals', { subjectType: draft.subjectType, subjectId: draft.subjectId, subjectLabel: draft.subjectLabel || draft.subjectId, factKey: draft.factKey, kind: draft.kind, statement: draft.statement, ...(draft.detail ? { detail: draft.detail } : {}), source, ...(draft.expiry ? { expiresAt: new Date(draft.expiry).toISOString() } : {}) });
            if (!signal.aborted) { setDraft(null); setFilter('proposed'); setSearch(''); setQuery(''); identities.current.clear(); }
          }); } }, h('h2', null, t('new')), h('div', { className: 'grid' },
            field('subjectType', t('subject'), { values: types }), field('kind', t('kind'), { values: kinds }), field('subjectId', t('subjectId'), { required: true }), field('subjectLabel', t('subjectLabel')),
            field('factKey', t('factKey'), { required: true }), field('expiry', t('expiresAt'), { type: 'datetime-local' }), h('p', { className: 'wide muted' }, t('identifierHint')),
            field('statement', t('statement'), { area: true, wide: true, required: true, maxLength: 2000 }), field('detail', t('detail'), { area: true, wide: true }),
            field('sourceKind', t('source'), { values: ['operator', 'document'] }),
            draft.sourceKind === 'operator' ? field('basis', t('basis'), { area: true, wide: true, required: true })
              : h('label', { className: 'wide' }, t('selectDocument'), h('select', { 'aria-label': t('selectDocument'), required: true, value: draft.sourceRef, onChange: event => setDraft({ ...draft, sourceRef: event.target.value }) }, h('option', { value: '' }, t('selectDocument')), sources.map(item => h('option', { key: `${item.documentId}:${item.version}`, value: JSON.stringify({ documentId: item.documentId, version: item.version, sha256: item.sha256 }) }, `${item.title} · v${item.version} · ${item.fileName}`))), sources.length ? null : h('p', { className: 'muted' }, t('noDocuments'))),
            h('p', { className: 'wide muted' }, draft.sourceKind === 'operator' ? t('basisHint') : t('sourceBoundary'))),
            h('div', { className: 'actions' }, h('button', { type: 'submit', className: 'primary', disabled: busy }, t('submit')), button(t('cancel'), () => setDraft(null)))) : null,
          detail ? h(React.Fragment, null, button(t('back'), () => { selection.current++; setDetail(null); }),
            h('h2', null, `${detail.record.subjectLabel} · ${detail.record.factKey}`), h('span', { className: 'badge' }, t(detail.record.lifecycle)), h('span', { className: 'badge' }, t(detail.record.kind)),
            h('p', { className: 'record' }, detail.record.statement), detail.record.detail ? h('p', { className: 'record' }, detail.record.detail) : null,
            h('h2', null, t('source')), h('p', null, detail.record.source.label), h('p', { className: 'muted' }, sourceLabel(detail.record)),
            h('p', { className: 'meta' }, detail.record.source.ref), detail.record.source.sha256 ? h('p', { className: 'meta' }, `SHA-256: ${detail.record.source.sha256}`) : null,
            detail.record.source.kind === 'conversation' && /^conversation:(session-[A-Za-z0-9-]+)#tool:/u.test(detail.record.source.ref) && openConversation
              ? button(t('openConversation'), () => openConversation(/^conversation:(session-[A-Za-z0-9-]+)#tool:/u.exec(detail.record.source.ref)[1])) : null,
            detail.record.source.basis ? h('p', { className: 'record' }, detail.record.source.basis) : null,
            !detail.sourceState.available ? h('p', { className: 'error' }, t('sourceUnavailable')) : null,
            h('p', { className: 'muted' }, detail.record.expiresAt ? `${t('expiresAt')}: ${date(detail.record.expiresAt)}` : t('noExpiry')),
            ['proposed', 'active'].includes(detail.record.status) ? h(React.Fragment, null, h('h2', null, t('review')), h('p', { className: 'muted' }, t('reviewBoundary')),
              h('label', null, t('reviewNote'), h('textarea', { value: note, onChange: event => setNote(event.target.value) })),
              h('div', { className: 'actions' }, detail.record.status === 'proposed' ? [button(t('approve'), () => perform(async signal => { await command(`/memories/${detail.record.id}/review`, { decision: 'approve', expectedRevision: data.revision, note }); if (!signal.aborted) { setDetail(null); identities.current.clear(); } }), true, !detail.sourceState.available), button(t('reject'), () => perform(async signal => { await command(`/memories/${detail.record.id}/review`, { decision: 'reject', expectedRevision: data.revision, note }); if (!signal.aborted) { setDetail(null); identities.current.clear(); } }))] : null,
                button(t('revoke'), () => perform(async signal => { await command(`/memories/${detail.record.id}/revoke`, { expectedRevision: data.revision, reason: note }); if (!signal.aborted) { setDetail(null); identities.current.clear(); } })))) : null,
            h('h2', null, t('history')), detail.record.history.map((entry, index) => h('div', { className: 'history meta', key: index }, `${date(entry.at)} · ${entry.action} · ${entry.actor}`, entry.note ? h('p', null, entry.note) : null))) : null),
        busy ? h('p', { role: 'status' }, t('working')) : null, error ? h('p', { role: 'alert', className: 'error' }, error) : null, notice ? h('p', { role: 'status', className: 'notice' }, notice) : null);
    }
    const inject = ['slots', 'locale'];
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workspace-memory: locale');
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: NS, order: 40, locale: NS, label: () => t('panel') }, Icon)), 'workspace-memory: sidebar');
      const MemoryPanel = props => h(Panel, { ...props, openConversation: id => { ctx.get('uiWorkspace').openSession(id); ctx.get('layout').selectPanel(null); } });
      ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: NS, locale: NS }, MemoryPanel)), 'workspace-memory: panel');
    }
    return { apply, inject, dictionaries: { zh, en } };
  },
});
