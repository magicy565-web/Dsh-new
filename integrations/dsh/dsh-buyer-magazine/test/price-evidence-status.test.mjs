import test from 'node:test';
import assert from 'node:assert/strict';
import { compileDraft, validateIssueJson } from '../compiler.js';
import { issueFixture, json, now } from './fixture.mjs';

// Synthetic, deterministic compiler checks only: no SDK, native writes, network,
// presentation, live evidence, browser, or model execution.
const options = { now };

for (const kind of ['unknown', 'request-quote']) {
  for (const status of ['unknown', 'supplier-stated', 'verified']) {
    for (const cited of [false, true]) {
      test(`${kind} price with ${status} status and ${cited ? 'cited' : 'uncited'} evidence`, () => {
        const issue = issueFixture();
        issue.products[0].price = { kind, status, sourceIds: cited ? ['s1'] : [] };
        const input = json(issue);
        const result = validateIssueJson(input, options);

        if (status !== 'unknown') {
          assert.equal(result.valid, false);
          assert.equal(result.errorCount, 1);
          assert.throws(() => compileDraft(input, options), error => error.code === 'MAGAZINE_ISSUE_INVALID');
          return;
        }

        assert.equal(result.valid, true);
        assert.equal(result.errorCount, 0);
        const html = compileDraft(input, options).data.toString();
        const quote = html.match(/<div class="fact" data-fact-status="unknown"><dt>Wholesale quote<\/dt><dd class="unknown">.*?<\/dd><\/div>/)?.[0];
        assert.ok(quote, 'Undisclosed price retains an unknown fact status');
        assert.match(quote, /Request a project quote/);
        assert.match(quote, /<span class="status">Not confirmed<\/span>/);
        assert.doesNotMatch(quote, /Verified against cited evidence|Supplier-stated/);
        assert.equal(quote.includes('evidence-chip'), cited, 'Sources may document an unknown price without confirming its terms');
      });
    }
  }
}

for (const kind of ['retail', 'wholesale']) {
  for (const status of ['supplier-stated', 'verified']) {
    test(`sourced ${kind} price retains ${status} status`, () => {
      const issue = issueFixture();
      issue.products[0].price = {
        kind, status, amount: 25, currency: 'USD', unit: 'item',
        basis: kind === 'retail' ? 'Synthetic public retail listing; not wholesale' : 'Synthetic public wholesale quote',
        ...(kind === 'wholesale' ? { minQty: 100 } : {}),
        sourceIds: ['s1'],
      };
      const input = json(issue);
      const result = validateIssueJson(input, options);
      assert.equal(result.valid, true);
      assert.equal(result.errorCount, 0);
      const html = compileDraft(input, options).data.toString();
      const label = kind === 'retail' ? 'Retail reference · not wholesale' : 'Wholesale · Synthetic public wholesale quote';
      const fact = html.match(new RegExp(`<div class="fact" data-fact-status="${status}"><dt>${label}<\\/dt><dd>.*?<\\/dd><\\/div>`))?.[0];
      assert.ok(fact);
      assert.match(fact, /\$25\.00/);
      assert.ok(fact.includes('evidence-chip'));
      assert.ok(fact.includes(status === 'verified' ? 'Verified against cited evidence' : 'Supplier-stated'));
    });
  }
}
