(function () {
  'use strict';
  const node = document.getElementById('issue-data');
  if (!node) return;
  let issue;
  try { issue = JSON.parse(node.textContent); } catch { return; }
  const products = Array.isArray(issue.products) ? issue.products : [];
  const byId = new Map(products.map(p => [p.id, p]));
  const storageKey = 'buyer-magazine:shortlist:v1:' + issue.id;
  let selected = new Set();
  let storageAvailable = true;
  try {
    const previous = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(previous)) selected = new Set(previous.filter(id => byId.has(id)).slice(0, 3));
  } catch { storageAvailable = false; }
  const toast = document.getElementById('toast');
  let toastTimer;
  function announce(message) {
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.textContent = message;
    toastTimer = setTimeout(() => { toast.textContent = ''; }, 4400);
  }
  function updateSaved() {
    document.querySelectorAll('[data-save]').forEach(button => {
      const active = selected.has(button.dataset.save);
      button.setAttribute('aria-pressed', String(active));
      const label = button.querySelector('[data-save-label]');
      if (label) label.textContent = active ? 'Saved' : 'Shortlist';
      const mark = button.querySelector('[data-save-mark]');
      if (mark) mark.textContent = active ? '✓' : '+';
    });
    document.querySelectorAll('[data-count]').forEach(el => { el.textContent = String(selected.size); });
    document.querySelectorAll('[data-compare]').forEach(el => { el.disabled = selected.size < 2; });
    const dock = document.getElementById('shortlist-dock');
    if (dock) dock.hidden = selected.size === 0;
    if (storageAvailable) { try { localStorage.setItem(storageKey, JSON.stringify([...selected])); } catch { storageAvailable = false; } }
    document.querySelectorAll('[data-storage-note]').forEach(el => { el.textContent = storageAvailable ? 'Only in this browser · up to 3' : 'This session only · download before closing'; });
  }
  document.querySelectorAll('[data-save]').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.dataset.save;
      if (!byId.has(id)) return;
      if (selected.has(id)) {
        selected.delete(id);
        announce(byId.get(id).name + ' removed from your shortlist.');
      } else if (selected.size === 3) {
        announce('Your comparison holds three products. Remove one before adding another.');
        return;
      } else {
        selected.add(id);
        announce(byId.get(id).name + ' saved. Your shortlist stays in this browser.');
      }
      updateSaved();
      if (!storageAvailable && selected.has(id)) announce('Saved for this session only. Download your request brief before closing.');
    });
  });
  document.querySelectorAll('[data-filter]').forEach(button => {
    button.addEventListener('click', () => {
      const category = button.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      let count = 0;
      document.querySelectorAll('[data-product-category]').forEach(el => {
        const show = category === '*' || el.dataset.productCategory === category;
        el.hidden = !show;
        if (show) count++;
      });
      const empty = document.getElementById('empty-filter');
      if (empty) empty.hidden = count !== 0;
      const output = document.getElementById('filter-result');
      if (output) output.textContent = count + (count === 1 ? ' product' : ' products') + ' in this edit';
    });
  });
  const focusOwners = new WeakMap();
  function openDialog(dialog, trigger) {
    if (!dialog) return;
    focusOwners.set(dialog, trigger || document.activeElement);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else { dialog.setAttribute('open', ''); dialog.setAttribute('role', 'dialog'); }
    const close = dialog.querySelector('[data-close]');
    if (close) close.focus();
  }
  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    const previous = focusOwners.get(dialog);
    if (previous && typeof previous.focus === 'function') previous.focus();
  }
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(dialog); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(dialog); });
    dialog.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeDialog(dialog)));
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closeDialog(dialog); return; }
      if (event.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]')].filter(el => !el.hidden && el.getClientRects().length);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  });
  document.querySelectorAll('[data-sources]').forEach(button => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById('sources-dialog');
      if (!dialog) return;
      const sourceId = button.dataset.sources;
      dialog.querySelectorAll('[data-source-record]').forEach(el => {
        el.dataset.highlight = String(Boolean(sourceId) && el.dataset.sourceRecord === sourceId);
      });
      openDialog(dialog, button);
      const target = [...dialog.querySelectorAll('[data-source-record]')].find(el => el.dataset.sourceRecord === sourceId);
      if (target) target.scrollIntoView({ block: 'nearest' });
    });
  });
  const flat = value => String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  function fieldText(field) {
    if (!field || field.status === 'unknown' || field.value === undefined || field.value === null || field.value === '') return 'Not disclosed';
    return flat(field.value) + (field.unit ? ' ' + flat(field.unit) : '');
  }
  function priceText(price) {
    if (!price || price.status === 'unknown' || price.kind === 'unknown' || price.kind === 'request-quote' || price.amount == null) return 'Request a project quote';
    let label;
    // Source text can be a range or qualified quote, not a number to coerce.
    if (typeof price.amount === 'string') label = flat(price.amount) + (price.currency ? ' ' + flat(price.currency) : '');
    else {
      try { label = new Intl.NumberFormat(issue.locale || 'en', { style: 'currency', currency: price.currency || 'USD' }).format(price.amount); }
      catch { label = flat(price.currency) + ' ' + String(price.amount); }
    }
    const context = price.kind === 'retail' ? 'retail reference only' : 'wholesale, ' + flat(price.basis || 'basis not provided')
      + (price.minQty != null ? ' · quote quantity basis: ' + flat(price.minQty) + ' units' : '');
    return label + (price.unit ? ' / ' + flat(price.unit) : '') + ' · ' + context;
  }
  function renderComparison() {
    const table = document.getElementById('comparison-table');
    if (!table) return;
    table.replaceChildren();
    const chosen = [...selected].map(id => byId.get(id));
    const caption = document.createElement('caption');
    caption.textContent = 'Compare disclosed facts. Unknown terms require supplier confirmation.';
    table.append(caption);
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    const topLeft = document.createElement('th'); topLeft.scope = 'col'; topLeft.textContent = 'Buying decision'; tr.append(topLeft);
    chosen.forEach(p => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = p.name; tr.append(th); });
    thead.append(tr); table.append(thead);
    const rows = [
      ['Supplier', p => p.supplier || 'Not disclosed'],
      ['Buyer fit', p => p.buyerFit || 'Assess against your assortment'],
      ['Price context', p => priceText(p.price)],
      ['MOQ', p => fieldText(p.moq)],
      ['Lead time', p => fieldText(p.leadTime)],
    ];
    const specKeys = [];
    chosen.forEach(p => (p.specs || []).filter(s => s.visibility !== 'restricted').forEach(s => { if (!specKeys.includes(s.key)) specKeys.push(s.key); }));
    specKeys.slice(0, 8).forEach(key => {
      const spec = chosen.flatMap(p => p.specs || []).find(s => s.key === key);
      rows.push([spec.label || key, p => fieldText((p.specs || []).find(s => s.key === key && s.visibility !== 'restricted'))]);
    });
    rows.push(['Confirm before ordering', p => p.watchout || 'Confirm final specification, terms and availability.']);
    const body = document.createElement('tbody');
    rows.forEach(([label, value]) => {
      const row = document.createElement('tr');
      const th = document.createElement('th'); th.scope = 'row'; th.textContent = label; row.append(th);
      chosen.forEach(p => { const td = document.createElement('td'); td.textContent = value(p); row.append(td); });
      body.append(row);
    });
    table.append(body);
  }
  document.querySelectorAll('[data-compare]').forEach(button => {
    button.addEventListener('click', () => {
      if (selected.size < 2) { announce('Shortlist at least two products to compare.'); return; }
      renderComparison(); openDialog(document.getElementById('comparison-dialog'), button);
    });
  });
  document.querySelectorAll('[data-show-shortlist]').forEach(button => {
    button.addEventListener('click', () => {
      if (!selected.size) { announce('Use Shortlist beside a product to save it here.'); return; }
      if (selected.size >= 2) { renderComparison(); openDialog(document.getElementById('comparison-dialog'), button); }
      else {
        const id = [...selected][0];
        const target = [...document.querySelectorAll('[data-product-id]')].find(el => el.dataset.productId === id);
        const all = document.querySelector('[data-filter="*"]'); if (all) all.click();
        if (target) target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      }
    });
  });
  function requestSourceIds(product) {
    // Carry the evidence for each exported field, not only the product summary.
    const fields = [product.price, product.moq, product.leadTime, ...(product.specs || [])]
      .filter(field => field && field.visibility !== 'restricted');
    return [...new Set([...(product.sourceIds || []), ...fields.flatMap(field => field.sourceIds || [])])];
  }
  function downloadRequest() {
    const chosen = selected.size ? [...selected].map(id => byId.get(id)) : products;
    const text = [
      '# Sourcing request brief',
      '',
      flat(issue.title) + ' · ' + flat(issue.date),
      issue.demo ? 'DEMONSTRATION — fictional supplier data. Do not send as a real supplier request.' : 'Draft for your review. This file has not been sent.',
      '',
      '## Buyer details to complete',
      '- Company / website:', '- Destination market:', '- Target quantity:', '- Target delivery date:', '- Customisation required:',
      '',
      ...chosen.flatMap(p => [
        '## ' + flat(p.name),
        '- Supplier: ' + flat(p.supplier || 'Not disclosed'),
        '- Category: ' + flat(p.category || 'Not disclosed'),
        '- Published price context: ' + priceText(p.price),
        '- Published MOQ: ' + fieldText(p.moq),
        '- Published lead time: ' + fieldText(p.leadTime),
        ...(p.specs || []).filter(s => s.visibility !== 'restricted').map(s => '- ' + flat(s.label || s.key) + ': ' + fieldText(s)),
        '- Please confirm: ' + flat(p.watchout || 'Final specification, sample availability, quotation basis and delivery terms.'),
        '- Questions: quote for the requested quantity; sample cost; production lead time; packaging; product-specific compliance evidence.',
        ...(requestSourceIds(p).map(id => (issue.sources || []).find(s => s.id === id)).filter(Boolean).map(s => '- Source: ' + flat(s.url) + ' (accessed ' + flat(s.accessedAt) + ')')),
        ''
      ]),
      '## Next step',
      'Review and add your requirements before sharing with a supplier. No messages have been sent by this magazine.',
      ''
    ].join('\n');
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url;
    anchor.download = 'sourcing-request-' + String(issue.id || 'brief').replace(/[^a-z0-9_-]/gi, '-') + '.md';
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    announce('Request brief downloaded. Nothing has been sent.');
  }
  document.querySelectorAll('[data-download-request]').forEach(b => b.addEventListener('click', downloadRequest));
  document.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => window.print()));
  let scrollQueued = false;
  function progress() {
    const available = document.documentElement.scrollHeight - innerHeight;
    const value = available > 0 ? Math.min(100, Math.max(0, scrollY / available * 100)) : 100;
    const bar = document.querySelector('.reading-progress i'); if (bar) bar.style.width = value + '%';
    scrollQueued = false;
  }
  addEventListener('scroll', () => { if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(progress); } }, { passive: true });
  addEventListener('resize', progress, { passive: true });
  updateSaved(); progress();
})();
