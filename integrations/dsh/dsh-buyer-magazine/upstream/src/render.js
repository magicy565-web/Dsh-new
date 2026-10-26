import { webCardSections } from '../../src/web-card.js';
import { designCss } from '../../src/production.js';
import { localizeChrome, zh } from '../../src/localize.js';
import { moduleById } from '../../src/modules/catalog.js';
import { renderModuleBlocks } from '../../src/modules/render.js';
import { resolveArchetype, sourcingSignals } from './presentation.js';
import { readFileSync } from 'node:fs';

const asset = name => new URL(`../assets/${name}`, import.meta.url);
const css = readFileSync(asset('magazine.css'), 'utf8') + '\n' + readFileSync(asset('web-card.css'), 'utf8');
const suppliedCss = ['editorial-magazine-design/resources/spread-primitives.css','editorial-typography-system/resources/typographic-primitives.css'].map(path=>readFileSync(new URL('../../skills/'+path,import.meta.url),'utf8')).join('\n');
const client = readFileSync(asset('magazine.js'), 'utf8').replace('/* CHROME_TRANSLATIONS */ {}', JSON.stringify(zh));
// Font binaries are not distributed; visitors use their own installed faces or
// reliable system serif/sans fallback stacks.
const fontFaces = '';

export const designTokens = Object.freeze({
  paper: '#f4f1ea', surface: '#fffdf8', ink: '#202820', muted: '#65675e', accent: '#a83f2c',
  forest: '#263c33', rule: '#c8c5b8', sage: '#dfe5d7', displayFont: 'Fraunces', textFont: 'Manrope', maxWidth: 1280,
});
export const componentCatalog = Object.freeze([
  'IssueMasthead', 'ReadingProgress', 'CoverStory', 'QuickSignals', 'ProductFeature', 'ProcurementFacts',
  'EvidenceChip', 'SourceDrawer', 'ShortlistDock', 'ComparisonTable', 'RequestBriefDownload', 'EditorialNotes', 'EmailDigest',
  'BuyerDesk', 'EditorialArchetypes', 'ProcurementIndex', 'SourcingLedger', 'CoverDossier',
]);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const arr = value => Array.isArray(value) ? value : [];
const text = value => value == null ? '' : String(value);
const safeId = value => String(value || 'item').replace(/[^a-z0-9_-]/gi, '-').slice(0, 90);
const labelStatus = field => field?.status === 'verified' ? 'Verified against cited evidence' : field?.status === 'supplier-stated' ? 'Supplier-stated' : 'Not confirmed';
function safeHref(value, allowMail = true) {
  try {
    const u = new URL(value);
    if (u.username || u.password) return '';
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
    if (allowMail && u.protocol === 'mailto:' && !/[\r\n]/.test(value)) return u.href;
  } catch { /* Drop unsafe links. */ }
  return '';
}
function safeImage(value) {
  if (typeof value !== 'string' || /[\\\x00-\x1f]/.test(value)) return '';
  if (/^assets\/[a-zA-Z0-9/_ .-]+\.(?:png|jpe?g|webp|gif|svg)$/i.test(value) && !value.split('/').includes('..')) return value;
  return safeHref(value, false);
}
function permittedImage(image) {
  if (!image || !['owned', 'licensed', 'permission', 'editorial-reference'].includes(image.rights)) return '';
  if (image.role === 'product' && image.generated) return '';
  return safeImage(image.src);
}
function imageLabel(image, demo) {
  if (!image) return 'Product image not supplied';
  if (image.rights === 'editorial-reference') return `${image.credit} · ${image.caption}`;
  if (image?.generated) return 'AI-generated editorial illustration · not product evidence';
  if (image?.role === 'illustration' || demo) return 'Original illustration · not a product photograph';
  if (!permittedImage(image)) return 'Product image unavailable for reuse';
  return image?.role === 'product' ? 'Source product image · see linked evidence' : 'Editorial image · see linked evidence';
}
function imageMarkup(image, options = {}) {
  const src = permittedImage(image);
  if (!src) return '<div class="image-placeholder"><span>Product image<br>awaiting permission</span></div>';
  return `<img src="${esc(src)}" alt="${esc(image.alt || 'Product image')}" ${options.hero ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" style="object-fit:${esc(image.fit || 'contain')};object-position:${esc(image.position || 'center')}" width="${options.hero ? '1400' : '1100'}" height="${options.hero ? '1500' : '1000'}">`;
}
function dateLabel(date, locale = 'en') {
  try {
    const value = new Date(`${String(date).slice(0, 10)}T12:00:00Z`);
    if (Number.isNaN(value.valueOf())) return text(date);
    return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(value);
  } catch { return text(date); }
}
function valueText(field) {
  if (!field || field.status === 'unknown' || field.visibility === 'restricted' || field.value == null || field.value === '') return 'Not disclosed';
  return `${field.value}${field.unit ? ` ${field.unit}` : ''}`;
}
function priceText(price, locale) {
  if (!price || price.status === 'unknown' || ['request-quote', 'unknown'].includes(price.kind) || price.amount == null || price.visibility === 'restricted') return 'Request a project quote';
  let amount;
  // Preserve source ranges/qualifiers; only numeric amounts are currency-formatted.
  if (typeof price.amount === 'string') amount = text(price.amount) + (price.currency ? ` ${text(price.currency)}` : '');
  else {
    try { amount = new Intl.NumberFormat(locale || 'en', { style: 'currency', currency: price.currency }).format(price.amount); }
    catch { amount = `${text(price.currency)} ${text(price.amount)}`.trim(); }
  }
  const context = price.kind === 'retail' ? 'retail reference only' : `wholesale, ${text(price.basis || 'basis not provided')}`
    + (price.minQty != null ? ` · quote quantity basis: ${text(price.minQty)} units` : '');
  return `${amount}${price.unit ? ` / ${price.unit}` : ''} · ${context}`;
}
function evidenceChip(ids, sources) {
  return arr(ids).filter(id => sources.some(s => s.id === id)).map(id => {
    const index = sources.findIndex(s => s.id === id) + 1;
    return `<button class="evidence-chip" type="button" data-sources="${esc(id)}" aria-label="Read source ${index}">[${index}]</button>`;
  }).join('');
}
function fact(label, field, sources, override) {
  if (field?.visibility === 'restricted') field = undefined;
  const unknown = !field || field.status === 'unknown';
  return `<div class="fact" data-fact-status="${esc(field?.status || 'unknown')}"><dt>${esc(label)}</dt><dd${unknown ? ' class="unknown"' : ''}>${esc(override ?? valueText(field))}${evidenceChip(field?.sourceIds, sources)}<span class="status">${esc(labelStatus(field))}</span></dd></div>`;
}
function procurementFacts(product, issue) {
  const specs = arr(product.specs).filter(s => s.visibility !== 'restricted').slice(0, 2);
  const source = arr(issue.sources);
  return `<dl class="procurement-facts">${specs.map(s => fact(s.label || s.key, s, source)).join('')}${fact('Minimum order', product.moq, source)}${fact('Production lead time', product.leadTime, source)}${fact(product.price?.kind === 'retail' ? 'Retail reference · not wholesale' : product.price?.kind === 'wholesale' ? `Wholesale · ${product.price.basis || 'basis to confirm'}` : 'Wholesale quote', product.price, source, priceText(product.price, issue.locale))}${product.price?.kind === 'wholesale' && product.price.minQty != null ? `<div class="fact"><dt>Quote quantity basis</dt><dd>${esc(product.price.minQty)} units<span class="status">Confirm validity with supplier</span></dd></div>` : ''}</dl>`;
}
function additionalFacts(product, issue) {
  const specs = arr(product.specs).filter(s => s.visibility !== 'restricted').slice(2);
  if (!specs.length) return '';
  return `<details class="additional-facts"><summary>Additional specifications (${specs.length})</summary><dl class="procurement-facts">${specs.map(s => fact(s.label || s.key, s, arr(issue.sources))).join('')}</dl></details>`;
}
function productFeature(product, index, issue) {
  const url = safeHref(product.cta?.url);
  const sourceIds = arr(product.sourceIds);
  const sourceButton = `<button class="text-link" type="button" data-sources="${esc(sourceIds[0] || '')}">Read source notes <span aria-hidden="true">↗</span></button>`;
  const action = issue.demo || !url ? sourceButton : `<a class="text-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(product.cta?.label || 'View product source')} <span aria-hidden="true">↗</span></a>`;
  return `<article class="product-feature" id="product-${safeId(product.id)}" data-product-id="${esc(product.id)}" data-product-category="${esc(product.category)}">
    <figure class="product-visual"><div class="product-image">${imageMarkup(product.image)}<span class="product-image-index">FIG. ${String(index + 1).padStart(2, '0')} / ${esc(issue.theme || 'porcelain')}</span></div><figcaption>${esc(imageLabel(product.image, issue.demo))}${product.image?.sourceId ? evidenceChip([product.image.sourceId], arr(issue.sources)) : ''}</figcaption></figure>
    <div class="product-content">
      <p class="product-kicker"><span class="product-index">${String(index + 1).padStart(2, '0')}</span><span>${esc(product.category || 'Product')}</span><span aria-hidden="true">/</span><span>${esc(product.region || 'Origin not confirmed')}</span></p>
      ${product.sponsored ? `<p class="sponsored">Sponsored · ${esc(product.sponsored.sponsor || product.sponsored.label || 'Paid placement')}</p>` : ''}
      <p class="product-eyeline">Source-linked product dossier &nbsp; · &nbsp; ${String(index + 1).padStart(2, '0')} of ${arr(issue.products).length}</p><h3>${esc(product.name)}</h3><p class="supplier-line">${esc(product.supplier || 'Supplier not confirmed')}${evidenceChip(sourceIds, arr(issue.sources))}</p>
      <p class="product-summary">${esc(product.summary)}</p>
      ${product.buyerFit ? `<div class="buyer-fit"><strong>Where it fits</strong>${esc(product.buyerFit)}</div>` : ''}
      <div class="facts-header"><span>Technical & commercial record</span><small>Source-stated ≠ independently verified</small></div>
      ${procurementFacts(product, issue)}
      ${additionalFacts(product, issue)}
      <p class="watchout"><span class="watchout-icon" aria-hidden="true">↳</span><span><strong>Before you commit.</strong> ${esc(product.watchout || 'Confirm the final specification, sample, quotation basis and availability with the supplier.')}</span></p>
      <div class="product-actions">${action}<button class="save-button" type="button" data-save="${esc(product.id)}" aria-pressed="false" aria-label="Shortlist ${esc(product.name)}"><span aria-hidden="true" data-save-mark>+</span><span data-save-label>Shortlist</span></button></div>
    </div>
  </article>`;
}
function sourceDrawer(issue) {
  return `<dialog id="sources-dialog" class="sources-dialog" aria-labelledby="sources-title"><div class="modal-top"><h2 id="sources-title">Behind the edit.</h2><button class="close-button" type="button" data-close aria-label="Close source notes">×</button></div><div class="modal-content"><p class="source-intro">${issue.demo ? 'This is a demonstration issue. Supplier names, specifications and source records are fictional. This issue is a visual example, not a real supplier qualification or offer.' : 'Every citation points back to the material used for this issue. Supplier statements are attributed claims; they are not independent certification. Confirm commercial terms before ordering.'}</p>${arr(issue.sources).map((source, index) => `<section class="source-record" data-source-record="${esc(source.id)}"><p class="source-meta">${esc(source.kind || 'Source')} · accessed ${esc(dateLabel(source.accessedAt?.slice(0, 10), issue.locale))}</p><h3><span>${String(index + 1).padStart(2, '0')}</span>${esc(source.title)}</h3><p>${esc(source.publisher || '')}</p>${source.excerpt ? `<p>${esc(source.excerpt)}</p>` : ''}${safeHref(source.url, false) ? `<a href="${esc(safeHref(source.url, false))}" target="_blank" rel="noopener noreferrer">${esc(source.url)} ↗</a>` : '<p>Source link unavailable</p>'}</section>`).join('')}</div></dialog>`;
}
function comparisonDialog() {
  return '<dialog id="comparison-dialog" class="comparison-dialog" aria-labelledby="comparison-title"><div class="modal-top"><h2 id="comparison-title">Your sourcing shortlist.</h2><button class="close-button" type="button" data-close aria-label="Close comparison">×</button></div><div class="modal-content"><div class="table-scroll" tabindex="0" aria-label="Product comparison, scroll horizontally on a narrow screen"><table class="comparison-table" id="comparison-table"></table></div><div class="compare-bottom"><p>A public retail price is a reference, not a wholesale offer. Terms marked “Not disclosed” remain questions for your supplier.</p><button class="pill-button" type="button" data-download-request>Download request brief <span aria-hidden="true">↓</span></button></div></div></dialog>';
}
function clientData(issue) {
  return {
    brand:text(issue.design?.brand||issue.title),website:safeHref(issue.sources?.[0]?.url,false),id: text(issue.id), title: text(issue.title), date: text(issue.date), demo: !!issue.demo, locale: text(issue.locale || 'en'),
    products: arr(issue.products).map(p => ({
      id: p.id, name: p.name, category: p.category, supplier: p.supplier, buyerFit: p.buyerFit, watchout: p.watchout,
      price: p.price?.visibility === 'restricted' ? undefined : p.price,
      moq: p.moq?.visibility === 'restricted' ? undefined : p.moq,
      leadTime: p.leadTime?.visibility === 'restricted' ? undefined : p.leadTime,
      specs: arr(p.specs).filter(s => s.visibility !== 'restricted'), sourceIds: p.sourceIds,
    })),
    sources: arr(issue.sources).map(s => ({ id: s.id, url: safeHref(s.url, false), accessedAt: s.accessedAt })),
  };
}


