# 15 · Publishing engine

## Contract

**Input:** public issue JSON, permitted assets and output path. **Output:** a reproducible artifact directory and a precise delivery record. **Consumer:** buyer preview, email integration, print/PDF and host Agent. This standalone design-production package can consume earlier project artifacts; it does not replace the older cloud worker, queue or message delivery service.

## Use the actual CLI surface

| Task | Command |
| --- | --- |
| Environment diagnostics | `buyer-magazine doctor` |
| Create a project | `buyer-magazine init --dir ./my-brief` |
| Build the labelled fixture | `buyer-magazine demo --out ./demo` |
| Collect source data | `buyer-magazine research URL --out ./research.json` |
| Collect and build | `buyer-magazine run URL --out ./edition` |
| Validate an issue | `buyer-magazine check --input ./issue.json` |
| Build prepared data | `buyer-magazine build --input ./issue.json --out ./edition` |
| Preview locally | `buyer-magazine serve --dir ./edition --port 4173` |
| Run output checks | `buyer-magazine qa --dir ./edition` |
| Export PDF | `buyer-magazine pdf --dir ./edition --out ./edition.pdf` |
| Generate an editorial asset | `buyer-magazine image --prompt "..." --out ./editorial.png` |
| Copy skill to a chosen host path | `buyer-magazine install-skills --target ./agent-skills` |
| Run stdio MCP | `buyer-magazine mcp` |

Use `--help` for current optional arguments. Do not invent flags from another tool. Source execution uses `node bin/buyer-magazine.js`; installed execution uses `buyer-magazine`.

For an installed skill in a host with a different PATH, use `node <skill-path>/scripts/run.mjs` followed by the same command and options. The runner reads the installer-created `runtime.json`, validates the npm package identity and launches its CLI without a shell. It can also find the runtime from the skill's bundled package layout. `doctor` reports the package root for resolving schemas and documentation. Moving a copied skill without its runtime requires reinstalling the package and refreshing the skill registration.

## Inspect the resulting directory

The build emits `index.html`, `email.html`, `email.txt`, `issue.json`, `qa-report.json`, `manifest.json`, and `assets/` as applicable. Preserve them together: moving HTML without its relative assets can break the design. The web document includes its needed styles/interaction logic; avoid external CDNs for core function.

Use the manifest and QA report to explain the artifact, not to claim tests that were not executed. A static QA check, a browser interaction check and visual review are different forms of evidence. Optional Playwright/browser dependencies may be needed for PDF and browser checks; read diagnostics rather than claiming automatic availability.

## Install through npm truthfully

A locally produced tarball can be installed with:

```bash
npm install ./buyer-magazine-studio-1.0.0.tgz
npx buyer-magazine doctor
npx buyer-magazine demo --out ./coffee-brief
```

Use the exact delivered version and filename. A global installation is another user choice; local installation avoids assuming permission to modify system directories. Package installation makes the CLI available through npm; `install-skills` copies the skill to an explicit host location. Do not assume a host automatically discovers a random directory.

Do not recommend installing by registry package name until that exact version is actually published. Registry publishing, host installation and creating an npm tarball are separate operations. Preserve credentials in the environment; exclude them from package content, example configuration and generated artifacts.

## Adapt email and print intentionally

The email output is a static digest. Inspect it with images unavailable and as plain text. Do not promise universal Gmail/Outlook rendering from a browser screenshot; real client validation is a separate gate. Do not send emails or WhatsApp messages merely to test the export unless the user authorized sending.

PDF output uses the browser's print layout. Inspect every page for clipped text, split fact groups, orphan headings, invisible links and empty image boxes. Keep public source details and sponsorship/demo labels. PDF generation success alone does not prove layout quality.

## Connect to an Agent without rebuilding the stack

Use the packaged MCP stdio entry point for hosts that support MCP. Use the installed skill for procedural guidance. Keep the runtime process independent of the LLM: deterministic rendering and validation should run from issue JSON without requiring a chat API.

If an earlier v0.2 website research or v1.3 buyer issue is imported, inspect the normalized issue and its migration notes. Preserve original source identities and missing fields. Do not silently translate old unknown values into new commercial claims. Keep old worker operations separate.

## Gate

Install the packed tarball into a clean directory, run its real binary, build a labelled example and verify outputs. Test with a path containing spaces. Confirm that the package contains runtime, assets, skill references, licenses and necessary schemas, and excludes secrets and development-only state. Record the package version and which external providers were actually exercised.

