param(
    [string]$Version = (Get-Date -Format "yyyyMMdd"),
    [string]$ReleaseRoot = (Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) "..\release"),
    [string]$SourceExe = (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "dist\SSH-Agent-Tool.exe"),
    [string]$UpdateCheckUrl = "",
    [string]$CurrentPackageUrl = "",
    [string]$ReleaseNotesUrl = "",
    [string]$SupportUrl = "",
    [switch]$SkipVerification,
    [switch]$SkipExeBuild
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PackageBuilder = Join-Path $ProjectRoot "build-windows-client-package.ps1"

Write-Host "Release package entry: building formal Windows client release package."
& $PackageBuilder @PSBoundParameters
