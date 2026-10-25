window.__ModuleLoader__.load({
  id: 'dsh-inquiry-recovery',
  factory(require) {
    const React = require('react'), { useState, useEffect, useRef, useCallback } = React;
    const h = React.createElement, NS = 'inquiry-recovery', API = '/inquiry-recovery-api';
    const zh = {
      panel: '询盘恢复', intro: '核对历史询盘的依据，再决定是否提出跟进草稿。',
      boundary: '历史记录不代表当前采购意向。导入与身份核对由管理员操作；Agent 草稿保留为未审核、未发送。',
      workspace: '工作区', noWorkspace: '请先在 DSH 中选择一个工作文件夹。', refresh: '刷新', loading: '正在读取…',
      importTitle: '导入历史询盘', file: 'CSV 或 JSON 文件（UTF-8，最多 64 KiB）', authority: '我有权把此文件导入当前工作区', import: '导入文件',
      imported: '导入结果', rejected: '未通过的行', inserted: '新增', updated: '更新', duplicate: '重复', conflict: '冲突',
      inquiries: '历史询盘', empty: '没有匹配的询盘。', search: '搜索公司、产品或询盘标识', find: '搜索', showing: '显示 / 匹配', back: '返回列表', history: '原始联系记录', facts: '逐字依据',
      identity: '身份核对', confirmed: '已人工确认', unknown: '未确认', conflicting: '存在冲突', basis: '核对依据（原话或人工核对记录）',
      basisSource: '核对依据来源', officialUrl: '相关网址（可选）', saveReview: '保存身份核对', reviewBoundary: '仅记录当前版本的人工身份判断，不代表需求仍然有效或可以对外发送。',
      source: '导入来源', original: '下载导入原文件', sourceVerified: '原文件字节和当前导入行已核对；内容未独立核实。',
      carried: '本修订沿用了旧版本字段。请重新导入完整记录后再提出草稿。',
      follow_up: '建议跟进', need_evidence: '待补依据', nurture: '近期联系', hold: '暂停', reasons: '规则判断依据',
      drafts: '未发送草稿', noDrafts: '尚无草稿。可在原生对话中要求 Agent 根据已核对询盘提出草稿。',
      unreviewed: '未审核 · 未发送', sourceChanged: '来源或当前跟进条件已变化，请重新核查', downloadDraft: '下载草稿', conversation: '查看草稿来源对话',
      error: '操作失败：', saved: '已保存。', revision: '修订', recordHash: '导入行 SHA-256', fileHash: '原文件 SHA-256',
    };
    const en = {
      panel: 'Inquiry recovery', intro: 'Check the imported evidence before proposing a follow-up draft.',
      boundary: 'Historical records do not establish current buying intent. Administrators import and review identities; Agent drafts remain unreviewed and unsent.',
      workspace: 'Workspace', noWorkspace: 'Choose a working folder in DSH first.', refresh: 'Refresh', loading: 'Loading…',
      importTitle: 'Import historical inquiries', file: 'CSV or JSON file (UTF-8, up to 64 KiB)', authority: 'I may import this file into this workspace', import: 'Import file',
      imported: 'Import result', rejected: 'Rejected rows', inserted: 'Inserted', updated: 'Updated', duplicate: 'Duplicates', conflict: 'Conflicts',
      inquiries: 'Historical inquiries', empty: 'No matching inquiries.', search: 'Search company, product or inquiry id', find: 'Search', showing: 'Shown / matching', back: 'Back to list', history: 'Imported contact history', facts: 'Verbatim evidence',
      identity: 'Identity review', confirmed: 'Human confirmed', unknown: 'Unconfirmed', conflicting: 'Conflicting', basis: 'Review basis (quote or operator record)',
      basisSource: 'Review source', officialUrl: 'Related URL (optional)', saveReview: 'Save identity review', reviewBoundary: 'Records a human identity judgment for this revision. It does not establish current intent or authorize sending.',
      source: 'Imported source', original: 'Download original import', sourceVerified: 'Original bytes and the current imported row match; statements are not independently verified.',
      carried: 'This revision carries older fields. Reimport a complete record before proposing a draft.',
      follow_up: 'Follow-up candidate', need_evidence: 'Needs evidence', nurture: 'Recent contact', hold: 'On hold', reasons: 'Rule assessment reasons',
      drafts: 'Unsent drafts', noDrafts: 'No drafts yet. Ask the Agent in a native conversation to propose one from a reviewed inquiry.',
      unreviewed: 'Unreviewed · unsent', sourceChanged: 'Source or current eligibility changed; recheck before use', downloadDraft: 'Download draft', conversation: 'View source conversation',
      error: 'Operation failed: ', saved: 'Saved.', revision: 'Revision', recordHash: 'Imported row SHA-256', fileHash: 'Original file SHA-256',
    };
    async function request(path, { body, signal } = {}) {
      const response = await fetch(API + path, { signal, ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      const value = await response.json();
      if (!response.ok || !value.ok) { const error = new Error(value.error?.message ?? 'Inquiry request failed'); error.rows = value.error?.rejected; throw error; }
      return value.data;
    }
    const css = `.ir{height:100%;overflow:auto;padding:32px;max-width:1100px;margin:auto;color:var(--dsw-alias-label-primary);font:14px/1.65 system-ui,sans-serif;box-sizing:border-box}.ir *{box-sizing:border-box}.ir h1{font-size:26px;margin:0}.ir h2{font-size:19px;margin:24px 0 12px}.ir h3{font-size:15px}.ir .muted{color:var(--dsw-alias-label-tertiary)}.ir .actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:16px 0}.ir button,.ir input,.ir select,.ir textarea{font:inherit;padding:8px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:inherit;max-width:100%}.ir button{cursor:pointer}.ir button:disabled{opacity:.45;cursor:default}.ir label{display:block;margin:12px 0}.ir label:not(.check)>input,.ir label>select,.ir textarea{display:block;width:100%;margin-top:6px}.ir textarea{min-height:96px;resize:vertical}.ir .row{display:block;width:100%;padding:16px 0;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);border-radius:0;text-align:left}.ir .box{padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;margin:12px 0;overflow-wrap:anywhere}.ir .box p,.ir pre{white-space:pre-wrap;overflow-wrap:anywhere}.ir pre{font:inherit;margin:8px 0}.ir .meta{font-size:12px;overflow-wrap:anywhere}.ir .error{color:#b83232;white-space:pre-wrap}.ir a{color:var(--dsw-alias-label-link,#1677ff)}@media(max-width:700px){.ir{padding:24px 16px}}`;
    function Icon({ size = 18 }) { return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true }, h('path', { d: 'M4 4h16v12H9l-5 4V4ZM8 8h8M8 12h5' })); }
    function Panel({ t, openConversation }) {
      const [workspaces, setWorkspaces] = useState(null), [workspace, setWorkspace] = useState('');
      const [list, setList] = useState(null), [drafts, setDrafts] = useState([]), [detail, setDetail] = useState(null);
      const [query, setQuery] = useState(''), [search, setSearch] = useState('');
      const [file, setFile] = useState(null), [authorized, setAuthorized] = useState(false), [imported, setImported] = useState(null);
      const [reviewStatus, setReviewStatus] = useState('unknown'), [basis, setBasis] = useState(''), [basisSource, setBasisSource] = useState(''), [officialUrl, setOfficialUrl] = useState('');
      const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
      const current = useRef(workspace), scope = useRef(new AbortController()), identities = useRef(new Map()), ticket = useRef(0);
      const view = useRef(''); view.current = JSON.stringify([workspace, search]);
      current.current = workspace;
      const base = `/workspaces/${workspace}`;
      const load = useCallback(async signal => {
        const selected = workspace, key = JSON.stringify([workspace, search]);
        if (view.current !== key) return;
        const serial = ++ticket.current;
        const [rows, saved] = await Promise.all([request(`/workspaces/${selected}/leads?q=${encodeURIComponent(search)}`, { signal }), request(`/workspaces/${selected}/drafts`, { signal })]);
        if (!signal?.aborted && view.current === key && ticket.current === serial) { setList(rows); setDrafts(saved.items); }
      }, [workspace, search]);
      useEffect(() => {
        const abort = new AbortController();
        request('/workspaces', { signal: abort.signal }).then(value => { if (!abort.signal.aborted) { setWorkspaces(value.items); setWorkspace(value.items[0]?.id ?? ''); } }).catch(error => { if (!abort.signal.aborted) setError(error.message); });
        return () => abort.abort();
      }, []);
      useEffect(() => {
        scope.current.abort(); scope.current = new AbortController(); identities.current.clear(); ticket.current++;
        setList(null); setDrafts([]); setDetail(null); setFile(null); setAuthorized(false); setImported(null); setError(''); setNotice(''); setBusy(false);
        setQuery(''); setSearch('');
        return () => scope.current.abort();
      }, [workspace]);
      useEffect(() => {
        const abort = new AbortController();
        if (workspace) load(AbortSignal.any([abort.signal, scope.current.signal])).catch(error => { if (!abort.signal.aborted && current.current === workspace) setError(error.message); });
        return () => abort.abort();
      }, [workspace, load]);
      async function perform(operation) {
        const signal = scope.current.signal, selected = workspace;
        setBusy(true); setError(''); setNotice('');
        try { await operation(signal); if (!signal.aborted && current.current === selected) await load(signal); }
        catch (error) { if (!signal.aborted && current.current === selected) setError(error.message + (error.rows ? '\n' + JSON.stringify(error.rows) : '')); }
        finally { if (!signal.aborted && current.current === selected) setBusy(false); }
      }
      async function command(path, body, signal) {
        const key = JSON.stringify([workspace, path, body]);
        if (!identities.current.has(key)) identities.current.set(key, crypto.randomUUID());
        return request(base + path, { body: { ...body, requestId: identities.current.get(key) }, signal });
      }
      async function open(row, signal) {
        const value = await request(base + '/leads/' + encodeURIComponent(row.leadId), { signal });
        if (signal.aborted || current.current !== workspace) return;
        setDetail(value); setReviewStatus(value.identity.status); setBasis(''); setOfficialUrl(''); setBasisSource(value.card.sourceId);
      }
      const button = (label, action) => h('button', { type: 'button', disabled: busy, onClick: action }, label);
      const field = (label, value, update, options = {}) => h('label', null, label, h(options.area ? 'textarea' : 'input', { 'aria-label': label, value, onChange: event => update(event.target.value), ...(!options.area ? { type: options.type ?? 'text' } : {}), required: options.required }));
      return h('div', { className: 'ir' }, h('style', null, css), h('h1', null, t('panel')), h('p', null, t('intro')), h('p', { className: 'muted' }, t('boundary')),
        h('label', null, t('workspace'), h('select', { 'aria-label': t('workspace'), value: workspace, onChange: event => setWorkspace(event.target.value) }, workspaces?.map(row => h('option', { key: row.id, value: row.id }, row.title)))),
        workspaces?.length === 0 ? h('p', null, t('noWorkspace')) : null,
        workspace ? h(React.Fragment, null,
          h('div', { className: 'actions' }, button(t('refresh'), () => perform(async signal => { if (detail) await open(detail.card, signal); }))),
          !detail ? h(React.Fragment, null,
            h('h2', null, t('importTitle')), h('form', { onSubmit: event => { event.preventDefault(); perform(async signal => {
              if (!file || file.size > 65_536) throw new Error(t('file'));
              const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
              for (let i = 0; i < bytes.length; i += 4096) binary += String.fromCharCode(...bytes.slice(i, i + 4096));
              if (signal.aborted) return;
              const result = await command('/import', { sourceName: file.name, format: file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json', dataBase64: btoa(binary), authorized }, signal);
              if (!signal.aborted && current.current === workspace) { setImported(result); setNotice(t('saved')); identities.current.clear(); }
            }); } },
              h('label', null, t('file'), h('input', { type: 'file', accept: '.csv,.json', 'aria-label': t('file'), required: true, onChange: event => setFile(event.target.files[0] ?? null) })),
              h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: authorized, onChange: event => setAuthorized(event.target.checked) }), ' ', t('authority')),
              h('button', { type: 'submit', disabled: busy || !file || !authorized }, t('import'))),
            imported ? h('div', { className: 'box' }, h('strong', null, t('imported')), h('p', null, ['inserted', 'updated', 'duplicate', 'conflict'].map(key => `${t(key)} ${imported[key]}`).join(' · ')), imported.rejected.length ? h('p', null, `${t('rejected')}: ${JSON.stringify(imported.rejected)}`) : null) : null,
            h('h2', null, t('inquiries')), h('form', { className: 'actions', onSubmit: event => { event.preventDefault(); setSearch(query); } }, h('input', { value: query, 'aria-label': t('search'), placeholder: t('search'), onChange: event => setQuery(event.target.value), maxLength: 200 }), h('button', { type: 'submit', disabled: busy }, t('find'))),
            list ? h('p', { className: 'muted meta' }, `${t('showing')}: ${list.items.length} / ${list.total}`) : null,
            list ? h('div', { className: 'list' }, list.items.length ? list.items.map(row => h('button', { className: 'row', type: 'button', disabled: busy, key: row.leadId, onClick: () => perform(signal => open(row, signal)) },
              h('strong', null, row.company.name || row.leadId), h('span', null, ` · ${t(row.decision)} · ${t(row.identity.status)}`), h('div', { className: 'muted' }, `${row.request.product || ''} · ${row.leadId} · ${t('revision')} ${row.revision}`))) : h('p', null, t('empty'))) : h('p', null, t('loading')),
            h('h2', null, t('drafts')), drafts.length ? drafts.map(row => h('div', { className: 'box draft', key: row.id }, h('strong', null, `${row.leadId} · ${t('unreviewed')}`), !row.sourceRevisionMatches || !row.ruleEligibleNow ? h('p', { className: 'error' }, t('sourceChanged')) : null,
              h('pre', null, row.draft.content), h('div', { className: 'actions' }, row.nativeAttachment ? h('a', { href: API + base + `/drafts/${row.id}/file` }, t('downloadDraft')) : null,
                row.nativeOrigin?.sessionId && openConversation ? button(t('conversation'), () => openConversation(row.nativeOrigin.sessionId)) : null))) : h('p', { className: 'muted' }, t('noDrafts'))) : h(React.Fragment, null,
              button(t('back'), () => { setDetail(null); setError(''); }), h('h2', null, detail.card.company.name || detail.card.leadId), h('p', null, `${t(detail.card.decision)} · ${t(detail.identity.status)}`),
              h('p', { className: 'muted' }, `${t('reasons')}: ${[...detail.card.reasons, ...detail.card.missing].join(', ')}`),
              h('h3', null, t('source')), h('p', null, detail.source.name), h('p', { className: 'muted' }, t('sourceVerified')),
              h('p', { className: 'meta' }, `${detail.card.sourceId} · ${t('revision')} ${detail.card.revision}`), h('p', { className: 'meta' }, `${t('recordHash')}: ${detail.card.sourceHash}`), h('p', { className: 'meta' }, `${t('fileHash')}: ${detail.source.sha256}`),
              h('a', { href: API + base + `/imports/${detail.source.importId}/file` }, t('original')), detail.source.carriedForward.length ? h('p', { className: 'error' }, t('carried')) : null,
              h('h3', null, t('history')), detail.history.map(row => h('div', { className: 'box', key: row.id }, h('span', { className: 'muted meta' }, `${row.id} · ${row.direction} · ${row.sentAt || '?'}`), h('pre', null, row.body))),
              h('h3', null, t('facts')), detail.facts.map((row, index) => h('p', { key: index }, `${row.sourceMessageId}: ${row.quote}`)),
              h('h2', null, t('identity')), h('p', { className: 'muted' }, t('reviewBoundary')), h('form', { onSubmit: event => { event.preventDefault(); perform(async signal => {
                await command(`/leads/${encodeURIComponent(detail.card.leadId)}/identity`, { sourceHash: detail.card.sourceHash, status: reviewStatus,
                  basis: basis ? [{ sourceId: basisSource, quote: basis, ...(officialUrl ? { officialUrl } : {}) }] : [], expectedReviewRevision: detail.identity.reviewRevision ?? 0 }, signal);
                if (!signal.aborted && current.current === workspace) { identities.current.clear(); await open(detail.card, signal); setNotice(t('saved')); }
              }); } },
                h('select', { 'aria-label': t('identity'), value: reviewStatus, onChange: event => setReviewStatus(event.target.value) }, ['unknown', 'confirmed', 'conflicting'].map(key => h('option', { key, value: key }, t(key)))),
                field(t('basisSource'), basisSource, setBasisSource, { required: reviewStatus === 'confirmed' }), field(t('basis'), basis, setBasis, { area: true, required: reviewStatus === 'confirmed' }), field(t('officialUrl'), officialUrl, setOfficialUrl, { type: 'url' }), h('button', { type: 'submit', disabled: busy }, t('saveReview'))))) : null,
        busy ? h('p', { role: 'status' }, t('loading')) : null, error ? h('p', { role: 'alert', className: 'error' }, t('error') + error) : null, notice ? h('p', { role: 'status' }, notice) : null);
    }
    const inject = ['slots', 'locale'];
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'inquiry-recovery: locale');
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: NS, order: 45, locale: NS, label: () => t('panel') }, Icon)), 'inquiry-recovery: sidebar');
      const InquiryPanel = props => h(Panel, { ...props, openConversation: id => { ctx.get('uiWorkspace').openSession(id); ctx.get('layout').selectPanel(null); } });
      ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: NS, locale: NS }, InquiryPanel)), 'inquiry-recovery: panel');
    }
    return { inject, apply, dictionaries: { zh, en } };
  },
});
