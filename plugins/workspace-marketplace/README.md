# Pi Marketplace extension 0.1.0

Private source package. No published npm package, new runtime, credentials or automatic
payment. The manifest follows the existing repository's Pi package structure.

Default installation registers four UNCONFIGURED tools. A trusted original Host must
use `createMarketplaceExtension({marketplace: app.marketplace, readActor})` with the
existing current buyer identity and register it on the original Pi/OMP session. The
actor resolver must revalidate the original Session/member binding on every call.
Do not implement it by returning an identity from browser/model input.

Only status, discovery, a local draft and owner-scoped order reads are exposed.
Confirmation, checkout, execution approval, cancellation, acceptance, metering,
provider access and payments are not model tools. Human and external Worker are
separate identities. No chain-of-thought or unrelated conversation context is sent.

Validation in this delivery uses a registerTool/execute contract fixture, not an
installed Pi/OMP SDK. Original Host tool registration remains an explicit integration
gate; installation alone grants no ability or permission.
