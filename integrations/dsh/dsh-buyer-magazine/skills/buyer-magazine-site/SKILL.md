---
name: buyer-magazine-site
description: Build a complete, public-facing, multi-page interactive buyer magazine as a ChatGPT Site from verified supplier evidence. Use for ChatGPT Sites, buyer magazine websites, supplier editions, category guides, SEO/GEO publishing, or embedding a sourcing assistant.
---

# Buyer Magazine Site Orchestrator

## Mission
Create a buyer-first editorial commerce website, not a brochure and not an email. The target runtime is ChatGPT Sites. Work in a compatible local source project when available, then use Sites to save a reviewable version and deploy only after approval. Do not claim a Site was published unless Sites reports a successful deployment and production URL.

## Required sequence
1. Read the existing procurement editorial standard and reading notes in ../editorial-magazine-design/resources/.
2. Research the supplier's public website and supplied authorised assets. Use existing Apify preflight/start/status tools when configured; otherwise use only an explicitly authorised available public-web route and label the collector accurately. Preserve source URLs, exact supporting excerpts, retrieval timestamps, and claim status.
3. Identify one primary buyer segment, buying stage, target market, and category. Reject generic "all buyers" positioning.
4. Build a content brief and evidence map before writing pages.
5. Create a multi-page information architecture using schemas/site-manifest.schema.json and schemas/magazine-page.schema.json. Minimum page types: home, category guide, supplier profile, product editorial, buyer guide. Only create pages supported by evidence and editorial value.
6. Write original buyer-useful content before visual design. Include concise answer-first summaries, detailed evidence, comparison criteria, unknowns, and buyer questions. Never fabricate MOQ, price, lead time, capacity, certifications, export markets, customer logos, test results, or performance claims.
7. Art-direct the publication using the category design system. Use real, licensed product/factory images. Do not use generated images as evidence of actual products, facilities, people, or certifications.
8. Build accessible, responsive, semantic HTML pages with stable page URLs, internal links, visible text content, metadata, social previews, and structured data that matches visible facts. Do not make important text available only after client-side interaction.
9. Embed the Buyer AI Assistant using the assistant contract. The browser must call a same-origin or approved HTTPS API gateway; never expose model keys, service tokens, private database credentials, or supplier secrets in client code.
10. Run the SEO/GEO, design, accessibility, security, performance, assistant, and link QA. Save the report and unresolved limitations.
11. Save a reviewable Sites version. Human review must approve claims, imagery rights, assistant permissions, and public audience. Deploy only after explicit approval.

## Site architecture
- One canonical magazine hub per publication brand, plus supplier editions only where each needs a distinct public identity.
- Each substantive editorial guide or product story gets a stable, human-readable URL.
- Prefer server-rendered or statically available semantic content. If Sites runtime cannot expose required metadata, crawler directives, stable routes, or rendered content, mark the capability blocked; do not claim SEO readiness.
- Store canonical supplier facts and buyer/RFQ records in the external business API/database. Do not create duplicate per-Site business databases unless the use case requires it.
- Use per-site public identifiers, tenant-scoped API authorization, rate limits, and server-side secrets.

## Required output
- site-manifest.json
- one magazine-page.json per route
- evidence-map.json
- actual HTML/CSS/JS source project
- assistant integration contract and configured endpoint placeholders (never fake live credentials)
- SEO/GEO and technical capability report
- responsive screenshots or browser review evidence
- deployment checklist and remaining blockers

## Hard rules
- No fabricated claims or synthetic proof.
- No keyword stuffing, doorway pages, mass-generated near-duplicate pages, fake reviews, fake author credentials, fake citations, or invented schema.
- No claim that JSON-LD, llms.txt, an AI assistant, or an "AEO score" guarantees ranking or AI citation.
- No public release with broken primary CTA, exposed secrets, cross-tenant data access, or unreviewed commercial claims.
- A Site preview, saved version, and production deployment are three distinct states.
