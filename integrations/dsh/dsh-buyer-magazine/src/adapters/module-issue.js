import { createHash } from 'node:crypto';
import { validateModuleIssue } from '../modules/validate.js';

// Compatibility input becomes the same Studio issue consumed by the native tools.
// Empty metadata means not supplied; no supplier, URL, price or collection time is invented.
export function normalizeModuleIssue(input) {
  const issue = validateModuleIssue(input);
  const dates = issue.blocks.flatMap(block => (block.evidence ?? []).map(source => source.date)).sort();
  const date = issue.date ?? (dates[0]?.slice(0, 10) || '');
  const en = issue.language === 'en';
  return {
    schemaVersion: '1.0', composition: 'modules',
    id: issue.id ?? `modules-${createHash('sha256').update(JSON.stringify(issue)).digest('hex').slice(0, 16)}`,
    edition: issue.edition ?? '01', title: issue.title, subtitle: issue.audience, date,
    locale: en ? 'en' : 'zh-CN', market: issue.audience, theme: issue.theme ?? 'porcelain', demo: issue.preview ?? false,
    cover: { kicker: en ? 'Buyer magazine' : '买手微刊', headline: issue.title, dek: issue.audience, image: null },
    editorNote: '', highlights: [], products: [], sources: [], insights: [], dataNotes: [],
    provenance: { mode: issue.preview ? 'demo' : 'import', collectedAt: dates[0] ? new Date(dates[0]).toISOString() : '' },
    blocks: structuredClone(issue.blocks),
  };
}

export function normalizeIssue(input) {
  return input && !Object.hasOwn(input, 'schemaVersion') && Object.hasOwn(input, 'blocks')
    ? normalizeModuleIssue(input) : input;
}
