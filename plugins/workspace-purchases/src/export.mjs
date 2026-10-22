// Purchase order export: CSV and a printable page. Pure functions, no I/O.
// Same CSV rules as quotes: quote every cell, double internal quotes, and
// defuse spreadsheet formulas with a leading apostrophe.

export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/gu, '""')}"`;
}

export function purchaseCsv(order) {
  const rows = [
    ['单号', '供应商', '币种', '状态', '批准人', '创建时间'],
    [order.number, order.supplier, order.currency, order.status, order.approvedBy ?? '', order.createdAt],
    [],
    ['描述', '数量', '单价', '金额'],
    ...order.lines.map(line => [line.description, line.quantity, (line.unitPriceMinor / 100).toFixed(2), line.amount]),
    [],
    ['合计', '', '', order.total],
  ];
  return `${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

export function purchasePrintPage(order) {
  const lines = order.lines.map(line => `
      <tr><td>${escapeHtml(line.description)}</td><td class="num">${escapeHtml(line.quantity)}</td>
      <td class="num">${escapeHtml((line.unitPriceMinor / 100).toFixed(2))}</td><td class="num">${escapeHtml(line.amount)}</td></tr>`).join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(order.number)} · 采购单</title>
<style>
  body { font: 13px/1.6 ui-sans-serif, system-ui, "Microsoft YaHei", sans-serif; margin: 36px; color: #111; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #555; font-size: 12px; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #ddd; padding: 6px 4px; text-align: left; }
  th { font-weight: 600; font-size: 12px; color: #444; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 700; border-top: 2px solid #111; }
  .note { margin-top: 14px; color: #555; font-size: 12px; white-space: pre-wrap; }
  @media print { body { margin: 12mm; } }
</style></head>
<body>
  <h1>采购单 ${escapeHtml(order.number)}</h1>
  <div class="meta">供应商：${escapeHtml(order.supplier)} · 币种：${escapeHtml(order.currency)} · 状态：${escapeHtml(order.status)}${order.approvedBy ? ` · 批准人：${escapeHtml(order.approvedBy)}` : ''}</div>
  <table>
    <thead><tr><th>描述</th><th class="num">数量</th><th class="num">单价</th><th class="num">金额</th></tr></thead>
    <tbody>${lines}
    </tbody>
    <tfoot><tr><td colspan="3">合计</td><td class="num">${escapeHtml(order.total)}</td></tr></tfoot>
  </table>
  ${order.note ? `<p class="note">${escapeHtml(order.note)}</p>` : ''}
</body></html>`;
}
