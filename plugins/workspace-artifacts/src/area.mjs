// Self-contained files page. Strict CSP, no external assets.
export const FILES_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>文件 · 工作台</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in oklab, CanvasText 16%, transparent); --muted: color-mix(in oklab, CanvasText 55%, transparent); --accent: #2563eb; --ok: #16a34a; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.6 ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; background: Canvas; color: CanvasText; }
  header { display: flex; gap: 14px; align-items: baseline; padding: 14px 20px; border-bottom: 1px solid var(--line); }
  header h1 { font-size: 16px; margin: 0; }
  header a { color: var(--muted); text-decoration: none; font-size: 13px; }
  header a:hover { color: var(--accent); }
  main { max-width: 960px; margin: 0 auto; padding: 18px 20px 60px; }
  .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; }
  input[type=search] { flex: 1; font: inherit; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line); background: Field; color: FieldText; }
  button { font: inherit; font-size: 12px; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
  button:hover { border-color: var(--accent); color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .file { display: flex; gap: 12px; align-items: baseline; padding: 10px 8px; border-bottom: 1px dashed var(--line); }
  .file .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file .meta { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .file a.dl { font-size: 12px; color: var(--accent); text-decoration: none; }
  .empty { color: var(--muted); text-align: center; padding: 30px 0; }
  #msg { min-height: 18px; font-size: 12px; color: var(--muted); margin-top: 8px; }
  pre { background: color-mix(in oklab, CanvasText 5%, transparent); border: 1px solid var(--line); border-radius: 10px; padding: 12px; overflow: auto; max-height: 320px; font-size: 12px; }
</style></head>
<body>
<header>
  <h1>文件</h1>
  <a href="/home">首页</a>
  <a href="/chat">对话</a>
  <a href="/products">产品库</a>
  <a href="/ops">运维</a>
</header>
<main>
  <div class="bar">
    <input id="q" type="search" placeholder="按文件名搜索" maxlength="200">
    <input id="file" type="file" hidden>
    <button id="upload">上传文件</button>
  </div>
  <div id="list"></div>
  <div id="msg"></div>
  <div id="preview"></div>
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
  var list = document.getElementById('list');
  var msg = document.getElementById('msg');
  var preview = document.getElementById('preview');
  function note(text, bad) { msg.textContent = text || ''; msg.style.color = bad ? '#b45309' : 'var(--muted)'; }
  function size(bytes) { if (bytes < 1024) return bytes + ' B'; if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KiB'; return (bytes / 1024 / 1024).toFixed(1) + ' MiB'; }
  var TEXT_TYPES = ['text/plain', 'text/markdown', 'text/csv', 'application/json'];

  function render(items) {
    list.textContent = '';
    preview.textContent = '';
    if (!items.length) { list.appendChild(el('p', 'empty', '还没有文件')); return; }
    items.forEach(function (artifact) {
      var row = el('div', 'file');
      var name = el('span', 'name', artifact.filename);
      name.title = artifact.title || artifact.filename;
      row.appendChild(name);
      row.appendChild(el('span', 'meta', (artifact.mimeType || '') + ' · ' + size(artifact.size || 0)));
      if (TEXT_TYPES.indexOf(artifact.mimeType) >= 0) {
        var view = el('button', '', '预览');
        view.addEventListener('click', function () {
          api('/api/artifacts/' + encodeURIComponent(artifact.id) + '/content').then(function (data) {
            preview.textContent = '';
            preview.appendChild(el('h2', '', data.artifact.filename));
            preview.appendChild(el('pre', '', data.content));
          }).catch(function (error) { note('预览失败：' + error.message, true); });
        });
        row.appendChild(view);
      }
      var download = el('a', 'dl', '下载');
      download.href = '/api/artifacts/' + encodeURIComponent(artifact.id) + '/download';
      row.appendChild(download);
      list.appendChild(row);
    });
  }

  function load(q) {
    note('');
    return api('/api/artifacts' + (q ? '?q=' + encodeURIComponent(q) : '')).then(function (data) {
      render((data.artifacts || data.items || []));
    }).catch(function (error) {
      if (error.status === 401) { location.assign('/login'); return; }
      note('加载失败：' + error.message, true);
    });
  }

  document.getElementById('q').addEventListener('input', function (event) {
    clearTimeout(window.__filesTimer);
    window.__filesTimer = setTimeout(function () { load(event.target.value.trim()); }, 200);
  });
  document.getElementById('upload').addEventListener('click', function () {
    var input = document.getElementById('file');
    input.value = '';
    input.click();
  });
  document.getElementById('file').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    var type = file.type || '';
    var lower = String(file.name || '').toLowerCase();
    var textLike = type.indexOf('text/') === 0 || type === 'application/json'
      || ['.txt', '.md', '.csv', '.json'].some(function (suffix) { return lower.endsWith(suffix); });
    var reader = new FileReader();
    reader.onload = function () {
      var payload = { filename: file.name, mimeType: file.type || (textLike ? 'text/plain' : 'application/octet-stream') };
      if (textLike) payload.content = String(reader.result);
      else payload.base64 = btoa(new Uint8Array(reader.result).reduce(function (text, byte) { return text + String.fromCharCode(byte); }, ''));
      api('/api/artifacts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function () { note('已上传 ' + file.name); return load(document.getElementById('q').value.trim()); })
        .catch(function (error) { note('上传失败：' + error.message, true); });
    };
    if (textLike) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });

  load('');
}());
</script>
</body></html>`;
