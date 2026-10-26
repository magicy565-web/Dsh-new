import { moduleById, economics } from './catalog.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const url = value => new URL(value).href;
const list = items => `<ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
const paragraph = value => `<p>${esc(value)}</p>`;
const table = (heads, rows) => `<div class="table-wrap" tabindex="0"><table><thead><tr>${heads.map(v => `<th scope="col">${esc(v)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const link = (href, label) => `<a class="action" href="${esc(url(href))}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;

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


export function renderModuleBlocks(canonical) {
  const issue = { blocks: canonical.blocks, language: canonical.locale === 'en' ? 'en' : 'zh', preview: canonical.demo };
  const en = issue.language === 'en';
  const title = b => b.title ?? moduleById.get(b.type)[en ? 'en' : 'name'];
  const kinds = en ? { observed: 'Observed source', estimated: 'Estimate', provided: 'Provided material', illustrative: 'Illustrative only' } : { observed: '已读取来源', estimated: '估算', provided: '提供资料', illustrative: '仅作示意' };
  return issue.blocks.map((b, i) => `<section class="magazine-module" id="${esc(b.id)}" data-module="${esc(b.type)}"><div class="eyebrow">${String(i + 1).padStart(2, '0')}${b.product ? ` / ${esc(b.product)}` : ''}</div><h2>${esc(title(b))}</h2>${body(b, issue)}${b.evidence?.length ? `<details><summary>${en ? 'Sources & basis' : '来源与依据'} (${b.evidence.length})</summary><ol>${b.evidence.map((s, j) => `<li id="${esc(b.id)}-source-${j}"><strong>${esc(s.label)}</strong> · ${esc(kinds[s.kind])} · ${esc(s.date)}${paragraph(s.reference)}${s.url ? link(s.url, en ? 'Open source' : '打开来源') : ''}</li>`).join('')}</ol></details>` : ''}</section>`).join('');
}
