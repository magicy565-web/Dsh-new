# Pi development delivery

Source checkpoint: ee1ad6c16a528284a9bfaf47512094295adb06bb.
Source tree: 2fdac9af55024e7b3eaff9a19f9529472a0239f6.
Draft PR: https://github.com/magicy565-web/workspace-agent/pull/34.

- Workspace-Agent-Pi-ee1ad6c-Source.zip: 500 committed source files, read from
  Git blob bytes. No checkout newline conversion, credentials, live runtime
  data, node_modules or DSH source archive.
- Workspace-Agent-Pi-ee1ad6c-Source.manifest.json and SOURCE-FILES-SHA256SUMS.txt:
  each original file's SHA256, Git blob ID, size and mode.
- CLEAN-EXTRACTION-ACCEPTANCE.json: actual clean npm ci, web/mini builds,
  keyless Pi HTTP boot, shutdown and Store restart/dedupe passed.
- Workspace-Agent-WeChat-Developer-Client.zip: compiled one-page development
  client, official API typings 5.2.3. Empty service/login configuration and
  touristappid are deliberate; no WeChat account/device/review claim.
- DELIVERY-MANIFEST.json and SHA256SUMS.txt: source/compiled package and
  screenshot byte hashes. Screenshots are in docs/validation/cloud-pi/browser.

Source ZIP SHA256:
16b0a020543f9f5551624024729625cc714d7063f7d11f18ba6f22ce7cdf2fa8

Compiled client ZIP SHA256:
14eed0cce9202c755a83d971908c33c4a90a598a8d50775ce9d3ede907fc524a

To independently verify a clean extraction with Node24/Python3, use:

```sh
python3 scripts/check-pi-package.py deliverables/Workspace-Agent-Pi-ee1ad6c-Source.zip --build-boot
```

Local test:all completed with backend 534 total / 527 passed / 7 conditional
skips / 0 failed, original UI 19/19, conversation UI 14/14 and mini build pass.
New targeted suites: 21/21. Actual Chromium: six checks, including 390/320px
and exact file preview/reload, zero console errors. These overlap and are not
added as independent tests. All seven extra obsolete Supply DOM cases fail
at the same initial render on both candidate and fixed PR33; downstream
assertions in those cases were not reached. A procurement fixture timing failure
was retained in evidence and repaired without weakening assertions.

Read docs/CLOUD-PI-ACCEPTANCE.md and docs/WECHAT-CLIENT.md for exact scope and
remaining live acceptance. Real Muse, Pi account/relay, WeChat account/device,
production, independent security review and reference-pixel acceptance are
unverified. Production remains intentionally powered off; no probe/deploy/wake,
main change/merge, force push, permission/credential expansion or paid inference.

Library's required prepared-upload helper failed before preparation during
tools/list networking. No Library ID was returned or invented. These files are
persisted in the authorized private GitHub development branch; use its exact
commit file links, not cloud-local paths, for download. GitHub Actions at 1e56260
reported startup_failure with zero jobs and an unconfirmed cause; local checks
are separate evidence, and no workflow/permission changes or reruns were made.
