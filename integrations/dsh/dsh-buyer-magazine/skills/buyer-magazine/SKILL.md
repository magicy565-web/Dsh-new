---
name: buyer-magazine
description: Compatibility entry for the four-skill editorial package; routes creative publication work to LLM-led design and retains legacy Studio/module guidance only for explicit compatibility inputs.
whenToUse: 用户要求杂志设计，或显式要求兼容旧 Studio 和模块输入时。
---
# Four-skill editorial package — standalone native DSH plugin

For magazine design, load ai-media-kinetic-commerce, then the other three supplied
skills. If this host exposes only this compatibility entry, read the sibling
`../ai-media-kinetic-commerce/SKILL.md` and its named sibling skill files directly.
The LLM researches, edits and authors actual HTML/CSS/JS; native file tools write
it, buyer_magazine_review_artifact inspects it, and official present delivers it.
The old Allbirds fixed template was rejected by the user. Do not reuse it.

The original Studio references remain for callers explicitly requesting legacy
Studio issue JSON or the ten-module/ERP adapter. Only such a caller should read
ISSUE-FORMAT.md/MODULES.md and use buyer_magazine_generate, with legacyCompiler
explicitly enabled by the host. The compiler is a compatibility adapter, never
the design authority for the four supplied skills. Preserve evidence and price
semantics for legacy inputs. No second business host or agent loop.
