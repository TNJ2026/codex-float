$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path (Split-Path $PSScriptRoot)
Set-Location -LiteralPath $taskRoot
. "$PSScriptRoot\env.ps1"
npm.cmd run tauri -- dev
