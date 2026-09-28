$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$taskRoot = (Get-Location).Path
$env:npm_config_cache = Join-Path $taskRoot '_work\npm-cache'
$env:electron_config_cache = Join-Path $taskRoot '_work\electron-cache'
$env:ELECTRON_BUILDER_CACHE = Join-Path $taskRoot '_work\builder-cache'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
$env:TEMP = Join-Path $taskRoot '_work\build-temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
node -e "require('electron')"
if ($LASTEXITCODE -ne 0) { throw 'Electron runtime preparation failed' }
npm.cmd run dist
if ($LASTEXITCODE -ne 0) { throw 'Windows 打包失败' }
