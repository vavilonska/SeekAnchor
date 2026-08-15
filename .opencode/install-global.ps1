[CmdletBinding()]
param(
  [switch]$Force,
  [string]$ConfigRoot
)

$ErrorActionPreference = "Stop"

$configRoot = if ([string]::IsNullOrWhiteSpace($ConfigRoot)) {
  Join-Path $env:USERPROFILE ".config\opencode"
} else {
  [System.IO.Path]::GetFullPath($ConfigRoot)
}
$sourcePlugin = Join-Path $PSScriptRoot "plugins\seek-anchor"
$sourceSettings = Join-Path $PSScriptRoot "seek-anchor.json"
$sourcePackage = Join-Path $PSScriptRoot "package.json"
$targetPlugin = Join-Path $configRoot "plugins\seek-anchor"
$targetSettings = Join-Path $configRoot "seek-anchor.json"
$targetPackage = Join-Path $configRoot "package.json"

foreach ($requiredPath in @($sourcePlugin, $sourceSettings, $sourcePackage)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Required SeekAnchor source is missing: $requiredPath"
  }
}

$conflicts = @()
if (Test-Path -LiteralPath $targetPlugin) {
  $conflicts += $targetPlugin
}
if ($conflicts.Count -gt 0 -and -not $Force) {
  $rendered = $conflicts -join [Environment]::NewLine
  throw "SeekAnchor targets already exist. Review them, then rerun with -Force to merge/overwrite runtime files:`n$rendered"
}

New-Item -ItemType Directory -Force -Path $configRoot, $targetPlugin | Out-Null

if (-not (Test-Path -LiteralPath $targetPackage)) {
  @{
    name = "seek-anchor-opencode-global"
    private = $true
    type = "module"
  } | ConvertTo-Json | Set-Content -LiteralPath $targetPackage -Encoding utf8
}

$packageJson = Get-Content -Raw -LiteralPath $sourcePackage | ConvertFrom-Json
$pluginVersion = $packageJson.dependencies.'@opencode-ai/plugin'
if (-not $pluginVersion) {
  throw "Cannot determine @opencode-ai/plugin version from $sourcePackage"
}

& npm install --prefix $configRoot --save-exact "@opencode-ai/plugin@$pluginVersion"
if ($LASTEXITCODE -ne 0) {
  throw "npm failed to install @opencode-ai/plugin@$pluginVersion in $configRoot"
}

Get-ChildItem -LiteralPath $sourcePlugin -Force | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $targetPlugin -Recurse -Force
}
if (-not (Test-Path -LiteralPath $targetSettings)) {
  Copy-Item -LiteralPath $sourceSettings -Destination $targetSettings
  $settingsAction = "created"
} else {
  $settingsAction = "preserved existing"
}

Write-Host "SeekAnchor OpenCode runtime installed globally."
Write-Host "Plugin:  $targetPlugin"
Write-Host "Settings: $targetSettings ($settingsAction)"
Write-Host "Configure SeekAnchor by editing the settings JSON above; no ds-* commands are registered."
Write-Host "Restart OpenCode completely before testing the plugin."
