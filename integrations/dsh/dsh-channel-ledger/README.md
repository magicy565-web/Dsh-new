# ChannelLedger

Optional read-only native DSH projection over Commerce Network and Mini ERP.
`channel_ledger_read({projectId})` and authenticated
`GET /channel-ledger-api/read?sessionId=...&projectId=...` return separate currency
rows for plannedBudgetMinor, workerReportedCostMinor, approvedCostMinor,
quotedValueMinor, confirmedOrderValueMinor, collectedRevenueMinor,
commissionAccruedMinor and commissionPaidMinor. Amounts use integer minor units;
mixed currencies are not summed, unsafe totals are rejected.

Unknown collections and commissions are null, never zero or inferred from orders.
Settlement is `not_connected` and ROI is null. Approved Worker cost is not payment.
Collection/paid-commission receipts are stored only in ERP by the owner's separate
QuoteGuard evidence endpoint. It verifies the original native attachment and binds
a real confirmed, explicitly project-linked ERP order. Provider/event identifiers
are unique; changed reuse and excess collections/commissions are refused.

Partner terms and customer assignments remain in existing Commerce mandates.
Competing assignments become disputed; explicit owner resolution releases the
losing claim. Commission accrual requires exactly one active current mandate,
reviewed customer attribution and evidenced collections. Commission-paid evidence
requires current terms/revision, attribution and an accrued ceiling. This records
already supported transactions; no settlement, payout, invoice or global trust
score is created. Unavailable authoritative services fail closed.
