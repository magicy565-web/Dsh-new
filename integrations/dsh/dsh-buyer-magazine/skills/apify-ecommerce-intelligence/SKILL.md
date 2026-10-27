---
name: apify-ecommerce-intelligence
description: "Collect actual corporate website evidence through the native Apify Actor tool, preserving source content and image URLs for LLM-led editorial design. Requires configured APIFY_TOKEN; report missing capabilities without silently substituting another collector."
---

## Native DSH integration contract

Use the actual native buyer_magazine_collect_site tool: action:preflight first
(read-only account limits, no Actor started), then action:start with the
company's public HTTPS URL and a bounded maxPages, then action:status with the
returned runId. The tool runs apify/website-content-crawler and returns the real
run/dataset IDs, dated source content, image URLs and a native dataset attachment.
Retain the dataset and source map; inspect relevant pages and original images.
No fact becomes verified merely because the crawler returned it.

Use action:credentials to list configured credential numbers without their values.
The operator may configure APIFY_TOKEN_1 through APIFY_TOKEN_100. When the user
selects an account, pass its credentialId (1..100) on start and every status call
for that run. Record credentialId with runId in the native workspace. Presence
does not prove remote authorization. Do not select a different account after a
permission, quota or rate-limit failure. Omitted credentialId retains the legacy
APIFY_TOKEN default, then slot 1 when the legacy variable is absent. An explicitly
selected missing slot is blocked; it never falls back to another account.

A missing
credential returns APIFY_NOT_CONFIGURED before any request. Do not silently use
web_fetch/Jina as an equivalent. Respect access failures and rate limits; do not
rotate credentials to evade a denial. The original rotation script is preserved
for provenance but is not executed. The native run is capped at 30 pages, 180
seconds and the configured charge budget (default USD 1, maximum USD 5).
Start rechecks account limit headroom; unavailable or insufficient headroom blocks
the POST. This is a dated snapshot, not reserved credit or permission to change
account limits. A start result of unknown/APIFY_START_OUTCOME_UNKNOWN may already
have created a paid Run: reconcile with the operator in Apify before another start.
Native JSON attachments retain actual Run responses even while running or failed;
successful nonempty Datasets additionally retain raw items. An empty Dataset is
APIFY_DATASET_EMPTY, not completed research. Evidence-save failure blocks delivery.

Extract the facts the editorial question needs: brand history and positioning,
product/material evidence, meaningful imagery, actual contacts and limitations.
Retain precise source URLs and separate quotations from interpretations. Feed
this research to the designing LLM; do not map it into a fixed rendering schema.
Never copy placeholder metrics, credentials or brands from examples.

## Preserved original design method

# Apify E-Commerce & Corporate DNA Intelligence Engine

Extracts authentic corporate facts, value propositions, MOQ/lead-time telemetry, and high-resolution CDN imagery from any target company URL using a fault-tolerant 4-key Apify API rotation pipeline with automatic Jina Reader fallback.

## Workflow Steps

1. **Token Pool Rotation**: Cycle through 4 configured Apify API tokens (`APIFY_TOKEN_1` .. `APIFY_TOKEN_4`) on rate-limit (`429`) or quota exhaustion (`402/403`).
2. **Structured Corporate DNA Extraction**:
   - Masthead & Brand Provenance (Company name, founding year, headquarters/industrial hub coordinates).
   - Core Authority Metrics (MOQ, sampling speed, compliance certifications, global fulfillment reach).
   - 3-5 Curated Capability Pillars with authentic product/factory image URLs.
3. **Editorial Copy Transformation**: Pass the extracted JSON payload directly into `editorial-magazine-design` and `editorial-typography-system` to render the 5-Spread Interactive Magazine Corporate Card.
