import childProcess from 'node:child_process';
import { promises as fs, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

const denied = cause => Object.assign(new Error('Private Windows storage DACL could not be verified; existing data has not been adopted.', { cause }), { code: 'WORKSPACE_PRIVATE_ACL_REQUIRED' });
const system = 'S-1-5-18', administrators = 'S-1-5-32-544';

/** A persistent ACL capability on the volume does not establish file privacy. */
export function validatePrivateWindowsAcl(value) {
  if (!value || !/^S-1-5-(?:\d+-)*\d+$/u.test(value.userSid || '') || !Array.isArray(value.rules) || value.hasDacl !== true) throw denied();
  const trusted = new Set([value.userSid, system, administrators]);
  if (!trusted.has(value.ownerSid) || !value.rules.length || value.rules.some(rule => !['Allow', 'Deny'].includes(rule.type) || rule.type === 'Allow' && !trusted.has(rule.sid))) throw denied();
  if (!value.rules.some(rule => rule.type === 'Allow' && rule.sid === value.userSid && !rule.inheritOnly && (rule.rights & 0x1f01ff) === 0x1f01ff)) throw denied();
  return value;
}

// Fixed native command. Paths are data in a dedicated environment variable;
// no interpolation, profile, elevation, policy changes or recursive ACL changes.
const query = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:WORKSPACE_PRIVATE_ACL_PATH
$item = Get-Item -LiteralPath $target -Force
if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point rejected' }
$user = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = $item.GetAccessControl()
$owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
$trusted = @($user.Value, 'S-1-5-18', 'S-1-5-32-544')
if ($env:WORKSPACE_PRIVATE_ACL_INITIALIZE -eq 'empty') {
  if ($owner -notin $trusted) { throw 'Foreign owner rejected' }
  if ($item.PSIsContainer) {
    if (@(Get-ChildItem -LiteralPath $target -Force).Count -ne 0) { throw 'Existing directory retained; controlled migration required' }
    $fresh = New-Object Security.AccessControl.DirectorySecurity
    $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
  } else {
    if ($item.Length -ne 0) { throw 'Existing file retained; controlled migration required' }
    $fresh = New-Object Security.AccessControl.FileSecurity
    $inherit = [Security.AccessControl.InheritanceFlags]::None
  }
  $fresh.SetOwner($user)
  $fresh.SetAccessRuleProtection($true, $false)
  foreach ($sid in $trusted) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule(([Security.Principal.SecurityIdentifier]$sid), [Security.AccessControl.FileSystemRights]::FullControl, $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
    $fresh.AddAccessRule($rule)
  }
  $item.SetAccessControl($fresh)
  $acl = $item.GetAccessControl()
}
$raw = New-Object Security.AccessControl.RawSecurityDescriptor($acl.GetSecurityDescriptorBinaryForm(), 0)
$rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object {
  @{ sid = $_.IdentityReference.Value; type = $_.AccessControlType.ToString(); rights = [int]$_.FileSystemRights; inheritOnly = (($_.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) }
})
@{ userSid = $user.Value; ownerSid = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value; hasDacl = ($null -ne $raw.DiscretionaryAcl); rules = $rules } | ConvertTo-Json -Depth 5 -Compress
`;
const executable = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const argumentsForQuery = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(query, 'utf16le').toString('base64')];
const options = (filename, initialize) => ({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 15_000, maxBuffer: 16_384, env: { ...process.env, WORKSPACE_PRIVATE_ACL_PATH: filename, WORKSPACE_PRIVATE_ACL_INITIALIZE: initialize ? 'empty' : '' } });
const decode = stdout => validatePrivateWindowsAcl(JSON.parse(stdout.replace(/^\uFEFF/u, '').trim()));
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.isDirectory() === b.isDirectory() && !b.isSymbolicLink() && (b.isDirectory() || b.isFile() && b.nlink === 1);

// Reuse only the fixed native ACL reader, never a cached ACL decision. Each
// request re-reads the descriptor. A bounded sequential protocol avoids a
// PowerShell startup for every Store read/commit while preserving fail-closed
// behavior when this OS helper is unavailable in the current sandbox.
const loop = String.raw`
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    $request = ConvertFrom-Json -InputObject $line
    $env:WORKSPACE_PRIVATE_ACL_PATH = $request.path
    $env:WORKSPACE_PRIVATE_ACL_INITIALIZE = $request.initialize
    $output = & { ${query} }
    [Console]::Out.WriteLine((@{ ok = $true; output = $output } | ConvertTo-Json -Compress))
  } catch {
    [Console]::Out.WriteLine((@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
  }
}
`;
let reader, inFlight, queue = Promise.resolve(), buffer = '';
function stopReader(cause) {
  const previous = reader; reader = undefined; buffer = '';
  const pending = inFlight; inFlight = undefined;
  if (pending) { clearTimeout(pending.timer); pending.reject(cause); }
  previous?.kill();
}
process.once('exit', () => reader?.kill());
function nativeAclQuery(filename, initialize) {
  const operation = queue.then(() => new Promise((resolve, reject) => {
    if (!reader) {
      const child = childProcess.spawn(executable(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(loop, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      reader = child;
      child.unref(); child.stdin.unref(); child.stdout.unref(); child.stderr.unref();
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        if (reader !== child) return;
        buffer += chunk;
        if (buffer.length > 32_768) return stopReader(new Error('Native DACL response exceeded its bound.'));
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        const pending = inFlight; inFlight = undefined;
        if (!pending || buffer.trim()) {
          const error = new Error('Unexpected native DACL response.');
          if (pending) { clearTimeout(pending.timer); pending.reject(error); }
          return stopReader(error);
        }
        clearTimeout(pending.timer);
        try { const result = JSON.parse(line); if (!result.ok) throw new Error(result.error || 'Native DACL query failed.'); pending.resolve(result.output); }
        catch (error) { pending.reject(error); }
      });
      child.stderr.on('data', () => {}); // Drain native diagnostic stream; the bounded protocol carries failures.
      child.stdin.on('error', error => { if (reader === child) stopReader(error); });
      child.on('error', error => { if (reader === child) stopReader(error); });
      child.on('exit', () => { if (reader === child) stopReader(new Error('Native DACL reader exited.')); });
    }
    const timer = setTimeout(() => stopReader(new Error('Native DACL query timed out.')), 15_000);
    inFlight = { resolve, reject, timer };
    reader.stdin.write(JSON.stringify({ path: filename, initialize: initialize ? 'empty' : '' }) + '\n', error => { if (error) stopReader(error); });
  }));
  queue = operation.catch(() => {});
  return operation;
}

export async function assertPrivateWindowsPath(filename, { initializeEmpty = false } = {}) {
  if (process.platform !== 'win32') return;
  const before = await fs.lstat(filename);
  if (before.isSymbolicLink() || !(before.isDirectory() || before.isFile() && before.nlink === 1)) throw denied();
  const canonical = await fs.realpath(filename);
  const run = initialize => nativeAclQuery(canonical, initialize);
  try {
    try { decode(await run(false)); }
    catch (error) {
      // Narrow only an empty, caller-owned application object. Never repair or
      // silently import an existing nonempty store or credentials file.
      if (!initializeEmpty || error.code !== 'WORKSPACE_PRIVATE_ACL_REQUIRED') throw error;
      if (before.isDirectory() ? (await fs.readdir(canonical)).length !== 0 : before.size !== 0) throw error;
      decode(await run(true));
      if (before.isDirectory() ? (await fs.readdir(canonical)).length !== 0 : (await fs.stat(canonical)).size !== 0) throw denied();
    }
    if (!same(before, await fs.lstat(filename)) || await fs.realpath(filename) !== canonical) throw denied();
  } catch (cause) { throw denied(cause); }
}

export function assertPrivateWindowsPathSync(filename) {
  if (process.platform !== 'win32') return;
  try {
    const before = lstatSync(filename), canonical = realpathSync(filename);
    if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1) throw denied();
    decode(childProcess.execFileSync(executable(), argumentsForQuery, options(canonical, false)));
    if (!same(before, lstatSync(filename)) || realpathSync(filename) !== canonical) throw denied();
  } catch (cause) { throw denied(cause); }
}
