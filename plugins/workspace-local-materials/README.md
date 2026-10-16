# Local materials and owner references

Independent `@workspace-agent/pi-local-materials` 0.2.1 for original OMP 18.10.4. The native package loader loads `pi.extensions`/`pi.skills`; the original Session/provider owns inference and tool execution. There is no extra Agent Loop, mandatory intake sequence, remote business client, vector database, embedding or retrieval service. An MOQ question can end after a read; saving, updating and memory are separate choices for the user's goal.

The package can be copied outside the repo. Source imports only Node builtins, its own modules and the host-supplied pinned OMP runtime. PDF extraction uses the actual native ReadTool. CSV uses `/usr/bin/python3 -I -S` and stdlib `csv` with fixed arguments, bounded IO and a timeout; no shell or additional npm runtime dependency. Missing dependencies return unavailable.

## Install and existing drafts

Under a reviewed plugin root, enable `./workspace-local-materials` in `config.json`'s `extensions`. Explicit `disabledExtensions`, `--disable-plugin workspace-local-materials`, or `--no-plugins` wins. Remove/disable the entry before deleting the package and restarting. Enabled missing packages fail explicitly; unselected missing packages do not block ordinary local conversation. Extensions are trusted code with the process's OS permissions, not a JS sandbox.

Without archive flags, the existing five tools remain compatible: `read`, `write`, `workspace_factory_capabilities`, `workspace_factory_rfq_requirements`, `workspace_factory_match_prepare`. Select 1–4 text/PDF inputs, at most 64KiB total. Exact paths, SHA256, inode, no-symlink checks and new-basename-only writes guard local IO. The native WriteTool creates a new `.md`/`.txt` draft with source provenance; drafts are not business records or confirmed facts.

```sh
npm run factory:local -- --input /ABS/product.md --output-dir /ABS/private/drafts \
  --plugin-dir /ABS/reviewed/plugins --session /ABS/private/chat/conversation.jsonl "只回答 MOQ"
```

Existing secure provider configuration, reviewed prices and remaining budget remain required for real inference. Commands do not configure keys. `--check` makes zero model requests and creates no Session. Unchanged limits still apply: 128KiB requests, 64 messages, eight actual requests per goal, 512 output tokens per request, usage reconciliation and unknown-fee stop. Large histories can stop at these limits. One invocation runs one goal and exits; this is not a new TUI.

## Opt-in owner directory

**Current local OS owner only; customer sharing is blocked.** Enterprise/project IDs label data scope, not authenticated people, customer tiers, contracts or regions. Customer identity binding, grants, expiry, review administration, export and customer-serving endpoints are not implemented.

Create a private directory outside application/plugin source and Git. It must already exist, belong to the current UID, have mode exactly `0700`, and have no symlink path components. Keep chat and drafts separate and private. Resume the same enterprise/project/model/output-directory/UID scope.

```sh
install -d -m 700 /ABS/private/enterprise-A/project-one /ABS/private/chat /ABS/private/drafts
npm run factory:local -- --archive-dir /ABS/private/enterprise-A/project-one \
  --enterprise enterprise-A --project project-one --input /ABS/products.csv \
  --output-dir /ABS/private/drafts --session /ABS/private/chat/conversation.jsonl \
  "分别保存两个产品的资料草案，缺项保留待确认"
```

Later use the same command with a new goal and explicitly selected new inputs. After sources are explicitly retained, omit inputs to query the archive. Reading alone does not retain sources. Removed unretained sources in prior context block continuation; retained originals allow historical reads after original selections are removed. Non-archive mode still requires the original selected paths/hashes.

| Independent tool | Behavior |
| --- | --- |
| `workspace_local_material_read` | Read selected UTF-8 text/CSV/text-layer PDF with bounded windows/rows, hashes and parser/limitations. No archive write. |
| `workspace_local_reference_query` | Read bounded INDEX cards/search, or one company/product revision and provenance. |
| `workspace_local_reference_save` | Explicitly create/update one proposal with exact parsed quotes and `expectedRevision`; preserve other fields and old revisions. |
| `workspace_local_source_keep` | Explicitly retain an already-read source version without creating product facts or memory. |
| `workspace_local_source_versions` | Read retained original/parsed locators, metadata and bounded source text. |
| `workspace_local_memory_save` | Save a separate proposed note linked to exact reference revisions. |
| `workspace_local_memory_query` | Read notes after checking every derived reference/source. |

New references require identity evidence. CSV product facts stay in a row containing that product identity. No fuzzy merge or automatic SKU assignment. Updates affect only provided facts for that key. Literal quote checks establish provenance, not semantic accuracy, factory capacity or certification. Facts remain unconfirmed extractions; model summaries/inferences and missing fields are separate. Memory is a proposal, not chat history or a second fact authority. No model tool approves, chooses an uploader/owner/authorizer or grants access. Native OMP may drop schema extras: these fields never become authority metadata or confirmed state.

```text
enterprise/project/       # private owner data outside source/Git
  INDEX.json              # authoritative manifest, not RAG
  INDEX.md                # readable directory projection
  originals/              # immutable original bytes and versions
  parsed/                 # readable text, CSV table JSON, parser metadata
  references/             # canonical record JSON + readable MD projections
  memory/                 # separate proposed notes with revision links
  history/                # immutable INDEX generation snapshots
```

