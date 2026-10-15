# Factory material plugin acceptance

PR68 / Issue #71. This checkpoint extends `0036f87` and the original Library
controlled-read seam; it contains no supplier PR57 evidence.

- Standard copied independent package and actual official Pi1.1.0/OMP18.10.4
  manifests, Skill, install/link, disable/re-enable/remove/uninstall and finite
  keyless SDK calls: **5/5**, zero skips. `package.json` is compact evidence.
  The injected client in these package tests is synthetic, not Library HTTP.
- Original Library/Store/signed enterprise HTTP and fixed native PDF reader:
  **7/7**, zero skips. Includes exact projection/version/hash, prices excluded,
  default-unconfigured/no reads, member/enterprise/Bearer/model denial, schema
  and source forgery, missing-record partial failure, revision changes, Session
  logout and actual native PDF scan/truncation/error/temp cleanup.
- Actual original enterprise Run/private fd/official OMP worker/Library-policy
  path: **5/5**, zero skips, finite keyless model responses only. Covers exact
  product/file receipt and pinned active tool family, no business task/public
  tool, whole-journal reopen refusal before any new model request after revision
  drift, default-unconfigured/no private reads and structured failure recovery.
- Original Library regression: **14/14**, zero skips; this overlaps the focused
  30-case intermediate integration, so counts are not added again.

Commands:

```sh
FACTORY_MATERIALS_PACKAGE_FACTS=/tmp/factory-materials-package-20261015.json node --test test/factory-materials-package.test.mjs
node --test test/factory-materials-read.test.mjs test/workspace-omp-factory-materials.test.mjs
node --test test/pi-library-read.test.mjs
```

Initial authoring failures were an incorrect synthetic PDF fixture import and
cleanup-hook ordering in the new test fixture; both were corrected without
weakening source validation or original application assertions. Tool error
receipts were then normalized so the strict cached-data guard can recover from
ordinary refusal without exposing raw Host errors. The fifth worker/host test pins the enterprise terminal to the exact materials profile before any Run is created. Package tests were rerun
against that final behavior.

Typecheck passed. The original business/Library/HTTP/package regression was
rerun against this change: **70/70**, zero skips (including the14 Library cases).
The original43 OMP cases had two incomplete passing combinations:42/43 in
parallel (a shell-refusal UI observation timed out), and42/43 serial (the
unconfigured TUI returned exit1 on quit). The terminal file passed6/6 in isolation,
and the unconfigured case then passed four isolated diagnostic repetitions.
No production input or shutdown behavior was changed to hide these failures.
The final serial diagnostic rerun passed **43/43**, zero skips, in112.784s,
using the same assertions with additional exit-failure scrollback diagnostics.
`omp-43.txt` retains its output. The two earlier failures remain recorded above;
their intermittent cause has not been established. Do not infer that serial
execution fixes the cause or that one passing combination proves repeatability.

No real enterprise material or live model configuration was used. Official SDK,
CLI and TUI components are real; model responses and seeded data are synthetic.
Private runtime Store/session/artifact files and credentials are not committed.
Hosted Actions has a separately tracked startup_failure blocker (#16); local
results are not hosted CI. Real material/model/CNY5 verification gates in #74
remain outstanding.
