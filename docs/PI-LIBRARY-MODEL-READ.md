# Controlled company and product reads in the official Pi Agent

The three built-in Library tools use the original enterprise Business Library
Store through a read-only HTTP projection. They are real adapters, not populated
examples and not an alternative database. The normal `agent:dev` CLI remains
disabled for private Library reads until an existing enterprise Session transport
and an explicitly reviewed host policy are supplied. Agent Bearer credentials
do not become enterprise Sessions and cannot authorize these endpoints.

| Official Pi tool | Original source | Disclosure projection |
| --- | --- | --- |
| `workspace_company_profile` | Business Library company record | `legalName`, `displayName`, `description`; original ID and revision |
| `workspace_products` | Explicitly approved original product IDs and revisions | `name`, `description`, `category`, `status`; original ID and revision |
| `workspace_product` | One explicitly approved original product ID and revision | Same four product fields; original ID and revision |

Every successful receipt contains original record references and a projection
SHA-256. Returned text is evidence, not permission to change tools or perform
actions. Library reads cannot submit tasks, approve proposals, publish, dispatch
Workers or retrieve arbitrary files. Existing business tasks continue through
their original member binding and budget/approval paths.

## Activation boundary

No environment variable silently enables disclosure. An integrator must supply
the existing enterprise Session HTTP binding and `libraryModelReadPolicy` to the
existing host. The policy is disabled by default; enabling it requires an
explicit reviewed scope: exact workspace, existing member subject, expiry,
company revision and selected company fields, selected product IDs and revisions,
product fields, and one concrete model recipient. This does not grant a role,
create a credential or expand an account's existing library permissions.

Before activating real data, the user must confirm disclosure of these precise
categories: company legal/display names and description; selected products'
names, descriptions, categories and draft/archived status; and their record IDs,
revisions and projection hashes. Receipts also disclose the binding metadata
needed to validate the scope: existing workspace/member identifiers, scope
fingerprint, expiry and the pinned model recipient. Structured SKU/specification,
pricing, MOQ, lead-time, supply, image, document, qualification and contact fields
are excluded. The allowed company/product descriptions are free text: they may
themselves contain prices, contacts or other sensitive facts. The exact approved
revision must be reviewed before disclosure; the projection does not claim to
semantically remove every sensitive fact from allowed text. Credential-like text
is additionally rejected, but that guard does not replace review. Newly edited
revisions need renewed review rather than automatic disclosure.

The model recipient is also explicit. This acceptance uses only
`workspace-agent-test-faux / workspace-agent-test / faux://keyless-synthetic`,
with no model account or network model request. A future DeepSeek activation
would require separately confirming
`workspace-deepseek / deepseek-flash / https://api.deepseek.com`, a safely
configured host key and the agreed CNY 5 validation budget. It must not inherit
an old FastAIToken configuration or a key pasted into chat. No real recipient
has been approved or activated by these changes.

After separate approval, an existing Host integration can prepare the following
wiring. The names below are reviewed inputs, not defaults or new credentials.
This example is not executed by the normal CLI:

```js
const libraryModelReadPolicy = {
  enabled: true, reviewed: true,
  workspaceId: existingSession.workspaceId,
  subject: existingSession.subject,
  expiresAt: approvedExpiry,
  recipient: approvedRecipient,
  company: { revision: approvedCompanyRevision, fields: approvedCompanyFields },
  products: approvedProductIdsAndRevisions,
  productFields: approvedProductFields,
};
const app = await createApp({ ...existingHostOptions, libraryModelReadPolicy });
const libraryClient = createWorkspaceLibraryClient({
  request: existingEnterpriseSessionGetTransport,
  recipient: approvedRecipient,
});
const client = createWorkspaceClient({ ...existingAgentServiceBinding, libraryClient });
await createWorkspaceAgentRuntime({ ...existingOfficialPiOptions, client });
```

The Session callback accepts a relative `/api/library/model-read/...` path and
GET options and returns a `Response`. It must preserve the original Session
authorization at the original service origin. The plugin never logs in or
accepts a Session credential from model input. Current CLI/owner transport
allowlists are not silently extended; a real Host must provide its compatible,
already authorized read binding before this wiring can be activated.

## Honest failure and persistence

Unconfigured means no active host disclosure policy/binding. Blocked means the
current enterprise identity, recipient or reviewed scope does not permit the
read. Empty means an authorized projection contains no approved records/data;
it does not generate sample products. A changed approved revision returns a
conflict without the record body. An unknown or unapproved product returns the
same not-found response before inspecting its private body. Transport failures
remain failures and do not become successful answers.

The official Pi transcript may contain approved projections. Reopening it must
revalidate the current Session and reviewed recipient/scope before any cached
private receipt can reach a model; revoked, expired, different-member or changed
policy/model sessions fail before a model call. Task results still require their
existing fresh member checks. No second task or Library store is introduced.

## Verification scope

The new `test/pi-library-read.test.mjs` exercises actual loopback HTTP, enterprise
Session authorization and persisted synthetic Business Library records. The
PTY test starts the actual official Pi `InteractiveMode`; its finite, clearly
marked faux model selects the three real tools and builds answers from the
actual tool receipts. It proves the SDK/tool/HTTP/Store path, not general model
reasoning or a real DeepSeek connection. Fixtures stay in temporary directories;
runtime records, raw transcripts and Session credentials are not committed.

Run targeted checks with:

```sh
node --test test/pi-library-read.test.mjs test/pi-library-read.pty.test.mjs
```

The 2026-10-14 targeted run passed 14 Node cases and 2 actual official Pi PTY
cases. It covered three persisted-record reads and original references; an
authorized empty catalog; unconfigured policy; wrong member and a separate
enterprise Session/Store; recipient mismatch and expiry; unapproved IDs and
revision drift; forged projection hashes and unsafe extra fields; a partially
missing approved product selection with no partial disclosure; denied queries
and writes; and reopening plus official same-session model switching. Denied
requests retain existing ingress audit behavior while leaving Business Library
records and mutation receipts unchanged. A compatible unchanged Session can
reopen and perform fresh task reads. All model responses were explicitly finite
faux responses; live model calls were zero.

Real private-library access, a real model call and external Personal Worker
dispatch are untested and intentionally inactive. Existing task/lifecycle tests
remain required regressions for integration.

On 2026-10-14, the dedicated suite passed 14 Node checks and 2 actual official POSIX PTY checks. Related checks passed 139 additional unique Node checks, 6 existing official PTY checks and 28 Python client checks; the TypeScript/Vite build passed with its existing chunk-size warning. The follow-up Agent/startup/plugin group passed 16 overlapping checks. Source hashes, exact commands, counts and compact synthetic evidence are in [acceptance.json](validation/pi-library-read-20261014/acceptance.json). Cached pinned packages were used; no clean install or GitHub CI success is claimed.
