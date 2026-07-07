param(
  [Parameter(Mandatory = $true)]
  [string]$ArtifactPath,

  [long]$MinInstallerBytes = 100MB,

  [long]$MinPortableBytes = 100MB
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $ArtifactPath)) {
  throw "Artifact path not found: $ArtifactPath"
}

$resolvedPath = (Resolve-Path -LiteralPath $ArtifactPath).Path
$artifactItem = Get-Item -LiteralPath $resolvedPath

function Test-WindowsArtifactEntries {
  param(
    [Parameter(Mandatory = $true)]
    [array]$Entries,

    [Parameter(Mandatory = $true)]
    [string]$Source,

    [Parameter(Mandatory = $true)]
    [long]$SourceSizeBytes
  )

  $entries = @($Entries | Where-Object { $_.Length -gt 0 })
  $installer = $entries | Where-Object { $_.Name -match '^SSH-Agent-Tool-.+-win-x64-installer\.exe$' } | Select-Object -First 1
  $portable = $entries | Where-Object { $_.Name -match '^SSH-Agent-Tool-.+-win-x64-portable\.tar\.gz$' } | Select-Object -First 1

  if (-not $installer) {
    throw 'Missing Windows NSIS installer: SSH-Agent-Tool-*-win-x64-installer.exe'
  }

  if (-not $portable) {
    throw 'Missing Windows portable package: SSH-Agent-Tool-*-win-x64-portable.tar.gz'
  }

  if ($installer.Length -lt $MinInstallerBytes) {
    throw "Installer is too small: $($installer.Length) bytes"
  }

  if ($portable.Length -lt $MinPortableBytes) {
    throw "Portable package is too small: $($portable.Length) bytes"
  }

  [pscustomobject]@{
    status = 'ok'
    source = $Source
    sourceSizeBytes = $SourceSizeBytes
    installer = $installer.FullName
    installerSizeBytes = $installer.Length
    portable = $portable.FullName
    portableSizeBytes = $portable.Length
    entryCount = $entries.Count
  } | ConvertTo-Json -Depth 3
}

if ($artifactItem.PSIsContainer) {
  $entries = Get-ChildItem -LiteralPath $resolvedPath -Recurse -File
  Test-WindowsArtifactEntries -Entries $entries -Source $resolvedPath -SourceSizeBytes 0
  return
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($resolvedPath)

try {
  Test-WindowsArtifactEntries -Entries @($archive.Entries) -Source $resolvedPath -SourceSizeBytes $artifactItem.Length
}
finally {
  $archive.Dispose()
}
