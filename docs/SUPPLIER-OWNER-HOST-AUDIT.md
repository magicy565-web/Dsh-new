# Existing owner host audit

Scope: source-only audit of baseline `8ce17ef22190a878f520bad1871029748f211513` and supplier/session implementation `8af564f15fcb821cde1054984356d2e3f3c75c0c`. No production configuration, account, credential file, OAuth database or connected worker was read or called. Historical deployment overlay files establish source behavior, not current deployment state.

## Result

Existing owner authentication and native ownership bindings are reusable. The available source does **not** implement an existing supplier owner grant resolver that can be wired into the new MCP route. This is an authorization-integration implementation gap, not merely a missing environment variable. The baseline owner factory explicitly required a host-owned `readReviewedScope`, but had no registration or producer for it.

The external-connector HTTP registration and closed service calls are complete. The ordinary CLI intentionally reports `ownerMcp.status=binding_required` and refuses `/supplier-mcp` with `SUPPLIER_OWNER_BINDING_REQUIRED`. Loading an existing Workspace session or a worker OAuth configuration cannot change that state safely. There is no owner grant-file format, grant creation API or scope-expansion fallback. The separately authorized owner-session protocol adapter below reuses the original HTTP decision directly, without resolving or fabricating a grant.

## Existing owner HTTP compatibility (read-only feasibility check)

The missing **external connector grant resolver** does not block an already authenticated owner using the original HTTP business routes. Their existing per-request authorization already permits the corresponding business operations. `index.mjs` calls `access.begin`, `musePrivacy.guardHttp`, `readBody`, `access.verifyBody` and the body-aware privacy guard before `supplierServiceHttp`/`supplierPublicationHttp`. In enterprise mode, these require the original signed method/target/body, live matching member/session, CSRF and role. `supplierOwned`/`supplierFind` then enforce exact owner/workspace/conversation/service ownership.

| MCP operation | Existing HTTP operation / bound function |
| --- | --- |
| `get`, `monitors` | GET supplier record or `/monitors` → `service.forActor(context).get/monitors` |
| `intake`, `profile`, `preview`, `save_product` | POST supplier collection or `/messages`, `/profile`, `/preview`, `/save-product` → `request/profile/preview/saveProduct` |
| `image_upload` | POST `/api/artifacts` → `artifacts.create`; keep the MCP wrapper's narrower private metadata, owned conversation, PNG/JPEG/WebP, size and namespaced request-ID checks |
| `shopify_observation` | POST `/shopify-observation` → `observe` |
| `publication` | GET `/publication` → `publication.forActor(context).publication` |
| `publication_review`, `publication_execute`, `publication_reconcile` | POST `/shopify-review`, `/shopify-execute`, `/shopify-reconcile` → `reviewPublication/executePublication/reconcilePublication` |
| `monitor_create`, `monitor_check`, `monitor_stop` | POST `/monitors`, `/monitor-check`, `/monitor-stop` → `createMonitor/checkMonitor/stopMonitor` |

Except the artifact route, paths above are under `/api/conversations/:cid/supplier-services[/:sid]`. Existing service revision/hash/request fences, Pi admission/configuration/budget, manual publication approval consumption and disabled-schedule creation remain required. The HTTP decision is made for this exact request; a session identity object alone is not that decision or a connector grant.

The subsequently authorized minimal implementation provides an MCP representation of the **same original authenticated owner HTTP request** at `/api/conversations/:cid/supplier-session-mcp`. `supplierOwnerMcpHttp` only reaches session dispatch after the original authentication, exact body and recursive privacy checks. The shared `invokeSupplierOwnerOperation` calls the same original bound services, with independent ownership and live-request checks. Both existing cookie and native session-header transports are tested. There is no worker OAuth use, new durable grant, session-to-scope conversion, external-resolver fallback or new permission. The external route remains blocked without its original resolver. No real entrypoint was enabled or deployed.

## Traced sources

