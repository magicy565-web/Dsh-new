# Source quickstart

Use Node 24+ and the current [development commands](DEVELOPMENT.md).
The source includes four core plugins and optional branding, not the former full
Workspace application. Build/test/CI cover only retained code.

```sh
npm ci --ignore-scripts
npm run check
npm run test:client
npm run package:business-services
```

Package output is ignored under dist/business-services. Installation is an
explicit operation using the external official DSH CLI; see [pilot guide](COMMERCE-PILOT-QUICKSTART.md).
No credentials or runtime data belong in source. Historical documents/versions
remain in Git, and do not prove current deployment or real integration.
