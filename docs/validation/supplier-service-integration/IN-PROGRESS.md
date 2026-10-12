# Durable integration checkpoint (not final acceptance)

Base repair source952db1a7e5a0986312f896e524114cb9a4a5ce25 is independently validated at40 focused tests and610 backend cases(603pass7skip0fail), with a passed build; Draft PR51.

Selected exact source additions: PR49 /80069d04c2b65f7488ff38da224809a2cd38cff0 and PR50 /7440387d0f23114bdb440b6362f9971dd5fd39cd; original byte provenance is inSELECTIVE-IMPORT.json. No WIP96fb4914 file is included.

GA4 v2 is wired through the existing application factory and original persistent monitor checks. It preserves event-view metrics/null sessions, source coverage/quality, original cancellation signal and request identity; summary semantic hashing excludes observation-only timestamps/keys. Initial unchanged relevant suites28/28 passed. A new combined suite currently has30total29pass1fail: the new acknowledged-GA4 observation fixture returns unavailable instead of expected partial. This is unresolved here, not a passing integration claim. Raw output is retained in traffic-combination-initial-failure.txt.

Notification modules are imported only at this checkpoint: original host callbacks/approval/outbox/subscription wiring and combined tests are still implementation work. No external notification is enabled or sent. No actual GA4 account, real subscription/token/recipient, credentials/grants, production action or real seven-day acceptance has occurred.

The environment remained usable through actual Git/status/read commands at2026-10-12T13:39:59Z after the parent reported a disconnect. Modified entrypoint, original monitor and combination tests were present; their SHA256 values were recorded in the tool output. This commit preserves the in-progress work instead of rebuilding/overwriting it.
