# Current native tool map (0.3)

Only use tools registered in the current Session. This package owns:

| Operation | Actual tool / contract |
| --- | --- |
| Read site and products | Native web_fetch/web_search and native file tools. Cite the actual endpoints and timestamps. |
| Design | ai-media-kinetic-commerce → editorial-magazine-design + editorial-typography-system → design-production.md → supported design/image fields. No independent design service is implied. |
| Validate | buyer_magazine_validate_issue({issueJson}); schema validity is not production readiness. |
| Generate | buyer_magazine_generate({issueJson}); native policy-bound create-only HTML, exact SHA, readiness blockers. |
| Observe and revise | buyer_magazine_review({issueJson,view,start?}); renders only canonical output in Chromium, returns actual screenshots through native attachments for the current image-capable model. View is overview/spreads/products/editorial/print; follow nextSpreadStart, nextProductStart and nextPrintStart. |
| PDF | The editorial review returns an actual native file attachment produced by Chromium. The print view rasterizes actual PDF pages with pdfinfo/pdftoppm; inspect every page before claiming print acceptance. |
| Present | Existing official present for the generated HTML path. The review tool's PDF is a real native attachment, not a guessed path. |
| Publish/send | Only by user's explicit instruction through actually available host tools. Not performed by generation/review. |

The review tool depends on host Chromium, native attachments and an image-capable
model. It does not expose arbitrary browsing, Shell, model-supplied JavaScript or
filesystem paths. It permits only the issue's exact source image URLs, preserves
inherited proxy/TLS trust and uses an ephemeral browser context. It returns
blocked when capability is unavailable; do not substitute text assertions.

Original Studio CLI/MCP/collector/queue operations are reference material, not
installed tools. Source operations continue to use the one shared compiler. Do
not add a separate app frontend, proxy, Agent loop or model client.
