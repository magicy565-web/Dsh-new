import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileDraft } from './compiler.js';
import { normalizeIssue } from './adapters.js';
import { modules } from './src/modules/catalog.js';

export function renderIssue(input, options) {
  // Detailed adapter errors remain local; native tools use fixed error codes.
  return compileDraft(JSON.stringify(normalizeIssue(input)), options).data.toString('utf8');
}
export async function main(args) {
  if (args.length === 1 && args[0] === '--list') { console.log(JSON.stringify(modules, null, 2)); return; }
  if (args.length !== 2) throw new Error('Usage: node cli.js --list | <issue.json> <new-output.html>');
  const issue = JSON.parse(await readFile(resolve(args[0]), 'utf8'));
  await writeFile(resolve(args[1]), renderIssue(issue), { flag: 'wx', mode: 0o600 });
  console.log(`Created ${args[1]} as a review draft.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
