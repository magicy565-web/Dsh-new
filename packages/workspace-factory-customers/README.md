# Workspace factory customer drafts

Private local standard Pi/OMP package for a Chinese factory assessing public overseas buyer/distributor sources. Official targets: Pi 1.1.0/Node 24.19.0 and OMP 18.10.4/Bun 1.3.14. It has no dependencies, hooks, network client, search engine, storage or model executor.

The official model/tool loop chooses existing `workspace_public_search`, `workspace_public_browser` and optional original public text review tools directly. This package supplies a Skill and just one tool, `workspace_factory_customers_save`. The former status/research wrappers and fixed search→browser pipeline have been removed. No `businessSubmit`, factory-export stages or fixed three-document output remains in this package.

Inject `factoryCustomersExtension({client, authorize})` into a controlled Host. The exported pure `validateCustomerDrafts(input)` applies the same closed field/bounds/public-text checks and returns a copied DTO; the Host can reuse it before its independent journal and authorization checks:

- `authorize(signal, model)` checks original current authority before and after save. The exact current official model is required.
- `client.save(input, signal, model)` receives `{requestId, documents:[{name,content}], sourceToolCallIds}`. Documents: 1–5 unique safe ASCII Markdown filenames, each ≤24,000 characters and total ≤60,000. References: 1–20 unique original successful search/browser call IDs; request ID ≤128 characters. It returns the original JSON receipt with `plugin:'workspace-factory-customers'` and `status` (for example `saved-draft`, `partial`, `blocked`).

The Host must independently resolve each source selector from the same owned original conversation journal, verify original tool and success state, derive URLs/time/provenance, recheck current authority and save through original artifacts. The Host retains original idempotency, cancellation and permission checks; it must mark the artifact unreviewed/unsent and bind original conversation/Run provenance. The package neither manufactures source receipts nor implements these permissions. Missing injection returns `unconfigured`; rejected input/authority or client errors return safe blocked JSON without host error text. Caller-created source objects are not accepted.

Only explicitly public draft text belongs here. Narrow credential/path/Library-marker checks are not a DLP system. Private materials, authorization receipts or a private-material profile cannot become web inputs. Source snippets do not establish buyer identity, factory fit, purchasing intent or permission to contact. Preserve facts, inference and missing information separately; no automatic matching or external actions.

Pi: `install /absolute/path`, disable package resources with `extensions:[],skills:[]`, and `remove /absolute/path`. OMP: `plugin link /absolute/path`, `plugin disable @workspace-agent/pi-factory-customers`, `plugin enable ...`, `plugin uninstall ...`. Other plugins/native tools remain untouched; removing the package does not delete original artifacts or enterprise files. No npm publication is involved.

Acceptance uses actual official package resolution and SDK tool loops with explicit finite keyless model/search fixtures. The save client in package SDK tests is a test double; original Host/artifact integration is tested separately. No fixture proves a real customer, paid model or public network success. Previously observed native DDG refusal remains unresolved; it is not rerouted or retried by this package.
