// UNAPPROVED PRODUCT POLICY CANDIDATE. Not a current-contract regression.
// Explicitly run this .mjs file only to examine the proposed stricter rule.
// It is absent from this acceptance directory's explicit default run.mjs list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIntake } from '../../../plugins/workspace-factory-ingestion/src/contract.mjs';
import { crossDocumentClassification } from '../fixtures.mjs';

test('UNAPPROVED POLICY: reject classification of A using only B evidence', () => {
  assert.throws(() => validateIntake(crossDocumentClassification()),
    'Unapproved candidate: require every document-classification fragment to use the target sourceIndex');
});
