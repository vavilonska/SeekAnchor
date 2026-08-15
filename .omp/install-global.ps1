param(
  [switch]$Force,
  [string]$AgentRoot
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$source = Join-Path $repositoryRoot ".omp\extensions\deepseek-rl-anchor"
if (-not (Test-Path -LiteralPath (Join-Path $source "index.ts"))) {
  throw "SeekAnchor Oh My Pi runtime not found: $source"
}

if ([string]::IsNullOrWhiteSpace($AgentRoot)) {
  if (-not [string]::IsNullOrWhiteSpace($env:PI_CODING_AGENT_DIR)) {
    $AgentRoot = $env:PI_CODING_AGENT_DIR
  } else {
    $AgentRoot = Join-Path $env:USERPROFILE ".omp\agent"
  }
}

$resolvedAgentRoot = [IO.Path]::GetFullPath($AgentRoot)
$extensionsRoot = Join-Path $resolvedAgentRoot "extensions"
$target = Join-Path $extensionsRoot "deepseek-rl-anchor"

if ((Test-Path -LiteralPath $target) -and -not $Force) {
  throw "SeekAnchor target already exists: $target. Inspect it, then rerun with -Force if replacement is intended."
}

New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Path (Join-Path $source "*") -Destination $target -Recurse -Force

Write-Output "Installed SeekAnchor for Oh My Pi: $target"
Write-Output "Restart Oh My Pi or run /reload before using /ds-mode."
