// Pure Node compiler/static regressions. No jsdom, SDK, browser or networking.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileDraft, validateIssueJson } from '../compiler.js';
import { renderEmail } from '../upstream/src/render.js';
import { issueFixture, json, now } from './fixture.mjs';
const htmlFor = issue => compileDraft(json(issue), { now }).data.toString('utf8');
const cardFor = html => html.slice(html.indexOf('<article class="product-feature'), html.indexOf('<p class="empty-filter"'));

test('numeric retail price retains locale currency formatting without wholesale conditions', () => {
  const issue = issueFixture(); const html = htmlFor(issue), card = cardFor(html);
  assert.match(card, /\$25\.00 \/ item/);
  assert.match(card, /Retail reference · not wholesale/);
  assert.doesNotMatch(card, /Quote quantity basis/);
});
for (const value of ['25-30', 'from 25', '25.00', '0', '-5', 'Infinity', '  from $25  ']) {
  test(`source text price remains text: ${JSON.stringify(value)}`, () => {
    const issue = issueFixture(); issue.products[0].price.amount = value;
    const html = htmlFor(issue), card = cardFor(html);
    assert.ok(card.includes(`${value.trim()} USD / item`));
    assert.doesNotMatch(card, /\$NaN/);
    if (value.trim() === '0') assert.doesNotMatch(card, /\$0\.00/);
  });
}
test('whitespace-only price remains invalid instead of being coerced to zero', () => {
  const issue = issueFixture(); issue.products[0].price.amount = '   ';
  assert.equal(validateIssueJson(json(issue), { now }).valid, false);
  assert.throws(() => htmlFor(issue), { code: 'MAGAZINE_ISSUE_INVALID' });
});
test('numeric zero is a valid sourced amount, distinct from unknown or text zero', () => {
  const issue = issueFixture(); issue.products[0].price.amount = 0;
  assert.match(cardFor(htmlFor(issue)), /\$0\.00 \/ item/);
});
test('all static price surfaces retain wholesale basis and quote quantity distinct from MOQ', () => {
  const issue = issueFixture(), product = issue.products[0];
  Object.assign(product.price, { kind: 'wholesale', amount: '12-15', minQty: 500, basis: 'EXW, packaging excluded' });
  product.moq = { value: 50, unit: 'units', status: 'supplier-stated', sourceIds: ['s1'] };
  const html = htmlFor(issue), card = cardFor(html);
  assert.match(card, /12-15 USD \/ item/); assert.match(card, /50 units/);
  assert.match(card, /Quote quantity basis<\/dt><dd>500 units/);
  assert.equal((card.match(/Quote quantity basis/g) || []).length, 1);
  const context = '12-15 USD / item · wholesale, EXW, packaging excluded · quote quantity basis: 500 units';
  assert.ok(card.includes(context));
  assert.ok(html.slice(html.indexOf('<table class="sourcing-table"'), html.indexOf('<div class="mobile-index-cards"')).includes(context));
  assert.ok(html.slice(html.indexOf('<div class="mobile-index-cards"'), html.indexOf('<p class="index-footnote"')).includes(context));
  assert.ok(renderEmail(issue).includes(context));
});
for (const kind of ['unknown', 'request-quote']) {
  test(`${kind} price remains unknown, never zero or invented wholesale terms`, () => {
    const issue = issueFixture(); issue.products[0].price = { kind, status: 'unknown', sourceIds: [] };
    const card = cardFor(htmlFor(issue));
    assert.match(card, /Request a project quote/); assert.doesNotMatch(card, /\$0\.00|\$NaN|Quote quantity basis/);
  });
}
test('source text is escaped and cannot turn into active markup', () => {
  const issue = issueFixture(); issue.products[0].price.amount = 'from <img src=x onerror=alert(1)>25';
  const html = htmlFor(issue);
  assert.match(html, /from &lt;img src=x onerror=alert\(1\)&gt;25 USD/);
  assert.doesNotMatch(html, /<img src=x/);
});
