import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('original Pi runtime exposes the caller guard hook instead of shadowing it',async()=>{
  const source=await readFile(new URL('../scripts/pi-workspace-agent.mjs',import.meta.url),'utf8');
  assert.match(source,/prepareSession = async \(\) => \{\}/);
  assert.match(source,/additionalContextValidators = \[\]/);
  assert.match(source,/additionalExtensionFactories = \[\]/);
  assert.match(source,/const installGuards = async session =>/);
  assert.doesNotMatch(source,/const prepareSession = async session =>/);
  assert.match(source,/await prepareSession\(session\)/);
  assert.match(source,/await validateExtras\(signal\)/);
});
test('business Agent attaches and passes one scoped Brain extension to the original AgentSession',async()=>{
  const source=await readFile(new URL('../server/pi-business-agent.mjs',import.meta.url),'utf8');
  assert.match(source,/goalBrain/);
  assert.match(source,/businessBrainExtension/);
  assert.match(source,/cachedBrainReceipts/);
  assert.match(source,/additionalContextValidators/);
  assert.match(source,/additionalExtensionFactories/);
});
