// Synthetic acceptance data, never imported by plugin startup.
export const row = (changes = {}) => ({
  leadId: 'linen-buyer', sourceId: 'synthetic-crm', revision: 1, companyName: 'Synthetic Buyer', companyUrl: 'https://buyer.example',
  contactEmail: 'sam@buyer.example', customerName: 'Sam', productId: 'prd_fixture', product: 'Linen 165 GSM', quantity: 500, unit: 'pieces',
  lastContactAt: '2026-10-01', status: 'active',
  history: [{ id: 'm1', direction: 'inbound', sentAt: '2026-10-01', body: 'We were evaluating 500 pieces of linen. Please provide a specification sheet.' }],
  facts: [{ kind: 'rfq', sourceMessageId: 'm1', quote: '500 pieces of linen', occurredAt: '2026-10-01' }], ...changes,
});
export function toCsv(rows) {
  const columns = Object.keys(rows[0]);
  const quote = value => '"' + String(typeof value === 'object' ? JSON.stringify(value) : value ?? '').replaceAll('"', '""') + '"';
  return columns.join(',') + '\n' + rows.map(row => columns.map(key => quote(row[key])).join(',')).join('\n') + '\n';
}
