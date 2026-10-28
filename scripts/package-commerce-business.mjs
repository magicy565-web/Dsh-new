// Standalone native bundles: vendor existing workspace dependencies into server
// modules; keep the host-owned React factory unchanged. No runtime data included.
import { build } from "esbuild";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  cp,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url));
const destination = resolve(
  process.argv[2] || join(root, "dist", "commerce-business"),
);
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const names = only
  ? only.split(",")
  : [
      "dsh-workspace-library",
      "dsh-mini-erp",
      "dsh-rfq-desk",
      "dsh-quote-guard",
      "dsh-sample-flow",
      "dsh-channel-ledger",
      "dsh-commerce-network",
    ];
const receipts = [];
await mkdir(destination, { recursive: true });
for (const name of names) {
  const source = join(root, "integrations/dsh", name),
    stage = await mkdtemp(join(tmpdir(), "dsh-business-package-"));
  try {
    const manifest = JSON.parse(
      await readFile(join(source, "package.json"), "utf8"),
    );
    for (const item of manifest.files) {
      if (item.includes("*")) {
        const folder = dirname(item);
        await cp(join(source, folder), join(stage, folder), {
          recursive: true,
        });
      } else {
        await mkdir(dirname(join(stage, item)), { recursive: true });
        await cp(join(source, item), join(stage, item), { recursive: true });
      }
    }
    // Bundle every server .js file too, so retained documented modules do not point
    // at unpublished workspace packages. Client factories/Worker SDK are unchanged.
    for (const item of manifest.files.filter(
      (f) => f.endsWith(".js") && f !== "client.js",
    )) {
      await build({
        entryPoints: [join(source, item)],
        outfile: join(stage, item),
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node24",
        legalComments: "inline",
        logLevel: "silent",
      });
    }
    await cp(
      join(root, "docs/COMMERCE-BUSINESS-IMPLEMENTATION.md"),
      join(stage, "COMMERCE-BUSINESS-IMPLEMENTATION.md"),
    );
    manifest.files = [...manifest.files, "COMMERCE-BUSINESS-IMPLEMENTATION.md"];
    if (['dsh-service-billing','dsh-commerce-network'].includes(name)) {
      await cp(join(root,'docs/SERVICE-BILLING-IMPLEMENTATION.md'),join(stage,'SERVICE-BILLING-IMPLEMENTATION.md'));
      manifest.files.push('SERVICE-BILLING-IMPLEMENTATION.md');
    }
    manifest.dependencies = {};
    delete manifest.devDependencies;
    delete manifest.scripts;
    manifest.license = "UNLICENSED";
    await writeFile(
      join(stage, "package.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const packed = JSON.parse(
        execFileSync(
          "npm",
          [
            "pack",
            "--ignore-scripts",
            "--json",
            "--pack-destination",
            destination,
          ],
          { cwd: stage, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      )[0],
      bytes = await readFile(join(destination, packed.filename));
    receipts.push({
      name,
      version: manifest.version,
      archive: packed.filename,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      standalone: true,
      files: packed.files.map((f) => f.path),
    });
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
const receipt = {
  targetHost: "DeepSeek Harness 0.2.1-rc.3",
  node: "24+",
  packages: receipts,
};
await writeFile(
  join(destination, "commerce-business-packages.json"),
  JSON.stringify(receipt, null, 2) + "\n",
);
console.log(JSON.stringify(receipt, null, 2));
