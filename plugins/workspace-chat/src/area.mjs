// Self-contained chat area page: strict CSP, no external resources, no build.
// It talks only to this plugin's own JSON and SSE routes.

export const AREA_PATH = '/chat';

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>工作台 · 对话</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --panel:#fff; --line:#e3e6ea; --ink:#1c2024; --muted:#6b7280; --accent:#2563eb; --warn:#b45309; --bad:#b91c1c; --ok:#15803d; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1115; --panel:#161a20; --line:#252b33; --ink:#e7eaee; --muted:#98a2b3; --accent:#60a5fa; --warn:#f59e0b; --bad:#f87171; --ok:#4ade80; } }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { background: var(--bg); color: var(--ink); font: 14px/1.55 ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; }
  .app { display: grid; grid-template-columns: 260px 1fr; height: 100%; }
  aside { border-right: 1px solid var(--line); background: var(--panel); display: flex; flex-direction: column; min-height: 0; }
  aside header { padding: 14px 14px 10px; display: flex; gap: 8px; align-items: center; border-bottom: 1px solid var(--line); }
  aside header strong { font-size: 13px; letter-spacing: .02em; }
  #new { margin-left: auto; }
  button { font: inherit; border: 1px solid var(--line); background: var(--panel); color: var(--ink); border-radius: 8px; padding: 6px 10px; cursor: pointer; }
  button:hover { border-color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button:disabled { opacity: .5; cursor: default; }
  #list { list-style: none; margin: 0; padding: 8px; overflow: auto; flex: 1; }
  #list li { padding: 9px 10px; border-radius: 8px; cursor: pointer; color: var(--muted); display: flex; gap: 8px; align-items: baseline; }
  #list li:hover { background: color-mix(in oklab, var(--accent) 8%, transparent); }
  #list li.active { background: color-mix(in oklab, var(--accent) 14%, transparent); color: var(--ink); }
  #list li span.title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #list li span.count { margin-left: auto; font-size: 11px; opacity: .7; }
  main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  main header { padding: 12px 18px; border-bottom: 1px solid var(--line); display: flex; gap: 10px; align-items: center; background: var(--panel); }
  #title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #state { margin-left: auto; font-size: 12px; color: var(--muted); }
  #state.run { color: var(--accent); }
  #state.ok { color: var(--ok); }
  #state.bad { color: var(--bad); }
  #messages { flex: 1; overflow: auto; padding: 18px; display: flex; flex-direction: column; gap: 12px; }
  .empty { margin: auto; color: var(--muted); text-align: center; }
  .row { display: flex; }
  .row.user { justify-content: flex-end; }
  .bubble { max-width: min(720px, 82%); padding: 10px 13px; border-radius: 12px; white-space: pre-wrap; word-break: break-word; border: 1px solid var(--line); background: var(--panel); }
  .row.user .bubble { background: color-mix(in oklab, var(--accent) 12%, var(--panel)); border-color: color-mix(in oklab, var(--accent) 30%, var(--line)); }
  .bubble.pending::after { content: "▍"; opacity: .6; animation: blink 1s steps(2) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  .meta { font-size: 11px; color: var(--muted); margin: 2px 4px 0; }
  form { display: flex; gap: 10px; padding: 12px 18px 16px; border-top: 1px solid var(--line); background: var(--panel); }
  textarea { flex: 1; resize: none; min-height: 44px; max-height: 160px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; font: inherit; background: var(--bg); color: var(--ink); }
  textarea:focus { outline: 2px solid color-mix(in oklab, var(--accent) 45%, transparent); outline-offset: 1px; }
  .hint { padding: 0 18px 12px; font-size: 12px; color: var(--muted); }
  #approvals { display: flex; flex-direction: column; gap: 8px; padding: 12px 18px 0; }
  .approval { border: 1px solid color-mix(in oklab, var(--warn) 45%, var(--line)); background: color-mix(in oklab, var(--warn) 8%, var(--panel)); border-radius: 10px; padding: 10px 12px; }
  .approval .head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .approval .action { font-weight: 600; }
  .approval .resource { color: var(--muted); font-size: 12px; word-break: break-all; }
  .approval pre { margin: 8px 0; padding: 8px; background: var(--bg); border-radius: 8px; overflow: auto; max-height: 140px; font-size: 12px; }
  .approval .actions { display: flex; gap: 8px; }
</style>
</head>
<body>
<div class="app">
  <aside>
    <header><strong>对话</strong><button id="new" title="新建会话">新会话</button></header>
    <ul id="list"></ul>
  </aside>
  <main>
    <header><div id="title">未选择会话</div><div id="state"></div><button id="stop" hidden>停止</button></header>
    <div id="messages"><div class="empty">左侧新建或选择一个会话开始。</div></div>
    <div id="approvals"></div>
    <form id="composer">
      <textarea id="input" placeholder="输入消息，Enter 发送，Shift+Enter 换行" rows="2"></textarea>
      <button class="primary" id="send" type="submit">发送</button>
    </form>
    <div class="hint" id="hint"></div>
  </main>
</div>
<script>
(function () {
  'use strict';
  var state = { conversationId: null, runId: null, source: null, lastSeq: 0, assistant: null, retries: 0 };
  var list = document.getElementById('list');
  var messages = document.getElementById('messages');
  var title = document.getElementById('title');
  var stateEl = document.getElementById('state');
  var stop = document.getElementById('stop');
  var input = document.getElementById('input');
  var send = document.getElementById('send');

  function api(path, options) {
    return fetch(path, Object.assign({ cache: 'no-store' }, options || {})).then(function (response) {
      return response.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (error) { body = null; }
        if (!response.ok) {
          var code = body && body.error && body.error.code ? body.error.code : ('HTTP ' + response.status);
          throw new Error(code);
        }
        return body;
      });
    });
  }
  function setState(text, kind) { stateEl.textContent = text || ''; stateEl.className = kind || ''; }
  function el(tag, cls, text) { var node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; }
  function scroll() { messages.scrollTop = messages.scrollHeight; }
  function setBusy(busy) { send.disabled = busy; input.disabled = busy; }

  var approvalsEl = document.getElementById('approvals');
  function renderApprovals(items) {
    approvalsEl.textContent = '';
    items.forEach(function (item) {
      var card = el('div', 'approval');
      var head = el('div', 'head');
      head.appendChild(el('span', 'action', item.action));
      head.appendChild(el('span', 'resource', item.resource));
      card.appendChild(head);
      card.appendChild(el('pre', '', JSON.stringify(item.payload || {}, null, 2)));
      var actions = el('div', 'actions');
      var ok = el('button', 'primary', '批准');
      var no = el('button', '', '拒绝');
      ok.addEventListener('click', function () { decide(item.id, 'approve'); });
      no.addEventListener('click', function () { decide(item.id, 'deny'); });
      actions.appendChild(ok);
      actions.appendChild(no);
      card.appendChild(actions);
      approvalsEl.appendChild(card);
    });
  }
  function loadApprovals() {
    if (!state.conversationId) { approvalsEl.textContent = ''; return Promise.resolve(); }
    return api('/api/chat/conversations/' + encodeURIComponent(state.conversationId) + '/approvals?status=pending')
      .then(function (data) { renderApprovals(data.items || []); })
      .catch(function () { approvalsEl.textContent = ''; });
  }
  function decide(id, decision) {
    api('/api/chat/approvals/' + encodeURIComponent(id), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: decision }),
    }).then(function () {
      setState(decision === 'approve' ? '已批准，继续执行…' : '已拒绝', decision === 'approve' ? 'run' : 'bad');
      return loadApprovals();
    }).catch(function (error) { setState('审批失败：' + error.message, 'bad'); });
  }

  function renderConversations(items) {
    list.textContent = '';
    if (!items.length) { var empty = el('li', '', '还没有会话'); empty.style.cursor = 'default'; list.appendChild(empty); return; }
    items.forEach(function (item) {
      var li = el('li', item.id === state.conversationId ? 'active' : '');
      li.appendChild(el('span', 'title', item.title || '未命名'));
      li.appendChild(el('span', 'count', String(item.messageCount || 0)));
      li.addEventListener('click', function () { open(item.id); });
      list.appendChild(li);
    });
  }

  function loadConversations() {
    return api('/api/chat/conversations?status=all&limit=100').then(function (data) { renderConversations(data.items || []); });
  }

  function bubble(role, text) {
    var row = el('div', 'row ' + role);
    var node = el('div', 'bubble', text || '');
    row.appendChild(node);
    messages.appendChild(row);
    scroll();
    return node;
  }

  function renderMessages(items) {
    messages.textContent = '';
    if (!items.length) { messages.appendChild(el('div', 'empty', '这个会话还没有消息。')); return; }
    items.forEach(function (message) { bubble(message.role === 'user' ? 'user' : 'assistant', message.content); });
  }

  function stopStream() { if (state.source) { try { state.source.close(); } catch (error) {} state.source = null; } }

  function finish(text, kind, code) {
    stopStream();
    setBusy(false);
    stop.hidden = true;
    if (state.assistant) state.assistant.classList.remove('pending');
    if (text) setState(text, kind);
    if (code) document.getElementById('hint').textContent = code === 'LLM_NOT_CONFIGURED'
      ? '未配置模型：在启动 Harness 前设置 DEEPSEEK_API_KEY，并向 llm-bridge 打开 enabled: true。'
      : '错误码：' + code;
  }

  function follow(runId) {
    stopStream();
    state.runId = runId;
    state.lastSeq = 0;
    state.retries = 0;
    stop.hidden = false;
    setBusy(true);
    setState('准备中…', 'run');
    var source = new EventSource('/api/chat/runs/' + encodeURIComponent(runId) + '/events?after=0');
    state.source = source;

    function onEvent(event) {
      if (event.lastEventId) state.lastSeq = Number(event.lastEventId) || state.lastSeq;
      var data = null;
      try { data = JSON.parse(event.data); } catch (error) { return; }
      if (event.type === 'run.prepared') setState('准备中…', 'run');
      else if (event.type === 'run.running') setState('生成中…', 'run');
      else if (event.type === 'run.delta') {
        if (!state.assistant) state.assistant = bubble('assistant', '');
        state.assistant.textContent += (data.data && data.data.text) || '';
        scroll();
      } else if (event.type === 'run.memory_unavailable') {
        document.getElementById('hint').textContent = '记忆读取失败，本次回答未使用企业记忆。';
      } else if (event.type === 'run.approval_requested') {
        setState('等待批准', 'run');
        loadApprovals();
      } else if (event.type === 'run.approval_decided') {
        loadApprovals();
        setState(data.data && data.data.approved ? '已批准，继续执行…' : '已拒绝', data.data && data.data.approved ? 'run' : 'bad');
      } else if (event.type === 'run.completed') {
        finish('已完成', 'ok');
      } else if (event.type === 'run.failed') {
        finish('失败', 'bad', data.data && data.data.code);
      } else if (event.type === 'run.cancelled') {
        finish('已停止', '');
      }
    }

    ['run.prepared', 'run.running', 'run.delta', 'run.memory_unavailable', 'run.approval_requested', 'run.approval_decided', 'run.completed', 'run.failed', 'run.cancelled']
      .forEach(function (name) { source.addEventListener(name, onEvent); });

    source.addEventListener('error', function () {
      if (!state.runId) return;
      if (state.retries >= 2) { finish('连接中断', 'bad'); return; }
      state.retries += 1;
      stopStream();
      var resume = new EventSource('/api/chat/runs/' + encodeURIComponent(runId) + '/events?after=' + state.lastSeq);
      state.source = resume;
      ['run.prepared', 'run.running', 'run.delta', 'run.memory_unavailable', 'run.approval_requested', 'run.approval_decided', 'run.completed', 'run.failed', 'run.cancelled']
        .forEach(function (name) { resume.addEventListener(name, onEvent); });
      resume.addEventListener('error', function () { if (state.retries >= 2) finish('连接中断', 'bad'); });
    });
  }

  function open(id) {
    stopStream();
    state.conversationId = id;
    state.runId = null;
    state.assistant = null;
    setState('');
    document.getElementById('hint').textContent = '';
    stop.hidden = true;
    setBusy(false);
    return api('/api/chat/conversations/' + encodeURIComponent(id)).then(function (data) {
      title.textContent = data.conversation.title || '未命名';
      renderMessages(data.messages || []);
      loadApprovals();
      if (data.conversation.lastRunId) {
        return api('/api/chat/runs/' + encodeURIComponent(data.conversation.lastRunId)).then(function (result) {
          if (result && result.run && !result.run.terminal) {
            state.assistant = null;
            follow(result.run.id);
          } else if (result && result.run && result.run.status === 'failed') {
            setState('上次运行失败' + (result.run.error ? '：' + result.run.error.code : ''), 'bad');
          }
        });
      }
      return loadConversations();
    }).then(loadConversations);
  }

  function create() {
    return api('/api/chat/conversations', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: crypto.randomUUID(), title: '新会话' }),
    }).then(function (data) { return open(data.conversation.id); });
  }

  function sendMessage(text) {
    if (!state.conversationId) return create().then(function () { return sendMessage(text); });
    var content = text.trim();
    if (!content) return undefined;
    input.value = '';
    bubble('user', content);
    state.assistant = bubble('assistant', '');
    state.assistant.classList.add('pending');
    return api('/api/chat/conversations/' + encodeURIComponent(state.conversationId) + '/messages', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: crypto.randomUUID(), content: content }),
    }).then(function (data) {
      follow(data.run.id);
      return loadConversations();
    }).catch(function (error) {
      finish('发送失败', 'bad', error.message);
      state.assistant.classList.remove('pending');
      state.assistant.textContent = '发送失败：' + error.message;
    });
  }

  document.getElementById('new').addEventListener('click', function () { create().catch(function (error) { setState('新建失败：' + error.message, 'bad'); }); });
  document.getElementById('composer').addEventListener('submit', function (event) {
    event.preventDefault();
    var text = input.value;
    if (!text.trim()) return;
    sendMessage(text);
  });
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); document.getElementById('composer').requestSubmit(); }
  });
  stop.addEventListener('click', function () {
    if (!state.runId) return;
    api('/api/chat/runs/' + encodeURIComponent(state.runId) + '/cancel', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'operator' }),
    }).catch(function (error) { setState('取消失败：' + error.message, 'bad'); });
  });

  loadConversations().catch(function (error) { setState('加载失败：' + error.message, 'bad'); });
}());
</script>
</body>
</html>`;

export function renderChatPage() {
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