| Existing source | What it actually authorizes | Why it cannot produce supplier owner scope |
| --- | --- | --- |
| `server/access.mjs`: `nativeSessionIdentity`, `nativeSessionById`, `begin`, `verifyBody` | Original live Workspace member/session, role, workspace, ingress/body integrity, expiry and revocation | No operation, supplier service, reviewed input hash, connector consent or Pi budget. These checks remain the owner route's identity boundary. |
| `server/wechat-ingress.mjs` | Forwards the original live session through the existing signed ingress | No new role/grant store or supplier grant resolver. It is a transport adapter, not an authorization producer. |
| `server/pi-muse-binding.mjs`: `authorized`, `forActor`, `businessHttp` | Exact original administrator and native conversation for existing Muse order operations | The binding is for Muse prepare/approve/dispatch/refresh/cancel/accept and original result return. It cannot authorize supplier facts, private images or Shopify actions. |
| `server/muse-worker-native.mjs`: `bindControl` | Original owner read projection with `muse-host/self` grants for goal/order/task/attempt | It has no supplier operation or private supplier resource scope. Mapping this projection to supplier tools would expand authorization. |
| `server/muse-worker-native.mjs`: `supplierMcp`; `server/supplier-mcp.mjs`: worker extension | Separate worker credential plus original approved task/attempt/fence/lease, with two explicitly shared supplier reads | These are leased worker grants. The owner endpoint must not accept their credential or derive owner authority from the task creator. |
| `server/workspace-bridge.mjs`: `pinGrants`, `requestAction`, `executeAction` | A run's selected connector/action permits a proposal; exact bound human approval permits that connector execution | Selection is not execution approval. Approval is bound to the original run/proposal/connector/payload; it is not a general supplier-call grant. |
| `server/supplier-publication.mjs`: `binding`, `review`, `decide`, `execute` | Existing single-operation publication approval, pinned to supplier revision/preview/configuration/scope | Retained inside MCP execution. It cannot authorize other supplier tools, establish an owner connector session, or prove a publication timestamp. |
| `deploy/muse-native-overlay/server/workspace-native-plugin.mjs`; `workspace-plugin-service.mjs` | Reviewed native `operators` mapping and guarded epoch/configuration lifecycle; original workers, files, supply/library and native tasks | No supplier service registration or supplier grant producer. Its `bindResources` exposes supply/library, not this supplier engine. The overlay imports original host modules absent from this checkout and cannot be treated as a runnable current host. |
| `deploy/muse-native-overlay/deploy/native-dot-host.mjs` | Original native owner/session mapping; private reviews for exact existing Dot/Muse tasks/connections | Private review schemas contain no supplier input/resource grant. Historical review approval cannot be relabelled as supplier approval. |
| `deploy/oauth-auto-refresh-overlay/deploy/identity/identity.mjs` | `workspace-web` login and `workspace-dot-chatgpt` OAuth resource scope `workspace.dot` | Consent describes reading assigned tasks, execution and result/file return. Resource-scope validation only admits `workspace.dot`; it supplies neither an owner supplier scope nor private-data consent. Refreshing it preserves that original scope. |

Repository searches included server, vendor, scripts and deployment overlays, the existing historical commit `6e4d0414ad60a9d0df32011dba6737070a7f99d0`, and filenames in the tracked integrated/Pi source archives. Missing original host modules were not replaced or reconstructed. No claim is made about unprovided private host source or live grants outside this repository.

## Minimum remaining handoff

1. If the original host already has supplier authorization outside this checkout, provide its **source module/export and pinned revision**, the nonsecret reviewed scope schema and revocation/expiry behavior, and its original owner/conversation mapping. No token, signing key, private config contents or live credential is needed for code integration. The adapter must resolve that existing scope on each call, preserve its budget/one-use checks, and return null on missing, expired or revoked authority.
2. Wire that original resolver as `supplierOwnerMcpBinding.readReviewedScope` when the original trusted host calls `createApp`; retain the existing signed enterprise ingress/session path. Subject/workspace/conversation must come from that path, and operation/service/input hash must match the original reviewed grant. Do not map worker credentials, a role, a session expiry, selected connector actions or request `confirmed:true` into grants.
3. If no such existing grant/consent exists, there is no safe configuration-only enablement. A proposal for a new owner authorization mechanism would need separate user approval of exact tool operations, private data access, owner/conversation/resource binding, bounded lifetime/input/budget, and revocation/consumption rules before development. This task does not create that mechanism, add OAuth scopes or request broader account access.

The Pi TUI owner transport must continue to resolve the original Workspace session and exact native conversation. Its queue/Muse worker result credentials remain separate. PR57 records this boundary for the parallel Pi TUI and integration tasks; this branch changes neither Pi TUI nor its queue/owner policy. Cross-thread messaging was not available in this execution environment, so coordination was posted to the authorized private PR conversation.

Seven-day future notifications and durable recipient permission are a separate, still-unapproved mechanism. They remain undeveloped. Manual publication and monitoring approval flows remain unchanged.

## Verification

`test/supplier-owner-mcp.http.test.mjs` includes a real local HTTP regression using the actual `access.nativeSessionIdentity` and `nativeSessionById` implementations with a disposable synthetic enterprise session. Both resolve the existing administrator correctly; neither returned identity is accepted as a supplier mutation grant. The attempted call leaves supplier records, artifacts and model runs empty. Existing transport tests also show the worker endpoint lists exactly two supplier reads and rejects owner tools.

GA4 startup is independent of this owner-grant gap: its ordinary CLI metadata loader is complete, and remains `configured_unverified` until the original authorized source actually yields an observation. No real authorization was inspected or installed.
