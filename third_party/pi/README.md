# Pi upstream attribution

[earendil-works/pi](https://github.com/earendil-works/pi), reviewed source `abe508e1b89912adde45528136c3221eb69acdd7`, is MIT licensed. [LICENSE](LICENSE) preserves the original copyright and permission notice.

`server/pi-subagent.mjs` adapts the ownership-index, owned child creation and stable submission-ID pattern from `packages/durable/test/examples/22-subagent-foreground.ts`. The official task/extension/ownership implementations are consumed from exact 1.1.0 registry dependencies, not copied into a replacement engine.

The actual official coding-agent SDK/TUI is also a pinned dependency. No code from the reviewed community `pi-subagents` candidate is installed, vendored or executed in this application.
