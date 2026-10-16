# @workspace-agent/pi-factory maintenance memory

This is committed development knowledge, never runtime/company memory.
- Native manifest: package.json `pi.extensions` / `pi.skills`; original OMP 18.10.4 loader owns execution. No new Agent Loop.
- Keep tool names, schemas, receipt provenance and authorization boundaries compatible. Skills guide choices, not fixed steps.
- Standalone code must not import server/* or another repository-only path. Ordinary installation grants no Workspace client, credentials or enterprise permissions.
- Runtime material, credentials, native Session JSONL and actual outputs stay outside Git in explicitly selected per-project/per-enterprise directories. Use existing OMP persistence; no separate memory database.
- Run `npm run plugins:check` and the relevant package/contract test under `test/`; loading acceptance is `node --test test/workspace-omp-plugins.test.mjs`. No paid model request is required for these tests.
- See README for tool interfaces and tested/unverified capabilities. Do not infer real external service success from finite mock-model evidence.
