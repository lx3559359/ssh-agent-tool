param(
    [string]$Version = "dev"
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Resolve-ToolPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EnvironmentVariable,
        [Parameter(Mandatory = $true)]
        [string]$CommandName,
        [string]$FallbackPath = ""
    )

    $ConfiguredPath = [Environment]::GetEnvironmentVariable($EnvironmentVariable)
    if (-not [string]::IsNullOrWhiteSpace($ConfiguredPath)) {
        return $ConfiguredPath
    }

    $ResolvedCommand = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($ResolvedCommand -and $ResolvedCommand.Source) {
        return $ResolvedCommand.Source
    }

    if (-not [string]::IsNullOrWhiteSpace($FallbackPath)) {
        return $FallbackPath
    }

    return $CommandName
}

$DefaultRuntimeDependencies = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies"
$DefaultNodePath = Join-Path $DefaultRuntimeDependencies "node\bin"
$NodePath = Resolve-ToolPath -EnvironmentVariable "SSH_AGENT_NODE_BIN" -CommandName "node.exe" -FallbackPath $DefaultNodePath
if (Test-Path -LiteralPath $NodePath -PathType Leaf) {
    $NodePath = Split-Path -Parent $NodePath
}
if (Test-Path -LiteralPath $NodePath -PathType Container) {
    $env:Path = "$NodePath;$env:Path"
}

$Pnpm = Resolve-ToolPath -EnvironmentVariable "SSH_AGENT_PNPM" -CommandName "pnpm.cmd" -FallbackPath (Join-Path $DefaultRuntimeDependencies "bin\pnpm.cmd")
$PyInstaller = Resolve-ToolPath -EnvironmentVariable "SSH_AGENT_PYINSTALLER" -CommandName "pyinstaller.exe" -FallbackPath (Join-Path $ProjectRoot "..\winkterm\.venv\Scripts\pyinstaller.exe")
$ExePath = Join-Path $ProjectRoot "dist\SSH-Agent-Tool.exe"
$BuildInfoPath = Join-Path $ProjectRoot "build_info.py"
$WindowsVersionInfoPath = Join-Path $ProjectRoot "build\windows-version-info.txt"

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $Command $($Arguments -join ' ') (exit code $LASTEXITCODE)"
    }
}

function Stop-RunningReleaseExe {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetExePath
    )

    $FullTargetPath = [System.IO.Path]::GetFullPath($TargetExePath)
    $Processes = Get-CimInstance Win32_Process -Filter "Name = 'SSH-Agent-Tool.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.ExecutablePath -and
            ([System.IO.Path]::GetFullPath($_.ExecutablePath) -ieq $FullTargetPath) -and
            ($_.ProcessId -ne $PID)
        }

    foreach ($Process in $Processes) {
        Write-Host "Stopping stale release process: PID $($Process.ProcessId)"
        Stop-Process -Id $Process.ProcessId -Force -ErrorAction Stop
    }

    if ($Processes) {
        Start-Sleep -Milliseconds 500
    }
}

function Assert-WindowsGuiSubsystem {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetExePath
    )

    if (-not (Test-Path -LiteralPath $TargetExePath -PathType Leaf)) {
        throw "Build artifact not found: $TargetExePath"
    }

    $Bytes = [System.IO.File]::ReadAllBytes($TargetExePath)
    if ($Bytes.Length -lt 256) {
        throw "Invalid EXE file, cannot read Windows subsystem: $TargetExePath"
    }

    $PeOffset = [BitConverter]::ToInt32($Bytes, 0x3c)
    $Subsystem = [BitConverter]::ToUInt16($Bytes, $PeOffset + 24 + 68)
    if ($Subsystem -ne 2) {
        throw "EXE is not Windows GUI subsystem and may open a console window. Check PyInstaller spec console=False."
    }

    Write-Host "EXE subsystem check passed: Windows GUI"
}

function Write-EmbeddedBuildInfo {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BuildVersion
    )

    $SafeVersion = [regex]::Replace(([string]$BuildVersion).Trim(), "[^0-9A-Za-z._-]", "")
    if ([string]::IsNullOrWhiteSpace($SafeVersion)) {
        $SafeVersion = "dev"
    }
    $SafePackageName = if ($SafeVersion -eq "dev") { "" } else { "SSH-Agent-Tool-$SafeVersion" }
    $SafeGeneratedAt = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    $Content = @"
