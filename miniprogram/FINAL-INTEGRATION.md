# Unified development integration after the 18:56 checkpoint

The fixed `65252e2` source/import packages remain an immutable checkpoint. Small later fixes are committed/pushed with tests, without regenerating large archives. The final unified source/import package will be generated after the independent TUI and supplier MCP fixed commits are integrated and validated.

## Original notification cold recovery

Reproduced on the original compiled Page/Client, signed local HTTP and persisted original Store: create two distinct supplier products, execute one separately approved first-sample or seven-day notification for the older product, lose its local acknowledgement, then restart server/client and enter directly through `onShow`. The page had no supplier mode and selected the newer product because only `supplier-*` and `publication-*` pending requests restored the business context; notification pending labels were also missing.

Minimal fix: treat the existing `notification-*` journal kinds as supplier business recovery, restore the existing `pendingSupplierId`, and label the original pending notification operation. No change to sender, consent, approval, native subscription, request journal, role or backend semantics. The new tests cover both notification phases and duplicate retry clicks, verify the original monitor/operation/request body, and require exactly one provider attempt, one native popup and no second monitor. Unknown delivery stays unknown.

Validation: `npm run build:mini` passed; `node --test miniprogram/test/business-recovery-regressions.test.mjs miniprogram/test/notification-closure-client.test.mjs miniprogram/test/publication-client.test.mjs miniprogram/test/lifecycle.test.mjs` passed 36/36. Reproduction failed before the two-line page change on both notification phases. Local transport/provider fixtures only; no live WeChat/Muse/Shopify proof.

Further integration remains in progress. No main merge, force push, production/deployment, payment or credential/permission creation.
