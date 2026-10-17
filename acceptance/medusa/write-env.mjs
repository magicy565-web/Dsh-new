// Explicit operator bootstrap, never called by service startup. This source
// task does not execute real entropy generation or create real credentials.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const secretNames = ['postgres_password', 'redis_password', 'jwt_secret', 'cookie_secret', 'agent_context_read_token'];
const files = [...secretNames, 'docling.json'];
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function statePath(directory) {
  if (!path.isAbsolute(directory || '') || /[\r\n\0]/.test(directory) || directory === sourceRoot || directory.startsWith(sourceRoot + path.sep)
    || ['/tmp','/var/tmp','/run','/dev/shm'].some(p => directory === p || directory.startsWith(p + '/'))) throw Error('EXPLICIT_PERSISTENT_PRIVATE_DIRECTORY_REQUIRED');
  let current = path.parse(directory).root;
  for (const part of directory.split(path.sep).filter(Boolean)) {
    current = path.join(current, part); const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('PLAIN_EXISTING_STATE_DIRECTORY_REQUIRED');
  }
  const stat = fs.statSync(directory);
  if (stat.uid !== process.getuid() || (stat.mode & 0o077) || Number(fs.statfsSync(directory).type) === 0x01021994) throw Error('OWNER_ONLY_NON_TMPFS_STATE_REQUIRED');
  return directory;
}
export function bootstrap({ directory, confirmed = false, check = false }, { entropy = randomBytes } = {}) {
  if (!check && !confirmed) throw Error('EXPLICIT_SERVICE_SECRET_BOOTSTRAP_CONFIRMATION_REQUIRED');
  const state = statePath(directory), secrets = path.join(state, 'secrets');
  if (fs.existsSync(secrets)) {
    const stat = fs.lstatSync(secrets);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw Error('PRIVATE_SECRET_DIRECTORY_REQUIRED');
    for (const name of files) {
      const file = path.join(secrets, name), s = fs.lstatSync(file);
      if (!s.isFile() || s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o222) || s.size < 64 || s.size > 8192) throw Error('EXISTING_SERVICE_SECRET_REFUSED');
    }
    return { status: 'existing-service-files-preserved', generated: false, directory: state };
  }
  if (check) return { status: 'unconfigured', generated: false, directory: state };
  const staging = path.join(state, 'secrets.new');
  fs.mkdirSync(staging, { mode: 0o700 });
  try {
    // Compose file secrets are bind mounts: nonroot service UIDs need read
    // permission. Host privacy comes from the owner-only 0700 parent; each
    // container receives only its required files, read-only, never the parent.
    for (const name of secretNames) fs.writeFileSync(path.join(staging, name), entropy(32).toString('hex') + '\n', { flag: 'wx', mode: 0o444 });
    fs.writeFileSync(path.join(staging, 'docling.json'), JSON.stringify({ api_key: entropy(32).toString('hex'),
      eng_kind: 'local', eng_loc_num_workers: 1, enable_ui: false, enable_api_docs: false, enable_remote_services: false,
      allow_external_plugins: false, enable_management_endpoints: false, enable_capabilities_endpoint: false,
      load_models_at_boot: false, max_file_size: 5242880, max_sources_per_request: 1, max_num_pages: 10,
      max_document_timeout: 30, max_sync_wait: 30, queue_max_size: 1, allowed_image_export_modes: ['placeholder'],
      scratch_path: '/tmp/docling', result_removal_delay: 60, cors_origins: [] }, null, 2) + '\n', { flag: 'wx', mode: 0o444 });
    for (const name of files) fs.chmodSync(path.join(staging, name), 0o444);
    fs.renameSync(staging, secrets);
    return { status: 'created-service-files-only', generated: true, directory: state, adminCreated: false };
  } catch (error) { throw Error('SERVICE_BOOTSTRAP_INCOMPLETE; preserve existing files and inspect private directory, do not rotate or delete automatically.'); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--help')) console.log('After explicit approval only: node acceptance/medusa/write-env.mjs --state-dir ABS_PRIVATE_PERSISTENT_DIR --confirm-create-service-secrets\n--check never generates; restarting services never rotates existing files. Does not create an administrator.');
    else {
      const args = process.argv.slice(2), index = args.indexOf('--state-dir');
      if (args.some((a,i) => i !== index + 1 && !['--state-dir','--check','--confirm-create-service-secrets'].includes(a))) throw Error('BOOTSTRAP_ARGUMENT_REFUSED');
      const result = bootstrap({ directory: args[index + 1], confirmed: args.includes('--confirm-create-service-secrets'), check: args.includes('--check') });
      console.log(JSON.stringify(result));
      if (result.status === 'unconfigured') process.exitCode = 2;
    }
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
