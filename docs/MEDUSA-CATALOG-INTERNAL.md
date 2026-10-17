> 上游设计/交接记录；其中的旧分支、完成状态和历史验证不代表本次验收。当前结论见 [统一插件验收](OMP-ALL-PLUGINS-INTEGRATION-20261017.md)。

# Medusa v2 内部产品库 · Workspace 原生集成

> Scope: optional Medusa v2 **unpublished internal draft** preview. Original Workspace Library is still the single source of truth. This does NOT install Medusa, publish products, configure ecommerce sales channels, or replicate Shopify.

## 1. Architecture

```text
Workspace / React product detail (mobile-first)
  GET /api/medusa/catalog/status
  GET /api/medusa/products/:productId/preview   -> original Library revision
  GET /api/medusa/products/:productId/remote    -> Medusa read-only reconciliation
  POST /api/medusa/products/:productId/draft    -> administrator-reviewed unpublished draft
              | original AccessControl (identity, role, signed ingress, CSRF, audit)
              v
server/medusa-catalog.mjs (optional adapter; secrets only on host)
              | selected fields + pinned original sourceHash
              v
Medusa v2 Admin API (separate dedicated self-hosted instance)
              | Postgres; Redis for production deployment
              v
Medusa internal draft; NOT shopper-visible / published / stocked

Original Pi/OMP Session (WORKSPACE_OMP_PROFILE=medusa-catalog)
  -> reviewed original factory materials policy
  -> original live Session and receiver
  -> workspace_medusa_status / preview / reconcile (read-only)
  -> original OMP journal refresh before the next model disclosure
```

Existing Shopify publication, source ownership, approval, artifact, pricing and customer visibility stay untouched. There is **no new Agent, PIM store, worker queue, goal, runtime or workflow scheduler**.

## 2. Free core and required services

