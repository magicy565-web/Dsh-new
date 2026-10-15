# PR #80 delivery closeout

Implementation base: `9b8bf94f96e8b20c447e06e4537fc38fbe981be3`. This follow-up changes documentation and necessary regression assertions only; it adds no architecture, provider request, credential, permission or deployment.

The integration description previously incorrectly required baseline before task creation/observation. It now matches the original code: omitted baseline is unavailable/null and does not prevent authorized observation; a supplied invalid baseline is rejected. A completed observation/window is not goal verification. Missing metrics remain null/gaps; sufficient measured metrics are only observed_not_adjudicated with goalVerified:false.

Current targeted verification: **31/31**, zero failures/skips/cancellations, exit0. The output contains synthetic test cases, not real business acceptance. Commands and a hash of ephemeral test output are in checks.json; raw runtime output and session data are excluded from delivery. The earlier 267/267 integration regression and 8/8 Host checks belong to the implementation commit above and are not claimed rerun for this docs/tests-only follow-up.

See [minimal startup and exact DeepSeek variables](../../FACTORY-START-AND-DEEPSEEK.md), [corrected integration contract](../../FACTORY-CAPABILITY-INTEGRATION.md), and [monitor contract](../../MARKET-VALIDATION-MONITOR.md). Existing API/budget authorization remains acknowledged; no paid call is made in this closeout. The review archive contains only selected source/Skill/test/doc files, an applicable filtered patch, manifest and acceptance summaries; it excludes .git, environment files, credentials, dependencies, binary assets and raw runtime/acceptance logs.
