window.__ModuleLoader__.load({ id: 'dsh-mini-erp', factory(require) {
  const React = require('react'), { useState, useEffect, useRef } = React, h = React.createElement;
  const API = '/mini-erp-api', NS = 'mini-erp';
  async function request(path, body, signal) {
    const response = await fetch(API + path, { credentials: 'same-origin', cache: 'no-store', signal,
      ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error?.message || `HTTP ${response.status}`);
    return result.data;
  }
  const labels = { product: '商品', buyer: '买手', order: '订单', offer: '供应名额' };
  const states = { reserved: '已预留', confirmed: '已确认', cancelled: '已取消', expired: '已到期', linked: '已关联产品库', unavailable: '来源不可用', 'legacy-unlinked': '待关联原有记录' };
  const css = `.me{color:var(--dsw-alias-label-primary,#202b29);background:var(--dsw-alias-bg-base,#f6f7f8);height:100%;overflow:auto;padding:28px;font:14px/1.6 system-ui}.me *{box-sizing:border-box}.me header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:24px}.me h1{margin:0;font-size:25px}.me h2{font-size:19px}.me p{overflow-wrap:anywhere}.me .body{display:grid;grid-template-columns:145px minmax(0,1fr);gap:24px}.me nav{display:flex;flex-direction:column;gap:6px}.me button,.me input,.me select{font:inherit;padding:8px 12px;border:1px solid var(--dsw-alias-border-main,#d6dbdf);border-radius:7px;background:var(--dsw-alias-bg-base,#fff);color:inherit}.me button{cursor:pointer}.me button:disabled{opacity:.55;cursor:default}.me button.selected,.me .primary{background:#1d6153;color:white;border-color:#1d6153}.me .card{border:1px solid var(--dsw-alias-border-main,#dce1e4);background:var(--dsw-alias-bg-elevated,#fff);border-radius:12px;padding:22px;margin-bottom:18px;min-width:0}.me .toolbar{display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap;margin-bottom:16px}.me .table{overflow:auto}.me table{border-collapse:collapse;width:100%;white-space:nowrap}.me th,.me td{border-bottom:1px solid #dce1e4;padding:12px;text-align:left}.me small{display:block;color:var(--dsw-alias-label-secondary,#60706b)}.me .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px}.me label{display:flex;flex-direction:column;gap:6px}.me .error{color:#a12a21}.me .images{display:flex;gap:12px;flex-wrap:wrap}.me img{width:100px;height:100px;object-fit:contain}.me .pill{display:inline-block;padding:2px 9px;background:#e7f0eb;color:#215c50;border-radius:20px;font-size:12px}.me .detail{white-space:pre-wrap}.me a{color:#215c50}@media(max-width:650px){.me{padding:16px}.me .body{grid-template-columns:1fr}.me nav{flex-direction:row;flex-wrap:wrap}.me .card{padding:16px}}`;
  function Panel({ openLibrary }) {
    const [workspaces, setWorkspaces] = useState([]), [workspace, setWorkspace] = useState('');
    const [entity, setEntity] = useState('product'), [data, setData] = useState(null), [detail, setDetail] = useState(null);
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [nonce, refresh] = useState(0);
    const [binding, setBinding] = useState(false), [catalog, setCatalog] = useState([]), [sourceId, setSourceId] = useState(''), [skuId, setSkuId] = useState(''), [stock, setStock] = useState('0');
    const [cursor, setCursor] = useState(''), [notice, setNotice] = useState('');
    const active = useRef(''), pending = useRef(null), detailRequest = useRef(0); active.current = workspace + '/' + entity;
    useEffect(() => { const a = new AbortController(); request('/workspaces', null, a.signal).then(r => { setWorkspaces(r.items); setWorkspace(r.items[0]?.id ?? ''); }).catch(e => { if (!a.signal.aborted) setError(e.message); }); return () => a.abort(); }, []);
    useEffect(() => {
      detailRequest.current++; setDetail(null); setBinding(false); setData(null); setBusy(false);
      if (!workspace) return;
      const a = new AbortController(), key = workspace + '/' + entity; setError('');
      request(`/workspaces/${encodeURIComponent(workspace)}/read?${new URLSearchParams({ entity, limit: '50', ...(cursor ? { afterId: cursor } : {}) })}`, null, a.signal)
        .then(r => { if (!a.signal.aborted && active.current === key) setData(r); }).catch(e => { if (!a.signal.aborted) setError(e.message); });
      return () => a.abort();
    }, [workspace, entity, cursor, nonce]);
    async function command(body) {
      const key = active.current, fingerprint = JSON.stringify([workspace, body]);
      const id = pending.current?.fingerprint === fingerprint ? pending.current.id : crypto.randomUUID();
      pending.current = { fingerprint, id }; setBusy(true); setError('');
      try {
        const result = await request(`/workspaces/${encodeURIComponent(workspace)}/command`, { ...body, requestId: id });
        pending.current = null;
        if (active.current === key) { refresh(n => n + 1); setNotice('已保存'); }
        return result;
      } catch (e) { if (active.current === key) setError(e.message); }
      finally { if (active.current === key) setBusy(false); }
    }
    async function select(row) {
      const key = active.current, sequence = ++detailRequest.current; setError('');
      try { const result = await request(`/workspaces/${encodeURIComponent(workspace)}/read?${new URLSearchParams({ entity, id: row.id })}`); if (active.current === key && sequence === detailRequest.current) { setDetail(result); setStock(String(result.stockTotal ?? 0)); } }
      catch (e) { if (active.current === key) setError(e.message); }
    }
    async function startBinding() {
      const key = active.current; setError('');
      try { const r = await request('/catalog'); if (active.current !== key) return; setCatalog(r.items); setSourceId(''); setSkuId(''); setStock('0'); setBinding(true); }
      catch (e) { if (active.current === key) setError(e.message); }
    }
    const selected = catalog.find(p => p.id === sourceId);
    const price = row => row.unitPriceMinor === null ? '待询价' : `${row.currency} ${(row.unitPriceMinor / 100).toFixed(2)}`;
    const items = data?.items ?? [];
    const field = (label, node) => h('label', null, label, node);
    const selectEntity = next => { setEntity(next); setCursor(''); setDetail(null); setBinding(false); };
    return h('div', { className: 'me' }, h('style', null, css),
      h('header', null, h('div', null, h('h1', null, 'ERP 经营后台'), h('small', null, '商品资料沿用产品库，交易记录统一在 ERP')),
        field('经营工作区', h('select', { value: workspace, disabled: busy, onChange: e => { setWorkspace(e.target.value); setCursor(''); } }, workspaces.map(w => h('option', { key: w.id, value: w.id }, w.title || w.id))))),
      h('div', { className: 'body' }, h('nav', { 'aria-label': 'ERP 导航' }, Object.entries(labels).map(([key, label]) => h('button', { key, disabled: busy, className: entity === key ? 'selected' : '', onClick: () => selectEntity(key) }, label)),
        h('button', { onClick: () => openLibrary('documents') }, '资料与媒体')),
        h('main', null, error ? h('p', { role: 'alert', className: 'error' }, error) : null, notice ? h('p', { role: 'status' }, notice) : null,
          !workspace ? h('div', { className: 'card' }, '请先在 DSH 创建或选择一个工作区。') : null,
          h('div', { className: 'toolbar' }, h('h2', null, labels[entity]), h('div', null,
            entity === 'product' ? h(React.Fragment, null, h('button', { disabled: busy, onClick: () => openLibrary('productNew') }, '创建商品'), ' ', h('button', { disabled: !workspace || busy, onClick: startBinding }, '关联已有 SKU'), ' ') : null,
            h('button', { disabled: busy, onClick: () => refresh(n => n + 1) }, '刷新'))),
          binding ? h('form', { className: 'card', onSubmit: e => { e.preventDefault(); if (!selected || !skuId) return;
            const fingerprint = JSON.stringify([workspace, sourceId, skuId, stock]);
            const ledgerId = pending.current?.bindingFingerprint === fingerprint ? pending.current.ledgerId : crypto.randomUUID();
            // Stable ledger identifier and request id are kept on an uncertain retry.
            const body = { action: 'link_sku', id: ledgerId, catalogProductId: sourceId, skuId, catalogRevision: selected.revision, stockTotal: Number(stock) };
            command(body); pending.current = { ...pending.current, bindingFingerprint: fingerprint, ledgerId };
          } }, h('h2', null, '关联产品库 SKU'), h('p', null, '明确选择归属当前工作区的 SKU，并填写可供应总量。图片、规格和报价继续在产品库维护。'),
            h('div', { className: 'grid' }, field('产品', h('select', { required: true, value: sourceId, disabled: busy, onChange: e => { setSourceId(e.target.value); setSkuId(''); } }, h('option', { value: '' }, '选择产品'), catalog.map(p => h('option', { key: p.id, value: p.id }, p.name)))),
              field('SKU', h('select', { required: true, value: skuId, disabled: busy, onChange: e => setSkuId(e.target.value) }, h('option', { value: '' }, '选择 SKU'), (selected?.skus ?? []).map(s => h('option', { key: s.id, value: s.id }, s.code || s.id)))),
              field('累计可供应数量', h('input', { type: 'number', min: 0, max: 1e9, step: 1, required: true, value: stock, disabled: busy, onChange: e => setStock(e.target.value) }))),
            h('p', null, h('button', { type: 'submit', className: 'primary', disabled: busy || !skuId }, busy ? '正在保存…' : '确认关联'), ' ', h('button', { type: 'button', disabled: busy, onClick: () => setBinding(false) }, '取消'))) : null,
          detail ? h('section', { className: 'card' }, h('button', { onClick: () => { detailRequest.current++; setDetail(null); } }, '返回列表'), h('h2', null, detail.name || detail.id),
            entity === 'product' ? h(React.Fragment, null, h('span', { className: 'pill' }, states[detail.catalogStatus] || detail.catalogStatus), h('p', { className: 'detail' }, detail.description),
              h('div', { className: 'grid' }, h('p', null, 'SKU：', detail.skuCode || detail.id), h('p', null, '单价：', price(detail), detail.quoteQuantity ? h('small', null, `适用数量 ${detail.quoteQuantity} ${detail.unit || '件'}`) : null), h('p', null, '可分配：', detail.available), h('p', null, '起订量：', detail.moq ?? '待确认')),
              detail.quoteReason ? h('p', null, detail.quoteReason) : null,
              h('div', { className: 'images' }, (detail.images ?? []).map(img => h('img', { key: img.id, alt: img.alt || detail.name, src: `/workspace-library-api/products/${encodeURIComponent(detail.catalogProductId)}/images/${encodeURIComponent(img.id)}` }))),
              h('ul', null, (detail.specs ?? []).map(s => h('li', { key: s.key }, `${s.key}：${s.value}`))),
              h('p', null, `关联资料 ${detail.documents?.length ?? 0} 份`), detail.catalogProductId ? h('button', { onClick: () => openLibrary('product', detail.catalogProductId) }, '编辑商品、图片与资料') : null,
              h('form', { onSubmit: e => { e.preventDefault(); command({ action: 'update_stock', id: detail.id, expectedRevision: detail.revision, stockTotal: Number(stock), source: '经营者在 ERP 后台更新可供应数量' }); } }, h('p', null, '总量包含已确认和未到期预留的数量。'), field('累计可供应数量', h('input', { type: 'number', min: 0, max: 1e9, step: 1, required: true, value: stock, disabled: busy, onChange: e => setStock(e.target.value) })), h('p', null, h('button', { disabled: busy }, '保存数量')))) :
              entity === 'order' ? h(React.Fragment, null, h('p', null, `状态：${states[detail.status] || detail.status}`), h('p', null, `数量 ${detail.quantity} · ${detail.currency} ${(detail.totalMinor / 100).toFixed(2)}`), h('p', null, '订单确认不代表已收款或发货。'), detail.status === 'reserved' ? h('div', null, h('button', { disabled: busy, onClick: () => command({ action: 'confirm', orderId: detail.id }) }, '确认订单'), ' ', h('button', { disabled: busy, onClick: () => command({ action: 'cancel', orderId: detail.id }) }, '取消预留')) : null) :
              entity === 'buyer' ? h('p', null, detail.contact) : h('div', null, h('p', null, `${detail.territory} · ${detail.channel} · 可用 ${detail.availableSlots}`), h('p', null, detail.term), h('p', null, detail.conditions))) :
            h('div', { className: 'card table' }, !workspace ? '选择工作区后显示记录。' : !data ? '正在读取…' : !items.length ? '当前没有记录。' : h('table', null, h('thead', null, h('tr', null, h('th', null, '名称 / 编号'), h('th', null, '信息'), h('th', null, '状态 / 数量'))),
              h('tbody', null, items.map(row => h('tr', { key: row.id }, h('td', null, h('button', { onClick: () => select(row) }, row.name || row.id), row.skuCode ? h('small', null, row.skuCode) : null), h('td', null, entity === 'product' ? price(row) : entity === 'buyer' ? row.contact : entity === 'order' ? `${row.currency} ${(row.totalMinor / 100).toFixed(2)}` : `${row.territory} / ${row.channel}`), h('td', null, entity === 'product' ? `可分配 ${row.available}` : entity === 'order' ? states[row.status] : entity === 'offer' ? row.availableSlots : '已登记'))))),
              data?.hasMore ? h('button', { onClick: () => setCursor(data.nextCursor) }, '下一页') : null, cursor ? h('button', { onClick: () => setCursor('') }, '返回首页') : null))));
  }
  function apply(ctx) {
    const openLibrary = (page, id) => {
      const target = { page, id }; sessionStorage.setItem('workspace-library-navigation', JSON.stringify(target));
      ctx.get('layout').selectPanel('workspace-library');
      window.dispatchEvent(new CustomEvent('workspace-library:navigate', { detail: target }));
    };
    const icon = () => h('span', null, '▦');
    ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: NS, order: 25, label: () => 'ERP' }, icon)), 'mini-erp: sidebar');
    ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: NS }, () => h(Panel, { openLibrary }))), 'mini-erp: panel');
  }
  return { apply, inject: ['slots'], Panel };
} });
