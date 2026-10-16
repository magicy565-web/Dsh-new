// Data validation only. Writing and tool selection belong to the official model
// AgentSession; this module generates no quotation, sample or follow-up body.
import { createHash } from 'node:crypto';
export const factoryInquiryHash = value => createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])]));
  return value;
}
// Preserve the original ./drafts import while publishing the canonical DTO contract.
export { validateInquiryDrafts } from './contracts.mjs';
