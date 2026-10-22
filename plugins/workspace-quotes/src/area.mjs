// Self-contained quotes page. Strict CSP, no external assets.
export const QUOTE_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>报价单 · 工作台</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in oklab, CanvasText 16%, transparent); --muted: color-mix(in oklab, CanvasText 55%, transparent); --accent: #2563eb; --ok: #16a34a; --warn: #b45309; --bad: #b91c1c; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.6 ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; background: Canvas; color: CanvasText; }
  header { display: flex; gap: 14px; align-items: baseline; padding: 14px 20px; border-bottom: 1px solid var(--line); }
  header h1 { font-size: 16px; margin: 0; }
  header a { color: var(--muted); text-decoration: none; font-size: 13px; }
  header a:hover { color: var(--accent); }
  main { display: grid; gap: 16px; padding: 18px 20px; grid-template-columns: minmax(300px, 1fr) 1fr; align-items: start; }
  @media (max-width: 860px) { main { grid-template-columns: 1fr; } }
  section { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
  h2 { font-size: 13px; margin: 0 0 10px; color: var(--muted); letter-spacing: .03em; }
  .row { display: flex; gap: 10px; align-items: baseline; padding: 8px; border-radius: 8px; border-bottom: 1px dashed var(--line); cursor: pointer; }
  .row:hover { background: color-mix(in oklab, var(--accent) 8%, transparent); }
  .row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .total { font-variant-numeric: tabular-nums; }
  .tag { font-size: 11px; border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; color: var(--muted); }
  .tag.draft { color: var(--muted); }
  .tag.sent { color: var(--accent); border-color: var(--accent); }
  .tag.accepted { color: var(--ok); border-color: var(--ok); }
  .tag.rejected { color: var(--bad); border-color: var(--bad); }
  .muted { color: var(--muted); font-size: 12px; }
  form { display: grid; gap: 8px; }
  input, textarea, select, button { font: inherit; }
  input, textarea, select { padding: 7px 9px; border-radius: 8px; border: 1px solid var(--line); background: Field; color: FieldText; }
  textarea { min-height: 54px; resize: vertical; }
  button { padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
  button:hover { border-color: var(--accent); color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .line { display: grid; grid-template-columns: 1fr 80px 100px 32px; gap: 6px; }
  .line button { padding: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td, th { text-align: left; padding: 5px 0; border-bottom: 1px dashed var(--line); }
  th { color: var(--muted); font-weight: 400; font-size: 12px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  #msg { min-height: 18px; font-size: 12px; color: var(--muted); }
</style></head>
<body>
<header>
  <h1>报价单</h1>
  <a href="/home">首页</a>
  <a href="/chat">对话</a>
  <a href="/products">产品库</a>
  <a href="/ops">运维</a>
</header>
<main>
  <section>
    <h2>全部报价</h2>
    <div id="list"></div>
    <h2 style="margin-top:14px">新建报价</h2>
    <form id="create">
      <input id="customer" placeholder="客户名称" maxlength="200" required>
      <input id="currency" placeholder="币种（如 CNY）" value="CNY" maxlength="3" required>
      <div id="lines"></div>
      <button type="button" id="add-line">+ 增加一行</button>
      <textarea id="note" placeholder="备注（可选）" maxlength="2000"></textarea>
      <button class="primary" type="submit">创建草稿</button>
    </form>
    <div id="msg"></div>
  </section>
  <section>
    <div id="detail"><p class="muted">选择一张报价查看详情</p></div>
  </section>
</main>
<script>
(function () {
  function el(tag, cls, text) { var node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; }
  function api(path, options) {
    return fetch(path, Object.assign({ cache: 'no-store' }, options || {})).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) { var error = new Error(body && body.error ? body.error.code : 'HTTP_' + response.status); error.status = response.status; throw error; }
        return body;
      });
    });
  }
  var state = { quotes: [], selected: null };
  var list = document.getElementById('list');
  var detail = document.getElementById('detail');
  var msg = document.getElementById('msg');
  function note(text, bad) { msg.textContent = text || ''; msg.style.color = bad ? 'var(--warn)' : 'var(--muted)'; }

  function lineRow() {
    var row = el('div', 'line');
    var description = el('input'); description.placeholder = '描述'; description.maxLength = 300;
    var quantity = el('input'); quantity.type = 'number'; quantity.min = '1'; quantity.value = '1';
    var price = el('input'); price.type = 'number'; price.min = '0'; price.step = '0.01'; price.placeholder = '单价';
    var remove = el('button', '', '×'); remove.type = 'button';
    remove.addEventListener('click', function () { if (row.parentNode) row.parentNode.removeChild(row); });
    row.appendChild(description); row.appendChild(quantity); row.appendChild(price); row.appendChild(remove);
    return row;
  }
  function addLine() { document.getElementById('lines').appendChild(lineRow()); }
  addLine();

  function renderList() {
    list.textContent = '';
    if (!state.quotes.length) { list.appendChild(el('p', 'muted', '还没有报价')); return; }
    state.quotes.forEach(function (quote) {
      var row = el('div', 'row' + (quote.id === state.selected ? ' active' : ''));
      row.appendChild(el('span', 'name', quote.number + ' · ' + quote.customer));
      row.appendChild(el('span', 'tag ' + quote.status, quote.status));
      row.appendChild(el('span', 'total', quote.currency + ' ' + quote.total));
      row.addEventListener('click', function () { state.selected = quote.id; renderList(); loadDetail(quote.id); });
      list.appendChild(row);
    });
  }

  function renderDetail(data) {
    var quote = data.quote;
    detail.textContent = '';
    detail.appendChild(el('h2', '', quote.number + ' · ' + quote.customer));
    var meta = el('p', 'muted', quote.status + ' · ' + quote.currency + ' ' + quote.total + ' · ' + quote.createdAt.replace('T', ' ').slice(0, 16));
    detail.appendChild(meta);
    var table = el('table');
    var head = el('tr');
    ['描述', '数量', '单价', '金额'].forEach(function (label) { head.appendChild(el('th', '', label)); });
    table.appendChild(head);
    quote.lines.forEach(function (line) {
      var tr = el('tr');
      tr.appendChild(el('td', '', line.description));
      tr.appendChild(el('td', '', String(line.quantity)));
      tr.appendChild(el('td', '', (line.unitPriceMinor / 100).toFixed(2)));
      tr.appendChild(el('td', '', line.amount));
      table.appendChild(tr);
    });
    detail.appendChild(table);
    if (quote.note) detail.appendChild(el('p', 'muted', quote.note));
    var actions = el('div', 'actions');
    [['sent', '标记已发送'], ['accepted', '客户接受'], ['rejected', '拒绝']].forEach(function (pair) {
      var button = el('button', '', pair[1]);
      button.addEventListener('click', function () { move(quote.id, pair[0]); });
      actions.appendChild(button);
    });
    detail.appendChild(actions);
  }

  function move(id, status) {
    api('/api/quotes/' + encodeURIComponent(id) + '/status', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: status }),
    }).then(function () { note('已更新为 ' + status); return loadAll(); })
      .catch(function (error) { note('更新失败：' + error.message, true); });
  }

  function loadDetail(id) {
    return api('/api/quotes/' + encodeURIComponent(id)).then(renderDetail).catch(function (error) {
      detail.textContent = '';
      detail.appendChild(el('p', 'muted', '加载失败：' + error.message));
    });
  }

  function loadAll() {
    return api('/api/quotes?status=all').then(function (data) {
      state.quotes = data.items || [];
      if (!state.selected && state.quotes.length) state.selected = state.quotes[0].id;
      renderList();
      if (state.selected) return loadDetail(state.selected);
      return null;
    });
  }

  document.getElementById('add-line').addEventListener('click', addLine);

  document.getElementById('create').addEventListener('submit', function (event) {
    event.preventDefault();
    var lines = [];
    Array.prototype.forEach.call(document.getElementById('lines').children, function (row) {
      var inputs = row.querySelectorAll('input');
      var description = inputs[0].value.trim();
      var quantity = Number(inputs[1].value);
      var price = Number(inputs[2].value);
      if (!description) return;
      lines.push({ description: description, quantity: Math.trunc(quantity) || 1, unitPriceMinor: Math.round((price || 0) * 100) });
    });
    if (!lines.length) { note('至少填写一行明细', true); return; }
    api('/api/quotes', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        customer: document.getElementById('customer').value.trim(),
        currency: document.getElementById('currency').value.trim().toUpperCase(),
        note: document.getElementById('note').value || undefined,
        lines: lines,
      }),
    }).then(function (data) {
      state.selected = data.quote.id;
      note('已创建草稿 ' + data.quote.number);
      document.getElementById('customer').value = '';
      return loadAll();
    }).catch(function (error) { note('创建失败：' + error.message, true); });
  });

  loadAll().catch(function (error) {
    if (error.status === 401) { location.assign('/login'); return; }
    note('加载失败：' + error.message, true);
  });
}());
</script>
</body></html>`;
