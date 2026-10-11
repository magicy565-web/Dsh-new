import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { validatePrivateWindowsAcl, assertPrivateWindowsPath } from '../server/windows-private-acl.mjs';
import { privateDirectory, openPrivateFile } from '../server/store.mjs';

const userSid = 'S-1-5-21-1-2-3-1001';
const privateAcl = () => ({ userSid, ownerSid: userSid, hasDacl: true, rules: [{ sid: userSid, type: 'Allow', rights: 0x1f01ff, inheritOnly: false }] });
test('real DACL policy rejects null DACL, foreign grants/owner and inherit-only permissions', () => {
  assert.equal(validatePrivateWindowsAcl(privateAcl()).userSid, userSid);
  for (const value of [
    { ...privateAcl(), hasDacl: false }, { ...privateAcl(), ownerSid: 'S-1-1-0' },
    { ...privateAcl(), rules: [...privateAcl().rules, { sid: 'S-1-1-0', type: 'Allow', rights: 1 }] },
    { ...privateAcl(), rules: [{ ...privateAcl().rules[0], inheritOnly: true }] },
  ]) assert.throws(() => validatePrivateWindowsAcl(value), { code: 'WORKSPACE_PRIVATE_ACL_REQUIRED' });
});
test('Windows private storage narrows an empty object before bytes, reopens, and retains unsafe legacy data', { skip: process.platform !== 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'workspace-private-acl-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacy = path.join(root, 'legacy'); await fs.mkdir(legacy);
  const original = Buffer.from('preserve existing store bytes'); await fs.writeFile(path.join(legacy, 'workspace.json'), original);
  await assert.rejects(privateDirectory(legacy), { code: 'WORKSPACE_PRIVATE_ACL_REQUIRED' });
  assert.deepEqual(await fs.readFile(path.join(legacy, 'workspace.json')), original);
  const secure = await privateDirectory(path.join(root, 'private-企业资料'));
  await secure.verify();
  const filename = path.join(secure.directory, 'result-成果'); await fs.writeFile(filename, original);
  await assertPrivateWindowsPath(filename);
  const handle = await openPrivateFile(filename);
  try { assert.deepEqual(await handle.readFile(), original); } finally { await handle.close(); }
});
