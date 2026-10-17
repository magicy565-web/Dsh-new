# ERPNext enterprise field adapter

Independent native ESM/Pi package `@workspace-agent/pi-erpnext-enterprise` 0.1.0. Its only client dependency is the existing PR #86 package `@workspace-agent/pi-free-trade` **0.1.2**, through its public `./adapters` export. No copied HTTP client or new ERP service. The sibling directory is necessary because the original plugin's recursive pack closure checker does not support nested packages.

**Library remains the enterprise fact authority.** ERPNext projections identify themselves as ERPNext data; they do not claim that Library was migrated or that facts were saved to Library, memory, Brain or an Artifact. `persisted:false`, `externalWrites:false`. No automatic pricing, quotation preparation/writes, discovery scan, independent authorization, database, queue or Agent loop.

## Install and configuration

Use Node 24+. Install/extract both private packages in the same reviewed environment. The exact required peer is not bundled. Missing peer produces a module-resolution failure; never fetch a replacement client silently. This repository's shared plugin configuration is deliberately unchanged, so this package is unselected by default.

The `pi.extensions` entry registers two tools with **empty arguments only**:

| Tool | Result |
| --- | --- |
| `workspace_erpnext_enterprise_status` | `unconfigured` or `configured_unverified`, never `connected` or a permission grant |
| `workspace_erpnext_enterprise_read` | Only the single original Host-selected exact record and fields |

Ordinary native loading uses a disabled adapter: status/read return `unconfigured`, no credentials or environment/files are read, no HTTP. Missing selection, original Host control, safe original connection or disclosure gate also remains unconfigured. With a valid configuration, the original current authorization can still refuse every read. Do not paste credentials into chat or configure them for acceptance tests.

## Original permission/control contract

Trusted in-process composition only (illustrative; not added to the production launcher):

```js
import { createErpNextEnterpriseAdapter } from '@workspace-agent/pi-erpnext-enterprise/adapter';
import { erpNextEnterpriseExtension } from '@workspace-agent/pi-erpnext-enterprise';

// binding comes from the existing createFreeTradeSessionBinding in the Node Host.
// Original Host verifies signed member/instance/session/receiver and precise grants.
const control = binding.open(actualNativeSessionId);
const adapter = createErpNextEnterpriseAdapter({
  enabled: true,
  control,
  selection: reviewedExactSelection // {doctype, name, fields}; never model arguments
});
erpNextEnterpriseExtension({ adapter, host: originalDisclosureHost })(pi);
```

`selection` is validated by the existing `validateErpRead`, then copied/frozen. There are no model-supplied names, URLs, fields, filters, authorization flags or credentials. One instance represents one fixed projection. Different records/fields require a new explicit Host binding.

Required original control methods:

| Method | Existing responsibility |
| --- | --- |
| `enterprise:true`, `erp.status/read(input,signal,receiver)` | Existing PR86 client and its exact server-side fields/name filter; safe Host connection only |
| `authorize({tool:'workspace_erpnext_read',input},signal,receiver)` | Original exact record/fields/origin grant, signed session/member and current receiver; explicit `true` |
| `authorizeContext(signal,receiver,{phase})` | Original expiry, instance, model destination and capacity fence |
| `seal(input,upstreamReceipt,signal,receiver)` | Original receipt/projection/scope/native-session proof |
| `verifyBody(proof,{...upstreamReceipt,authorization:proof})` | Original proof/body integrity check |
| `check(proof,signal,receiver,{refresh,phase})` | Original permission/current-source check; refresh uses the same exact read |

These are the existing `createFreeTradeSessionBinding(...).open(...)` methods, including its bounded read capacity; the adapter does not create grants. It calls them before/after reads and before disclosure. The upstream body is **the actual existing client response** plus its original plugin identifier, as required by the original sealer; the model-facing mapped receipt uses its own plugin identifier. No mapped result is presented as a native upstream receipt.

The optional tool factory additionally requires original Host `addDisclosureGuard(check,id)`, `getModel()`, optional `signal` and `history`. The gate must run before every model send, model completion and final delivery. The tool compares its receiver to the original Host's current model object. The gate and context hook revalidate the immutable observed receipt through the original `check(...,{refresh:true})`. Revocation, changed projection, unknown receipt or modified cached body rejects disclosure. Repeat reads retain the first exact receipt only if the projected source is unchanged. Revalidation consumes the existing Host's read budget and does not retry failures.

**Integration remains a parent-session task.** This package adds no production Host profile, RPC admission, business journal validator, persisted disclosure snapshot or UI. Do not simply add its tools to a production allowlist: the original journal must explicitly validate this new receipt type and the actual send/delivery gates must run. A fresh package instance rejects prior private receipts; disabling/default-loading rejects successful private history. No old receipt restore/migration is implemented. Disable/uninstall applies to new sessions; it does not authorize redisclosure of earlier private data.

## Field mapping and citations

Every supported scalar field is mapped **one to one**, in Host-selected order. Keys are `erpnext.<record_namespace>.<original_field>`. Fields/values are not inferred, translated into Library facts, defaulted or aggregated. Null/false/zero remain distinct. Allowed records/fields are inherited from the sole existing client's `ERP_FIELDS`:

| DocType / namespace | Allowed fields |
| --- | --- |
| Quotation / `quotation` | name, modified, docstatus, quotation_to, party_name, company, transaction_date, valid_till, currency, grand_total, status |
| Sales Order / `sales_order` | name, modified, docstatus, customer, company, transaction_date, delivery_date, currency, grand_total, status |
| Sales Partner / `sales_partner` | name, modified, partner_name, partner_type, territory, commission_rate |
| Item Price / `item_price` | name, modified, item_code, price_list, buying, selling, currency, price_list_rate, valid_from, valid_upto |

`source` records ERP origin, canonical exact-filter URL, DocType/name, requested fields and UTC retrieval time. Each fact has `sourceRef:{id,field}` pointing to it. `projectionSha256` hashes **only the authorized scalar projection**, not the whole ERP document or a Library artifact. `modified` is cited only if explicitly requested/authorized; otherwise it is null and `revisionEvidence:'no_revision_field_authorized'`. Even the client's identity-only `name` check does not expose a name fact unless requested. Never infer a full document revision, human approval, availability, tax, final price, commission entitlement or order permission from these fields.

## Local acceptance

```sh
cd plugins/workspace-erpnext-enterprise
npm run build
npm test
```

Build checks native ESM syntax/import manifest closure; no transpilation is needed. `npm test` packs this package and the unchanged client with offline npm, extracts them under a fresh `/tmp/.../node_modules` outside the repository, checks packed/source bytes and executes `test/erpnext-enterprise-adapter/*.test.mjs` using Node 24. No install hooks, network dependency installation, real credentials, ERP/model/paid APIs. The fixture uses the **actual original Host control and actual existing HTTP client**, synthetic member/model/grants and a real loopback Node HTTP server. Native lifecycle uses the existing project discovery with temporary configuration; that is not the official SDK loader. Actual SDK execution, if separately attempted, is reported independently in the handoff.
