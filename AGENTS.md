# Current development boundary

The user selected DeepSeek Harness as the execution host on 2026-10-26 and explicitly
retired the independent Workspace Harness. Do not recreate its kernel, seams,
composition server, standalone Agent loop or installer. Reuse native DSH services.

Develop native bundles under integrations/dsh. Business workflow gates belong in
optional domain plugins, never in the general execution substrate. Reusable
packages/domain-business-memory and packages/domain-product-library contain only
domain logic; they are not mounted tools or running services.

Run npm run build and npm test for the current DSH source. These checks do not
establish live host/model/browser acceptance. Preserve user data and unrelated
legacy/Medusa work. Do not use old 8790 release evidence for this product.

Work on agent/harness-20261023; stage explicit paths only. Do not force-push or
rewrite release history. Read deeper AGENTS.md before changing other packages.
