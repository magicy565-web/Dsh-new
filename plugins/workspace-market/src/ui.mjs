// Muse 品牌的市场页面（无构建步骤，由 harness 直接返回）。
// 页面只读本插件的真实 /api/market/*：未接入就写未接入，演示目录只在组合显式
// demo: true 时出现，评分位一律「还没有评价」，电脑画面在 runtime=off 时是空的。

export const UI_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>Muse · AI Worker 市场</title>
<link rel="stylesheet" href="/market/app.css" />
</head>
<body>
<div id="app" class="muse-app" aria-busy="true">
  <noscript>需要启用 JavaScript 才能查看 Muse AI Worker 市场。</noscript>
</div>
<script src="/market/app.js" defer></script>
</body>
</html>
`;

export const UI_CSS = `:root{
  --muse-ink:#141b29; --muse-ink-2:#24324a; --muse-blue:#2459ea;
  --muse-bg:#f5f6f3; --muse-card:#ffffff; --muse-line:#e4e7ec; --muse-line-2:#d3d8e0;
  --muse-muted:#5f6b7a; --muse-wash:#eef1f6; --muse-warn:#956224; --muse-success:#28725b;
  --muse-danger:#a64334; --muse-radius:12px; --muse-max:1180px;
  --muse-font:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;
}
@media (prefers-color-scheme: dark){
  :root{--muse-ink:#e8ecf1;--muse-ink-2:#c3ccda;--muse-bg:#11151b;--muse-card:#181d25;--muse-line:#2a3140;--muse-line-2:#39425300;--muse-muted:#98a3b3;--muse-wash:#1e242e}
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--muse-bg);color:var(--muse-ink)}
body{font-family:var(--muse-font);font-size:13px;line-height:1.55;-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit;border:0;background:none;cursor:pointer}
a{color:inherit}
.muse-app{min-height:100vh}
.muse-app :focus-visible{outline:2px solid var(--muse-blue);outline-offset:2px}
.wrap{max-width:var(--muse-max);margin:0 auto;padding:22px clamp(14px,3vw,40px) 48px}
.brand{display:flex;align-items:center;gap:9px;min-height:40px}
.orbit-tile{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:var(--muse-ink);flex:none}
.brand-copy{display:flex;flex-direction:column;line-height:1.1}
.brand-copy b{font-family:Montserrat,var(--muse-font);font-size:14px;font-weight:600;letter-spacing:.08em}
.brand-copy span{font-size:10px;color:var(--muse-muted);margin-top:2px}
.masthead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px}
.masthead-meta{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muse-muted);min-height:30px}
.pill{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border:1px solid var(--muse-line);border-radius:999px;background:var(--muse-card);font-size:10.5px;color:var(--muse-muted);white-space:nowrap}
.pill i{width:6px;height:6px;border-radius:50%;background:var(--muse-success);flex:none}
.pill.warn i{background:var(--muse-warn)}
.hero{padding:6px 0 18px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;margin:0;font-size:10px;font-weight:600;letter-spacing:.16em;color:var(--muse-muted)}
.eyebrow i{width:6px;height:6px;border-radius:50%;background:var(--muse-blue);box-shadow:0 0 0 4px rgba(36,89,234,.14);flex:none}
.hero h1{margin:10px 0 8px;font-size:clamp(25px,3vw,32px);font-weight:650;letter-spacing:-.03em;line-height:1.2}
.hero p{margin:0;max-width:40em;color:var(--muse-muted);font-size:13px;line-height:1.7}
.banner{display:flex;align-items:flex-start;gap:8px;margin:0 0 14px;padding:9px 12px;border:1px solid var(--muse-line);border-radius:10px;background:var(--muse-card);font-size:11.5px;line-height:1.65;color:var(--muse-muted)}
.banner i{width:6px;height:6px;border-radius:50%;background:var(--muse-warn);flex:none;margin-top:6px}
.banner.error{border-color:color-mix(in srgb,var(--muse-danger) 28%,var(--muse-line));color:var(--muse-danger)}
.banner.error i{background:var(--muse-danger)}
.banner button{margin-left:auto;color:var(--muse-ink);font-size:11px;text-decoration:underline;text-underline-offset:2px;white-space:nowrap}
.tabs{display:flex;align-items:center;gap:2px;border-bottom:1px solid var(--muse-line);margin:0 0 16px}
.tab{position:relative;display:inline-flex;align-items:center;gap:7px;min-height:40px;padding:0 12px;font-size:12.5px;color:var(--muse-muted);border-radius:8px 8px 0 0}
.tab:hover{color:var(--muse-ink);background:var(--muse-wash)}
.tab[aria-selected="true"]{color:var(--muse-ink);font-weight:600}
.tab[aria-selected="true"]:after{content:"";position:absolute;left:10px;right:10px;bottom:-1px;height:2px;border-radius:2px;background:var(--muse-blue)}
.count{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:16px;padding:0 5px;border-radius:8px;background:var(--muse-wash);font-size:10px;font-variant-numeric:tabular-nums;color:var(--muse-muted)}
.toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:16px}
.search{flex:1 1 240px;display:flex;align-items:center;gap:8px;min-height:38px;padding:0 11px;border:1px solid var(--muse-line);border-radius:10px;background:var(--muse-card);color:var(--muse-muted)}
.search:focus-within{border-color:var(--muse-blue);box-shadow:0 0 0 3px rgba(36,89,234,.13)}
.search input{flex:1;min-width:0;height:36px;border:0;outline:0;background:transparent;color:var(--muse-ink);font-size:13px}
.cats{display:flex;flex-wrap:wrap;gap:5px}
.cat{min-height:30px;padding:0 10px;border:1px solid var(--muse-line);border-radius:8px;font-size:11.5px;color:var(--muse-muted)}
.cat:hover{background:var(--muse-wash);color:var(--muse-ink)}
.cat.is-on{background:var(--muse-wash);border-color:var(--muse-line-2);color:var(--muse-ink);font-weight:600}
.section{margin:0 0 18px}
.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:0 0 9px}
.section-head h2{margin:0;font-size:13.5px;font-weight:600;letter-spacing:-.01em}
.section-head p{margin:0;font-size:10.5px;color:var(--muse-muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:10px}
.card{display:flex;flex-direction:column;min-height:190px;padding:13px;border:1px solid var(--muse-line);border-radius:var(--muse-radius);background:var(--muse-card);text-align:left;transition:border-color .16s,box-shadow .16s,transform .16s}
.card:hover{border-color:var(--muse-line-2);box-shadow:0 8px 22px rgba(16,24,20,.06);transform:translateY(-1px)}
.card[data-featured="true"]{box-shadow:inset 0 0 0 1px rgba(36,89,234,.26)}
.card-top{display:flex;align-items:flex-start;gap:9px}
.cover{display:grid;place-items:center;width:36px;height:36px;flex:none;border-radius:10px;color:#fff;font-size:13px;font-weight:650;background:linear-gradient(145deg,#3c516b,#141b29)}
.cover[data-design="ledger"]{background:linear-gradient(145deg,#6b7f6d,#2f4636)}
.cover[data-design="harbor"]{background:linear-gradient(145deg,#7d6a8e,#3f3352)}
.card-head{display:flex;flex-direction:column;min-width:0;flex:1}
.kicker{display:block;font-size:9.5px;letter-spacing:.1em;color:var(--muse-muted);margin-bottom:2px}
.name{display:block;font-size:13.5px;font-weight:600;line-height:1.35}
.summary{display:-webkit-box;margin-top:7px;font-size:11.5px;line-height:1.6;color:var(--muse-muted);-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ownerline{display:flex;align-items:center;gap:6px;margin-top:9px;font-size:10.5px;color:var(--muse-muted);min-width:0}
.avatar{display:grid;place-items:center;width:18px;height:18px;flex:none;border-radius:50%;font-size:8.5px;font-weight:650;color:#fff;background:linear-gradient(145deg,#3c516b,#141b29)}
.avatar[data-design="ledger"]{background:linear-gradient(145deg,#6b7f6d,#2f4636)}
.avatar[data-design="harbor"]{background:linear-gradient(145deg,#7d6a8e,#3f3352)}
.ownerline strong{color:var(--muse-ink);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:auto;padding-top:9px;font-size:10.5px;color:var(--muse-muted);font-variant-numeric:tabular-nums}
.meta b{font-weight:600;color:var(--muse-ink)}
.badge{position:absolute;top:11px;right:11px;padding:2px 6px;border-radius:5px;border:1px solid rgba(36,89,234,.22);background:rgba(36,89,234,.1);color:var(--muse-blue);font-size:9px;letter-spacing:.06em}
.card{position:relative}
.empty{display:grid;justify-items:center;gap:6px;padding:42px 18px;border:1px dashed var(--muse-line-2);border-radius:var(--muse-radius);background:var(--muse-card);text-align:center;color:var(--muse-muted)}
.empty b{font-size:13px;color:var(--muse-ink);font-weight:600}
.empty span{font-size:11.5px;max-width:38em;line-height:1.65}
.scheme{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:20px;align-items:start}
.scheme-main{min-width:0}
.scheme-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding-bottom:11px;border-bottom:1px solid var(--muse-line)}
.scheme-head h1{margin:4px 0 0;font-size:23px;font-weight:650;letter-spacing:-.02em;line-height:1.25}
.scheme-meta{margin:0;font-size:10.5px;letter-spacing:.05em;color:var(--muse-muted)}
.anchors{display:flex;flex-wrap:wrap;gap:11px;padding:9px 0 2px;font-size:11px}
.anchors a{color:var(--muse-muted);text-decoration:none;border-bottom:1px solid transparent}
.anchors a:hover{color:var(--muse-ink);border-color:var(--muse-line-2)}
.block{padding:13px 0;border-bottom:1px solid var(--muse-line)}
.block h3{margin:0 0 7px;font-size:11.5px;font-weight:600;letter-spacing:.03em;color:var(--muse-muted)}
.block p{margin:0 0 6px;font-size:12.5px;line-height:1.7}
.block ul{margin:5px 0 0;padding:0;list-style:none;display:grid;gap:6px}
.block li{font-size:12.5px;line-height:1.65}
.owner-card{display:flex;gap:9px;align-items:flex-start}
.owner-card .avatar{width:32px;height:32px;flex:none;border-radius:9px;font-size:12px}
.owner-card strong{display:block;font-size:12.5px;font-weight:600}
.owner-card small{display:block;font-size:10.5px;color:var(--muse-muted);margin-bottom:2px}
.owner-card p{margin:2px 0 0;font-size:11.5px;color:var(--muse-muted);line-height:1.6}
.cta{position:sticky;top:12px;border:1px solid var(--muse-line);border-radius:14px;background:var(--muse-card);padding:15px}
.cta h2{margin:0;font-size:16px;font-weight:650;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.cta .price-type{margin:2px 0 11px;font-size:10.5px;letter-spacing:.05em;color:var(--muse-muted)}
.field{display:grid;gap:5px;margin-bottom:10px}
.field>span{font-size:10.5px;color:var(--muse-muted)}
.field input{width:100%;min-height:34px;padding:6px 9px;border:1px solid var(--muse-line);border-radius:8px;background:var(--muse-bg);color:var(--muse-ink);font-size:12.5px;outline:0}
.field input:focus{border-color:var(--muse-blue);box-shadow:0 0 0 3px rgba(36,89,234,.13)}
.scales{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px}
.scale{display:inline-flex;align-items:center;gap:5px;min-height:30px;padding:0 9px;border:1px solid var(--muse-line);border-radius:8px;font-size:11px;color:var(--muse-muted);cursor:pointer}
.scale input{position:absolute;opacity:0;pointer-events:none}
.scale:has(input:checked){background:var(--muse-wash);border-color:var(--muse-line-2);color:var(--muse-ink);font-weight:600}
.checks{display:grid;gap:5px;margin:0 0 10px;padding:0;border:0}
.checks legend{padding:0;margin-bottom:5px;font-size:10.5px;color:var(--muse-muted)}
.checks label{display:flex;align-items:center;gap:6px;font-size:11.5px;cursor:pointer}
.checks input{accent-color:var(--muse-blue);width:14px;height:14px;margin:0}
.primary{display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:38px;padding:0 14px;border-radius:9px;background:var(--muse-ink);color:var(--muse-bg);font-size:12.5px;font-weight:600}
.primary:hover{opacity:.9}
.primary[disabled]{opacity:.55;cursor:not-allowed}
.secondary{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:0 11px;border:1px solid var(--muse-line);border-radius:8px;font-size:11.5px;font-weight:500}
.secondary:hover{background:var(--muse-wash)}
.ghost{display:inline-flex;align-items:center;gap:5px;min-height:30px;padding:0 7px;border-radius:7px;font-size:11px;color:var(--muse-muted)}
.ghost:hover{background:var(--muse-wash);color:var(--muse-ink)}
.hint{margin:9px 0 0;font-size:10.5px;line-height:1.65;color:var(--muse-muted)}
.table{margin:0 0 18px}
.table-head,.table button{display:grid;grid-template-columns:minmax(0,1.4fr) 64px 84px 54px 70px;gap:8px;align-items:center;width:100%;text-align:left}
.table-head{padding:0 9px 5px;font-size:10px;letter-spacing:.05em;color:var(--muse-muted)}
.table ul{margin:0;padding:0;list-style:none;border-top:1px solid var(--muse-line)}
.table button{padding:9px;font-size:11.5px;border-bottom:1px solid var(--muse-line)}
.table button:hover{background:var(--muse-wash)}
.table strong{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.num{font-variant-numeric:tabular-nums}
.desk{margin:0 0 18px}
.pcs{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.pc{display:flex;flex-direction:column;border:1px solid var(--muse-line);border-radius:12px;background:var(--muse-card);overflow:hidden}
.pc-screen{position:relative;display:grid;place-items:center;aspect-ratio:16/9;border-bottom:1px solid var(--muse-line);background:radial-gradient(circle at 50% 42%,var(--muse-wash) 0,var(--muse-card) 62%,var(--muse-wash) 100%)}
.pc-screen:after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 120%,rgba(20,27,41,.1),transparent 62%)}
.pc-tag{position:absolute;left:8px;top:8px;padding:2px 6px;border:1px solid var(--muse-line);border-radius:5px;background:var(--muse-card);font-size:9px;color:var(--muse-muted)}
.pc-screen-copy{position:relative;display:grid;justify-items:center;gap:3px;color:var(--muse-muted);text-align:center;padding:0 10px}
.pc-screen-copy b{font-size:11px;color:var(--muse-ink);font-weight:600}
.pc-screen-copy span{font-size:9.5px}
.pc-body{display:flex;flex-direction:column;gap:7px;padding:10px 11px 11px}
.pc-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.pc-name{font-size:12px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.state{display:inline-flex;align-items:center;gap:5px;padding:2px 7px;border-radius:999px;background:var(--muse-wash);font-size:9.5px;font-weight:600;color:var(--muse-muted);white-space:nowrap}
.state i{width:6px;height:6px;border-radius:50%;background:var(--muse-muted);flex:none}
.state[data-state="booting"] i,.state[data-state="running"] i{background:var(--muse-blue)}
.state[data-state="needs_you"] i{background:var(--muse-warn)}
.state[data-state="done"] i{background:var(--muse-success)}
.pc-task{margin:0;font-size:10.5px;line-height:1.6;color:var(--muse-muted);min-height:17px}
.pc-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding-top:8px;border-top:1px solid var(--muse-line)}
.seg{display:inline-flex;border:1px solid var(--muse-line);border-radius:8px;overflow:hidden;background:var(--muse-wash)}
.seg button{min-height:26px;padding:0 8px;font-size:10.5px;color:var(--muse-muted)}
.seg button[aria-checked="true"]{background:var(--muse-card);color:var(--muse-ink);font-weight:600}
.grok{border:1px solid var(--muse-line);border-radius:12px;background:var(--muse-card);padding:13px;margin:0 0 18px}
.grok-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.grok h3{margin:0;font-size:12.5px;font-weight:600}
.grok p{margin:3px 0 0;font-size:10.5px;line-height:1.65;color:var(--muse-muted)}
.lamps{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}
.lamp{display:inline-flex;align-items:center;gap:5px;padding:2px 7px;border:1px solid var(--muse-line);border-radius:999px;font-size:9.5px;color:var(--muse-muted)}
.lamp i{width:6px;height:6px;border-radius:50%;background:var(--muse-muted);flex:none}
.lamp[data-lamp="idle"] i{background:#94a0b0}
.lamp[data-lamp="queued"] i{background:var(--muse-warn)}
.lamp[data-lamp="accepted"] i{background:var(--muse-blue)}
.lamp[data-lamp="working"] i{background:var(--muse-blue);box-shadow:0 0 0 3px rgba(36,89,234,.16)}
.lamp[data-lamp="waiting"] i{border-radius:1px;background:var(--muse-warn)}
.lamp[data-lamp="done"] i{background:var(--muse-success)}
.lamp[data-lamp="failed"] i{background:var(--muse-danger)}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:12px 0}
.step{display:grid;justify-items:center;gap:4px;font-size:10px;color:var(--muse-muted);text-align:center}
.step i{width:7px;height:7px;border-radius:50%;background:var(--muse-line-2)}
.step.done i{background:var(--muse-blue)}
.step.current i{background:var(--muse-blue);box-shadow:0 0 0 3px rgba(36,89,234,.18)}
.footer{margin-top:22px;padding-top:12px;border-top:1px solid var(--muse-line);display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;justify-content:space-between;font-size:10px;line-height:1.6;color:var(--muse-muted)}
.toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:20;max-width:min(540px,92vw);padding:9px 14px;border-radius:10px;background:var(--muse-ink);color:var(--muse-bg);font-size:11.5px;font-weight:500;box-shadow:0 12px 30px rgba(0,0,0,.2);animation:muse-in .18s ease-out}
@keyframes muse-in{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
@media (max-width:980px){.scheme{grid-template-columns:1fr}.cta{position:static}}
@media (max-width:720px){.wrap{padding:16px 12px 40px}.table-head,.table button{grid-template-columns:minmax(0,1.2fr) 48px 64px 40px 60px;font-size:10.5px}.hero h1{font-size:23px}}
@media (prefers-reduced-motion:reduce){.card{transition:none}.toast{animation:none}}
`;

export const UI_APP_JS = `(function () {
  'use strict';

  var VERIFY = { unverified: '未验证', email_verified: '邮箱已验证', id_lite: '已验证归属者', org_verified: '企业已验证' };
  var PRICING = { per_task: '按次', monthly: '包月', per_computer_hour: '按电脑时' };
  var STATE_LABEL = { booting: '开机中', running: '运行中', needs_you: '需要你', idle: '空闲', done: '已完成', failed: '失败' };
  var SCALES = [['light', '轻量', 1], ['standard', '标准', 2], ['fast', '加快', 4]];
  var LAMPS = [['未配置', 'unconfigured'], ['空闲', 'idle'], ['排队中', 'queued'], ['已接单', 'accepted'], ['执行中', 'working'], ['等待确认', 'waiting'], ['完成', 'done'], ['失败', 'failed']];

  var state = {
    tab: 'browse', query: '', category: '全部',
    workers: [], status: null, scheme: null,
    desk: null, activations: [], computers: [],
    loading: true, error: '', errorStatus: 0, notice: '', screenMode: {},
  };
  var root = document.getElementById('app');
  var toastTimer = 0;

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function api(path, options) {
    return fetch(path, options).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (data) {
        if (!response.ok) {
          var error = new Error((data && data.error && data.error.message) || ('HTTP ' + response.status));
          error.status = response.status;
          error.code = data && data.error && data.error.code;
          throw error;
        }
        return data;
      });
    });
  }

  function notify(text) {
    state.notice = text;
    render();
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { state.notice = ''; render(); }, 3400);
  }

  function runtimeNote() {
    return '画面未接入：MUSE_COMPUTER_RUNTIME=off。只在 noVNC 端口应答后才返回本机画面地址。';
  }

  function orbitTile() {
    return '<span class="orbit-tile" aria-hidden="true"><svg viewBox="0 0 32 32" width="20" height="20" fill="none">' +
      '<circle cx="16" cy="16" r="4.2" fill="#fff"/>' +
      '<ellipse cx="16" cy="16" rx="11" ry="5.2" stroke="#fff" stroke-width="1.6" transform="rotate(-28 16 16)"/>' +
      '<circle cx="25.2" cy="12.2" r="1.7" fill="#2459ea"/></svg></span>';
  }

  function headerHtml() {
    var counts = state.status && state.status.counts ? state.status.counts : null;
    return '<div class="masthead">' +
      '<div class="brand">' + orbitTile() +
        '<span class="brand-copy"><b>Muse</b><span>工作区 · PERSONAL AI</span></span></div>' +
      '<div class="masthead-meta">' +
        (counts ? '<span class="pill"><i></i>已登记执行器 · ' + counts.workers + '</span>' : '') +
        (state.status ? '<span class="pill' + (state.status.runtime === 'off' ? ' warn' : '') + '"><i></i>画面 · ' + (state.status.runtime === 'off' ? '未接入' : '已接入') + '</span>' : '') +
        '<button type="button" class="ghost" data-action="refresh">刷新</button>' +
      '</div></div>' +
      '<div class="hero"><p class="eyebrow"><i></i>MUSE · AI WORKER</p>' +
      '<h1>AI Worker 市场</h1>' +
      '<p>开发者的 Worker，平台人工上架。买方看方案页、开通工作电脑，交付再单独验收。浏览、开通与验收都在这一页，不进对话卡片。</p></div>';
  }

  function bannerHtml() {
    if (state.error) {
      return '<div class="banner error" role="alert"><i></i><span>' + esc(state.error) + '</span>' +
        '<button type="button" data-action="refresh">重试</button></div>';
    }
    if (state.status && state.status.demo) {
      return '<div class="banner"><i></i><span>演示目录 · 组合行显式开启了 demo: true。' +
        '这里不显示虚构评分，也不伪造电脑在线状态；预算上限是业务帽，不会结算。</span></div>';
    }
    if (state.status && state.status.counts && state.status.counts.workers === 0) {
      return '<div class="banner"><i></i><span>还没有已上架的 Worker。演示目录需要组合行显式 demo: true；生产路径不读演示夹具。</span></div>';
    }
    return '';
  }

  function tabsHtml() {
    var tabs = [['browse', '浏览', state.workers.length], ['activated', '已开通', state.activations.length], ['developer', '我的 Worker', 0]];
    return '<div class="tabs" role="tablist" aria-label="市场分区">' + tabs.map(function (tab) {
      return '<button type="button" role="tab" class="tab" data-action="tab" data-tab="' + tab[0] + '" aria-selected="' +
        (state.tab === tab[0] ? 'true' : 'false') + '">' + tab[1] + '<span class="count">' + tab[2] + '</span></button>';
    }).join('') + '</div>';
  }

  function workerCard(item) {
    var owner = item.owner || null;
    var verify = owner ? (VERIFY[owner.verificationLevel] || '未验证') : '未绑定归属者';
    var design = owner ? owner.avatarDesignId : 'orbit';
    var rating = item.rating && item.rating.count > 0 ? String(item.rating.average) : '还没有评价';
    return '<button type="button" class="card" data-action="open" data-id="' + esc(item.id) + '" data-featured="' +
      (item.featured ? 'true' : 'false') + '">' +
      (item.featured ? '<span class="badge">精选</span>' : '') +
      '<span class="card-top"><span class="cover" data-design="' + esc(design) + '" aria-hidden="true">' + esc((item.name || 'W').slice(0, 1)) + '</span>' +
      '<span class="card-head"><span class="kicker">' + esc(item.category || '未分类') + '</span>' +
      '<span class="name">' + esc(item.name) + '</span><span class="summary">' + esc(item.summary) + '</span></span></span>' +
      '<span class="ownerline"><span class="avatar" data-design="' + esc(design) + '" aria-hidden="true">' +
      esc(owner ? owner.displayName.slice(0, 1) : '?') + '</span><strong>' + esc(owner ? owner.displayName : '未绑定归属者') +
      '</strong><span>' + esc(verify) + '</span></span>' +
      '<span class="meta"><span>' + esc(rating) + '</span><b>' + esc(item.priceLabel || '面议') + '</b>' +
      '<span>' + esc(PRICING[(item.pricing && item.pricing.type) || item.pricing] || item.pricing || '') + '</span></span></button>';
  }

  function grid(items) {
    return '<div class="grid">' + items.map(workerCard).join('') + '</div>';
  }

  function filterWorkers() {
    var needle = state.query.trim().toLowerCase();
    return state.workers.filter(function (item) {
      if (state.category !== '全部' && item.category !== state.category) return false;
      if (!needle) return true;
      return (item.name + ' ' + (item.summary || '') + ' ' + (item.category || '')).toLowerCase().indexOf(needle) >= 0;
    });
  }

  function toolbarHtml() {
    var categories = ['全部'];
    state.workers.forEach(function (item) { if (item.category && categories.indexOf(item.category) < 0) categories.push(item.category); });
    return '<div class="toolbar"><label class="search"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">' +
      '<circle cx="10.5" cy="10.5" r="6.2" stroke="currentColor" stroke-width="1.6"/>' +
      '<path d="m15.4 15.4 4.6 4.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
      '<input id="market-search" value="' + esc(state.query) + '" placeholder="名称、摘要或品类" aria-label="搜索 Worker" /></label>' +
      '<div class="cats" role="group" aria-label="品类">' + categories.map(function (item) {
        return '<button type="button" class="cat' + (state.category === item ? ' is-on' : '') + '" data-action="category" data-category="' +
          esc(item) + '" aria-pressed="' + (state.category === item ? 'true' : 'false') + '">' + esc(item) + '</button>';
      }).join('') + '</div></div>';
  }

  function browseView() {
    if (state.loading) return '<div class="empty"><b>正在读取市场</b><span>只读取本插件的 /api/market/*，未接入时会明确写未接入。</span></div>';
    var rows = filterWorkers();
    if (!rows.length) {
      return toolbarHtml() + '<div class="empty"><b>没有匹配的 Worker。</b><span>' +
        (state.workers.length ? '换个说法，或者清空当前筛选。' : '还没有已上架的 Worker。') + '</span></div>';
    }
    var featured = rows.filter(function (item) { return item.featured; });
    var newest = rows.slice().sort(function (a, b) { return String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')); }).slice(0, 8);
    return toolbarHtml() +
      (featured.length ? '<section class="section"><div class="section-head"><h2>精选</h2><p>买方同意后才公开的交付样本</p></div>' + grid(featured) + '</section>' : '') +
      '<section class="section"><div class="section-head"><h2>最新上架</h2></div>' + grid(newest) + '</section>' +
      '<section class="section"><div class="section-head"><h2>全部</h2><p>' + rows.length + ' 个 Worker</p></div>' + grid(rows) + '</section>';
  }

  function block(title, body, id) {
    return '<section class="block"' + (id ? ' id="' + id + '"' : '') + '><h3>' + esc(title) + '</h3>' + body + '</section>';
  }

  function schemeView() {
    var scheme = state.scheme;
    if (!scheme) return '';
    var owner = scheme.owner;
    var verify = owner ? (VERIFY[owner.verificationLevel] || '未验证') + (owner.verificationProvider === 'stub' ? ' · 验证占位' : '') : '';
    var scales = SCALES.map(function (item) {
      return '<label class="scale"><input type="radio" name="scale" value="' + item[0] + '"' +
        (scheme.defaultScale === item[0] ? ' checked' : '') + '/>' + item[1] + ' · ' + item[2] + ' 台</label>';
    }).join('');
    var checks = (scheme.confirmActions || []).map(function (action) {
      return '<label><input type="checkbox" name="confirm" value="' + esc(action.id) + '" checked/>' + esc(action.label) + '</label>';
    }).join('');
    var services = (scheme.services || []).length
      ? '<ul>' + scheme.services.map(function (item) { return '<li><strong>' + esc(item.title) + '</strong><p>' + esc(item.detail) + '</p></li>'; }).join('') + '</ul>'
      : '<p>未填写服务说明。</p>';
    var capabilities = (scheme.capabilities || []).length
      ? '<ul>' + scheme.capabilities.map(function (item) { return '<li>' + esc(item.label) + ' · ' + esc(item.risk) + '</li>'; }).join('') + '</ul>'
      : '<p>无额外能力声明。</p>';
    return '<article class="scheme">' +
      '<div class="scheme-main">' +
        '<header class="scheme-head"><div><p class="scheme-meta">' + esc(scheme.category || '未分类') + ' · 已上架</p>' +
          '<h1>' + esc(scheme.name) + '</h1></div><button type="button" class="ghost" data-action="back">返回</button></header>' +
        '<nav class="anchors" aria-label="方案目录">' +
          '<a href="#scheme-owner">归属者</a><a href="#scheme-services">服务</a><a href="#scheme-working">工作方式</a>' +
          '<a href="#scheme-price">价格</a><a href="#scheme-portfolio">交付</a><a href="#scheme-reviews">评价</a></nav>' +
        '<p class="hint" style="margin-top:10px">' + esc(scheme.summary) + '</p>' +
        block('归属者', owner ? '<div class="owner-card"><span class="avatar" data-design="' + esc(owner.avatarDesignId || 'orbit') + '" aria-hidden="true">' +
          esc((owner.displayName || '?').slice(0, 1)) + '</span><div><strong>' + esc(owner.displayName) + '</strong><small>' + esc(verify) +
          '</small><p>' + esc(owner.bio || '未填写简介。') + '</p></div></div>' : '<p>未绑定归属者。</p>', 'scheme-owner') +
        block('服务', services + '<p>' + esc('不做：' + (scheme.doesNot || '未填写边界。')) + '</p>', 'scheme-services') +
        block('工作方式', '<p>' + esc(scheme.workingStyle || '未填写。') + '</p>', 'scheme-working') +
        block('价格与规模', '<p class="num">' + esc(PRICING[(scheme.pricing && scheme.pricing.type) || scheme.pricing] || '') + ' · ' +
          esc((scheme.pricing && scheme.pricing.priceLabel) || '面议') + (scheme.requiresComputer === false ? ' · 不申请电脑' : ' · 标准 2 台') + '</p>' +
          '<p class="hint" style="margin-top:0">标价仅供展示。预算上限是业务帽，不结算。</p>' +
          '<ul>' + (scheme.confirmActions || []).map(function (action) { return '<li>' + esc(action.label) + '</li>'; }).join('') + '</ul>', 'scheme-price') +
        block('能力', capabilities) +
        block('近 7 日交付', '<p>近 7 日无已授权展示的交付。</p>', 'scheme-portfolio') +
        block('评价', '<p>还没有评价。</p>', 'scheme-reviews') +
      '</div>' +
      '<aside class="cta"><h2>' + esc((scheme.pricing && scheme.pricing.priceLabel) || '面议') + '</h2>' +
        '<p class="price-type">' + esc(PRICING[(scheme.pricing && scheme.pricing.type) || scheme.pricing] || '') + '</p>' +
        '<form data-form="activate" data-worker="' + esc(scheme.workerId) + '">' +
          '<p class="hint" style="margin-top:0">选择规模、权限和预算上限。预算上限不结算。</p>' +
          '<label class="field"><span>预算上限</span><input name="budgetCap" inputmode="numeric" value="800" aria-label="预算上限"/></label>' +
          '<div class="scales" role="radiogroup" aria-label="工作规模">' + scales + '</div>' +
          (checks ? '<fieldset class="checks"><legend>权限</legend>' + checks + '</fieldset>' : '') +
          '<button type="submit" class="primary">确认开通</button>' +
        '</form>' +
        '<p class="hint">标价仅供展示。预算上限是业务帽，不结算。开通后电脑在 runtime=off 时停在开机中。</p>' +
      '</aside></article>';
  }

  function activatedView() {
    var desk = state.desk;
    var table = state.activations.length
      ? '<div class="table"><div class="table-head" aria-hidden="true"><span>名称</span><span>规模</span><span>预算上限</span><span>电脑</span><span>状态</span></div>' +
        '<ul>' + state.activations.map(function (item) {
          var scaleLabel = (SCALES.filter(function (scale) { return scale[0] === item.scale; })[0] || SCALES[1])[1];
          return '<li><button type="button" data-action="open" data-id="' + esc(item.offerId) + '"><strong>' + esc(item.name) +
            '</strong><span>' + esc(scaleLabel) + '</span><span class="num">' + esc(item.budgetCap) + '</span><span class="num">' +
            esc(item.computers) + '</span><span>已开通</span></button></li>';
        }).join('') + '</ul></div>'
      : '<div class="empty"><b>还没有开通的 Worker。</b><span>在「浏览」里选一个 Worker，确认规模、权限和预算上限后开通。</span></div>';

    var computers = state.computers.length
      ? '<div class="pcs">' + state.computers.map(function (pc) {
        var mode = state.screenMode[pc.id] || 'watch';
        return '<article class="pc"><div class="pc-screen"><span class="pc-tag">演示</span><div class="pc-screen-copy"><b>' +
          esc(pc.workerName + ' · ' + pc.label) + '</b><span>未接入 · 画面只在本机接通后出现</span></div></div>' +
          '<div class="pc-body"><div class="pc-row"><span class="pc-name">' + esc(pc.workerName) + '</span>' +
          '<span class="state" data-state="' + esc(pc.status) + '"><i></i>' + esc(STATE_LABEL[pc.status] || pc.status) + '</span></div>' +
          '<p class="pc-task">' + esc(pc.task || '开机中，等待本机 noVNC 端口应答') + '</p>' +
          '<div class="pc-actions"><div class="seg" role="radiogroup" aria-label="画面模式">' +
          '<button type="button" role="radio" aria-checked="' + (mode === 'watch' ? 'true' : 'false') + '" data-action="mode" data-id="' + esc(pc.id) + '" data-mode="watch">只看</button>' +
          '<button type="button" role="radio" aria-checked="' + (mode === 'control' ? 'true' : 'false') + '" data-action="mode" data-id="' + esc(pc.id) + '" data-mode="control">接管</button></div>' +
          '<button type="button" class="ghost" data-action="share">发给同事</button></div></div></article>';
      }).join('') + '</div>'
      : '<div class="empty"><b>' + esc(desk && desk.status === 'empty' ? '还没有工作电脑。' : '未接入 /api/market/desk。') +
        '</b><span>开通 Worker 后，服务端会在这里记录电脑；没有 noVNC 应答时保持「未接入」。</span></div>';

    return '<section class="section"><div class="section-head"><h2>已开通的 Worker</h2></div>' + table + '</section>' +
      '<section class="desk"><div class="section-head"><h2>工作电脑</h2><p>' +
      esc(desk && desk.source ? 'source: ' + desk.source : '未接入 /api/market/desk') + '</p></div>' + computers + '</section>' +
      '<section class="grok"><div class="grok-top"><div><h3>Grok Bot · 个人 Worker</h3>' +
      '<p>缺 GROKBOT_WEBHOOK_URL、GROKBOT_WEBHOOK_KEY、MUSE_WORKER_TOKEN、MUSE_PUBLIC_ORIGIN。未配置时不会显示假的已聘请状态。</p>' +
      '<p>状态只跟真实任务走，区别靠形状而不只靠颜色。</p></div>' +
      '<span class="state" data-state="idle"><i></i>未配置</span></div>' +
      '<div class="lamps" aria-label="Grok Bot 状态灯图例">' + LAMPS.map(function (lamp) {
        return '<span class="lamp" data-lamp="' + lamp[1] + '"><i></i>' + lamp[0] + '</span>';
      }).join('') + '</div></section>' +
      (desk && desk.requests && desk.requests.length
        ? '<section class="section"><div class="section-head"><h2>加电脑请求</h2></div>' + desk.requests.map(function (request) {
          return '<div class="banner"><i></i><span>' + esc(request.workerName) + ' 需要 ' + esc(request.count) + ' 台：' +
            esc(request.reason) + '</span></div>';
        }).join('') + '</section>'
        : '');
  }

  function developerView() {
    return '<div class="steps"><div class="step current"><i></i><span>草稿</span></div>' +
      '<div class="step"><i></i><span>待审核</span></div><div class="step"><i></i><span>已上架</span></div></div>' +
      '<div class="empty"><b>还没有草稿。</b><span>发布向导需要 Worker provider 注册表与回调探测，本 harness 当前组合未挂载；' +
      '这里不显示演示草稿，也不伪造审核状态。</span></div>' +
      '<p class="hint">公开上架只允许管理员：先用邮箱已验证提交审核，公开上架还需要已验证归属者或企业已验证。' +
      '探测通过不会自动上架；价格只展示；预算上限是业务帽，不结算。</p>';
  }

  function footerHtml() {
    return '<footer class="footer"><p>未在受审核执行器清单中登记的 Muse、Grokbot 或 Dot 不能直接上线。这里不接受任意 Token 或执行地址。</p>' +
      '<p>外部成果未经独立核验。</p></footer>';
  }

  function viewHtml() {
    if (state.scheme) return schemeView();
    if (state.tab === 'activated') return activatedView();
    if (state.tab === 'developer') return developerView();
    return browseView();
  }

  function render() {
    root.setAttribute('aria-busy', state.loading ? 'true' : 'false');
    root.innerHTML = '<div class="wrap">' + headerHtml() + bannerHtml() + tabsHtml() + viewHtml() + footerHtml() + '</div>' +
      (state.notice ? '<div class="toast" role="status">' + esc(state.notice) + '</div>' : '');
  }

  async function refreshStatus() {
    try {
      state.status = await api('/api/market/status');
    } catch (error) {
      if (error.status === 404) {
        state.error = '市场 API 未接入：当前 harness 没有提供 /api/market/status，因此这里不展示任何推测数字。';
      } else {
        state.error = '市场状态暂时无法读取：' + error.message;
      }
      state.errorStatus = error.status || 0;
    }
  }

  async function loadWorkers() {
    var data = await api('/api/market/workers');
    state.workers = Array.isArray(data.workers) ? data.workers : [];
  }

  async function loadDesk() {
    try {
      var data = await api('/api/market/desk');
      state.desk = data;
      state.activations = Array.isArray(data.hires) ? data.hires : [];
      state.computers = Array.isArray(data.instances) ? data.instances : [];
    } catch (error) {
      if (error.status === 404) {
        state.desk = null;
        state.activations = [];
        state.computers = [];
        state.error = '工作电脑 desk 未接入：/api/market/desk 不可用。';
      } else {
        state.error = '工作电脑 desk 暂时无法读取：' + error.message;
      }
    }
  }

  async function boot() {
    state.loading = true;
    state.error = '';
    render();
    try {
      await refreshStatus();
      if (state.error && state.errorStatus === 404) {
        state.loading = false;
        render();
        return;
      }
      await loadWorkers();
      await loadDesk();
    } catch (error) {
      state.error = error.status === 404
        ? '市场 API 未接入：当前 harness 没有提供 /api/market/workers。'
        : '市场暂时无法读取：' + error.message;
    }
    state.loading = false;
    render();
  }

  async function openScheme(workerId) {
    state.error = '';
    try {
      var data = await api('/api/market/workers/' + encodeURIComponent(workerId) + '/scheme');
      state.scheme = data.scheme;
      render();
      window.scrollTo ? window.scrollTo(0, 0) : undefined;
    } catch (error) {
      state.error = error.status === 404
        ? '这个 Worker 没有已上架的方案页。'
        : '方案页暂时无法读取：' + error.message;
      render();
    }
  }

  async function activate(workerId, payload) {
    state.error = '';
    try {
      var result = await api('/api/market/workers/' + encodeURIComponent(workerId) + '/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      state.scheme = null;
      state.tab = 'activated';
      await loadDesk();
      await refreshStatus();
      render();
      notify((result.duplicate ? '这个请求已经开通过，未重复创建。' : '已开通「' + result.activation.name + '」· ' +
        result.activation.computers + ' 台工作电脑。') + ' 预算上限是业务帽，不会结算。');
    } catch (error) {
      state.error = '没有开通：' + error.message + '。没有留下电脑。';
      render();
    }
  }

  root.addEventListener('click', function (event) {
    var target = event.target.closest ? event.target.closest('[data-action]') : null;
    if (!target) return;
    var action = target.getAttribute('data-action');
    if (action === 'tab') {
      state.tab = target.getAttribute('data-tab');
      state.scheme = null;
      render();
      if (state.tab === 'activated' && !state.desk) void loadDesk().then(render);
    } else if (action === 'open') {
      void openScheme(target.getAttribute('data-id'));
    } else if (action === 'back') {
      state.scheme = null;
      render();
    } else if (action === 'refresh') {
      void boot();
    } else if (action === 'category') {
      state.category = target.getAttribute('data-category');
      render();
    } else if (action === 'mode') {
      state.screenMode[target.getAttribute('data-id')] = target.getAttribute('data-mode');
      notify(runtimeNote());
    } else if (action === 'share') {
      notify('未接入。还不能生成同事链接；同事链接至少 1 小时内有效。');
    }
  });

  root.addEventListener('input', function (event) {
    if (event.target && event.target.id === 'market-search') {
      state.query = event.target.value;
      render();
      var input = document.getElementById('market-search');
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }
  });

  root.addEventListener('submit', function (event) {
    var form = event.target.closest ? event.target.closest('form[data-form="activate"]') : null;
    if (!form) return;
    event.preventDefault();
    var workerId = form.getAttribute('data-worker');
    var budgetInput = form.querySelector('[name="budgetCap"]');
    var budgetCap = Number(budgetInput && budgetInput.value);
    var checkedScale = form.querySelector('[name="scale"]:checked');
    var scale = checkedScale ? checkedScale.value : 'standard';
    var confirmActionIds = Array.prototype.map.call(form.querySelectorAll('[name="confirm"]:checked'), function (input) { return input.value; });
    if (!Number.isInteger(budgetCap) || budgetCap < 1) {
      notify('请填写整数预算上限。这是业务帽，不会扣款。');
      return;
    }
    void activate(workerId, { scale: scale, budgetCap: budgetCap, confirmActionIds: confirmActionIds, requestId: 'ui-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) });
  });

  document.title = 'Muse · AI Worker 市场';
  void boot();
})();
`;
