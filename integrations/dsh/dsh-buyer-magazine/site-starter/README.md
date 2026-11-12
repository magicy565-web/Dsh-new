# Buyer Magazine Site Starter

Portable semantic HTML/CSS/JS starter for a ChatGPT Sites-compatible buyer magazine source project.

## Included
- Static-first editorial HTML with metadata and visible text.
- Responsive editorial layout and accessible navigation.
- AI assistant drawer (desktop) / bottom sheet (mobile).
- Browser client calls a central HTTPS API. No model or database secrets are included.

## Before publishing
1. Replace all placeholder copy, image paths, alt text, canonical URL, Open Graph image, Site slug and links.
2. Create distinct HTML routes for category guides, buyer guides, supplier profiles and product stories. Each route needs unique metadata, canonical, H1 and visible body text.
3. Test direct route navigation and refresh in the actual Sites runtime.
4. Configure the assistant API gateway and verify tenant/session isolation. Never expose model keys, database credentials or Worker tokens in browser code.
5. Verify actual availability of robots.txt, sitemap.xml, route metadata and rendered HTML. The starter cannot create platform features that Sites does not expose.
6. Save a candidate Site version, inspect it, obtain human approval, then deploy.

## API contract
POST /v1/public-sites/{siteSlug}/sessions returns {"session_id":"opaque-short-lived-id"}.
POST /v1/public-sites/{siteSlug}/chat accepts X-Visitor-Session and JSON message/page_url/page_title/product_context; returns {"answer":"grounded answer"}.
The gateway validates origin, slug, expiry, tenant scope, quotas and rate limits. The session ID is not an authorization substitute. The included chat client is not live until this API exists and is tested.