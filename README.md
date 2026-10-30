# Official DeepSeek Harness foundation

Foundation first; verified native plugins and a customized Client UI are later
steps. This source contains only the official runtime dependency manifest/lock,
not a replacement host or a copy of another application's server.

## Install locally

Use Node.js 24 or newer and npm in this directory:

```sh
cd runtime
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/@deepseek-ai/dsh/lib/bin.js --version
node node_modules/@deepseek-ai/dsh/lib/bin.js --help
```

The lock pins `@deepseek-ai/dsh` to `0.2.1-rc.2` and
`@deepseek-ai/cordis` to `4.0.5`, with official npm registry integrity metadata.
Installation is local, not global. Lifecycle scripts are disabled; dependencies
that need those scripts are not thereby certified operational. Version/help
checks verify the CLI entry only, not a running host or all runtime features.

Do not commit `node_modules`, native profiles, login tokens, sessions, logs,
credentials or user data. No plugin, model provider, real service connection,
server deployment or customized UI is installed by this foundation manifest.
Profile initialization and startup must use the official CLI under a separately
chosen local operator directory; they may create a native owner-login token.
They are deliberately not run by installation or the checks above.
