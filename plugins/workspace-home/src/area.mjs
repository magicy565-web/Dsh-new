// Self-contained front door. Strict CSP, no external assets.
export const HOME_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>工作台</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in oklab, CanvasText 16%, transparent); --muted: color-mix(in oklab, CanvasText 55%, transparent); --accent: #2563eb; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; font: 14px/1.6 ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; background: Canvas; color: CanvasText; display: grid; place-items: center; padding: 24px; }
  main { width: min(860px, 100%); }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .lead { color: var(--muted); margin: 0 0 22px; font-size: 13px; }
  .cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
  a.card { display: block; border: 1px solid var(--line); border-radius: 14px; padding: 16px; text-decoration: none; color: inherit; transition: border-color .15s ease; }
  a.card:hover { border-color: var(--accent); }
  a.card b { display: block; font-size: 15px; margin-bottom: 4px; }
  a.card span { color: var(--muted); font-size: 12px; }
  .strip { margin-top: 22px; color: var(--muted); font-size: 12px; }
  .strip b { color: CanvasText; font-variant-numeric: tabular-nums; }
</style></head>
<body>
<main>
  <h1>工作台</h1>
  <p class="lead">对话、目标、计划与运维都在同一个进程里；身份来自会话，写入需要人工批准。</p>
  <div class="cards">
    <a class="card" href="/chat"><b>对话</b><span>提问、附加文件、审批工具调用、接收产物</span></a>
    <a class="card" href="/goals"><b>目标</b><span>把多次运行聚合成一个可推进的目标</span></a>
    <a class="card" href="/schedules"><b>计划任务</b><span>到期自动派发；启用前默认停用</span></a>
    <a class="card" href="/products"><b>产品库</b><span>已审核的 Product Context；未配置源时明确提示</span></a>
    <a class="card" href="/quotes"><b>报价单</b><span>服务端算总额、状态可追踪；模型创建需人工批准</span></a>
    <a class="card" href="/purchases"><b>采购单</b><span>批准仅限管理员；模型只能起草，不能自己批准</span></a>
    <a class="card" href="/files"><b>文件</b><span>上传、搜索、预览与下载；二进制也能存</span></a>
    <a class="card" href="/inbox"><b>收件箱</b><span>计划触发与待批准，集中查看与标记已读</span></a>
    <a class="card" href="/business-memory"><b>经营记忆</b><span>事实与观察的提出、审核与撤回</span></a>
    <a class="card" href="/market"><b>市场</b><span>工作电脑与市场机会的只读视图</span></a>
    <a class="card" href="/sessions"><b>会话</b><span>谁登录着；管理员可强制下线</span></a>
    <a class="card" href="/ops"><b>运维台</b><span>状态、计数、备份与恢复（管理员）</span></a>
  </div>
  <div class="strip" id="strip">正在读取状态…</div>
</main>
<script>
(function () {
  var strip = document.getElementById('strip');
  function text(value) { return String(value === undefined ? 0 : value); }
  var parts = [];
  fetch('/api/chat/status', { cache: 'no-store' })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (data) {
      if (data) parts.push('会话 <b>' + text(data.conversations) + '</b>');
    })
    .catch(function () {})
    .then(function () {
      return fetch('/api/ops/status', { cache: 'no-store' })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (data) {
          if (data && data.storage) {
            var counts = data.storage.counts || {};
            parts.push('运行 <b>' + text(counts.runs) + '</b>', '目标 <b>' + text(counts.goals) + '</b>',
              '计划 <b>' + text(counts.schedules) + '</b>', '未读 <b>' + text(counts.inbox) + '</b>');
          }
        })
        .catch(function () {});
    })
    .then(function () {
      strip.innerHTML = parts.length ? parts.join(' · ') : '暂无统计（需要管理员会话）';
    });
}());
</script>
</body></html>`;
