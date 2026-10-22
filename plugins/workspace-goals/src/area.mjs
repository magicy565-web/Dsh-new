// Self-contained goals page. Strict CSP, no external assets, no template
// literals inside the page body so it can live in a JS template string.
export const GOALS_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>目标 · 工作台</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in oklab, CanvasText 16%, transparent); --muted: color-mix(in oklab, CanvasText 55%, transparent); --accent: #2563eb; --ok: #16a34a; --bad: #b91c1c; --warn: #b45309; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.6 ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; background: Canvas; color: CanvasText; }
  header { display: flex; gap: 14px; align-items: baseline; padding: 14px 20px; border-bottom: 1px solid var(--line); }
  header h1 { font-size: 16px; margin: 0; }
  header a { color: var(--muted); text-decoration: none; font-size: 13px; }
  header a:hover { color: var(--accent); }
  main { display: grid; gap: 16px; padding: 18px 20px; grid-template-columns: minmax(260px, 360px) 1fr; align-items: start; }
  @media (max-width: 760px) { main { grid-template-columns: 1fr; } }
  section { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
  h2 { font-size: 13px; margin: 0 0 10px; color: var(--muted); letter-spacing: .03em; }
  .goal { display: flex; gap: 8px; align-items: baseline; padding: 7px 8px; border-radius: 8px; cursor: pointer; }
  .goal:hover { background: color-mix(in oklab, var(--accent) 8%, transparent); }
  .goal.active { background: color-mix(in oklab, var(--accent) 14%, transparent); }
  .goal .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag { font-size: 11px; border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; color: var(--muted); }
  .tag.active { color: var(--accent); border-color: var(--accent); }
  .tag.done { color: var(--ok); border-color: var(--ok); }
  .tag.blocked { color: var(--warn); border-color: var(--warn); }
  .tag.cancelled { color: var(--bad); border-color: var(--bad); }
  .muted { color: var(--muted); font-size: 12px; }
  form { display: grid; gap: 8px; }
  input, textarea, button { font: inherit; }
  input, textarea { padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line); background: Field; color: FieldText; }
  textarea { min-height: 70px; resize: vertical; }
  button { padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
  button:hover { border-color: var(--accent); color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td, th { text-align: left; padding: 5px 0; border-bottom: 1px dashed var(--line); }
  th { color: var(--muted); font-weight: 400; font-size: 12px; }
  #msg { min-height: 18px; font-size: 12px; color: var(--muted); }
</style></head>
<body>
<header>
  <h1>目标</h1>
  <a href="/chat">对话</a>
  <a href="/schedules">计划</a>
  <a href="/ops">运维</a>
  <a href="/login">登录</a>
</header>
<main>
  <section>
    <h2>全部目标</h2>
    <div id="list"></div>
    <h2 style="margin-top:16px">新建目标</h2>
    <form id="create">
      <input id="title" placeholder="目标标题" maxlength="200" required>
      <textarea id="description" placeholder="补充说明（可选）" maxlength="4000"></textarea>
      <button class="primary" type="submit">创建</button>
    </form>
    <div id="msg"></div>
  </section>
  <section>
    <div id="detail"><p class="muted">选择一个目标查看详情</p></div>
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
  var state = { goals: [], selected: null };
  var list = document.getElementById('list');
  var detail = document.getElementById('detail');
  var msg = document.getElementById('msg');
  function note(text, bad) { msg.textContent = text || ''; msg.style.color = bad ? 'var(--bad)' : 'var(--muted)'; }

  function statusTag(status) { var tag = el('span', 'tag ' + status, status); return tag; }

  function renderList() {
    list.textContent = '';
    if (!state.goals.length) { list.appendChild(el('p', 'muted', '还没有目标')); return; }
    state.goals.forEach(function (goal) {
      var row = el('div', 'goal' + (goal.id === state.selected ? ' active' : ''));
      row.appendChild(el('span', 'name', goal.title));
      row.appendChild(statusTag(goal.status));
      row.addEventListener('click', function () { state.selected = goal.id; renderList(); loadDetail(goal.id); });
      list.appendChild(row);
    });
  }

  function renderDetail(data) {
    var goal = data.goal;
    detail.textContent = '';
    var head = el('div', 'row');
    head.appendChild(el('h2', '', goal.title));
    detail.appendChild(head);
    if (goal.description) detail.appendChild(el('p', '', goal.description));
    var meta = el('p', 'muted', '状态 ' + goal.status + ' · 创建于 ' + goal.createdAt.replace('T', ' ').slice(0, 19) + (goal.closedAt ? ' · 关闭于 ' + goal.closedAt.replace('T', ' ').slice(0, 19) : ''));
    detail.appendChild(meta);

    var actions = el('div', 'actions');
    [['active', '开始'], ['blocked', '阻塞'], ['done', '完成'], ['cancelled', '取消']].forEach(function (pair) {
      var button = el('button', '', pair[1]);
      button.addEventListener('click', function () { move(goal.id, pair[0]); });
      actions.appendChild(button);
    });
    detail.appendChild(actions);

    detail.appendChild(el('h2', '', '关联运行'));
    var runs = data.runs && data.runs.items ? data.runs.items : [];
    if (!runs.length) { detail.appendChild(el('p', 'muted', '还没有运行')); return; }
    var table = el('table');
    var head_row = el('tr');
    ['运行', '状态', '开始时间', '错误'].forEach(function (label) { head_row.appendChild(el('th', '', label)); });
    table.appendChild(head_row);
    runs.forEach(function (run) {
      var row = el('tr');
      row.appendChild(el('td', '', run.id.slice(0, 8)));
      row.appendChild(el('td', '', run.status));
      row.appendChild(el('td', '', run.createdAt.replace('T', ' ').slice(0, 19)));
      row.appendChild(el('td', '', run.error || ''));
      table.appendChild(row);
    });
    detail.appendChild(table);
  }

  function move(id, status) {
    api('/api/goals/' + encodeURIComponent(id) + '/status', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: status }),
    }).then(function () { note('已更新为 ' + status); return loadAll(); })
      .catch(function (error) { note('更新失败：' + error.message, true); });
  }

  function loadDetail(id) {
    return api('/api/goals/' + encodeURIComponent(id)).then(renderDetail).catch(function (error) {
      detail.textContent = '';
      detail.appendChild(el('p', 'muted', '加载失败：' + error.message));
    });
  }

  function loadAll() {
    return api('/api/goals?status=all&limit=100').then(function (data) {
      state.goals = data.items || [];
      if (!state.selected && state.goals.length) state.selected = state.goals[0].id;
      renderList();
      if (state.selected) return loadDetail(state.selected);
      return null;
    });
  }

  document.getElementById('create').addEventListener('submit', function (event) {
    event.preventDefault();
    var title = document.getElementById('title').value.trim();
    if (!title) return;
    api('/api/goals', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: crypto.randomUUID(), title: title, description: document.getElementById('description').value }),
    }).then(function (data) {
      state.selected = data.goal.id;
      document.getElementById('title').value = '';
      document.getElementById('description').value = '';
      note('已创建');
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
