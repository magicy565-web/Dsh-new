<#
.SYNOPSIS
  Build the one-click Workspace Harness installer (dist/Workspace-Harness-Setup-<version>.exe).

.DESCRIPTION
  Stages the local harness app, installs the two production dependencies (cordis, yaml)
  with a hoisted (symlink-free) layout, bundles a Node 24 runtime, compiles the C#
  launcher, then compiles the Inno Setup script. Inno Setup 6 is downloaded and
  installed per-user when it is missing.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File installer\build.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File installer\build.ps1 -Version 0.5.0-rc.2 -NodeExe "C:\node\node.exe"
#>
[CmdletBinding()]
param(
  [string]$Version = "0.5.0-rc.2",
  [string]$NodeExe = "",
  [string]$PnpmCjs = "",
  [string]$BuildRoot = "",
  [switch]$KeepStage,
  [switch]$SkipInnoDownload
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$buildRoot = if ($BuildRoot) { $BuildRoot } else { Join-Path $env:TEMP "workspace-harness-installer" }
$payload = Join-Path $buildRoot "payload"
$dist = Join-Path $repo "dist"
$icon = Join-Path $PSScriptRoot "assets\workspace-harness.ico"
$iss = Join-Path $PSScriptRoot "workspace-harness.iss"

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

function Find-Csc() {
  $candidates = @(
    (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
    (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }
  throw "csc.exe (.NET Framework 4) not found."
}

function Ensure-Icon() {
  if (Test-Path $icon) { return }
  Step "Generating application icon"
  $null = New-Item -ItemType Directory -Force (Split-Path $icon)
  Add-Type -AssemblyName System.Drawing
  $size = 256
  $bitmap = New-Object System.Drawing.Bitmap($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $radius = 48
  $diameter = $radius * 2
  $path.AddArc(0, 0, $diameter, $diameter, 180, 90)
  $path.AddArc($size - $diameter, 0, $diameter, $diameter, 270, 90)
  $path.AddArc($size - $diameter, $size - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc(0, $size - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 37, 99, 235),
    [System.Drawing.Color]::FromArgb(255, 23, 37, 84),
    45.0)
  $graphics.FillPath($brush, $path)

  $font = New-Object System.Drawing.Font("Segoe UI", 96, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $graphics.DrawString("WH", $font, $white, (New-Object System.Drawing.RectangleF(0, 0, $size, $size)), $format)

  $pngStream = New-Object System.IO.MemoryStream
  $bitmap.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngBytes = $pngStream.ToArray()

  $stream = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.BinaryWriter($stream)
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]1)
  $writer.Write([Byte]0)
  $writer.Write([Byte]0)
  $writer.Write([Byte]0)
  $writer.Write([Byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$pngBytes.Length)
  $writer.Write([UInt32]22)
  $writer.Write($pngBytes)
  $writer.Flush()
  [System.IO.File]::WriteAllBytes($icon, $stream.ToArray())
  $writer.Dispose(); $stream.Dispose(); $pngStream.Dispose()
  $graphics.Dispose(); $bitmap.Dispose()
  Write-Host "    icon: $icon"
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
  if ((Get-Item $download).Length -lt 3MB) { throw "Inno Setup download looks truncated: $((Get-Item $download).Length) bytes." }

  $install = Start-Process -FilePath $download -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-", "/CURRENTUSER" -Wait -PassThru
  if ($install.ExitCode -ne 0) { throw "Inno Setup installer exited with $($install.ExitCode)." }

  $iscc = Find-Iscc
  if (-not $iscc) { throw "Inno Setup installed but ISCC.exe was not found." }
  return $iscc
}

# ---------------------------------------------------------------- stage

Step "Staging local harness ($Version)"
if (Test-Path $payload) { Remove-Item -Force -Recurse $payload }
$null = New-Item -ItemType Directory -Force $payload

foreach ($directory in @("packages", "plugins", "server", "scripts")) {
  Copy-Tree (Join-Path $repo $directory) (Join-Path $payload $directory)
  Write-Host "    $directory"
}
foreach ($file in @("harness.local.yml", "README.md", "THIRD_PARTY_NOTICES.md")) {
  $source = Join-Path $repo $file
  if (Test-Path $source) { Copy-Item $source (Join-Path $payload $file) }
}
Copy-Tree (Join-Path $PSScriptRoot "desktop") (Join-Path $payload "desktop")
$null = New-Item -ItemType Directory -Force (Join-Path $payload "runtime")

$node = Find-Node
Write-Host "    node: $node"
Copy-Item $node (Join-Path $payload "runtime\node.exe")

$runtimePackage = [ordered]@{
  name = "workspace-harness-desktop"
  private = $true
  version = $Version
  type = "module"
  dependencies = [ordered]@{
    cordis = "4.0.0-rc.11"
    yaml = "2.9.1"
  }
}
$runtimePackage | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $payload "package.json")

Step "Installing production dependencies (hoisted)"
$pnpm = Find-Pnpm $node
Push-Location $payload
try {
  & $node $pnpm install --prod --ignore-scripts --node-linker=hoisted --reporter=append-only
  if ($LASTEXITCODE -ne 0) { throw "pnpm install failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}
$modules = Join-Path $payload "node_modules"
if (-not (Test-Path (Join-Path $modules "cordis")) -or -not (Test-Path (Join-Path $modules "yaml"))) {
  throw "node_modules is missing cordis or yaml after install."
}
$moduleSize = (Get-ChildItem $modules -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("    node_modules: {0:N1} MB" -f $moduleSize)

# ---------------------------------------------------------------- launcher

Step "Compiling launcher"
Ensure-Icon
$csc = Find-Csc
$launcherSource = Join-Path $PSScriptRoot "launcher\WorkspaceHarness.cs"
$launcherExe = Join-Path $payload "WorkspaceHarness.exe"
& $csc /nologo /target:winexe /optimize+ "/out:$launcherExe" "/win32icon:$icon" /r:System.Windows.Forms.dll $launcherSource
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $launcherExe)) { throw "launcher compilation failed." }
Write-Host "    $launcherExe"

# ---------------------------------------------------------------- install notes

$installNotes = @"
Workspace Harness $Version
==========================

双击桌面快捷方式（或开始菜单里的 Workspace Harness）即可启动。
浏览器会打开 http://127.0.0.1:8790/home 。

停止服务：
  开始菜单 -> 停止 Workspace Harness 服务
  或运行安装目录下的 WorkspaceHarness.exe --stop

数据（保留，不随卸载删除）：
  %LOCALAPPDATA%\WorkspaceHarness\data
日志：
  %LOCALAPPDATA%\WorkspaceHarness\logs\server.log
  %LOCALAPPDATA%\WorkspaceHarness\logs\launcher.log

默认不配置模型；需要真实模型时按安装目录 README.md / docs 的说明显式配置。
后端只监听 127.0.0.1:8790，请勿直接暴露到公网。
"@
Set-Content -Path (Join-Path $payload "INSTALL.txt") -Value $installNotes -Encoding UTF8

# ---------------------------------------------------------------- installer

Step "Compiling installer"
$iscc = Ensure-Iscc
$null = New-Item -ItemType Directory -Force $dist
Ensure-Icon
& $iscc "/DAppVersion=$Version" "/DPayloadDir=$payload" "/DOutputDir=$dist" "/DIconFile=$icon" $iss
if ($LASTEXITCODE -ne 0) { throw "ISCC failed with exit code $LASTEXITCODE." }

$setup = Join-Path $dist ("Workspace-Harness-Setup-{0}.exe" -f $Version)
if (-not (Test-Path $setup)) { throw "installer not found: $setup" }

$hash = (Get-FileHash $setup -Algorithm SHA256).Hash
$size = (Get-Item $setup).Length / 1MB
Set-Content -Path (Join-Path $dist "SHA256SUMS.txt") -Value ("{0}  {1}" -f $hash, (Split-Path $setup -Leaf)) -Encoding ASCII

if (-not $KeepStage) {
  Step "Cleaning staging directory"
  Remove-Item -Force -Recurse $buildRoot
}

Write-Host ""
Write-Host "Installer ready:" -ForegroundColor Green
Write-Host "  $setup"
Write-Host ("  {0:N1} MB" -f $size)
Write-Host "  SHA-256 $hash"