- Medusa open-source core license: MIT; an independently deployed application needs PostgreSQL, server administration, and typically Redis / server+worker mode in production. See [official installation](https://docs.medusajs.com/learn/installation) and [self-host deployment guide](https://docs.medusajs.com/learn/deployment/general). These infrastructure resources are not supplied or installed by this branch.
- Start a separate Medusa v2 **internal-only** instance. Create a human Admin account and a scoped secret API key in Medusa Admin (Settings → Secret API Keys). Never send that key to a browser or Pi model. Secret API keys require `Authorization: Basic <token>`, not Bearer.
- Do not expose the Medusa Admin port publicly merely for preview. For a same-host test, use `http://127.0.0.1:9000`. For another host, deploy a secure HTTPS endpoint and protect it at the network layer.
- Medusa does not provide multi-tenant isolation out-of-the-box. Only ONE original Workspace may be assigned to an instance with this adapter. An isolated per-enterprise deployment or separately reviewed tenant model is required before SaaS rollout.

## 3. Host configuration (never check secrets into Git)

```sh
WORKSPACE_MEDUSA_SINGLE_TENANT_ACK=1
WORKSPACE_MEDUSA_WORKSPACE_ID=local
WORKSPACE_MEDUSA_BASE_URL=http://127.0.0.1:9000
WORKSPACE_MEDUSA_SECRET_API_KEY=<secret from dedicated Medusa administrator>
```

Replace `local` with the **exact original signed** `WORKSPACE_ACCESS_MODE=enterprise` Workspace ID for a managed deployment. A missing key, mismatching ID or missing acknowledgement keeps Medusa **unconfigured and unwritable**. A configured connection only reports `configured_unverified`, NOT an online verification. The UI can still read original Workspace source while Medusa is unconfigured.

**No new model fee** is introduced by these HTTP APIs. Calling an existing model in the original Pi/OMP Session retains all original model costs and approved budgeting. Medusa hosting is not cost-free infrastructure.

## 4. Enterprise product workflow

1. Create or edit a real original Workspace Library product at `products/:id`. Product stays `draft`. This UI remains the data authority.
2. In the product detail Medusa card, preview the **exact current source revision** and expand the full `title`/`description` to review. The card clearly lists skipped fields.
3. An original **administrator** confirms the internal copy using the checkbox; the guarded route stores only `title`, `description`, deterministic `handle`, `status:'draft'`, and lineage metadata (`workspace_id`, source UUID, revision, hash).
4. The route first reads the remote handle, checks ownership/status/metadata, and refuses to overwrite an existing stale, published, foreign or ambiguous product. Retried identical requests reconcile by deterministic handle; no blind duplicate POST.
5. If a network error leaves the outcome unknown, use **read-only reconcile first**; then resume with the *same* requestId through the saved UI pending request. Do not construct a replacement product.
6. Any original revision update marks the previous remote draft stale; the initial scope does **not** perform update-in-place. A second-source review path must be explicitly designed before editable remote synchronization.

**Data deliberately excluded**: product SKUs, MOQ, tier/wholesale prices, source documents, certificates, images, supplier policies, contact/customer records, stock, sales channels, purchase/shipping, Checkout and Shopify operations. These must never be inferred by AI from partial source.

## 5. Original Pi/OMP admission

```sh
WORKSPACE_OMP_PROFILE=medusa-catalog
```

This is a distinct fixed native `omp:18.10.4:medusa-catalog-v1` profile. It reuses the existing Pi/OMP runner, authentication, original live Session, original model recipient/cost bound, Run/cancellation and original factory Library policy.

The original approved factory material disclosure must explicitly pin the product UUID+revision and include `name`, `description`, `category`, `status`, and `provenance` in `factoryMaterials.productFields`. Otherwise Medusa preview/reconcile is blocked. Refer to existing factory-materials policy documents. Revocation, Session expiry, changed revision/recipient or a forged cached receipt block the next model request.

Read-only tools: `workspace_medusa_status`, `workspace_medusa_preview`, `workspace_medusa_reconcile`.

**Model-initiated Medusa writes are not exposed.** This is intentional: the original user-confirmed administrative UI controls the remote draft write. Existing agent-powered product ingestion and source edits remain with the original factory ingestion skill; Shopify publication still needs the original separate human review.

## 6. Test and acceptance

```sh
# Run on the repository's required Node 24 environment with dependencies installed
node --test test/medusa-catalog.test.mjs
node --test test/medusa-catalog-http.test.mjs

# Existing code-level regression checks (run in original environment)
npm run typecheck
npm test
```

Check `package.json` scripts if `typecheck` is not exposed. Original repository-wide tests can fail for unrelated baseline/provider/CI reasons; record them separately.

Current branch evidence:

- All changed JS/MJS files were parsed as JavaScript with imports/exports rewritten in a separate isolated V8 syntax probe. This is **not** a Node 24 build.
- Committed `server/medusa-catalog.mjs` was executed with synthetic URL/HTTP/hash primitives: original source projection, draft creation, linkage, omission of secret price/supplier fields, idempotent read-back and stale-source rejection passed. This is **not** real Medusa or HTTP end-to-end verification.
- Node24 integration suite, TypeScript frontend build, actual Medusa Admin API, original OMP 18.10.4 runtime, actual model calls, app screenshots and production rollout remain **unverified** pending an authorized environment.

## 7. Exit criteria before publishing or wider use

- Real dedicated Medusa v2 server running; verify Basic secret API key and returned product metadata, and confirm draft is absent from Storefront.
- Run the repository HTTP tests and OMP native profile under real Node24/Bun fixed SDK with an explicitly reviewed product revision and live authenticated member.
- Test original enterprise signed ingress, CSRF and session revocation; test wrong workspace, concurrent writes, remote timeouts, unexpected 4xx/5xx, stale revision, previously published remote, plus route audit logs.
- Exercise actual mobile UI at 360 px / 390 px with original product content; screenshots and accessibility checks.
- No model secret, Medusa key or enterprise data may be committed, logged, sent to browser, exported to another tenant or disclosed outside approved original source fields.
- **No automatic SKU/pricing import or Shopify publish** until separate business mapping, source authorization, conflict policy and human approval are implemented.

## Relevant source

- `server/medusa-catalog.mjs`: optional Medusa transport and deterministic draft/reconcile.
- `server/medusa-product-client.mjs`: exact live factory material admission for Pi.
- `packages/workspace-medusa-catalog/`: native read-only tools and separate Skill.
- `src/library/MedusaProductPanel.tsx`: original responsive UI, human review and recovery.
- `test/medusa-catalog*.mjs`: source-level and original HTTP test fixtures.
