# PR107: reviewed Medusa source through the original CLI

Candidate base: `a819897d9212212afab8f12683d212971c982e8b`. This closes the existing PR107 gap between a programmatically supplied `medusaSource` and the original `startWorkspaceServer` entry. It is a local source candidate, not installed on release `7008f5b66731edcd12cb62aa33eb3c4a19ce3218`.

## Operator configuration contract

Space remains off unless `WORKSPACE_SPACE_ENABLED=1`; the original enterprise signed ingress must already be configured. A Medusa source additionally requires both absolute paths:

- `WORKSPACE_SPACE_MEDUSA_REVIEW_FILE`: private JSON, 1–16,000 bytes.
- `WORKSPACE_SPACE_MEDUSA_READ_TOKEN_FILE`: private raw dedicated read token, 16–4,096 printable non-space ASCII characters, with no newline. It is not an Admin key. The source loader never falls back to `WORKSPACE_MEDUSA_SECRET_API_KEY` and rejects equality with that key when it is present in the same trusted environment.

The original private-file helper rejects final symlinks, hard links and non-regular files. On POSIX, both files must have no group/world permissions and be owned by the service UID or root; the service must actually be able to read them. Both opened files must also have different device/inode identities; lexical path aliases cannot turn the review JSON into the token. Use separate files. Only explicit paths are read; no environment-wide credential search or file discovery occurs.

Example review data (synthetic placeholders, not a grant or deployment instruction):

```json
{
  "version": 1,
  "reviewed": true,
  "sourceId": "11111111-1111-4111-8111-111111111111",
  "workspaceId": "reviewed-workspace",
  "subject": "reviewed-owner",
  "role": "admin",
  "baseURL": "https://reviewed-medusa.example",
  "timeoutMs": 5000
}
```

Only those fields plus optional boolean `allowLoopbackHTTP` are accepted. The original reader validates the UUID, exact origin, dedicated token and bounded timeout. HTTPS must have no credentials, path, query or fragment; explicit loopback HTTP additionally requires `allowLoopbackHTTP: true`. The origin is the sole remote receiver for this reader. The review's workspace and subject/role must match an existing member in the original enterprise configuration. This is one exact tuple, not independent lists of subjects, roles or sources. Changing the review requires an explicit server restart; file contents are not silently refreshed into old Sessions. Revocation/expiry/current-member changes are checked by original live authority on every read.

Once the original enterprise setup and dedicated review/token files have been separately authorized, the existing launcher is used unchanged:

```sh
WORKSPACE_SPACE_ENABLED=1 \
WORKSPACE_SPACE_MEDUSA_REVIEW_FILE=/absolute/private/space-medusa-review.json \
WORKSPACE_SPACE_MEDUSA_READ_TOKEN_FILE=/absolute/private/medusa-agent-read-token \
node server/index.mjs
```

This excerpt deliberately omits the existing signed-ingress settings; they remain required. An explicit disabled `workspace-medusa-catalog` backend refuses the new source binding. No optional business model profile or full plugin collection is enabled by this configuration.

## Reused runtime and permission boundaries

- `server/space-startup-config.mjs` reads the two explicit files and constructs the existing `createMedusaApprovedSource` from `plugins/workspace-medusa-catalog/src/approved-source.mjs`.
- `server/space-core.mjs` passes only its original synchronous `who/current` check into the trusted source factory. No Store, AccessControl object, member Map, fabricated Session or cached permission result is exported.
- `server/index.mjs` supplies the options through the original startup/createApp path. Existing programmatic source bindings remain supported; simultaneous direct and factory source bindings are refused.
- The reader narrows access to the reviewed workspace/subject/role, then calls the original live-current function. Original signed HTTP, Session, CSRF, Space ownership/sharing, source revision/hash and final response checks remain in place.
- Original GET-only `/agent/product-contexts?limit=100` and `/agent/product-contexts/:id` are used, with original response bounds, redirect refusal and token-echo checks. No new reader, persistence, remote mutation or database is introduced.
- Space persists exact references, not Medusa product authority or returned titles. Remote source consistency remains point-in-time. Current source pins still use `sourceId`, native product ID, review revision and approval fingerprint.
- `modelAccess: false` remains explicit. A Space reference is not a model disclosure, Library fact, structured-memory write or permission to send a product to a model. Those independent original authorization gates are untouched.

## Evidence and limits

On local Node v24.19.0:

- Before: original startup helper returned only `{ enabled: true }`; an explicit reader-assembly assertion failed because no source factory existed.
- Nine new tests passed, with zero skipped: private file/configuration validation (including a same-inode path-alias red/green regression), exact member/source tuple, default-off behavior, original Store/AccessControl/Space, finite loopback Medusa reference reads, source revision change, original Session revocation, and member change during a read. Their login context and product rows are synthetic. They do not prove the signed index startup path.
- The original `space-core.test.mjs` and `space-original-store.test.mjs` passed 39/39.
- `space-medusa-startup.http.test.mjs` defines two actual `startWorkspaceServer` + signed HTTP checks. Local execution stopped during import because `@earendil-works/pi-ai` is missing from the existing dependency installation. Neither HTTP test body ran. No package stub, lock change or alternate production import was used.

Commands:

```sh
node --test test/space-medusa-startup.test.mjs
node --test test/space-core.test.mjs test/space-original-store.test.mjs
node --test test/space-medusa-startup.http.test.mjs
```

The two HTTP tests require the original complete locked dependencies. They use temporary synthetic keys, private fixture files, loopback Medusa and unconfigured models; external fetch attempts are rejected. No native SDK or paid provider request is selected.

Before live use, the existing PR109 Medusa Agent read API must independently pass its real service/database acceptance. Its `AGENT_CONTEXT_READ_TOKEN` must be a separately approved dedicated read credential, not an Admin credential. An opaque token cannot be proven read-scoped merely by its bytes; the original remote endpoint must enforce that contract. Real token creation/injection, authorization of the exact source and recipient, production configuration, and live remote data reads are all still pending separate approval and verification. This candidate does not perform them.
