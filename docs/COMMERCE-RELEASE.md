# Commerce and Billing clean-core delivery

The source scope is [CLEAN-CORE](CLEAN-CORE.md). Commerce 1.4.0-rc.2 and Billing
0.1.0-rc.2 remain candidate package versions; this cleanup is not a new production
release. The intended external host is DSH 0.2.1-rc.3 with Node 24+.

Retained: AI Work, channel canvas, scoped Worker delegation/delivery, business
mandates, progress and independent service billing. Removed: legacy ERP/RFQ/quote/
sample adapters, transaction inspector/import and customer-assignment commands.
No runtime database migration occurs. Historical fields remain stored.

`npm run package:business-services` packages only Commerce/Billing. Library,
Shopify and optional branding are separate native bundles. See [pilot guide](COMMERCE-PILOT-QUICKSTART.md),
[development](DEVELOPMENT.md), [validation](../VALIDATION.md) and
[billing](SERVICE-BILLING-IMPLEMENTATION.md).

No real third-party Worker, Shopify OAuth/API, mail, payment or production
acceptance is implied by source packaging or local synthetic tests.
