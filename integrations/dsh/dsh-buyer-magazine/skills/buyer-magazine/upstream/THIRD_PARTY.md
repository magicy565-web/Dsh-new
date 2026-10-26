# Third-party materials

## Fonts included in the package

- Fraunces (design reference; font binary not distributed), official Google Fonts repository `ofl/fraunces`. License: SIL Open Font License 1.1. Original license: `assets/fonts/Fraunces-OFL.txt`.
- Manrope (design reference; font binary not distributed), official Google Fonts repository `ofl/manrope`. License: SIL Open Font License 1.1. Original license: `assets/fonts/Manrope-OFL.txt`.

This package distributes no font binaries and does not embed remote font binaries. The web magazine gracefully falls back to installed system fonts (Georgia and Arial or equivalents); the email variant uses native font fallbacks. OFL texts are included for reference to the preferred faces.

Official upstream: https://github.com/google/fonts

## Runtime dependencies

- `@modelcontextprotocol/sdk` 1.32.2, official TypeScript/JavaScript MCP SDK, MIT. https://github.com/modelcontextprotocol/typescript-sdk
- `zod` 3.x, MIT. https://github.com/colinhacks/zod
- Playwright (optional peer for QA/PDF), Apache-2.0. https://github.com/microsoft/playwright

Transitive dependency versions and integrity hashes are recorded in `package-lock.json` in the source archive. npm installs dependencies under their respective licenses. No third-party provider credentials are included.

## Original visual assets

The three example product illustrations, CSS, client interaction code, skill prose and package implementation were authored for this delivery. The illustrations are fictional editorial assets, not supplier product photography.

## Prior project material

The implementation inspected user-provided Website Magazine v0.2 and Buyer Magazine Agent v1.3 archives to preserve workflow compatibility. No vendor skill library, secret file, private deployment credential or entire Python worker was bundled into this npm package. The migration adapter preserves source attribution; source content remains subject to its own rights.
