# Selected integration of PR109 Product Context fixes

Source: `b0574b255916921f9f1a4c1c63f8b47d9df05f1a` (PR109). Integration parent: `8cda1c106aa663c730de33f860cbd22cb6fe0381` on the existing PR99 development branch.

The 13 package files plus the author's acceptance document were copied from that exact source without editing the author's record. Existing-path preimages matched the integration branch before copying. This separate integration note records the narrower independent-review evidence and remaining application work.

## What the source changes

The original Product Context package now binds approvals to the current product/variant projection, validates the merged review payload, and uses an expected-version/source-hash compare-and-set for updates. It rejects stale approvals and malformed historical JSON before the two Agent reads. Version exhaustion uses the original integer field with explicit revision fingerprints rather than overflow or automatic approval. The previous review threshold and business policy are unchanged.

This is a source integration only. The existing acceptance application already registers this package unconditionally. It must **not** be described as default-disabled; this commit does not change that registration or deploy the new code. The separate thin Agent catalog plugin's default unconfigured state is a different boundary.

## Evidence, kept separate

- Author evidence, preserved in `MEDUSA-PRODUCT-CONTEXT-ACCEPTANCE-20261018.md`: original locked Medusa 2.21.2 build/typecheck and 11 synthetic test groups passed after reproducing and fixing the first-review defects. This is the author's execution evidence, not a fresh integration-environment run.
- Independent review: six selected original helper/schema groups passed on Node v24.19.0, using type-stripped fixed TypeScript and import mapping only. No Medusa SDK/ORM/HTTP/PG/build/tsc was executed in this independent review. The review environment used Zod **4.4.3**, whereas this package lock selects **4.2.0**. The six groups covered version boundaries, repeated maximum-version approve/revoke cycles, stale fingerprints after re-sign/revoke, continued revisions, malformed JSON refusal despite matching hashes, and corrected output without private source fields. The independent result log SHA-256 is `f3918419b8470996b077a1396f3baf6e0d7f47b40ba29fcf9d39cdf0736b5be2`. Those six groups do not certify the exact locked package build, Medusa dependency injection, HTTP middleware chain or PostgreSQL behavior.
- Integration environment: exact source/preimage verification and CJS test syntax checks completed. The package's full Medusa dependency installation is absent here; no local package build or full test success is claimed. Root and package manifests/locks remain unchanged.

## Before application rollout

Real PostgreSQL CAS/uniqueness/transactions, Medusa DI and authentication, cache/event/subscriber behavior, and the current Host's provider/final-disclosure fences still need their own acceptance. SQL generation with synthetic affected rows is not a live database test.

The actual authorized review caller must adopt the new expected version and review fingerprint protocol. The old custom catalog UI omits the required source hash and is not compatible with approval under this source. The user chose official Medusa Admin; this integration does not build another UI or claim an approved, working Admin review entry. Old approvals require deliberate current review; no automatic migration or reapproval is performed.

No runtime data, raw logs, credentials, migration execution, deployment or paid model request is included.