# Auto-generated embedded release metadata for standalone exe mode.
BUILD_VERSION = "$SafeVersion"
BUILD_PACKAGE_NAME = "$SafePackageName"
BUILD_UPDATE_CHANNEL = "stable"
BUILD_EXECUTABLE = "SSH-Agent-Tool.exe"
BUILD_GENERATED_AT = "$SafeGeneratedAt"
"@
    $Utf8Bom = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::WriteAllText($BuildInfoPath, $Content, $Utf8Bom)
}

function Convert-ToWindowsVersionTuple {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BuildVersion
    )

    $SafeVersion = ([string]$BuildVersion).Trim()
    if ($SafeVersion -match '^(\d{4})(\d{2})(\d{2})$') {
        $Major = [int]$Matches[1]
        $Minor = [int]$Matches[2]
        $Patch = [int]$Matches[3]
        return @{
            Tuple = "$Major, $Minor, $Patch, 0"
            String = "$Major.$Minor.$Patch.0"
        }
    }

    if ($SafeVersion -match '^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$') {
        $Major = [int]$Matches[1]
        $Minor = [int]$Matches[2]
        $Patch = [int]$Matches[3]
        $Build = if ($Matches[4]) { [int]$Matches[4] } else { 0 }
        return @{
            Tuple = "$Major, $Minor, $Patch, $Build"
            String = "$Major.$Minor.$Patch.$Build"
        }
    }

    return @{
        Tuple = "0, 0, 0, 0"
        String = "0.0.0.0"
    }
}

function Write-WindowsVersionInfo {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BuildVersion
    )

    $SafeVersion = [regex]::Replace(([string]$BuildVersion).Trim(), "[^0-9A-Za-z._-]", "")
    if ([string]::IsNullOrWhiteSpace($SafeVersion)) {
        $SafeVersion = "dev"
    }
    $VersionInfo = Convert-ToWindowsVersionTuple -BuildVersion $SafeVersion
    $BuildDir = Split-Path -Parent $WindowsVersionInfoPath
    New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null

$Content = @"
# UTF-8
# Use ASCII unicode escapes inside StringStruct values so PyInstaller can
# eval this file reliably on Windows PowerShell 5 environments.
VSVersionInfo(
  ffi=FixedFileInfo(
    filevers=($($VersionInfo.Tuple)),
    prodvers=($($VersionInfo.Tuple)),
    mask=0x3f,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
  ),
  kids=[
    StringFileInfo([
      StringTable(
        '040904B0',
        [
          StringStruct('CompanyName', 'SSH Agent Tool'),
          StringStruct('FileDescription', 'SSH Agent \u5de5\u5177 - Windows \u5ba2\u6237\u7aef'),
          StringStruct('FileVersion', '$($VersionInfo.String)'),
          StringStruct('InternalName', 'SSH-Agent-Tool'),
          StringStruct('LegalCopyright', 'Copyright (C) 2026 SSH Agent Tool'),
          StringStruct('OriginalFilename', 'SSH-Agent-Tool.exe'),
          StringStruct('ProductName', 'SSH Agent \u5de5\u5177'),
          StringStruct('ProductVersion', '$SafeVersion')
        ]
      )
    ]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"@
    $Utf8Bom = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::WriteAllText($WindowsVersionInfoPath, $Content, $Utf8Bom)
}

function Restore-DefaultBuildInfo {
    $Content = @"
# Default embedded release metadata. The release build script overwrites this
# file before PyInstaller builds the standalone executable.
BUILD_VERSION = "dev"
BUILD_PACKAGE_NAME = ""
BUILD_UPDATE_CHANNEL = "local"
BUILD_EXECUTABLE = "SSH-Agent-Tool.exe"
BUILD_GENERATED_AT = ""
"@
    $Utf8Bom = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::WriteAllText($BuildInfoPath, $Content, $Utf8Bom)
}

Push-Location $ProjectRoot
try {
    Stop-RunningReleaseExe $ExePath
    Write-EmbeddedBuildInfo -BuildVersion $Version
    Write-WindowsVersionInfo -BuildVersion $Version
    Invoke-CheckedCommand $Pnpm "build"
    Invoke-CheckedCommand $PyInstaller "--clean" "--noconfirm" "ssh-agent-ui-preview.spec"

    if (-not (Test-Path -LiteralPath $ExePath)) {
        throw "Build artifact not found: $ExePath"
    }

    Assert-WindowsGuiSubsystem $ExePath
    Write-Host "Build completed: $ExePath"
}
finally {
    Restore-DefaultBuildInfo
    Pop-Location
}
