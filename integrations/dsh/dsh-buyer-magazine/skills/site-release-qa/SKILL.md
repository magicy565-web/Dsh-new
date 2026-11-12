---
name: site-release-qa
description: Validate buyer magazine Site source, accessibility, SEO/GEO, interactive behavior, AI assistant safety, and production release readiness.
---

# Site Release QA

## Mandatory gates
- Evidence gate: every supplier-specific factual claim has source, quote, retrieval timestamp and status; unresolved fields are omitted or marked unknown.
- Content gate: one buyer persona, one buying intent per page, unique editorial value, no keyword stuffing or near-duplicate pages.
- SEO gate: title, description, canonical, H1, indexability, crawlable primary copy, internal links, image alt, valid visible-content-matching structured data.
- Crawl gate: public anonymous access, stable direct URLs, robots/sitemap observed, bot access verified where possible.
- Design gate: responsive screenshots at 360/390/768/1024/1440; contrast, keyboard navigation, focus, reduced motion, image loading, no overflow.
- Performance gate: measure Core Web Vitals where field data or lab data is available; report LCP, INP, CLS separately and do not invent measurements.
- Interaction gate: all links, nav, filters, product comparison, CTAs, assistant open/close, error/retry, loading and empty states.
- Assistant gate: API auth, visitor isolation, tenant isolation, no client secrets, grounded responses, RFQ confirmation and handoff.
- Release gate: save version first, review candidate, human approval, then deploy; record deployed version and production URL.

## Result vocabulary
PASS = directly tested and evidence retained.
FAIL = directly tested and failed.
NOT TESTED = no access, missing environment, or capability cannot be verified.
BLOCKED = dependency prevents meaningful test.
Do not label an untested item as PASS because its source code appears correct.

## Release artifact
Produce site-qa-report.json and a short human-readable release summary with each gate, evidence path, unresolved issue, severity, and retest owner.
