param(
  [string]$AppPath = "apps/electerm-agent"
)

$ErrorActionPreference = 'Stop'

function Get-CommandInfo {
  param([Parameter(Mandatory = $true)][string]$Name)

  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    return [pscustomobject]@{
      found = $false
      path = $null
      version = $null
    }
  }

  $version = $null
  try {
    if ($Name -in @('node', 'npm', 'yarn')) {
      $version = (& $cmd.Source -v 2>$null | Select-Object -First 1)
    }
  }
  catch {
    $version = $null
  }

  [pscustomobject]@{
    found = $true
    path = $cmd.Source
    version = $version
  }
}

function Get-NodeMajor {
  param([string]$Version)

  if (-not $Version) {
    return $null
  }

  if ($Version -match '^v?(\d+)') {
    return [int]$Matches[1]
  }

  $null
}

function Get-PathState {
  param([Parameter(Mandatory = $true)][string]$Path)

  [pscustomobject]@{
    path = $Path
    exists = Test-Path -LiteralPath $Path
  }
}

$node = Get-CommandInfo node
$npm = Get-CommandInfo npm
$yarn = Get-CommandInfo yarn
$cl = Get-CommandInfo cl
$msbuild = Get-CommandInfo msbuild
$gh = Get-CommandInfo gh
$nodeMajor = Get-NodeMajor $node.version

$repoRoot = (Resolve-Path -LiteralPath '.').Path
$resolvedAppPath = Join-Path $repoRoot $AppPath

$checks = @(
  [pscustomobject]@{
    name = 'Node.js 22'
    ok = $node.found -and $nodeMajor -eq 22
    detail = if ($node.found) { "$($node.version) at $($node.path)" } else { 'not found' }
    fix = 'Install Node.js 22 LTS or use the same Node version as GitHub Actions.'
  },
  [pscustomobject]@{
    name = 'npm'
    ok = $npm.found
    detail = if ($npm.found) { "$($npm.version) at $($npm.path)" } else { 'not found' }
    fix = 'Install npm with Node.js 22.'
  },
  [pscustomobject]@{
    name = 'Yarn Classic'
    ok = $yarn.found
    detail = if ($yarn.found) { "$($yarn.version) at $($yarn.path)" } else { 'not found' }
    fix = 'Run: npm install -g yarn@1.22.22'
  },
  [pscustomobject]@{
    name = 'Visual C++ compiler'
    ok = $cl.found
    detail = if ($cl.found) { $cl.path } else { 'cl.exe not found in PATH' }
    fix = 'Install Visual Studio Build Tools with Desktop development with C++.'
  },
  [pscustomobject]@{
    name = 'MSBuild'
    ok = $msbuild.found
    detail = if ($msbuild.found) { $msbuild.path } else { 'msbuild.exe not found in PATH' }
    fix = 'Install Visual Studio Build Tools and open a Developer PowerShell, or add MSBuild to PATH.'
  },
  [pscustomobject]@{
    name = 'GitHub CLI'
    ok = $gh.found
    detail = if ($gh.found) { $gh.path } else { 'gh not found' }
    fix = 'Install GitHub CLI if local artifact download or workflow control is needed.'
  },
  [pscustomobject]@{
    name = 'Electerm app path'
    ok = Test-Path -LiteralPath $resolvedAppPath
    detail = $resolvedAppPath
    fix = 'Run this script from the repository root.'
  },
  [pscustomobject]@{
    name = 'Local dependencies'
    ok = Test-Path -LiteralPath (Join-Path $resolvedAppPath 'node_modules')
    detail = Join-Path $resolvedAppPath 'node_modules'
    fix = 'Run npm ci after Node.js 22 and Visual C++ Build Tools are ready.'
  },
  [pscustomobject]@{
    name = 'Local packaged dist'
    ok = Test-Path -LiteralPath (Join-Path $resolvedAppPath 'dist')
    detail = Join-Path $resolvedAppPath 'dist'
    fix = 'Run the Windows release workflow or local package build after dependencies are ready.'
  }
)

$summary = [pscustomobject]@{
  status = if (($checks | Where-Object { -not $_.ok }).Count -eq 0) { 'ready' } else { 'not-ready' }
  repoRoot = $repoRoot
  appPath = $resolvedAppPath
  checks = $checks
  paths = @(
    Get-PathState (Join-Path $resolvedAppPath 'package.json')
    Get-PathState (Join-Path $resolvedAppPath 'package-lock.json')
    Get-PathState (Join-Path $resolvedAppPath 'node_modules')
    Get-PathState (Join-Path $resolvedAppPath 'dist')
  )
}

$summary | ConvertTo-Json -Depth 5
