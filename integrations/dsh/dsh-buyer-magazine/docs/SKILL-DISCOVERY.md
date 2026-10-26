# Native Skill discovery

Version 0.2.0 installs one `buyer-magazine` Agent preset. Its official filesystem Skill provider resolves the installed package manifest and mounts its `skills/` directory. Exactly one operational `SKILL.md` is shipped. The 18 Studio references remain reference files; they do not create additional runtime skills.

Installation through the official DSH bundle mechanism is enough to add the preset. No Sourcing or ERP plugin and no manual Skill-root overlay are required. The preset composes native web/file/skill/present tools and this package’s generation tools under the native session scope.

Run `node test/skill-discovery-sdk.mjs /absolute/official-runtime` to check the declared package files, actual official bundle loader, mounted root expression, one discovered Skill and preserved Studio hashes without invoking a model. See the main README for real Host validation.
