// Existing-contract characterization. The former same-source rejection oracle
// was an unapproved policy, not a promised contract; its red history is retained.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIntake } from '../../plugins/workspace-factory-ingestion/src/contract.mjs';
import { texts, crossDocumentClassification } from './fixtures.mjs';

test('existing contract preserves B evidence independently of document A classification target', () => {
  const input = crossDocumentClassification();
  assert.equal(input.records[0].sourceIndex, 0);
  assert.equal(input.records[0].evidence[0].sourceIndex, 1);
  assert.equal(texts[1].slice(input.records[0].evidence[0].start, input.records[0].evidence[0].end), 'BOWL-B');
  assert.ok(!texts[0].includes('BOWL-B'));
  const admitted = validateIntake(input);
  assert.deepEqual(admitted, input);
  assert.equal(admitted.records[0].evidence[0].sourceIndex, 1);
  assert.deepEqual(admitted.sources[admitted.records[0].evidence[0].sourceIndex].asset, input.sources[1].asset);
  assert.notDeepEqual(admitted.sources[1].asset, admitted.sources[0].asset);
  assert.notEqual(admitted.records[0].evidence, input.records[0].evidence, 'The original validator returns a clone');
});

test('existing contract retains both source fragments for one field without relabeling either', () => {
  const input = crossDocumentClassification(), row = input.records[0], quote = 'CUP-A', start = texts[0].indexOf(quote);
  row.evidence.unshift({ path: 'title', sourceIndex: 0, start, end: start + quote.length, quote });
  row.conflicts = ['SYNTHETIC conflicting interpretations; keep both source fragments for review.'];
  const admitted = validateIntake(input);
  assert.deepEqual(admitted.records[0].evidence, row.evidence);
  assert.deepEqual(admitted.records[0].evidence.map(e => e.sourceIndex), [0, 1]);
  for (const evidence of admitted.records[0].evidence)
    assert.equal(texts[evidence.sourceIndex].slice(evidence.start, evidence.end), evidence.quote);
  assert.deepEqual(admitted.records[0].conflicts, row.conflicts);
});
