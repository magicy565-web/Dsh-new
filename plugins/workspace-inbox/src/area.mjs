// Self-contained inbox page. Strict CSP, no external assets.
export const INBOX_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>收件箱 · 工作台</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in oklab, CanvasText 16%, transparent); --muted: color-mix(in oklab, CanvasText 55%, transparent); --accent: #2563eb; --ok: #16a34a; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.6 ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; background: Canvas; color: CanvasText; }
  header { display: flex; gap: 14px; align-items: baseline; padding: 14px 20px; border-bottom: 1px solid var(--line); }
  header h1 { font-size: 16px; margin: 0; }
  header a { color: var(--muted); text-decoration: none; font-size: 13px; }
  header a:hover { color: var(--accent); }
  main { max-width: 860px; margin: 0 auto; padding: 18px 20px 60px; }
  .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; }
  .bar .count { color: var(--muted); font-size: 12px; }
  .seg { display: flex; background: color-mix(in oklab, CanvasText 7%, transparent); border-radius: 10px; padding: 3px; }
  .seg button { border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12px; padding: 5px 12px; border-radius: 8px; cursor: pointer; }
  .seg button.on { background: Canvas; color: CanvasText; }
  .spacer { flex: 1; }
  button.action { font: inherit; font-size: 12px; padding: 5px 11px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
  button.action:hover { border-color: var(--accent); color: var(--accent); }
  .item { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
  .item.unread { border-color: color-mix(in oklab, var(--accent) 45%, var(--line)); background: color-mix(in oklab, var(--accent) 5%, transparent); }
  .item .top { display: flex; gap: 10px; align-items: baseline; }
  .item .kind { font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; }
  .item h2 { font-size: 14px; margin: 0; flex: 1; }
  .item time { font-size: 11px; color: var(--muted); }
  .item p { margin: 6px 0 0; color: var(--muted); font-size: 12px; white-space: pre-wrap; }
  .item .refs { margin-top: 6px; font-size: 11px; color: var(--muted); }
  .empty { color: var(--muted); text-align: center; padding: 40px 0; }
  #msg { min-height: 18px; font-size: 12px; color: var(--muted); margin-top: 8px; }
</style></head>
<body>
<header>
  <h1>收件箱</h1>
  <a href="/home">首页</a>
  <a href="/chat">对话</a>
  <a href="/goals">目标</a>
  <a href="/ops">运维</a>
</header>
<main>
  <div class="bar">
    <div class="seg"><button id="unread" class="on">未读</button><button id="all">全部</button></div>
    <span class="count" id="count"></span>
    <span class="spacer"></span>
    <button class="action" id="read-all">全部已读</button>
  </div>
  <div id="list"></div>
  <div id="msg"></div>
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
  var state = { status: 'unread' };
  var list = document.getElementById('list');
  var count = document.getElementById('count');
  var msg = document.getElementById('msg');
  function note(text, bad) { msg.textContent = text || ''; msg.style.color = bad ? 'var(--bad)' : 'var(--muted)'; }
  function fmt(value) { return value ? value.replace('T', ' ').slice(0, 16) : ''; }

  function render(data) {
    list.textContent = '';
    count.textContent = data.unread ? '未读 ' + data.unread : '';
    var items = data.items || [];
    if (!items.length) { list.appendChild(el('p', 'empty', state.status === 'unread' ? '没有未读通知' : '还没有通知')); return; }
    items.forEach(function (item) {
      var card = el('div', 'item' + (item.status === 'unread' ? ' unread' : ''));
      var top = el('div', 'top');
      top.appendChild(el('span', 'kind', item.kind));
      top.appendChild(el('h2', '', item.title));
      top.appendChild(el('time', '', fmt(item.createdAt)));
      card.appendChild(top);
      if (item.body) card.appendChild(el('p', '', item.body));
      var refs = Object.keys(item.refs || {}).map(function (key) { return key + '=' + String(item.refs[key]).slice(0, 8); }).join(' · ');
      if (refs) card.appendChild(el('div', 'refs', refs));
      if (item.status === 'unread') {
        var mark = el('button', 'action', '标记已读');
        mark.addEventListener('click', function () {
          api('/api/inbox/' + encodeURIComponent(item.id) + '/read', { method: 'POST' })
            .then(function () { note(''); return load(); })
            .catch(function (error) { note('操作失败：' + error.message, true); });
        });
        card.appendChild(mark);
      }
      list.appendChild(card);
    });
  }

  function load() {
    return api('/api/inbox?status=' + (state.status === 'all' ? 'all' : 'unread') + '&limit=100')
      .then(render)
      .catch(function (error) {
        if (error.status === 401) { location.assign('/login'); return; }
        note('加载失败：' + error.message, true);
      });
  }

  function setStatus(next) {
    state.status = next;
    document.getElementById('unread').classList.toggle('on', next === 'unread');
    document.getElementById('all').classList.toggle('on', next === 'all');
    return load();
  }

  document.getElementById('unread').addEventListener('click', function () { setStatus('unread'); });
  document.getElementById('all').addEventListener('click', function () { setStatus('all'); });
  document.getElementById('read-all').addEventListener('click', function () {
    api('/api/inbox/read-all', { method: 'POST' })
      .then(function (data) { note('已标记 ' + data.changed + ' 条'); return load(); })
      .catch(function (error) { note('操作失败：' + error.message, true); });
  });

  load();
}());
</script>
</body></html>`;
