# Request-brief evidence repair — candidate.5

A valid issue may use a product summary source and different price, MOQ, lead-time,
and public specification sources. The old download exported those field values
but listed only product.sourceIds. Reproduced with a separately sourced wholesale
price: its amount, EXW basis and 500-unit condition survived, its evidence URL did not.

The emitted artifact now includes the stable, deduplicated union of the selected
product references followed by price, MOQ, lead-time and exported public-specification
references. It resolves only those references, not the complete issue source catalog.
An empty shortlist retains the existing all-products behavior. Restricted specifications
remain rejected by compilation and excluded from the export helper.

Regression uses the actual compiled inline JavaScript with existing jsdom. It checks
field-only references, duplicate IDs, reversed catalog order, removed/unselected
products, unrelated sources, repeatable text and restricted-input rejection.
This is offline synthetic DOM verification, not live browser download, Host execution,
source authenticity verification or permission to send a request. No messages are sent.

Original upstream hashes remain unchanged in the provenance manifest; its patch hash
records shipped JavaScript. No schema, collection, Session, tool or approval changes.
