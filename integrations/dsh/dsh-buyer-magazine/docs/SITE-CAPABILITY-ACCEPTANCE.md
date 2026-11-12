# ChatGPT Sites Capability Acceptance — P0

Status: NOT TESTED against a live public Site. This checklist prevents unsupported platform assumptions from being reported as complete.

## Test fixture
Create a public test Site with three distinct pages: `/`, `/guides/test-category/`, `/suppliers/test-factory/`. Use non-sensitive synthetic fixture data clearly labelled as test content. Connect a custom domain only if available to the account. Do not use a real supplier's unapproved private data.

## Required observations
For each URL record timestamp, final URL, HTTP status, response headers, raw HTML, rendered DOM, screenshot, and test result.

| Capability | Procedure | Pass condition |
|---|---|---|
| Public access | Open in private browser without ChatGPT login | Public page loads anonymously |
| Stable route | Open and refresh each deep URL | No 404 or forced homepage redirect |
| Server-visible content | Inspect response HTML and rendered DOM | Title, H1 and primary copy are present and crawlable |
| Unique metadata | Inspect each page title/description/canonical/OG | Each route has correct unique values |
| robots.txt | GET /robots.txt | Valid response; Googlebot, Bingbot and OAI-SearchBot policy is intentional |
| sitemap.xml | GET /sitemap.xml | Valid sitemap with canonical public URLs |
| Structured data | Extract JSON-LD and run official validator | Valid and exactly matches visible facts |
| OpenAI discovery | Inspect robots and verify OAI-SearchBot reachability | Not blocked; do not infer citation guarantee |
| Google/Bing | Submit sitemap and inspect URL in webmaster tools | Crawl/index state recorded; indexing not assumed |
| Assistant | Open widget and ask a factual product question | Gateway returns grounded answer with session isolation |
| RFQ | Create draft then confirm submit | Durable case created once; idempotency enforced |
| Mobile | Test 360/390/768 widths | No overflow, hidden CTA or unusable assistant |
| Accessibility | Keyboard, focus, labels, contrast, reduced motion | No release-blocking failures |

## Result vocabulary
PASS: directly observed with retained evidence. FAIL: directly observed failure. NOT TESTED: no live Site or credentials. BLOCKED: capability unavailable or dependent on unsupported platform behavior.

## Gate
Do not market this Site skill as SEO-ready until public routes, crawlable text, unique metadata, robots policy and sitemap behavior have been observed on the actual deployed Sites runtime. If a control is unavailable, decide whether to use an external SEO landing domain or keep Sites for interactive publication only; do not claim a workaround without a working test.
