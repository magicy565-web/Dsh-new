// Aggregate entry for `node --test packages/harness-kernel/test` (see test/package.json).
// Individual files are still runnable directly / via glob.
import './test/composition.test.mjs';
import './test/boot.test.mjs';
import './test/http.test.mjs';
import './test/params.test.mjs';
import './test/cli.test.mjs';
import './test/presets.test.mjs';
import './test/patch.test.mjs';
import './test/audit-cli.test.mjs';
import './test/install.test.mjs';
import './test/env-declaration.test.mjs';
import './test/legacy-adapter.test.mjs';
import './test/bundle.test.mjs';
import './test/doctor-report.test.mjs';
import './test/capabilities.test.mjs';
import './test/review.test.mjs';
