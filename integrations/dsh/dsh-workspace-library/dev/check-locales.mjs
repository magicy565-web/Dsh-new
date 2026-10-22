// Development helper: verify the client locale dictionaries stay in sync.
//
// Checks that zh and en declare the same keys, that every t('...') key used in
// client.js exists, and that no dictionary key is duplicated. Run after adding
// or renaming UI text.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'client.js'), 'utf8');

function dictionaryKeys(name) {
  const start = source.indexOf(`const ${name} = {`);
  if (start < 0) throw new Error(`dictionary ${name} not found`);
  const end = source.indexOf('\n    };', start);
  if (end < 0) throw new Error(`dictionary ${name} is not terminated`);
  const body = source.slice(start, end);
  const keys = [...body.matchAll(/'([^']+)':/gu)].map(match => match[1]);
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  return { keys, duplicates: [...new Set(duplicates)] };
}

const zh = dictionaryKeys('zh');
const en = dictionaryKeys('en');
const zhSet = new Set(zh.keys);
const enSet = new Set(en.keys);

const used = [...source.matchAll(/\bt\('([^']+)'\)/gu)]
  .map(match => match[1])
  .filter(key => key.includes('.') && !key.startsWith('/'));

const problems = [];
for (const key of used) if (!zhSet.has(key)) problems.push(`missing zh key: ${key}`);
for (const key of used) if (!enSet.has(key)) problems.push(`missing en key: ${key}`);
for (const key of zhSet) if (!enSet.has(key)) problems.push(`only in zh: ${key}`);
for (const key of enSet) if (!zhSet.has(key)) problems.push(`only in en: ${key}`);
for (const key of zh.duplicates) problems.push(`duplicate zh key: ${key}`);
for (const key of en.duplicates) problems.push(`duplicate en key: ${key}`);

console.log(`zh ${zh.keys.length} keys, en ${en.keys.length} keys, used ${new Set(used).size}`);
if (problems.length) {
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log('locale dictionaries are consistent.');
}
