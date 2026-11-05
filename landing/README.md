# Buyer Magazine landing page

A dedicated static landing page for the **existing** `dsh-buyer-magazine` plugin in this repository. No second agent runtime, fake customer data, lead funnel, external scripts or credentials are introduced.

## Build

Requires Node.js 24+ and `npm`. Run at the repository root:

```sh
node landing/build.mjs
```

The command generates `landing/dist/index.html`, packages the real plugin `integrations/dsh/dsh-buyer-magazine` into `landing/dist/downloads/dsh-buyer-magazine-0.4.3.tgz` using `npm pack`, verifies critical runtime and Skill files were included, and emits a SHA-256 manifest. The generated `dist/` must not be committed.

For Vercel, configure the repository **root** as the project directory (because the plugin source is a sibling of this landing directory), Node.js 24, build command `node landing/build.mjs`, output directory `landing/dist`, and a no-op install command if not using root npm dependencies.

## Install from the published site

Use the landing page's OS-specific copy command. It clones the public source branch, runs `npm pack` to generate the real archive locally, and calls `dsh plugin --profile web add <archive>`. A direct `.tgz` link only appears after the deployed site serves an actual build manifest. Node.js and the official DSH host must already be installed; live source collection additionally requires configured Apify credentials. No credentials are required to build the landing page.

## Scope and honesty

The hero's magazine is explicitly marked as an editorial *layout concept*, not a customer publication. This release does not claim live buyer lead generation, email distribution, conversions, or complete DSH host acceptance. Do not replace the package download with a non-existent Releases asset. Once a real issue has passed editorial review and rights checks, publish its independently verified artifact and link it from the site.