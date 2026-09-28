$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskSource=Join-Path $taskRoot 'src\native\WindowLayer.cs'
$taskOutput=Join-Path $taskRoot 'src\native\WeeklightLayer.exe'
$taskCompiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $taskCompiler)) { $taskCompiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
& $taskCompiler /nologo /target:exe /optimize+ /platform:anycpu ("/out:"+$taskOutput) $taskSource
if ($LASTEXITCODE -ne 0) { throw 'Native window layer helper compilation failed' }
