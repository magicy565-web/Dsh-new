# Upstream operations → current native DSH boundary

This is an integration map, not a tool registry. At use time inspect the selected
host's actual tool names, input schemas, permissions and outputs. A checked-in
candidate is not proof that the current Session has installed or enabled it.

| Upstream surface | DSH use or status | Do not claim |
| --- | --- | --- |
| `research URL`, `collectWebsite`, MCP `magazine_research` | Not restored or wired here. An already authorized native web/file tool may supply evidence, but record it explicitly as native-tool research rather than Studio collection. Use original 01/02/04 methods. | That reading a webpage invoked the Studio collector. |
| `run URL` | Not restored or wired. Original code uses direct collection by default and deterministic editorial defaults, not an implicit LLM. Even original `run` omits product images by default and needs Agent editing. | That `run` requires Apify/payment, or that its successful output proves art direction. |
| `check`, MCP `magazine_validate` | Candidate source exposes `buyer_magazine_validate_issue({issueJson})`; use only after actual registration is confirmed. It returns structure/policy counts, not fact or rights verification. | Original CLI/check execution when only a native validation tool ran. |
| `build`, MCP `magazine_build` | New candidate source exposes `buyer_magazine_generate({issueJson})` and delegates to Session-bound file generation. The source output contract is listed below; it is not a live-host success claim. Verify the installed version: the earlier candidate deliberately refuses delivery. | Successful generation, file writing or delivery based on the name alone. |
| Native presentation | The intended path is a separate official `present` operation after generation. Inspect its real schema and call through host ToolRuntime scope/guard; pass only the actual successful generated artifact. | That generate automatically presents, or that a stored file is already visible. |
| `theme-proof` | Four themes exist in the attributed renderer (with documented price-context patches); the native candidate has no dedicated theme-proof tool. If authorized, multiple real native compilations with only theme changed may form a clearly labelled manual comparison. Record exact calls and inspect the resulting outputs. | Having executed Studio `theme-proof`; that textual preference is an observed proof. |
| `image`, MCP `magazine_image` | No image adapter is restored. A host image tool is a separate capability, requiring its own authorization, role and budget; reference 09 governs provenance and review. | Original adapter execution, a free call, or documentary product accuracy from generated art. |
| Documentary/local images | The reviewed compiler accepts explicit rights-qualified public HTTPS image objects; rejects local/data image inputs. Generation does not fetch remote images. Recheck the installed version before use. | Offline bundled images, permission based on URL visibility, or silent removal of unsupported assets. |
| `qa`, `browserQA`, `editorial-audit.mjs` | Not restored or registered. Use authorized existing host review tools and original reference 16 criteria, keeping static, browser, visual and interactive checks separate. If unavailable/prohibited, leave the gate blocked. | Original browserQA/audit execution or a pass based on compile counts. |
| `pdf`, email exports, `serve` | Not provided by this restoration or the HTML-only native compiler contract. HTML is the magazine artifact; no application frontend/server is added. | These formats or a preview server having been generated. |
| `install-skills`, npm CLI, MCP server, Pi extension | Not copied or executed. This folder is source content for deliberate integration into a verified host skill location. | Automatic discovery, installation, or tool registration. |
| `agent-dispatch`, queue, buyer matching, delivery | References 17/18 retained for completeness; no implementation or permission restored. | Enqueued work, consenting recipient resolution, sending or deployment. |

## Exact invocation evidence

For each operation record the observed tool name, installed/version identity when
available, accepted input scope, outcome/error, and output artifact/hash. Keep
secrets and private runtime traces out of the public magazine and source package.
Never invent a successful call to satisfy this record.

### Current native candidate source contract

Statically inspected `dsh_magazine_native_present_candidate/src/tools.js` on
2026-10-26; this source inspection is not installation or execution acceptance.
Both tool inputs contain only `{issueJson: string}`. The core bounds the UTF-8
input to 256 KiB and the generated HTML to 1 MiB.

The generation output schema is:

```text
path, name, bytes, sha256,
status: "generated",
presentation: "pending-official-present",
reused: boolean,
draftOnly: true,
externalImageCount, warningCount
```

After a real successful result, the planned second call is the **existing
official** host tool, with its actual session schema verified first:

```text
present({files: [{path: result.path,
  description: "Draft procurement magazine — review required"}]})
```

Call through the native tool runtime and its scope/permission checks, never a
tool definition's `execute` method. This wrapper does not register `present`,
accept a guessed path, or imply that the current host has enabled either tool.
The native plugin remains draft-only even after a successful presentation.

## Original relative references

The unchanged original Skill intentionally still mentions its package's `docs/`,
`schemas/`, runtime, scripts and installation instructions. Those components are
**not** part of this restoration. References beneath `upstream/studio/references/`
and both `assets/` files are present. Missing original runtime paths are not
permission to fetch, install, recreate or execute replacements. Use this map and
the selected compiler's actual authoritative schema instead.

Only this DSH wrapper should be chosen as the operational entrypoint. The nested
original `upstream/studio/STUDIO-SKILL.md` is preserved reference material; do not
independently activate it as a legacy CLI workflow. Before integrating, verify the
host's actual skill root. The reviewed official filesystem provider is
non-recursive: configure the parent `skills/` directory, not the wrapper or
archived-original directory. It accepts any `.md` directly in a configured root,
so renaming the archive is not a defense against deliberately configuring the
archive directory itself as a skill root. Do not add another provider/registrar.
