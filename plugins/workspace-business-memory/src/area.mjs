// The Business Memory area.
//
// One self-contained HTML page served by the harness plugin. It reads the same
// JSON routes the model tools use, so the human review queue and the agent see
// one consistent memory. No external assets, no build step, no model call.
const PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>经营记忆 · 企业的业务记忆</title>
<style>
:root {
  --bg: #f6f4ee; --card: #fffdf9; --ink: #1c1b17; --muted: #6d6a60;
  --line: #e4dfd3; --accent: #2f6b4f; --accent-soft: #e8f1ea;
  --warn: #8a5a13; --warn-soft: #fbf1de; --danger: #8c3b32; --danger-soft: #f8e9e6;
  --radius: 14px; --shadow: 0 1px 2px rgba(28,27,23,.05), 0 10px 30px rgba(28,27,23,.04);
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--ink); }
body { font: 14px/1.6 -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
h1, h2, h3 { font-family: Georgia, "Songti SC", "Noto Serif CJK SC", serif; font-weight: 600; letter-spacing: .01em; }
button { font: inherit; cursor: pointer; }
.shell { max-width: 1180px; margin: 0 auto; padding: 40px 28px 80px; }
header.hero { display: flex; justify-content: space-between; gap: 24px; align-items: flex-end; flex-wrap: wrap; }
.eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: var(--accent); font-weight: 600; }
.eyebrow i { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
h1 { font-size: 42px; margin: 10px 0 6px; }
.hero p { margin: 0; color: var(--muted); max-width: 560px; }
.hero-actions { display: flex; gap: 10px; }
.btn { border: 1px solid var(--line); background: var(--card); color: var(--ink); border-radius: 999px; padding: 9px 18px; transition: .15s; }
.btn:hover { border-color: var(--ink); }
.btn.primary { background: var(--ink); border-color: var(--ink); color: #fff; }
.btn.primary:hover { background: #000; }
.btn.ghost { background: transparent; }
.btn.danger { color: var(--danger); border-color: #e7cdc7; background: var(--danger-soft); }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0; margin: 32px 0 8px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--card); overflow: hidden; }
.stat { padding: 18px 20px; border-right: 1px solid var(--line); }
.stat:last-child { border-right: 0; }
.stat b { display: block; font-family: Georgia, serif; font-size: 30px; line-height: 1.1; }
.stat span { color: var(--muted); font-size: 12px; }
.grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 22px; margin-top: 26px; align-items: start; }
.panel { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 20px; border-bottom: 1px solid var(--line); }
.panel-head h2 { font-size: 19px; margin: 0; }
.panel-head small { color: var(--muted); }
.panel-body { padding: 18px 20px; }
.brief-item { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; background: #fff; }
.brief-item:last-child { margin-bottom: 0; }
.brief-item h3 { margin: 0 0 6px; font-size: 15px; font-family: inherit; font-weight: 600; display: flex; gap: 8px; align-items: center; }
.brief-item p { margin: 0; color: var(--muted); font-size: 13px; }
.brief-item .q { margin-top: 10px; padding: 9px 12px; background: var(--accent-soft); border-radius: 9px; color: #244d39; font-size: 13px; }
.pill { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); background: #fff; white-space: nowrap; }
.pill.high { color: var(--danger); background: var(--danger-soft); border-color: #ecd4cf; }
.pill.medium { color: var(--warn); background: var(--warn-soft); border-color: #ecdcbd; }
.pill.ok { color: var(--accent); background: var(--accent-soft); border-color: #cfe2d6; }
.toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--line); }
.search { flex: 1 1 220px; display: flex; align-items: center; gap: 8px; border: 1px solid var(--line); border-radius: 999px; padding: 8px 14px; background: #fff; }
.search input { border: 0; outline: 0; background: transparent; width: 100%; font: inherit; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 5px 12px; font-size: 12px; color: var(--muted); }
.chip.on { background: var(--ink); border-color: var(--ink); color: #fff; }
.records { padding: 6px 12px 12px; }
.record { display: block; width: 100%; text-align: left; border: 1px solid transparent; border-bottom-color: var(--line); background: none; padding: 14px 8px; border-radius: 10px; }
.record:last-child { border-bottom-color: transparent; }
.record:hover { background: #f7f4ec; border-color: var(--line); }
.record-top { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 5px; }
.record-top b { font-size: 12px; color: var(--accent); font-weight: 600; }
.record p { margin: 0; font-size: 14px; }
.record small { display: block; margin-top: 6px; color: var(--muted); font-size: 12px; }
.empty { padding: 34px 20px; text-align: center; color: var(--muted); }
.empty b { display: block; color: var(--ink); margin-bottom: 4px; }
.muted { color: var(--muted); }
.sheet-wrap { position: fixed; inset: 0; background: rgba(24,23,19,.34); display: none; justify-content: flex-end; z-index: 20; }
.sheet-wrap.open { display: flex; }
.sheet { width: min(560px, 92vw); height: 100%; background: var(--card); overflow: auto; padding: 26px 26px 60px; box-shadow: -20px 0 50px rgba(0,0,0,.12); }
.sheet h2 { font-size: 24px; margin: 8px 0 6px; }
.sheet .meta { display: flex; gap: 8px; flex-wrap: wrap; margin: 14px 0 18px; }
.sheet section { border-top: 1px solid var(--line); padding-top: 16px; margin-top: 16px; }
.sheet section h3 { font-family: inherit; font-size: 13px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); margin: 0 0 10px; }
.sheet .statement { font-size: 16px; line-height: 1.65; }
.sheet .detail { white-space: pre-wrap; color: #3d3a32; background: #fbf9f3; border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
.kv { display: grid; grid-template-columns: 108px 1fr; gap: 8px 14px; font-size: 13px; }
.kv dt { color: var(--muted); }
.kv dd { margin: 0; overflow-wrap: anywhere; }
.hist { list-style: none; margin: 0; padding: 0; }
.hist li { padding: 8px 0 8px 16px; border-left: 2px solid var(--line); position: relative; font-size: 13px; }
.hist li:before { content: ""; position: absolute; left: -5px; top: 15px; width: 8px; height: 8px; border-radius: 50%; background: var(--line); }
.hist li b { font-weight: 600; }
.sheet-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 20px; }
.sheet-close { float: right; border: 0; background: none; font-size: 22px; color: var(--muted); line-height: 1; }
dialog { border: 0; border-radius: 18px; padding: 0; width: min(620px, 94vw); box-shadow: 0 30px 80px rgba(0,0,0,.25); }
dialog::backdrop { background: rgba(24,23,19,.38); }
.form { padding: 24px 26px 26px; }
.form h2 { margin: 0 0 4px; }
.form p.sub { margin: 0 0 18px; color: var(--muted); font-size: 13px; }
.field { margin-bottom: 14px; }
.field label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 5px; }
.field input, .field select, .field textarea { width: 100%; border: 1px solid var(--line); border-radius: 10px; padding: 9px 12px; font: inherit; background: #fff; color: var(--ink); }
.field textarea { min-height: 92px; resize: vertical; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; }
.toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); background: var(--ink); color: #fff; padding: 10px 18px; border-radius: 999px; font-size: 13px; opacity: 0; pointer-events: none; transition: .2s; z-index: 40; }
.toast.show { opacity: 1; }
.toast.error { background: var(--danger); }
.footer { margin-top: 28px; color: var(--muted); font-size: 12px; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } .stats { grid-template-columns: repeat(2, 1fr); } .stat { border-bottom: 1px solid var(--line); } h1 { font-size: 34px; } }
</style>
</head>
<body>
<div class="shell">
  <header class="hero">
    <div>
      <span class="eyebrow"><i></i>BUSINESS MEMORY · 每个企业一套独立记忆</span>
      <h1>经营记忆</h1>
      <p>人负责确认，AI 负责提炼。每一条事实都固定来源与版本；未审核的提案不会进入经营判断。</p>
    </div>
    <div class="hero-actions">
      <button class="btn ghost" id="refresh">刷新</button>
      <button class="btn primary" id="open-compose">记录一条记忆</button>
    </div>
  </header>

  <section class="stats" id="stats" aria-label="记忆概况"></section>

  <div class="grid">
    <section class="panel">
      <div class="panel-head"><div><h2>增长简报</h2><small>只根据已有记忆计算，不做预测</small></div><span class="pill" id="brief-count">…</span></div>
      <div class="panel-body" id="brief"></div>
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>记忆覆盖</h2><small>按经营主体分布</small></div></div>
      <div class="panel-body" id="coverage"></div>
    </section>
  </div>

  <section class="panel" style="margin-top:22px">
    <div class="panel-head"><div><h2>记忆档案</h2><small id="record-count"></small></div><button class="btn ghost" id="toggle-pending">查看待审核</button></div>
    <div class="toolbar">
      <label class="search">⌕<input id="q" placeholder="搜索事实、主体或标签"></label>
      <div class="chips" id="subjects"></div>
    </div>
    <div class="records" id="records"></div>
  </section>

  <div class="footer">
    <span>数据来自当前 Harness 工作空间；不会自动创建目标、审批或外部动作。</span>
    <span id="workspace"></span>
  </div>
</div>

<div class="sheet-wrap" id="sheet-wrap" role="dialog" aria-modal="true" aria-label="记忆详情">
  <div class="sheet" id="sheet"></div>
</div>

<dialog id="compose">
  <form class="form" id="compose-form">
    <h2>记录一条经营记忆</h2>
    <p class="sub">提交后进入待审核队列；管理员在记忆详情中通过或拒绝后才会生效。AI 提出的候选也走同一队列。</p>
    <div class="row">
      <div class="field"><label for="c-subject">主体类型</label><select id="c-subject"></select></div>
      <div class="field"><label for="c-kind">记忆类型</label><select id="c-kind"></select></div>
    </div>
    <div class="row">
      <div class="field"><label for="c-subject-id">主体 ID</label><input id="c-subject-id" placeholder="例如 prod_01J... 或 customer-haiqi" required></div>
      <div class="field"><label for="c-subject-label">主体名称</label><input id="c-subject-label" placeholder="例如 海祺贸易"></div>
    </div>
    <div class="row">
      <div class="field"><label for="c-fact-key">事实键</label><input id="c-fact-key" placeholder="例如 moq / lead-time / buyer-profile" required></div>
      <div class="field"><label for="c-confidence">置信度</label><select id="c-confidence"><option value="">未设置</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></div>
    </div>
    <div class="field"><label for="c-statement">事实内容</label><textarea id="c-statement" maxlength="2000" required placeholder="一句可核对的事实，不要写预测或未经验证的结论。"></textarea></div>
    <div class="field"><label for="c-source-kind">来源</label><select id="c-source-kind"><option value="operator">人工陈述</option><option value="conversation">对话记录</option></select></div>
    <div class="field" id="c-basis-field"><label for="c-basis">依据</label><input id="c-basis" maxlength="500" placeholder="例如 2026-10-21 与客户采购负责人通话确认"></div>
    <div class="field" id="c-ref-field" hidden><label for="c-ref">对话引用</label><input id="c-ref" maxlength="300" placeholder="例如 conversation-id 或消息链接"></div>
    <div class="field"><label for="c-tags">标签（逗号分隔）</label><input id="c-tags" placeholder="例如 复购, 价格"></div>
    <div class="form-actions">
      <button type="button" class="btn ghost" id="cancel-compose">取消</button>
      <button type="submit" class="btn primary" id="submit-compose">提交待审核</button>
    </div>
  </form>
</dialog>
<div class="toast" id="toast"></div>
<script>
(function () {
  var state = { status: null, map: null, brief: null, records: [], subject: '', q: '', pendingOnly: false, selected: null };
  var SUBJECTS = [['', '全部'], ['company', '企业'], ['product', '产品'], ['customer', '客户'], ['market', '市场'], ['channel', '渠道'], ['operation', '经营动作']];
  var KINDS = [['fact', '事实'], ['observation', '观察'], ['hypothesis', '假设'], ['preference', '偏好'], ['decision', '决策'], ['outcome', '结果']];
  var LABELS = { company: '企业', product: '产品', customer: '客户', market: '市场', channel: '渠道', operation: '经营动作' };
  var STATUS = { active: '已生效', proposed: '待审核', rejected: '已拒绝', superseded: '已被替代', revoked: '已撤回', expired: '已过期' };
  var ACTION = { proposed: '提出', activated: '生效', rejected: '拒绝', superseded: '被替代', revoked: '撤回' };

  function api(path, options) {
    return fetch(path, Object.assign({ headers: { accept: 'application/json', 'content-type': 'application/json' } }, options || {}))
      .then(function (response) {
        return response.text().then(function (text) {
          var body = null;
          try { body = text ? JSON.parse(text) : null; } catch (error) { body = null; }
          if (!response.ok) {
            var code = body && body.error && body.error.code ? body.error.code : 'HTTP_' + response.status;
            var message = body && body.error && body.error.message ? body.error.message : '请求未完成';
            throw new Error(code + ': ' + message);
          }
          return body;
        });
      });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function pill(text, tone) { return el('span', 'pill' + (tone ? ' ' + tone : ''), text); }
  function toast(message, error) {
    var node = document.getElementById('toast');
    node.textContent = message;
    node.className = 'toast show' + (error ? ' error' : '');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { node.className = 'toast'; }, 3600);
  }

  function renderStats() {
    var status = state.status || {};
    var host = document.getElementById('stats');
    host.textContent = '';
    [['已生效记忆', status.active || 0], ['待人工审核', status.proposed || 0], ['覆盖主体', (status.subjects || 0) + ' / 6'], ['来源类型', status.sourceKinds || 0], ['工作空间', status.workspaceId || 'local']].forEach(function (row) {
      var cell = el('div', 'stat');
      cell.appendChild(el('b', null, row[1]));
      cell.appendChild(el('span', null, row[0]));
      host.appendChild(cell);
    });
    document.getElementById('workspace').textContent = '工作空间：' + (status.workspaceId || 'local');
  }

  function renderBrief() {
    var host = document.getElementById('brief');
    host.textContent = '';
    var items = (state.brief && state.brief.items) || [];
    document.getElementById('brief-count').textContent = items.length + ' 条信号';
    if (!items.length) {
      var empty = el('div', 'empty');
      empty.appendChild(el('b', null, '当前没有需要处理的记忆信号'));
      empty.appendChild(el('span', null, '继续记录真实经营事实，或等待新的提案。'));
      host.appendChild(empty);
      return;
    }
    items.slice(0, 6).forEach(function (item) {
      var card = el('div', 'brief-item');
      var title = el('h3');
      title.appendChild(pill(item.severity === 'high' ? '优先' : item.severity === 'medium' ? '关注' : '提示', item.severity === 'high' ? 'high' : item.severity === 'medium' ? 'medium' : 'ok'));
      title.appendChild(el('span', null, item.title));
      card.appendChild(title);
      card.appendChild(el('p', null, item.reason));
      if (item.question) card.appendChild(el('div', 'q', '下一个问题：' + item.question));
      if (item.evidenceIds && item.evidenceIds.length) {
        card.appendChild(el('small', 'muted', '引用 ' + item.evidenceIds.length + ' 条记忆'));
      }
      host.appendChild(card);
    });
  }

  function renderCoverage() {
    var host = document.getElementById('coverage');
    host.textContent = '';
    var subjects = (state.map && state.map.subjects) || [];
    subjects.forEach(function (row) {
      var line = el('div', 'brief-item');
      var head = el('h3');
      head.appendChild(el('span', null, row.label));
      head.appendChild(pill(row.coverage === 'covered' ? '充分' : row.coverage === 'thin' ? '偏少' : '缺失', row.coverage === 'covered' ? 'ok' : row.coverage === 'thin' ? 'medium' : 'high'));
      line.appendChild(head);
      line.appendChild(el('p', null, row.active + ' 条已生效 · ' + row.proposed + ' 条待审核 · ' + row.factKeys + ' 个事实键'));
      host.appendChild(line);
    });
  }

  function renderSubjects() {
    var host = document.getElementById('subjects');
    host.textContent = '';
    SUBJECTS.forEach(function (pair) {
      var chip = el('button', 'chip' + (state.subject === pair[0] ? ' on' : ''), pair[1]);
      chip.type = 'button';
      chip.addEventListener('click', function () { state.subject = pair[0]; renderSubjects(); loadRecords(); });
      host.appendChild(chip);
    });
  }

  function renderRecords() {
    var host = document.getElementById('records');
    host.textContent = '';
    document.getElementById('record-count').textContent = state.records.length + ' 条';
    if (!state.records.length) {
      var empty = el('div', 'empty');
      empty.appendChild(el('b', null, state.pendingOnly ? '没有待审核提案' : '还没有匹配的记忆'));
      empty.appendChild(el('span', null, state.pendingOnly ? 'AI 还没有提出新的经营事实。' : '记录第一条事实，或在对话中让 AI 提出记忆。'));
      host.appendChild(empty);
      return;
    }
    state.records.forEach(function (record) {
      var card = el('button', 'record');
      card.type = 'button';
      var top = el('div', 'record-top');
      top.appendChild(el('b', null, LABELS[record.subjectType] || record.subjectType));
      top.appendChild(pill(STATUS[record.lifecycle] || record.lifecycle, record.lifecycle === 'active' ? 'ok' : record.lifecycle === 'proposed' ? 'medium' : ''));
      top.appendChild(el('span', 'muted', record.subjectLabel));
      card.appendChild(top);
      card.appendChild(el('p', null, record.statement));
      card.appendChild(el('small', null, record.factKey + ' · v' + record.revision + ' · ' + (record.source.label || record.source.kind) + ' · ' + new Date(record.updatedAt).toLocaleString('zh-CN')));
      card.addEventListener('click', function () { openRecord(record.id); });
      host.appendChild(card);
    });
  }

  function openRecord(id) {
    api('/api/business-memory/records/' + encodeURIComponent(id)).then(function (payload) {
      state.selected = payload.record;
      renderSheet(payload.record);
    }).catch(function (error) { toast(error.message, true); });
  }

  function renderSheet(record) {
    var sheet = document.getElementById('sheet');
    sheet.textContent = '';
    var close = el('button', 'sheet-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', closeSheet);
    sheet.appendChild(close);
    sheet.appendChild(el('span', 'eyebrow', 'MEMORY FACT'));
    sheet.appendChild(el('h2', null, record.statement));
    var meta = el('div', 'meta');
    meta.appendChild(pill(LABELS[record.subjectType] || record.subjectType));
    meta.appendChild(pill(record.kind));
    meta.appendChild(pill(STATUS[record.lifecycle] || record.lifecycle, record.lifecycle === 'active' ? 'ok' : record.lifecycle === 'proposed' ? 'medium' : ''));
    meta.appendChild(pill('v' + record.revision));
    sheet.appendChild(meta);

    var facts = el('section');
    facts.appendChild(el('h3', null, '事实'));
    var kv = el('dl', 'kv');
    [['主体', record.subjectLabel + '（' + record.subjectId + '）'], ['事实键', record.factKey], ['置信度', record.confidence || '未设置'],
     ['提出', record.proposedBy + ' · ' + new Date(record.proposedAt).toLocaleString('zh-CN')],
     ['审核', record.reviewedBy ? record.reviewedBy + ' · ' + new Date(record.reviewedAt).toLocaleString('zh-CN') : '尚未审核'],
     ['过期', record.expiresAt ? new Date(record.expiresAt).toLocaleString('zh-CN') : '不自动过期']].forEach(function (row) {
      var dt = el('dt', null, row[0]); var dd = el('dd', null, row[1]); kv.appendChild(dt); kv.appendChild(dd);
    });
    facts.appendChild(kv);
    if (record.detail) { var detail = el('div', 'detail'); detail.textContent = record.detail; facts.appendChild(detail); }
    sheet.appendChild(facts);

    var source = el('section');
    source.appendChild(el('h3', null, '来源与核对'));
    var skv = el('dl', 'kv');
    [['来源类型', record.source.kind], ['来源引用', record.source.ref], ['来源名称', record.source.label],
     ['核对状态', record.source.attestation === 'source-verified' ? '已按源版本核对' : record.source.attestation === 'human-attested' ? '人工陈述（未机器核对）' : '对话指针（待人工确认）'],
     ['SHA-256', record.source.sha256 || '—'], ['核对时间', record.source.verifiedAt ? new Date(record.source.verifiedAt).toLocaleString('zh-CN') : '—']].forEach(function (row) {
      var dt = el('dt', null, row[0]); var dd = el('dd', null, row[1]); skv.appendChild(dt); skv.appendChild(dd);
    });
    source.appendChild(skv);
    if (record.source.basis) source.appendChild(el('p', 'muted', '依据：' + record.source.basis));
    sheet.appendChild(source);

    var history = el('section');
    history.appendChild(el('h3', null, '版本历史'));
    var list = el('ul', 'hist');
    (record.history || []).slice().reverse().forEach(function (entry) {
      var item = el('li');
      item.appendChild(el('b', null, ACTION[entry.action] || entry.action));
      item.appendChild(el('span', null, ' · v' + entry.revision + ' · ' + entry.actor + ' · ' + new Date(entry.at).toLocaleString('zh-CN')));
      list.appendChild(item);
    });
    history.appendChild(list);
    sheet.appendChild(history);

    var actions = el('div', 'sheet-actions');
    if (record.canReview) {
      var approve = el('button', 'btn primary', '通过并生效');
      approve.type = 'button';
      approve.addEventListener('click', function () { decide(record.id, 'approve'); });
      var reject = el('button', 'btn', '拒绝');
      reject.type = 'button';
      reject.addEventListener('click', function () { decide(record.id, 'reject'); });
      actions.appendChild(approve); actions.appendChild(reject);
    }
    if (record.canRevoke) {
      var revoke = el('button', 'btn danger', '撤回记忆');
      revoke.type = 'button';
      revoke.addEventListener('click', function () {
        if (!window.confirm('撤回后这条记忆会退出经营判断，历史仍保留。继续？')) return;
        mutate('/api/business-memory/records/' + encodeURIComponent(record.id) + '/revoke', { reason: 'revoked_in_area' }, '已撤回');
      });
      actions.appendChild(revoke);
    }
    if (record.related && record.related.length) {
      var related = el('section');
      related.appendChild(el('h3', null, '同一事实的历史记录'));
      record.related.forEach(function (item) {
        var line = el('button', 'record');
        line.type = 'button';
        line.appendChild(el('p', null, item.statement));
        line.appendChild(el('small', null, STATUS[item.status] + ' · v' + item.revision + ' · ' + new Date(item.updatedAt).toLocaleString('zh-CN')));
        line.addEventListener('click', function () { openRecord(item.id); });
        related.appendChild(line);
      });
      sheet.appendChild(related);
    }
    sheet.appendChild(actions);
    document.getElementById('sheet-wrap').classList.add('open');
  }

  function closeSheet() {
    document.getElementById('sheet-wrap').classList.remove('open');
    state.selected = null;
  }

  function mutate(path, body, doneText) {
    body = body || {};
    body.requestId = crypto.randomUUID();
    return api(path, { method: 'POST', body: JSON.stringify(body) }).then(function () {
      toast(doneText || '已保存');
      closeSheet();
      return loadAll();
    }).catch(function (error) { toast(error.message, true); });
  }

  function decide(id, decision) {
    var note = decision === 'reject' ? (window.prompt('拒绝原因（可留空）') || '') : undefined;
    var body = { decision: decision };
    if (note) body.note = note.slice(0, 500);
    mutate('/api/business-memory/records/' + encodeURIComponent(id) + '/review', body, decision === 'approve' ? '已通过，记忆已生效' : '已拒绝该提案');
  }

  function loadRecords() {
    var query = ['/api/business-memory/records?limit=50'];
    if (state.q) query.push('q=' + encodeURIComponent(state.q));
    if (state.subject) query.push('subjectType=' + encodeURIComponent(state.subject));
    if (state.pendingOnly) query.push('status=proposed');
    return api(query.join('&')).then(function (payload) {
      state.records = payload.items || [];
      renderRecords();
    }).catch(function (error) { toast(error.message, true); });
  }

  function loadAll() {
    return Promise.all([
      api('/api/business-memory/status').then(function (value) { state.status = value; }),
      api('/api/business-memory/map').then(function (value) { state.map = value; }),
      api('/api/business-memory/brief').then(function (value) { state.brief = value; })
    ]).then(function () {
      renderStats(); renderBrief(); renderCoverage();
      return loadRecords();
    }).catch(function (error) { toast(error.message, true); });
  }

  function openCompose() {
    var subject = document.getElementById('c-subject');
    var kind = document.getElementById('c-kind');
    if (!subject.options.length) {
      SUBJECTS.slice(1).forEach(function (pair) { var option = el('option', null, pair[1]); option.value = pair[0]; subject.appendChild(option); });
      KINDS.forEach(function (pair) { var option = el('option', null, pair[1]); option.value = pair[0]; kind.appendChild(option); });
    }
    document.getElementById('compose').showModal();
  }

  document.getElementById('refresh').addEventListener('click', loadAll);
  document.getElementById('open-compose').addEventListener('click', openCompose);
  document.getElementById('cancel-compose').addEventListener('click', function () { document.getElementById('compose').close(); });
  document.getElementById('toggle-pending').addEventListener('click', function (event) {
    state.pendingOnly = !state.pendingOnly;
    event.currentTarget.textContent = state.pendingOnly ? '查看全部记忆' : '查看待审核';
    loadRecords();
  });
  var searchTimer;
  document.getElementById('q').addEventListener('input', function (event) {
    state.q = event.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadRecords, 220);
  });
  document.getElementById('sheet-wrap').addEventListener('click', function (event) { if (event.target === event.currentTarget) closeSheet(); });
  document.getElementById('c-source-kind').addEventListener('change', function (event) {
    var operator = event.target.value === 'operator';
    document.getElementById('c-basis-field').hidden = !operator;
    document.getElementById('c-ref-field').hidden = operator;
  });
  document.getElementById('compose-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var kind = document.getElementById('c-source-kind').value;
    var source = kind === 'operator'
      ? { kind: 'operator', basis: document.getElementById('c-basis').value.trim() }
      : { kind: 'conversation', ref: document.getElementById('c-ref').value.trim() };
    var tags = document.getElementById('c-tags').value.split(/[,，]/).map(function (tag) { return tag.trim(); }).filter(Boolean);
    var body = {
      subjectType: document.getElementById('c-subject').value,
      subjectId: document.getElementById('c-subject-id').value.trim(),
      subjectLabel: document.getElementById('c-subject-label').value.trim() || undefined,
      factKey: document.getElementById('c-fact-key').value.trim(),
      kind: document.getElementById('c-kind').value,
      statement: document.getElementById('c-statement').value.trim(),
      confidence: document.getElementById('c-confidence').value || undefined,
      source: source,
      tags: tags,
      requestId: crypto.randomUUID()
    };
    api('/api/business-memory/records', { method: 'POST', body: JSON.stringify(body) }).then(function () {
      document.getElementById('compose').close();
      document.getElementById('compose-form').reset();
      toast('已提交，等待人工审核');
      return loadAll();
    }).catch(function (error) { toast(error.message, true); });
  });

  renderSubjects();
  loadAll();
})();
</script>
</body>
</html>`;

export const AREA_PATH = '/business-memory';

export function renderAreaPage() {
  return new Response(PAGE, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(Buffer.byteLength(PAGE, 'utf8')),
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}
