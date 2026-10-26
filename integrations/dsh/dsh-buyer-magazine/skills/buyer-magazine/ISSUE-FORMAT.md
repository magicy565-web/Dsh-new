# Website edition input

The native tools accept `{"issueJson":"<JSON string>"}`. The Agent builds this input from actual web/file reads; the user supplies a URL and brief, not this structure.

Studio schemaVersion is `1.0`. Required fields:

- `id`, `edition`, `title`, `subtitle`, `date` (YYYY-MM-DD), `locale` (`en` / `zh-CN`), `market`, `theme` (`porcelain`, `atelier`, `foundry`, `fieldnotes`), `demo`.
- `cover`: `kicker`, `headline`, `dek`, `image` (null or a permitted image).
- `editorNote`, `highlights` (array of `{label,text}`), `products` (1–6), `sources` (at least one), `insights` (array of `{title,body,kind,sourceIds}`; kind observation/inference), `dataNotes` (string array).
- `provenance`: `mode` (`live` / `import` / `demo`), `collectedAt` (actual read timestamp), optional `provider`. `demo` is true only for intentionally fictional input.

Each product has `id`, `name`, `supplier`, `category`, `region`, `summary`, `buyerFit`, `watchout`, `image`, `specs`, `price`, `moq`, `leadTime`, `sourceIds`, `cta`.

- `specs`: array of `{key,label,value,unit?,status,sourceIds,visibility:'public'}`.
- `price`: `{kind,amount?,currency?,unit?,basis?,minQty?,status,sourceIds}`. Kind is retail/wholesale/request-quote/unknown. Source text ranges remain strings. Wholesale requires basis and minQty. Unknown/request-quote must omit amount and retain status unknown.
- `moq`, `leadTime`: `{value,unit?,status,sourceIds}`. Missing terms use value `Not disclosed`, status unknown, sourceIds `[]`.
- `status` is verified/supplier-stated/unknown. Reading a supplier website establishes attribution, not independent verification.
- `cta`: `{label,type:'source',url}` using an actual public HTTPS source URL. Sample/inquiry types need actual configured destinations.
- An image is null or `{src,alt,role,generated,rights,sourceId?,credit?,caption?}`. Use public HTTPS only and explicit owned/licensed/permission evidence. Generated images cannot represent a real product. Omit images with unresolved reuse permission.
- Each source is `{id,url,title,publisher,accessedAt,kind,excerpt?,contentHash?}`. Kind is supplier/retailer/third-party. Use actual timestamps and excerpts. Every factual field's sourceIds must resolve here. Internal paths and credentials stay outside the public issue.

For optional selected-content editions see MODULES.md. `composition:'modules'` is the normalized representation inside this same schema; it supports ordered blocks without inventing supplier dossiers or source URLs. The adapters preserve the documented legacy module JSON input. Both representations run through the same native validation and renderer.

Call `buyer_magazine_validate_issue`, correct the actual input when invalid, then `buyer_magazine_generate`. The second tool returns a create-only workspace path. Call native `present({files:[{path:result.path,description:'买手杂志工作稿'}]})` separately and report its actual result. Never claim published, sent, or final-ready from generation alone.

## Production design (0.3)

For a finished website edition include the `design` object described in
[design-production.md](references/design-production.md). Legacy drafts without
it still compile but return `DESIGN_BRIEF_MISSING`, never production completion.
Image objects additionally support fit and position. `editorial-reference` is
restricted to attributed, non-generated source images with internal-reference
distribution; it is not a publication license. Use user-declared permission for
a user-provided owned/authorized site, and retain the declaration in the record.
