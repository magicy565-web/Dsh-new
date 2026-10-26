# Price-status consistency — candidate.6

Before this patch a schema-valid price could be unknown or request-quote while
claiming verified status with no sources. The renderer displayed a request for
quote beside “Verified against cited evidence”. This falsely promoted an unknown
commercial term to an evidenced fact.

Unknown and request-quote price kinds now require status unknown. Citing a page
does not turn an undisclosed price into a verified or supplier-stated quote.
Public references may still accompany unknown terms; the absent amount remains
absent. Sourced retail and wholesale quotes retain their existing validation.

This is a deliberate fail-closed input compatibility change: callers with the
contradictory status must correct the input; the compiler does not silently rewrite
it. It does not authenticate external sources or guarantee factual correctness.
Pure Node synthetic regression tests cover both unknown kinds, every status,
with and without source references, plus valid priced controls. No model, real
Host, browser, external collection or customer contact is involved.

Upstream original schema hash is preserved in provenance; its patch hash records
this explicitly modified file. No new UI, tool, Session or execution loop.
