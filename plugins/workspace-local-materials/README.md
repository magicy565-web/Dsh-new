# Local materials plugin

Independent `@workspace-agent/pi-local-materials`, pinned OMP 18.10.4. Copy this directory outside the repository: source modules use only Node builtins, their own files and the reviewed OMP runtime supplied by the host. There are no install scripts or repository/server imports.

The original native OMP file loader loads `pi.extensions`; `pi.skills` supplies business guidance. The package owns selected local read/write tools, public RFQ/offer draft helpers reused from the existing factory plugin, original OMP context pruning and goal guidance. There is no Agent Loop, database or remote client. The ordinary standalone OMP loader can load the package and public-field draft tools; local IO requires an explicitly selected-file host grant over the original per-session EventBus. No ambient directory or credential is discovered to manufacture that grant.

## Install, enable, configure and unload

Place the package under a reviewed plugin root with `config.json` (see ../README.md). Enable `./workspace-local-materials` in `extensions`; explicit `disabledExtensions` or `--disable-plugin workspace-local-materials` wins. Remove its enabled entry or explicitly disable its directory ID before deleting the package, then restart. Enabled-but-missing packages report a useful error; unselected/disabled missing packages do not block conversation. No hidden direct registration remains. Launch the existing bounded CLI with `--plugin-dir /absolute/reviewed/plugin-root`, `--input`, `--output-dir`, `--session` and a goal. A root outside the repo is accepted only as an explicit user-selected trusted directory. OMP extensions execute trusted code, not sandboxed code.

```sh
npm run factory:local -- --input /ABS/product.md --output-dir /ABS/output \
  --plugin-dir /ABS/reviewed/plugins --session /ABS/project/conversation.jsonl "一句话目标"
```

Existing secure provider configuration, current prices and remaining budget must be reviewed before real inference. This command does not configure a key. `--check` is zero model requests. `--no-plugins` removes all plugin tools but keeps the native conversational Session usable.

## Interfaces, permissions and dependencies

Tools remain `read(path=input-N)`, `write(path=new-basename.md|txt,content)`, `workspace_factory_capabilities`, `workspace_factory_rfq_requirements(rfq)` and `workspace_factory_match_prepare(rfq,factoryOffer?)`. Schemas and pending-fact semantics remain compatible. Only 1–4 selected text/PDF files, at most 64KiB total, may be read through the original native ReadTool. Every operation checks exact paths, no symlinks, current SHA/inode and selected output directory. Native WriteTool stages a new flat basename; no overwrite, traversal or external sending. Verified successful prior reads restore source authorization after selection/profile checks. Native context projection preserves goals, unique prose, write bodies and tool/result occurrence pairing; native journal stays intact.

The host grant supplies selected-file configuration, the pinned runtime path, original native tool-session context, verified native history and authorization callback via `workspace:plugin-host`. It supplies no model key or remote business client. Runtime model request count, byte/output/usage limits and unknown-fee stop remain owned by the original bounded provider. File support is Linux-specific. Peer runtime: original OMP 18.10.4. No npm runtime dependency is required.

## Evidence and memory

Native loader lifecycle and actual native filesystem operations are tested with finite mocked model responses, including an outside-repo copy, disabling, re-enable/restart, uninstall, coexistence and same-Session resume. They are not new real model acceptance. The prior real tested product was aa6262f; this plugin extraction has no paid verification yet. No full business-service integration is claimed. Project maintenance knowledge is AGENTS.md; business guidance is skills/local-materials/SKILL.md. Keep material, actual output, credentials and native JSONL outside Git, isolated by project/enterprise and using original OMP persistence.
