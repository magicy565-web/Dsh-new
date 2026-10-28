# RFQ Desk

Optional native DSH bundle (Node 24+, official DSH 0.2.1-rc.3). DSH supplies sessions,
Tools, Connection authentication and attachments. There is no agent loop or external
send tool. Install the standalone tarball with `dsh plugin --profile web add <archive>`.
Missing ERP/Commerce services return `DEPENDENCY_MISSING` when that dependency is
needed; importing and reading an unassigned RFQ works independently.

- `rfq_read`: current native workspace, bounded metadata list or one record;
  `includeRaw` explicitly requests retained original source text.
- `rfq_propose_extraction`: requestId, expectedRevision, RFQ id, exact source SHA,
  model/provider, requirements and exact start/end/quote spans. Candidate only.
- `rfq_propose_reply`: unapproved and unsent draft. No external transport.
- Owner `GET /rfq-desk-api/read?sessionId=...`; `POST /rfq-desk-api/command` accepts
  import, review, assign_project, revoke_contact, close, purge_source. Each mutation
  requires requestId and expectedRevision (0 for import). Session comes from a real
  authenticated DSH page; caller-supplied workspace/role fields are refused.
- Owner `POST /rfq-desk-api/import-attachment` consumes an original native file ref
  `{attachmentId:"sha256:<hash>",bytes}`, sha256, bytes, format (csv/json), rowIndex,
  accountRef, receivedAt, authorizationEvidence, requestId, expectedRevision and
  optional projectId. CSV parser, row normalizer and row source hash reuse the
  historical inquiry domain; historical records are never rewritten.
- The canvas importer records a single authorized CSV/JSON inquiry file verbatim.
  Bulk historical files should use the row-specific native attachment contract.

SQLite owns only RFQ facts. The unique key is workspace/channel/account/message.
Source collisions with different bytes fail; exact duplicate deliveries return the
original RFQ. Model candidates never mark buyer identity or contact authorization.
Owner review binds an existing ERP buyer and explicitly records identity evidence,
recipient, contact permission and expiry. `qualified` means field review only.

Storage: `$DSH_HOME/data/rfq-desk/rfq.sqlite` (or config.dataDir), AES-256-GCM
record encryption, generated adjacent `.key` mode 0600, directory mode 0700. The
key must be backed up separately and restored with the database. A missing key for
an existing database fails closed. Neither file belongs in Git. Source IDs and
partition metadata remain SQLite metadata; message text, field spans and drafts
are encrypted. This is local at-rest encryption, not a multi-tenant KMS.

`retentionDays` defaults to 30 (1–365). Source reads deny expired bytes immediately.
Startup/hourly maintenance purges expired raw text, draft bodies and span
quotes, increment revision and close the RFQ; source hashes and review metadata
remain auditable. Maintenance runs only while installed. Backup copies and SQLite
WAL/media retention remain the operator's responsibility; logical removal does not
claim physical secure erasure. Explicit `purge_source` supports earlier removal.

Live inbound email requires QuoteGuard's separately configured signed provider
adapter. WhatsApp is unconfigured. See `docs/COMMERCE-BUSINESS-IMPLEMENTATION.md`
for complete dependency, permission and release acceptance boundaries.