function buyerDesk(issue,signals) {
  return `<section class="buyer-desk" aria-labelledby="buyer-desk-title"><div class="buyer-desk-intro"><p class="eyebrow">READ THIS FIRST / BUYER'S DESK</p><h2 id="buyer-desk-title">A clear view,<br><em>before a call.</em></h2><p>These counts describe what this issue documents, not a factory audit. Use them to decide what needs to be asked next.</p></div><div class="buyer-desk-stats"><div class="desk-stat"><strong>${String(signals.products).padStart(2,'0')}</strong><span>Product leads</span></div><div class="desk-stat"><strong>${String(signals.cited).padStart(2,'0')}</strong><span>Linked source records</span></div><div class="desk-stat"><strong>${signals.disclosed}<small>/${signals.commercialTotal}</small></strong><span>Commercial fields disclosed</span></div><div class="desk-note"><span class="desk-note-mark">!</span><p>${signals.pending} trade fields remain open across the edit. A listing is not a supplier qualification.</p></div></div></section>`;
}
function procurementIndex(issue) {
  const products=arr(issue.products);
  return `<section class="sourcing-index" id="procurement-index" aria-labelledby="sourcing-index-title"><div class="index-heading"><div><p class="eyebrow">THE BUYER'S INDEX / 01</p><h2 id="sourcing-index-title">At a glance.</h2></div><p>Read the evidence, then the opportunity.<br>Unknown terms are questions, not zeroes.</p></div><div class="index-table-scroll" tabindex="0" aria-label="Product sourcing summary table, horizontally scrollable"><table class="sourcing-table"><caption>Product leads and publicly documented purchasing terms</caption><thead><tr><th scope="col">Lead / supplier</th><th scope="col">Product focus</th><th scope="col">MOQ</th><th scope="col">Lead time</th><th scope="col">Quote status</th><th scope="col">Read dossier</th></tr></thead><tbody>${products.map((p,i)=>`<tr><th scope="row"><span class="table-index">${String(i+1).padStart(2,'0')}</span><strong>${esc(p.name)}</strong><small>${esc(p.supplier)}</small></th><td>${esc(p.category)}</td><td class="${p.moq?.status==='unknown'?'td-unknown':''}">${esc(valueText(p.moq))}</td><td class="${p.leadTime?.status==='unknown'?'td-unknown':''}">${esc(valueText(p.leadTime))}</td><td class="${p.price?.status==='unknown'?'td-unknown':''}">${esc(priceText(p.price,issue.locale))}</td><td><a href="#product-${safeId(p.id)}" class="table-go" aria-label="Read ${esc(p.name)} dossier">Explore ↗</a></td></tr>`).join('')}</tbody></table></div><div class="mobile-index-cards" aria-label="Compact mobile sourcing summary">${products.map((p,i)=>`<article class="mobile-index-card"><header><span>${String(i+1).padStart(2,'0')}</span><div><strong>${esc(p.name)}</strong><small>${esc(p.category)} · ${esc(p.supplier)}</small></div></header><dl><div><dt>MOQ</dt><dd>${esc(valueText(p.moq))}</dd></div><div><dt>Lead time</dt><dd>${esc(valueText(p.leadTime))}</dd></div><div><dt>Quotation</dt><dd>${esc(priceText(p.price,issue.locale))}</dd></div></dl><a href="#product-${safeId(p.id)}">Open product dossier ↗</a></article>`).join('')}</div><p class="index-footnote">All numbers and terms come from the attributed records in this issue. Supplier claims are identified; independently verified evidence must be reviewed separately.</p></section>`;
}
function evidenceLedger(issue, signals) {
  const sources=arr(issue.sources);
  return `<section class="evidence-ledger" id="evidence-ledger" aria-labelledby="ledger-title"><div><p class="eyebrow">THE EDITOR'S LEDGER / 04</p><h2 id="ledger-title">What we know.<br><em>What we don't.</em></h2><p>${signals.supplierStated} specification fields are supplier-stated. ${signals.verified} are marked verified against cited evidence. This is not an independent factory audit.</p></div><div class="ledger-list">${sources.slice(0,3).map((source,i)=>`<button type="button" data-sources="${esc(source.id)}" class="ledger-source"><span class="ledger-index">${String(i+1).padStart(2,'0')}</span><span><strong>${esc(source.title)}</strong><small>${esc(source.kind)} · captured ${esc(dateLabel(source.accessedAt?.slice(0,10),issue.locale))}</small></span><span aria-hidden="true">↗</span></button>`).join('')}${sources.length>3?`<button type="button" class="ledger-more" data-sources="">Inspect all ${sources.length} sources ↗</button>`:''}</div></section>`;
}
function coverVisual(image, issue, product) {
  const src=permittedImage(image);
  const edition=esc(issue.edition || '01');
  if(!src) return `<div class="image-wrap no-cover-image"><div class="dossier-grid" aria-hidden="true"></div><span class="dossier-sup">PLATE / ${edition}</span><div class="dossier-figure" aria-hidden="true"><i></i><i></i><i></i></div><div class="no-image-wordmark"><small>SUPPLIER / FILE</small><strong>THE<br>RECORD</strong><p>Product photography pending reuse permission.</p></div><span class="dossier-bottom">This illustration is an editorial device, not product evidence.</span></div>`;
  return `<div class="image-wrap">${imageMarkup(image,{hero:true})}<span class="cover-plate">PLATE / ${edition}</span><div class="cover-visual-overlay"><small>THE SUPPLY FILE</small><span>${esc((product?.category||'Product intelligence').toUpperCase())}</span></div></div>`;
}

