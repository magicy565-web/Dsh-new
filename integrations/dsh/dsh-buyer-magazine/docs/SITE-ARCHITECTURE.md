# Buyer Magazine Site Architecture v0.1

## Product boundary
This package generates and reviews a ChatGPT Sites-compatible source project. The ChatGPT Sites owner workflow remains responsible for creating the hosted Site, configuring sharing/custom domains/secrets, saving a candidate version and deploying it. The DSH plugin does not claim to call an undocumented Sites deployment API.

## Components
- Existing research tools: Apify website crawler, source capture, browser/PDF artifact review.
- Site orchestrator: audience, buying intent, route plan and publication lifecycle.
- Evidence schemas: supplier-stated, independently verified, derived, unverified, conflicting and unknown facts remain distinguishable.
- Page schemas: route, metadata, visible sections, evidence refs, CTA, structured data and indexability.
- Site starter: semantic HTML/CSS/JS, editorial design tokens and responsive AI assistant UI.
- SEO/GEO QA: public crawlability, route stability, metadata, visible content, internal links, structured data consistency and bot access.
- Assistant gateway: central HTTPS API to OpenMausBot and approved Sourcing MCP tools; visitor chat is not a ChatGPT connected-app plugin.

## Data and security
Canonical business data remains in the central API/PostgreSQL. Public Site assets are presentation only. The server maps public Site slug to tenant; the browser must not select tenant IDs or receive private credentials. Visitor sessions are short-lived and isolated. RFQs are durable records and must outlive chat archival.

## Site deployment
1. Prepare a compatible source project and .openai/hosting.json only after Sites provisions its project ID and storage binding names.
2. Open Sites in ChatGPT Work/Desktop, import or create from compatible source, review preview.
3. Configure server-side secrets in Site Settings. Do not place secrets in HTML, JS, prompts or committed hosting config.
4. Save a reviewable version. Test public access and all direct routes.
5. Obtain human approval, then deploy and confirm the production URL.
6. Export source and separately back up business database and uploaded assets. Sites code version restore does not restore database/files.

## Known limitations
- No documented API in this package automates Sites creation, saving or deployment. Owner interaction in Sites is required.
- SEO controls (robots.txt, sitemap.xml, per-route metadata rendering, canonical behavior, SSR/HTML response and crawler access) must be verified on a real deployed Site. A source-level template cannot guarantee platform support.
- Assistant is a UI and API contract until the central gateway is implemented and tested.
- Placeholder assets and copy in site-starter are not production content.
