# Optional native branding

Workspace Brand is retained as an optional working native plugin, not a new shell.
It uses host theme overrides and sidebar/conversation brand slots. Sessions, input,
permissions, model execution and layout remain owned by DSH. Disabled or unloaded
branding restores the host-managed presentation; it has no business storage.

Its existing lifecycle tests are included in the reduced root test suite. Historical
browser screenshots and old all-plugin acceptance narratives remain in Git and are
not evidence for current host or browser acceptance.

See [plugin README](../integrations/dsh/dsh-workspace-brand/README.md) and
[current validation](../VALIDATION.md). Do not install or change a live profile as
an incidental part of source cleanup.
