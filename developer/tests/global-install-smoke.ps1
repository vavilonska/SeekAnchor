$ErrorActionPreference = "Stop"

$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$installer = Join-Path $repositoryRoot ".opencode\install-global.ps1"
$testRoot = Join-Path $env:TEMP ("seek-anchor-global-test-" + [guid]::NewGuid().ToString("N"))
$resolvedTemp = [IO.Path]::GetFullPath($env:TEMP)
$resolvedTest = [IO.Path]::GetFullPath($testRoot)

if (-not $resolvedTest.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe test path: $resolvedTest"
}

try {
  & $installer -ConfigRoot $resolvedTest

  $required = @(
    "plugins\seek-anchor\index.ts",
    "seek-anchor.json",
    "node_modules\@opencode-ai\plugin\package.json"
  )
  foreach ($relativePath in $required) {
    $candidate = Join-Path $resolvedTest $relativePath
    if (-not (Test-Path -LiteralPath $candidate)) {
      throw "Missing installed file: $candidate"
    }
  }

  $conflictStopped = $false
  try {
    & $installer -ConfigRoot $resolvedTest
  } catch {
    $conflictStopped = $_.Exception.Message -like "SeekAnchor targets already exist*"
  }
  if (-not $conflictStopped) {
    throw "Second install did not stop on conflicts"
  }

  Write-Output "GLOBAL_INSTALL_TEST_PASS $resolvedTest"
} finally {
  if (Test-Path -LiteralPath $resolvedTest) {
    Remove-Item -LiteralPath $resolvedTest -Recurse -Force
  }
}
