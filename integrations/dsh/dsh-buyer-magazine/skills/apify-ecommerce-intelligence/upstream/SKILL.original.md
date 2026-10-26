---
name: apify-ecommerce-intelligence
description: Real-time corporate website DNA, B2B/DTC brand positioning, authority metrics, service pillars, and real CDN asset scraping engine powered by a 4-key Apify API token rotation pool. Use whenever the user inputs a company or brand URL to build an interactive magazine corporate business card, brand lookbook, or showcase site so authentic company facts, metrics, and imagery are used instead of placeholders.
---
# Apify E-Commerce & Corporate DNA Intelligence Engine

Extracts authentic corporate facts, value propositions, MOQ/lead-time telemetry, and high-resolution CDN imagery from any target company URL using a fault-tolerant 4-key Apify API rotation pipeline with automatic Jina Reader fallback.

## Workflow Steps

1. **Token Pool Rotation**: Cycle through 4 configured Apify API tokens (`APIFY_TOKEN_1` .. `APIFY_TOKEN_4`) on rate-limit (`429`) or quota exhaustion (`402/403`).
2. **Structured Corporate DNA Extraction**:
   - Masthead & Brand Provenance (Company name, founding year, headquarters/industrial hub coordinates).
   - Core Authority Metrics (MOQ, sampling speed, compliance certifications, global fulfillment reach).
   - 3-5 Curated Capability Pillars with authentic product/factory image URLs.
3. **Editorial Copy Transformation**: Pass the extracted JSON payload directly into `editorial-magazine-design` and `editorial-typography-system` to render the 5-Spread Interactive Magazine Corporate Card.
