# Local fallback validation

Application/test source: `ac358ff236f2f5905dcbea0ca8d453dcd0839072` (minimal abort-test fix on d2fc559). No production source changed during this fallback. Both dependency trees were freshly installed from the existing lockfiles.

- Backend: 698 passed, 8 skipped. The cloud result of 699/7 included one historical Git-object proof; this source-only recovery lacks those ancestor objects, so that original test explicitly skips. Its 10 current business cases pass. The initial failed run is retained: a required tracked provenance JSON was missing, then restored byte-for-byte. No assertions were removed.
- Production DOM: 19 passed. Original combined conversation DOM: 17 passed. Current Library 6 and retired Supply component contracts 7 passed. These scopes remain distinct.
- Mini business/client: 126 passed; mini build passed.
- Pi: 9 original Muse-flow tests, 3 supplier MCP tests, 2 native model-tool tests, and three actual Pi CLI PTY suites (8, 7, 8 checks) passed. Provider/owner/merchant/Muse transport data are synthetic local fixtures; no live model or original native Host/Muse service was verified.
- Browser: original Chromium launch is blocked before page assertions by the environment's socket restriction. No fresh browser screenshots or browser-pass claim. Historical screenshots and earlier cloud results remain historical; no browser/security settings were changed or alternate execution route attempted.

The later delivery archive will name its own frozen source and explicitly omit historical artifacts. This evidence checkpoint is neither real account/device acceptance nor permission to deploy, publish to Shopify, send notifications or start ongoing monitoring.
