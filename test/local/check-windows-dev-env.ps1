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

function Get-VsBuildTools {
  $vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
  if (-not (Test-Path -LiteralPath $vswhere)) {
    return [pscustomobject]@{
      found = $false
      installationPath = $null
      msbuildPath = $null
      clPath = $null
      spectreLibPath = $null
    }
  }

  $installationPath = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath) | Select-Object -First 1
  if (-not $installationPath) {
    return [pscustomobject]@{
      found = $false
      installationPath = $null
      msbuildPath = $null
      clPath = $null
      spectreLibPath = $null
    }
  }

  $msbuildPath = Join-Path $installationPath 'MSBuild\Current\Bin\MSBuild.exe'
  $vcRoot = Join-Path $installationPath 'VC\Tools\MSVC'
  $latestMsvc = Get-ChildItem -LiteralPath $vcRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    Select-Object -First 1
  $clPath = if ($latestMsvc) { Join-Path $latestMsvc.FullName 'bin\Hostx64\x64\cl.exe' } else { $null }
  $spectreLibPath = if ($latestMsvc) { Join-Path $latestMsvc.FullName 'lib\spectre' } else { $null }

  [pscustomobject]@{
    found = $true
    installationPath = $installationPath
    msbuildPath = $msbuildPath
    clPath = $clPath
    spectreLibPath = $spectreLibPath
  }
}

$node = Get-CommandInfo node
$npm = Get-CommandInfo npm
$yarn = Get-CommandInfo yarn
$cl = Get-CommandInfo cl
$msbuild = Get-CommandInfo msbuild
$gh = Get-CommandInfo gh
$nodeMajor = Get-NodeMajor $node.version
$vsBuildTools = Get-VsBuildTools

$repoRoot = (Resolve-Path -LiteralPath '.').Path
$resolvedAppPath = Join-Path $repoRoot $AppPath
$hasCl = $cl.found -or ($vsBuildTools.clPath -and (Test-Path -LiteralPath $vsBuildTools.clPath))
$hasMsbuild = $msbuild.found -or ($vsBuildTools.msbuildPath -and (Test-Path -LiteralPath $vsBuildTools.msbuildPath))
$hasSpectreLibs = $vsBuildTools.spectreLibPath -and (Test-Path -LiteralPath $vsBuildTools.spectreLibPath)
$hasDependencies = Test-Path -LiteralPath (Join-Path $resolvedAppPath 'node_modules')
$hasDist = Test-Path -LiteralPath (Join-Path $resolvedAppPath 'dist')

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
    ok = $hasCl
    detail = if ($cl.found) { $cl.path } elseif ($vsBuildTools.clPath) { "$($vsBuildTools.clPath) (via VS Build Tools)" } else { 'cl.exe not found' }
    fix = 'Install Visual Studio Build Tools with Desktop development with C++.'
  },
  [pscustomobject]@{
    name = 'MSBuild'
    ok = $hasMsbuild
    detail = if ($msbuild.found) { $msbuild.path } elseif ($vsBuildTools.msbuildPath) { "$($vsBuildTools.msbuildPath) (via VS Build Tools)" } else { 'msbuild.exe not found' }
    fix = 'Install Visual Studio Build Tools with MSBuild.'
  },
  [pscustomobject]@{
    name = 'MSVC Spectre libraries'
    ok = $hasSpectreLibs
    detail = if ($hasSpectreLibs) { $vsBuildTools.spectreLibPath } else { 'Spectre libraries not found under VC Tools MSVC lib directory' }
    fix = 'Install Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre and matching v143 Spectre libraries.'
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
    ok = $hasDependencies
    detail = Join-Path $resolvedAppPath 'node_modules'
    fix = 'Run npm ci after Node.js 22 and Visual C++ Build Tools are ready.'
  },
  [pscustomobject]@{
    name = 'Local packaged dist'
    ok = $hasDist
    detail = Join-Path $resolvedAppPath 'dist'
    fix = 'Run the Windows release workflow or local package build after dependencies are ready.'
  }
)

$devChecks = $checks | Where-Object { $_.name -ne 'Local packaged dist' }

$summary = [pscustomobject]@{
  status = if (($devChecks | Where-Object { -not $_.ok }).Count -eq 0) { 'dev-ready' } else { 'not-ready' }
  packaged = $hasDist
  repoRoot = $repoRoot
  appPath = $resolvedAppPath
  vsBuildTools = $vsBuildTools
  checks = $checks
  paths = @(
    Get-PathState (Join-Path $resolvedAppPath 'package.json')
    Get-PathState (Join-Path $resolvedAppPath 'package-lock.json')
    Get-PathState (Join-Path $resolvedAppPath 'node_modules')
    Get-PathState (Join-Path $resolvedAppPath 'dist')
  )
}

$summary | ConvertTo-Json -Depth 5