/** Render a portable, responsive magazine. No network requests or filesystem writes. */
export function renderMagazine(issue, options = {}) {
  if (!issue || typeof issue !== 'object') throw new TypeError('An issue object is required');
  const products = arr(issue.products);
  const sources = arr(issue.sources);
  const cover = issue.cover || {};
  const firstImage = cover.image || products[0]?.image;
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))];
  const headline = cover.headline || issue.title || 'Your morning sourcing edit';
  const wordmark = issue.title || 'Supply Notes';
  const highlights = arr(issue.highlights).slice(0, 3);
  const edition = text(issue.edition || '01');
  const json = JSON.stringify(clientData(issue)).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const date = dateLabel(issue.date, issue.locale);
  const archetype = resolveArchetype(issue.theme);
  const signals = sourcingSignals(issue);
  const firstProduct = products[0];
  const modular = issue.composition === 'modules';
  const card = issue.composition === 'web-card';
  const en = issue.locale === 'en';
  const moduleTitle = b => b.title ?? moduleById.get(b.type)[en ? 'en' : 'name'];
  const navigation = card ? `<a href="#story">${en?'Cover story':'封面故事'}</a><a href="#showcase">${en?'Curated archive':'精选档案'}</a><a href="#contact">${en?'Next step':'进一步了解'}</a><button type="button" data-sources="">${en?'Sources':'资料来源'} ↗</button>` : modular ? issue.blocks.map(b => `<a href="#${esc(b.id)}">${esc(moduleTitle(b))}</a>`).join('') : `<a href="#buyer-desk-title">Buyer's desk</a><a href="#procurement-index">Compare the edit</a><a href="#today">Product stories</a><button type="button" data-sources="">Evidence <span aria-hidden="true">↗</span></button><button class="nav-save" type="button" data-show-shortlist>Saved <span class="counter" data-count>0</span></button>`;
  const content = card ? webCardSections(issue, {imageMarkup,evidenceChip}) : modular ? `<div class="module-intro"><p class="eyebrow">${en ? 'SELECTED CONTENT / BUYER EDITION' : '本期选编 · 买手微刊'}</p><h1>${esc(issue.title)}</h1><p>${esc(issue.subtitle)}</p></div>${renderModuleBlocks(issue)}` : `<section class="hero" aria-labelledby="cover-title"><div class="hero-copy"><div class="cover-topline"><span>INDEPENDENT SUPPLIER EDITORIAL</span><span>Nº ${esc(edition)}</span></div><p class="eyebrow">${esc(cover.kicker || archetype.label)}</p><h1 id="cover-title">${esc(headline)}</h1><p class="hero-dek">${esc(cover.dek || issue.subtitle)}</p><div class="hero-bottom"><a class="pill-link" href="#buyer-desk-title">Start the edit <span aria-hidden="true">↘</span></a><span class="reading-time">${signals.products} product ${signals.products===1?'story':'stories'}<br>About five minutes to decide</span></div><div class="cover-issue-folio"><span>${esc(archetype.desk)}</span><span>THE 05' EDIT</span></div></div><figure class="hero-art">${coverVisual(firstImage,issue,firstProduct)}<span class="art-label">${esc(archetype.label)}</span><figcaption><span>${esc(imageLabel(firstImage,issue.demo))}</span><span>VOL. ${esc(edition)}</span></figcaption></figure></section>
<section class="issue-ribbon" aria-label="Issue facts"><span>ISSUE ${esc(edition)} / ${esc(date)}</span><span>${esc(archetype.signature)}</span><span>${signals.products} LEADS · ${signals.cited} SOURCE LINKS</span></section>
${buyerDesk(issue,signals)}
${highlights.length ? `<section class="quick-signals" aria-label="In this issue">${highlights.map((h, i) => `<div class="signal"><span class="signal-number">${String(i + 1).padStart(2, '0')}</span><div><strong>${esc(h.label)}</strong><p>${esc(h.text)}</p></div></div>`).join('')}</section>` : ''}
${issue.editorNote ? `<section class="editor-note" aria-label="From the editor"><p class="eyebrow">A note for the buyer</p><p>${esc(issue.editorNote)}</p></section>` : ''}
${procurementIndex(issue)}
<section id="today" aria-labelledby="edit-title"><div class="section-heading"><div><p class="eyebrow">Less searching. Better questions.</p><h2 id="edit-title">The considered edit.</h2></div><p class="section-meta" id="filter-result" aria-live="polite">${products.length} products in this edit</p></div><div class="filter-bar" role="group" aria-label="Filter products by category"><button type="button" data-filter="*" aria-pressed="true">All products</button>${categories.map(category => `<button type="button" data-filter="${esc(category)}" aria-pressed="false">${esc(category)}</button>`).join('')}</div>${products.map((p, i) => productFeature(p, i, issue)).join('')}<p class="empty-filter" id="empty-filter" hidden>No products in this category.</p></section>
<section class="comparison-section" aria-labelledby="decision-title"><div><h2 id="decision-title">Good finds become better questions.</h2><p>Save up to three products, compare the disclosed facts, and take a focused sourcing request into your next conversation.</p></div><button class="quiet-button" type="button" data-download-request>Build a request brief &nbsp; ↓</button></section>
<section class="notes-section" id="buyer-notes" aria-labelledby="notes-title"><div class="section-heading"><div><p class="eyebrow">Before the next conversation</p><h2 id="notes-title">The buyer’s margin.</h2></div><p class="section-meta">Keep these questions close.</p></div><div class="notes-grid">${arr(issue.insights).map(insight => `<article class="note"><p class="eyebrow">${insight.kind === 'inference' ? 'Editorial interpretation' : 'Source observation'}${evidenceChip(insight.sourceIds, sources)}</p><h3>${esc(insight.title)}</h3><p>${esc(insight.body)}</p></article>`).join('')}</div>${arr(issue.dataNotes).length ? `<ul class="data-notes">${issue.dataNotes.map(note => `<li>${esc(note)}</li>`).join('')}</ul>` : ''}</section>
${evidenceLedger(issue,signals)}
<noscript><p class="noscript-note">The complete issue and source list remain readable. Enable JavaScript for shortlisting, comparison and request-brief downloads.</p><ol>${sources.map(s => `<li><a href="${esc(safeHref(s.url, false))}">${esc(s.title)}</a> · ${esc(s.accessedAt)}</li>`).join('')}</ol></noscript>`;
  return localizeChrome(`<!doctype html>
<html lang="${esc(issue.locale || 'en')}" data-composition="${esc(issue.composition || 'studio')}" data-theme="${esc(issue.theme || 'porcelain')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="description" content="${esc(cover.dek || issue.subtitle || '')}"><title>${esc(wordmark)} · ${esc(date)}</title><style>${options.embedFonts === false ? '' : fontFaces}\n${css}\n${card?suppliedCss:''}\n${designCss(issue)}</style></head>
<body><a class="skip-link" href="${modular ? '#'+esc(issue.blocks[0].id) : '#today'}">${modular ? (en ? 'Skip to selected content' : '跳至本期内容') : 'Skip to the product edit'}</a><div class="reading-progress" aria-hidden="true"><i></i></div>
${issue.demo ? '<div class="demo-notice">DEMONSTRATION · fictional supplier data</div>' : ''}
<div class="page-shell">
<header><div class="masthead-top"><p class="eyebrow"><span class="dot"></span>${card ? esc(issue.webCard.issueTag) : 'THE SOURCING MORNING READ. &nbsp; / &nbsp; '+esc(archetype.desk)}</p><p class="masthead-date">${card ? esc(issue.webCard.locationStamp) : esc(date)+' &nbsp; / &nbsp; VOL. '+esc(edition)}</p></div><div class="masthead"><a class="wordmark" href="#">${esc(wordmark)}<span>.</span></a><div class="masthead-right"><span class="masthead-stamp">${esc(archetype.mark)}</span><p class="masthead-tagline">${esc(archetype.signature)}<br>${esc(issue.market || 'Independent buyer edition')}</p></div></div><nav class="issue-nav" aria-label="Issue navigation">${navigation}</nav></header>
<main>
${content}
</main>
${card ? `<footer class="issue-footer">${esc(issue.design.brand)} · ${esc(date)} · ${en?'Independent editorial edition':'独立编辑特刊'}</footer>` : modular ? `<footer class="issue-footer"><p>${en ? 'Prepared for the stated audience. Sources and assumptions accompany the selected sections. Working draft; not sent or published.' : '按本期读者与选定模块编排；相关依据和假设随内容展示。工作稿，尚未发送或发布。'}</p></footer>` : `<footer class="issue-footer"><div><p class="footer-wordmark">${esc(wordmark)}.</p><p>A little less noise. A little more perspective.<br>Sourcing, with the details that matter.</p></div><div><p class="eyebrow">The evidence standard</p><p>${issue.demo ? 'Demonstration content. All supplier data in this issue is fictional.' : 'Facts retain their sources. Unknown terms stay unknown. Retail prices do not imply wholesale offers.'}</p><button type="button" data-sources="">Read all ${sources.length} source records ↗</button></div><div><p class="eyebrow">Your next move</p><p>Shortlist locally. Review the facts.<br>Confirm terms with your supplier.</p><button type="button" data-print>Print / save as PDF ↗</button></div></footer>
<section class="print-source-list" aria-label="Print source records"><h2>Source notes</h2><ol>${sources.map(s => `<li><strong>${esc(s.title)}</strong> — ${esc(s.publisher)}<br>${esc(s.url)} · Accessed: ${esc(s.accessedAt)}</li>`).join('')}</ol></section>`}
</div>
${modular ? '' : `<aside id="shortlist-dock" class="shortlist-dock" aria-label="Your local shortlist" hidden><p><span data-count>0</span> products saved<small data-storage-note>Only in this browser · up to 3</small></p><div class="dock-actions"><button class="quiet-button" type="button" data-compare disabled>Compare</button><button class="pill-button" type="button" data-download-request>Request brief ↓</button></div></aside>
<div id="toast" class="toast" role="status" aria-live="polite" aria-atomic="true"></div>
`}${modular ? '' : `${sourceDrawer(issue)}${comparisonDialog()}<script id="issue-data" type="application/json">${json}</script><script>${client}</script>`}</body></html>`, issue.locale);
}

