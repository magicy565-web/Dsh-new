window.__ModuleLoader__.load({ id: 'dsh-mini-erp', factory(require) {
  const React = require('react'), { useState, useEffect, useRef } = React, h = React.createElement;
  const { ProductEditorSurface } = require('dsh-workspace-library');
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
  const labels = { order: '订单', product: '商品', buyer: '客户' };
  const descriptions = {
    product: '管理商品报价、采购条件与可供应数量。', buyer: '查看客户资料，保持每一笔交易的客户信息清晰。',
    order: '跟进采购预留，确认订单或释放尚未成交的数量。',
  };
  const states = { reserved: '已预留', confirmed: '已确认', cancelled: '已取消', expired: '已到期', linked: '已关联', unavailable: '来源不可用', 'legacy-unlinked': '待关联' };
  const paths = {
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
  const Icon = ({ name, size = 18 }) => h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[name] || paths.product }));
  const button = (label, onClick, options = {}) => {
    const { icon, className = '', ...props } = options;
    return h('button', { type: 'button', className: `me-button ${className}`, onClick, ...props }, icon ? h(Icon, { name: icon, size: 16 }) : null, label);
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
  function OrderComposer({ workspace, initialProductId = '', initialBuyerId = '', onSaved, onClose, onBusy }) {
    const s = useSubmission(workspace, 'reserve', onSaved, onBusy);
    const [buyerId, setBuyerId] = useState(s.initial?.buyerId || initialBuyerId), [productId, setProductId] = useState(s.initial?.productId || initialProductId);
    const [quantity, setQuantity] = useState(String(s.initial?.quantity || 1)), [holdMinutes, setHoldMinutes] = useState(String(s.initial?.holdMinutes || 60));
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
  function Panel({ openLibrary, toggleHostSidebar }) {
    const [workspaces, setWorkspaces] = useState([]), [workspace, setWorkspace] = useState(''), [workspaceReady, setWorkspaceReady] = useState(false);
    const [entity, setEntity] = useState('product'), [data, setData] = useState(null), [detail, setDetail] = useState(null);
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [nonce, refresh] = useState(0);
    const [binding, setBinding] = useState(false), [catalog, setCatalog] = useState([]), [sourceId, setSourceId] = useState(''), [skuId, setSkuId] = useState(''), [stock, setStock] = useState('0');
    const [menuOpen, setMenuOpen] = useState(false);
    const [composer, setComposer] = useState(null), [orderToOpen, setOrderToOpen] = useState(null);
    const [editor, setEditor] = useState(null), [editorDirty, setEditorDirty] = useState(false), [filter, setFilter] = useState('all'), [sort, setSort] = useState('default');
    const [cursor, setCursor] = useState(''), [notice, setNotice] = useState(''), [query, setQuery] = useState('');
    const active = useRef(''), pending = useRef(null), detailRequest = useRef(0);
    active.current = workspace + '/' + entity;
    useEffect(() => {
      const a = new AbortController();
      request('/workspaces', null, a.signal).then(r => { setWorkspaces(r.items); setWorkspace(r.items[0]?.id ?? ''); })
        .catch(e => { if (!a.signal.aborted) setError(e.message); }).finally(() => { if (!a.signal.aborted) setWorkspaceReady(true); });
      return () => a.abort();
    }, []);
    useEffect(() => {
      detailRequest.current++; setDetail(null); setBinding(false); setData(null); setBusy(false);
      if (!workspace) return;
      const a = new AbortController(), key = workspace + '/' + entity; setError('');
      request(`/workspaces/${encodeURIComponent(workspace)}/read?${new URLSearchParams({ entity, limit: '50', ...(cursor ? { afterId: cursor } : {}) })}`, null, a.signal)
        .then(r => { if (!a.signal.aborted && active.current === key) setData(r); }).catch(e => { if (!a.signal.aborted) setError(e.message); });
      return () => a.abort();
    }, [workspace, entity, cursor, nonce]);
    useEffect(() => { if (entity === 'order' && orderToOpen) { setOrderToOpen(null); select({ id: orderToOpen }); } }, [entity, orderToOpen]);
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
        if (active.current === key) { refresh(n => n + 1); setNotice('已保存'); }
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
    const openEditor = productId => { if (!leaveEditor()) return; setEditor({ productId }); setEditorDirty(false); setNotice(''); };
    const closeEditor = () => { if (leaveEditor()) { setEditor(null); setEditorDirty(false); } };
    const selectEntity = next => { if (!leaveEditor()) return; setComposer(null); setMenuOpen(false); setEditor(null); setEditorDirty(false); setFilter('all'); setSort('default'); detailRequest.current++; setEntity(next); setCursor(''); setQuery(''); setDetail(null); setBinding(false); setNotice(''); };
    const selected = catalog.find(p => p.id === sourceId), items = data?.items ?? [];
    const matching = items.filter(row => [row.name, row.id, row.skuCode, row.contact, row.email, row.phone, row.buyerId].some(v => String(v ?? '').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
    const views = entity === 'product' ? [['all', '全部'], ['available', '可供货'], ['quote', '待询价'], ['unavailable', '来源异常']]
      : entity === 'order' ? [['all', '全部'], ['reserved', '已预留'], ['confirmed', '已确认'], ['cancelled', '已取消'], ['expired', '已到期']] : [['all', '全部']];
    const filtered = matching.filter(row => filter === 'all' || (entity === 'product'
      ? filter === 'available' ? row.available > 0 && row.catalogStatus !== 'unavailable' : filter === 'quote' ? row.quoteStatus === 'required' : row.catalogStatus === 'unavailable'
      : row.status === filter));
    if (sort !== 'default') filtered.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'zh-CN') * (sort === 'asc' ? 1 : -1));
    const recordName = row => row.name || (entity === 'order' ? shortId(row.id) : row.id);
    const title = composer ? composer.kind === 'buyer' ? composer.customer ? '编辑客户' : '添加客户' : '创建订单预留' : editor ? editor.productId ? '编辑商品' : '添加商品' : detail ? recordName(detail) : labels[entity];
    const columns = { product: ['商品 / SKU', '状态', '可分配数量', '参考单价', '起订量'], buyer: ['客户', '邮箱', '电话'], order: ['订单编号', '状态', '数量', '商品小计', '创建时间'] }[entity];
    const emptyTitle = { product: '把你的商品带到这里', buyer: '还没有客户记录', order: '订单会从这里开始' }[entity];
    const emptyDescription = { product: '创建商品，或关联产品库中已有的 SKU。图片、规格和报价可以直接沿用。', buyer: '添加客户名称与联系方式，为采购预留准备好客户资料。', order: '选择客户和商品，按实际报价创建预留，再跟进确认或取消。' }[entity];
    function beginComposer(kind, prefill = {}) {
      if (!leaveEditor()) return;
      setEditor(null); setEditorDirty(false); setDetail(null); setBinding(false); setNotice(''); setError('');
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
      if (query.trim() || filter !== 'all') return h('div', { className: 'me-empty' }, h('div', { className: 'me-empty-icon' }, h(Icon, { name: 'search', size: 24 })), h('h2', null, '本页没有匹配的记录'), h('p', null, '试试其他名称或状态。筛选仅作用于当前页。'), button('清除筛选', () => { setQuery(''); setFilter('all'); }));
      return h('div', { className: 'me-empty' }, h(EmptyArtwork, { entity }), h('h2', null, emptyTitle), h('p', null, emptyDescription),
        entity === 'product' ? button('浏览产品库', () => openLibrary('products'), { icon: 'arrow' }) : null);
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
          onOpen: row => { setDetail(null); setEntity('order'); setOrderToOpen(row.id); setCursor(''); } }),
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
    return h('div', { className: 'me', onKeyDown: e => { if (e.key === 'Escape') setMenuOpen(false); } }, h('style', null, css),
      h('header', { className: 'me-topbar' }, h('div', { className: 'me-brand' }, button(null, () => setMenuOpen(v => !v), { className: 'me-icon-button me-mobile-menu', icon: 'menu', 'aria-label': '经营菜单', 'aria-expanded': menuOpen, 'aria-controls': 'me-business-nav' }), h('span', { className: 'me-brand-mark' }, h(Icon, { name: 'product', size: 17 })), '经营后台', h('small', null, 'ERP')),
        h('div', { className: 'me-topbar-actions' }, toggleHostSidebar ? button(null, toggleHostSidebar, { className: 'me-icon-button me-host-toggle', icon: 'back', 'aria-label': '折叠或展开 DSH 导航', title: '折叠或展开 DSH 导航' }) : null, h('label', { className: 'me-workspace' }, h(Icon, { name: 'folder', size: 16 }), h('select', { 'aria-label': '经营工作区', value: workspace, disabled: busy || !workspaces.length, onChange: e => { if (!leaveEditor()) return; setEditor(null); setEditorDirty(false); setComposer(null); setWorkspace(e.target.value); setCursor(''); setQuery(''); setNotice(''); } },
          !workspaces.length ? h('option', { value: '' }, workspaceReady ? '未选择工作区' : '正在读取…') : workspaces.map(w => h('option', { key: w.id, value: w.id }, w.title || w.id)))))),
      h('div', { className: `me-shell${menuOpen ? ' me-menu-open' : ''}` }, h('nav', { id: 'me-business-nav', className: 'me-nav', 'aria-label': 'ERP 导航' }, h('span', { className: 'me-nav-label' }, '经营管理'), Object.entries(labels).map(([key, label]) => button(label, () => selectEntity(key), { key, disabled: busy, 'aria-current': entity === key ? 'page' : undefined, icon: key })),
        button('文件', () => { if (leaveEditor()) openLibrary('documents'); }, { className: 'me-nav-library', icon: 'document' })),
      h('main', { className: `me-main${editor ? ' me-main-editor' : ''}` },
        h('div', { className: 'me-heading' }, h('div', { className: 'me-heading-title' }, detail || editor || composer ? button(null, () => { if (composer) { if (leaveEditor()) { setComposer(null); setEditorDirty(false); refresh(n => n + 1); } } else if (editor) closeEditor(); else { detailRequest.current++; setDetail(null); refresh(n => n + 1); } }, { className: 'me-icon-button me-back', icon: 'back', 'aria-label': '返回列表', disabled: busy }) : null,
          h('div', null, h('h1', null, title), composer ? h('p', null, composer.kind === 'buyer' ? '记录真实客户信息。' : '按实际数量核对报价与供货条件。') : editor ? h('p', null, '商品内容与资料统一保存到产品库。') : detail ? h('p', { className: 'me-reference' }, detail.id) : h('p', null, descriptions[entity]))),
          editor || composer ? null : detail ? entity === 'product' ? h('div', { className: 'me-actions' }, badge(detail.catalogStatus), button('创建订单', () => beginComposer('order', { initialProductId: detail.id }), { disabled: busy || detail.catalogStatus === 'unavailable', className: 'me-button-primary' })) : entity === 'buyer' ? button('创建订单', () => beginComposer('order', { initialBuyerId: detail.id }), { disabled: busy, className: 'me-button-primary' }) : null : entity === 'product' ? h('div', { className: 'me-actions' },
            button('关联已有 SKU', startBinding, { disabled: !workspace || busy, icon: 'link', title: workspace ? '关联产品库中的 SKU' : '请先在左侧 Workspaces 添加工作区' }),
            button('创建商品', () => openEditor(null), { disabled: busy, icon: 'plus', className: 'me-button-primary' })) : ['buyer', 'order'].includes(entity) ? button(entity === 'buyer' ? '添加客户' : '创建订单', () => beginComposer(entity), { disabled: !workspace || busy, icon: 'plus', className: 'me-button-primary' }) : null),
        error ? h('div', { role: 'alert', className: 'me-alert me-alert-error' }, h(Icon, { name: 'info' }), h('p', null, error)) : null,
        notice ? h('div', { role: 'status', className: 'me-alert me-alert-success' }, h(Icon, { name: 'check' }), notice, button(null, () => setNotice(''), { className: 'me-icon-button me-button-plain', icon: 'close', 'aria-label': '关闭保存提示' })) : null,
        !editor && !workspace && workspaceReady && !error ? h('div', { className: 'me-alert' }, h(Icon, { name: 'folder' }), h('div', null, h('strong', null, '选择工作区，开始管理供货'), h('p', null, '在左侧 Workspaces 添加文件夹，然后刷新列表。你也可以先创建商品，准备好产品资料。'))) : null,
        !editor && binding ? h('form', { className: 'me-card me-binding', onSubmit: bind }, h('div', { className: 'me-card-header' }, h('div', null, h('h2', null, '关联产品库 SKU'), h('p', null, '沿用已有商品资料，为当前工作区分配可供应数量。')),
          button(null, () => setBinding(false), { disabled: busy, icon: 'close', className: 'me-icon-button me-button-plain', 'aria-label': '关闭关联表单' })),
          h('div', { className: 'me-card-body' }, !catalog.length ? h('p', null, '产品库中还没有可关联的商品。请先创建商品和 SKU。') : null,
            h('div', { className: 'me-form-grid' }, field('选择产品', h('select', { required: true, value: sourceId, disabled: busy, onChange: e => { setSourceId(e.target.value); setSkuId(''); } }, h('option', { value: '' }, '选择产品'), catalog.map(p => h('option', { key: p.id, value: p.id }, p.name)))),
              field('选择 SKU', h('select', { required: true, value: skuId, disabled: busy || !sourceId, onChange: e => setSkuId(e.target.value) }, h('option', { value: '' }, '选择 SKU'), (selected?.skus ?? []).map(s => h('option', { key: s.id, value: s.id }, s.code || s.id)))),
              field('累计可供应数量', h('input', { type: 'number', min: 0, max: 1e9, step: 1, required: true, value: stock, disabled: busy, onChange: e => setStock(e.target.value) }), '仅填写已确认的供应数量。')),
            h('div', { className: 'me-form-footer' }, button('取消', () => setBinding(false), { disabled: busy }), button(busy ? '正在保存…' : '确认关联', undefined, { type: 'submit', disabled: busy || !skuId, className: 'me-button-primary' })))) : null,
        composer ? h(composer.kind === 'buyer' ? CustomerComposer : OrderComposer, { key: `${workspace}:${composer.kind}:${composer.customer?.id || 'new'}`, workspace, ...composer, onSaved: created, onClose: () => { if (leaveEditor()) { setComposer(null); setEditorDirty(false); refresh(n => n + 1); } }, onBusy: setBusy, onDirtyChange: setEditorDirty }) : editor ? h(ProductEditorSurface, { key: editor.productId || 'new', productId: editor.productId, onClose: closeEditor, onDirtyChange: setEditorDirty, onSaved: () => { setEditor(null); setEditorDirty(false); refresh(n => n + 1); setNotice('商品已保存到产品库。新商品可通过「关联已有 SKU」分配供货数量。'); } }) : detail ? entity === 'product' ? renderProductDetail() : renderOtherDetail() : h('section', { className: 'me-card' },
          h('div', { className: 'me-list-toolbar' }, h('div', { className: 'me-views', 'aria-label': '筛选本页状态' }, views.map(([key, label]) => button(label, () => setFilter(key), { key, 'aria-pressed': filter === key }))), h('div', { className: 'me-list-controls' },
            h('label', { className: 'me-search' }, h(Icon, { name: 'search', size: 15 }), h('input', { type: 'search', 'aria-label': '筛选本页记录', placeholder: `筛选本页${labels[entity]}`, value: query, disabled: !data || !items.length, onChange: e => setQuery(e.target.value) })),
            h('select', { className: 'me-sort', 'aria-label': '本页排序', value: sort, onChange: e => setSort(e.target.value) }, h('option', { value: 'default' }, '默认排序'), h('option', { value: 'asc' }, '名称 A–Z'), h('option', { value: 'desc' }, '名称 Z–A')),
            button(null, reload, { icon: 'refresh', disabled: busy, className: 'me-icon-button', 'aria-label': '刷新列表', title: '刷新列表' }))),
          h('div', { className: 'me-table-wrap' }, h('table', null, h('thead', null, h('tr', null, columns.map(c => h('th', { key: c, scope: 'col' }, c)))), h('tbody', null,
            filtered.length ? renderRows() : h('tr', { className: 'me-empty-row' }, h('td', { className: 'me-empty-cell', colSpan: columns.length }, renderEmpty()))))),
          h('div', { className: 'me-list-footer' }, h('span', null, data ? `本页 ${items.length} 条${query ? ` · 匹配 ${filtered.length} 条` : ''}${data.asOf ? ` · 读取于 ${clock(data.asOf)}` : ''}` : '商品资料与交易记录保持关联'),
            h('div', { className: 'me-actions' }, cursor ? button('返回首页', () => { setCursor(''); setQuery(''); }, { disabled: busy }) : null, data?.hasMore ? button('下一页', () => { setCursor(data.nextCursor); setQuery(''); }, { disabled: busy, icon: 'arrow' }) : null))),
        !composer && !editor && entity === 'product' ? h('p', { className: 'me-page-note' }, h(Icon, { name: 'link', size: 13 }), '商品、图片与资料在产品库统一维护，订单保留成交时的价格。') : null)));
  }
  function apply(ctx) {
    const openLibrary = (page, id) => {
      const target = { page, id }; sessionStorage.setItem('workspace-library-navigation', JSON.stringify(target));
      ctx.get('layout').selectPanel('workspace-library');
      window.dispatchEvent(new CustomEvent('workspace-library:navigate', { detail: target }));
    };
    ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: NS, order: 25, label: () => 'ERP' }, () => h(Icon, { name: 'product' }))), 'mini-erp: sidebar');
    ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: NS }, () => h(Panel, { openLibrary, toggleHostSidebar: () => ctx.get('layout').toggleSidebar() }))), 'mini-erp: panel');
  }
  return { apply, inject: ['slots'], Panel };
} });
