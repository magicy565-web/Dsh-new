import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { blocksFromErp, erpMain } from 'dsh-buyer-magazine/adapters';
export { blocksFromErp } from 'dsh-buyer-magazine/adapters';
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) erpMain(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
