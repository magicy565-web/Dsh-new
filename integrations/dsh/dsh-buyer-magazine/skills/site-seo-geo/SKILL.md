---
name: site-seo-geo
description: Plan, implement, and audit technical SEO and generative-search readiness for buyer magazine Sites, including page metadata, crawlability, structured data, internal links, and evidence-led content.
---

# SEO / GEO Publishing Skill

## Principle
GEO is not a separate ranking hack. Follow current search-engine fundamentals: crawlable pages, index eligibility, helpful original content, transparent sourcing, good page experience, and clear site architecture. No implementation guarantees indexing, ranking, or citation.

## Per-page requirements
- Unique descriptive title and meta description; one clear H1; logical H2/H3 hierarchy.
- Stable descriptive slug, self-referencing canonical where supported, index/follow only when intended.
- Open Graph and social card metadata.
- Semantic HTML and important text present in initial HTML or reliably rendered DOM; do not hide primary content behind tabs, chat, canvas, or interaction.
- Descriptive internal links between hub, category, buyer guide, supplier and product pages.
- Images with accurate alt text, dimensions, responsive sources, compression, and rights metadata.
- Structured data only when it truthfully matches visible page content. Select appropriate schema types (Organization, Product, Article, BreadcrumbList, FAQPage only when eligible and compliant); never fabricate ratings, offers, availability, author identity or reviews.
- Show source citations, evidence status, last reviewed date, and author/editorial responsibility where relevant.
- Multilingual pages require distinct locale URLs and valid reciprocal hreflang only when equivalent translated pages exist.
- Avoid duplicated factory boilerplate. Each page must add original category knowledge, product-specific evidence, comparison or buyer utility.

## GEO content shape
For answerable buyer questions:
1. Give a direct, self-contained answer near the top.
2. Define entity/product/category and context.
3. Separate verified supplier facts, independent facts, estimates, and unknowns.
4. Provide concrete specifications, units, conditions, source links and dates.
5. Explain comparison methodology and trade-offs.
6. Include original first-hand evidence only when actually collected and authorised.
7. Add concise FAQs only when they answer real buyer questions.
8. Keep the article useful without requiring the reader to open the AI assistant.

## Technical capability audit
Test the actual deployed Site, not just source code:
- Public anonymous GET for every route; refresh/deep-link works.
- HTML response and rendered DOM expose title, description, H1, primary copy, canonical, OG and JSON-LD.
- Check /robots.txt and /sitemap.xml availability and actual contents.
- Verify Googlebot, Bingbot and OAI-SearchBot are not blocked by Site settings, robots directives, CDN, or access controls.
- Confirm public access works without ChatGPT sign-in if the target buyer should be anonymous.
- Confirm no accidental noindex, auth wall, redirect loop, duplicate canonical or client-only route.
- Validate structured data with official validators; compare it with visible content.
- Submit sitemap and inspect representative URLs in Search Console/Bing Webmaster Tools when the owner has access.
- Record observed response codes and evidence. If Sites does not expose a control, report unsupported/unknown; never invent a configuration workaround.

## OpenAI search
OAI-SearchBot is the crawler used for ChatGPT search discovery. GPTBot controls a separate training-related use. Keep the decisions separate. Verify actual robots response rather than assuming access.

## Google AI search
Google's AI search features use the same foundational SEO eligibility and quality requirements as classic Search. There are no special AI-only schema files or GEO markup required. Focus on crawlability, visible text, original value, clear internal links, and useful page experience.

## Deliverables
Return a per-route audit with PASS / FAIL / NOT TESTED, evidence, severity, owner action, and retest result. Never compress unknown into PASS.
