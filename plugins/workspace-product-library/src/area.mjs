// Self-contained product library page. Strict CSP, no external assets.
export const PRODUCTS_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>产品库 · 工作台</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in oklab, CanvasText 16%, transparent); --muted: color-mix(in oklab, CanvasText 55%, transparent); --accent: #2563eb; --warn: #b45309; --ok: #16a34a; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.6 ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; background: Canvas; color: CanvasText; }
  header { display: flex; gap: 14px; align-items: baseline; padding: 14px 20px; border-bottom: 1px solid var(--line); }
  header h1 { font-size: 16px; margin: 0; }
  header a { color: var(--muted); text-decoration: none; font-size: 13px; }
  header a:hover { color: var(--accent); }
  main { display: grid; gap: 16px; padding: 18px 20px; grid-template-columns: minmax(300px, 1.1fr) 1fr; align-items: start; }
  @media (max-width: 820px) { main { grid-template-columns: 1fr; } }
  section { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
  h2 { font-size: 13px; margin: 0 0 10px; color: var(--muted); letter-spacing: .03em; }
  .banner { border: 1px solid color-mix(in oklab, var(--warn) 45%, var(--line)); background: color-mix(in oklab, var(--warn) 8%, transparent); border-radius: 12px; padding: 12px 14px; margin-bottom: 14px; font-size: 13px; grid-column: 1 / -1; }
  .banner code { font-size: 12px; }
  .banner.ok { border-color: color-mix(in oklab, var(--ok) 45%, var(--line)); background: color-mix(in oklab, var(--ok) 7%, transparent); }
  .search { display: flex; gap: 8px; margin-bottom: 12px; }
  input { flex: 1; font: inherit; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line); background: Field; color: FieldText; }
  button { font: inherit; font-size: 12px; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
  button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .row { display: flex; gap: 10px; align-items: baseline; padding: 9px 8px; border-radius: 8px; cursor: pointer; border-bottom: 1px dashed var(--line); }
  .row:hover { background: color-mix(in oklab, var(--accent) 8%, transparent); }
  .row .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .id { font-size: 11px; color: var(--muted); }
  .tag { font-size: 11px; border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; color: var(--muted); }
  .tag.ok { color: var(--ok); border-color: var(--ok); }
  .muted { color: var(--muted); font-size: 12px; }
  dl { display: grid; grid-template-columns: 120px 1fr; gap: 6px 12px; margin: 0; font-size: 13px; }
  dt { color: var(--muted); }
  dd { margin: 0; overflow-wrap: anywhere; }
  #msg { min-height: 18px; font-size: 12px; color: var(--muted); }
</style></head>
<body>
<header>
  <h1>产品库</h1>
  <a href="/home">首页</a>
  <a href="/chat">对话</a>
  <a href="/inbox">收件箱</a>
  <a href="/ops">运维</a>
</header>
<main>
  <div class="banner" id="banner" hidden></div>
  <section>
    <h2>产品</h2>
    <div class="search">
      <input id="q" placeholder="按标题搜索（留空列出全部）" maxlength="200">
      <button id="go">搜索</button>
    </div>
    <div id="list"></div>
    <div id="msg"></div>
  </section>
  <section>
    <h2>详情</h2>
    <div id="detail"><p class="muted">选择一个产品查看已审核的 Product Context</p></div>
  </section>
</main>
<script>
(function () {
  function el(tag, cls, text) { var node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; }
  function api(path, options) {
    return fetch(path, Object.assign({ cache: 'no-store' }, options || {})).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) {
          var error = new Error(body && body.error ? body.error.code : 'HTTP_' + response.status);
          error.status = response.status;
          error.code = body && body.error ? body.error.code : null;
          error.detail = body && body.error ? body.error.message : null;
          throw error;
        }
        return body;
      });
    });
  }
  var state = { configured: false };
  var banner = document.getElementById('banner');
  var list = document.getElementById('list');
  var detail = document.getElementById('detail');
  var msg = document.getElementById('msg');
  var button = document.getElementById('go');
  function note(text, bad) { msg.textContent = text || ''; msg.style.color = bad ? 'var(--warn)' : 'var(--muted)'; }

  function renderBanner() {
    banner.hidden = false;
    banner.textContent = '';
    if (state.configured) {
      banner.className = 'banner ok';
      banner.appendChild(el('strong', '', '已连接已审核的产品源。'));
      banner.appendChild(el('span', '', ' 这里的每个产品都带有 approved 的 Product Context。'));
      button.disabled = false;
      return;
    }
    banner.className = 'banner';
    banner.appendChild(el('strong', '', '产品源未配置。'));
    banner.appendChild(el('span', '', ' 在 harness.local.yml 的 product-library 行配置 source：kind=medusa-approved-context、baseURL、readTokenFile（绝对路径）。'));
    button.disabled = true;
  }

  function renderList(items) {
    list.textContent = '';
    if (!items.length) { list.appendChild(el('p', 'muted', '没有产品')); return; }
    items.forEach(function (row) {
      var product = row.product || {};
      var context = row.context || {};
      var line = el('div', 'row');
      line.appendChild(el('span', 'title', product.title || product.id));
      line.appendChild(el('span', 'id', String(product.id || '').slice(0, 8)));
      line.appendChild(el('span', 'tag ok', 'rev ' + (context.review_version || '?')));
      line.addEventListener('click', function () { loadDetail(product.id); });
      list.appendChild(line);
    });
  }

  function renderDetail(data) {
    var product = data.product || {};
    var context = data.context || {};
    detail.textContent = '';
    detail.appendChild(el('h2', '', product.title || product.id));
    var dl = el('dl');
    function pair(key, value) { if (value === undefined || value === null || value === '') return; dl.appendChild(el('dt', '', key)); dl.appendChild(el('dd', '', String(value))); }
    pair('产品 ID', product.id);
    pair('Handle', product.handle);
    pair('状态', product.status);
    pair('描述', product.description);
    pair('Context 状态', context.status);
    pair('审核版本', context.review_version);
    pair('来源哈希', context.source_hash ? String(context.source_hash).slice(0, 16) + '…' : null);
    detail.appendChild(dl);
  }

  function loadDetail(id) {
    if (!id) return;
    api('/api/product-library/products/' + encodeURIComponent(id)).then(function (data) {
      if (!data) { detail.textContent = ''; detail.appendChild(el('p', 'muted', '该产品不存在或未通过审核')); return; }
      renderDetail(data);
    }).catch(function (error) {
      detail.textContent = '';
      detail.appendChild(el('p', 'muted', describe(error)));
    });
  }

  function describe(error) {
    if (error.code === 'PRODUCT_LIBRARY_SOURCE_UNCONFIGURED') return '产品源未配置，无法读取产品。';
    return '加载失败：' + (error.detail || error.message);
  }

  function load() {
    note('');
    return api('/api/product-library/products?limit=100').then(function (data) {
      renderList(data.items || []);
    }).catch(function (error) {
      list.textContent = '';
      if (error.status === 401) { location.assign('/login'); return; }
      note(describe(error), true);
    });
  }

  button.addEventListener('click', function () {
    var q = document.getElementById('q').value.trim();
    note('');
    api('/api/product-library/products' + (q ? '?q=' + encodeURIComponent(q) : '')).then(function (data) {
      renderList(data.items || []);
    }).catch(function (error) { note(describe(error), true); });
  });
  document.getElementById('q').addEventListener('keydown', function (event) { if (event.key === 'Enter') button.click(); });

  api('/api/product-library/status').then(function (data) {
    state.configured = Boolean(data && data.configured);
    renderBanner();
    if (state.configured) return load();
    note('配置后即可搜索产品。');
    return null;
  }).catch(function (error) {
    state.configured = false;
    renderBanner();
    note(describe(error), true);
  });
}());
</script>
</body></html>`;
