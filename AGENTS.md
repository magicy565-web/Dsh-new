# Foundation boundary

Use official DeepSeek Harness as the sole host. Keep this initial foundation
limited to pinned official runtime dependencies and installation documentation.
Plugins and UI changes are separate reviewed steps. Do not create a replacement
host, Agent loop, ERP or service wrapper.

Never commit runtime binaries, node_modules, credentials, profiles, sessions,
customer data or execution evidence. Do not modify/merge main, force push,
deploy, create credentials or expand permissions without separate authorization.
Use local non-global installation. Report actual checks, skips and limitations;
CLI version/help success is not live server, provider or plugin acceptance.
