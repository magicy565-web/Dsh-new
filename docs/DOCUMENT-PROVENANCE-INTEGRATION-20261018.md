# Selected integration of PR110 provenance tests

Integrated source: `a8d6a52a9ef23493173cfb96db14eb78823505d0` (PR110), eight new dedicated test/documentation files, copied without rewriting the author's acceptance record. Integration parent: `fa73a875edda83739ba1a0cc73d968ccc26e65b2` on the existing development branch. No production implementation, lock or authorization change is included in this commit.

## Evidence and limits

- Independent review reproduced the fixed source's **15/15** selected cases under Node 24: 13 adapter/Host contract cases and two current-contract cross-document cases. Synthetic identities, bytes, HTTP and authority fixtures were used. These are not real Docling, actual Library HTTP/persistence, SDK or model acceptance.
- The full default runner still exits **1** locally because `upload-library.test.mjs` imports the original Host graph, which lacks locked `@earendil-works/pi-ai@1.1.0` in the current installation. Its four test bodies did not execute. Do not report the whole runner or upload chain as passed.
- The original red test at `45780e1b312118187955543697c0b98a2bcd353a` proposed requiring every document-classification quote to originate in that document. Existing contract/source inspection did not establish this as a required invariant: target and evidence indices are distinct, and the original report preserves both indices and explicitly unreviewed interpretation. No production same-source restriction was introduced.
- The stricter same-source assertion is retained only as an undecided policy candidate outside the explicit default runner. This is not authorization to change the model's permitted cross-document synthesis.
- Separate provenance visibility, real extraction, actual signed permission revocation, upload/persistence, and model use still need their respective full-environment acceptance. A test changing both selection and native Session ID cannot independently prove each single-variable rejection.

These files add acceptance coverage only. They do not enable a plugin, grant model access, migrate receipts, deploy services or make a paid request.