/** Generate a script-free, inline-styled email digest. Publication/send is owned by the caller. */
export function renderEmail(issue, options = {}) {
  if (!issue || typeof issue !== 'object') throw new TypeError('An issue object is required');
  const products = arr(issue.products);
  const magazineUrl = safeHref(options.magazineUrl || issue.magazineUrl, false);
  const date = dateLabel(issue.date, issue.locale);
  const cover = issue.cover || {};
  const linkStyle = 'color:#263c33;font-family:Arial,sans-serif;font-size:12px;font-weight:bold;text-decoration:underline;';
  function emailImage(image) {
    let href = permittedImage(image);
    if (href.startsWith('assets/') && options.assetBaseUrl && safeHref(options.assetBaseUrl, false).startsWith('https://')) {
      try { href = new URL(href, options.assetBaseUrl.endsWith('/') ? options.assetBaseUrl : options.assetBaseUrl + '/').href; } catch { href = ''; }
    }
    // Local image references are unsuitable for email; include only public HTTPS assets explicitly cleared for reuse.
    return href.startsWith('https://') ? `<img src="${esc(href)}" alt="${esc(image.alt || '')}" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;">` : '';
  }
  return `<!doctype html><html lang="${esc(issue.locale || 'en')}" data-composition="${esc(issue.composition || 'studio')}" data-theme="${esc(issue.theme || 'porcelain')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(issue.title || 'Supply Notes')} · ${esc(date)}</title></head><body style="margin:0;padding:0;background:#f4f1ea;color:#202820;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(cover.dek || issue.subtitle || 'Your five-minute sourcing edit.')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f1ea;"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;">
${issue.demo ? '<tr><td style="padding:10px 18px;background:#263c33;color:#fffdf8;text-align:center;font-family:Arial,sans-serif;font-size:10px;letter-spacing:1px;">DEMONSTRATION · fictional supplier data</td></tr>' : ''}
<tr><td style="padding:24px 28px 20px;border-bottom:2px solid #202820;"><p style="margin:0 0 12px;font:10px Arial,sans-serif;color:#65675e;letter-spacing:1px;">THE SOURCING MORNING READ. &nbsp; ${esc(date)}</p><p style="margin:0;font:42px Georgia,serif;letter-spacing:-2px;color:#202820;">${esc(issue.title || 'Supply Notes')}.</p></td></tr>
<tr><td style="padding:30px 28px 26px;"><p style="margin:0 0 15px;font:bold 10px Arial,sans-serif;letter-spacing:1px;color:#a83f2c;">${esc(cover.kicker || 'THE MORNING EDIT')}</p><h1 style="margin:0 0 17px;font:42px/1.07 Georgia,serif;letter-spacing:-1.5px;color:#202820;">${esc(cover.headline || issue.title)}</h1><p style="margin:0;font:14px/1.8 Arial,sans-serif;color:#65675e;">${esc(cover.dek || issue.subtitle)}</p>${magazineUrl ? `<p style="margin:20px 0 0;"><a href="${esc(magazineUrl)}" style="${linkStyle}">Read the interactive issue ↗</a></p>` : ''}</td></tr>
${products.map((p, index) => {
    const url = safeHref(p.cta?.url, false);
    const fields = arr(p.specs).filter(s => s.visibility !== 'restricted').slice(0, 2);
    return `<tr><td style="padding:26px 28px;border-top:1px solid #c8c5b8;">${emailImage(p.image)}${p.sponsored ? `<p style="margin:10px 0;font:10px Arial,sans-serif;color:#a83f2c;">Sponsored · ${esc(p.sponsored.sponsor || p.sponsored.label)}</p>` : ''}<p style="margin:16px 0 11px;font:bold 10px Arial,sans-serif;letter-spacing:1px;color:#a83f2c;">${String(index + 1).padStart(2, '0')} / ${esc(p.category || 'Product')} / ${esc(p.region || 'Origin unconfirmed')}</p><h2 style="margin:0 0 10px;font:29px/1.2 Georgia,serif;color:#202820;">${esc(p.name)}</h2><p style="margin:0 0 15px;font:11px Arial,sans-serif;color:#65675e;">${esc(p.supplier)}</p><p style="margin:0 0 18px;font:13px/1.85 Arial,sans-serif;">${esc(p.summary)}</p><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font:11px/1.6 Arial,sans-serif;">${[...fields.map(s => [s.label || s.key, valueText(s)]), ['MOQ', valueText(p.moq)], ['Lead time', valueText(p.leadTime)], [p.price?.kind === 'retail' ? 'Retail reference, not wholesale' : 'Quote context', priceText(p.price, issue.locale)]].map(([k, v]) => `<tr><th scope="row" align="left" style="padding:8px 12px 8px 0;border-bottom:1px solid #c8c5b8;font-weight:normal;color:#65675e;vertical-align:top;width:40%;">${esc(k)}</th><td style="padding:8px 0;border-bottom:1px solid #c8c5b8;vertical-align:top;">${esc(v)}</td></tr>`).join('')}</table><p style="margin:16px 0;font:11px/1.7 Arial,sans-serif;color:#65675e;"><strong style="color:#202820;">Before you commit.</strong> ${esc(p.watchout || 'Confirm terms and evidence with the supplier.')}</p>${url && !issue.demo ? `<a href="${esc(url)}" style="${linkStyle}">${esc(p.cta?.label || 'View product source')} ↗</a>` : '<p style="margin:8px 0;font:10px Arial,sans-serif;color:#65675e;">Demonstration source · not a live supplier offer</p>'}</td></tr>`;
  }).join('')}
<tr><td style="padding:24px 28px;border-top:2px solid #202820;"><p style="margin:0 0 14px;font:22px Georgia,serif;">Source notes</p>${arr(issue.sources).map((s, i) => `<p style="margin:9px 0;font:10px/1.7 Arial,sans-serif;color:#65675e;">[${i + 1}] ${safeHref(s.url, false) ? `<a href="${esc(safeHref(s.url, false))}" style="color:#263c33;">${esc(s.title)}</a>` : esc(s.title)} · accessed ${esc(dateLabel(s.accessedAt?.slice(0, 10), issue.locale))}</p>`).join('')}<p style="margin:20px 0 0;font:10px/1.8 Arial,sans-serif;color:#65675e;">${issue.demo ? 'All supplier details in this sample issue are fictional.' : 'Supplier statements are attributed claims. Unknown terms stay unknown. Confirm quotations and compliance before ordering.'}</p>${options.unsubscribeUrl && safeHref(options.unsubscribeUrl, false) ? `<p style="margin:12px 0 0;"><a href="${esc(safeHref(options.unsubscribeUrl, false))}" style="font:10px Arial,sans-serif;color:#65675e;">Manage subscription</a></p>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
}
