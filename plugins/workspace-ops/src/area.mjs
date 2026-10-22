// Self-contained operations page. Strict CSP, no external assets, no inline
// template literals so the page can live inside a JS template string.
export const OPS_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>运维台 · 工作台</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in oklab, CanvasText 16%, transparent); --muted: color-mix(in oklab, CanvasText 55%, transparent); --accent: #2563eb; --ok: #16a34a; --bad: #b91c1c; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.6 ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; background: Canvas; color: CanvasText; }
  header { display: flex; gap: 14px; align-items: baseline; padding: 14px 20px; border-bottom: 1px solid var(--line); }
  header h1 { font-size: 16px; margin: 0; }
  header a { color: var(--muted); text-decoration: none; font-size: 13px; }
  header a:hover { color: var(--accent); }
  main { display: grid; gap: 16px; padding: 18px 20px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
  section { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
  h2 { font-size: 13px; margin: 0 0 10px; color: var(--muted); letter-spacing: .03em; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 8px; }
  .stat { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
  .stat b { display: block; font-size: 18px; font-variant-numeric: tabular-nums; }
  .stat span { font-size: 12px; color: var(--muted); }
  .row { display: flex; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px dashed var(--line); }
  .row:last-child { border-bottom: 0; }
  .row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag { font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; }
  button { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
  button:hover { border-color: var(--accent); color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  #msg { min-height: 18px; font-size: 12px; color: var(--muted); }
  .muted { color: var(--muted); font-size: 12px; }
</style></head>
<body>
<header>
  <h1>运维台</h1>
  <a href="/chat">对话</a>
  <a href="/market">市场</a>
  <a href="/login">登录</a>
</header>
<main>
  <section>
    <h2>运行状态</h2>
    <div class="grid" id="stats"></div>
    <p class="muted" id="meta"></p>
  </section>
  <section>
    <h2>备份</h2>
    <div class="row"><span class="name">创建一份新的 JSON 快照</span><button class="primary" id="backup">新建备份</button></div>
    <div id="backups"></div>
    <div id="msg"></div>
  </section>
  <section>
    <h2>目标</h2>
    <div id="goals"></div>
  </section>
  <section>
    <h2>计划任务</h2>
    <div id="schedules"></div>
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
  var msg = document.getElementById('msg');
  function note(text, bad) { msg.textContent = text || ''; msg.style.color = bad ? 'var(--bad)' : 'var(--muted)'; }

  function renderStatus(data) {
    var stats = document.getElementById('stats');
    stats.textContent = '';
    var counts = (data.storage && data.storage.counts) || {};
    var items = [
      ['会话', counts.conversations], ['运行', counts.runs], ['目标', counts.goals],
      ['计划', counts.schedules], ['收件箱', counts.inbox], ['审批', counts.approvals],
    ];
    items.forEach(function (pair) {
      var box = el('div', 'stat');
      box.appendChild(el('b', '', String(pair[1] === undefined ? 0 : pair[1])));
      box.appendChild(el('span', '', pair[0]));
      stats.appendChild(box);
    });
    document.getElementById('meta').textContent = 'v' + data.version + ' · ' + data.node + ' · 已运行 ' +
      Math.floor(data.uptimeSeconds / 60) + ' 分钟 · 数据 ' + Math.round((data.storage.bytes || 0) / 1024) + ' KiB';
  }

  function renderBackups(data) {
    var box = document.getElementById('backups');
    box.textContent = '';
    var items = data.items || [];
    if (!items.length) { box.appendChild(el('p', 'muted', '还没有备份')); return; }
    items.forEach(function (item) {
      var row = el('div', 'row');
      row.appendChild(el('span', 'name', item.createdAt.replace('T', ' ').slice(0, 19)));
      row.appendChild(el('span', 'tag', Math.round(item.bytes / 1024) + ' KiB'));
      var restore = el('button', '', '恢复');
      restore.addEventListener('click', function () {
        var typed = window.prompt('恢复会用该备份覆盖当前数据。请输入备份 ID 确认：\\n' + item.id);
        if (typed === null) return;
        if (typed !== item.id) { note('确认不匹配，已取消', true); return; }
        api('/api/ops/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ backupId: item.id, confirm: typed }) })
          .then(function () { note('已恢复 ' + item.id); return loadAll(); })
          .catch(function (error) { note('恢复失败：' + error.message, true); });
      });
      row.appendChild(restore);
      box.appendChild(row);
    });
  }

  function renderList(target, items, empty, decorate) {
    var box = document.getElementById(target);
    box.textContent = '';
    if (!items.length) { box.appendChild(el('p', 'muted', empty)); return; }
    items.slice(0, 8).forEach(function (item) {
      var row = el('div', 'row');
      row.appendChild(el('span', 'name', item.title || item.id));
      row.appendChild(el('span', 'tag', decorate(item)));
      box.appendChild(row);
    });
  }

  function loadAll() {
    return Promise.all([
      api('/api/ops/status').then(renderStatus),
      api('/api/ops/backups').then(renderBackups),
      api('/api/goals?status=all&limit=20').catch(function () { return { items: [] }; }).then(function (data) { renderList('goals', data.items || [], '还没有目标', function (item) { return item.status; }); }),
      api('/api/schedules?status=all').catch(function () { return { items: [] }; }).then(function (data) { renderList('schedules', data.items || [], '还没有计划', function (item) { return item.status; }); }),
    ]);
  }

  document.getElementById('backup').addEventListener('click', function () {
    note('正在备份…');
    api('/api/ops/backups', { method: 'POST' })
      .then(function (data) { note('已创建 ' + data.backup.id); return loadAll(); })
      .catch(function (error) { note('备份失败：' + error.message, true); });
  });

  loadAll().catch(function (error) {
    if (error.status === 401) { location.assign('/login'); return; }
    note('加载失败：' + error.message, true);
  });
}());
</script>
</body></html>`;
