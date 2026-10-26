import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { modules, moduleById, economics } from './modules.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const required = (value, path) => { if (typeof value !== 'string' || !value.trim()) throw new Error(`${path}: text is required`); };
function texts(value, path) {
  if (!Array.isArray(value) || !value.length) throw new Error(`${path}: non-empty text array required`);
  value.forEach((v, i) => required(v, `${path}[${i}]`));
}
function url(value) {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Only HTTP(S) URLs without credentials are supported');
  return parsed.href;
}
const list = items => `<ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
const paragraph = value => `<p>${esc(value)}</p>`;
const table = (heads, rows) => `<div class="table-wrap" tabindex="0"><table><thead><tr>${heads.map(v => `<th scope="col">${esc(v)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const link = (href, label) => `<a class="action" href="${esc(url(href))}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;

export function validateIssue(issue) {
  if (!issue || typeof issue !== 'object') throw new Error('Issue object required');
  required(issue.title, 'title'); required(issue.audience, 'audience');
  if (!['zh', 'en'].includes(issue.language)) throw new Error('language must be zh or en');
  if (issue.preview !== undefined && typeof issue.preview !== 'boolean') throw new Error('preview must be boolean');
  if (!Array.isArray(issue.blocks) || !issue.blocks.length) throw new Error('Select at least one block; modules are never added automatically');
  const ids = new Set();
  for (const b of issue.blocks) {
    required(b.id, 'block.id');
    if (!/^[a-zA-Z][\w-]*$/.test(b.id) || ids.has(b.id)) throw new Error(`Invalid or duplicate block id: ${b.id}`);
    ids.add(b.id);
    if (!moduleById.has(b.type)) throw new Error(`Unknown module: ${b.type}`);
    if (b.title !== undefined) required(b.title, 'block.title');
    if (b.product !== undefined) required(b.product, 'block.product');
    const d = b.data;
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error(`${b.id}.data required`);
    for (const key of ['imageUrl', 'productUrl', 'actionUrl']) if (d[key] !== undefined) { required(d[key], key); url(d[key]); }
    const evidence = b.evidence ?? [];
    if (!Array.isArray(evidence)) throw new Error(`${b.id}.evidence must be an array`);
    evidence.forEach(s => {
      required(s.label, 'evidence.label'); required(s.reference, 'evidence.reference'); required(s.date, 'evidence.date');
      if (!['observed', 'estimated', 'provided', 'illustrative'].includes(s.kind)) throw new Error('Unknown evidence kind');
      if (s.kind === 'illustrative' && !issue.preview) throw new Error('Illustrative evidence requires preview: true');
      if (s.url !== undefined) url(s.url);
    });
    const text = (...keys) => keys.forEach(k => required(d[k], `${b.id}.${k}`));
    const arrays = (...keys) => keys.forEach(k => texts(d[k], `${b.id}.${k}`));
    switch (b.type) {
      case 'product': text('summary'); arrays('features'); if (d.imageUrl) text('imageAlt'); break;
      case 'buyer-fit': text('buyerContext'); arrays('reasons'); if (d.unknowns !== undefined) arrays('unknowns'); break;
      case 'opportunity': arrays('signals', 'uncertainties'); text('interpretation'); break;
      case 'launch': text('status', 'timing', 'availability'); break;
      case 'sales-history':
        if (!Array.isArray(d.comparables) || !d.comparables.length) throw new Error('sales-history.comparables required');
        d.comparables.forEach(row => {
          for (const key of ['name', 'period', 'market', 'channel', 'currency', 'basis', 'comparability']) required(row[key], `sales-history.${key}`);
          if (!/^[A-Z]{3}$/.test(row.currency)) throw new Error('sales-history.currency must be a currency code');
          if (typeof row.revenue !== 'number' || !Number.isFinite(row.revenue) || row.revenue < 0) throw new Error('sales-history.revenue must be non-negative');
          if (!['reported', 'estimated'].includes(row.measurement)) throw new Error('sales-history.measurement must distinguish reported and estimated');
          if (!Number.isInteger(row.source) || !evidence[row.source]) throw new Error('Each sales row needs a valid evidence index');
          if (row.measurement === 'reported' && evidence[row.source].kind === 'estimated') throw new Error('Estimated evidence cannot become reported sales');
        }); break;
      case 'margin': economics(d); arrays('assumptions'); break;
      case 'comparison':
        arrays('columns', 'caveats');
        if (!Array.isArray(d.rows) || !d.rows.length) throw new Error('comparison.rows required');
        d.rows.forEach(row => { texts(row, 'comparison.row'); if (row.length !== d.columns.length) throw new Error('Comparison columns and row widths differ'); }); break;
      case 'procurement': case 'sample': arrays('terms'); break;
      case 'exclusive':
        text('territory', 'channel', 'term'); arrays('conditions');
        if (!['proposed', 'recorded', 'confirmed'].includes(d.status)) throw new Error('exclusive.status must be proposed, recorded or confirmed');
        if (['recorded', 'confirmed'].includes(d.status) && !evidence.length) throw new Error('Confirmed supply rights need supplier evidence');
        if (['recorded', 'confirmed'].includes(d.status) && evidence.every(s => s.kind === 'estimated')) throw new Error('Estimated evidence cannot confirm supply rights');
        if (d.slots !== undefined) {
          if (!['recorded', 'confirmed'].includes(d.status) || !Number.isInteger(d.slots) || d.slots < 0) throw new Error('Slots require recorded or confirmed rights and a non-negative integer');
          text('asOf');
        }
        break;
    }
  }
  return issue;
}

function body(block, issue) {
  const d = block.data, en = issue.language === 'en';
  const t = (zh, english) => en ? english : zh;
  const action = (label, enabled = true) => issue.preview || !d.actionUrl || !enabled
    ? `<p class="muted">${esc(t('入口尚未开放', 'Action unavailable'))}</p>` : link(d.actionUrl, label);
  switch (block.type) {
    case 'product': return (d.imageUrl ? `<img src="${esc(url(d.imageUrl))}" alt="${esc(d.imageAlt)}" loading="lazy" referrerpolicy="no-referrer">` : '') + paragraph(d.summary) + list(d.features) + (d.productUrl && !issue.preview ? link(d.productUrl, t('产品原页', 'Product source')) : '');
    case 'buyer-fit': return paragraph(d.buyerContext) + list(d.reasons) + (d.unknowns ? `<h3>${t('还需了解', 'Still to establish')}</h3>${list(d.unknowns)}` : '');
    case 'opportunity': return `<h3>${t('观察信号', 'Signals')}</h3>${list(d.signals)}<h3>${t('编辑判断', 'Interpretation')}</h3>${paragraph(d.interpretation)}<h3>${t('待验证', 'Uncertainties')}</h3>${list(d.uncertainties)}`;
    case 'launch': return table([t('项目', 'Item'), t('安排', 'Details')], [[t('上市状态', 'Status'), d.status], [t('首发时间', 'Timing'), d.timing], [t('首批安排', 'Availability'), d.availability]]);
    case 'sales-history': return d.comparables.map(r => `<div class="comparable"><h3>${esc(r.name)}</h3><p class="metric">${esc(r.currency)} ${r.revenue.toLocaleString(en ? 'en-US' : 'zh-CN')} <small>${r.measurement === 'estimated' ? t('估算销售额', 'Estimated revenue') : t('来源报告销售额', 'Source-reported revenue')}</small></p>${paragraph(`${r.period} · ${r.market} · ${r.channel}`)}${paragraph(r.basis)}${paragraph(r.comparability)}<a href="#${esc(block.id)}-source-${r.source}">${t('查看依据', 'View source')} ${r.source + 1}</a></div>`).join('') + `<p class="muted">${t('同类历史表现不代表本品未来销售。', 'Comparable history is not a forecast for this product.')}</p>`;
    case 'margin': {
      const v = economics(d), money = n => `${d.currency} ${n.toFixed(2)}`;
      return `<p class="metric">${esc(money(v.contribution))}<small>${t('每件贡献利润（测算）', 'Unit contribution (scenario)')}</small></p>` + table([t('项目', 'Item'), t('金额', 'Amount')], [
        [t('假设售价', 'Assumed selling price'), money(d.salePrice)], [t('采购成本', 'Purchase cost'), money(d.purchaseCost)], [t('运费', 'Freight'), money(d.freight)], [t('关税', 'Duty'), money(d.duty)], [t('其他单件成本', 'Other unit costs'), money(d.otherCost)], [t('渠道费用', 'Channel fees'), money(v.fee)], [t('贡献利润率', 'Contribution margin'), `${(v.contributionRate * 100).toFixed(1)}%`],
      ]) + `<h3>${t('假设与口径', 'Assumptions')}</h3>${list(d.assumptions)}<p class="muted">${t('贡献利润 = 售价 − 所列单件成本。利润率以售价为分母；不等同于净利润，未列入的固定费用、退货和税费仍需考虑。', 'Contribution = selling price − listed unit costs. Margin uses selling price as denominator. This is not net profit; unlisted overhead, returns and taxes remain to be considered.')}</p>`;
    }
    case 'comparison': return table(d.columns, d.rows) + list(d.caveats);
    case 'procurement': return list(d.terms);
    case 'sample': return list(d.terms) + action(t('申请样品', 'Request a sample'));
    case 'exclusive': return paragraph(d.status === 'confirmed' ? t('供应商已确认以下权益条件', 'Supplier-confirmed terms') : d.status === 'recorded' ? t('ERP 已登记以下权益条件，供应方原始依据仍需核对', 'ERP-recorded terms; supplier source material still needs review') : t('拟议权益，尚待供应商确认', 'Proposed rights, awaiting supplier confirmation')) + table([t('范围', 'Scope'), t('条件', 'Terms')], [[t('区域', 'Territory'), d.territory], [t('渠道', 'Channel'), d.channel], [t('期限', 'Term'), d.term]]) + list(d.conditions) + (d.slots !== undefined ? paragraph(`${t('名额快照', 'Availability snapshot')}: ${d.slots} · ${d.asOf}`) : '') + action(d.status === 'confirmed' ? t('前往供应方确认并锁定', 'Confirm and reserve with supplier') : d.status === 'recorded' ? t('前往供应方核对权益', 'Review rights with supplier') : t('申请洽谈独家权益', 'Enquire about exclusivity'), d.slots !== 0) + `<p class="muted">${t('点击进入供应方渠道；名额及锁定结果以供应方实时确认为准。', 'Opens the supplier channel. Availability and reservations require live supplier confirmation.')}</p>`;
  }
}

export function renderIssue(input) {
  const issue = validateIssue(input), en = issue.language === 'en';
  const title = b => b.title ?? moduleById.get(b.type)[en ? 'en' : 'name'];
  const kinds = en ? { observed: 'Observed source', estimated: 'Estimate', provided: 'Provided material', illustrative: 'Illustrative only' } : { observed: '已读取来源', estimated: '估算', provided: '提供资料', illustrative: '仅作示意' };
  const content = issue.blocks.map((b, i) => `<section id="${esc(b.id)}" data-module="${esc(b.type)}"><div class="eyebrow">${String(i + 1).padStart(2, '0')}${b.product ? ` / ${esc(b.product)}` : ''}</div><h2>${esc(title(b))}</h2>${body(b, issue)}${b.evidence?.length ? `<details><summary>${en ? 'Sources & basis' : '来源与依据'} (${b.evidence.length})</summary><ol>${b.evidence.map((s, j) => `<li id="${esc(b.id)}-source-${j}"><strong>${esc(s.label)}</strong> · ${esc(kinds[s.kind])} · ${esc(s.date)}${paragraph(s.reference)}${s.url ? link(s.url, en ? 'Open source' : '打开来源') : ''}</li>`).join('')}</ol></details>` : ''}</section>`).join('');
  const banner = issue.preview ? (en ? 'LAYOUT PREVIEW · Illustrative content · Actions disabled' : '排版预览 · 内容仅作示意 · 操作入口已禁用') : (en ? 'WORKING DRAFT · Not published' : '工作稿 · 尚未发布');
  return `<!doctype html><html lang="${issue.language === 'zh' ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(issue.title)}</title><style>
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f4f1e9;color:#202b29;font:16px/1.7 system-ui,sans-serif}a{color:#215c50;text-underline-offset:4px}header,main,footer{max-width:1060px;margin:auto;padding:32px 24px}header{padding-top:48px}h1{font:clamp(2.2rem,6vw,4.4rem)/1.15 Georgia,serif;letter-spacing:-.03em;margin:24px 0;overflow-wrap:anywhere}h2{font:clamp(1.5rem,3vw,2rem)/1.3 Georgia,serif;margin:12px 0 24px}h3{font-size:1rem;margin:22px 0 8px}p,li,td,th{overflow-wrap:anywhere}.banner,.eyebrow{font-size:.75rem;letter-spacing:.08em;font-weight:700}.banner{padding:10px 14px;background:#eadbb8;border-radius:4px;display:inline-block}.eyebrow{color:#547168}.audience{max-width:720px;color:#52625d}nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:24px}nav a{border:1px solid #c8d2c9;border-radius:24px;padding:5px 13px;text-decoration:none;font-size:.85rem}main{display:grid;gap:24px;padding-top:0}section{background:#fffdf8;border:1px solid #dce1d6;border-radius:12px;padding:clamp(20px,4vw,40px);min-width:0;scroll-margin-top:20px}img{display:block;max-width:100%;max-height:400px;object-fit:contain;margin:16px auto}ul,ol{padding-left:22px}li+li{margin-top:8px}.table-wrap{overflow-x:auto;margin:16px 0}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #dce1d6;min-width:100px}th{color:#547168;background:#f3f5ef}.metric{font:2.3rem/1.3 Georgia,serif;color:#215c50;margin:20px 0}.metric small{font: .85rem/1.5 system-ui;display:block;margin-top:8px}.action{display:inline-block;border:1px solid #215c50;border-radius:6px;padding:9px 16px;margin:12px 0;text-decoration:none}.muted,details{font-size:.85rem;color:#63736c}details{border-top:1px solid #dce1d6;margin-top:24px;padding-top:16px}summary{cursor:pointer}.comparable+.comparable{border-top:1px solid #dce1d6;margin-top:24px;padding-top:16px}footer{font-size:.8rem;color:#63736c}@media(max-width:480px){header,main,footer{padding-left:16px;padding-right:16px}header{padding-top:24px}.metric{font-size:1.9rem}}@media print{nav{display:none}body{background:white}section{break-inside:avoid}a{color:inherit}}
</style></head><body><header><span class="banner">${banner}</span><h1>${esc(issue.title)}</h1><p class="audience">${esc(issue.audience)}</p><nav aria-label="${en ? 'Contents' : '本期内容'}">${issue.blocks.map(b => `<a href="#${esc(b.id)}">${esc(title(b))}</a>`).join('')}</nav></header><main>${content}</main><footer>${en ? 'Prepared for the audience shown above. Sources and assumptions accompany the relevant sections.' : '按本期读者与选定模块编排；相关依据和假设随内容展示。'}</footer></body></html>`;
}

export async function main(args) {
  if (args.length === 1 && args[0] === '--list') { console.log(JSON.stringify(modules, null, 2)); return; }
  if (args.length !== 2) throw new Error('Usage: node render.mjs --list | <issue.json> <output.html>');
  const issue = JSON.parse(await readFile(resolve(args[0]), 'utf8'));
  const html = renderIssue(issue);
  await writeFile(resolve(args[1]), html, { flag: 'wx' });
  console.log(`Created ${args[1]} with ${issue.blocks.length} selected blocks.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
