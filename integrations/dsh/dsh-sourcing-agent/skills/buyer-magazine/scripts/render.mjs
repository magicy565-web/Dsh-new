import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main } from 'dsh-buyer-magazine/cli';
export { renderIssue, main } from 'dsh-buyer-magazine/cli';
export { validateModuleIssue as validateIssue } from 'dsh-buyer-magazine/adapters';
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
