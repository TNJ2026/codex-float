param([switch]$Release)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path (Split-Path $PSScriptRoot)
Set-Location -LiteralPath $taskRoot
. "$PSScriptRoot\env.ps1"
$taskBuildArgs = @('run', 'tauri', '--', 'build', '--no-bundle')
if (-not $Release) { $taskBuildArgs += '--debug' }
& npm.cmd @taskBuildArgs
if ($LASTEXITCODE -ne 0) { throw 'Tauri build failed' }
