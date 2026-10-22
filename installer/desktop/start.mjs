// Desktop entry for the installed Workspace Harness.
//
// The launcher starts this file with a hidden console and no pipes. Redirect
// stdout/stderr into the user log first, then load the real server so that every
// console line (including provider errors) survives a crashed window.
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const logFile = process.env.WORKSPACE_HARNESS_LOG;
if (logFile) {
  mkdirSync(dirname(logFile), { recursive: true });
  const stream = createWriteStream(logFile, { flags: 'a' });
  const stamp = () => new Date().toISOString();
  const write = (...args) => {
    const line = args
      .map(value => (value instanceof Error ? value.stack || value.message : String(value)))
      .join(' ');
    stream.write(`[${stamp()}] ${line}\n`);
  };
  process.stdout.write = (chunk, ...rest) => {
    stream.write(chunk);
    return true;
  };
  process.stderr.write = (chunk, ...rest) => {
    stream.write(chunk);
    return true;
  };
  process.on('uncaughtException', error => {
    write('uncaughtException:', error);
    process.exit(1);
  });
  process.on('unhandledRejection', error => {
    write('unhandledRejection:', error);
  });
  write('desktop start', process.argv.join(' '), 'cwd=' + process.cwd());
}

await import('../scripts/harness-serve.mjs');