JSON references are canonical; Markdown and directory cards are projections. Originals/extractions remain evidence. Metadata records hashes, parser/version, scope, import time and actual local UID. Original uploader is **unknown**. `submittedBy`/`authorizedBy` identify the local OS owner, not a verified employee/customer or human content approval.

Storage bounds: 32 source versions, 40 references, 128 request IDs/generations, 128KiB manifest, 24KiB reference record. Immutable files, native file lock and atomic INDEX replacement protect updates; equal request ID/body reuses the receipt. Interrupted writes can leave unreferenced files; INDEX.md can lag INDEX.json after failure. No rollback, crash-repair service or unbounded archive is claimed. Back up originals, records and INDEX together under the owner boundary.

PDF supports text layers only. Native display wrappers are excluded from parsed text. Incomplete extraction is partial; image-only PDF is unavailable. OCR, handwriting and whole-document completeness are not claimed. Unsupported/oversized inputs produce no substitute facts.

## Scope, revocation and missing integration

The original per-session EventBus host grant supplies selection, runtime/native tool context, history and authorization callbacks, never a model key or remote business client. Optional trusted `referenceFence` can deny/revoke owner access or change its epoch. It is a deny-adapter contract, not an identity/role service or a customer grant.

INDEX, titles/summaries, raw files, parsed tables/text, old revisions and derived memory pass owner/fence checks. Cached successful reference-tool bodies are matched to receipts/source bytes before model disclosure. Mixed memory inherits every linked source. Checks run before/after tools and before the local CLI returns its answer. A persisted required-guard marker blocks protected Session resume if the plugin/guard is disabled or missing. Epoch/scope changes refuse continuation; automatic redacted-context rebuilding is not implemented. Already displayed/copied information cannot be recalled. No customer streaming/export route exists; this does not certify every external UI or extension.

Successful archive reads now build a host-only dependency footprint from actual file operations: INDEX, canonical records, metadata, raw originals and parsed tables/text. Selected input metadata/content is tracked by `selected-source:<SHA256>`, independently of reusable `input-N` labels. The trusted deny adapter must interpret these resource identifiers consistently; no customer identity or grant is inferred from a hash. Immutable files are hash-checked again, and all remembered resource identifiers are reauthorized even when the epoch is unchanged. Mutable INDEX is rechecked for access/current bytes rather than pinned to a pre-update hash.

The native context hook and provider disclosure gate persist bounded dependency snapshots as original Session custom entries, never as model input or a new memory service. Resume restores actual dependencies before using cached bodies; native compaction does not erase the footprint when tool messages leave effective context. Any mixed-memory source denial blocks the whole continuation. Checks run at context construction, immediately before local model dispatch, model completion and final CLI delivery. This conservatively keeps restrictions from all earlier dependencies, including compacted context; it does not try to prove a revoked source is irrelevant to the next answer.

Protected reference Sessions made before these snapshots existed are refused instead of guessing dependencies from prose or model citations. Preserve the old JSONL; select a new `--session` file and query retained, currently authorized archive records to rebuild context. Missing retained bytes, invalid hashes or unavailable content provenance also refuse continuation. Unread historical input manifest metadata can be reauthorized from its trusted snapshot; material that was actually read must still resolve to selected verified bytes or a retained original. Footprints are bounded to 512 archive file dependencies, 256 selected-source proofs and 64KiB snapshots; the original Session size and inference budgets stay unchanged.

Archive-mode stopped results also withhold saved-draft/source metadata; completed local writes may still exist and are not rolled back. This protects the bounded CLI final answer. Native SDK partial events are still forwarded internally, and private native JSONL can contain source/tool bodies or partial text. TUI/SSE/WebSocket chunk-by-chunk authorization and customer-facing file/export delivery are not implemented or certified. Data already delivered to an authorized model/user cannot be recalled. OS-owner journal access remains owner access.

Existing server signed ingress/live sessions/revocation, recipient/revision/field scopes, immutable Library versions and human review are reuse candidates. **This file plugin is not wired to those real enterprise/customer identities.** A customer release needs trusted identity binding and unavoidable boundaries across file delivery, INDEX, summaries, memory, history, caches, resume and exports. Query filters or customer labels are insufficient. Same-UID file access is owner access, not two-customer isolation.

## Evidence and development memory

`node --test test/workspace-local-references.test.mjs` uses real native OMP loading/Session/provider execution, actual file operations, native PDF and Python CSV parsers, with finite mocked HTTP and explicitly synthetic material. It covers distinct trajectories, separate products, repeated updates, old versions, resume after retained originals are removed, separate memory and denial/revocation boundaries. The 0.2.1 regressions include unchanged-epoch resource denial at each disclosure boundary, populated/compacted Session recovery, missing dependency/source refusal and native selected-file reads. Deny-adapter fixtures are not real customer identities. They establish neither real model reasoning quality nor production customer authorization.

Prior paid two-turn acceptance was on `aa6262f`; historical conservative API cost remains CNY 0.074952. This release adds **zero paid calls**, no live enterprise integration and no deployment. Real files, raw outputs/logs, credentials and Session JSONL stay outside Git. README/AGENTS/Skill are development guidance, not operational memory.
