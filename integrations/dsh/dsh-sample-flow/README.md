# SampleFlow

Optional native DSH adapter to Mini ERP's sample records; no second database.
Tools `sample_read` and `sample_propose` only read or prepare unapproved requests.
A proposal requires an actually recorded sent and accepted quote, exact version,
quantity and address. First-trade prerequisites are enforced by the authoritative
quote service. An unavailable ERP returns `DEPENDENCY_MISSING`.

Owner routes: `GET /sample-flow-api/read`, `POST /sample-flow-api/command` and
`POST /sample-flow-api/upload-evidence`, all with native session scope. Commands:
propose, approve, ship, deliver, feedback, cancel. Every mutation carries requestId
and expectedRevision. Approval records a fee with source evidence; shipping also
requires an independently confirmed matching ERP allocation order, carrier/tracking
ID and original event evidence. Delivery and feedback require distinct evidence.

Evidence references contain attachmentId, sha256, bytes, provider, externalEventId
and occurredAt. Actual native attachment bytes are re-read and hashed before the
write. These are explicitly owner-recorded interpretations of original receipts,
not a connected courier's cryptographic attestation. No synthetic shipment or receipt
is stored outside tests. Duplicate commands/events cannot advance twice.

The Commerce Inspector supports source-file upload, approval and shipment/receipt/
feedback registration. It does not arrange a shipment, buy postage, charge a sample
fee or automatically reserve inventory. Payment stays `unreconciled`; legacy ERP
confirmation is not payment or fulfillment. Install via native DSH CLI tarball.
