// Self-contained schedules page. Strict CSP, no external assets, no template
// literals inside the page body.
export const SCHEDULES_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>计划任务 · 工作台</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in oklab, CanvasText 16%, transparent); --muted: color-mix(in oklab, CanvasText 55%, transparent); --accent: #2563eb; --ok: #16a34a; --bad: #b91c1c; --warn: #b45309; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.6 ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; background: Canvas; color: CanvasText; }
  header { display: flex; gap: 14px; align-items: baseline; padding: 14px 20px; border-bottom: 1px solid var(--line); }
  header h1 { font-size: 16px; margin: 0; }
  header a { color: var(--muted); text-decoration: none; font-size: 13px; }
  header a:hover { color: var(--accent); }
  main { display: grid; gap: 16px; padding: 18px 20px; grid-template-columns: 1fr minmax(280px, 360px); align-items: start; }
  @media (max-width: 780px) { main { grid-template-columns: 1fr; } }
  section { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
  h2 { font-size: 13px; margin: 0 0 10px; color: var(--muted); letter-spacing: .03em; }
  .row { display: flex; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px dashed var(--line); }
  .row:last-child { border-bottom: 0; }
  .row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag { font-size: 11px; border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; color: var(--muted); }
  .tag.enabled { color: var(--ok); border-color: var(--ok); }
  .tag.done { color: var(--accent); border-color: var(--accent); }
  .tag.blocked { color: var(--bad); border-color: var(--bad); }
  .muted { color: var(--muted); font-size: 12px; }
  form { display: grid; gap: 8px; }
  input, textarea, select, button { font: inherit; }
  input, textarea, select { padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line); background: Field; color: FieldText; }
  textarea { min-height: 64px; resize: vertical; }
  button { padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
  button:hover { border-color: var(--accent); color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  #msg { min-height: 18px; font-size: 12px; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td, th { text-align: left; padding: 5px 0; border-bottom: 1px dashed var(--line); }
  th { color: var(--muted); font-weight: 400; font-size: 12px; }
</style></head>
<body>
<header>
  <h1>计划任务</h1>
  <a href="/home">首页</a>
  <a href="/chat">对话</a>
  <a href="/goals">目标</a>
  <a href="/ops">运维</a>
</header>
<main>
  <section>
    <h2>全部计划</h2>
    <div id="list"></div>
    <div id="detail"></div>
  </section>
  <section>
    <h2>新建计划</h2>
    <form id="create">
      <input id="title" placeholder="计划名称，例如 每天盯库存" maxlength="200" required>
      <textarea id="prompt" placeholder="到期时发给对话的内容" maxlength="2000" required></textarea>
      <select id="conversation" required></select>
      <select id="goal"></select>
      <select id="kind">
        <option value="every">周期</option>
        <option value="at">一次性</option>
      </select>
      <input id="every" type="number" min="60" step="60" value="3600" placeholder="每隔多少秒（≥60）">
      <input id="at" type="datetime-local" hidden>
      <button class="primary" type="submit">创建（默认停用）</button>
    </form>
    <div id="msg"></div>
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
  var state = { conversations: [], goals: [], schedules: [] };
  var list = document.getElementById('list');
  var detail = document.getElementById('detail');
  var msg = document.getElementById('msg');
  function note(text, bad) { msg.textContent = text || ''; msg.style.color = bad ? 'var(--bad)' : 'var(--muted)'; }
  function fmt(value) { return value ? value.replace('T', ' ').slice(0, 19) : '—'; }

  function renderList() {
    list.textContent = '';
    if (!state.schedules.length) { list.appendChild(el('p', 'muted', '还没有计划')); return; }
    state.schedules.forEach(function (item) {
      var row = el('div', 'row');
      var name = el('span', 'name', item.title);
      name.title = item.prompt;
      row.appendChild(name);
      row.appendChild(el('span', 'tag ' + item.status, item.status));
      row.appendChild(el('span', 'muted', item.kind === 'at' ? '一次性 · ' + fmt(item.nextAt || item.at) : '每 ' + item.everySeconds + ' 秒 · 下次 ' + fmt(item.nextAt)));
      var toggle = el('button', '', item.status === 'enabled' ? '停用' : '启用');
      toggle.disabled = item.status === 'done' || item.status === 'blocked';
      toggle.addEventListener('click', function () {
        var next = item.status === 'enabled' ? 'disabled' : 'enabled';
        api('/api/schedules/' + encodeURIComponent(item.id) + '/status', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: next }),
        }).then(function () { note('已切换为 ' + next); return loadAll(); })
          .catch(function (error) { note('切换失败：' + error.message, true); });
      });
      row.appendChild(toggle);
      row.addEventListener('click', function (event) {
        if (event.target && event.target.tagName === 'BUTTON') return;
        loadDetail(item.id);
      });
      list.appendChild(row);
    });
  }

  function renderDetail(data) {
    detail.textContent = '';
    var schedule = data.schedule;
    detail.appendChild(el('h2', '', '派发回执 · ' + schedule.title));
    var receipts = data.receipts || [];
    if (!receipts.length) { detail.appendChild(el('p', 'muted', '还没有派发记录')); return; }
    var table = el('table');
    var head = el('tr');
    ['到期时刻', '派发时间', '运行'].forEach(function (label) { head.appendChild(el('th', '', label)); });
    table.appendChild(head);
    receipts.forEach(function (receipt) {
      var row = el('tr');
      row.appendChild(el('td', '', fmt(receipt.dueAt)));
      row.appendChild(el('td', '', fmt(receipt.at)));
      row.appendChild(el('td', '', String(receipt.runId || '').slice(0, 8)));
      table.appendChild(row);
    });
    detail.appendChild(table);
  }

  function loadDetail(id) {
    return api('/api/schedules/' + encodeURIComponent(id)).then(renderDetail).catch(function (error) {
      detail.textContent = '';
      detail.appendChild(el('p', 'muted', '加载失败：' + error.message));
    });
  }

  function fillSelects() {
    var conversation = document.getElementById('conversation');
    conversation.textContent = '';
    state.conversations.forEach(function (item) {
      var option = el('option', '', item.title || item.id.slice(0, 8));
      option.value = item.id;
      conversation.appendChild(option);
    });
    var goal = document.getElementById('goal');
    goal.textContent = '';
    var none = el('option', '', '（不关联目标）');
    none.value = '';
    goal.appendChild(none);
    state.goals.forEach(function (item) {
      var option = el('option', '', item.title);
      option.value = item.id;
      goal.appendChild(option);
    });
  }

  function loadAll() {
    return Promise.all([
      api('/api/schedules?status=all').then(function (data) { state.schedules = data.items || []; renderList(); }),
      api('/api/chat/conversations?limit=50').then(function (data) { state.conversations = data.items || []; }).catch(function () { state.conversations = []; }),
      api('/api/goals?status=all&limit=50').then(function (data) { state.goals = data.items || []; }).catch(function () { state.goals = []; }),
    ]).then(fillSelects);
  }

  document.getElementById('kind').addEventListener('change', function (event) {
    var atMode = event.target.value === 'at';
    document.getElementById('at').hidden = !atMode;
    document.getElementById('every').hidden = atMode;
  });

  document.getElementById('create').addEventListener('submit', function (event) {
    event.preventDefault();
    var kind = document.getElementById('kind').value;
    var payload = {
      requestId: crypto.randomUUID(),
      title: document.getElementById('title').value.trim(),
      prompt: document.getElementById('prompt').value.trim(),
      conversationId: document.getElementById('conversation').value,
      goalId: document.getElementById('goal').value || undefined,
      kind: kind,
    };
    if (kind === 'every') payload.everySeconds = Number(document.getElementById('every').value);
    else payload.at = new Date(document.getElementById('at').value).toISOString();
    api('/api/schedules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function () {
        document.getElementById('title').value = '';
        document.getElementById('prompt').value = '';
        note('已创建（默认停用，记得启用）');
        return loadAll();
      })
      .catch(function (error) { note('创建失败：' + error.message, true); });
  });

  loadAll().catch(function (error) {
    if (error.status === 401) { location.assign('/login'); return; }
    note('加载失败：' + error.message, true);
  });
}());
</script>
</body></html>`;
