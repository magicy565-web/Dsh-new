<#
.SYNOPSIS
  Build the full desktop Workspace Harness installer (Electron shell + bundled
  Node 24 runtime + the complete local harness).

.DESCRIPTION
  Unlike installer\build.ps1 (browser edition), this package ships Electron's
  Chromium so the product opens in its own window. Electron 45 embeds Node 24,
  so the harness server runs on the same executable via ELECTRON_RUN_AS_NODE;
  no separate Node runtime is bundled.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File installer\build-desktop.ps1
#>
[CmdletBinding()]
param(
  [string]$Version = "0.5.0-rc.2",
  [string]$NodeExe = "",
  [string]$PnpmCjs = "",
  [string]$BuildRoot = "",
  [string]$ElectronVersion = "45.0.0",
  [string]$ElectronZip = "",
  [switch]$KeepStage,
  [switch]$SkipElectronDownload,
  [switch]$SkipInnoDownload
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$buildRoot = if ($BuildRoot) { $BuildRoot } else { Join-Path $env:TEMP "workspace-harness-desktop-build" }
$payload = Join-Path $buildRoot "payload"
$dist = Join-Path $repo "dist"
$icon = Join-Path $PSScriptRoot "assets\workspace-harness.ico"
$iss = Join-Path $PSScriptRoot "workspace-harness-desktop.iss"

function Step([string]$message) {
  Write-Host ""
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Copy-Tree([string]$source, [string]$destination) {
  if (-not (Test-Path $source)) { throw "missing source directory: $source" }
  $null = New-Item -ItemType Directory -Force $destination
  robocopy $source $destination /E /NFL /NDL /NJH /NJS /XD node_modules .git | Out-Null
  $code = $LASTEXITCODE
  if ($code -ge 8) { throw "robocopy failed ($code): $source -> $destination" }
}

function Find-Node() {
  if ($NodeExe) {
    if (-not (Test-Path $NodeExe)) { throw "NodeExe not found: $NodeExe" }
    return (Resolve-Path $NodeExe).Path
  }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"),
    (Join-Path $env:USERPROFILE ".dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return (Resolve-Path $candidate).Path }
  }
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw "No node.exe found. Pass -NodeExe <path>."
}

function Find-Pnpm([string]$node) {
  if ($PnpmCjs) {
    if (-not (Test-Path $PnpmCjs)) { throw "PnpmCjs not found: $PnpmCjs" }
    return (Resolve-Path $PnpmCjs).Path
  }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs"),
    (Join-Path $env:ProgramFiles "nodejs\node_modules\pnpm\bin\pnpm.cjs")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return (Resolve-Path $candidate).Path }
  }
  $command = Get-Command pnpm -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw "No pnpm found. Pass -PnpmCjs <path to pnpm.cjs>."
}

function Find-Iscc() {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
    (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe")
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return $null
}

function Ensure-Iscc() {
  $iscc = Find-Iscc
  if ($iscc) { return $iscc }
  if ($SkipInnoDownload) { throw "ISCC.exe not found and -SkipInnoDownload was set." }

  Step "Downloading and installing Inno Setup 6 (per user)"
  $download = Join-Path $env:TEMP "innosetup-6-setup.exe"
  $url = "https://github.com/jrsoftware/issrc/releases/download/is-6_7_3/innosetup-6.7.3.exe"
  & curl.exe -L --fail --silent --show-error -o $download $url
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $download)) { throw "Inno Setup download failed." }
  if ((Get-Item $download).Length -lt 3MB) { throw "Inno Setup download looks truncated." }
  $install = Start-Process -FilePath $download -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-", "/CURRENTUSER" -Wait -PassThru
  if ($install.ExitCode -ne 0) { throw "Inno Setup installer exited with $($install.ExitCode)." }
  $iscc = Find-Iscc
  if (-not $iscc) { throw "Inno Setup installed but ISCC.exe was not found." }
  return $iscc
}

