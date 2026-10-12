# Attachment cleanup regression checkpoint

Baseline: `d2fc559e71056585edb6efa438dd9caf37e5b2bc`.

This checkpoint changes only the denied-refresh assertion scheduling in `test/muse-conversation-ui.dom.test.mjs`: after the original dialog and file control disappear, wait for the original AbortSignal to become aborted, then retain its strict `true` assertion. The existing bounded helper permits at most 280 polls at 25 ms (approximately seven seconds), below the product's separate 20-second read timeout. There is no fixed settling sleep, removed assertion, authorization change, or production-code change.

A clean restoration verified every included file against its Git blob. Fresh pinned root and TUI dependencies were installed using the existing lockfiles; Node 24.19.0, npm 11.9.0. The original product build passed. The baseline combined conversation DOM suite passed 17/17 here and eight concurrent focused repetitions passed. The previously reported intermittent immediate-signal failure was **not reproduced in this environment**.

The changed assertion passed the combined suite 17/17. A mutation experiment removed only `controller.current?.abort()` from the existing VerifiedFile unmount cleanup. The focused test then failed at the bounded wait, before the 20-second read timeout could cause a false pass. Mutation details and the expected failure output are retained. The original file was restored byte-for-byte (Git blob `7ea6e8313c828847dfafc037ab7b169840a94be4`), rebuilt, and the combined suite passed 17/17 again (`restored-conversation-dom.txt`).

These logs describe the baseline plus this minimal test patch. Later packaging or evidence commits must name their own exact source. All application behavior used synthetic local transport/fixtures, not a real model, Host/Muse, merchant account, notification recipient, or device. Broader backend/client/browser validation is separate and this checkpoint alone is not a full-suite pass or production acceptance.
