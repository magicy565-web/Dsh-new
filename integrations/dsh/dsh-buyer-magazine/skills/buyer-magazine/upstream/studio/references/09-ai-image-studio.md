# 09 · AI image studio

## Contract

**Input:** an image brief, permitted reference assets if editing, configured image provider, and an explicit generation budget. **Output:** generated asset plus provenance and editorial-use decision. **Consumer:** art direction and layout. The standalone package's image API adapter is separate from any image tool supplied by an Agent host.

## Decide whether generation is appropriate

Use generation for editorial atmosphere, abstract category storytelling, background concepts, or explicitly illustrative compositions. Prefer real permitted product photography when the buyer needs to identify a sellable SKU. Do not generate evidence of a factory, production line, product test, certificate, packaging claim or manufacturing capability.

For edits, inspect the reference first and retain the original. Preserve shape, branding, material, color, port/button count, safety markings, and included accessories when they are material to the purchase. If the provider cannot reliably preserve them, do not use the edit as a documentary product image.

## Write an image brief before a prompt

Record purpose, audience, output location, source/reference rights, aspect ratio, crop/focal point, permitted changes, prohibited changes, and required caption. Select a role of editorial or product illustration deliberately. Keep generation metadata in a sidecar if it is not part of the issue schema.

```json
{
  "purpose": "Editorial opening image for a home accessories sourcing issue",
  "role": "editorial",
  "ratio": "3:2",
  "composition": "Quiet tabletop, ample top-left negative space",
  "allowed": ["lighting", "background", "unbranded generic props"],
  "forbidden": ["supplier logo", "certification seal", "specific sellable SKU", "fake factory"],
  "caption": "AI-generated editorial illustration",
  "maxAttempts": 2
}
```

This is a planning example. Do not send it to a provider unchanged if a different scene or permission scope applies.

## Use a reusable prompt structure

1. State the editorial purpose and image role.
2. Describe scene, object relationships and useful visual information.
3. Specify framing, perspective, lighting, surface and color palette.
4. State the negative-space/crop needs for desktop and mobile.
5. State invariants for any authorized reference image.
6. Forbid text, logos, certification marks and unsupported product details.
7. State the required aesthetic in concrete visual terms.

**Example:** “Create a text-free editorial still life for a buyer's morning sourcing journal. Use unbranded generic household objects on warm limestone, soft side light from the left, muted sage and ceramic white, precise but quiet shadows. Leave the upper-left third visually calm. This is an editorial concept, not a supplier or product photograph. Do not include logos, badges, factory scenes, labels or readable packaging.”

## Invoke the adapter responsibly

Use `buyer-magazine image --prompt "..." --out ./editorial.png` after checking `buyer-magazine doctor` and current CLI help. Configure credentials through the documented environment variables; never paste them into command arguments, source files or issue JSON. The actual provider/model must be available. A configured endpoint is not evidence that a generation succeeded.

Keep any edit-specific flags within the adapter's actual supported interface. Do not describe a reference-image parameter as implemented unless help/API exports confirm it. When an API fails after an uncertain billed request, do not repeatedly regenerate without checking the run result.

## Review the result against its role

Inspect at full resolution and within the intended crop. Check anatomy/geometry, edges, duplicated components, text artifacts, unwanted logos, material plausibility, and consistency with the issue palette. For product edits, compare directly with the original and reject any changed commercial detail. Do not “score” an image as accurate from a successful HTTP response.

Keep the original image, prompt/brief, model/provider identifier, creation time, reference asset ID, and acceptance decision. Do not store credentials or signed/private image URLs in the public package.

## Gate

Require visible generated-asset attribution, rights/permission context, accepted crop, and no evidence substitution. If no generation runs, deliver the precise image brief and say generation remains unverified. A bundled authored SVG illustration is a separate asset type; do not call it an AI-generated photograph.

