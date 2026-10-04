#!/usr/bin/env node
import { rotateAccessAudit } from '../server/access-audit-maintenance.mjs';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--data' || args[2] !== '--archive') {
  console.error('Usage: node scripts/rotate-access-audit.mjs --data /absolute/stopped-data --archive /absolute/private-archive/new-segment.jsonl');
  process.exitCode = 1;
} else {
  try { console.log(JSON.stringify(await rotateAccessAudit({ dataDirectory: args[1], archiveFile: args[3] }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
