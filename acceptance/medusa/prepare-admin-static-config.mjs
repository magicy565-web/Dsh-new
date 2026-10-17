// Used only on the UI build-stage copy; the API source/config stays unchanged.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

if (process.argv.length !== 3) throw Error('Use one build-stage config path.');
const file = process.argv[2];
const source = await readFile(file, 'utf8');
const expected = 'da8cf186c8335ada5b7332cfbe1528ad8b3b10ed5ce9d445bebcc4218f960791';
const before = ' admin: { disable: true },';
const after = " admin: { disable: true, path: '/dashboard', backendUrl: '' },";
if (createHash('sha256').update(source).digest('hex') !== expected
    || source.split(before).length !== 2)
  throw Error('Original Medusa config changed; review the exact static-build transform.');
await writeFile(file, source.replace(before, after), 'utf8');
