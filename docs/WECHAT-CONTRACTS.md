# Integrated client contracts

PR36 client `b999ef5ceac37b17daa6a6f909c1318f2b41baa1` was merged intact at
`8e4f486b308ba768b2eef72bbbd61e39baff27d9`. The unchanged PR37 strict script
passed 14/14 after that merge. This is local evidence, pending independent review.

Conversation creation now accepts optional `requestId` together with the existing
title/inputContext. The original locked Store atomically writes the conversation
and a receipt keyed by signed workspace/subject/requestId and the normalized body
hash. Exact retry returns that same conversation; changed input conflicts. A
deleted conversation retains its receipt and returns 410 instead of creating a
replacement. The private receipt registry is validated on reopen and omitted from
bootstrap. Legacy requests without keys retain their previous creation behavior.

The mini client journals its creation requestId before sending and explicitly
retries that exact body after response loss/cold restart. Bootstrap can reconcile
the exact creationRequestId/createdBy; a matching title alone is insufficient.
Legacy journal entries without requestId remain blocked from replay. The legacy
client fixture now explicitly loads that old body; its no-replay assertion remains.
New loopback Store/client fixtures cover response loss, restart, concurrency,
subject/body separation and deletion: 24/24 combined creation/client/lifecycle
checks, no skip, no model call for creation. This number overlaps normal suites.

Current implementation evidence: `validation/wechat-contracts/create-contract-tests.txt`.
Login code exchange/reviewed mapping remains WIP and the login broker is not yet
mounted. Natural-language Muse draft preparation remains to be implemented through
the original governed run and explicit prepare protocol. No real account, domain,
WeChat device, production or paid model was exercised. The historical client ZIP
and ee1ad6c ZIP do not include these contract changes and are not the final package.
