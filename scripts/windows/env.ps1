$taskRoot = Split-Path (Split-Path $PSScriptRoot)
if (Test-Path -LiteralPath "$taskRoot\.tools\cargo\bin") {
  $env:CARGO_HOME = "$taskRoot\.tools\cargo"
  $env:RUSTUP_HOME = "$taskRoot\.tools\rustup"
  $env:PATH = "$env:CARGO_HOME\bin;$env:PATH"
}
$taskVcvars = "$taskRoot\.tools\vs\VC\Auxiliary\Build\vcvars64.bat"
if (Test-Path -LiteralPath $taskVcvars) {
  $taskEnvironment = & $env:ComSpec /d /c ('call "' + $taskVcvars + '" >nul && set')
  foreach ($taskLine in $taskEnvironment) {
    if ($taskLine -match '^(Path|LIB|INCLUDE|LIBPATH|VCToolsInstallDir|WindowsSdkDir|WindowsSDKVersion)=(.*)$') {
      [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
  }
}
# Optional project-local Windows SDK (Microsoft.Windows.SDK.CPP NuGet layout).
$taskSdk = Join-Path $taskRoot '.tools/windows-sdk/microsoft.windows.sdk.cpp/c'
$taskSdkLib = Join-Path $taskRoot '.tools/windows-sdk/microsoft.windows.sdk.cpp.x64/c'
if (Test-Path -LiteralPath "$taskSdkLib/um/x64/kernel32.Lib") {
  $taskSdkIncludes = Get-ChildItem -LiteralPath "$taskSdk/Include" -Directory | Sort-Object Name -Descending | Select-Object -First 1
  if ($taskSdkIncludes) {
    $env:INCLUDE = "$($taskSdkIncludes.FullName)\ucrt;$($taskSdkIncludes.FullName)\shared;$($taskSdkIncludes.FullName)\um;$($taskSdkIncludes.FullName)\winrt;$env:INCLUDE"
    $env:LIB = "$taskSdkLib\um\x64;$taskSdkLib\ucrt\x64;$env:LIB"
    $env:PATH = "$taskSdk\bin\$($taskSdkIncludes.Name)\x64;$env:PATH"
  }
}