function Ensure-Electron() {
  if ($ElectronZip) {
    if (-not (Test-Path $ElectronZip)) { throw "ElectronZip not found: $ElectronZip" }
    return (Resolve-Path $ElectronZip).Path
  }
  $cached = Join-Path $env:TEMP "electron-v$ElectronVersion-win32-x64.zip"
  if ((Test-Path $cached) -and ((Get-Item $cached).Length -gt 100MB)) {
    Write-Host "    cached: $cached"
    return $cached
  }
  if ($SkipElectronDownload) { throw "Electron zip not cached and -SkipElectronDownload was set." }

  Step "Downloading Electron $ElectronVersion (win32-x64)"
  $urls = @(
    "https://github.com/electron/electron/releases/download/v$ElectronVersion/electron-v$ElectronVersion-win32-x64.zip",
    "https://npmmirror.com/mirrors/electron/$ElectronVersion/electron-v$ElectronVersion-win32-x64.zip"
  )
  foreach ($url in $urls) {
    for ($attempt = 1; $attempt -le 4; $attempt++) {
      Write-Host "    $url (attempt $attempt)"
      & curl.exe -L --fail --retry 3 --retry-all-errors --retry-delay 2 --connect-timeout 30 --max-time 1800 -C - -o $cached $url
      if ($LASTEXITCODE -eq 0 -and (Test-Path $cached) -and ((Get-Item $cached).Length -gt 100MB)) {
        Write-Host ("    downloaded {0:N1} MB" -f ((Get-Item $cached).Length / 1MB))
        return $cached
      }
      Start-Sleep -Seconds 3
    }
    if (Test-Path $cached) { Remove-Item -Force $cached }
  }
  throw "Electron download failed from all sources."
}

function Ensure-Rcedit() {
  $rcedit = Join-Path $env:TEMP "rcedit-x64.exe"
  if (Test-Path $rcedit) { return $rcedit }
  Step "Downloading rcedit"
  & curl.exe -L --fail --silent --show-error -o $rcedit "https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe"
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $rcedit)) { throw "rcedit download failed." }
  return $rcedit
}

# ---------------------------------------------------------------- stage

Step "Staging desktop harness ($Version)"
if (Test-Path $payload) { Remove-Item -Force -Recurse $payload }
$null = New-Item -ItemType Directory -Force $payload

$electronZipPath = Ensure-Electron
Step "Extracting Electron"
$electronDir = Join-Path $buildRoot "electron"
if (Test-Path $electronDir) { Remove-Item -Force -Recurse $electronDir }
$null = New-Item -ItemType Directory -Force $electronDir
& tar.exe -xf $electronZipPath -C $electronDir
if ($LASTEXITCODE -ne 0) { throw "Electron extraction failed." }
Copy-Tree $electronDir $payload
$defaultApp = Join-Path $payload "resources\default_app.asar"
if (Test-Path $defaultApp) { Remove-Item -Force $defaultApp }

$appDir = Join-Path $payload "resources\app"
$harnessDir = Join-Path $appDir "harness"
$null = New-Item -ItemType Directory -Force $appDir
$null = New-Item -ItemType Directory -Force $harnessDir

foreach ($directory in @("packages", "plugins", "server", "scripts")) {
  Copy-Tree (Join-Path $repo $directory) (Join-Path $harnessDir $directory)
  Write-Host "    $directory"
}
foreach ($file in @("harness.local.yml", "README.md", "THIRD_PARTY_NOTICES.md")) {
  $source = Join-Path $repo $file
  if (Test-Path $source) { Copy-Item $source (Join-Path $harnessDir $file) }
}
Copy-Tree (Join-Path $PSScriptRoot "desktop") (Join-Path $harnessDir "desktop")

# The harness server runs on Electron's embedded Node 24 (ELECTRON_RUN_AS_NODE),
# so there is no second runtime in the payload.
$node = Find-Node
Write-Host "    pnpm node: $node"

$runtimePackage = [ordered]@{
  name = "workspace-harness-desktop-runtime"
  private = $true
  version = $Version
  type = "module"
  dependencies = [ordered]@{
    cordis = "4.0.0-rc.11"
    yaml = "2.9.1"
  }
}
$runtimePackage | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $harnessDir "package.json")

