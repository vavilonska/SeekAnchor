$ErrorActionPreference = "Stop"

$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$installer = Join-Path $repositoryRoot ".omp\install-global.ps1"
$testRoot = Join-Path $env:TEMP ("seek-anchor-omp-global-test-" + [guid]::NewGuid().ToString("N"))
$resolvedTemp = [IO.Path]::GetFullPath($env:TEMP)
$resolvedTest = [IO.Path]::GetFullPath($testRoot)

if (-not $resolvedTest.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe test path: $resolvedTest"
}

try {
  & $installer -AgentRoot $resolvedTest

  $required = @(
    "extensions\deepseek-rl-anchor\index.ts",
    "extensions\deepseek-rl-anchor\commands.ts"
  )
  foreach ($relativePath in $required) {
    $candidate = Join-Path $resolvedTest $relativePath
    if (-not (Test-Path -LiteralPath $candidate)) {
      throw "Missing installed file: $candidate"
    }
  }

  $conflictStopped = $false
  try {
    & $installer -AgentRoot $resolvedTest
  } catch {
    $conflictStopped = $_.Exception.Message -like "SeekAnchor target already exists*"
  }
  if (-not $conflictStopped) {
    throw "Second install did not stop on conflicts"
  }

  Write-Output "OMP_GLOBAL_INSTALL_TEST_PASS $resolvedTest"
} finally {
  if (Test-Path -LiteralPath $resolvedTest) {
    Remove-Item -LiteralPath $resolvedTest -Recurse -Force
  }
}
