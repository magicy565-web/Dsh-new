window.__ModuleLoader__.load({ id: 'dsh-mini-erp', factory(require) {
  const React = require('react'), { useState, useEffect, useRef } = React, h = React.createElement;
  const { ProductEditorSurface, FileSurface, CompanySettingsSurface } = require('dsh-workspace-library');
  const API = '/mini-erp-api', NS = 'mini-erp';
  async function request(path, body, signal) {
    const response = await fetch(API + path, { credentials: 'same-origin', cache: 'no-store', signal,
      ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      const messages = { CATALOG_CHANGED: '商品资料已更新，请核对新报价后重新提交。', REVISION_CONFLICT: '供应数量已更新，请重新读取后提交。', CUSTOMER_CHANGED: '客户资料已被修改，请返回列表重新读取后再编辑。',
        QUOTE_REQUIRED: '当前数量没有可用报价，请核对起订量和价格档。', OUT_OF_STOCK: '可供应数量不足，请调整采购数量。',
        NO_SLOTS: '这个供货名额已满或已截止，请重新选择。', ALREADY_HELD: '该客户已持有此供货权益，请查看已有订单。',
        CATALOG_UNAVAILABLE: '商品资料已归档或不可用，请核对原产品库。', ORDER_STATE: '订单状态已变化，请重新读取订单。' };
      const error = new Error(messages[result.error?.code] || result.error?.message || `HTTP ${response.status}`);
      error.code = result.error?.code; error.status = response.status;
      error.rejected = response.status >= 400 && response.status < 500 && result.ok === false && error.code !== 'IDEMPOTENCY_CONFLICT';
      throw error;
    }
    return result.data;
  }
  const labels = { order: '订单', product: '库存', buyer: '客户' };
  const descriptions = {
    product: '管理商品报价、采购条件与可供应数量。', buyer: '查看客户资料，保持每一笔交易的客户信息清晰。',
    order: '跟进采购预留，确认订单或释放尚未成交的数量。',
  };
  const states = { reserved: '已预留', confirmed: '已确认', cancelled: '已取消', expired: '已到期', linked: '已关联', unavailable: '来源不可用', 'legacy-unlinked': '待关联' };
  const paths = {
    home: 'm3 10 9-7 9 7v11H3V10ZM9 21v-8h6v8', chart: 'M4 3v18h17M8 16v-4M13 16V8M18 16V5',
    settings: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    store: 'M3 10v11h18V10M2 10l2-7h16l2 7M2 10c1 3 4 3 5 0 1 3 4 3 5 0 1 3 4 3 5 0 1 3 4 3 5 0M9 21v-7h6v7',
    cart: 'M2 3h3l3 12h11l3-9H6M10 20h.01M18 20h.01', collection: 'M3 3h7v7H3V3ZM14 3h7v7h-7V3ZM3 14h7v7H3v-7ZM14 14h7v7h-7v-7',
    inventory: 'M3 21V7l9-4 9 4v14M7 21V10h10v11M7 14h10M7 18h10', transfer: 'M3 7h17l-4-4M21 17H4l4 4',
    gift: 'M3 8h18v5H3V8ZM5 13v8h14v-8M12 8v13M12 8C1 8 5-2 12 8c7-10 11 0 0 0Z',
    segments: 'M3 4h18l-7 8v7l-4 2v-9L3 4Z', marketing: 'M3 10h5l12-5v14L8 14H3v-4ZM8 14l2 7H6l-2-7M20 9l2 1v4l-2 1',
    automation: 'm13 2-9 12h7l-1 8 10-13h-8l1-7Z', discount: 'M3 3h8l10 10-8 8L3 11V3ZM7 7h.01',
    globe: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM2 12h20M12 2c6 5 6 15 0 20-6-5-6-15 0-20Z',
    activity: 'M2 12h5l3-8 4 16 3-8h5', wallet: 'M3 5h17v16H3V5ZM3 5V3h14v2M14 11h7v5h-7v-5ZM17 13.5h.01',
    palette: 'M12 3a9 9 0 1 0 0 18c4 0-1-5 3-5h3c5 0 3-13-6-13ZM7 8h.01M12 6h.01M17 9h.01M6 13h.01',
    apps: 'M3 3h7v7H3V3ZM14 3h7v7h-7V3ZM3 14h7v7H3v-7ZM14 14h7v7h-7v-7',
    truck: 'M1 4h13v13H1V4ZM14 9h5l4 5v3h-9M7 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM21 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
    pin: 'M12 22S4 14 4 9a8 8 0 1 1 16 0c0 5-8 13-8 13ZM15 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    bell: 'M4 17h16l-2-4V8a6 6 0 0 0-12 0v5l-2 4ZM9 21h6', down: 'm6 9 6 6 6-6', download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    product: 'M12 3 3 7.5v9L12 21l9-4.5v-9L12 3ZM3 7.5l9 4.5 9-4.5M12 12v9M7.5 5.25l9 4.5v4.5',
    buyer: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    order: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 7h6M9 11h6M9 15h3',
    folder: 'M3 7V4h6l3 3h9v13H3V7Z', document: 'M14 2H5v20h14V7l-5-5ZM14 2v5h5M8 12h8M8 16h6',
    menu: 'M4 6h16M4 12h16M4 18h16',
    plus: 'M12 5v14M5 12h14', search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
    refresh: 'M20 7v5h-5M4 17v-5h5M5.5 6.5A8 8 0 0 1 20 12M4 12a8 8 0 0 0 14.5 5.5',
    arrow: 'M5 12h14M14 7l5 5-5 5', back: 'M19 12H5M10 7l-5 5 5 5', close: 'm6 6 12 12M6 18 18 6',
    link: 'm10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
    info: 'M12 11v6M12 7v.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z', check: 'm5 12 4 4L19 6',
  };
  // Own 20px navigation silhouettes; utility icons retain the 24px outline grid.
  const solidPaths = {
    home: 'M9.4 2.2a1 1 0 0 1 1.2 0l6.5 5.1a1 1 0 0 1 .4.8V16a2 2 0 0 1-2 2H12v-5H8v5H4.5a2 2 0 0 1-2-2V8.1a1 1 0 0 1 .4-.8l6.5-5.1Z',
    order: 'M5 2h10a1 1 0 0 1 1 1v15l-3-1.5-3 1.5-3-1.5L4 18V3a1 1 0 0 1 1-1Zm2 4v1.5h6V6H7Zm0 3.5V11h6V9.5H7Zm0 3.5v1.5h4V13H7Z',
    product: 'M3 3h7.3a2 2 0 0 1 1.4.6l6 6a2 2 0 0 1 0 2.8l-5.3 5.3a2 2 0 0 1-2.8 0l-6-6a2 2 0 0 1-.6-1.4V3Zm4 2.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
    buyer: 'M10 2a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0 9c-4.1 0-7 2.3-7 5.5V18h14v-1.5c0-3.2-2.9-5.5-7-5.5Z',
    marketing: 'M4 7h3l8-4v12l-8-4H4a2 2 0 0 1-2-2 2 2 0 0 1 2-2Zm1 5h2l2 5H6l-1-5Zm11-6h1a3 3 0 0 1 0 6h-1V6Z',
    discount: 'm10 1 2.4 1.8 3-.1.9 2.8L19 7l-.9 3 .9 3-2.7 1.5-.9 2.8-3-.1L10 19l-2.4-1.8-3 .1-.9-2.8L1 13l.9-3L1 7l2.7-1.5.9-2.8 3 .1L10 1ZM6 6a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Zm7.3-.3-7.6 7.6 1 1 7.6-7.6-1-1ZM11 14a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z',
    document: 'M5 2h6l5 5v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm6 1.5V7h3.5L11 3.5ZM7 10v1.5h6V10H7Zm0 3.5V15h6v-1.5H7Z',
    chart: 'M3 11h3v7H3v-7Zm5-5h3v12H8V6Zm5-4h3v16h-3V2Z',
    wallet: 'M4 3h11v2H4a1 1 0 0 0 0 2h13v3h-5v5h5v2a1 1 0 0 1-1 1H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm9 8h5v3h-5v-3Zm1 1v1h1v-1h-1Z',
    apps: 'M3 3h5v5H3V3Zm0 9h5v5H3v-5Zm9 0h5v5h-5v-5Zm2.5-10 4 4-4 4-4-4 4-4Z',
    folder: 'M3 4h5l2 2h7a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z',
    inventory: 'm2 6 8-4 8 4v12h-3V9H5v9H2V6Zm5 5h6v2H7v-2Zm0 4h6v3H7v-3Z',
    store: 'M4 2h12l2 5H2l2-5ZM2 8h16v1a2 2 0 0 1-4 0 2 2 0 0 1-4 0 2 2 0 0 1-4 0 2 2 0 0 1-4 0V8Zm1 4a3 3 0 0 0 3-.8A3 3 0 0 0 10 11a3 3 0 0 0 4 .2 3 3 0 0 0 3 .8v6h-5v-5H8v5H3v-6Z',
    settings: 'm8 1-.5 2-1.3.8-2-.6-2 3.5L3.7 8v1.5L2.2 11l2 3.5 2-.6 1.3.8.5 2h4l.5-2 1.3-.8 2 .6 2-3.5-1.5-1.5V8l1.5-1.3-2-3.5-2 .6-1.3-.8-.5-2H8Zm2 4.5a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5Z',
  };
  const Icon = ({ name, size = 20 }) => {
    const solid = solidPaths[name];
    return h('svg', { className: 'me-icon', 'data-icon': name, width: size, height: size, viewBox: solid ? '0 0 20 20' : '0 0 24 24',
      fill: solid ? 'currentColor' : 'none', stroke: solid ? 'none' : 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' },
      h('path', { d: solid || paths[name] || paths.product, fillRule: 'evenodd', clipRule: 'evenodd' }));
  };
  const button = (label, onClick, options = {}) => {
    const { icon, className = '', ...props } = options;
    return h('button', { type: 'button', className: `me-button ${className}`, onClick, ...(!label && props['aria-label'] ? { title: props['aria-label'] } : {}), ...props }, icon ? h(Icon, { name: icon, size: 16 }) : null, label);
  };
  const field = (label, node, hint) => h('label', { className: 'me-field' }, h('span', null, label), node, hint ? h('small', null, hint) : null);
  const badge = (value, text) => h('span', { className: `me-badge me-badge-${value || 'neutral'}` }, h('span', { className: 'me-dot' }), text || states[value] || value);
  const money = (value, currency) => value == null ? '待询价' : `${currency} ${(value / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const price = row => money(row.unitPriceMinor, row.currency);
  const shortId = id => `#${id.slice(0, 8)}`;
  const clock = value => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '';
  const imageUrl = (row, img) => `/workspace-library-api/products/${encodeURIComponent(row.catalogProductId)}/images/${encodeURIComponent(img.id)}`;
  function EmptyArtwork({ entity }) {
    // An illustration of an empty catalogue, not placeholder business records.
    return h('div', { className: 'me-art', 'aria-hidden': true },
      h('div', { className: 'me-art-sheet me-art-sheet-back' }),
      h('div', { className: 'me-art-sheet' }, h('div', { className: 'me-art-picture' }, h(Icon, { name: entity, size: 43 })), h('i'), h('i')),
      h('div', { className: 'me-art-tag' }, h(Icon, { name: 'plus', size: 19 })));
  }
  const css = `
.me{--me-canvas:#f4f5f5;--me-surface:var(--dsw-alias-bg-base,#fff);--me-ink:var(--dsw-alias-label-primary,#202223);--me-muted:var(--dsw-alias-label-secondary,#676b70);--me-line:var(--dsw-alias-border-l2,#dedfe1);--me-soft:var(--dsw-alias-bg-layer-2,#f6f7f7);--me-primary:#303030;--me-primary-ink:#fff;--me-green:#176349;--me-tint:#eaf4ee;height:100%;min-height:0;overflow:auto;background:var(--me-canvas);color:var(--me-ink);font:13px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans SC',sans-serif;container-type:inline-size}
.me *{box-sizing:border-box}.me button,.me input,.me select{font:inherit;color:inherit}.me button{cursor:pointer}.me button:disabled{cursor:not-allowed;opacity:.46}.me button,.me input,.me select{transition:background .14s,border-color .14s,box-shadow .14s}.me button:focus-visible,.me input:focus-visible,.me select:focus-visible,.me summary:focus-visible{outline:2px solid #4583d5;outline-offset:3px}.me svg{flex-shrink:0}.me h1,.me h2,.me h3,.me p{margin:0}.me h1{font-size:26px;letter-spacing:-.6px;line-height:1.35;font-weight:680}.me h2{font-size:15px;font-weight:650}.me h3{font-size:14px}.me small{font-size:12px;color:var(--me-muted)}.me p,.me dd{overflow-wrap:anywhere}.me input,.me select{min-width:0;border:1px solid var(--me-line);border-radius:7px;background:var(--me-surface);padding:8px 11px;min-height:36px}.me input:hover,.me select:hover{border-color:#a5a8ac}.me input:disabled{background:var(--me-soft)}
.me-topbar{height:64px;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:0 32px;background:var(--me-surface);border-bottom:1px solid var(--me-line)}.me-brand{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:650;white-space:nowrap}.me-brand-mark{width:29px;height:29px;border-radius:8px;display:grid;place-items:center;background:var(--me-primary);color:var(--me-primary-ink)}.me-brand small{font-size:10px;letter-spacing:1px;margin-left:3px;font-weight:500}.me-workspace{display:flex;align-items:center;gap:8px;color:var(--me-muted);min-width:0}.me-workspace select{max-width:220px;font-size:12px;font-weight:550;border:0;background:var(--me-soft);padding-right:26px}.me-nav{display:flex;gap:26px;padding:0 32px;overflow:auto;background:var(--me-surface);border-bottom:1px solid var(--me-line);scrollbar-width:thin}.me-nav button{display:flex;align-items:center;gap:7px;background:none;border:0;border-bottom:2px solid transparent;padding:15px 0 13px;white-space:nowrap;font-weight:550;color:var(--me-muted);border-radius:0}.me-nav button:hover{color:var(--me-ink)}.me-nav button[aria-current=page]{border-bottom-color:var(--me-ink);color:var(--me-ink)}.me-nav .me-nav-library{margin-left:auto}
.me-main{max-width:1200px;margin:0 auto;padding:30px 32px 48px;min-width:0}.me-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}.me-heading p{color:var(--me-muted);margin-top:6px;line-height:1.7}.me-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.me-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:33px;padding:6px 12px;border:1px solid var(--me-line);border-radius:7px;background:var(--me-surface);box-shadow:0 1px 1px #00000008;font-size:12px!important;font-weight:550;white-space:nowrap;text-decoration:none}.me-button:hover:not(:disabled){background:var(--me-soft);border-color:#b9bcc0}.me-button-primary{color:var(--me-primary-ink)!important;background:var(--me-primary);border-color:var(--me-primary);box-shadow:inset 0 1px #ffffff25,0 1px 2px #00000015}.me-button-primary:hover:not(:disabled){background:#454545;border-color:#454545}.me-button-plain{border-color:transparent;background:transparent;box-shadow:none;color:var(--me-muted)!important}.me-button-plain:hover:not(:disabled){border-color:transparent}.me-icon-button{width:33px;padding:6px}.me-text-button{border:0;background:none;padding:0;color:var(--me-green)!important;box-shadow:none;white-space:normal;justify-content:flex-start}.me-text-button:hover:not(:disabled){background:none;text-decoration:underline}.me-heading-title{display:flex;align-items:flex-start;gap:12px;min-width:0}.me-heading-title h1{overflow-wrap:anywhere}.me-back{margin-top:2px}.me-reference{font-size:11px;font-family:ui-monospace,monospace;color:var(--me-muted);overflow-wrap:anywhere}
.me-alert{display:flex;align-items:flex-start;gap:10px;border-radius:8px;padding:12px 15px;margin-bottom:20px;border:1px solid #e0d4b5;background:#fcf8ec;color:#6d5429}.me-alert strong{font-weight:600}.me-alert p{font-size:12px;margin-top:3px}.me-alert-error{background:#fff1f0;border-color:#f0c9c5;color:#9b342a}.me-alert-success{background:var(--me-tint);border-color:#cde1d4;color:var(--me-green)}.me-alert .me-button{margin-left:auto}.me-card{min-width:0;border:1px solid var(--me-line);border-radius:11px;background:var(--me-surface);box-shadow:0 1px 3px #00000006;overflow:hidden}.me-card+.me-card{margin-top:18px}.me-card-header{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px 20px;border-bottom:1px solid var(--me-line)}.me-card-body{padding:20px}.me-card-header p{color:var(--me-muted);font-size:12px;margin-top:4px}.me-list-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 16px;border-bottom:1px solid var(--me-line)}.me-view-label{display:inline-flex;align-items:center;font-weight:600;white-space:nowrap;padding:6px 10px;background:var(--me-soft);border-radius:6px}.me-list-controls{display:flex;gap:8px;align-items:center;min-width:0}.me-search{display:flex;align-items:center;gap:7px;padding:0 9px;border:1px solid var(--me-line);border-radius:7px;color:var(--me-muted);width:230px;max-width:100%;background:var(--me-surface)}.me-search:focus-within{outline:2px solid #4583d5;outline-offset:1px}.me-search input{border:0;background:none;outline:0!important;width:100%;padding:7px 0;font-size:12px;min-height:31px}.me-search:has(input:disabled){opacity:.55}.me-table-wrap{overflow-x:auto}.me table{width:100%;border-collapse:collapse;text-align:left;font-size:12px}.me th{color:var(--me-muted);font-weight:550;font-size:11px;background:var(--me-soft);padding:10px 16px;border-bottom:1px solid var(--me-line);white-space:nowrap}.me td{padding:15px 16px;border-bottom:1px solid var(--me-line);vertical-align:middle}.me tbody tr:last-child td{border-bottom:0}.me tbody tr:not(.me-empty-row):hover{background:var(--me-soft)}.me-product-cell{display:flex;align-items:center;gap:12px;min-width:180px}.me-thumb{width:42px;height:42px;border-radius:7px;border:1px solid var(--me-line);background:var(--me-soft);display:grid;place-items:center;flex-shrink:0;overflow:hidden;color:var(--me-muted)}.me-thumb img{width:100%;height:100%;object-fit:cover}.me-record-button{font-size:13px!important;font-weight:600;color:var(--me-ink)!important;text-align:left;max-width:260px;overflow-wrap:anywhere}.me-row-sub{font-size:11px;color:var(--me-muted);margin-top:3px;max-width:230px;overflow-wrap:anywhere}.me-number{font-variant-numeric:tabular-nums;white-space:nowrap}.me-quiet{color:var(--me-muted)}.me-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:3px 7px;border-radius:5px;white-space:nowrap;background:var(--me-soft);color:var(--me-muted);font-weight:500}.me-dot{width:5px;height:5px;border-radius:50%;background:currentColor}.me-badge-linked,.me-badge-confirmed{background:var(--me-tint);color:var(--me-green)}.me-badge-reserved,.me-badge-legacy-unlinked{background:#fff1d6;color:#836225}.me-badge-unavailable{background:#ffece9;color:#a0392c}.me-list-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;border-top:1px solid var(--me-line);font-size:11px;color:var(--me-muted)}.me-list-footer .me-actions{flex-shrink:0}.me-page-note{display:flex;align-items:center;justify-content:center;gap:6px;color:var(--me-muted);font-size:11px;margin:20px 0 0;text-align:center}.me-empty-cell{padding:0!important}.me-empty{min-height:330px;text-align:center;padding:38px 24px 42px;display:flex;align-items:center;flex-direction:column;justify-content:center}.me-empty h2{font-size:17px;letter-spacing:-.2px;margin:16px 0 8px}.me-empty p{color:var(--me-muted);max-width:380px;line-height:1.9;font-size:12px}.me-empty .me-button{margin-top:18px}.me-empty-icon{width:52px;height:52px;border-radius:14px;background:var(--me-soft);display:grid;place-items:center;color:var(--me-muted)}.me-art{position:relative;width:150px;height:115px;margin-bottom:2px}.me-art-sheet{position:absolute;left:39px;top:10px;width:81px;height:100px;border:1px solid var(--me-line);border-radius:9px;background:var(--me-surface);box-shadow:0 5px 12px #00000006;transform:rotate(7deg);padding:9px}.me-art-sheet-back{transform:rotate(-11deg);left:22px;top:4px;background:var(--me-soft)}.me-art-picture{height:58px;border-radius:5px;background:var(--me-tint);display:grid;place-items:center;color:var(--me-green)}.me-art-sheet i{display:block;height:4px;border-radius:3px;background:var(--me-line);margin-top:7px;width:41px}.me-art-sheet i:last-child{width:26px;margin-top:4px}.me-art-tag{position:absolute;bottom:-3px;right:17px;width:29px;height:29px;border:3px solid var(--me-surface);border-radius:50%;background:var(--me-primary);color:var(--me-primary-ink);display:grid;place-items:center}.me-loading{padding:22px 20px;min-height:280px}.me-loading p{margin-bottom:22px;color:var(--me-muted)}.me-skeleton{height:44px;border-radius:6px;background:var(--me-soft);margin-bottom:14px;animation:me-pulse 1.4s ease-in-out infinite alternate}.me-skeleton:nth-child(3){width:86%}.me-skeleton:nth-child(4){width:93%}@keyframes me-pulse{to{opacity:.45}}
.me-binding{margin-bottom:20px}.me-binding .me-card-header{align-items:flex-start}.me-form-grid{display:grid;grid-template-columns:1.4fr 1fr .7fr;gap:18px}.me-field{display:flex;flex-direction:column;gap:7px;min-width:0;font-size:12px;font-weight:550}.me-field small{font-size:11px;line-height:1.7;font-weight:400}.me-form-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:22px;padding-top:16px;border-top:1px solid var(--me-line)}.me-detail-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:20px;align-items:start}.me-detail-grid>div{min-width:0}.me-detail-description{line-height:1.9;white-space:pre-wrap;margin-bottom:22px!important}.me-definition{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:0}.me-definition>div{min-width:0}.me-definition dt{font-size:11px;color:var(--me-muted);margin-bottom:5px}.me-definition dd{margin:0;font-size:13px}.me-media{display:flex;gap:12px;flex-wrap:wrap}.me-media img{width:115px;height:115px;border:1px solid var(--me-line);border-radius:8px;object-fit:contain;background:white}.me-no-media{width:100%;display:flex;gap:12px;align-items:center;padding:16px;border:1px dashed var(--me-line);border-radius:8px;color:var(--me-muted);background:var(--me-soft);font-size:12px}.me-related{display:flex;align-items:center;gap:10px;margin-top:18px;font-size:12px}.me-related small{margin-left:auto}.me-stat{font-size:31px;font-weight:600;letter-spacing:-.7px;line-height:1.3;font-variant-numeric:tabular-nums;margin:4px 0}.me-stat small{font-size:12px;margin-left:5px;font-weight:400;letter-spacing:0}.me-data-row{display:flex;justify-content:space-between;gap:15px;margin:10px 0;color:var(--me-muted);font-size:12px}.me-data-row b{font-weight:550;color:var(--me-ink)}.me-stock-form{margin-top:19px;padding-top:18px;border-top:1px solid var(--me-line)}.me-stock-form .me-button{width:100%;margin-top:14px}.me-help{font-size:11px;color:var(--me-muted);margin-top:13px;line-height:1.8}.me-help summary{cursor:pointer}.me-help p{margin-top:7px}.me-quote{font-size:23px;font-weight:650;letter-spacing:-.4px;margin-bottom:5px}.me-tiers{width:100%;margin-top:17px}.me-tiers td,.me-tiers th{padding:8px 0;font-size:11px}.me-tiers th{background:none}.me-tiers td:last-child,.me-tiers th:last-child{text-align:right}.me-detail-actions{padding-top:18px;border-top:1px solid var(--me-line);margin-top:18px}.me-detail-actions .me-button{flex:1}.me-terms{white-space:pre-wrap;font-size:13px;line-height:1.9}.me-section-label{font-size:11px;color:var(--me-muted);margin-bottom:6px!important}.me-space-top{margin-top:20px!important}
/* Shared visual and interaction finish: navigation silhouettes, utility outlines. */
.me{--me-focus:#005bd3;--me-hover:color-mix(in srgb,var(--me-ink) 5%,var(--me-surface));--me-pressed:color-mix(in srgb,var(--me-ink) 9%,var(--me-surface));text-rendering:optimizeLegibility}
.me .me-icon{display:block;flex:none;vertical-align:middle}.me h1:focus{outline:none;box-shadow:none}.me-heading h1{font-weight:650;letter-spacing:-.4px}.me-heading p{line-height:1.65}.me th{color:var(--me-muted);font-weight:550}.me td{font-variant-numeric:tabular-nums}.me .me-button{font-weight:500}.me .me-button:active:not(:disabled){background:var(--me-pressed);box-shadow:inset 0 1px 2px #00000012}.me .me-button-primary:active:not(:disabled){background:#242424;color:white;box-shadow:inset 0 2px 2px #0004}.me button:disabled{cursor:default;opacity:.45}
.me :is(button,a,input,select,textarea,summary,[tabindex]):focus-visible{outline:2px solid var(--me-focus);outline-offset:2px;box-shadow:0 0 0 4px color-mix(in srgb,var(--me-focus) 13%,transparent)}.me .me-command-input input:focus-visible{outline:0!important;box-shadow:none}.me .me-command-input:focus-within{box-shadow:inset 0 -2px var(--me-focus)}
.me .me-nav{padding:16px 12px 12px}.me .me-nav button{font-weight:450;min-height:34px;gap:9px;transition:background .12s,color .12s;letter-spacing:.05px}.me .me-nav button .me-icon{width:20px;height:20px;display:block;color:#777b7e}.me .me-nav button:hover:not(:disabled){background:var(--me-hover)}.me .me-nav button:active:not(:disabled){background:var(--me-pressed);box-shadow:none}.me .me-nav button[aria-current=page]{background:var(--me-surface);box-shadow:0 1px 3px #0000000c;font-weight:650}.me .me-nav button[aria-current=page] .me-icon,.me .me-nav-row[data-current=true]>.me-button:first-child .me-icon{color:var(--me-ink)}.me .me-nav-row[data-current=true]>.me-button:first-child{color:var(--me-ink);font-weight:650}.me .me-nav .me-nav-expand{min-height:28px;width:28px;top:3px}.me .me-nav-expand .me-icon{width:14px;height:14px;transition:transform .16s ease}.me .me-nav-expand[aria-expanded=true] .me-icon{transform:rotate(180deg)}.me .me-nav-children{margin:3px 0 6px 19px;padding:0 0 0 12px;border-left:1px solid var(--me-line)}.me .me-nav-children button{font-size:12px!important;min-height:31px;font-weight:450}.me .me-nav-divider{font-weight:600;font-size:11px;letter-spacing:.3px;padding-top:22px}.me .me-nav-bottom{padding-top:20px}
.me .me-topbar .me-icon-button:hover{background:#383838;color:#fff}.me .me-topbar .me-icon-button:active{background:#484848}.me .me-global-search{transition:background .12s,border-color .12s}.me .me-global-search:hover{background:#414141;border-color:#666}.me .me-global-search:active{background:#4a4a4a}.me .me-global-search kbd{font-family:inherit;font-size:10px;line-height:1.6;white-space:nowrap;padding:1px 5px;border-color:#606060;color:#d8d8d8}.me .me-topbar select:focus-visible{outline-color:#a5c7ff}
.me .me-list-toolbar{padding:10px 12px}.me .me-views .me-button[aria-pressed=true]{background:var(--me-pressed);box-shadow:inset 0 1px 1px #00000006}.me .me-check-cell input{width:16px;height:16px;min-height:0;padding:0;vertical-align:middle;accent-color:var(--me-ink);cursor:pointer}.me .me-table-wrap tbody tr:not(.me-empty-row):hover{background:var(--me-hover)}.me .me-table-wrap tr[data-selected=true]{background:var(--me-soft)}.me .me-table-wrap tr[data-selected=true]:hover{background:var(--me-pressed)}.me .me-table-wrap tbody tr:focus-within{background:var(--me-hover)}.me .me-selection-bar{background:var(--me-soft);border-block:1px solid var(--me-line);padding:9px 16px}.me .me-selection-bar strong{font-size:12px}.me .me-record-button{color:var(--me-ink)!important;text-decoration:none;font-weight:550}.me .me-record-button:hover:not(:disabled){text-decoration:underline;text-underline-offset:3px}.me .me-thumb{color:var(--me-muted);background:var(--me-soft)}.me .me-thumb .me-icon{width:20px;height:20px;opacity:.7}
.me .me-search{gap:7px}.me .me-search:focus-within{outline:2px solid var(--me-focus);outline-offset:1px;border-color:transparent}.me .me-search input:focus-visible{outline:none;box-shadow:none}.me .me-search-clear{flex:none;width:25px;min-height:25px;padding:4px;margin-right:3px}.me .me-search input::-webkit-search-cancel-button,.me .me-command-input input::-webkit-search-cancel-button{display:none}.me .is-loading>.me-icon{animation:me-spin .9s linear infinite}@keyframes me-spin{to{transform:rotate(360deg)}}
.me .me-command-dialog{border-radius:14px;box-shadow:0 24px 80px #0004,0 0 0 1px #00000008}.me .me-command-label{font-size:11px;letter-spacing:.2px;padding:14px 12px 7px;font-weight:550}.me .me-search-result{font-weight:450;padding:8px 11px;gap:11px;min-height:46px}.me .me-result-icon{width:30px;height:30px;display:grid;place-items:center;flex:none;border-radius:7px;background:var(--me-surface);border:1px solid var(--me-line);color:var(--me-muted)}.me .me-result-icon .me-icon{width:18px;height:18px}.me .me-search-result>span:not(.me-result-icon){flex:1}.me .me-search-result:hover:not([aria-selected=true]){background:transparent}.me .me-search-result[aria-selected=true]{background:var(--me-soft);box-shadow:inset 0 0 0 1px var(--me-line)}.me .me-search-result>svg:last-child{opacity:0;transition:opacity .12s}.me .me-search-result[aria-selected=true]>svg:last-child{opacity:1}.me .me-command-dialog footer{padding:12px 16px;font-size:11px;align-items:center}.me .me-command-dialog kbd{display:inline-block;background:var(--me-soft);border:1px solid var(--me-line);border-radius:4px;min-width:19px;text-align:center;padding:0 3px;font-family:inherit;font-size:11px;line-height:18px}.me .me-command-empty{display:flex;align-items:center;flex-direction:column;gap:10px;text-align:center;padding:40px 18px}.me .me-command-empty strong{color:var(--me-ink);font-size:14px}.me .me-command-empty p{font-size:12px}.me .me-command-error{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;font-size:12px}.me .me-command-error button{flex-shrink:0}
.me .me-settings-nav button:hover{background:var(--me-hover)}.me .me-settings-nav .me-icon{width:18px;height:18px}.me .me-settings-nav button[aria-current=page]{font-weight:650}.me :is(.wl-admin-editor,.wl-admin-company,.wl-admin-file) :is(input,textarea,select):hover:not(:disabled){border-color:var(--me-muted)}.me .wl-btn{transition:background .12s,border-color .12s,box-shadow .12s}.me .wl-btn:active:not(:disabled){box-shadow:inset 0 1px 3px #0002}.me .me-toast{padding:10px 12px 10px 16px;font-size:12px;line-height:1.6}.me .me-toast>.me-icon{color:#c8eac2}.me[data-appearance=dark] .me-nav button .me-icon{color:#b0b3b5}.me[data-appearance=dark] .me-nav button[aria-current=page] .me-icon{color:var(--me-ink)}
@container(max-width:900px){.me .me-shell .me-nav{z-index:15;width:238px;max-width:calc(100% - 40px);padding:12px;background:var(--me-canvas)}.me .me-nav button{min-height:40px}.me .me-nav .me-nav-expand{width:36px;min-height:36px;top:2px}.me .me-nav-children button{min-height:38px}.me .me-nav .me-drawer-close{margin-bottom:12px;justify-content:flex-start;gap:10px;font-size:12px!important;color:var(--me-muted)}}
@container(max-width:650px){.me .me-icon-button{width:36px;min-height:36px}.me .me-topbar .me-mobile-menu{width:36px;min-height:36px}.me .me-list-toolbar{padding:10px}.me .me-command-dialog footer{align-items:flex-start;gap:7px}.me .me-command-input input{font-size:16px}.me .me-command-input .me-button-plain{min-height:36px}.me .me-command-error{align-items:flex-start;flex-direction:column}.me .me-search-clear{width:28px;min-height:28px}.me .me-heading .me-actions button{min-height:36px}}
@media(prefers-reduced-motion:reduce){.me *{transition:none!important;animation:none!important}}
@container(max-width:850px){.me-topbar{padding:0 22px}.me-nav{padding:0 22px;gap:23px}.me-main{padding:24px 22px}.me-detail-grid{grid-template-columns:minmax(0,1fr) 260px}.me-heading{gap:14px}.me-heading h1{font-size:23px}.me-heading .me-actions{justify-content:flex-end}.me-form-grid{grid-template-columns:1fr 1fr}.me-form-grid>.me-field:last-child{grid-column:1/-1}.me-search{width:190px}}
@container(max-width:650px){.me-topbar{padding:0 18px;height:58px;gap:12px}.me-brand small{display:none}.me-workspace{gap:4px}.me-workspace select{max-width:145px}.me-nav{padding:0 18px;gap:22px}.me-nav button{font-size:12px;padding:13px 0 11px}.me-nav svg{display:none}.me-nav .me-nav-library{margin-left:0}.me-main{padding:22px 16px 32px}.me-heading{align-items:flex-start;flex-direction:column;gap:17px;margin-bottom:20px}.me-heading h1{font-size:24px}.me-heading p{font-size:12px}.me-heading .me-actions{justify-content:flex-start}.me-detail-grid{grid-template-columns:1fr}.me-form-grid{grid-template-columns:1fr}.me-list-toolbar{flex-wrap:wrap;padding:12px}.me-list-controls{flex:1;justify-content:flex-end}.me-search{width:185px}.me-view-label{font-size:12px}.me-empty{padding:32px 20px;min-height:320px}.me-empty h2{font-size:16px}.me-card-header{padding:16px}.me-card-body{padding:16px}.me-card-header .me-text-button{font-size:11px!important;max-width:150px}.me-list-footer{padding:11px 12px;flex-wrap:wrap}.me-definition{gap:18px}.me-page-note{align-items:flex-start;font-size:10px}.me-brand{font-size:13px}.me-topbar select{font-size:11px}}
@container(max-width:380px){.me-workspace>svg{display:none}.me-workspace select{max-width:125px}.me-list-controls{flex-basis:100%;justify-content:space-between}.me-search{width:auto;flex:1}.me-nav{gap:20px}.me-brand-mark{width:26px;height:26px}.me-brand{gap:6px}.me-card-header{flex-wrap:wrap}}
:root[data-theme=dark] .me,.dark .me{--me-canvas:#191b1d;--me-primary:#e4e5e7;--me-primary-ink:#202223;--me-green:#8cd7b6;--me-tint:#20372e}.dark .me .me-button-primary:hover:not(:disabled),:root[data-theme=dark] .me .me-button-primary:hover:not(:disabled){background:#fff;border-color:#fff}

/* Resource-index and resource-detail layouts within the native DSH panel. */
.me{display:flex;flex-direction:column;overflow:hidden;--me-canvas:color-mix(in srgb,var(--me-surface) 95%,var(--me-ink))}.me-topbar{height:56px;min-height:56px;padding:0 20px;background:#1c1c1c;color:#f7f7f7;border-bottom:1px solid #111}.me-topbar .me-brand-mark{background:#444;color:white;width:27px;height:27px;border-radius:7px}.me-brand{font-size:13px}.me-brand small{color:#b7b7b7}.me-topbar-actions{display:flex;align-items:center;gap:14px;min-width:0}.me-topbar .me-workspace{color:#d9d9d9}.me-topbar select{background:#333;color:#f4f4f4;border:1px solid #4c4c4c;font-weight:500;min-height:30px;padding:4px 9px;max-width:205px}.me-topbar .me-host-toggle,.me-topbar .me-mobile-menu{background:transparent;border:0;color:#ddd;box-shadow:none}.me-topbar .me-host-toggle:hover,.me-topbar .me-mobile-menu:hover{background:#3e3e3e;color:#fff}.me-shell{position:relative;display:grid;grid-template-columns:170px minmax(0,1fr);flex:1;min-height:0}.me-nav{padding:22px 10px;gap:3px;display:flex;flex-direction:column;overflow:auto;background:color-mix(in srgb,var(--me-surface) 91%,var(--me-ink));border:0;border-right:1px solid var(--me-line)}.me-nav-label{font-size:10px;font-weight:550;color:var(--me-muted);padding:0 12px 12px;letter-spacing:.5px}.me-nav button{display:flex;align-items:center;justify-content:flex-start;gap:10px;width:100%;padding:8px 12px;margin:0;border:0;border-radius:7px;min-height:34px;font-size:12px!important;box-shadow:none;color:var(--me-ink);background:none;font-weight:500}.me-nav button svg{display:block;width:17px;height:17px;color:var(--me-muted)}.me-nav button[aria-current=page]{background:var(--me-surface);color:var(--me-ink);font-weight:650;box-shadow:0 1px 2px #00000008;border:0}.me-nav button[aria-current=page] svg{color:var(--me-ink)}.me-nav button:hover:not(:disabled){background:color-mix(in srgb,var(--me-surface) 70%,transparent);border:0}.me-nav .me-nav-library{margin:18px 0 0}.me-main{width:100%;height:100%;overflow:auto;margin:0;padding:26px 24px 40px;max-width:none;min-height:0}.me-heading{margin-bottom:21px;gap:12px;flex-wrap:wrap}.me h1{font-size:22px;letter-spacing:-.35px}.me-heading p{font-size:12px;margin-top:5px}.me-heading .me-actions{gap:8px}.me-card{border-radius:9px}.me-card-header{padding:16px}.me-card-body{padding:16px}.me-list-toolbar{padding:9px 12px;flex-wrap:wrap;gap:9px}.me-views{display:flex;gap:3px;align-items:center;flex-wrap:wrap}.me-views .me-button{border:0;background:transparent;box-shadow:none;min-height:29px;padding:5px 10px;color:var(--me-muted)}.me-views .me-button[aria-pressed=true]{background:var(--me-soft);color:var(--me-ink);font-weight:650}.me-list-controls{flex-wrap:wrap;margin-left:auto;gap:6px}.me-search{width:180px}.me-sort{min-height:31px!important;padding:4px 5px!important;font-size:11px!important;max-width:100px}.me th{font-size:11px;padding:9px 12px}.me td{padding:11px 12px}.me-thumb{width:36px;height:40px;border-radius:5px}.me-product-cell{gap:10px}.me-row-sub{font-size:10px}.me-record-button{font-size:12px!important}.me-empty{min-height:310px;padding:34px 24px}.me-empty h2{font-size:16px}.me-empty p{max-width:340px}.me-alert{font-size:12px;padding:10px 12px;margin-bottom:18px}.me-alert p{font-size:11px}.me-detail-grid{grid-template-columns:minmax(0,2fr) minmax(230px,1fr);gap:16px;max-width:1050px;margin:0 auto}.me-stat{font-size:28px}.me-mobile-menu{display:none}.me-main-editor{padding-bottom:0}.me-main-editor>.me-heading{max-width:1050px;margin-left:auto;margin-right:auto}
.me .wl-admin-surface{max-width:1050px;margin:0 auto;font:inherit;color:var(--me-ink)}.me .wl-admin-editor{max-width:none;margin:0;display:block}.me .wl-admin-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(225px,1fr);gap:16px;align-items:start}.me .wl-admin-grid>div,.me .wl-admin-grid>aside{min-width:0}.me .wl-admin-editor .wl-card{border:1px solid var(--me-line);border-radius:9px;padding:18px;margin:0 0 16px;background:var(--me-surface);box-shadow:0 1px 3px #00000006}.me .wl-admin-editor .wl-card:first-of-type{border:1px solid var(--me-line);padding:18px;margin-top:0}.me .wl-admin-editor .wl-card-head{margin:0 0 16px;gap:10px}.me .wl-admin-editor h3{font-size:13px;font-weight:650;margin:0}.me .wl-admin-editor .wl-form{gap:16px}.me .wl-admin-editor .wl-field{gap:6px;margin:0 0 14px}.me .wl-admin-editor .wl-field label{font-size:12px;font-weight:500;color:var(--me-ink);margin:0}.me .wl-admin-editor input,.me .wl-admin-editor textarea,.me .wl-admin-editor select{font:inherit;font-size:12px;border:1px solid var(--me-line);border-radius:6px;min-width:0;width:100%;padding:7px 9px;color:var(--me-ink);background:var(--me-surface);box-shadow:none}.me .wl-admin-editor textarea{resize:vertical;line-height:1.7}.me .wl-admin-editor .wl-product-identity textarea{min-height:190px}.me .wl-admin-editor .wl-field-row{gap:12px;grid-template-columns:1fr 1fr}.me .wl-admin-secondary .wl-field-row{grid-template-columns:1fr;gap:0}.me .wl-admin-editor .wl-btn{font-size:11px;min-height:30px;padding:5px 10px;border:1px solid var(--me-line);border-radius:6px;box-shadow:0 1px 1px #00000008;font-weight:550;background:var(--me-surface);color:var(--me-ink)}.me .wl-admin-editor .wl-btn.primary{color:#fff;background:#303030;border-color:#303030}.me .wl-admin-editor .wl-btn.danger{color:#9e3d31}.me .wl-admin-editor .wl-help{font-size:11px;line-height:1.7;color:var(--me-muted)}.me .wl-admin-editor .wl-product-media>.wl-help:first-of-type{border:1px dashed var(--me-line);border-radius:7px;min-height:105px;display:flex;align-items:center;justify-content:center;text-align:center;background:var(--me-soft);padding:20px;margin:0 0 10px}.me .wl-admin-editor .wl-sku{padding:14px;border:1px solid var(--me-line);border-radius:7px;background:var(--me-soft);margin-top:14px}.me .wl-admin-editor .wl-sku-head{gap:10px}.me .wl-admin-editor .wl-sku-head strong{font-size:12px}.me .wl-admin-editor .wl-tier-row{grid-template-columns:1fr 1fr 70px 28px;gap:7px}.me .wl-admin-editor .wl-spec-row{grid-template-columns:1fr 1fr 28px;gap:7px}.me .wl-admin-editor .wl-form-actions{position:sticky;bottom:0;z-index:3;display:flex;align-items:center;justify-content:flex-end;gap:8px;background:var(--me-canvas);padding:13px 0 16px;margin:4px 0 0;border-top:1px solid var(--me-line);box-shadow:0 -5px 10px var(--me-canvas)}.me .wl-save-state{margin-right:auto;font-size:12px;color:var(--me-muted)}.me .wl-admin-editor .wl-form-actions .wl-btn{min-width:65px;min-height:33px;flex:none}.me .wl-admin-editor .wl-version{padding:12px;background:var(--me-soft);border-radius:6px}.me .wl-admin-editor .wl-version-head{flex-wrap:wrap;gap:6px}.me .wl-admin-editor .wl-version-head strong{font-size:12px;overflow-wrap:anywhere}.me .wl-admin-editor .wl-image-grid{grid-template-columns:repeat(auto-fill,minmax(120px,1fr))}
@container(max-width:1050px){.me-shell{grid-template-columns:150px minmax(0,1fr)}.me-main{padding:24px 20px}.me-topbar{padding:0 18px}.me-nav{padding:20px 8px}.me-nav button{padding:8px 10px}.me .wl-admin-grid,.me-detail-grid{grid-template-columns:minmax(0,1.65fr) minmax(210px,1fr)}.me .wl-admin-editor .wl-tier-row{grid-template-columns:1fr 1fr;gap:7px}.me .wl-admin-editor .wl-spec-row{grid-template-columns:1fr 1fr 28px}}
@container(max-width:800px){.me-shell{grid-template-columns:minmax(0,1fr)}.me-mobile-menu{display:inline-flex}.me-shell .me-nav{display:none;position:absolute;top:0;bottom:0;left:0;width:185px;z-index:10;box-shadow:6px 0 15px #00000014}.me-shell.me-menu-open .me-nav{display:flex}.me-main{padding:24px 20px}.me .wl-admin-grid,.me-detail-grid{grid-template-columns:minmax(0,2fr) minmax(210px,1fr)}.me-topbar .me-brand{gap:8px}.me-heading{flex-direction:row;align-items:center}.me-heading .me-actions{justify-content:flex-start}}
@container(max-width:600px){.me-topbar{padding:0 10px;gap:8px}.me-topbar-actions{gap:4px}.me-topbar .me-brand-mark,.me-topbar .me-brand small,.me-workspace>svg{display:none}.me-topbar .me-workspace select{max-width:140px}.me-main{padding:20px 14px 28px}.me-heading{flex-direction:column;align-items:flex-start}.me .wl-admin-grid,.me-detail-grid{grid-template-columns:1fr}.me-list-controls{flex:1 1 100%;justify-content:flex-start;flex-wrap:nowrap;min-width:0}.me-search{width:auto;flex:1;min-width:70px}.me-sort{max-width:82px;font-size:10px!important}.me-views .me-button{padding:5px 9px;font-size:11px!important}.me-empty{padding:30px 18px}.me .wl-admin-editor .wl-card,.me .wl-admin-editor .wl-card:first-of-type{padding:16px}.me .wl-admin-editor .wl-form-actions{padding:12px 0}.me .wl-admin-editor .wl-field-row{grid-template-columns:1fr 1fr}.me .wl-admin-editor .wl-admin-secondary .wl-field-row{grid-template-columns:1fr}.me-main-editor{padding-bottom:0}}

.me{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Noto Sans SC",sans-serif;-webkit-font-smoothing:antialiased}.me h1{font-weight:600;line-height:1.45;letter-spacing:-.2px}.me th{font-size:12px;font-weight:500}.me td{font-size:13px;line-height:1.65}.me-record-button{font-size:13px!important;font-weight:550}.me-row-sub{font-size:11px;line-height:1.65}.me-nav button{font-size:13px!important}.me-compose{max-width:1050px;margin:0 auto}.me-compose-fields{border:0;margin:0;min-width:0;display:flex;flex-direction:column;gap:19px}.me-compose-fields .me-field{font-size:13px;font-weight:500}.me-compose-fields input,.me-compose-fields select,.me-compose-fields textarea{font-size:13px;min-height:37px;width:100%}.me-compose-fields small{font-size:12px;font-weight:400;line-height:1.7}.me-compose-footer{display:flex;justify-content:flex-end;gap:9px;position:sticky;bottom:-40px;padding:16px 0;background:var(--me-canvas);border-top:1px solid var(--me-line);margin-top:20px;z-index:2}.me-compose .me-alert{overflow-wrap:anywhere}.me-compose .me-alert small{display:block;margin-top:5px}.me-choice .me-text-button{margin-top:6px}.me-compose .me-detail-grid{max-width:none}.me-order-compose .me-quote{font-variant-numeric:tabular-nums}.me-compose-fields:disabled{opacity:.75}.me-customer-compose .me-detail-grid>.me-card{margin-top:0}.me-save-state{margin-right:auto;align-self:center;font-size:12px;color:var(--me-muted)}.me-compose-fields textarea{resize:vertical;padding:9px;border:1px solid var(--me-line);border-radius:6px;background:var(--me-surface);color:var(--me-ink);font:inherit}
@container(max-width:600px){.me-compose-footer{bottom:-28px}.me-compose .me-detail-grid{grid-template-columns:1fr}.me-nav button{font-size:13px!important}}
/* Admin shell: one navigation model, consistent surfaces and explicit service states. */
.me{--me-canvas:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 95%,var(--dsw-alias-label-primary,#303030));--me-surface:var(--dsw-alias-bg-base,#fff);--me-ink:var(--dsw-alias-label-primary,#303030);--me-muted:var(--dsw-alias-label-secondary,#616161);--me-line:var(--dsw-alias-border-l2,#e3e3e3);--me-soft:color-mix(in srgb,var(--me-surface) 95%,var(--me-ink));--me-primary:var(--me-ink);--me-primary-ink:var(--me-surface);--me-green:var(--me-ink);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;font-size:13px;line-height:1.55;position:relative;isolation:isolate;letter-spacing:0}
.me[data-appearance=light]{--me-canvas:#f1f1f1;--me-surface:#fff;--me-ink:#303030;--me-muted:#616161;--me-line:#e3e3e3;--me-soft:#f7f7f7;--me-primary:#303030;--me-primary-ink:#fff;--me-green:#303030;--me-tint:#e3f1df}
.me[data-appearance=dark]{--me-canvas:#171717;--me-surface:#242424;--me-ink:#f0f0f0;--me-muted:#b0b0b0;--me-line:#3c3c3c;--me-soft:#2e2e2e;--me-primary:#e8e8e8;--me-primary-ink:#202020;--me-green:#c8e4ce;--me-tint:#263a2b}
.me h1{font-size:21px;line-height:28px;letter-spacing:-.4px;font-weight:650}.me h2{font-size:14px;font-weight:650;line-height:22px}.me h3{font-size:13px;font-weight:600}.me p{line-height:1.65}.me small{font-size:12px}.me input,.me select,.me textarea{font:inherit}.me button{font-weight:550}.me button:focus-visible,.me input:focus-visible,.me select:focus-visible,.me textarea:focus-visible,.me a:focus-visible,.me [tabindex]:focus-visible{outline:2px solid #005bd3;outline-offset:2px}.me input,.me select{border-color:color-mix(in srgb,var(--me-line) 60%,var(--me-muted));min-height:32px;padding:5px 10px;border-radius:8px}.me input[type=checkbox]{width:16px;height:16px;min-height:0;accent-color:var(--me-ink);padding:0;vertical-align:middle;cursor:pointer}
.me-topbar{height:56px;min-height:56px;background:#1a1a1a;border:0;padding:0 16px;display:grid;grid-template-columns:210px minmax(180px,570px) 1fr;gap:22px;position:relative;z-index:12}.me-brand{gap:9px;font-size:15px;color:#fafafa;font-weight:650;letter-spacing:-.2px}.me-topbar .me-brand-mark{width:27px;height:27px;border-radius:7px;background:#dcf8d4;color:#284f29;box-shadow:inset 0 0 0 1px #ffffff30}.me-brand small{font-size:10px;letter-spacing:1.4px;font-weight:500;color:#9e9e9e}.me-topbar-actions{justify-content:flex-end;gap:8px}.me-topbar .me-workspace{gap:7px}.me-topbar .me-workspace select{max-width:170px;background:#303030;border:0;color:#fff;font-size:12px;min-height:32px;border-radius:8px}.me-store-avatar{display:grid;place-items:center;width:26px;height:26px;border-radius:7px;background:#d5e8bf;color:#274322;font-size:12px;font-weight:700;flex-shrink:0}.me-global-search{display:flex;align-items:center;gap:10px;text-align:left;background:#303030;border:1px solid #494949;border-radius:8px;color:#b5b5b5;min-height:34px;width:100%;padding:0 10px;box-shadow:0 1px 1px #0004;font-size:12px}.me-global-search:hover{background:#383838;border-color:#747474}.me-global-search>span{flex:1}.me kbd{font:11px ui-monospace,monospace;border:1px solid #5c5c5c;border-radius:4px;line-height:18px;min-width:20px;text-align:center;padding:0 4px;color:#bdbdbd}.me-topbar .me-icon-button{background:transparent;color:#bbb;border:0;box-shadow:none;width:29px;min-height:30px}.me-topbar .me-icon-button:hover{background:#3c3c3c;color:white}
.me-shell{grid-template-columns:222px minmax(0,1fr)}.me-nav{background:var(--me-canvas);border:0;padding:18px 12px 10px;gap:2px;scrollbar-width:thin}.me-nav-label{display:none}.me-nav-group{margin:0;flex-shrink:0}.me-nav-row{display:flex;align-items:center;position:relative;border-radius:8px}.me-nav-row>.me-button:first-child{flex:1;min-width:0}.me-nav button{font-size:13px!important;line-height:18px;min-height:32px;padding:7px 10px;gap:9px;border-radius:8px;white-space:normal;text-align:left;color:var(--me-ink);font-weight:500}.me-nav button svg{color:var(--me-muted);width:18px;height:18px}.me-nav button[aria-current=page]{background:color-mix(in srgb,var(--me-surface) 85%,var(--me-ink));box-shadow:0 1px 2px #00000008;font-weight:650}.me-nav .me-nav-expand{width:26px;flex:none;min-height:26px;padding:4px;justify-content:center;position:absolute;right:5px;top:3px;background:transparent!important;box-shadow:none}.me-nav-expand svg{width:13px;height:13px}.me-nav-group:has(.me-nav-expand)>.me-nav-row>.me-button:first-child{padding-right:30px}.me-nav-children{padding:2px 0 4px 24px}.me-nav-children button{font-size:12px!important;min-height:29px;padding:5px 10px;color:var(--me-muted)}.me-nav-children button[aria-current=page]{color:var(--me-ink)}.me-nav-divider{display:flex;align-items:center;justify-content:space-between;padding:19px 10px 7px;font-size:11px;color:var(--me-muted);font-weight:550}.me-nav-bottom{margin-top:auto;padding-top:24px}.me-nav .me-drawer-close{display:none}.me-mobile-menu{display:none!important}.me-nav-scrim{display:none}
.me-main{padding:26px 30px 38px;scrollbar-gutter:stable;position:relative;max-width:1600px;margin:0 auto;overscroll-behavior:contain}.me-main>*{max-width:1240px;margin-left:auto;margin-right:auto}.me-heading{margin-bottom:20px;min-height:34px}.me-heading p{font-size:12px;color:var(--me-muted);margin-top:3px}.me-heading .me-crumb{font-size:11px;margin:0 0 4px}.me-main-editor>.me-heading,.me-compose,.me-detail-grid,.me .wl-admin-surface{max-width:1060px}.me-button{border-radius:8px;min-height:30px;font-size:12px!important;padding:5px 11px;box-shadow:0 -1px 0 0 #b5b5b524 inset,0 1px 0 0 #0000000a;font-weight:550}.me-button-primary{border-color:transparent;background:var(--me-primary);color:var(--me-primary-ink)!important;box-shadow:inset 0 1px 0 #ffffff38,inset 0 -1px 0 #0005,0 1px 2px #0002}.me-button-primary:hover:not(:disabled){background:color-mix(in srgb,var(--me-primary) 85%,var(--me-surface));border-color:transparent}.me-text-button{box-shadow:none;color:var(--me-ink)!important;font-weight:550}.me-icon-button{min-width:30px;width:30px}.me-card{border:1px solid var(--me-line);border-radius:12px;box-shadow:0 1px 0 #00000008;overflow:hidden}.me-card-header{padding:14px 16px}.me-card-body{padding:18px}.me-detail-grid{grid-template-columns:minmax(0,2fr) minmax(250px,1fr);gap:18px}.me-card+.me-card{margin-top:18px}.me-list-toolbar{min-height:48px;padding:8px}.me-views .me-button{border-radius:7px;font-weight:550;min-height:30px;padding:5px 12px}.me-views .me-button[aria-pressed=true]{background:var(--me-soft)}.me-list-controls{gap:5px}.me-search{width:220px;border-radius:7px}.me-search input{padding:4px 0;font-size:12px;min-height:29px}.me-sort{font-size:12px!important;min-height:30px!important;max-width:120px!important}.me table{font-size:13px}.me th{font-size:12px;font-weight:550;padding:10px 13px;background:var(--me-soft);color:var(--me-ink)}.me td{padding:11px 13px;font-size:13px;line-height:1.5}.me-check-cell{width:36px;padding-left:16px!important;padding-right:0!important}.me tr[data-selected=true]{background:color-mix(in srgb,#dbeafe 22%,var(--me-surface))}.me-thumb{width:40px;height:40px;border-radius:8px}.me-product-cell{min-width:180px;gap:11px}.me-record-button{font-size:13px!important;font-weight:550}.me-list-footer{padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--me-line);font-size:12px;color:var(--me-muted)}.me-empty{min-height:350px;gap:13px;padding:44px 24px}.me-empty h2{font-size:17px;letter-spacing:-.25px}.me-empty p{max-width:330px;font-size:13px;line-height:1.7}.me-badge{font-size:11px;font-weight:500;border-radius:6px;padding:3px 7px;white-space:nowrap;line-height:16px;background:var(--me-soft);color:var(--me-ink)}.me-badge .me-dot{display:none}.me-badge-linked,.me-badge-confirmed,.me-badge-active{background:#d9efcf;color:#285823}.me-badge-reserved,.me-badge-draft{background:#f8e5a5;color:#684d00}.me-badge-expired,.me-badge-cancelled,.me-badge-archived{background:var(--me-soft);color:var(--me-muted)}.me-selection-bar{padding:10px 16px;display:flex;align-items:center;gap:12px;background:var(--me-soft);border-bottom:1px solid var(--me-line)}.me-selection-bar strong{font-size:12px}.me-page-note{font-size:11px;color:var(--me-muted);display:flex;align-items:flex-start;gap:7px;margin-top:18px;line-height:1.6}.me-alert{border-radius:9px;font-size:12px;line-height:1.6}.me-terms{white-space:pre-wrap}.me-subtle{color:var(--me-muted);font-size:12px;line-height:1.8!important;margin-top:7px!important}.me-definition{gap:17px}.me-definition dt{font-size:12px}.me-definition dd{font-size:13px}.me-compose-fields{gap:18px;padding:18px}.me-compose-fields .me-field{font-size:13px;font-weight:500;gap:7px}.me-compose-fields input,.me-compose-fields select{min-height:34px;border-radius:8px}.me-compose-footer{bottom:-38px;padding:14px 0;background:var(--me-canvas);box-shadow:0 -6px 12px var(--me-canvas);margin-top:22px}.me-help{font-size:12px;line-height:1.7}.me-quote{font-size:25px;font-weight:650;font-variant-numeric:tabular-nums}
.me-overview-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;background:var(--me-surface);border:1px solid var(--me-line);border-radius:12px;overflow:hidden;margin-bottom:24px}.me-metric{display:flex;flex-direction:column;text-align:left;background:transparent;border:0;border-right:1px solid var(--me-line);padding:17px 20px;gap:9px;color:var(--me-ink)}.me-metric:last-child{border:0}.me-metric:hover{background:var(--me-soft)}.me-metric>span{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:550}.me-metric strong{font-size:28px;font-weight:600;line-height:1.2;letter-spacing:-.7px;font-variant-numeric:tabular-nums}.me-metric small{font-weight:400;font-size:11px}.me-home-grid{display:grid;grid-template-columns:minmax(0,1.8fr) minmax(250px,1fr);gap:22px;align-items:start}.me-home-grid>div{min-width:0}.me-home-grid .me-card{margin-top:0}.me-home-aside{display:grid;gap:18px}.me-home-aside .me-card-body{display:flex;flex-direction:column;align-items:flex-start;gap:9px}.me-home-aside .me-subtle{margin-top:0!important}.me-feature-icon{width:42px;height:42px;border-radius:11px;display:grid;place-items:center;background:#e6ebde;color:#405139;margin:0 0 5px}.me-kicker{font-size:11px;font-weight:550;color:var(--me-muted);margin-bottom:8px}.me-setup-card>.me-card-body{padding:22px;background:radial-gradient(ellipse at top right,color-mix(in srgb,#d8e5c3 25%,var(--me-surface)),transparent 65%)}.me-setup-card h2{font-size:18px;line-height:27px;letter-spacing:-.3px}.me-setup-progress{height:5px;width:160px;background:var(--me-line);border-radius:5px;margin-top:17px;overflow:hidden}.me-setup-progress>span{display:block;height:100%;border-radius:5px;background:var(--me-ink)}.me-setup-row{display:flex;width:100%;gap:13px;align-items:center;text-align:left;border:0;border-top:1px solid var(--me-line);background:var(--me-surface);padding:18px 20px;color:var(--me-ink)}.me-setup-row:hover{background:var(--me-soft)}.me-setup-row>span:nth-child(2){flex:1}.me-setup-row strong{display:block;font-size:13px;font-weight:600}.me-setup-row small{display:block;margin-top:4px;font-weight:400;line-height:1.7}.me-step-mark{width:21px;height:21px;border:2px dashed var(--me-muted);border-radius:50%;display:grid;place-items:center;flex-shrink:0}.me-step-mark.is-done{background:var(--me-ink);border-color:var(--me-ink);color:var(--me-surface);border-style:solid}.me-quick-links{display:flex;flex-direction:column;align-items:flex-start;gap:10px;margin-top:3px;width:100%}.me-quick-links button{font-size:12px!important;font-weight:400}
.me-connection-card{min-height:340px}.me-connection-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:42px 30px;gap:13px}.me-connection-empty h2{font-size:19px;font-weight:600;letter-spacing:-.3px}.me-connection-empty>p{color:var(--me-muted);max-width:460px;font-size:13px}.me-connection-art{position:relative;width:100px;height:92px;display:grid;place-items:center;margin-bottom:5px}.me-connection-art>span{width:74px;height:74px;border-radius:22px;background:var(--me-soft);border:1px solid var(--me-line);display:grid;place-items:center;transform:rotate(-7deg);color:var(--me-muted);box-shadow:0 4px 10px #00000005}.me-connection-art>i{position:absolute;bottom:0;right:4px;display:grid;place-items:center;width:30px;height:30px;background:var(--me-surface);border:1px solid var(--me-line);border-radius:9px;color:var(--me-muted)}.me-capability-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:18px}.me-capability-grid>.me-card{margin:0}.me-capability-number{font-size:11px;color:var(--me-muted);display:block;margin-bottom:12px}.me-content-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.me-content-grid>.me-card{margin:0}.me-content-card{display:flex;gap:18px;padding:22px;align-items:center;text-align:left;color:var(--me-ink)}.me-content-card:hover{border-color:var(--me-muted)}.me-content-card>div:nth-child(2){flex:1}.me-content-card p{font-size:12px;font-weight:400;color:var(--me-muted);margin:6px 0 12px}.me-content-icon{display:grid;place-items:center;width:62px;height:70px;background:var(--me-soft);border:1px solid var(--me-line);border-radius:11px;flex-shrink:0;color:var(--me-muted)}
.me-settings-grid{display:grid;grid-template-columns:190px minmax(0,1fr);gap:30px;align-items:start}.me-settings-nav{display:flex;flex-direction:column;gap:3px;position:sticky;top:0}.me-settings-nav button{display:flex;justify-content:flex-start;background:transparent;border:0;box-shadow:none;font-size:12px!important;font-weight:500;padding:9px 10px;gap:10px;color:var(--me-muted);text-align:left}.me-settings-nav button[aria-current=page]{background:var(--me-surface);color:var(--me-ink);font-weight:600;box-shadow:0 1px 2px #0001}.me-settings-content{min-width:0}.me-settings-title{margin:3px 0 20px!important;font-size:17px!important}.me-settings-row{display:grid;grid-template-columns:minmax(130px,.8fr) minmax(0,1.7fr);gap:24px;align-items:start}.me-preferences{display:flex;flex-direction:column;gap:22px}.me-connection-row{display:flex;gap:16px;align-items:center;padding:17px 18px;border-bottom:1px solid var(--me-line)}.me-connection-row:last-child{border:0}.me-connection-row>div{flex:1;min-width:0}.me-connection-row strong{font-size:13px;font-weight:550}.me-connection-row p{font-size:12px;color:var(--me-muted);margin-top:4px}.me-settings-content .me-capability-grid{grid-template-columns:1fr}.me-settings-content .me-capability-grid>.me-card .me-card-body{display:flex;align-items:center;gap:15px;padding:13px}.me-settings-content .me-capability-number{margin:0}.me-settings-content .me-capability-grid .me-subtle{margin:0 0 0 auto!important}
.me-modal-backdrop{position:absolute;inset:0;background:#0006;backdrop-filter:blur(2px);z-index:30;display:flex;align-items:flex-start;justify-content:center;padding:90px 20px 24px}.me-command-dialog{background:var(--me-surface);color:var(--me-ink);border:1px solid var(--me-line);border-radius:13px;box-shadow:0 20px 70px #0004;width:650px;max-width:100%;max-height:calc(100% - 20px);display:flex;flex-direction:column;overflow:hidden}.me-command-input{display:flex;align-items:center;gap:12px;padding:12px 15px;border-bottom:1px solid var(--me-line)}.me-command-input input{flex:1;min-width:0;border:0;outline:0!important;box-shadow:none;font-size:14px;min-height:34px;background:transparent;padding:0}.me-command-results{overflow:auto;padding:7px;min-height:180px}.me-command-label{padding:9px 9px 6px;font-size:11px;color:var(--me-muted)}.me-search-result{display:flex;align-items:center;gap:12px;width:100%;padding:11px;border:0;background:transparent;color:var(--me-ink);border-radius:8px;font-size:13px;text-align:left}.me-search-result>span{flex:1;min-width:0;overflow-wrap:anywhere}.me-search-result small{font-size:11px;color:var(--me-muted)}.me-search-result:hover,.me-search-result:focus-visible{background:var(--me-soft)}.me-command-dialog footer{border-top:1px solid var(--me-line);padding:10px 14px;display:flex;justify-content:space-between;gap:15px;font-size:10px;color:var(--me-muted)}.me-command-empty{padding:24px 15px;color:var(--me-muted);font-size:13px}.me-toast{position:absolute;bottom:22px;left:50%;transform:translateX(-50%);z-index:20;background:#303030;color:white;border-radius:10px;box-shadow:0 5px 18px #0003;display:flex;align-items:center;gap:12px;padding:12px 16px;max-width:calc(100% - 32px);font-size:13px}.me-toast .me-button{color:#eee;background:none;border:0;box-shadow:none;padding:2px;min-height:22px}
.me .wl-admin-surface{color:var(--me-ink);--wl-bg:var(--me-surface);--wl-text:var(--me-ink);--wl-muted:var(--me-muted);--wl-border:var(--me-line);--wl-accent:var(--me-primary);--wl-accent-ink:var(--me-primary-ink);--wl-card:var(--me-surface)}.me .wl-admin-editor .wl-card{border-radius:12px;padding:18px;border-color:var(--me-line)}.me .wl-admin-editor input,.me .wl-admin-editor textarea,.me .wl-admin-editor select{font-size:13px;min-height:34px;border-radius:8px;padding:6px 10px}.me .wl-admin-editor h3{font-size:14px}.me .wl-admin-editor .wl-field label{font-size:13px;font-weight:500}.me .wl-admin-editor .wl-help{font-size:12px}.me .wl-admin-grid{grid-template-columns:minmax(0,2fr) minmax(250px,1fr);gap:18px}.me .wl-admin-editor .wl-btn{border-radius:8px;font-size:12px;min-height:30px}.me .wl-admin-editor .wl-btn.primary{background:var(--me-primary);color:var(--me-primary-ink);border-color:var(--me-primary)}.me .wl-admin-file .wl-card,.me .wl-admin-file .wl-version{border:1px solid var(--me-line);border-radius:12px;background:var(--me-surface);padding:18px;margin-bottom:18px}.me .wl-admin-file .wl-detail-title{font-size:19px}.me .wl-admin-file .wl-field label,.me .wl-admin-company .wl-field label{font-size:13px}.me .wl-admin-file .wl-btn,.me .wl-admin-company .wl-btn{border-radius:8px;min-height:30px}.me .wl-admin-file input,.me .wl-admin-file select,.me .wl-admin-file textarea,.me .wl-admin-company input,.me .wl-admin-company textarea{font:inherit;border:1px solid var(--me-line);background:var(--me-surface);color:var(--me-ink);padding:8px 10px;border-radius:8px;min-width:0;max-width:100%}.me .wl-admin-file .wl-detail-head{margin-bottom:20px}.me .wl-admin-company .wl-section{border:0;padding:0;margin:0}.me .wl-admin-company .wl-section>h3{display:none}.me .wl-admin-file .wl-form-actions,.me .wl-admin-company .wl-form-actions{position:sticky;bottom:0;background:var(--me-surface);padding:13px 0;display:flex;gap:10px;justify-content:flex-end}.me .wl-admin-file .wl-help{overflow-wrap:anywhere}.me[data-density=compact] td{padding-top:7px;padding-bottom:7px}.me[data-density=compact] .me-thumb{width:32px;height:32px}.me[data-appearance=dark] .me-badge-linked,.me[data-appearance=dark] .me-badge-confirmed,.me[data-appearance=dark] .me-badge-active{background:#264730;color:#c2e8bb}.me[data-appearance=dark] .me-badge-draft,.me[data-appearance=dark] .me-badge-reserved{background:#594b24;color:#f6df9b}.me[data-appearance=dark] .me-feature-icon{background:#303e2a;color:#c7ddb7}.me[data-appearance=dark] .me-alert-error{background:#492b2a;color:#f3c5bf;border-color:#6c3d39}
@container(max-width:1200px){.me-topbar{grid-template-columns:190px minmax(140px,1fr) auto;gap:14px}.me-shell{grid-template-columns:202px minmax(0,1fr)}.me-main{padding:24px 22px 34px}.me-settings-grid{grid-template-columns:165px minmax(0,1fr);gap:20px}.me-settings-row{grid-template-columns:1fr;gap:15px}.me-home-grid{grid-template-columns:minmax(0,1.6fr) minmax(230px,1fr);gap:18px}.me-metric{padding:16px}.me-detail-grid,.me .wl-admin-grid{grid-template-columns:minmax(0,1.7fr) minmax(220px,1fr)}}
@container(max-width:900px){.me-shell{grid-template-columns:minmax(0,1fr)}.me-topbar{grid-template-columns:auto minmax(130px,1fr) auto;gap:12px;padding:0 12px}.me-topbar .me-brand small{display:none}.me-topbar .me-brand{font-size:13px}.me-mobile-menu{display:inline-flex!important}.me-nav{display:none!important;position:absolute;top:0;bottom:0;left:0;width:238px;z-index:15;border-right:1px solid var(--me-line);box-shadow:8px 0 24px #0002;background:var(--me-canvas)}.me-menu-open .me-nav{display:flex!important}.me-nav .me-drawer-close{display:flex;justify-content:space-between;margin-bottom:8px}.me-menu-open .me-nav-scrim{display:block;position:absolute;inset:0;border:0;background:#0005;z-index:14}.me-main{max-width:none}.me .wl-admin-grid,.me-detail-grid{grid-template-columns:minmax(0,1.7fr) minmax(220px,1fr)}.me-settings-grid{grid-template-columns:165px minmax(0,1fr)}.me-nav-bottom{margin-top:15px}.me-main>*{max-width:100%}}
@container(max-width:650px){.me-topbar{height:54px;min-height:54px;grid-template-columns:auto 1fr auto;gap:10px;padding:0 9px}.me-brand-mark,.me-brand>span.me-brand-name{display:none!important}.me-brand{gap:0}.me-topbar .me-host-toggle,.me-topbar .me-help-toggle,.me-store-avatar{display:none}.me-topbar .me-workspace select{max-width:115px;font-size:11px;padding:5px 6px}.me-global-search{min-height:32px;font-size:11px;padding:0 8px;gap:6px}.me-global-search kbd{display:none}.me-main{padding:20px 14px 28px;scrollbar-gutter:auto}.me-heading{align-items:flex-start;flex-direction:row;gap:10px;flex-wrap:wrap}.me-heading h1{font-size:20px;line-height:27px}.me-heading p{font-size:12px}.me-heading .me-actions{gap:6px}.me-overview-grid{grid-template-columns:1fr 1fr;margin-bottom:18px}.me-metric{padding:15px}.me-metric:nth-child(2){border-right:0}.me-metric:nth-child(-n+2){border-bottom:1px solid var(--me-line)}.me-metric strong{font-size:25px}.me-home-grid,.me-content-grid,.me-settings-grid,.me-settings-row,.me-detail-grid,.me .wl-admin-grid{grid-template-columns:1fr}.me-home-aside{grid-template-columns:1fr}.me-setup-card>.me-card-body{padding:19px}.me-setup-row{padding:16px}.me-settings-nav{position:static;flex-direction:row;overflow:auto;padding:0 0 10px;gap:5px}.me-settings-nav button{white-space:nowrap;flex-shrink:0;font-size:12px!important;min-height:35px}.me-settings-nav svg{width:15px;height:15px}.me-settings-content .me-settings-title{margin-top:0!important}.me-settings-content .me-capability-grid .me-card-body{display:block}.me-settings-content .me-capability-grid .me-subtle{margin-top:5px!important}.me-settings-content .me-capability-number{margin-bottom:6px}.me-connection-row{padding:14px;gap:9px;flex-wrap:wrap}.me-connection-row>div{min-width:130px}.me-capability-grid{grid-template-columns:1fr;gap:12px}.me-connection-empty{padding:30px 19px}.me-connection-empty h2{font-size:17px}.me-connection-empty>p{font-size:12px}.me-content-card{padding:18px;gap:15px}.me-content-icon{width:48px;height:56px}.me-list-controls{flex:1 1 100%;width:100%;justify-content:flex-start}.me-search{width:auto;flex:1}.me-search input{min-width:0}.me th,.me td{padding:10px}.me-product-cell{min-width:160px}.me-list-footer{padding:11px;flex-wrap:wrap}.me-compose-footer{bottom:-28px;flex-wrap:wrap}.me-save-state{flex-basis:100%}.me-modal-backdrop{padding:16px 10px}.me-command-dialog{max-height:calc(100% - 16px)}.me-command-dialog footer{flex-direction:column;gap:3px}.me-command-input{padding:10px}.me-command-input input{font-size:13px}.me-selection-bar{flex-wrap:wrap;gap:8px}.me-toast{bottom:14px;font-size:12px}.me .wl-admin-editor .wl-field-row{grid-template-columns:1fr}.me .wl-admin-editor .wl-tier-row{grid-template-columns:1fr 1fr}.me .wl-admin-file .wl-field-row{grid-template-columns:1fr}.me .wl-admin-file .wl-form-actions{flex-wrap:wrap}}
@media(prefers-reduced-motion:reduce){.me *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;
  // Only submitted commands are retained, scoped to this browser tab and workspace.
  // An uncertain reply freezes the command until the same request can be replayed.
  function useSubmission(workspace, action, onSaved, onBusy, recordId = '') {
    const storageKey = `mini-erp:pending:${workspace}:${action}${recordId ? `:${recordId}` : ''}`;
    const [initial] = useState(() => {
      try {
        const raw = window.sessionStorage.getItem(storageKey);
        if (!raw) return { pending: null };
        const record = JSON.parse(raw);
        if (record.workspace !== workspace || record.body?.action !== action || recordId && record.body.id !== recordId || typeof record.body.requestId !== 'string') throw new Error('invalid recovery record');
        return { pending: record.body };
      } catch { return { pending: null, storageError: '无法读取上次提交的重试记录。请先核对已有记录，再处理浏览器存储。' }; }
    });
    const [pending, setPending] = useState(initial.pending), [error, setError] = useState(null), [busy, setBusy] = useState(false);
    const flight = useRef(false), alive = useRef(true), saved = useRef(initial.pending);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    async function submit(input) {
      if (flight.current || initial.storageError) return;
      const retrying = !!saved.current;
      const body = saved.current || { ...input, action, requestId: crypto.randomUUID() };
      try { window.sessionStorage.setItem(storageKey, JSON.stringify({ workspace, body })); }
      catch { setError(new Error('无法保存重试信息，本次尚未提交。请检查浏览器存储后重试。')); return; }
      saved.current = body; setPending(body); flight.current = true; setBusy(true); setError(null); onBusy?.(true);
      try {
        const receipt = await request(`/workspaces/${encodeURIComponent(workspace)}/command`, body);
        window.sessionStorage.removeItem(storageKey); saved.current = null;
        if (alive.current) { setPending(null); onSaved(receipt); }
      } catch (e) {
        // Losing authentication during a retry says nothing about the original commit.
        if (e.rejected && (!retrying || e.status === 409 && e.code !== 'WORKSPACE_REQUIRED')) {
          try { window.sessionStorage.removeItem(storageKey); saved.current = null; if (alive.current) setPending(null); }
          catch { e = new Error('提交被拒绝，但无法清理重试记录。请恢复浏览器存储后重试同一次提交。'); }
        }
        if (alive.current) setError(e);
      } finally { flight.current = false; onBusy?.(false); if (alive.current) setBusy(false); }
    }
    return { pending, initial: initial.pending, error, busy, blocked: !!initial.storageError, storageError: initial.storageError, submit };
  }
  function SubmissionNotice({ submission }) {
    const s = submission;
    return h(React.Fragment, null,
      s.storageError ? h('div', { className: 'me-alert me-alert-error', role: 'alert' }, s.storageError) : null,
      s.error ? h('div', { className: 'me-alert me-alert-error', role: 'alert' }, s.error.message) : null,
      s.pending && !s.busy ? h('div', { className: 'me-alert', role: 'status' }, h(Icon, { name: 'info' }), h('div', null,
        h('strong', null, '上次提交的结果尚未确认'), h('p', null, '重试会核对同一次提交，不会另建一笔。当前参数已锁定；刷新页面后仍可继续核对。'),
        h('small', null, `请求编号 ${s.pending.requestId}`))) : null);
  }
  function CustomerComposer({ workspace, customer, onSaved, onClose, onBusy, onDirtyChange }) {
    const s = useSubmission(workspace, customer ? 'update_buyer' : 'add_buyer', onSaved, onBusy, customer?.id);
    const [initial] = useState(() => s.initial || customer || {});
    const [id] = useState(() => initial.id || crypto.randomUUID());
    const [name, setName] = useState(initial.name || ''), [email, setEmail] = useState(initial.email || '');
    const [phone, setPhone] = useState(initial.phone || ''), [note, setNote] = useState(initial.note || '');
    const dirty = [name, email, phone, note].some((v, i) => v !== (initial[['name', 'email', 'phone', 'note'][i]] || ''));
    useEffect(() => { onDirtyChange?.(dirty && !s.pending); return () => onDirtyChange?.(false); }, [dirty, !!s.pending]);
    const locked = s.busy || !!s.pending || s.blocked;
    function submit(e) {
      e.preventDefault(); if (locked || !name.trim()) return;
      s.submit({ id, name: name.trim(), email: email.trim(), phone: phone.trim(), note: note.trim(),
        ...(customer ? { expectedRevision: initial.expectedRevision ?? initial.revision } : {}) });
    }
    return h('form', { className: 'me-compose me-customer-compose', onSubmit: submit },
      h(SubmissionNotice, { submission: s }),
      h('div', { className: 'me-detail-grid' },
        h('section', { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '客户信息')),
          h('fieldset', { disabled: locked, className: 'me-card-body me-compose-fields' },
            field('姓名', h('input', { name: 'customerName', autoComplete: 'name', required: true, maxLength: 500, value: name, onChange: e => setName(e.target.value) })),
            field('邮箱', h('input', { name: 'customerEmail', type: 'email', autoComplete: 'email', maxLength: 254, value: email, onChange: e => setEmail(e.target.value) })),
            field('电话号码', h('input', { name: 'customerPhone', type: 'tel', autoComplete: 'tel', maxLength: 50, value: phone, onChange: e => setPhone(e.target.value) })),
            customer?.legacyContact || s.initial?.contact ? h('p', { className: 'me-help' }, '原联系方式：', customer?.legacyContact || s.initial.contact) : null)),
        h('section', { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '备注')),
          h('fieldset', { disabled: locked, className: 'me-card-body me-compose-fields' },
            field('客户备注', h('textarea', { name: 'customerNote', rows: 6, maxLength: 2000, value: note, onChange: e => setNote(e.target.value) }), '仅供内部查看。')))),
      h('div', { className: 'me-compose-footer' }, dirty && !s.pending ? h('span', { className: 'me-save-state' }, '有未保存的更改') : null,
        button(s.pending ? '稍后核对' : '取消', onClose, { disabled: s.busy }),
        s.pending ? button(s.busy ? '正在核对…' : '重试同一次提交', () => s.submit(), { disabled: s.busy, className: 'me-button-primary' })
          : button('保存客户', undefined, { type: 'submit', disabled: s.blocked || !name.trim(), className: 'me-button-primary' })));
  }
  function useChoices(workspace, entity, filters = {}, enabled = true) {
    const key = JSON.stringify([workspace, entity, filters, enabled]);
    const active = useRef(key); active.current = key;
    const [state, setState] = useState({ key, items: [], loading: enabled });
    const current = state.key === key ? state : { key, items: [], loading: enabled };
    async function load(afterId, signal) {
      setState(old => ({ ...old, key, loading: true, error: '' }));
      try {
        const params = new URLSearchParams({ entity, limit: '50', ...filters, ...(afterId ? { afterId } : {}) });
        const result = await request(`/workspaces/${encodeURIComponent(workspace)}/read?${params}`, null, signal);
        if (active.current === key && !signal?.aborted) setState(old => ({ ...result, key, loading: false, items: afterId ? [...old.items, ...result.items] : result.items }));
      } catch (e) { if (active.current === key && !signal?.aborted) setState(old => ({ ...old, key, loading: false, error: e.message })); }
    }
    useEffect(() => {
      setState({ key, items: [], loading: enabled });
      if (!enabled) return;
      const a = new AbortController(); load(null, a.signal); return () => a.abort();
    }, [key]);
    return { ...current, more: () => { if (!current.loading) load(current.nextCursor); }, retry: () => load(null) };
  }
  function Choice({ label, name, value, onChange, choices, disabled, textOf }) {
    return h('div', { className: 'me-choice' }, field(label,
      h('select', { name, required: true, value, disabled: disabled || choices.loading && !choices.items.length, onChange: e => onChange(e.target.value) },
        h('option', { value: '' }, choices.loading && !choices.items.length ? '正在读取…' : `选择${label}`),
        value && !choices.items.some(row => row.id === value) ? h('option', { value }, value) : null,
        choices.items.map(row => h('option', { key: row.id, value: row.id }, textOf(row)))),
      choices.items.length ? `已读取 ${choices.items.length} 条${choices.hasMore ? '，还有更多记录' : ''}` : choices.loading ? '' : '当前工作区还没有可选记录。'),
      choices.error ? h('p', { role: 'alert', className: 'me-help' }, choices.error, ' ', button('重新读取', choices.retry, { disabled, className: 'me-text-button' })) : null,
      choices.hasMore ? button(choices.loading ? '正在读取…' : '加载更多', choices.more, { disabled: disabled || choices.loading, className: 'me-text-button' }) : null);
  }
  function OrderComposer({ workspace, initialProductId = '', initialBuyerId = '', onSaved, onClose, onBusy, onDirtyChange }) {
    const s = useSubmission(workspace, 'reserve', onSaved, onBusy);
    const [buyerId, setBuyerId] = useState(s.initial?.buyerId || initialBuyerId), [productId, setProductId] = useState(s.initial?.productId || initialProductId);
    const [quantity, setQuantity] = useState(String(s.initial?.quantity || 1)), [holdMinutes, setHoldMinutes] = useState(String(s.initial?.holdMinutes || 60));
    const draftSignature = JSON.stringify([buyerId, productId, quantity, holdMinutes]);
    const initialDraft = useRef(draftSignature);
    useEffect(() => { onDirtyChange?.(draftSignature !== initialDraft.current && !s.pending); return () => onDirtyChange?.(false); }, [draftSignature, !!s.pending]);
    const [quote, setQuote] = useState(null), [quoteError, setQuoteError] = useState(''), [quoteNonce, refreshQuote] = useState(0);
    const buyers = useChoices(workspace, 'buyer'), products = useChoices(workspace, 'product');
    const q = Number(quantity), minutes = Number(holdMinutes), validQuantity = Number.isSafeInteger(q) && q > 0 && q <= 1e9;
    const quoteKey = JSON.stringify([workspace, productId, q, quoteNonce]);
    useEffect(() => {
      setQuote(null); setQuoteError('');
      if (!productId || !validQuantity || s.pending) return;
      const a = new AbortController();
      const timer = setTimeout(() => {
        const params = new URLSearchParams({ entity: 'supply', id: productId, quantity: String(q) });
        request(`/workspaces/${encodeURIComponent(workspace)}/read?${params}`, null, a.signal)
          .then(snapshot => { if (!a.signal.aborted) setQuote({ key: quoteKey, snapshot }); })
          .catch(e => { if (!a.signal.aborted) setQuoteError(e.message); });
      }, 180);
      return () => { clearTimeout(timer); a.abort(); };
    }, [quoteKey, !!s.pending]);
    useEffect(() => { if (s.error?.rejected) refreshQuote(n => n + 1); }, [s.error]);
    const snapshot = quote?.key === quoteKey ? quote.snapshot : null, p = snapshot?.product;
    const total = p?.unitPriceMinor == null ? null : p.unitPriceMinor * q;
    const available = p && p.catalogStatus !== 'unavailable' && p.unitPriceMinor != null && p.available >= q;
    const valid = available && buyerId && validQuantity && Number.isSafeInteger(total) && Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= 10080;
    const locked = s.busy || !!s.pending || s.blocked;
    function submit(e) {
      e.preventDefault(); if (!valid || locked) return;
      s.submit({ productId, buyerId, quantity: q, holdMinutes: minutes, expectedRevision: p.revision,
        ...(p.catalogRevision ? { expectedCatalogRevision: p.catalogRevision } : {}) });
    }
    return h('form', { className: 'me-compose me-order-compose', onSubmit: submit }, h(SubmissionNotice, { submission: s }),
      s.pending?.offerId ? h('p', { className: 'me-help' }, `上次提交包含旧供货名额 ${s.pending.offerId}，核对时保留原请求。`) : null,
      h('div', { className: 'me-detail-grid' }, h('div', null,
        h('section', { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '客户与采购商品')),
          h('fieldset', { disabled: locked, className: 'me-card-body me-compose-fields' },
            h(Choice, { label: '客户', name: 'buyerId', value: buyerId, onChange: setBuyerId, choices: buyers, disabled: locked, textOf: r => r.contact ? `${r.name} · ${r.contact}` : r.name }),
            h(Choice, { label: '商品 / SKU', name: 'productId', value: productId, onChange: setProductId, choices: products, disabled: locked, textOf: r => `${r.name} · ${r.skuCode || r.id}` }),
            field('采购数量', h('input', { name: 'quantity', type: 'number', min: 1, max: 1e9, step: 1, required: true, value: quantity, onChange: e => setQuantity(e.target.value) }), '单价按实际数量读取原产品库的阶梯报价。'))),
        h('section', { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '预留条件')),
          h('fieldset', { disabled: locked, className: 'me-card-body me-compose-fields' },
            field('预留时长（分钟）', h('input', { name: 'holdMinutes', type: 'number', min: 1, max: 10080, step: 1, required: true, value: holdMinutes, onChange: e => setHoldMinutes(e.target.value) }), '到期后释放预留数量。')))),
        h('aside', { className: 'me-card', 'aria-label': '订单报价汇总' }, h('div', { className: 'me-card-header' }, h('h2', null, '采购小计'), button(null, () => refreshQuote(n => n + 1), { icon: 'refresh', className: 'me-icon-button', disabled: locked || !productId, 'aria-label': '重新读取报价' })),
          h('div', { className: 'me-card-body' }, s.pending ? h('p', { className: 'me-help' }, '核对上次提交后，以订单回执中的金额和当前状态为准。')
            : quoteError ? h('p', { role: 'alert' }, quoteError) : !snapshot ? h('p', { role: 'status', className: 'me-help' }, !productId ? '选择商品与数量后显示实际报价。' : !validQuantity ? '请填写有效的采购数量。' : '正在读取报价…')
              : h(React.Fragment, null,
                h('p', { className: 'me-section-label' }, p.name), h('div', { className: 'me-quote', 'data-quote-total': Number.isSafeInteger(total) ? total : '' }, Number.isSafeInteger(total) ? money(total, p.currency) : '待确认'),
                h('div', { className: 'me-data-row' }, '单价', h('b', null, price(p))), h('div', { className: 'me-data-row' }, '采购数量', h('b', null, `${q} ${p.unit || '件'}`)),
                h('div', { className: 'me-data-row' }, '当前可分配', h('b', null, p.available)), h('div', { className: 'me-data-row' }, '起订量', h('b', null, p.moq ?? '待确认')),
                p.unitPriceMinor == null ? h('p', { role: 'alert', className: 'me-help' }, '当前数量尚无可用报价。请核对起订量和商品资料。') : null,
                total !== null && !Number.isSafeInteger(total) ? h('p', { role: 'alert', className: 'me-help' }, '商品小计超出支持范围，请减少数量。') : null,
                p.available < q ? h('p', { role: 'alert', className: 'me-help' }, '可供应数量不足，请调整采购数量。') : null,
                h('p', { className: 'me-help' }, `读取于 ${clock(snapshot.asOf)}。提交时会再次校验报价、数量与名额。`)),
            h('p', { className: 'me-help' }, '金额为商品小计，不含运费、税费。创建预留不会收款或发货。')))),
      h('div', { className: 'me-compose-footer' }, button(s.pending ? '稍后核对' : '取消', onClose, { disabled: s.busy }),
        s.pending ? button(s.busy ? '正在核对…' : '重试同一次提交', () => s.submit(), { disabled: s.busy, className: 'me-button-primary' })
          : button('创建预留', undefined, { type: 'submit', disabled: s.blocked || !valid, className: 'me-button-primary' })));
  }

  function CustomerOrders({ workspace, customerId, onOpen }) {
    const orders = useChoices(workspace, 'order', { buyerId: customerId });
    return h('section', { className: 'me-card me-customer-orders' },
      h('div', { className: 'me-card-header' }, h('h2', null, '订单'), h('small', null, `已读取 ${orders.items.length} 条`)),
      orders.error ? h('div', { role: 'alert', className: 'me-card-body' }, orders.error, button('重新读取', orders.retry)) : null,
      orders.items.length ? h('div', { className: 'me-table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['订单', '状态', '商品小计'].map(label => h('th', { key: label }, label)))),
        h('tbody', null, orders.items.map(order => h('tr', { key: order.id },
          h('td', null, button(shortId(order.id), () => onOpen(order), { className: 'me-text-button', 'data-customer-order': order.id })),
          h('td', null, badge(order.status)), h('td', null, money(order.totalMinor, order.currency)))))))
        : h('p', { className: 'me-card-body' }, orders.loading ? '正在读取订单…' : orders.error ? '订单暂时无法读取。' : '该客户还没有订单。'),
      orders.hasMore ? h('div', { className: 'me-card-body' }, button(orders.loading ? '正在读取…' : '加载更多订单', orders.more, { disabled: orders.loading })) : null);
  }
  // The page map is shared by navigation, command search and capability disclosure.
  const pages = {
    home: ['首页', 'home'], orders: ['订单', 'order'], drafts: ['草稿订单', 'document'], abandoned: ['弃单', 'cart'],
    products: ['商品', 'product'], collections: ['产品系列', 'collection'], inventory: ['库存', 'inventory'], purchase_orders: ['采购订单', 'document'], transfers: ['转移', 'transfer'], gift_cards: ['礼品卡', 'gift'],
    customers: ['客户', 'buyer'], segments: ['客户细分', 'segments'], marketing: ['营销', 'marketing'], campaigns: ['营销活动', 'marketing'], automations: ['自动化', 'automation'],
    discounts: ['折扣', 'discount'], content: ['内容', 'document'], files: ['文件', 'folder'], metaobjects: ['元对象', 'collection'], menus: ['菜单', 'menu'], blog: ['博客文章', 'document'],
    markets: ['市场', 'globe'], analytics: ['分析', 'chart'], reports: ['报告', 'document'], live: ['实时视图', 'activity'], finances: ['财务', 'wallet'],
    online_store: ['在线商店', 'store'], themes: ['主题', 'palette'], store_pages: ['页面', 'document'], preferences: ['商店偏好设置', 'settings'],
    apps: ['应用', 'apps'], settings: ['设置', 'settings'], store_details: ['店铺详情', 'store'], payments: ['支付', 'wallet'], checkout: ['结账', 'cart'],
    shipping: ['发货和配送', 'truck'], taxes: ['税费', 'document'], locations: ['地点', 'pin'], domains: ['域名', 'globe'], notifications: ['通知', 'bell'], users: ['用户和权限', 'buyer'], appearance: ['显示偏好', 'palette'], connections: ['接入状态', 'link'],
  };
  const navGroups = [
    ['home', []], ['orders', ['drafts', 'abandoned']], ['products', ['collections', 'inventory', 'purchase_orders', 'transfers', 'gift_cards']],
    ['customers', ['segments']], ['marketing', ['campaigns', 'automations']], ['discounts', []], ['content', ['files', 'metaobjects', 'menus', 'blog']],
    ['markets', []], ['analytics', ['reports', 'live']], ['finances', []],
  ];
  const settingsPages = ['store_details', 'payments', 'checkout', 'shipping', 'taxes', 'locations', 'domains', 'notifications', 'users', 'appearance', 'connections'];
  const livePages = new Set(['home', 'orders', 'products', 'inventory', 'customers', 'content', 'files', 'settings', 'store_details', 'appearance', 'connections']);
  const resourceColumns = {
    drafts: ['草稿订单', '客户', '状态', '总计'], abandoned: ['结账', '客户', '恢复状态', '总计'], collections: ['标题', '商品条件', '商品数量'],
    purchase_orders: ['采购订单', '供应商', '目的地', '状态'], transfers: ['转移', '发货地', '目的地', '状态'], gift_cards: ['礼品卡', '客户', '状态', '余额'],
    segments: ['细分名称', '客户占比', '上次编辑'], campaigns: ['营销活动', '状态', '渠道', '转化'], automations: ['自动化', '状态', '触发条件'],
    discounts: ['折扣', '状态', '方法', '类型'], metaobjects: ['定义', '条目', '上次更新'], menus: ['菜单', '菜单项'], blog: ['标题', '作者', '可见性'],
    reports: ['报告', '类别', '上次查看'], store_pages: ['标题', '可见性', '上次编辑'], markets: ['市场', '状态', '地区'],
  };
  const connectionInfo = {
    drafts: ['草稿订单服务', '草稿需要支持多商品行、调整价格和转换为正式订单。目前保留的采购预留不会自动转换成草稿。', ['商品行与客户', '报价与折扣', '转换为正式订单']],
    abandoned: ['结账会话', '接入商店结账后，才能查看未完成的结账和恢复情况。', ['结账会话', '客户联系方式', '恢复记录']],
    collections: ['产品系列', '商品主数据已接入；手动系列和自动系列条件尚未保存。', ['手动选择商品', '自动系列条件', '系列发布']],
    purchase_orders: ['采购与收货', '当前没有供应商采购单、收货或采购成本记录。', ['供应商资料', '采购商品', '收货数量']],
    transfers: ['多地点库存', '转移需要发货地点、收货地点及实际库存流水。', ['发货地点', '收货地点', '在途与收货']],
    gift_cards: ['礼品卡服务', '礼品卡的发行、余额和兑换需要独立交易支持。', ['发行与有效期', '余额', '兑换记录']],
    segments: ['客户细分', '客户资料已接入；细分条件和动态人群尚未启用。', ['筛选条件', '动态客户群', '营销授权']],
    marketing: ['营销渠道', '连接实际营销渠道后，才能读取广告支出、营销活动和转化。', ['渠道连接', '活动记录', '归因与转化']],
    campaigns: ['营销渠道', '当前没有已接入的营销活动来源。', ['活动', '渠道', '转化']],
    automations: ['营销自动化', '自动化需要真实触发事件、客户营销授权和发送渠道。', ['触发事件', '发送渠道', '发送结果']],
    discounts: ['折扣引擎', '当前订单尚未支持折扣计算或结账折扣码。', ['折扣码', '自动折扣', '适用条件']],
    metaobjects: ['自定义内容', '文件库已接入；元对象定义和条目服务尚未接入。', ['定义', '条目', '商店引用']],
    menus: ['商店导航', '需要连接商店页面与发布服务，才能保存并发布菜单。', ['菜单项', '页面链接', '发布']],
    blog: ['博客发布', '当前没有博客、文章或公开发布服务。', ['文章内容', '作者与日期', '公开发布']],
    markets: ['市场配置', '市场需要地区、币种、定价和商店销售范围支持。', ['地区与语言', '市场定价', '销售范围']],
    analytics: ['经营分析', '当前订单没有付款、退款或访问记录，无法生成销售额和转化率。', ['访问与转化', '付款与退款', '销售报表']],
    reports: ['报表数据', '接入真实订单付款及访问数据后，才能生成经营报告。', ['销售报告', '客户报告', '库存报告']],
    live: ['访客事件', '当前未采集商店访客、购物车或结账事件。', ['实时访客', '购物车事件', '结账事件']],
    finances: ['支付与结算', '确认预留不代表收款。付款、退款和结算记录尚未接入。', ['付款记录', '退款', '结算']],
    online_store: ['商店发布', '后台商品资料已接入；面向客户的商店、主题和结账尚未部署。', ['商店主题', '页面与域名', '发布与结账']],
    themes: ['主题运行时', '需要商店主题运行时和预览／发布服务。', ['主题库', '主题编辑', '预览与发布']],
    store_pages: ['页面发布', '当前只有内部资料文件，没有公开商店页面服务。', ['页面内容', '可见性', '公开链接']],
    preferences: ['商店发布', '商店搜索摘要、密码保护和访客追踪需要实际商店支持。', ['搜索摘要', '访问保护', '访客追踪']],
    apps: ['商务应用连接', '当前没有已连接的商务应用。DSH 插件由宿主管理。', ['应用授权', '数据连接', '连接状态']],
    payments: ['支付服务', '连接支付服务后，才能收款、退款和核对结算。', ['支付方式', '收款', '退款与结算']],
    checkout: ['结账服务', '当前没有公开结账页面、结账会话或支付接入。', ['客户信息', '配送选择', '付款']],
    shipping: ['配送服务', '当前没有运费计算、包裹或承运商履约记录。', ['配送区域', '运费', '承运商']],
    taxes: ['税费计算', '税费需要根据商家、商品及收货地区计算。当前小计不含税费。', ['税务登记', '适用地区', '税费计算']],
    locations: ['库存地点', '当前可供应分配账本不等于地点现存量。', ['地点', '现存量', '出入库流水']],
    domains: ['域名与站点', '没有公开商店时，无法绑定域名或检查站点证书。', ['域名', 'DNS', '证书']],
    notifications: ['通知渠道', '保存客户和订单不会发送消息。邮件和短信服务尚未接入。', ['邮件', '短信', '发送结果']],
    users: ['经营者权限', '当前访问由 DSH 宿主认证管理；尚无店铺员工角色与细分权限。', ['员工账号', '角色', '操作权限']],
  };
  function readLocation() {
    const query = new URLSearchParams(window.location.search);
    const page = query.get('erp_page');
    return { page: Object.hasOwn(pages, page) ? page : 'home', workspace: query.get('erp_workspace') || '' };
  }
  async function libraryRead(path, signal) {
    const response = await fetch('/workspace-library-api' + path, { credentials: 'same-origin', cache: 'no-store', signal });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error?.message || '资料暂时无法读取，请重试。');
    return result.data;
  }
  function useResource(load, key) {
    const [state, setState] = useState({ loading: true, value: null, error: '' }), [nonce, reload] = useState(0);
    useEffect(() => {
      const a = new AbortController(); setState({ key, loading: true, value: null, error: '' });
      Promise.resolve().then(() => load(a.signal)).then(value => { if (!a.signal.aborted) setState({ key, loading: false, value, error: '' }); })
        .catch(error => { if (!a.signal.aborted) setState({ key, loading: false, value: null, error: error.message }); });
      return () => a.abort();
    }, [key, nonce]);
    return { ...(state.key === key ? state : { loading: true, value: null, error: '' }), reload: () => reload(n => n + 1) };
  }
  function PageHeading({ title, subtitle, actions, crumb, onBack }) {
    return h('div', { className: 'me-heading' }, h('div', { className: 'me-heading-title' },
      onBack ? button(null, onBack, { icon: 'back', className: 'me-icon-button me-back', 'aria-label': '返回' }) : null,
      h('div', null, crumb ? h('p', { className: 'me-crumb' }, crumb) : null, h('h1', { tabIndex: -1 }, title), subtitle ? h('p', null, subtitle) : null)), actions ? h('div', { className: 'me-actions' }, actions) : null);
  }
  function ResourceState({ resource, children }) {
    if (resource.loading) return h('div', { className: 'me-loading', role: 'status', 'aria-label': '正在读取' }, h('div', { className: 'me-skeleton' }), h('div', { className: 'me-skeleton' }), h('div', { className: 'me-skeleton' }));
    if (resource.error) return h('div', { className: 'me-alert me-alert-error', role: 'alert' }, h(Icon, { name: 'info' }), h('span', null, resource.error), button('重新读取', resource.reload));
    return children;
  }
  function csvFile(name, headers, rows) {
    const cell = value => { const raw = String(value ?? ''); return '"' + (/^[\s]*[=+@\-\t\r]/.test(raw) ? "'" + raw : raw).replaceAll('"', '""') + '"'; };
    const blob = new Blob(['\ufeff' + [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function CatalogIndex({ kind, onOpen, onCreate, onInventory }) {
    const files = kind === 'files';
    const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [offset, setOffset] = useState(0), [sort, setSort] = useState('updated'), [selected, setSelected] = useState([]);
    const params = new URLSearchParams({ q: query, status, offset: String(offset), limit: '50', sort });
    const resource = useResource(signal => libraryRead(`/${files ? 'documents' : 'products'}?${params}`, signal), `${kind}:${params}`);
    const rows = resource.value?.items || [];
    const selection = useRef(null);
    useEffect(() => { if (selection.current) selection.current.indeterminate = selected.length > 0 && selected.length < rows.length; }, [selected, resource.value, resource.loading]);
    useEffect(() => { if (resource.value) setSelected(old => old.filter(id => resource.value.items.some(row => row.id === id))); }, [resource.value]);
    useEffect(() => { setSelected([]); }, [kind, query, status, offset, sort]);
    function change(fn, value) { fn(value); setOffset(0); }
    function exportRows() {
      const data = rows.filter(row => selected.includes(row.id));
      csvFile(files ? 'files.csv' : 'products.csv', files ? ['ID', '文件名称', '类型', '状态', '版本'] : ['ID', '商品', '状态', '分类', '变体数量'],
        data.map(row => files ? [row.id, row.title, row.slotLabel, row.status, row.currentVersion] : [row.id, row.name, row.status, row.category, row.skuCount]));
    }
    return h(React.Fragment, null,
      h(PageHeading, { title: files ? '文件' : '商品', subtitle: files ? '管理商品与企业使用的文件。' : '管理商品、变体、图片与商品资料。',
        actions: [!files ? button('查看库存', onInventory, { key: 'inventory', icon: 'inventory' }) : null,
          button(files ? '上传文件' : '添加商品', onCreate, { key: 'create', className: 'me-button-primary', icon: 'plus' })] }),
      h('section', { className: 'me-card' },
        h('div', { className: 'me-list-toolbar' }, h('div', { className: 'me-views' }, [['', '全部'], [files ? 'active' : 'draft', files ? '可用' : '草稿'], ['archived', '已归档']].map(([value, label]) => button(label, () => change(setStatus, value), { key: value, 'aria-pressed': status === value }))),
          h('div', { className: 'me-list-controls' }, h('label', { className: 'me-search' }, h(Icon, { name: 'search', size: 16 }), h('input', { type: 'search', value: query, maxLength: 200, placeholder: files ? '搜索文件' : '搜索所有商品', 'aria-label': files ? '搜索文件' : '搜索所有商品', onChange: e => change(setQuery, e.target.value) }), query ? button(null, e => { change(setQuery, ''); e.currentTarget.closest('label').querySelector('input').focus(); }, { icon: 'close', className: 'me-button-plain me-search-clear', 'aria-label': '清除列表搜索' }) : null),
            h('select', { className: 'me-sort', 'aria-label': '排序', value: sort, onChange: e => change(setSort, e.target.value) }, h('option', { value: 'updated' }, '最近更新'), h('option', { value: 'name_asc' }, '名称 A–Z'), h('option', { value: 'name_desc' }, '名称 Z–A')),
            button(null, resource.reload, { icon: 'refresh', className: `me-icon-button${resource.loading ? ' is-loading' : ''}`, disabled: resource.loading, 'aria-label': '刷新' }))),
        selected.length ? h('div', { className: 'me-selection-bar' }, h('strong', null, `已选择 ${selected.length} 项`), button('导出所选', exportRows, { icon: 'download' }), button('取消选择', () => setSelected([]), { className: 'me-button-plain' })) : null,
        h(ResourceState, { resource }, !rows.length ? h('div', { className: 'me-empty' }, h(EmptyArtwork, { entity: files ? 'document' : 'product' }),
          h('h2', null, query || status ? '没有符合条件的记录' : files ? '让文件井井有条' : '添加你的第一件商品'),
          h('p', null, query || status ? '调整搜索词或筛选条件后重试。' : files ? '上传真实文件，在商品和企业资料中重复使用。' : '从商品名称开始，添加图片、变体和价格。'),
          query || status ? button('清除筛选', () => { setQuery(''); setStatus(''); setOffset(0); }) : button(files ? '上传文件' : '添加商品', onCreate, { className: 'me-button-primary' }))
          : h('div', { className: 'me-table-wrap', tabIndex: 0, role: 'region', 'aria-label': files ? '文件列表' : '商品列表' }, h('table', null,
            h('thead', null, h('tr', null, h('th', { className: 'me-check-cell' }, h('input', { ref: selection, type: 'checkbox', 'aria-label': '选择本页全部', checked: rows.length > 0 && selected.length === rows.length, onChange: e => setSelected(e.target.checked ? rows.map(r => r.id) : []) })),
              (files ? ['文件名称', '类型', '状态', '版本', '更新日期'] : ['商品', '状态', '变体', '分类', '更新日期']).map(label => h('th', { key: label, scope: 'col' }, label)))),
            h('tbody', null, rows.map(row => h('tr', { key: row.id, 'data-selected': selected.includes(row.id) },
              h('td', { className: 'me-check-cell' }, h('input', { type: 'checkbox', 'aria-label': `选择 ${row.name || row.title}`, checked: selected.includes(row.id), onChange: e => setSelected(old => e.target.checked ? [...old, row.id] : old.filter(id => id !== row.id)) })),
              h('td', null, h('div', { className: 'me-product-cell' }, h('div', { className: 'me-thumb' }, row.primaryImageId ? h('img', { src: `/workspace-library-api/products/${encodeURIComponent(row.id)}/images/${encodeURIComponent(row.primaryImageId)}`, alt: '' }) : h(Icon, { name: files ? 'document' : 'product' })),
                button(row.name || row.title, () => onOpen(row.id), { className: 'me-text-button me-record-button', 'data-catalog-record': row.id }))),
              ...(files ? [h('td', { key: 'type' }, row.slotLabel), h('td', { key: 'status' }, badge(row.status, row.status === 'active' ? '可用' : '已归档')), h('td', { key: 'version' }, `v${row.currentVersion}`)]
                : [h('td', { key: 'status' }, badge(row.status, row.status === 'draft' ? '草稿' : '已归档')), h('td', { key: 'sku' }, `${row.skuCount} 个变体`), h('td', { key: 'category' }, row.category || '—')]),
              h('td', null, new Date(row.updatedAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })))))))),
        h('div', { className: 'me-list-footer' }, h('span', null, resource.value ? `${resource.value.matched} 项${query || status ? ` · 共 ${resource.value.total} 项` : ''}` : '正在读取…'),
          h('div', { className: 'me-actions' }, button(null, () => setOffset(v => Math.max(0, v - 50)), { icon: 'back', 'aria-label': '上一页', disabled: !offset || resource.loading }),
            h('span', null, `第 ${Math.floor(offset / 50) + 1} 页`), button(null, () => setOffset(resource.value.nextOffset), { icon: 'arrow', 'aria-label': '下一页', disabled: !resource.value?.hasMore || resource.loading })))),
      h('p', { className: 'me-page-note' }, h(Icon, { name: 'info', size: 14 }), files ? '文件保留原始版本。预览和下载使用已登录的访问权限。' : '商品资料使用原产品库；公开商店发布尚未接入。'));
  }
  function HomePage({ workspace, title, navigate, onCreateProduct }) {
    const resource = useResource(async signal => {
      const [catalog, files, ledger] = await Promise.all([libraryRead('/products?limit=1', signal), libraryRead('/documents?limit=1', signal), workspace ? request(`/workspaces/${encodeURIComponent(workspace)}/overview`, null, signal) : Promise.resolve(null)]);
      return { catalog, files, ledger };
    }, workspace);
    const value = resource.value;
    return h(React.Fragment, null, h(PageHeading, { title: '首页', subtitle: title ? `欢迎回到 ${title}` : '从这里开始管理你的业务', actions: button('查看店铺设置', () => navigate('store_details'), { icon: 'settings' }) }),
      h(ResourceState, { resource }, value ? h(React.Fragment, null,
        h('div', { className: 'me-overview-grid' }, [
          ['商品', value.catalog.total, '产品库中的商品', 'products'], ['客户', value.ledger?.customers ?? '—', '当前工作区客户', 'customers'],
          ['订单记录', value.ledger?.orders.total ?? '—', '预留与历史订单', 'orders'], ['待确认预留', value.ledger?.orders.reserved ?? '—', '尚未到期的预留', 'orders'],
        ].map(([label, count, hint, page]) => h('button', { key: label, className: 'me-metric', onClick: () => navigate(page) }, h('span', null, label, h(Icon, { name: 'arrow', size: 13 })), h('strong', null, count), h('small', null, hint)))),
        h('div', { className: 'me-home-grid' },
          h('section', { className: 'me-card me-setup-card' }, h('div', { className: 'me-card-body' }, h('div', { className: 'me-kicker' }, '准备好开展业务'), h('h2', null, '把商品、客户和资料整理到一起'), h('p', { className: 'me-subtle' }, '从真实资料开始。每一步都保存到现有业务库。'),
            h('div', { className: 'me-setup-progress', 'aria-label': '资料准备进度' }, h('span', { style: { width: `${[value.catalog.total > 0, (value.ledger?.customers || 0) > 0, value.files.total > 0].filter(Boolean).length / 3 * 100}%` } }))),
            [['添加商品', '准备名称、图片、变体和报价。', value.catalog.total > 0, onCreateProduct], ['整理文件', '上传规格、产品资料与企业文件。', value.files.total > 0, () => navigate('files')], ['添加客户', '保存客户资料并查看关联订单。', (value.ledger?.customers || 0) > 0, () => navigate('customers')]].map(([label, description, done, action]) => h('button', { key: label, className: 'me-setup-row', onClick: action }, h('span', { className: `me-step-mark${done ? ' is-done' : ''}` }, done ? h(Icon, { name: 'check', size: 13 }) : null), h('span', null, h('strong', null, label), h('small', null, description)), h(Icon, { name: 'arrow', size: 15 })))),
          h('div', { className: 'me-home-aside' }, h('section', { className: 'me-card' }, h('div', { className: 'me-card-body' }, h('span', { className: 'me-feature-icon' }, h(Icon, { name: 'store', size: 24 })), h('h2', null, '你的后台，统一管理'), h('p', { className: 'me-subtle' }, '商品、客户和文件已可管理。在线商店、支付与配送需要接入对应服务。'), button('查看接入状态', () => navigate('connections'), { className: 'me-text-button', icon: 'arrow' }))),
            h('section', { className: 'me-card' }, h('div', { className: 'me-card-body' }, h('h2', null, '快捷入口'), h('div', { className: 'me-quick-links' }, [['inventory', '查看库存能力'], ['orders', '跟进已有订单'], ['store_details', '完善店铺信息']].map(([page, label]) => button(label, () => navigate(page), { key: page, className: 'me-text-button', icon: pages[page][1] }))))))),
        h('p', { className: 'me-page-note' }, h(Icon, { name: 'info', size: 14 }), value.ledger ? `更新于 ${clock(value.ledger.asOf)} · 订单记录数量不代表已付款销售。` : '添加 DSH 工作区后，即可管理客户和订单。')) : null));
  }
  function ConnectionPage({ page, navigate, embedded = false }) {
    const [service, description, parts] = connectionInfo[page] || ['业务服务', '此页面需要连接对应业务服务。', []];
    const columns = resourceColumns[page];
    return h(React.Fragment, null, !embedded ? h(PageHeading, { title: pages[page][0], subtitle: description }) : null,
      h('section', { className: 'me-card me-connection-card' },
        columns ? h('div', { className: 'me-table-wrap' }, h('table', { 'aria-label': `${pages[page][0]}字段` }, h('thead', null, h('tr', null, columns.map(column => h('th', { key: column }, column)))))) : null,
        h('div', { className: 'me-connection-empty' }, h('div', { className: 'me-connection-art', 'aria-hidden': true }, h('span', null, h(Icon, { name: pages[page][1], size: 34 })), h('i', null, h(Icon, { name: 'link', size: 14 }))),
          badge('neutral', '未接入'), h('h2', null, `${service}尚未连接`), h('p', null, description),
          button('查看接入状态', () => navigate('connections'), { className: 'me-button-primary' }))),
      h('div', { className: 'me-capability-grid' }, parts.map((part, index) => h('section', { className: 'me-card', key: part }, h('div', { className: 'me-card-body' }, h('span', { className: 'me-capability-number' }, `0${index + 1}`), h('h3', null, part), h('p', { className: 'me-subtle' }, '需要接入对应数据与执行服务。'))))));
  }
  function ContentPage({ navigate }) {
    return h(React.Fragment, null, h(PageHeading, { title: '内容', subtitle: '管理文件以及商店中使用的内容。' }),
      h('div', { className: 'me-content-grid' }, [['files', '商品图片、规格文件与企业资料。', true], ['metaobjects', '可重复使用的结构化内容。', false], ['menus', '商店的导航与页面链接。', false], ['blog', '文章与公开内容。', false]].map(([page, description, ready]) => h('button', { key: page, className: 'me-card me-content-card', onClick: () => navigate(page) }, h('div', { className: 'me-content-icon' }, h(Icon, { name: pages[page][1], size: 30 })), h('div', null, h('h2', null, pages[page][0]), h('p', null, description), badge(ready ? 'linked' : 'neutral', ready ? '已接入' : '未接入')), h(Icon, { name: 'arrow', size: 17 })))));
  }
  function SettingsPage({ page, navigate, appearance, setAppearance, density, setDensity, onDirtyChange, onBusy, onSaved }) {
    const selected = page === 'settings' ? 'store_details' : page;
    return h(React.Fragment, null, h(PageHeading, { title: '设置', subtitle: '管理店铺资料、显示偏好与服务接入。' }),
      h('div', { className: 'me-settings-grid' }, h('nav', { className: 'me-settings-nav', 'aria-label': '设置导航' }, settingsPages.map(id => button(pages[id][0], () => navigate(id), { key: id, icon: pages[id][1], 'aria-current': selected === id ? 'page' : undefined }))),
        h('div', { className: 'me-settings-content' }, h('h2', { className: 'me-settings-title' }, pages[selected][0]),
          selected === 'store_details' ? h('div', { className: 'me-settings-row' }, h('div', null, h('h3', null, '基本信息'), h('p', { className: 'me-subtle' }, '沿用资料库中的企业名称与介绍。')), h('section', { className: 'me-card me-card-body' }, h(CompanySettingsSurface, { onDirtyChange, onBusy, onSaved })))
            : selected === 'appearance' ? h('div', { className: 'me-settings-row' }, h('div', null, h('h3', null, '后台显示'), h('p', { className: 'me-subtle' }, '仅保存在当前浏览器，不影响店铺或其他经营者。')),
              h('section', { className: 'me-card me-card-body me-preferences' }, field('外观', h('select', { name: 'appearance', value: appearance, onChange: e => setAppearance(e.target.value) }, h('option', { value: 'system' }, '跟随 DSH'), h('option', { value: 'light' }, '浅色'), h('option', { value: 'dark' }, '深色'))),
                field('列表密度', h('select', { name: 'density', value: density, onChange: e => setDensity(e.target.value) }, h('option', { value: 'comfortable' }, '标准'), h('option', { value: 'compact' }, '紧凑'))), h('p', { className: 'me-help' }, '选择后即时生效。')))
              : selected === 'connections' ? h('section', { className: 'me-card' }, [['商品资料', '已接入', '原产品库、变体、图片与资料', 'products'], ['客户资料', '已接入', '客户信息、备注与订单查看', 'customers'], ['文件', '已接入', '上传、版本、预览与下载', 'files'], ['订单', '部分接入', '已有采购预留；草稿订单、付款和履约尚未实现', 'orders'], ['库存', '部分接入', '现有可供应分配；非地点现存量', 'inventory'], ['支付与结算', '未接入', '当前没有付款或退款记录', 'payments'], ['发货和配送', '未接入', '当前没有包裹和履约记录', 'shipping'], ['在线商店', '未接入', '当前没有公开商店和结账', 'online_store'], ['营销与分析', '未接入', '当前没有渠道和访问统计', 'marketing']].map(([title, status, description, target]) => h('div', { key: title, className: 'me-connection-row' }, h('div', null, h('strong', null, title), h('p', null, description)), badge(status === '已接入' ? 'linked' : 'neutral', status), button('查看', () => navigate(target), { className: 'me-text-button', 'aria-label': `查看${title}` }))))
                : h(ConnectionPage, { page: selected, navigate, embedded: true }))));
  }
  function SearchDialog({ workspace, onClose, onNavigate, onProduct, onFile, onCustomer, onOrder, returnFocus }) {
    const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [activeIndex, setActiveIndex] = useState(0);
    const input = useRef(null), dialog = useRef(null), restore = useRef(true);
    useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 180); return () => clearTimeout(timer); }, [query]);
    useEffect(() => { input.current?.focus(); return () => { setTimeout(() => {
      if (!document.querySelector('.me-command-dialog')) {
        if (restore.current && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        else document.querySelector('.me-main h1')?.focus({ preventScroll: true });
      }
    }, 0); }; }, []);
    const resource = useResource(async signal => {
      if (!search) return [];
      const jobs = [libraryRead('/search?' + new URLSearchParams({ q: search, limit: '10' }), signal), ...workspace ? ['buyer', 'order'].map(entity => request(`/workspaces/${encodeURIComponent(workspace)}/read?` + new URLSearchParams({ entity, q: search, limit: '10' }), null, signal)) : []];
      const results = await Promise.allSettled(jobs);
      return results.map(result => result.status === 'fulfilled' ? { data: result.value } : { error: result.reason.message });
    }, `${workspace}:${search}`);
    const waiting = query.trim() !== search || resource.loading;
    const results = waiting ? [] : resource.value || [], failed = results.some(row => row.error);
    const library = results[0]?.data?.hits || [], customers = results[1]?.data?.items || [], orders = results[2]?.data?.items || [];
    const choices = [
      ...Object.entries(pages).filter(([, [title]]) => !query || title.includes(query.trim())).slice(0, query.trim() ? 5 : 9)
        .map(([id, [title, icon]]) => ({ key: id, label: title, type: livePages.has(id) ? '页面' : '未接入', icon, group: '前往', run: () => onNavigate(id) })),
      ...library.map(row => ({ key: row.type + row.id, label: row.title, type: row.type === 'product' ? '商品' : '文件', icon: row.type === 'product' ? 'product' : 'document', group: '商品与文件', run: () => row.type === 'product' ? onProduct(row.id) : onFile(row.id) })),
      ...customers.map(row => ({ key: 'customer' + row.id, label: row.name, type: '客户', icon: 'buyer', group: '当前工作区', run: () => onCustomer(row.id) })),
      ...orders.map(row => ({ key: 'order' + row.id, label: shortId(row.id), type: '订单', icon: 'order', group: '当前工作区', run: () => onOrder(row.id) })),
    ];
    const signature = choices.map(row => row.key).join('|');
    useEffect(() => { setActiveIndex(0); }, [query, signature]);
    const active = choices.length ? Math.min(activeIndex, choices.length - 1) : -1;
    function choose(index) { if (!choices[index]) return; restore.current = false; onClose(); choices[index].run(); }
    function keys(e) {
      if (e.nativeEvent?.isComposing || e.isComposing) return;
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const nodes = [...dialog.current.querySelectorAll('button:not(:disabled):not([tabindex="-1"]),input')], first = nodes[0], last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
      if (e.target === input.current && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && choices.length) {
        e.preventDefault(); const next = (active + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
        setActiveIndex(next); document.getElementById(`me-search-option-${next}`)?.scrollIntoView?.({ block: 'nearest' });
      }
      if (e.target === input.current && e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
    }
    return h('div', { className: 'me-modal-backdrop', onClick: e => { if (e.target === e.currentTarget) onClose(); } },
      h('section', { ref: dialog, className: 'me-command-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': '搜索后台', onKeyDown: keys },
        h('div', { className: 'me-command-input' }, h(Icon, { name: 'search' }), h('input', { ref: input, type: 'search', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': true, 'aria-controls': 'me-search-options', 'aria-activedescendant': active >= 0 ? `me-search-option-${active}` : undefined,
          placeholder: '搜索商品、文件、客户或订单', maxLength: 200, value: query, onChange: e => setQuery(e.target.value), 'aria-label': '搜索后台' }),
          query ? button(null, () => { setQuery(''); input.current.focus(); }, { icon: 'close', className: 'me-icon-button me-button-plain', 'aria-label': '清除搜索' }) : null,
          button('Esc', onClose, { className: 'me-button-plain', 'aria-label': '关闭搜索' })),
        h('div', { className: 'me-command-results' },
          h('div', { id: 'me-search-options', role: 'listbox', 'aria-label': '搜索结果', 'aria-busy': waiting }, choices.map((row, index) => h(React.Fragment, { key: row.key },
            index === 0 || choices[index - 1].group !== row.group ? h('div', { className: 'me-command-label', role: 'presentation' }, row.group) : null,
            h('button', { type: 'button', id: `me-search-option-${index}`, role: 'option', 'aria-selected': active === index, tabIndex: -1, 'data-search-result': true, className: 'me-search-result',
              onMouseDown: e => e.preventDefault(), onMouseMove: () => setActiveIndex(index), onClick: () => choose(index) },
              h('span', { className: 'me-result-icon' }, h(Icon, { name: row.icon })), h('span', null, row.label), h('small', null, row.type), h(Icon, { name: 'arrow', size: 14 }))))),
          waiting && query.trim() ? h('p', { className: 'me-command-label', role: 'status' }, '正在搜索…') : null,
          failed ? h('div', { role: 'alert', className: 'me-command-error' }, h('span', null, '部分来源读取失败，请重试。'), button('重新搜索', resource.reload, { className: 'me-text-button' })) : null,
          query.trim() && !waiting && !choices.length && !failed ? h('div', { className: 'me-command-empty', role: 'status' }, h(Icon, { name: 'search', size: 28 }), h('strong', null, '没有找到匹配结果'), h('p', null, '试试商品名称、客户邮箱或订单编号。')) : null),
        h('footer', null, h('span', null, h('kbd', null, '↑'), ' ', h('kbd', null, '↓'), ' 选择 · ', h('kbd', null, '↵'), ' 打开'), h('span', null, '每个来源最多 10 项；客户与订单限当前工作区。'))));
  }

  function Panel({ toggleHostSidebar }) {
    const [section, setSection] = useState(() => readLocation().page), [searchOpen, setSearchOpen] = useState(false), [expanded, setExpanded] = useState({});
    const [fileView, setFileView] = useState(null), searchReturnFocus = useRef(null);
    function closeMenu() { setMenuOpen(false); document.querySelector('.me-mobile-menu')?.focus({ preventScroll: true }); }
    function openSearch() { if (busy) return; searchReturnFocus.current = document.activeElement; setSearchOpen(true); }
    const preference = (key, fallback) => { try { return window.localStorage.getItem('erp-admin:' + key) || fallback; } catch { return fallback; } };
    const [appearance, changeAppearance] = useState(() => { const v = preference('appearance', 'system'); return ['system', 'light', 'dark'].includes(v) ? v : 'system'; });
    const [density, changeDensity] = useState(() => preference('density', 'comfortable') === 'compact' ? 'compact' : 'comfortable');
    const [workspaces, setWorkspaces] = useState([]), [workspace, setWorkspace] = useState(''), [workspaceReady, setWorkspaceReady] = useState(false);
    const [entity, setEntity] = useState(() => ({ orders: 'order', customers: 'buyer', inventory: 'product' }[readLocation().page] || 'product')), [data, setData] = useState(null), [detail, setDetail] = useState(null);
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [nonce, refresh] = useState(0);
    const [binding, setBinding] = useState(false), [catalog, setCatalog] = useState([]), [sourceId, setSourceId] = useState(''), [skuId, setSkuId] = useState(''), [stock, setStock] = useState('0');
    const [menuOpen, setMenuOpen] = useState(false);
    const [composer, setComposer] = useState(null), [orderToOpen, setOrderToOpen] = useState(null);
    const [editor, setEditor] = useState(null), [editorDirty, setEditorDirty] = useState(false), [filter, setFilter] = useState('all'), [sort, setSort] = useState('default');
    const [cursor, setCursor] = useState(''), [notice, setNotice] = useState(''), [query, setQuery] = useState('');
    const active = useRef(''), pending = useRef(null), detailRequest = useRef(0);
    active.current = workspace + '/' + entity + '/' + section;
    useEffect(() => {
      const a = new AbortController();
      request('/workspaces', null, a.signal).then(r => { setWorkspaces(r.items); setWorkspace(r.items.find(w => w.id === readLocation().workspace)?.id ?? r.items[0]?.id ?? ''); })
        .catch(e => { if (!a.signal.aborted) setError(e.message); }).finally(() => { if (!a.signal.aborted) setWorkspaceReady(true); });
      return () => a.abort();
    }, []);
    useEffect(() => {
      detailRequest.current++; setDetail(null); setBinding(false); setData(null); setBusy(false);
      if (!workspace || !['orders', 'customers', 'inventory'].includes(section)) return;
      const a = new AbortController(), key = workspace + '/' + entity + '/' + section; setError('');
      request(`/workspaces/${encodeURIComponent(workspace)}/read?${new URLSearchParams({ entity, limit: '50', ...(cursor ? { afterId: cursor } : {}), ...(['buyer', 'order'].includes(entity) && query ? { q: query } : {}) })}`, null, a.signal)
        .then(r => { if (!a.signal.aborted && active.current === key) setData(r); }).catch(e => { if (!a.signal.aborted) setError(e.message); });
      return () => a.abort();
    }, [workspace, entity, section, cursor, nonce, entity === 'product' ? '' : query]);
    useEffect(() => { if (workspace && orderToOpen && ['buyer', 'order'].includes(entity)) { setOrderToOpen(null); select({ id: orderToOpen }); } }, [workspace, entity, section, orderToOpen]);
    async function reload() {
      setError('');
      try {
        const r = await request('/workspaces'); setWorkspaces(r.items); setWorkspaceReady(true);
        setWorkspace(current => r.items.some(w => w.id === current) ? current : r.items[0]?.id ?? ''); refresh(n => n + 1);
      } catch (e) { setError(e.message); }
    }
    async function command(body) {
      const key = active.current, fingerprint = JSON.stringify([workspace, body]);
      const id = pending.current?.fingerprint === fingerprint ? pending.current.id : crypto.randomUUID();
      pending.current = { fingerprint, id }; setBusy(true); setError('');
      try {
        const result = await request(`/workspaces/${encodeURIComponent(workspace)}/command`, { ...body, requestId: id });
        pending.current = null;
        if (active.current === key) { setEditorDirty(false); refresh(n => n + 1); setNotice('已保存'); }
        return result;
      } catch (e) { if (active.current === key) setError(e.message); }
      finally { if (active.current === key) setBusy(false); }
    }
    async function select(row) {
      const key = active.current, sequence = ++detailRequest.current; setError(''); setNotice('');
      try {
        const result = await request(`/workspaces/${encodeURIComponent(workspace)}/read?${new URLSearchParams({ entity, id: row.id })}`);
        if (active.current === key && sequence === detailRequest.current) { setDetail(result); setBinding(false); setStock(String(result.stockTotal ?? 0)); }
      } catch (e) { if (active.current === key && sequence === detailRequest.current) setError(e.message); }
    }
    async function startBinding() {
      const key = active.current; setError(''); setNotice('');
      try { const r = await request('/catalog'); if (active.current !== key) return; setCatalog(r.items); setSourceId(''); setSkuId(''); setStock('0'); setBinding(true); setDetail(null); }
      catch (e) { if (active.current === key) setError(e.message); }
    }
    function bind(e) {
      e.preventDefault(); if (!selected || !skuId) return;
      const fingerprint = JSON.stringify([workspace, sourceId, skuId, stock]);
      const ledgerId = pending.current?.bindingFingerprint === fingerprint ? pending.current.ledgerId : crypto.randomUUID();
      const body = { action: 'link_sku', id: ledgerId, catalogProductId: sourceId, skuId, catalogRevision: selected.revision, stockTotal: Number(stock) };
      command(body); pending.current = { ...pending.current, bindingFingerprint: fingerprint, ledgerId };
    }
    const leaveEditor = () => !editorDirty || window.confirm('放弃尚未保存的修改？');
    function writeLocation(page, workspaceId = workspace, replace = false) {
      const url = new URL(window.location.href); url.searchParams.set('erp_page', page);
      if (workspaceId) url.searchParams.set('erp_workspace', workspaceId); else url.searchParams.delete('erp_workspace');
      window.history[replace ? 'replaceState' : 'pushState'](window.history.state, '', url);
    }
    function resetView() {
      setComposer(null); setMenuOpen(false); setEditor(null); setFileView(null); setEditorDirty(false); setFilter('all'); setSort('default');
      detailRequest.current++; setCursor(''); setQuery(''); setDetail(null); setBinding(false); setNotice(''); setError(''); setOrderToOpen(null);
    }
    function navigate(next, history = true) {
      if (busy || !Object.hasOwn(pages, next) || !leaveEditor()) return false;
      resetView(); setSection(next); setEntity({ orders: 'order', customers: 'buyer', inventory: 'product' }[next] || 'product');
      if (history) writeLocation(next); return true;
    }
    function changeWorkspace(id) {
      if (busy || !leaveEditor()) return; resetView(); setWorkspace(id); writeLocation(section, id);
    }
    const openEditor = productId => { if (!navigate('products')) return; setEditor({ productId }); };
    const closeEditor = () => { if (leaveEditor()) { setEditor(null); setEditorDirty(false); refresh(n => n + 1); } };
    const openFile = id => { if (!navigate('files')) return; setFileView({ id, creating: !id }); };
    const selectEntity = next => navigate({ product: 'inventory', buyer: 'customers', order: 'orders' }[next]);
    const openRecord = (page, id) => { if (navigate(page)) setOrderToOpen(id); };
    function savePreference(key, value, setter) {
      setter(value); try { window.localStorage.setItem('erp-admin:' + key, value); setNotice('显示偏好已保存'); }
      catch { setError('显示已更新，但浏览器无法保存偏好。'); }
    }
    useEffect(() => {
      const key = event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (searchOpen) setSearchOpen(false); else openSearch(); } };
      const pop = () => {
        if (busy || !leaveEditor()) { writeLocation(section, workspace, true); return; }
        const location = readLocation(); navigate(location.page, false);
        if (workspaces.some(w => w.id === location.workspace)) setWorkspace(location.workspace);
      };
      const warn = event => { if (editorDirty) { event.preventDefault(); event.returnValue = ''; } };
      window.addEventListener('keydown', key); window.addEventListener('popstate', pop); window.addEventListener('beforeunload', warn);
      return () => { window.removeEventListener('keydown', key); window.removeEventListener('popstate', pop); window.removeEventListener('beforeunload', warn); };
    }, [section, workspace, busy, editorDirty, workspaces, searchOpen]);
    useEffect(() => { const main = document.querySelector('.me-main'); if (main) main.scrollTop = 0; main?.querySelector('h1')?.focus({ preventScroll: true }); }, [section]);
    useEffect(() => {
      const root = document.querySelector('.me'), resize = () => {
        if (root?.clientWidth > 900) { setMenuOpen(false); if (document.activeElement?.classList.contains('me-drawer-close')) document.querySelector('.me-global-search')?.focus(); }
      };
      const observer = window.ResizeObserver ? new window.ResizeObserver(resize) : null;
      if (root) observer?.observe(root); window.addEventListener('resize', resize);
      return () => { observer?.disconnect(); window.removeEventListener('resize', resize); };
    }, []);
    useEffect(() => { if (menuOpen) document.querySelector('.me-nav .me-drawer-close')?.focus(); }, [menuOpen]);
    useEffect(() => {
      if (!notice) return; const timer = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer);
    }, [notice]);
    const selected = catalog.find(p => p.id === sourceId), items = data?.items ?? [];
    const matching = entity !== 'product' ? items : items.filter(row => [row.name, row.id, row.skuCode, row.contact, row.email, row.phone, row.buyerId].some(v => String(v ?? '').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
    const views = entity === 'product' ? [['all', '全部'], ['available', '可供货'], ['quote', '待询价'], ['unavailable', '来源异常']]
      : entity === 'order' ? [['all', '全部'], ['reserved', '已预留'], ['confirmed', '已确认'], ['cancelled', '已取消'], ['expired', '已到期']] : [['all', '全部']];
    const filtered = matching.filter(row => filter === 'all' || (entity === 'product'
      ? filter === 'available' ? row.available > 0 && row.catalogStatus !== 'unavailable' : filter === 'quote' ? row.quoteStatus === 'required' : row.catalogStatus === 'unavailable'
      : row.status === filter));
    if (sort !== 'default') filtered.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'zh-CN') * (sort === 'asc' ? 1 : -1));
    const recordName = row => row.name || (entity === 'order' ? shortId(row.id) : row.id);
    const title = composer ? composer.kind === 'buyer' ? composer.customer ? '编辑客户' : '添加客户' : '创建订单预留' : editor ? editor.productId ? '编辑商品' : '添加商品' : detail ? recordName(detail) : labels[entity];
    const columns = { product: ['商品 / SKU', '状态', '可分配数量', '参考单价', '起订量'], buyer: ['客户', '邮箱', '电话'], order: ['订单编号', '状态', '数量', '商品小计', '创建时间'] }[entity];
    const emptyTitle = { product: '还没有关联的库存分配', buyer: '还没有客户记录', order: '订单会从这里开始' }[entity];
    const emptyDescription = { product: '关联已有商品的 SKU，查看并维护当前可供应数量。', buyer: '添加客户名称与联系方式，为采购预留准备好客户资料。', order: '选择客户和商品，按实际报价创建预留，再跟进确认或取消。' }[entity];
    function beginComposer(kind, prefill = {}) {
      if (!leaveEditor()) return;
      setEditor(null); setEditorDirty(false); setDetail(null); setBinding(false); setNotice(''); setError('');
      const page = kind === 'buyer' ? 'customers' : 'orders'; setSection(page); writeLocation(page);
      setEntity(kind === 'buyer' ? 'buyer' : 'order'); setComposer({ kind, ...prefill });
    }
    function created(receipt) {
      setComposer(null); setDetail(receipt.current); setData(null);
      setEditorDirty(false); setNotice(receipt.entity === 'buyer' ? '客户已保存。' : `订单 ${shortId(receipt.id)} · ${states[receipt.current.status] || receipt.current.status}${receipt.replayed ? '（已核对上次提交）' : ''}`);
    }
    const detailField = (label, value) => h('div', { key: label }, h('dt', null, label), h('dd', null, value ?? '待补充'));
    function renderEmpty() {
      if (!workspaceReady || workspace && !data && !error) return h('div', { className: 'me-loading', role: 'status', 'aria-label': '正在读取记录' }, h('p', null, `正在读取${labels[entity]}…`), ...[1, 2, 3].map(i => h('div', { key: i, className: 'me-skeleton', 'aria-hidden': true })));
      if (error && !data) return h('div', { className: 'me-empty' }, h('div', { className: 'me-empty-icon' }, h(Icon, { name: 'info', size: 24 })), h('h2', null, '暂时无法读取记录'), h('p', null, '请重试，或检查当前工作区是否可用。'), button('重新读取', reload, { icon: 'refresh' }));
      if (query.trim() || filter !== 'all') return h('div', { className: 'me-empty' }, h('div', { className: 'me-empty-icon' }, h(Icon, { name: 'search', size: 24 })), h('h2', null, '本页没有匹配的记录'), h('p', null, entity === 'product' ? '试试其他名称或状态。搜索与筛选仅作用于当前页。' : '搜索覆盖当前工作区；状态筛选仅作用于当前结果页。'), button('清除筛选', () => { setQuery(''); setFilter('all'); }));
      return h('div', { className: 'me-empty' }, h(EmptyArtwork, { entity }), h('h2', null, emptyTitle), h('p', null, emptyDescription),
        entity === 'product' ? button('关联已有 SKU', startBinding, { icon: 'link', disabled: !workspace || busy }) : null);
    }
    function renderRows() {
      return filtered.map(row => {
        const firstImage = row.images?.find(i => i.isPrimary) ?? row.images?.[0];
        const first = h('td', null, h('div', { className: 'me-product-cell' }, h('div', { className: 'me-thumb' }, firstImage ? h('img', { src: imageUrl(row, firstImage), alt: '' }) : h(Icon, { name: entity, size: 21 })),
          h('div', null, button(recordName(row), () => select(row), { className: 'me-text-button me-record-button', title: row.id, 'data-record-id': row.id }),
            h('div', { className: 'me-row-sub' }, row.skuCode || (entity === 'order' ? `客户 ${row.buyerId}` : row.legacyContact || '')))));
        const cell = (content, className) => h('td', { className }, content);
        return h('tr', { key: row.id }, first,
          ...(entity === 'product' ? [cell(badge(row.catalogStatus)), cell(h('span', { className: 'me-number' }, row.available, h('small', null, ` ${row.unit || '件'}`))), cell(h('div', null, price(row), row.quoteStatus !== 'required' && row.quoteQuantity ? h('div', { className: 'me-row-sub' }, `数量 ${row.quoteQuantity} 起`) : null), 'me-number'), cell(row.moq ?? '待确认', 'me-number')]
            : entity === 'buyer' ? [cell(row.email || '—'), cell(row.phone || '—')]
              : [cell(badge(row.status)), cell(row.quantity, 'me-number'), cell(money(row.totalMinor, row.currency), 'me-number'), cell(new Date(row.createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }), 'me-number')]));
      });
    }
    function renderProductDetail() {
      return h('div', { className: 'me-detail-grid' }, h('div', null,
        h('section', { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '商品信息'), detail.catalogProductId ? button('编辑商品、图片与资料', () => openEditor(detail.catalogProductId), { className: 'me-text-button' }) : null),
          h('div', { className: 'me-card-body' }, h('p', { className: 'me-detail-description' }, detail.description || '尚未填写商品说明。'),
            h('dl', { className: 'me-definition' }, detailField('SKU 编号', detail.skuCode || detail.id), detailField('商品分类', detail.category || '未分类'), detailField('起订量', detail.moq == null ? '待确认' : `${detail.moq} ${detail.unit || '件'}`), detailField('交期', detail.leadTimeDays == null ? '待确认' : `${detail.leadTimeDays} 天`), ...(detail.specs ?? []).map(s => detailField(s.key, s.value))))),
        h('section', { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '图片与资料')),
          h('div', { className: 'me-card-body' }, h('div', { className: 'me-media' }, detail.images?.length ? detail.images.map(img => h('img', { key: img.id, src: imageUrl(detail, img), alt: img.alt || detail.name })) : h('div', { className: 'me-no-media' }, h(Icon, { name: 'product', size: 30 }), h('div', null, h('p', null, '暂无商品图片'), h('small', null, '在商品编辑页添加图片，会同步显示在这里。')))),
            h('div', { className: 'me-related' }, h(Icon, { name: 'document' }), h('span', null, '关联资料'), h('small', null, `${detail.documents?.length ?? 0} 份 · 保留原始版本`))))),
        h('div', null, h('section', { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '供应数量')),
          h('div', { className: 'me-card-body' }, h('p', { className: 'me-section-label' }, '当前可分配'), h('div', { className: 'me-stat' }, detail.available, h('small', null, detail.unit || '件')),
            h('div', { className: 'me-data-row' }, '已占用', h('b', null, detail.stockTotal - detail.available)), h('div', { className: 'me-data-row' }, '累计可供应', h('b', null, detail.stockTotal)),
            h('form', { className: 'me-stock-form', onSubmit: e => { e.preventDefault(); command({ action: 'update_stock', id: detail.id, expectedRevision: detail.revision, stockTotal: Number(stock), source: '经营者在 ERP 后台更新可供应数量' }); } },
              field('调整累计可供应数量', h('input', { type: 'number', min: 0, max: 1e9, step: 1, required: true, value: stock, disabled: busy, onChange: e => setStock(e.target.value) })),
              button(busy ? '正在保存…' : '保存数量', undefined, { type: 'submit', disabled: busy, className: 'me-button-primary' })),
            h('details', { className: 'me-help' }, h('summary', null, '这些数量如何计算？'), h('p', null, '已占用包含已确认订单和未到期预留。累计可供应数量包含这些占用，不等于仓库现存量。')))),
          h('section', { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '采购报价')),
            h('div', { className: 'me-card-body' }, h('div', { className: 'me-quote' }, price(detail)), detail.quoteQuantity ? h('small', null, `${detail.quoteStatus === 'required' ? '查询数量' : '适用数量'} ${detail.quoteQuantity} ${detail.unit || '件'}`) : null,
              detail.quoteReason ? h('p', { className: 'me-help' }, '当前数量尚无可用报价，请在商品资料中核对价格及起订量。') : null,
              detail.priceTiers?.length ? h('table', { className: 'me-tiers' }, h('thead', null, h('tr', null, h('th', null, '数量'), h('th', null, '单价'))), h('tbody', null, detail.priceTiers.map(t => h('tr', { key: t.minQuantity }, h('td', null, `${t.minQuantity}+`), h('td', null, `${t.currency} ${t.unitPrice}`))))) : null,
              h('p', { className: 'me-help' }, '新订单按实际数量取价，已生成订单的价格不受修改影响。')))));
    }
    function renderOtherDetail() {
      if (entity === 'buyer') return h('div', { className: 'me-detail-grid' },
        h('div', null, h(CustomerOrders, { key: `${workspace}:${detail.id}`, workspace, customerId: detail.id,
          onOpen: row => openRecord('orders', row.id) }),
          h('section', { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '备注')),
            h('div', { className: 'me-card-body me-terms' }, detail.note || '暂无备注。'))),
        h('section', { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '客户信息'),
          button('编辑客户', () => beginComposer('buyer', { customer: detail }), { disabled: busy, className: 'me-text-button' })),
          h('div', { className: 'me-card-body' }, h('dl', { className: 'me-definition' }, detailField('姓名', detail.name),
            detailField('邮箱', detail.email || '未填写'), detailField('电话', detail.phone || '未填写'),
            detail.legacyContact ? detailField('原联系方式', detail.legacyContact) : null))));
      return h('div', { className: 'me-detail-grid' }, h('section', { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '订单明细'), badge(detail.status)),
        h('div', { className: 'me-card-body' }, h('dl', { className: 'me-definition' }, detailField('商品编号', detail.productId), detailField('客户编号', detail.buyerId), detail.offerId ? detailField('原供货名额', detail.offerId) : null, detailField('采购数量', detail.quantity), detailField('订单单价', price(detail)), detailField('创建时间', new Date(detail.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })), detailField('预留到期', new Date(detail.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))))),
        h('section', { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '订单汇总')), h('div', { className: 'me-card-body' }, h('p', { className: 'me-section-label' }, '商品小计'), h('div', { className: 'me-quote' }, money(detail.totalMinor, detail.currency)), h('p', { className: 'me-help' }, '不含运费、税费。付款与发货尚未记录。'),
          detail.status === 'reserved' ? h('div', { className: 'me-detail-actions' }, h('div', { className: 'me-actions' }, button('确认订单', () => command({ action: 'confirm', orderId: detail.id }), { disabled: busy, className: 'me-button-primary' }), button('取消预留', () => command({ action: 'cancel', orderId: detail.id }), { disabled: busy })), h('p', { className: 'me-help' }, '确认后占用供货数量；取消预留会释放数量及名额。')) : null)));
    }
    const showResource = ['inventory', 'orders', 'customers'].includes(section) || editor || composer || detail || binding;
    const pageTitle = workspaces.find(w => w.id === workspace)?.title || '';
    const savedFile = id => { setFileView({ id, creating: false }); setEditorDirty(false); setNotice('文件已保存'); };
    const closeFile = () => { if (busy) return; if (leaveEditor()) { setFileView(null); setEditorDirty(false); refresh(n => n + 1); } };
    const extra = section === 'home' ? h(HomePage, { key: workspace + nonce, workspace, title: pageTitle, navigate, onCreateProduct: () => openEditor(null) })
      : section === 'products' ? h(CatalogIndex, { key: 'products' + nonce, kind: 'products', onCreate: () => openEditor(null), onOpen: openEditor, onInventory: () => navigate('inventory') })
      : section === 'files' ? fileView ? h(React.Fragment, null, h(PageHeading, { title: fileView.creating ? '上传文件' : '文件详情', crumb: '内容 / 文件', onBack: closeFile }), h(FileSurface, { key: fileView.id || 'new', documentId: fileView.id, creating: fileView.creating, onClose: closeFile, onSaved: savedFile, onDirtyChange: setEditorDirty, onBusy: setBusy }))
        : h(CatalogIndex, { key: 'files' + nonce, kind: 'files', onCreate: () => openFile(null), onOpen: openFile })
      : section === 'content' ? h(ContentPage, { navigate })
      : section === 'settings' || settingsPages.includes(section) ? h(SettingsPage, { key: section, page: section, navigate, appearance, density,
          setAppearance: value => savePreference('appearance', value, changeAppearance), setDensity: value => savePreference('density', value, changeDensity), onDirtyChange: setEditorDirty, onBusy: setBusy, onSaved: () => setNotice('店铺资料已保存') })
      : h(ConnectionPage, { page: section, navigate });
    const content = h('main', { id: 'me-content', inert: menuOpen ? '' : undefined, className: `me-main${editor ? ' me-main-editor' : ''}` },
        showResource ? h('div', { className: 'me-heading' }, h('div', { className: 'me-heading-title' }, detail || editor || composer ? button(null, () => { if (composer) { if (leaveEditor()) { setComposer(null); setEditorDirty(false); refresh(n => n + 1); } } else if (editor) closeEditor(); else { detailRequest.current++; setDetail(null); refresh(n => n + 1); } }, { className: 'me-icon-button me-back', icon: 'back', 'aria-label': '返回列表', disabled: busy }) : null,
          h('div', null, h('h1', { tabIndex: -1 }, title), composer ? h('p', null, composer.kind === 'buyer' ? '记录真实客户信息。' : '按实际数量核对报价与供货条件。') : editor ? h('p', null, '商品内容与资料统一保存到产品库。') : detail ? h('p', { className: 'me-reference' }, detail.id) : h('p', null, descriptions[entity]))),
          editor || composer ? null : detail ? entity === 'product' ? h('div', { className: 'me-actions' }, badge(detail.catalogStatus), button('创建订单', () => beginComposer('order', { initialProductId: detail.id }), { disabled: busy || detail.catalogStatus === 'unavailable', className: 'me-button-primary' })) : entity === 'buyer' ? button('创建订单', () => beginComposer('order', { initialBuyerId: detail.id }), { disabled: busy, className: 'me-button-primary' }) : null : entity === 'product' ? h('div', { className: 'me-actions' },
            button('关联已有 SKU', startBinding, { disabled: !workspace || busy, icon: 'link', title: workspace ? '关联产品库中的 SKU' : '请先在左侧 Workspaces 添加工作区' }),
            button('创建商品', () => openEditor(null), { disabled: busy, icon: 'plus', className: 'me-button-primary' })) : ['buyer', 'order'].includes(entity) ? button(entity === 'buyer' ? '添加客户' : '创建订单', () => beginComposer(entity), { disabled: !workspace || busy, icon: 'plus', className: 'me-button-primary' }) : null) : null,
        error ? h('div', { role: 'alert', className: 'me-alert me-alert-error' }, h(Icon, { name: 'info' }), h('p', null, error)) : null,

        showResource && !editor && !workspace && workspaceReady && !error ? h('div', { className: 'me-alert' }, h(Icon, { name: 'folder' }), h('div', null, h('strong', null, '选择工作区，开始管理供货'), h('p', null, '在左侧 Workspaces 添加文件夹，然后刷新列表。你也可以先创建商品，准备好产品资料。'))) : null,
        section === 'inventory' && !editor && !composer ? h('div', { className: 'me-alert' }, h(Icon, { name: 'info', size: 17 }), h('div', null, h('strong', null, '库存服务部分接入'), h('p', null, '当前显示可供应分配，包含已确认订单占用；尚无地点现存量、收货与出库流水。'))) : null,
        !editor && binding ? h('form', { className: 'me-card me-binding', onSubmit: bind }, h('div', { className: 'me-card-header' }, h('div', null, h('h2', null, '关联产品库 SKU'), h('p', null, '沿用已有商品资料，为当前工作区分配可供应数量。')),
          button(null, () => setBinding(false), { disabled: busy, icon: 'close', className: 'me-icon-button me-button-plain', 'aria-label': '关闭关联表单' })),
          h('div', { className: 'me-card-body' }, !catalog.length ? h('p', null, '产品库中还没有可关联的商品。请先创建商品和 SKU。') : null,
            h('div', { className: 'me-form-grid' }, field('选择产品', h('select', { required: true, value: sourceId, disabled: busy, onChange: e => { setSourceId(e.target.value); setSkuId(''); } }, h('option', { value: '' }, '选择产品'), catalog.map(p => h('option', { key: p.id, value: p.id }, p.name)))),
              field('选择 SKU', h('select', { required: true, value: skuId, disabled: busy || !sourceId, onChange: e => setSkuId(e.target.value) }, h('option', { value: '' }, '选择 SKU'), (selected?.skus ?? []).map(s => h('option', { key: s.id, value: s.id }, s.code || s.id)))),
              field('累计可供应数量', h('input', { type: 'number', min: 0, max: 1e9, step: 1, required: true, value: stock, disabled: busy, onChange: e => setStock(e.target.value) }), '仅填写已确认的供应数量。')),
            h('div', { className: 'me-form-footer' }, button('取消', () => setBinding(false), { disabled: busy }), button(busy ? '正在保存…' : '确认关联', undefined, { type: 'submit', disabled: busy || !skuId, className: 'me-button-primary' })))) : null,
        showResource ? (composer ? h(composer.kind === 'buyer' ? CustomerComposer : OrderComposer, { key: `${workspace}:${composer.kind}:${composer.customer?.id || 'new'}`, workspace, ...composer, onSaved: created, onClose: () => { if (leaveEditor()) { setComposer(null); setEditorDirty(false); refresh(n => n + 1); } }, onBusy: setBusy, onDirtyChange: setEditorDirty }) : editor ? h(ProductEditorSurface, { key: editor.productId || 'new', productId: editor.productId, onClose: closeEditor, onDirtyChange: setEditorDirty, onBusy: setBusy, onSaved: () => { setEditor(null); setEditorDirty(false); refresh(n => n + 1); setNotice('商品已保存'); } }) : detail ? entity === 'product' ? renderProductDetail() : renderOtherDetail() : h('section', { className: 'me-card' },
          h('div', { className: 'me-list-toolbar' }, h('div', { className: 'me-views', 'aria-label': '筛选本页状态' }, views.map(([key, label]) => button(label, () => setFilter(key), { key, 'aria-pressed': filter === key }))), h('div', { className: 'me-list-controls' },
            h('label', { className: 'me-search' }, h(Icon, { name: 'search', size: 15 }), h('input', { type: 'search', 'aria-label': '搜索记录', placeholder: entity === 'product' ? '筛选本页 SKU' : `搜索所有${labels[entity]}`, value: query, onChange: e => { setQuery(e.target.value); setCursor(''); } }), query ? button(null, e => { setQuery(''); setCursor(''); e.currentTarget.closest('label').querySelector('input').focus(); }, { icon: 'close', className: 'me-button-plain me-search-clear', 'aria-label': '清除列表搜索' }) : null),
            h('select', { className: 'me-sort', 'aria-label': '本页排序', value: sort, onChange: e => setSort(e.target.value) }, h('option', { value: 'default' }, '默认排序'), h('option', { value: 'asc' }, '名称 A–Z'), h('option', { value: 'desc' }, '名称 Z–A')),
            button(null, reload, { icon: 'refresh', disabled: busy, className: 'me-icon-button', 'aria-label': '刷新列表', title: '刷新列表' }))),
          h('div', { className: 'me-table-wrap' }, h('table', null, h('thead', null, h('tr', null, columns.map(c => h('th', { key: c, scope: 'col' }, c)))), h('tbody', null,
            filtered.length ? renderRows() : h('tr', { className: 'me-empty-row' }, h('td', { className: 'me-empty-cell', colSpan: columns.length }, renderEmpty()))))),
          h('div', { className: 'me-list-footer' }, h('span', null, data ? `本页 ${items.length} 条${query ? ` · 匹配 ${filtered.length} 条` : ''}${data.asOf ? ` · 读取于 ${clock(data.asOf)}` : ''}` : '商品资料与交易记录保持关联'),
            h('div', { className: 'me-actions' }, cursor ? button('返回首页', () => { setCursor(''); setQuery(''); }, { disabled: busy }) : null, data?.hasMore ? button('下一页', () => { setCursor(data.nextCursor); }, { disabled: busy, icon: 'arrow' }) : null)))) : extra,
        !composer && !editor && section === 'inventory' ? h('p', { className: 'me-page-note' }, h(Icon, { name: 'link', size: 13 }), '商品、图片与资料在产品库统一维护，订单保留成交时的价格。') : null);
    const navItem = (id, children = []) => {
      const current = section === id || children.includes(section), open = expanded[id] ?? current;
      return h('div', { className: 'me-nav-group', key: id }, h('div', { className: 'me-nav-row', 'data-current': current },
        button(pages[id][0], () => navigate(id), { icon: pages[id][1], disabled: busy, 'aria-current': section === id ? 'page' : undefined, 'data-admin-page': id }),
        children.length ? button(null, () => setExpanded(value => ({ ...value, [id]: !open })), { icon: 'down', className: 'me-nav-expand', 'aria-label': `${open ? '折叠' : '展开'}${pages[id][0]}`, 'aria-expanded': open, 'aria-controls': `me-nav-${id}`, disabled: busy }) : null),
        children.length && open ? h('div', { id: `me-nav-${id}`, className: 'me-nav-children' }, children.map(child => button(pages[child][0], () => navigate(child), { key: child, disabled: busy, 'aria-current': section === child ? 'page' : undefined, 'data-admin-page': child }))) : null);
    };
    return h('div', { className: 'me', 'data-appearance': appearance, 'data-density': density, onKeyDown: e => { if (e.key === 'Escape' && menuOpen) { e.stopPropagation(); closeMenu(); } } }, h('style', null, css),
      h('header', { className: 'me-topbar', inert: searchOpen ? '' : undefined },
        h('div', { className: 'me-brand' }, button(null, () => setMenuOpen(v => !v), { className: 'me-icon-button me-mobile-menu', icon: 'menu', 'aria-label': '经营菜单', 'aria-expanded': menuOpen, 'aria-controls': 'me-business-nav' }), h('span', { className: 'me-brand-mark' }, h(Icon, { name: 'store', size: 18 })), h('span', { className: 'me-brand-name' }, 'Workspace'), h('small', null, 'ADMIN')),
        h('button', { className: 'me-global-search', onClick: openSearch, disabled: busy, 'aria-label': '搜索后台', 'aria-haspopup': 'dialog' }, h(Icon, { name: 'search', size: 16 }), h('span', null, '搜索'), h('kbd', null, /Mac|iPhone|iPad/.test(window.navigator.platform) ? '⌘ K' : 'Ctrl K')),
        h('div', { className: 'me-topbar-actions' }, toggleHostSidebar ? button(null, toggleHostSidebar, { className: 'me-icon-button me-host-toggle', icon: 'back', 'aria-label': '折叠或展开 DSH 导航' }) : null,
          button(null, () => navigate('connections'), { className: 'me-icon-button me-help-toggle', icon: 'info', 'aria-label': '查看接入状态', disabled: busy }),
          h('label', { className: 'me-workspace' }, h('span', { className: 'me-store-avatar', 'aria-hidden': true }, (pageTitle || 'W').slice(0, 1).toUpperCase()), h('select', { 'aria-label': '经营工作区', value: workspace, disabled: busy || !workspaces.length, onChange: e => changeWorkspace(e.target.value) },
            !workspaces.length ? h('option', { value: '' }, workspaceReady ? '未选择工作区' : '正在读取…') : workspaces.map(w => h('option', { key: w.id, value: w.id }, w.title || w.id)))))),
      h('div', { className: `me-shell${menuOpen ? ' me-menu-open' : ''}`, inert: searchOpen ? '' : undefined },
        menuOpen ? h('button', { className: 'me-nav-scrim', 'aria-label': '关闭经营菜单', onClick: closeMenu, tabIndex: -1 }) : null,
        h('nav', { id: 'me-business-nav', className: 'me-nav', 'aria-label': 'ERP 导航', onKeyDown: e => {
          if (e.key === 'Tab' && menuOpen) { const nodes = [...e.currentTarget.querySelectorAll('button:not(:disabled)')].filter(node => node.getClientRects().length); const first = nodes[0], last = nodes.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
        } },
          button('关闭菜单', closeMenu, { icon: 'close', className: 'me-drawer-close' }),
          ...navGroups.map(([id, children]) => navItem(id, children)),
          h('div', { className: 'me-nav-divider' }, '销售渠道'), navItem('online_store', ['themes', 'store_pages', 'preferences']),
          h('div', { className: 'me-nav-divider' }, '应用'), navItem('apps'),
          h('div', { className: 'me-nav-bottom' }, button('设置', () => navigate('settings'), { icon: 'settings', disabled: busy, 'data-admin-page': 'settings', 'aria-current': section === 'settings' || settingsPages.includes(section) ? 'page' : undefined }))), content),
      notice ? h('div', { role: 'status', className: 'me-toast' }, h(Icon, { name: 'check', size: 17 }), h('span', null, notice), button(null, () => setNotice(''), { icon: 'close', className: 'me-icon-button', 'aria-label': '关闭保存提示' })) : null,
      searchOpen ? h(SearchDialog, { workspace, returnFocus: searchReturnFocus.current, onClose: () => setSearchOpen(false), onNavigate: navigate, onProduct: openEditor, onFile: openFile, onCustomer: id => openRecord('customers', id), onOrder: id => openRecord('orders', id) }) : null);

  }
  function apply(ctx) {
    ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: NS, order: 25, label: () => 'ERP' }, () => h(Icon, { name: 'product' }))), 'mini-erp: sidebar');
    ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: NS }, () => h(Panel, { toggleHostSidebar: () => ctx.get('layout').toggleSidebar() }))), 'mini-erp: panel');
  }
  return { apply, inject: ['slots'], Panel, pages, csvFile };
} });
