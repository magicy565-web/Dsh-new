#!/usr/bin/env node
// `wh` — Workspace Harness CLI entry point.
import { runWh } from '../src/cli.mjs';

process.exitCode = await runWh(process.argv.slice(2), { root: process.cwd() });
