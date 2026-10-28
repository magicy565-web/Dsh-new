# Native commerce contracts

Shared validation primitives (`./validation`) and minimal DSH session/Connection/
HTTP/Tool adapters (`.`). It owns no database, session, model gateway or agent loop.
Domain packages import validation only. Internal scopes are constructed from native
registry membership, rechecked after awaits, and never accepted from serialized
caller input. Model request idempotency uses stable session identity; individual
native call IDs are recorded separately. Structured errors use a process-wide symbol
so separately packaged native bundles retain their public error contracts.
