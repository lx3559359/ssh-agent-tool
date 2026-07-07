param(
  [int]$VitePort = 5570,
  [int]$ViteStartupTimeoutSec = 90,
  [switch]$SkipElectron
)

$ErrorActionPreference = 'Stop'

function Get-RepoRoot {
  Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')
}

function Get-FnmPath {
  $candidates = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Schniz.fnm_Microsoft.Winget.Source_8wekyb3d8bbwe\fnm.exe",
    (Get-Command fnm -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
  ) | Where-Object { $_ }

  $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

function New-NodeBootstrap {
  param(
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$LogPath,
    [Parameter(Mandatory = $true)][string]$NpmCommand,
    [string]$FnmPath
  )

  $escapedWorkingDirectory = $WorkingDirectory.Replace("'", "''")
  $escapedLogPath = $LogPath.Replace("'", "''")

  $fnmLines = if ($FnmPath) {
    $escapedFnmPath = $FnmPath.Replace("'", "''")
@"
& '$escapedFnmPath' env --use-on-cd --shell powershell | Out-String | Invoke-Expression
& '$escapedFnmPath' use 22
"@
  } else {
    ''
  }

@"
Set-Location -LiteralPath '$escapedWorkingDirectory'
$fnmLines
$NpmCommand *> '$escapedLogPath'
"@
}

function Test-HttpReady {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][int]$TimeoutSec
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  do {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -eq 200) {
        return $true
      }
    }
    catch {
      Start-Sleep -Seconds 2
    }
  } while ((Get-Date) -lt $deadline)

  return $false
}

$repoRoot = (Get-RepoRoot).Path
$appPath = Join-Path $repoRoot 'apps\electerm-agent'
$logDir = Join-Path $repoRoot '.artifacts\local-dev'
$viteLog = Join-Path $logDir 'vite.log'
$electronLog = Join-Path $logDir 'electron.log'
$fnmPath = Get-FnmPath

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$viteProcess = $null
$viteConnection = Get-NetTCPConnection -LocalPort $VitePort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $viteConnection) {
  $viteCommand = New-NodeBootstrap -WorkingDirectory $appPath -LogPath $viteLog -NpmCommand 'npm start' -FnmPath $fnmPath
  $viteProcess = Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $viteCommand) -WindowStyle Hidden -PassThru
}

$viteUrl = "http://127.0.0.1:$VitePort"
$viteReady = Test-HttpReady -Url $viteUrl -TimeoutSec $ViteStartupTimeoutSec
if (-not $viteReady) {
  throw "Vite dev server did not become ready at $viteUrl. Check $viteLog"
}

$electronProcess = $null
if (-not $SkipElectron) {
  $electronCommand = New-NodeBootstrap -WorkingDirectory $appPath -LogPath $electronLog -NpmCommand 'npm run app' -FnmPath $fnmPath
  $electronProcess = Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $electronCommand) -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 8
}

$electronWindows = Get-Process electron -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -like "$appPath*" } |
  Select-Object Id, MainWindowTitle, Path

[pscustomobject]@{
  status = 'started'
  repoRoot = $repoRoot
  appPath = $appPath
  viteUrl = $viteUrl
  viteStartedPid = if ($viteProcess) { $viteProcess.Id } else { $null }
  electronLauncherPid = if ($electronProcess) { $electronProcess.Id } else { $null }
  electronWindows = $electronWindows
  logs = [pscustomobject]@{
    vite = $viteLog
    electron = $electronLog
  }
} | ConvertTo-Json -Depth 4
