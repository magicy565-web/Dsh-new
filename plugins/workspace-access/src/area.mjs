// Self-contained sessions page. Strict CSP, no external assets.
export const SESSIONS_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>会话 · 工作台</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in oklab, CanvasText 16%, transparent); --muted: color-mix(in oklab, CanvasText 55%, transparent); --accent: #2563eb; --bad: #b91c1c; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.6 ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; background: Canvas; color: CanvasText; }
  header { display: flex; gap: 14px; align-items: baseline; padding: 14px 20px; border-bottom: 1px solid var(--line); }
  header h1 { font-size: 16px; margin: 0; }
  header a { color: var(--muted); text-decoration: none; font-size: 13px; }
  header a:hover { color: var(--accent); }
  main { max-width: 900px; margin: 0 auto; padding: 18px 20px 60px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px dashed var(--line); }
  th { color: var(--muted); font-weight: 400; font-size: 12px; }
  code { font-size: 12px; }
  button { font: inherit; font-size: 12px; padding: 5px 11px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
  button:hover { border-color: var(--bad); color: var(--bad); }
  .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; }
  .bar .spacer { flex: 1; }
  .msg { min-height: 18px; font-size: 12px; color: var(--muted); }
  .empty { color: var(--muted); text-align: center; padding: 30px 0; }
</style></head>
<body>
<header>
  <h1>会话</h1>
  <a href="/home">首页</a>
  <a href="/chat">对话</a>
  <a href="/ops">运维</a>
  <a href="/login">登录</a>
</header>
<main>
  <div class="bar">
    <span class="msg" id="count"></span>
    <span class="spacer"></span>
    <button id="logout">退出登录</button>
  </div>
  <table>
    <thead><tr><th>主体</th><th>角色</th><th>创建</th><th>过期</th><th>最近活动</th><th></th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <p class="msg" id="msg"></p>
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
  var rows = document.getElementById('rows');
  var msg = document.getElementById('msg');
  function note(text, bad) { msg.textContent = text || ''; msg.style.color = bad ? 'var(--bad)' : 'var(--muted)'; }
  function fmt(value) { return value ? value.replace('T', ' ').slice(0, 16) : '—'; }

  function render(items) {
    rows.textContent = '';
    document.getElementById('count').textContent = '共 ' + items.length + ' 个有效会话';
    if (!items.length) {
      var row = el('tr');
      var cell = el('td', 'empty', '没有有效会话');
      cell.colSpan = 6;
      row.appendChild(cell);
      rows.appendChild(row);
      return;
    }
    items.forEach(function (session) {
      var row = el('tr');
      row.appendChild(el('td', '', session.subject));
      row.appendChild(el('td', '', session.role));
      row.appendChild(el('td', '', fmt(session.createdAt)));
      row.appendChild(el('td', '', fmt(session.expiresAt)));
      row.appendChild(el('td', '', fmt(session.lastSeenAt)));
      var action = el('td');
      var button = el('button', '', '强制下线');
      button.addEventListener('click', function () {
        if (!window.confirm('强制下线 ' + session.subject + ' 的这个会话？')) return;
        api('/api/access/sessions/' + encodeURIComponent(session.handle) + '/revoke', { method: 'POST' })
          .then(function () { note('已下线一个会话'); return load(); })
          .catch(function (error) { note('操作失败：' + error.message, true); });
      });
      action.appendChild(button);
      row.appendChild(action);
      rows.appendChild(row);
    });
  }

  function load() {
    return api('/api/access/sessions').then(function (data) { render(data.items || []); })
      .catch(function (error) {
        if (error.status === 401) { location.assign('/login'); return; }
        note('加载失败：' + error.message, true);
      });
  }

  document.getElementById('logout').addEventListener('click', function () {
    api('/api/access/logout', { method: 'POST' })
      .then(function () { location.assign('/login'); })
      .catch(function (error) { note('退出失败：' + error.message, true); });
  });

  load();
}());
</script>
</body></html>`;
