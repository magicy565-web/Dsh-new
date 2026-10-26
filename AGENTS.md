# DSH development boundary

Scope correction: the user rejected building a broad business platform. Follow
docs/SCOPE-REDUCTION.md. Treat "continue" as continuing the agreed scope, not as
permission to invent the next business module, panel, approval chain or stage
engine. Audit and remove duplication first; use native DSH capabilities and
on-demand skills. Existing business bundles are not the required core. The
earlier five-bundle development profile is historical implementation state,
not the target architecture. Preserve data during any subsequent code removal.

Buyer magazine scope is defined in docs/BUYER-MAGAZINE-ARCHITECTURE.md:
conversation-driven creation, with no visual editor requirement. Read actual
materials from the user's accessible local workspace or server-side work-order
uploads. Cloud execution does not imply access to the user's computer. ERP owns
transactions and supply reservations. The user subsequently authorized a small
local ERP: integrations/dsh/dsh-mini-erp is the single transaction ledger for
this pilot. It has no buyer portal or work-order integration. Keep further
ERP development scoped to the user request; no parallel transaction state.
The user explicitly required a standalone website-to-magazine plugin and removal
of duplicate rendering. dsh-buyer-magazine owns the magazine skill pack,
schema/theme/compiler and native generation entry. Sourcing reuses it; modules
and ERP are input adapters. Keep it independently installable without Sourcing
or ERP, and do not create a second renderer or execution host.
The user supplied luxury_ecommerce_skills_package.zip: preserve its four skills
and source resources, with explicit native DSH integration contracts. The target
is five editorial spreads with scroll/flip modes, real source imagery, typography,
working interactions and actual screenshot/PDF review. Unconfigured external
Apify/FastAI/VIP/lead services must not be described as working capabilities.
The user now wants a Shopify Admin-style operator ERP. Follow docs/ERP-REUSE.md:
reuse the native library's product/SKU/media/document capabilities and unify
master data before building duplicate CRUD. Conversation-only magazine creation
does not prohibit an ERP operator UI. Do not migrate existing records implicitly.
The user confirmed that the ERP UI remains inside DSH. Follow
docs/ERP-ADMIN-DESIGN.md for the Shopify-style resource index/detail layouts;
reuse the original library editor component rather than a second CRUD implementation.
The latest user request authorizes a complete Shopify Admin-style navigation and
page UI/UX package inside DSH, wired to existing capabilities. This supersedes the
earlier incremental-page restriction. External/unimplemented services have honest
unconnected states; full backend parity is not authorized or claimed.
Use standard products, customers, orders and files; do not add magazine-specific
supply-rights navigation or checkout choices. Legacy rights and reservations
remain readable/replayable without reclassifying them as Shopify draft orders.
Customers retain legacy buyer IDs and contact text; preserve existing records.
Proper draft orders, payment/fulfillment state and inventory semantics are still
outstanding; do not claim parity by renaming the existing reservation ledger.

ERP now uses Radix Themes and Lucide. Edit dsh-mini-erp/src and run
`npm run build:erp-client`; client.js is a generated native factory, not a new
web application. Keep React host-owned and CSS scoped to ERP. The library ui
adapter changes presentation only; retain its original persistence logic.

The user selected DeepSeek Harness as the sole execution host and explicitly
requested removal of the standalone Workspace Harness and remaining legacy
implementations on 2026-10-26. Develop native bundles under integrations/dsh.
Do not restore old React/Node apps, OMP/Pi/TUI, custom Agent loops, composition
servers, installers or historical release archives in the current tree.

Reuse native DSH sessions, model execution, tools, permissions and attachments.
Business workflow gates belong in optional plugins, not the general substrate.
The packages/domain-* packages contain reusable domain rules only. The native
dsh-workspace-memory and dsh-inquiry-recovery bundles adapt their domains to DSH.
The Medusa product domain awaits integration; the native local product library
already supplies product context. Preserve source/version/review boundaries and state keys.

Run npm ci --ignore-scripts on first setup (Node 24+), then npm run check. Optional Client
DOM tests use the root devDependencies: npm run test:client. Neither establishes
live host/model/browser acceptance. Never put user data, credentials, native
sessions or generated release archives in Git.

Work on agent/harness-20261023; stage explicit paths only. Do not force-push or
rewrite release history. Preserve untracked user files and other checkouts.
See docs/DEVELOPMENT.md for the current layout and integration work.