Step "Installing harness production dependencies (hoisted)"
$pnpm = Find-Pnpm $node
Push-Location $harnessDir
try {
  & $node $pnpm install --prod --ignore-scripts --node-linker=hoisted --reporter=append-only
  if ($LASTEXITCODE -ne 0) { throw "pnpm install failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}
if (-not (Test-Path (Join-Path $harnessDir "node_modules\cordis"))) { throw "harness node_modules is missing cordis." }

Step "Writing Electron app"
Copy-Item (Join-Path $PSScriptRoot "electron\main.js") (Join-Path $appDir "main.js") -Force
Copy-Item $icon (Join-Path $appDir "icon.ico") -Force
$appPackage = Get-Content (Join-Path $PSScriptRoot "electron\package.json") -Raw | ConvertFrom-Json
$appPackage.version = $Version
$appPackage | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $appDir "package.json")

$electronExe = Join-Path $payload "electron.exe"
$productExe = Join-Path $payload "WorkspaceHarness.exe"
if (-not (Test-Path $electronExe)) { throw "Electron payload has no electron.exe." }
Move-Item -Force $electronExe $productExe

Step "Setting executable icon and version info"
$rcedit = Ensure-Rcedit
& $rcedit $productExe --set-icon $icon --set-file-version "0.5.0.2" --set-product-version "0.5.0.2" `
  --set-version-string "FileDescription" "Workspace Harness" `
  --set-version-string "ProductName" "Workspace Harness" `
  --set-version-string "CompanyName" "magicy565-web" `
  --set-version-string "LegalCopyright" "MIT" `
  --set-version-string "OriginalFilename" "WorkspaceHarness.exe"
if ($LASTEXITCODE -ne 0) { throw "rcedit failed with exit code $LASTEXITCODE." }

$installNotes = @"
Workspace Harness $Version 桌面版
================================

双击开始菜单/桌面快捷方式打开独立窗口。
关闭窗口只会隐藏到托盘；要彻底退出请用托盘菜单“退出”。

托盘菜单：
  打开 Workspace Harness
  在浏览器中打开
  停止本地服务
  退出

数据与日志（升级/卸载保留）：
  %LOCALAPPDATA%\WorkspaceHarness\data
  %LOCALAPPDATA%\WorkspaceHarness\logs
  %LOCALAPPDATA%\WorkspaceHarness\chromium

默认不配置模型；需要真实模型时按安装目录 resources\app\harness\README.md 显式配置。
后端只监听 127.0.0.1:8790，请勿直接暴露到公网。
"@
Set-Content -Path (Join-Path $payload "INSTALL.txt") -Value $installNotes -Encoding UTF8

Step "Compiling desktop installer"
$iscc = Ensure-Iscc
$null = New-Item -ItemType Directory -Force $dist
& $iscc "/DAppVersion=$Version" "/DPayloadDir=$payload" "/DOutputDir=$dist" "/DIconFile=$icon" $iss
if ($LASTEXITCODE -ne 0) { throw "ISCC failed with exit code $LASTEXITCODE." }

$setup = Join-Path $dist ("Workspace-Harness-Desktop-Setup-{0}.exe" -f $Version)
if (-not (Test-Path $setup)) { throw "installer not found: $setup" }

$hash = (Get-FileHash $setup -Algorithm SHA256).Hash
$size = (Get-Item $setup).Length / 1MB
Set-Content -Path (Join-Path $dist "SHA256SUMS-desktop.txt") -Value ("{0}  {1}" -f $hash, (Split-Path $setup -Leaf)) -Encoding ASCII

if (-not $KeepStage) {
  Step "Cleaning staging directory"
  Remove-Item -Force -Recurse $buildRoot
}

Write-Host ""
Write-Host "Desktop installer ready:" -ForegroundColor Green
Write-Host "  $setup"
Write-Host ("  {0:N1} MB" -f $size)
Write-Host "  SHA-256 $hash"
