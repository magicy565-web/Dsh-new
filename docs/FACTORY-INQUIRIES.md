# Exact inquiry comparison and unsent review drafts

Issue #73 adds the standalone private `@workspace-agent/pi-factory-inquiries`
package. It reads only Host-injected original Library receipts and delegates
saves to the original artifact service. It creates no inquiry database, task
queue, model engine, login, grant or sender. Ordinary installation is
`unconfigured`; it cannot obtain enterprise access from an Agent Bearer.

The controlled Host may select `WORKSPACE_OMP_PROFILE=factory-inquiries`, the
separate `omp:18.10.4:factory-inquiries-v1` scope. It includes the reviewed factory
materials tools and two inquiry tools, with public search/browser/subagents and
business submission tools disabled. The original reviewed Library policy must
explicitly admit both the inquiry document/version/asset SHA and the single
product revision/selected fields to the same exact model recipient. It cannot
adopt a public or older materials transcript. The original Session and private
fd remain in their existing authority boundary.

`workspace_factory_inquiry_prepare` accepts only original inquiry document ID,
version, product ID and six optional/null requirement fields. Every nonempty
requirement must be a literal substring of the original extracted inquiry text;
unsupported extraction is refused. It compares selected source facts and
identifies missing fields. It does not decide manufacturing fit, accept a SKU,
verify a certificate, infer capacity or promise delivery.

The pure preparation function returns three drafts:

- quotation review: customer wording and original product/SKU facts, all missing
  price/currency/tax/trade/payment/validity terms pending;
- sample review: stock, quantity, fees, shipment and recipient pending;
- follow-up review: no assumed prior message, reply or contact permission, and
  no claim that the material is new to the unknown recipient.

Each independent document retains source IDs/revisions, document/asset versions
and SHA, explicit human-review/NOT SENT markers and extraction/OCR uncertainty.
A recorded factory MOQ/lead time is a source fact, never an accepted offer or
promise. The matching status always requires human review. Draft methodology is
an independent concise adaptation of community cold-email v2.2.0, pinned to
[commit55ff469](https://github.com/coreyhaines31/marketingskills/blob/55ff469422c3592dac45bcad08dfb40221981c02/skills/cold-email/SKILL.md)
and its same-commit MIT license. Exact resource/license SHA and attribution are
in the package-root `sources.json`. No sending/account/domain
instructions or the complete collection are executed or installed.

`workspace_factory_inquiry_save` additionally requires an exact draft hash,
confirmed flag and stable original request ID. A natural readonly Run cannot
save. Explicit original execution intent still comes from the human-confirmed
original terminal/API path. The Host freshly reads the same original materials
and rerenders the deterministic draft before comparing the hash. It stores each
file with original conversation/creating Run links, internal Library visibility,
source references, review-required and sent:false metadata. No external action
or approval is inferred from saving a draft.

Original artifact idempotency is authoritative. Response loss or partial save
retains already committed original receipts. Explicit replay of the identical
request fills only missing files and preserves existing IDs/creating Run links;
no automatic retry runs. Changed draft/source/recipient/scope requires fresh
original review and a new request ID after confirmation. A cancelled, expired or
revoked original Session/Run is refused before artifact commit. The original
artifact Store remains the only persistence; no secondary operation journal is
created.

The whole-journal/context guard revalidates every different private inquiry and
material receipt before each model call, including reopened transcripts. Saved
artifact references must belong to this original conversation/draft/source
scope; their current original versions and exact bytes are checked. Within one
validation boundary, identical complete receipts are checked once using their
canonical hash. The next model boundary starts a new set and rechecks them; no
permission cache survives. Inner Library reads use live original Session/Run and
central policy checks, while outer tool/RPC/model and save boundaries retain
fresh original Agent-binding proofs. This removes redundant identity requests
without raising or circumventing the existing HTTP rate limit.

Tests distinguish actual official package/SDK components, original signed HTTP,
Library/artifact services and finite keyless model fixtures. No real material,
model budget, buyer, sending, order, sample dispatch, payment or deployment has
been accepted. See [validation](validation/factory-inquiries-20261015/README.md).
