# 18 / Buyer matching and morning delivery — separate from enterprise production

## Purpose

Each enterprise commissions its **own** magazine. The morning buyer experience is the timing, content utility and authorized distribution, **not** an editorial merger of multiple companies. Keep Buyer subscription intelligence inside the platform's controlled Buyer DB. The Magazine Worker receives distribution intent and approved content ID, not raw personal profiles.

## Buyer-facing design

- Hero: name the supplier honestly, identify *one* precise product opportunity, and state why a buyer might care in a grounded sentence.
- Within the first 45 seconds of scanning, show the most relevant product visual (authorized product image or visibly labelled generated art), category, use case and quick specification.
- At one minute: what buyer has to know now, especially sourcing country evidence status, product/material parameters, sample options and product-specific compliance checks.
- At two to four minutes: two additional variants or product leads where sources support them, grounded facts table, provenance chip and commercial uncertainty rows.
- Finish: sample request, product-specific quotation, bookmark, source inspection, or business contact. Never use fabricated countdowns or fake order confirmations.

## Data model

```
ApprovedIssue { tenantId, companyId, taskId, issueHash, publicationUrl, categorySegments, market }
BuyerSubscription (held by sender, not Worker) { buyerId, market, categories, consent, frequencyCap, preferredMorningLocalTime }
DeliveryPlan { issueId, audienceSegmentKey, locale, channel, sendWindow, suppressionPolicy, idempotencyKey }
DeliveryReceipt { deliveryId, accepted, delivered?, opened?, clicked?, qualifiedInquiry? }
```

The sender decides recipient eligibility with its own authenticated queries. Publication links must be public HTTPS and reference the **approved hash**. The email digest must not embed contact data in public HTML. Store unsubscribe and consent in the sending system; no "subscribe everyone" shortcut.

## Suggested measurement

Measure production success separately from conversion: dispatched tasks → evidence-usable drafts → approved magazines → queued delivery → actual delivery → opens (where measurable) → clicks/shortlists → qualified sample requests → supplier-confirmed opportunities. Deduplicate by tenant + issue + buyer within the channel frequency cap. No explicit open signal means unknown, not false. Measurement design must not leak buyer identities to the enterprise.

## Gates

Delivery can only proceed after `APPROVED` with matching immutable artifact hash; demo issues cannot be approved; outcome-unknown bridge response stays uncertain. Reject unverified commercial claims and unclear sponsorship labels. Avoid language promising overnight delivery or a specific date when the sender's timezone and operational SLA are unknown.
