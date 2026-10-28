# QuoteGuard

Native DSH candidate for evidence-bound quotations. Requires Mini ERP quote service,
RFQ Desk and Workspace Library to prepare a quote; it never opens another ledger.
Install standalone tarball with `dsh plugin --profile web add <archive>`.

Tools: `quote_preview` and `quote_propose`. Input is rfqRef/rfqRevision, an explicitly
linked ERP productId, exact productRevision, validUntil, plus requestId and
expectedRevision for a proposal (0 for a new series, quoteId/current revision for
another version). Price, recipient, status, role and approval cannot be supplied by
the model. The exact reviewed source tier determines integer USD/EUR/GBP/CNY prices.
Missing MOQ, currency, trade terms, sale floor or source review blocks the quote.
The floor is a reviewed sale-price floor, not a claim of known cost or profit.

Owner routes under `/quote-guard-api`:

| Route                 | Contract                                                                          |
| --------------------- | --------------------------------------------------------------------------------- |
| GET /status           | Configured adapter/account, no inferred live connection                           |
| GET /read             | quoteId/version or bounded project list                                           |
| GET /review           | Exact version, recipient, text, policy and reviewDigest                           |
| POST /policy          | Owner price/disclosure policy for linked product, expected policy revision        |
| POST /approve         | quoteId, version, expectedRevision, reviewDigest, requestId                       |
| POST /send            | quoteId, version, expectedRevision, approvalReceiptId, requestId                  |
| POST /reconcile       | Original quote/version, current revision, optional providerMessageId              |
| POST /withdraw        | Withdraw an unsent/sent quote; never erases history or recalls email              |
| POST /accept          | Distinct reviewed reply RFQ received after send, revision and exact agreeing span |
| POST /link_order      | Separately created matching ERP order; never reserves/confirms it                 |
| POST /upload-evidence | Canonical base64, filename; stores bytes via native attachments                   |
| POST /record_evidence | Owner collection/commission-paid receipt with exact native evidence               |

All routes require sessionId in the authenticated native context. Writes require
same origin and JSON; requestId and expectedRevision bind each business mutation.
Read-only provider queries never resend. A unique outbox for each quote version is
committed before external I/O. Timeout, abort, malformed response and lost response
remain `sending`/`unknown`; a new request ID cannot send that version again. A definite
provider rejection is recorded and allows a new reviewed quote version. A caller
retry from another native tool-call ID in the same session reuses the original
request. New terms always make a new immutable quote version.

## Resend configuration

No credentials or external accounts are bundled. Supply environment variable names
in the native bundle's config, never secret values in tracked files:

```yaml
apiKeyEnv: COMMERCE_RESEND_API_KEY
from: authorized-sender@example.test
accountRef: resend-test-account
webhookSecretEnv: COMMERCE_RESEND_WEBHOOK_SECRET
inboundSessionId: session-actual-native-session
inboundProjectId: actual-commerce-project
inboundInbox: authorized-inbox@example.test
allowRemoteIngress: false
```

The `.test` addresses above are schema examples and will not send real mail. A real
verified sender, authorized recipient, provider account and inbox are required.
`POST /quote-guard-inbound/resend` is a separate provider gateway, verifies the
official Svix signed raw body/event ID/timestamp (5-minute window), caps body/rate,
retrieves exact plain text from Resend's receiving API, checks the configured inbox
and imports one deduplicated sourced RFQ. It never reuses DSH cookies or Worker
Bearer credentials. Missing configuration returns `UNCONFIGURED`.

A controlled HTTPS ingress must be explicitly configured before remote use;
`allowRemoteIngress: true` assumes an operator-controlled TLS reverse proxy. Never
expose owner endpoints or disable signature verification. Provider HTTP uses bounded
timeouts, fixed API origin and no automatic send retries. After an unknown send,
an owner may supply the provider message ID; retrieval must match exact from/to,
subject and text before reconciliation succeeds. There is no reliable lookup by
idempotency key, so unknown outcomes without a verified provider ID stay unknown.

No OAuth identity is inherited from ChatGPT connectors. No WhatsApp, payment,
legal signature, real account delivery or production readiness is implied by tests.
