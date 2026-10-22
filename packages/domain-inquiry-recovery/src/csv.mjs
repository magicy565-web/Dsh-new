// Minimal, dependency-free RFC-4180 CSV reader for authorized historical-inquiry
// imports. The domain package owns this parser: it rejects column drift instead
// of guessing, and it fails with the package error class.
import { InquiryError } from './errors.mjs';

const fail = (status, code, message) => { throw new InquiryError(status, code, message); };

export const MAX_IMPORT_BYTES = 64 * 1024;
export const REQUIRED_COLUMNS = ['leadId', 'sourceId', 'revision'];
export const COLUMNS = [...REQUIRED_COLUMNS, 'companyName', 'companyUrl', 'contactEmail', 'customerName', 'productId', 'product',
  'quantity', 'unit', 'destination', 'requestedAt', 'receivedAt', 'lastContactAt', 'status', 'body', 'history', 'facts',
  'requestedCertifications'];

/** Minimal RFC-4180 reader: no dependencies, rejects column drift instead of guessing. */
export function parseCsv(source) {
  if (typeof source !== 'string') fail(400, 'INQUIRY_IMPORT_INVALID', 'CSV import requires text.');
  if (Buffer.byteLength(source, 'utf8') > MAX_IMPORT_BYTES) fail(413, 'INQUIRY_IMPORT_TOO_LARGE', 'The CSV exceeds 64 KiB.');
  const input = source.replace(/^\uFEFF/u, '');
  const rows = [];
  let field = '', row = [], quoted = false, closed = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') { field += '"'; index++; } else { quoted = false; closed = true; }
      } else field += char;
      continue;
    }
    if (closed && char !== ',' && char !== '\n' && char !== '\r')
      fail(400, 'INQUIRY_IMPORT_INVALID', 'Only a delimiter may follow a closing CSV quote.');
    if (char === '"') {
      if (field) fail(400, 'INQUIRY_IMPORT_INVALID', 'A quote may only open a CSV field.');
      quoted = true;
    } else if (char === ',') { row.push(field); field = ''; closed = false; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; closed = false; }
    else if (char === '\r') { if (input[index + 1] === '\n') index++; row.push(field); rows.push(row); row = []; field = ''; closed = false; }
    else field += char;
  }
  if (quoted) fail(400, 'INQUIRY_IMPORT_INVALID', 'The CSV contains an unterminated quoted field.');
  if (field || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter(cells => cells.some(cell => cell.trim()));
  if (!nonEmpty.length) fail(400, 'INQUIRY_IMPORT_EMPTY', 'The CSV contains no data rows.');
  const header = nonEmpty[0].map(cell => cell.trim());
  if (header.some((name, index) => !name || header.indexOf(name) !== index || !COLUMNS.includes(name)))
    fail(400, 'INQUIRY_IMPORT_COLUMNS', `CSV columns must be unique and chosen from: ${COLUMNS.join(', ')}.`);
  if (!REQUIRED_COLUMNS.every(name => header.includes(name)))
    fail(400, 'INQUIRY_IMPORT_COLUMNS', 'CSV must include leadId, sourceId and revision.');
  const records = [];
  for (const cells of nonEmpty.slice(1)) {
    if (cells.length > header.length && cells.slice(header.length).some(cell => cell.trim()))
      fail(400, 'INQUIRY_IMPORT_COLUMNS', 'A CSV row has more cells than the header.');
    const record = {};
    header.forEach((name, index) => { record[name] = cells[index] ?? ''; });
    records.push(record);
  }
  return records;
}
