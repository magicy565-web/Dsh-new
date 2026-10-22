// Quote export: CSV and a printable page. Pure functions, no HTTP, no I/O.
//
// CSV rules that matter here:
//   * quote every cell, double the internal quotes, keep commas and newlines;
//   * defuse spreadsheet formulas: a cell starting with = + - @ gets a leading
//     apostrophe, so an exported quote cannot execute anything in Excel.

export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/gu, '""')}"`;
}

export function quoteCsv(quote) {
  const rows = [
    ['单号', '客户', '币种', '状态', '创建时间'],
    [quote.number, quote.customer, quote.currency, quote.status, quote.createdAt],
    [],
    ['描述', '数量', '单价', '金额'],
    ...quote.lines.map(line => [line.description, line.quantity, (line.unitPriceMinor / 100).toFixed(2), line.amount]),
    [],
    ['合计', '', '', quote.total],
  ];
  return `${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

export function quotePrintPage(quote) {
  const lines = quote.lines.map(line => `
      <tr><td>${escapeHtml(line.description)}</td><td class="num">${escapeHtml(line.quantity)}</td>
      <td class="num">${escapeHtml((line.unitPriceMinor / 100).toFixed(2))}</td><td class="num">${escapeHtml(line.amount)}</td></tr>`).join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(quote.number)} · 报价单</title>
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
  @media print { body { margin: 12mm; } button { display: none; } }
</style></head>
<body>
  <h1>报价单 ${escapeHtml(quote.number)}</h1>
  <div class="meta">客户：${escapeHtml(quote.customer)} · 币种：${escapeHtml(quote.currency)} · 状态：${escapeHtml(quote.status)} · 创建：${escapeHtml(quote.createdAt.slice(0, 10))}</div>
  <table>
    <thead><tr><th>描述</th><th class="num">数量</th><th class="num">单价</th><th class="num">金额</th></tr></thead>
    <tbody>${lines}
    </tbody>
    <tfoot><tr><td colspan="3">合计</td><td class="num">${escapeHtml(quote.total)}</td></tr></tfoot>
  </table>
  ${quote.note ? `<p class="note">${escapeHtml(quote.note)}</p>` : ''}
</body></html>`;
}
