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
$Python = Resolve-ToolPath -EnvironmentVariable "SSH_AGENT_PYTHON" -CommandName "python.exe" -FallbackPath (Join-Path $ProjectRoot "..\winkterm\.venv\Scripts\python.exe")
$BuildExeScript = Join-Path $ProjectRoot "build-windows-exe.ps1"
$WinktermRoot = Join-Path $ProjectRoot "..\winkterm"
$TerminalPytestTempRoot = Join-Path $ProjectRoot ".build-temp\winkterm-pytest-runs"
$TerminalPytestRunId = "run-{0}-{1}" -f (Get-Date -Format "yyyyMMddHHmmssfff"), $PID
$TerminalPytestTemp = Join-Path $TerminalPytestTempRoot $TerminalPytestRunId
$BasePackageName = "SSH-Agent-Tool-$Version"
$PackageName = $BasePackageName
$PackageDir = Join-Path $ReleaseRoot $PackageName
$PackageExe = Join-Path $PackageDir "SSH-Agent-Tool.exe"
$ReadmePath = Join-Path $PackageDir "使用说明.txt"
$PackageFingerprintPath = Join-Path $PackageDir "版本指纹.txt"
$PackageSupportTemplatePath = Join-Path $PackageDir "问题反馈模板.txt"
$PackageReadmeAliasPath = Join-Path $PackageDir "README.txt"
$PackageVersionAliasPath = Join-Path $PackageDir "VERSION.txt"
$PackageBugReportAliasPath = Join-Path $PackageDir "BUG_REPORT.txt"
$ManifestPath = Join-Path $PackageDir "manifest.json"
$PackageArchiveRoot = Join-Path $PackageDir "*"
$ZipPath = Join-Path $ReleaseRoot "SSH-Agent-Tool-$Version.zip"
$LatestManifestPath = Join-Path $ReleaseRoot "latest.json"
$ReleaseRootGuidePath = Join-Path $ReleaseRoot "请先打开这里.txt"
$LegacyCompatibilityClientDirs = @("当前正式版")
$PrimaryClientDir = Join-Path $ReleaseRoot "Windows客户端"
$PrimaryClientExePath = Join-Path $PrimaryClientDir "SSH-Agent-Tool.exe"
$PrimaryClientReadmePath = Join-Path $PrimaryClientDir "使用说明.txt"
$PrimaryClientFingerprintPath = Join-Path $PrimaryClientDir "版本指纹.txt"
$PrimaryClientSupportTemplatePath = Join-Path $PrimaryClientDir "问题反馈模板.txt"
$PrimaryClientManifestPath = Join-Path $PrimaryClientDir "manifest.json"
$PrimaryClientLatestManifestPath = Join-Path $PrimaryClientDir "latest.json"
$DeliveryDir = Join-Path $ReleaseRoot "用户交付"
$DeliveryExePath = Join-Path $DeliveryDir "SSH-Agent-Tool.exe"
$DeliveryReadmePath = Join-Path $DeliveryDir "使用说明.txt"
$DeliveryFingerprintPath = Join-Path $DeliveryDir "版本指纹.txt"
$DeliverySupportTemplatePath = Join-Path $DeliveryDir "问题反馈模板.txt"
$DeliveryManifestPath = Join-Path $DeliveryDir "manifest.json"
$DeliveryZipPath = Join-Path $DeliveryDir (Split-Path -Leaf $ZipPath)
$DeliveryLatestManifestPath = Join-Path $DeliveryDir "latest.json"
$PlainClientDir = Join-Path $ReleaseRoot "正式Windows客户端"
$PlainClientExePath = Join-Path $PlainClientDir "SSH-Agent-Tool.exe"
$PlainClientReadmePath = Join-Path $PlainClientDir "使用说明.txt"
$PlainClientFingerprintPath = Join-Path $PlainClientDir "版本指纹.txt"
$PlainClientSupportTemplatePath = Join-Path $PlainClientDir "问题反馈模板.txt"
$PlainClientManifestPath = Join-Path $PlainClientDir "manifest.json"
$PlainClientLatestManifestPath = Join-Path $PlainClientDir "latest.json"
$LatestClientDir = Join-Path $ReleaseRoot "最新版Windows客户端"
$LatestClientExePath = Join-Path $LatestClientDir "SSH-Agent-Tool.exe"
$LatestClientReadmePath = Join-Path $LatestClientDir "使用说明.txt"
$LatestClientFingerprintPath = Join-Path $LatestClientDir "版本指纹.txt"
$LatestClientSupportTemplatePath = Join-Path $LatestClientDir "问题反馈模板.txt"
$LatestClientManifestPath = Join-Path $LatestClientDir "manifest.json"
$LatestClientLatestManifestPath = Join-Path $LatestClientDir "latest.json"
$DirectRunClientDir = Join-Path $ReleaseRoot "可直接运行Windows客户端"
$DirectRunClientExePath = Join-Path $DirectRunClientDir "SSH-Agent-Tool.exe"
$DirectRunClientReadmePath = Join-Path $DirectRunClientDir "使用说明.txt"
$DirectRunClientFingerprintPath = Join-Path $DirectRunClientDir "版本指纹.txt"
$DirectRunClientSupportTemplatePath = Join-Path $DirectRunClientDir "问题反馈模板.txt"
$DirectRunClientReadmeAliasPath = Join-Path $DirectRunClientDir "README.txt"
$DirectRunClientVersionAliasPath = Join-Path $DirectRunClientDir "VERSION.txt"
$DirectRunClientBugReportAliasPath = Join-Path $DirectRunClientDir "BUG_REPORT.txt"
$DirectRunClientManifestPath = Join-Path $DirectRunClientDir "manifest.json"
$DirectRunClientLatestManifestPath = Join-Path $DirectRunClientDir "latest.json"
$DirectRunClientArchiveRoot = Join-Path $DirectRunClientDir "*"
$DirectRunClientZipPath = Join-Path $ReleaseRoot "可直接运行Windows客户端.zip"
$LatestDeliveryZipPath = Join-Path $ReleaseRoot "请发这个-最新版Windows客户端.zip"
$SendOnlyDir = Join-Path $ReleaseRoot "只发这个"
$SendOnlyZipPath = Join-Path $SendOnlyDir "请发这个-最新版Windows客户端.zip"
$SendOnlyChecksumPath = Join-Path $SendOnlyDir "SHA256校验.txt"
$SendOnlyGuidePath = Join-Path $SendOnlyDir "先看这里.txt"
$SendOnlyFingerprintPath = Join-Path $SendOnlyDir "版本指纹.txt"
$SendOnlySupportTemplatePath = Join-Path $SendOnlyDir "问题反馈模板.txt"
$SendOnlyReadmeAliasPath = Join-Path $SendOnlyDir "README.txt"
$SendOnlyVersionAliasPath = Join-Path $SendOnlyDir "VERSION.txt"
$SendOnlyBugReportAliasPath = Join-Path $SendOnlyDir "BUG_REPORT.txt"
$SendOnlyLatestManifestPath = Join-Path $SendOnlyDir "latest.json"
$OnlineUpdateDir = Join-Path $ReleaseRoot "在线更新发布"
$OnlineUpdateZipPath = Join-Path $OnlineUpdateDir (Split-Path -Leaf $ZipPath)
$OnlineUpdateLatestManifestPath = Join-Path $OnlineUpdateDir "latest.json"
$OnlineUpdateGuidePath = Join-Path $OnlineUpdateDir "在线更新发布说明.txt"
$StandardClientDir = Join-Path $ReleaseRoot "SSH-Agent-Windows-Client"
$StandardClientExePath = Join-Path $StandardClientDir "SSH-Agent-Tool.exe"
$StandardClientReadmePath = Join-Path $StandardClientDir "使用说明.txt"
$StandardClientFingerprintPath = Join-Path $StandardClientDir "版本指纹.txt"
$StandardClientSupportTemplatePath = Join-Path $StandardClientDir "问题反馈模板.txt"
$StandardClientReadmeAliasPath = Join-Path $StandardClientDir "README.txt"
$StandardClientVersionAliasPath = Join-Path $StandardClientDir "VERSION.txt"
$StandardClientBugReportAliasPath = Join-Path $StandardClientDir "BUG_REPORT.txt"
$StandardClientManifestPath = Join-Path $StandardClientDir "manifest.json"
$StandardClientLatestManifestPath = Join-Path $StandardClientDir "latest.json"
$StandardClientArchiveRoot = Join-Path $StandardClientDir "*"
$StandardClientZipPath = Join-Path $ReleaseRoot "SSH-Agent-Windows-Client.zip"

if ([string]::IsNullOrWhiteSpace($UpdateCheckUrl) -and -not [string]::IsNullOrWhiteSpace($env:SSH_AGENT_UPDATE_CHECK_URL)) {
    $UpdateCheckUrl = $env:SSH_AGENT_UPDATE_CHECK_URL
}
if ([string]::IsNullOrWhiteSpace($CurrentPackageUrl) -and -not [string]::IsNullOrWhiteSpace($env:SSH_AGENT_PACKAGE_URL)) {
    $CurrentPackageUrl = $env:SSH_AGENT_PACKAGE_URL
}
if ([string]::IsNullOrWhiteSpace($ReleaseNotesUrl) -and -not [string]::IsNullOrWhiteSpace($env:SSH_AGENT_RELEASE_NOTES_URL)) {
    $ReleaseNotesUrl = $env:SSH_AGENT_RELEASE_NOTES_URL
}
if ([string]::IsNullOrWhiteSpace($SupportUrl) -and -not [string]::IsNullOrWhiteSpace($env:SSH_AGENT_SUPPORT_URL)) {
    $SupportUrl = $env:SSH_AGENT_SUPPORT_URL
}

function Assert-ChildPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Parent,
        [Parameter(Mandatory = $true)]
        [string]$Child
    )

    $ParentFull = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    $ChildFull = [System.IO.Path]::GetFullPath($Child)
    if (-not $ChildFull.StartsWith($ParentFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "路径安全检查失败：$ChildFull 不在 $ParentFull 内。"
    }
}

function Write-Utf8File {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Content
    )

    $Utf8Bom = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::WriteAllText($Path, $Content, $Utf8Bom)
}

function Assert-ReleasePythonReady {
    if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
        throw "未找到发布验证 Python：$Python。请先初始化 apps\winkterm\.venv，或使用项目约定的 Python 环境后再打包。"
    }
}

function Get-WindowsPeSubsystem {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $Bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($Bytes.Length -lt 0x100) {
        throw "PE 文件过小，无法读取子系统：$Path"
    }

    $PeHeaderOffset = [BitConverter]::ToInt32($Bytes, 0x3c)
    $SubsystemOffset = $PeHeaderOffset + 24 + 68
    if ($SubsystemOffset + 2 -gt $Bytes.Length) {
        throw "PE 文件头不完整，无法读取子系统：$Path"
    }

    return [BitConverter]::ToUInt16($Bytes, $SubsystemOffset)
}

function Test-FrontendLucideIconImports {
    param(
        [Parameter(Mandatory = $true)]
        [string]$AppContent
    )

    $LucideImportMatch = [regex]::Match($AppContent, 'import\s*\{(?<imports>[^}]*)\}\s*from\s+"lucide-react"')
    if (-not $LucideImportMatch.Success) {
        throw "前端运行时自检失败：未找到 lucide-react 图标导入。"
    }

    $LucideImports = New-Object "System.Collections.Generic.HashSet[string]"
    foreach ($ImportName in ($LucideImportMatch.Groups["imports"].Value -split ",")) {
        $CleanName = ($ImportName -replace "//.*", "" -replace "\s+as\s+.*$", "").Trim()
        if (-not [string]::IsNullOrWhiteSpace($CleanName)) {
            [void]$LucideImports.Add($CleanName)
        }
    }

    $LocalComponents = New-Object "System.Collections.Generic.HashSet[string]"
    foreach ($Match in [regex]::Matches($AppContent, '(?:^|\s)(?:function|const)\s+([A-Z][A-Za-z0-9_]*)\b')) {
        [void]$LocalComponents.Add($Match.Groups[1].Value)
    }

    $MissingIcons = New-Object "System.Collections.Generic.HashSet[string]"
    foreach ($Match in [regex]::Matches($AppContent, '<([A-Z][A-Za-z0-9_]*)')) {
        $IconName = $Match.Groups[1].Value
        if (-not $LocalComponents.Contains($IconName) -and -not $LucideImports.Contains($IconName)) {
            [void]$MissingIcons.Add($IconName)
        }
    }

    if ($MissingIcons.Count -gt 0) {
        $Names = @($MissingIcons) | Sort-Object
        throw "前端运行时自检失败：JSX 使用了未导入的 lucide 图标：$($Names -join ', ')。请先补充导入再打包。"
    }
}

function Test-FrontendBundleRuntimeSafety {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptPath,
        [Parameter(Mandatory = $true)]
        [string]$ScriptName
    )

    $BlockedScriptNames = @(
        "index-C55DkVKK.js",
        "index-BCGy_mkD.js"
    )
    if ($BlockedScriptNames -contains $ScriptName) {
        throw "前端运行时自检失败，检测到已知白屏旧资源：$ScriptName。请重新构建正式 Windows 客户端。"
    }

    $AppPath = Join-Path $ProjectRoot "src\App.jsx"
    if (-not (Test-Path -LiteralPath $AppPath -PathType Leaf)) {
        throw "前端运行时自检失败，缺少 src\App.jsx。"
    }

    $AppContent = Get-Content -LiteralPath $AppPath -Raw
    Test-FrontendLucideIconImports -AppContent $AppContent

    # ensure source declares function exportConnectionCheckReport before packaging
    if ($AppContent -notmatch 'async\s+function\s+exportConnectionCheckReport\s*\(') {
        throw "前端运行时自检失败，连接校验报告导出处理器未定义。"
    }
    if ($AppContent -notmatch 'onExportConnectionCheckReport=\{exportConnectionCheckReport\}') {
        throw "前端运行时自检失败，连接校验报告导出入口未绑定到处理器。"
    }

    $ScriptContent = Get-Content -LiteralPath $ScriptPath -Raw
    if ($ScriptContent -notmatch 'onExportConnectionCheckReport') {
        throw "前端运行时自检失败，构建产物缺少连接校验报告导出入口。"
    }
}

function Get-FrontendAssetFingerprint {
    $IndexPath = Join-Path $ProjectRoot "dist\index.html"
    if (-not (Test-Path -LiteralPath $IndexPath -PathType Leaf)) {
        throw "前端资产自检失败，缺少 dist\index.html。"
    }

    $IndexContent = Get-Content -LiteralPath $IndexPath -Raw
    $ScriptMatch = [regex]::Match($IndexContent, 'src="\./assets/([^"]+\.js)"')
    $StylesheetMatch = [regex]::Match($IndexContent, 'href="\./assets/([^"]+\.css)"')
    if (-not $ScriptMatch.Success) {
        throw "前端资产自检失败，index.html 中未找到主 JS 入口。"
    }
    if (-not $StylesheetMatch.Success) {
        throw "前端资产自检失败，index.html 中未找到主 CSS 入口。"
    }

    $ScriptName = $ScriptMatch.Groups[1].Value
    $StylesheetName = $StylesheetMatch.Groups[1].Value
    $ScriptPath = Join-Path $ProjectRoot ("dist\assets\" + $ScriptName)
    $StylesheetPath = Join-Path $ProjectRoot ("dist\assets\" + $StylesheetName)
    if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) {
        throw "前端资产自检失败，缺少主 JS 文件：$ScriptPath"
    }
    if (-not (Test-Path -LiteralPath $StylesheetPath -PathType Leaf)) {
        throw "前端资产自检失败，缺少主 CSS 文件：$StylesheetPath"
    }

    Test-FrontendBundleRuntimeSafety -ScriptPath $ScriptPath -ScriptName $ScriptName

    $IndexItem = Get-Item -LiteralPath $IndexPath
    $ScriptItem = Get-Item -LiteralPath $ScriptPath
    $StylesheetItem = Get-Item -LiteralPath $StylesheetPath
    return [ordered]@{
        ok = $true
        indexHtml = "dist/index.html"
        indexSha256 = (Get-FileHash -LiteralPath $IndexPath -Algorithm SHA256).Hash
        indexSizeBytes = $IndexItem.Length
        script = "assets/$ScriptName"
        scriptSha256 = (Get-FileHash -LiteralPath $ScriptPath -Algorithm SHA256).Hash
        scriptSizeBytes = $ScriptItem.Length
        stylesheet = "assets/$StylesheetName"
        stylesheetSha256 = (Get-FileHash -LiteralPath $StylesheetPath -Algorithm SHA256).Hash
        stylesheetSizeBytes = $StylesheetItem.Length
        message = "frontend assets verified"
    }
}

function Set-ReleasePackagePaths {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ResolvedPackageName
    )

    $script:PackageName = $ResolvedPackageName
    $script:PackageDir = Join-Path $ReleaseRoot $script:PackageName
    $script:PackageExe = Join-Path $script:PackageDir "SSH-Agent-Tool.exe"
    $script:ReadmePath = Join-Path $script:PackageDir "使用说明.txt"
    $script:PackageFingerprintPath = Join-Path $script:PackageDir "版本指纹.txt"
    $script:PackageSupportTemplatePath = Join-Path $script:PackageDir "问题反馈模板.txt"
    $script:PackageReadmeAliasPath = Join-Path $script:PackageDir "README.txt"
    $script:PackageVersionAliasPath = Join-Path $script:PackageDir "VERSION.txt"
    $script:PackageBugReportAliasPath = Join-Path $script:PackageDir "BUG_REPORT.txt"
    $script:ManifestPath = Join-Path $script:PackageDir "manifest.json"
    $script:PackageArchiveRoot = Join-Path $script:PackageDir "*"
    $script:ZipPath = Join-Path $ReleaseRoot "$script:PackageName.zip"
    $script:DeliveryZipPath = Join-Path $DeliveryDir (Split-Path -Leaf $script:ZipPath)
}

function Resolve-AvailablePackageName {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BasePackageName
    )

    for ($Suffix = 2; $Suffix -le 99; $Suffix++) {
        $CandidateName = "$BasePackageName-$Suffix"
        $CandidateDir = Join-Path $ReleaseRoot $CandidateName
        $CandidateZip = Join-Path $ReleaseRoot "$CandidateName.zip"
        if ((-not (Test-Path -LiteralPath $CandidateDir)) -and (-not (Test-Path -LiteralPath $CandidateZip))) {
            return $CandidateName
        }
    }

    throw "无法找到可用的正式版打包目录，请清理 release 目录后重试。"
}

function Resolve-CurrentPackageUrlFromUpdateCheckUrl {
    param(
        [string]$UpdateCheckUrl,
        [string]$PackageFileName
    )

    $SafeUpdateCheckUrl = [string]$UpdateCheckUrl
    $SafePackageFileName = [System.IO.Path]::GetFileName([string]$PackageFileName)
    if ([string]::IsNullOrWhiteSpace($SafeUpdateCheckUrl) -or [string]::IsNullOrWhiteSpace($SafePackageFileName)) {
        return ""
    }

    try {
        $Uri = [System.Uri]::new($SafeUpdateCheckUrl)
        if (-not $Uri.IsAbsoluteUri -or (($Uri.Scheme -ne "http") -and ($Uri.Scheme -ne "https"))) {
            return ""
        }

        $DirectoryPath = [string]$Uri.AbsolutePath
        $LastSlash = $DirectoryPath.LastIndexOf("/")
        $BasePath = if ($LastSlash -ge 0) { $DirectoryPath.Substring(0, $LastSlash + 1) } else { "/" }
        if ([string]::IsNullOrWhiteSpace($BasePath)) {
            $BasePath = "/"
        }

        $Builder = [System.UriBuilder]::new($Uri)
        $Builder.Path = $BasePath + [System.Uri]::EscapeDataString($SafePackageFileName)
        $Builder.Query = ""
        $Builder.Fragment = ""
        return $Builder.Uri.AbsoluteUri
    }
    catch {
        return ""
    }
}

function Stop-RunningReleaseExe {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetExePath
    )

    $FullTargetPath = [System.IO.Path]::GetFullPath($TargetExePath)
    $CimProcesses = Get-CimInstance Win32_Process -Filter "Name = 'SSH-Agent-Tool.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.ExecutablePath -and
            ([System.IO.Path]::GetFullPath($_.ExecutablePath) -ieq $FullTargetPath) -and
            ($_.ProcessId -ne $PID)
        }

    $Processes = @()
    foreach ($Process in $CimProcesses) {
        $Processes += [pscustomobject][ordered]@{
            Id = [int]$Process.ProcessId
            Path = $Process.ExecutablePath
        }
    }

    Get-Process SSH-Agent-Tool -ErrorAction SilentlyContinue |
        Where-Object {
            try {
                $_.Path -and
                ([System.IO.Path]::GetFullPath($_.Path) -ieq $FullTargetPath) -and
                ($_.Id -ne $PID)
            }
            catch {
                $false
            }
        } |
        ForEach-Object {
            $Processes += [pscustomobject][ordered]@{
                Id = [int]$_.Id
                Path = $_.Path
            }
        }

    $Processes = @($Processes | Sort-Object Id -Unique)

    if (-not $Processes -and (Test-Path -LiteralPath $TargetExePath)) {
        $NameFallbackProcesses = @(Get-Process SSH-Agent-Tool -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID })
        if ($NameFallbackProcesses.Count -gt 0) {
            Write-Host "无法读取旧正式版进程路径，正在按进程名兜底关闭 SSH-Agent-Tool。"
            foreach ($Process in $NameFallbackProcesses) {
                try {
                    Stop-Process -Id $Process.Id -Force -ErrorAction Stop
                }
                catch {
                    Write-Host "旧正式版进程 PID $($Process.Id) 无法由当前权限关闭，将在打包时尝试使用新的递增目录。"
                }
            }
            Start-Sleep -Milliseconds 1600
            return
        }
    }

    foreach ($Process in $Processes) {
        Write-Host "检测到旧正式版进程，正在关闭：PID $($Process.Id)"
        Stop-Process -Id $Process.Id -Force -ErrorAction Stop
    }

    if ($Processes) {
        foreach ($Process in $Processes) {
            Wait-Process -Id $Process.Id -Timeout 8 -ErrorAction SilentlyContinue
        }
        Start-Sleep -Milliseconds 800
    }
}

function Invoke-WithRetry {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action,
        [int]$Attempts = 5,
        [int]$DelayMilliseconds = 800
    )

    for ($Attempt = 1; $Attempt -le $Attempts; $Attempt++) {
        try {
            & $Action
            return
        }
        catch {
            if ($Attempt -eq $Attempts) {
                throw
            }
            Start-Sleep -Milliseconds $DelayMilliseconds
        }
    }
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [string]$WorkingDirectory = $ProjectRoot
    )

    Push-Location $WorkingDirectory
    try {
        & $Command @Arguments | ForEach-Object { Write-Host $_ }
        $ExitCode = $LASTEXITCODE
        if ($ExitCode -ne 0) {
            throw "命令执行失败：$Command $($Arguments -join ' ') (exit code $ExitCode)"
        }
    }
    finally {
        Pop-Location
    }
}

function Invoke-VerificationStep {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$CommandText,
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [string]$WorkingDirectory = $ProjectRoot
    )

    $StartedAt = Get-Date
    Write-Host "正在执行构建验证：$Name"
    Invoke-CheckedCommand -Command $Command -Arguments $Arguments -WorkingDirectory $WorkingDirectory
    $FinishedAt = Get-Date
    return [ordered]@{
        name = $Name
        command = $CommandText
        status = "passed"
        result = "通过"
        finishedAt = $FinishedAt.ToString("yyyy-MM-dd HH:mm:ss")
        durationSeconds = [Math]::Round(($FinishedAt - $StartedAt).TotalSeconds, 2)
    }
}

function Invoke-ReleaseVerification {
    if ($SkipVerification) {
        return @(
            [ordered]@{
                name = "构建验证"
                command = "build-release-package.ps1 -SkipVerification"
                status = "skipped"
                result = "已跳过"
                finishedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                durationSeconds = 0
            }
        )
    }

    if (-not (Test-Path -LiteralPath $Pnpm)) {
        throw "未找到 pnpm：$Pnpm"
    }
    Assert-ReleasePythonReady
    New-Item -ItemType Directory -Force -Path $TerminalPytestTemp | Out-Null

    return @(
        (Invoke-VerificationStep -Name "前端发布门禁" -CommandText "pnpm run test:release" -Command $Pnpm -Arguments @("run", "test:release") -WorkingDirectory $ProjectRoot),
        (Invoke-VerificationStep -Name "Python 中文扫描" -CommandText "python -m unittest test_python_localization.py" -Command $Python -Arguments @("-m", "unittest", "test_python_localization.py") -WorkingDirectory $ProjectRoot),
        (Invoke-VerificationStep -Name "SSH 协议自检" -CommandText "python -m unittest test_desktop_ssh_protocol_smoke.py" -Command $Python -Arguments @("-m", "unittest", "test_desktop_ssh_protocol_smoke.py") -WorkingDirectory $ProjectRoot),
        (Invoke-VerificationStep -Name "SFTP 协议自检" -CommandText "python -m unittest test_desktop_sftp_protocol_smoke.py" -Command $Python -Arguments @("-m", "unittest", "test_desktop_sftp_protocol_smoke.py") -WorkingDirectory $ProjectRoot),
        (Invoke-VerificationStep -Name "后端桥接测试" -CommandText "python -m unittest discover -s . -p test_*.py" -Command $Python -Arguments @("-m", "unittest", "discover", "-s", ".", "-p", "test_*.py") -WorkingDirectory $ProjectRoot),
        (Invoke-VerificationStep -Name "终端内核测试" -CommandText "python -m pytest" -Command $Python -Arguments @("-m", "pytest", "--basetemp", $TerminalPytestTemp, "-p", "no:cacheprovider") -WorkingDirectory $WinktermRoot)
    )
}

function Convert-ToPublicVerification {
    param(
        [object[]]$Verification
    )

    return @(
        $Verification | ForEach-Object {
            [ordered]@{
                name = $_.name
                status = $_.status
                result = $_.result
                finishedAt = $_.finishedAt
                durationSeconds = $_.durationSeconds
            }
        }
    )
}

function Invoke-WindowsExeBuild {
    if ($SkipExeBuild) {
        Write-Host "已跳过 EXE 重建，将使用现有文件：$SourceExe"
        return
    }

    if (-not (Test-Path -LiteralPath $BuildExeScript)) {
        throw "未找到 EXE 构建脚本：$BuildExeScript"
    }

    Write-Host "正在重建 Windows EXE，确保正式包包含最新前端和后端代码。"
    Invoke-CheckedCommand -Command "powershell" -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $BuildExeScript, "-Version", $Version) -WorkingDirectory $ProjectRoot
}

function Test-ZipStartupSmoke {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ZipPath,
        [Parameter(Mandatory = $true)]
        $ManifestData,
        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    $SmokeRoot = Join-Path $ProjectRoot ".build-temp\zip-startup-smoke"
    $ExtractRoot = Join-Path $SmokeRoot ("extract-{0}-{1}" -f (Get-Date -Format "yyyyMMddHHmmssfff"), $PID)
    $SmokePath = Join-Path $SmokeRoot ("startup-smoke-{0}-{1}.json" -f (Get-Date -Format "yyyyMMddHHmmssfff"), $PID)
    Assert-ChildPath -Parent $ProjectRoot -Child $SmokeRoot
    Assert-ChildPath -Parent $SmokeRoot -Child $ExtractRoot
    Assert-ChildPath -Parent $SmokeRoot -Child $SmokePath

    try {
        New-Item -ItemType Directory -Force -Path $ExtractRoot | Out-Null
        Expand-Archive -LiteralPath $ZipPath -DestinationPath $ExtractRoot -Force
        $ExtractedExe = Join-Path $ExtractRoot "SSH-Agent-Tool.exe"
        if (-not (Test-Path -LiteralPath $ExtractedExe -PathType Leaf)) {
            throw "发布包自检失败，$Label 解压后根目录缺少 SSH-Agent-Tool.exe。"
        }

        $ZipStartupSmokeProcess = Start-Process -FilePath $ExtractedExe -ArgumentList @("--startup-smoke", "--smoke-output", $SmokePath) -WorkingDirectory $ExtractRoot -WindowStyle Hidden -PassThru -Wait
        if ($ZipStartupSmokeProcess.ExitCode -ne 0) {
            throw "发布包自检失败，$Label 解压后启动冒烟检查退出码异常：$($ZipStartupSmokeProcess.ExitCode)"
        }
        if (-not (Test-Path -LiteralPath $SmokePath -PathType Leaf)) {
            throw "发布包自检失败，$Label 解压后启动冒烟检查没有生成报告。"
        }

        $ZipStartupSmoke = Get-Content -LiteralPath $SmokePath -Raw | ConvertFrom-Json
        if (-not $ZipStartupSmoke.ok) {
            throw "发布包自检失败，$Label 解压后启动冒烟检查未通过。"
        }
        if ($ZipStartupSmoke.version -ne $ManifestData.version) {
            throw "发布包自检失败，$Label 解压后启动版本与 manifest 不一致。"
        }
        if ($ZipStartupSmoke.packageName -ne $ManifestData.packageName) {
            throw "发布包自检失败，$Label 解压后启动包名与 manifest 不一致。"
        }
        if (-not $ZipStartupSmoke.frontendAssets) {
            throw "发布包自检失败，$Label 解压后启动冒烟报告缺少前端资产指纹。"
        }
        if (-not $ZipStartupSmoke.startupIdentity) {
            throw "发布包自检失败，$Label 解压后启动冒烟报告缺少启动身份诊断。"
        }
        if ($ZipStartupSmoke.startupIdentity.frontendMatchesManifest -ne $true) {
            throw "发布包自检失败，$Label 解压后启动前端资源与 manifest 不一致。"
        }
        if (-not $ZipStartupSmoke.clientEntry) {
            throw "发布包自检失败，$Label 解压后启动冒烟报告缺少客户端入口诊断。"
        }
        if ($ZipStartupSmoke.clientEntry.ok -eq $false) {
            throw "发布包自检失败，$Label 解压后客户端入口诊断未通过：$($ZipStartupSmoke.clientEntry.message)"
        }
        if ($ZipStartupSmoke.frontendAssets.scriptSha256 -ne $ManifestData.frontendAssets.scriptSha256) {
            throw "发布包自检失败，$Label 解压后 EXE 内置主 JS 与 manifest 不一致。"
        }
        if ($ZipStartupSmoke.frontendAssets.stylesheetSha256 -ne $ManifestData.frontendAssets.stylesheetSha256) {
            throw "发布包自检失败，$Label 解压后 EXE 内置主 CSS 与 manifest 不一致。"
        }
    }
    finally {
        if (Test-Path -LiteralPath $SmokePath) {
            Remove-Item -LiteralPath $SmokePath -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path -LiteralPath $ExtractRoot) {
            Remove-Item -LiteralPath $ExtractRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Invoke-PackageSmokeCheck {
    if (-not (Test-Path -LiteralPath $PackageExe)) {
        throw "发布包自检失败，缺少 EXE：$PackageExe"
    }

    $RequiredFiles = @(
        $PackageExe,
        $ReadmePath,
        $PackageFingerprintPath,
        $PackageSupportTemplatePath,
        $ManifestPath,
        $ZipPath,
        $LatestManifestPath,
        $ReleaseRootGuidePath,
        $PrimaryClientExePath,
        $PrimaryClientReadmePath,
        $PrimaryClientFingerprintPath,
        $PrimaryClientSupportTemplatePath,
        $PrimaryClientManifestPath,
        $PrimaryClientLatestManifestPath,
        $DeliveryExePath,
        $DeliveryReadmePath,
        $DeliveryFingerprintPath,
        $DeliverySupportTemplatePath,
        $DeliveryManifestPath,
        $DeliveryZipPath,
        $DeliveryLatestManifestPath,
        $PlainClientExePath,
        $PlainClientReadmePath,
        $PlainClientFingerprintPath,
        $PlainClientSupportTemplatePath,
        $PlainClientManifestPath,
        $PlainClientLatestManifestPath,
        $LatestClientExePath,
        $LatestClientReadmePath,
        $LatestClientFingerprintPath,
        $LatestClientSupportTemplatePath,
        $LatestClientManifestPath,
        $LatestClientLatestManifestPath,
        $DirectRunClientExePath,
        $DirectRunClientReadmePath,
        $DirectRunClientFingerprintPath,
        $DirectRunClientSupportTemplatePath,
        $DirectRunClientManifestPath,
        $DirectRunClientLatestManifestPath,
        $DirectRunClientZipPath,
        $SendOnlyZipPath,
        $SendOnlyChecksumPath,
        $SendOnlyGuidePath,
        $SendOnlyFingerprintPath,
        $SendOnlySupportTemplatePath,
        $SendOnlyLatestManifestPath,
        $OnlineUpdateZipPath,
        $OnlineUpdateLatestManifestPath,
        $OnlineUpdateGuidePath,
        $StandardClientExePath,
        $StandardClientReadmePath,
        $StandardClientFingerprintPath,
        $StandardClientSupportTemplatePath,
        $StandardClientManifestPath,
        $StandardClientLatestManifestPath,
        $StandardClientZipPath
    )

    foreach ($RequiredFile in $RequiredFiles) {
        if (-not (Test-Path -LiteralPath $RequiredFile)) {
            throw "发布包自检失败，缺少文件：$RequiredFile"
        }
    }

    # NoBatchLaunchersInFormalPackage: this is an EXE-first Windows client package.
    $BlockedLauncherExtensions = @(".bat", ".cmd", ".ps1", ".psm1")
    $PackagedCommandLineLaunchers = @(Get-ChildItem -LiteralPath $PackageDir -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $BlockedLauncherExtensions -contains $_.Extension.ToLowerInvariant() })
    if ($PackagedCommandLineLaunchers) {
        throw "发布包自检失败，正式 Windows 客户端包不应包含命令行启动入口：$($PackagedCommandLineLaunchers.FullName -join ', ')"
    }
    $PrimaryClientCommandLineLaunchers = @(Get-ChildItem -LiteralPath $PrimaryClientDir -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $BlockedLauncherExtensions -contains $_.Extension.ToLowerInvariant() })
    if ($PrimaryClientCommandLineLaunchers) {
        throw "发布包自检失败，Windows 客户端目录不应包含命令行启动入口：$($PrimaryClientCommandLineLaunchers.FullName -join ', ')"
    }
    $DeliveryCommandLineLaunchers = @(Get-ChildItem -LiteralPath $DeliveryDir -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $BlockedLauncherExtensions -contains $_.Extension.ToLowerInvariant() })
    if ($DeliveryCommandLineLaunchers) {
        throw "发布包自检失败，用户交付目录不应包含命令行启动入口：$($DeliveryCommandLineLaunchers.FullName -join ', ')"
    }
    $PlainClientCommandLineLaunchers = @(Get-ChildItem -LiteralPath $PlainClientDir -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $BlockedLauncherExtensions -contains $_.Extension.ToLowerInvariant() })
    if ($PlainClientCommandLineLaunchers) {
        throw "发布包自检失败，正式 Windows 客户端目录不应包含命令行启动入口：$($PlainClientCommandLineLaunchers.FullName -join ', ')"
    }
    $LatestClientCommandLineLaunchers = @(Get-ChildItem -LiteralPath $LatestClientDir -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $BlockedLauncherExtensions -contains $_.Extension.ToLowerInvariant() })
    if ($LatestClientCommandLineLaunchers) {
        throw "发布包自检失败，最新版 Windows 客户端目录不应包含命令行启动入口：$($LatestClientCommandLineLaunchers.FullName -join ', ')"
    }
    $DirectRunClientCommandLineLaunchers = @(Get-ChildItem -LiteralPath $DirectRunClientDir -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $BlockedLauncherExtensions -contains $_.Extension.ToLowerInvariant() })
    if ($DirectRunClientCommandLineLaunchers) {
        throw "发布包自检失败，可直接运行 Windows 客户端目录不应包含命令行启动入口：$($DirectRunClientCommandLineLaunchers.FullName -join ', ')"
    }
    $StandardClientCommandLineLaunchers = @(Get-ChildItem -LiteralPath $StandardClientDir -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $BlockedLauncherExtensions -contains $_.Extension.ToLowerInvariant() })
    if ($StandardClientCommandLineLaunchers) {
        throw "发布包自检失败，标准 Windows 客户端目录不应包含命令行启动入口：$($StandardClientCommandLineLaunchers.FullName -join ', ')"
    }
    $SendOnlyCommandLineLaunchers = @(Get-ChildItem -LiteralPath $SendOnlyDir -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $BlockedLauncherExtensions -contains $_.Extension.ToLowerInvariant() })
    if ($SendOnlyCommandLineLaunchers) {
        throw "发布包自检失败，只发这个目录不应包含命令行启动入口：$($SendOnlyCommandLineLaunchers.FullName -join ', ')"
    }
    $SendOnlyHistoricalPackages = @(Get-ChildItem -LiteralPath $SendOnlyDir -File -ErrorAction SilentlyContinue |
        Where-Object { ($_.Name -match '^SSH-Agent-Tool-\d') -or ($_.Name -match 'Preview') })
    if ($SendOnlyHistoricalPackages) {
        throw "发布包自检失败，只发这个目录不应包含历史版本文件：$($SendOnlyHistoricalPackages.Name -join ', ')"
    }
    $OnlineUpdateAllowedNames = @(
        (Split-Path -Leaf $OnlineUpdateZipPath),
        "latest.json",
        "在线更新发布说明.txt"
    )
    $OnlineUpdateUnexpectedFiles = @(Get-ChildItem -LiteralPath $OnlineUpdateDir -File -ErrorAction SilentlyContinue |
        Where-Object { $OnlineUpdateAllowedNames -notcontains $_.Name })
    if ($OnlineUpdateUnexpectedFiles) {
        throw "发布包自检失败，在线更新发布目录只能包含 ZIP、latest.json 和说明：$($OnlineUpdateUnexpectedFiles.Name -join ', ')"
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $ZipArchive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $ZipRootExeEntry = $ZipArchive.Entries | Where-Object { $_.FullName -eq "SSH-Agent-Tool.exe" }
        if (-not $ZipRootExeEntry) {
            throw "发布包自检失败，ZIP 根目录缺少 SSH-Agent-Tool.exe，解压后不能直接运行。"
        }
        $ZipFingerprintEntry = $ZipArchive.Entries | Where-Object { $_.FullName -eq "版本指纹.txt" }
        if (-not $ZipFingerprintEntry) {
            throw "发布包自检失败，ZIP 根目录缺少解压目录内版本指纹。"
        }
        $ZipSupportTemplateEntry = $ZipArchive.Entries | Where-Object { $_.FullName -eq "问题反馈模板.txt" }
        if (-not $ZipSupportTemplateEntry) {
            throw "发布包自检失败，ZIP 根目录缺少问题反馈模板。"
        }
        $ZipReadmeAliasEntry = $ZipArchive.Entries | Where-Object { $_.FullName -eq "README.txt" }
        if (-not $ZipReadmeAliasEntry) {
            throw "发布包自检失败，ZIP 根目录缺少 README.txt。"
        }
        $ZipVersionAliasEntry = $ZipArchive.Entries | Where-Object { $_.FullName -eq "VERSION.txt" }
        if (-not $ZipVersionAliasEntry) {
            throw "发布包自检失败，ZIP 根目录缺少 VERSION.txt。"
        }
        $ZipBugReportAliasEntry = $ZipArchive.Entries | Where-Object { $_.FullName -eq "BUG_REPORT.txt" }
        if (-not $ZipBugReportAliasEntry) {
            throw "发布包自检失败，ZIP 根目录缺少 BUG_REPORT.txt。"
        }
        $ZipCommandLineLaunchers = @($ZipArchive.Entries | Where-Object { $BlockedLauncherExtensions -contains [System.IO.Path]::GetExtension($_.FullName).ToLowerInvariant() })
        if ($ZipCommandLineLaunchers) {
            throw "发布包自检失败，ZIP 内不应包含命令行启动入口：$($ZipCommandLineLaunchers.FullName -join ', ')"
        }
    }
    finally {
        $ZipArchive.Dispose()
    }
    $DirectRunZipArchive = [System.IO.Compression.ZipFile]::OpenRead($DirectRunClientZipPath)
    try {
        $DirectRunZipRootExeEntry = $DirectRunZipArchive.Entries | Where-Object { $_.FullName -eq "SSH-Agent-Tool.exe" }
        if (-not $DirectRunZipRootExeEntry) {
            throw "发布包自检失败，可直接运行 Windows 客户端 ZIP 根目录缺少 SSH-Agent-Tool.exe。"
        }
        $DirectRunZipFingerprintEntry = $DirectRunZipArchive.Entries | Where-Object { $_.FullName -eq "版本指纹.txt" }
        if (-not $DirectRunZipFingerprintEntry) {
            throw "发布包自检失败，可直接运行 Windows 客户端 ZIP 根目录缺少解压目录内版本指纹。"
        }
        $DirectRunZipSupportTemplateEntry = $DirectRunZipArchive.Entries | Where-Object { $_.FullName -eq "问题反馈模板.txt" }
        if (-not $DirectRunZipSupportTemplateEntry) {
            throw "发布包自检失败，可直接运行 Windows 客户端 ZIP 根目录缺少问题反馈模板。"
        }
        $DirectRunZipReadmeAliasEntry = $DirectRunZipArchive.Entries | Where-Object { $_.FullName -eq "README.txt" }
        if (-not $DirectRunZipReadmeAliasEntry) {
            throw "发布包自检失败，可直接运行 Windows 客户端 ZIP 根目录缺少 README.txt。"
        }
        $DirectRunZipVersionAliasEntry = $DirectRunZipArchive.Entries | Where-Object { $_.FullName -eq "VERSION.txt" }
        if (-not $DirectRunZipVersionAliasEntry) {
            throw "发布包自检失败，可直接运行 Windows 客户端 ZIP 根目录缺少 VERSION.txt。"
        }
        $DirectRunZipBugReportAliasEntry = $DirectRunZipArchive.Entries | Where-Object { $_.FullName -eq "BUG_REPORT.txt" }
        if (-not $DirectRunZipBugReportAliasEntry) {
            throw "发布包自检失败，可直接运行 Windows 客户端 ZIP 根目录缺少 BUG_REPORT.txt。"
        }
        $DirectRunZipCommandLineLaunchers = @($DirectRunZipArchive.Entries | Where-Object { $BlockedLauncherExtensions -contains [System.IO.Path]::GetExtension($_.FullName).ToLowerInvariant() })
        if ($DirectRunZipCommandLineLaunchers) {
            throw "发布包自检失败，可直接运行 Windows 客户端 ZIP 内不应包含命令行启动入口：$($DirectRunZipCommandLineLaunchers.FullName -join ', ')"
        }
    }
    finally {
        $DirectRunZipArchive.Dispose()
    }
    $StandardZipArchive = [System.IO.Compression.ZipFile]::OpenRead($StandardClientZipPath)
    try {
        $StandardZipRootExeEntry = $StandardZipArchive.Entries | Where-Object { $_.FullName -eq "SSH-Agent-Tool.exe" }
        if (-not $StandardZipRootExeEntry) {
            throw "发布包自检失败，标准 Windows 客户端 ZIP 根目录缺少 SSH-Agent-Tool.exe。"
        }
        $StandardZipFingerprintEntry = $StandardZipArchive.Entries | Where-Object { $_.FullName -eq "版本指纹.txt" }
        if (-not $StandardZipFingerprintEntry) {
            throw "发布包自检失败，标准 Windows 客户端 ZIP 根目录缺少解压目录内版本指纹。"
        }
        $StandardZipSupportTemplateEntry = $StandardZipArchive.Entries | Where-Object { $_.FullName -eq "问题反馈模板.txt" }
        if (-not $StandardZipSupportTemplateEntry) {
            throw "发布包自检失败，标准 Windows 客户端 ZIP 根目录缺少问题反馈模板。"
        }
        $StandardZipReadmeAliasEntry = $StandardZipArchive.Entries | Where-Object { $_.FullName -eq "README.txt" }
        if (-not $StandardZipReadmeAliasEntry) {
            throw "发布包自检失败，标准 Windows 客户端 ZIP 根目录缺少 README.txt。"
        }
        $StandardZipVersionAliasEntry = $StandardZipArchive.Entries | Where-Object { $_.FullName -eq "VERSION.txt" }
        if (-not $StandardZipVersionAliasEntry) {
            throw "发布包自检失败，标准 Windows 客户端 ZIP 根目录缺少 VERSION.txt。"
        }
        $StandardZipBugReportAliasEntry = $StandardZipArchive.Entries | Where-Object { $_.FullName -eq "BUG_REPORT.txt" }
        if (-not $StandardZipBugReportAliasEntry) {
            throw "发布包自检失败，标准 Windows 客户端 ZIP 根目录缺少 BUG_REPORT.txt。"
        }
        $StandardZipCommandLineLaunchers = @($StandardZipArchive.Entries | Where-Object { $BlockedLauncherExtensions -contains [System.IO.Path]::GetExtension($_.FullName).ToLowerInvariant() })
        if ($StandardZipCommandLineLaunchers) {
            throw "发布包自检失败，标准 Windows 客户端 ZIP 内不应包含命令行启动入口：$($StandardZipCommandLineLaunchers.FullName -join ', ')"
        }
    }
    finally {
        $StandardZipArchive.Dispose()
    }

    $PackageExeSubsystem = Get-WindowsPeSubsystem -Path $PackageExe
    if ($PackageExeSubsystem -ne 2) {
        throw "发布包自检失败，正式 Windows 客户端包不能是控制台子系统程序，必须是 Windows GUI 子系统。当前 Subsystem=$PackageExeSubsystem"
    }
    $PrimaryClientExeSubsystem = Get-WindowsPeSubsystem -Path $PrimaryClientExePath
    if ($PrimaryClientExeSubsystem -ne 2) {
        throw "发布包自检失败，Windows 客户端目录中的 EXE 不能是控制台子系统程序，必须是 Windows GUI 子系统。当前 Subsystem=$PrimaryClientExeSubsystem"
    }
    $DeliveryExeSubsystem = Get-WindowsPeSubsystem -Path $DeliveryExePath
    if ($DeliveryExeSubsystem -ne 2) {
        throw "发布包自检失败，用户交付根目录中的 EXE 不能是控制台子系统程序，必须是 Windows GUI 子系统。当前 Subsystem=$DeliveryExeSubsystem"
    }
    $PlainClientExeSubsystem = Get-WindowsPeSubsystem -Path $PlainClientExePath
    if ($PlainClientExeSubsystem -ne 2) {
        throw "发布包自检失败，正式 Windows 客户端目录中的 EXE 不能是控制台子系统程序，必须是 Windows GUI 子系统。当前 Subsystem=$PlainClientExeSubsystem"
    }
    $LatestClientExeSubsystem = Get-WindowsPeSubsystem -Path $LatestClientExePath
    if ($LatestClientExeSubsystem -ne 2) {
        throw "发布包自检失败，最新版 Windows 客户端目录中的 EXE 不能是控制台子系统程序，必须是 Windows GUI 子系统。当前 Subsystem=$LatestClientExeSubsystem"
    }
    $DirectRunClientExeSubsystem = Get-WindowsPeSubsystem -Path $DirectRunClientExePath
    if ($DirectRunClientExeSubsystem -ne 2) {
        throw "发布包自检失败，可直接运行 Windows 客户端目录中的 EXE 不能是控制台子系统程序，必须是 Windows GUI 子系统。当前 Subsystem=$DirectRunClientExeSubsystem"
    }
    $StandardClientExeSubsystem = Get-WindowsPeSubsystem -Path $StandardClientExePath
    if ($StandardClientExeSubsystem -ne 2) {
        throw "发布包自检失败，标准 Windows 客户端目录中的 EXE 不能是控制台子系统程序，必须是 Windows GUI 子系统。当前 Subsystem=$StandardClientExeSubsystem"
    }

    $ManifestData = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    if ($ManifestData.packageName -ne $PackageName) {
        throw "发布包自检失败，manifest packageName 与目录不一致。"
    }
    if ($ManifestData.executable -ne "SSH-Agent-Tool.exe") {
        throw "发布包自检失败，manifest executable 不正确。"
    }
    $ExpectedFrontendAssets = Get-FrontendAssetFingerprint
    if (-not $ManifestData.frontendAssets) {
        throw "发布包自检失败，manifest 缺少前端资产指纹。"
    }
    if ($ManifestData.frontendAssets.script -ne $ExpectedFrontendAssets.script) {
        throw "发布包自检失败，manifest 主 JS 文件名与当前构建不一致。"
    }
    if ($ManifestData.frontendAssets.scriptSha256 -ne $ExpectedFrontendAssets.scriptSha256) {
        throw "发布包自检失败，manifest 主 JS SHA256 与当前构建不一致。"
    }
    if ($ManifestData.frontendAssets.stylesheet -ne $ExpectedFrontendAssets.stylesheet) {
        throw "发布包自检失败，manifest 主 CSS 文件名与当前构建不一致。"
    }
    if ($ManifestData.frontendAssets.stylesheetSha256 -ne $ExpectedFrontendAssets.stylesheetSha256) {
        throw "发布包自检失败，manifest 主 CSS SHA256 与当前构建不一致。"
    }

    $ActualExeHash = (Get-FileHash -LiteralPath $PackageExe -Algorithm SHA256).Hash
    if ($ActualExeHash -ne $ManifestData.sha256) {
        throw "发布包自检失败，EXE SHA256 与 manifest 不一致。"
    }
    $ActualDeliveryExeHash = (Get-FileHash -LiteralPath $DeliveryExePath -Algorithm SHA256).Hash
    if ($ActualDeliveryExeHash -ne $ManifestData.standaloneExeSha256) {
        throw "发布包自检失败，用户交付根目录 EXE SHA256 与 manifest 不一致。"
    }

    $ActualZipHash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash
    if ($ActualZipHash -ne $ManifestData.packageSha256) {
        throw "发布包自检失败，ZIP SHA256 与 manifest 不一致。"
    }

    $LatestData = Get-Content -LiteralPath $LatestManifestPath -Raw | ConvertFrom-Json
    if ($LatestData.packageName -ne $PackageName) {
        throw "发布包自检失败，latest.json 指向的包不是当前包。"
    }
    $SendOnlyLatestData = Get-Content -LiteralPath $SendOnlyLatestManifestPath -Raw | ConvertFrom-Json
    if (
        ($SendOnlyLatestData.packageName -ne $LatestData.packageName) -or
        ($SendOnlyLatestData.packageSha256 -ne $LatestData.packageSha256) -or
        ($SendOnlyLatestData.frontendAssets.scriptSha256 -ne $LatestData.frontendAssets.scriptSha256)
    ) {
        throw "发布包自检失败，只发这个目录 latest.json 与当前更新清单不一致。"
    }
    $SendOnlyFingerprintContent = Get-Content -LiteralPath $SendOnlyFingerprintPath -Raw
    if (
        (-not $SendOnlyFingerprintContent.Contains("前端资源：$($LatestData.frontendAssets.script)")) -or
        (-not $SendOnlyFingerprintContent.Contains("前端资源 SHA256：$($LatestData.frontendAssets.scriptSha256)"))
    ) {
        throw "发布包自检失败，只发这个目录版本指纹与 latest.json 前端资源不一致。"
    }

    $ActualSendOnlyZipHash = (Get-FileHash -LiteralPath $SendOnlyZipPath -Algorithm SHA256).Hash
    if ($ActualSendOnlyZipHash -ne $LatestDeliveryZipHash) {
        throw "发布包自检失败，只发这个目录 ZIP SHA256 与推荐分发 ZIP 不一致。"
    }

    $SendOnlyZipArchive = [System.IO.Compression.ZipFile]::OpenRead($SendOnlyZipPath)
    try {
        $SendOnlyZipCommandLineLaunchers = @($SendOnlyZipArchive.Entries | Where-Object { $BlockedLauncherExtensions -contains [System.IO.Path]::GetExtension($_.FullName).ToLowerInvariant() })
        if ($SendOnlyZipCommandLineLaunchers) {
            throw "发布包自检失败，只发这个目录推荐 ZIP 内不应包含命令行启动入口：$($SendOnlyZipCommandLineLaunchers.FullName -join ', ')"
        }
    }
    finally {
        $SendOnlyZipArchive.Dispose()
    }

    $StartupSmokePath = Join-Path $env:TEMP "ssh-agent-startup-smoke-$PID.json"
    if (Test-Path -LiteralPath $StartupSmokePath) {
        Remove-Item -LiteralPath $StartupSmokePath -Force
    }
    $StartupSmokeProcess = Start-Process -FilePath $PackageExe -ArgumentList @("--startup-smoke", "--smoke-output", $StartupSmokePath) -WorkingDirectory $PackageDir -WindowStyle Hidden -PassThru -Wait
    if ($StartupSmokeProcess.ExitCode -ne 0) {
        throw "发布包自检失败，EXE 启动冒烟检查退出码异常：$($StartupSmokeProcess.ExitCode)"
    }
    if (-not (Test-Path -LiteralPath $StartupSmokePath -PathType Leaf)) {
        throw "发布包自检失败，EXE 启动冒烟检查没有生成报告。"
    }
    $StartupSmoke = Get-Content -LiteralPath $StartupSmokePath -Raw | ConvertFrom-Json
    if (-not $StartupSmoke.ok) {
        throw "发布包自检失败，EXE 启动冒烟检查未通过。"
    }
    if ($StartupSmoke.version -ne $ManifestData.version) {
        throw "发布包自检失败，EXE 启动版本与 manifest 不一致。"
    }
    if ($StartupSmoke.packageName -ne $ManifestData.packageName) {
        throw "发布包自检失败，EXE 启动包名与 manifest 不一致。"
    }
    if (-not $StartupSmoke.frontendAssets) {
        throw "发布包自检失败，EXE 启动冒烟报告缺少前端资产指纹。"
    }
    if (-not $StartupSmoke.startupIdentity) {
        throw "发布包自检失败，EXE 启动冒烟报告缺少启动身份诊断。"
    }
    if ($StartupSmoke.startupIdentity.frontendMatchesManifest -ne $true) {
        throw "发布包自检失败，EXE 启动前端资源与 manifest 不一致。"
    }
    if (-not $StartupSmoke.clientEntry) {
        throw "发布包自检失败，EXE 启动冒烟报告缺少客户端入口诊断。"
    }
    if ($StartupSmoke.clientEntry.ok -eq $false) {
        throw "发布包自检失败，EXE 客户端入口诊断未通过：$($StartupSmoke.clientEntry.message)"
    }
    if ($StartupSmoke.frontendAssets.scriptSha256 -ne $ManifestData.frontendAssets.scriptSha256) {
        throw "发布包自检失败，EXE 内置主 JS 与 manifest 不一致。"
    }
    if ($StartupSmoke.frontendAssets.stylesheetSha256 -ne $ManifestData.frontendAssets.stylesheetSha256) {
        throw "发布包自检失败，EXE 内置主 CSS 与 manifest 不一致。"
    }
    Remove-Item -LiteralPath $StartupSmokePath -Force -ErrorAction SilentlyContinue
    Test-ZipStartupSmoke -ZipPath $SendOnlyZipPath -ManifestData $ManifestData -Label "只发这个分发 ZIP"

    Write-Host "发布包自检通过：$PackageName"
}

Invoke-WindowsExeBuild
if (-not (Test-Path -LiteralPath $SourceExe)) {
    throw "未找到可打包的 exe：$SourceExe。请先运行 build-windows-exe.ps1。"
}
$FrontendAssets = Get-FrontendAssetFingerprint

$Verification = Invoke-ReleaseVerification
$PublicVerification = Convert-ToPublicVerification -Verification $Verification

New-Item -ItemType Directory -Force -Path $ReleaseRoot | Out-Null
$LegacyLatestLauncherPath = Join-Path $ReleaseRoot "启动最新版.bat"
if (Test-Path -LiteralPath $LegacyLatestLauncherPath) {
    Remove-Item -LiteralPath $LegacyLatestLauncherPath -Force
}
$LegacyRootExePath = Join-Path $ReleaseRoot "SSH-Agent-Tool.exe"
Assert-ChildPath -Parent $ReleaseRoot -Child $PackageDir
Assert-ChildPath -Parent $PackageDir -Child $PackageFingerprintPath
Assert-ChildPath -Parent $PackageDir -Child $PackageSupportTemplatePath
Assert-ChildPath -Parent $ReleaseRoot -Child $ZipPath
Assert-ChildPath -Parent $ReleaseRoot -Child $LegacyRootExePath
Assert-ChildPath -Parent $ReleaseRoot -Child $PrimaryClientDir
Assert-ChildPath -Parent $PrimaryClientDir -Child $PrimaryClientExePath
Assert-ChildPath -Parent $PrimaryClientDir -Child $PrimaryClientFingerprintPath
Assert-ChildPath -Parent $PrimaryClientDir -Child $PrimaryClientSupportTemplatePath
Assert-ChildPath -Parent $ReleaseRoot -Child $DeliveryDir
Assert-ChildPath -Parent $DeliveryDir -Child $DeliveryExePath
Assert-ChildPath -Parent $DeliveryDir -Child $DeliveryFingerprintPath
Assert-ChildPath -Parent $DeliveryDir -Child $DeliverySupportTemplatePath
Assert-ChildPath -Parent $ReleaseRoot -Child $PlainClientDir
Assert-ChildPath -Parent $PlainClientDir -Child $PlainClientExePath
Assert-ChildPath -Parent $PlainClientDir -Child $PlainClientFingerprintPath
Assert-ChildPath -Parent $PlainClientDir -Child $PlainClientSupportTemplatePath
Assert-ChildPath -Parent $ReleaseRoot -Child $LatestClientDir
Assert-ChildPath -Parent $LatestClientDir -Child $LatestClientExePath
Assert-ChildPath -Parent $LatestClientDir -Child $LatestClientFingerprintPath
Assert-ChildPath -Parent $LatestClientDir -Child $LatestClientSupportTemplatePath
Assert-ChildPath -Parent $ReleaseRoot -Child $DirectRunClientDir
Assert-ChildPath -Parent $DirectRunClientDir -Child $DirectRunClientExePath
Assert-ChildPath -Parent $DirectRunClientDir -Child $DirectRunClientFingerprintPath
Assert-ChildPath -Parent $DirectRunClientDir -Child $DirectRunClientSupportTemplatePath
Assert-ChildPath -Parent $ReleaseRoot -Child $DirectRunClientZipPath
Assert-ChildPath -Parent $ReleaseRoot -Child $LatestDeliveryZipPath
Assert-ChildPath -Parent $ReleaseRoot -Child $SendOnlyDir
Assert-ChildPath -Parent $SendOnlyDir -Child $SendOnlyZipPath
Assert-ChildPath -Parent $SendOnlyDir -Child $SendOnlyChecksumPath
Assert-ChildPath -Parent $SendOnlyDir -Child $SendOnlyGuidePath
Assert-ChildPath -Parent $SendOnlyDir -Child $SendOnlySupportTemplatePath
Assert-ChildPath -Parent $SendOnlyDir -Child $SendOnlyLatestManifestPath
Assert-ChildPath -Parent $ReleaseRoot -Child $OnlineUpdateDir
Assert-ChildPath -Parent $OnlineUpdateDir -Child $OnlineUpdateZipPath
Assert-ChildPath -Parent $OnlineUpdateDir -Child $OnlineUpdateLatestManifestPath
Assert-ChildPath -Parent $OnlineUpdateDir -Child $OnlineUpdateGuidePath
Assert-ChildPath -Parent $ReleaseRoot -Child $StandardClientDir
Assert-ChildPath -Parent $StandardClientDir -Child $StandardClientExePath
Assert-ChildPath -Parent $StandardClientDir -Child $StandardClientFingerprintPath
Assert-ChildPath -Parent $StandardClientDir -Child $StandardClientSupportTemplatePath
Assert-ChildPath -Parent $ReleaseRoot -Child $StandardClientZipPath

Stop-RunningReleaseExe $PackageExe
Stop-RunningReleaseExe $LegacyRootExePath
Stop-RunningReleaseExe $PrimaryClientExePath
Stop-RunningReleaseExe $DeliveryExePath
Stop-RunningReleaseExe $PlainClientExePath
Stop-RunningReleaseExe $StandardClientExePath

try {
    if (Test-Path -LiteralPath $LegacyRootExePath) {
        Invoke-WithRetry -Action { Remove-Item -LiteralPath $LegacyRootExePath -Force }
    }
    foreach ($LegacyCompatibilityClientDirName in $LegacyCompatibilityClientDirs) {
        $LegacyCompatibilityClientDirPath = Join-Path $ReleaseRoot $LegacyCompatibilityClientDirName
        Assert-ChildPath -Parent $ReleaseRoot -Child $LegacyCompatibilityClientDirPath
        if (Test-Path -LiteralPath $LegacyCompatibilityClientDirPath) {
            Invoke-WithRetry -Action { Remove-Item -LiteralPath $LegacyCompatibilityClientDirPath -Recurse -Force }
        }
    }
    if (Test-Path -LiteralPath $PackageDir) {
        Invoke-WithRetry -Action { Remove-Item -LiteralPath $PackageDir -Recurse -Force }
    }
    if (Test-Path -LiteralPath $PrimaryClientDir) {
        Invoke-WithRetry -Action { Remove-Item -LiteralPath $PrimaryClientDir -Recurse -Force }
    }
    if (Test-Path -LiteralPath $DeliveryDir) {
        Invoke-WithRetry -Action { Remove-Item -LiteralPath $DeliveryDir -Recurse -Force }
    }
    if (Test-Path -LiteralPath $PlainClientDir) {
        Invoke-WithRetry -Action { Remove-Item -LiteralPath $PlainClientDir -Recurse -Force }
    }
    if (Test-Path -LiteralPath $LatestClientDir) {
        Invoke-WithRetry -Action { Remove-Item -LiteralPath $LatestClientDir -Recurse -Force }
    }
    if (Test-Path -LiteralPath $DirectRunClientDir) {
        Invoke-WithRetry -Action { Remove-Item -LiteralPath $DirectRunClientDir -Recurse -Force }
    }
    if (Test-Path -LiteralPath $DirectRunClientZipPath) {
        Invoke-WithRetry -Action { Remove-Item -LiteralPath $DirectRunClientZipPath -Force }
    }
    if (Test-Path -LiteralPath $LatestDeliveryZipPath) {
        Invoke-WithRetry -Action { Remove-Item -LiteralPath $LatestDeliveryZipPath -Force }
    }
    if (Test-Path -LiteralPath $SendOnlyDir) {
        Invoke-WithRetry -Action { Remove-Item -LiteralPath $SendOnlyDir -Recurse -Force }
    }
    if (Test-Path -LiteralPath $OnlineUpdateDir) {
        Invoke-WithRetry -Action { Remove-Item -LiteralPath $OnlineUpdateDir -Recurse -Force }
    }
    if (Test-Path -LiteralPath $StandardClientDir) {
        Invoke-WithRetry -Action { Remove-Item -LiteralPath $StandardClientDir -Recurse -Force }
    }
    if (Test-Path -LiteralPath $StandardClientZipPath) {
        Invoke-WithRetry -Action { Remove-Item -LiteralPath $StandardClientZipPath -Force }
    }
    if (Test-Path -LiteralPath $ZipPath) {
        Invoke-WithRetry -Action { Remove-Item -LiteralPath $ZipPath -Force }
    }
}
catch {
    $FallbackPackageName = Resolve-AvailablePackageName -BasePackageName $BasePackageName
    Write-Host "旧正式包仍被 Windows 占用，改用新目录继续打包：$FallbackPackageName"
    Set-ReleasePackagePaths -ResolvedPackageName $FallbackPackageName
    Assert-ChildPath -Parent $ReleaseRoot -Child $PackageDir
    Assert-ChildPath -Parent $ReleaseRoot -Child $ZipPath
}

New-Item -ItemType Directory -Force -Path $PackageDir | Out-Null
Copy-Item -LiteralPath $SourceExe -Destination $PackageExe -Force

$ExeItem = Get-Item -LiteralPath $PackageExe
$ExeHash = (Get-FileHash -LiteralPath $PackageExe -Algorithm SHA256).Hash
$GeneratedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
if ([string]::IsNullOrWhiteSpace($CurrentPackageUrl)) {
    $CurrentPackageUrl = Resolve-CurrentPackageUrlFromUpdateCheckUrl -UpdateCheckUrl $UpdateCheckUrl -PackageFileName (Split-Path -Leaf $ZipPath)
}

$Readme = @"
SSH Agent 工具正式版

版本
$Version

运行方式
1. 普通用户优先打开当前目录中的 SSH-Agent-Tool.exe；这是普通 Windows 图形客户端入口，不是命令行启动器。
2. 该程序为 Windows 单文件 exe，不需要安装 Node.js、Python 或其他开发环境。
3. 首次启动如果 Windows 安全提示未知来源，请选择“更多信息”后再确认运行。
4. 正常使用只双击 SSH-Agent-Tool.exe；正式包不提供 BAT、CMD 或 PowerShell 启动入口。
5. 如果希望像普通客户端一样从桌面启动，可以在“版本信息”里点击“创建桌面快捷方式”。
6. release 目录里的 latest.json 仅用于在线更新清单，不是启动入口。
7. 用户交付根目录每次打包都会刷新，只保留普通客户端入口、说明、版本清单和 ZIP；工具日志和诊断包可在工具内导出。
8. 给用户分发时只使用“Windows客户端”“最新版Windows客户端”“正式Windows客户端”或“用户交付”目录，不需要运行任何 BAT、CMD、PowerShell 脚本。
9. ZIP 用于分发、备份和在线更新；请先完整解压到一个普通文件夹，再双击解压目录中的 SSH-Agent-Tool.exe，不要在压缩包预览窗口里直接运行。
10. 如果旧版窗口关不掉，可以先在工具内退出，再重新打开新版 EXE。
11. 如果想确认包是否完整，可查看 manifest.json 中的 SHA256 与发布说明。
12. 不要从 release 根目录里的旧版本文件夹或开发目录启动；如果双击后仍看到命令行窗口，通常是打开了旧历史包或脚本，请改用“用户交付”或“Windows客户端”目录中的 SSH-Agent-Tool.exe，并把旧桌面快捷方式删除后重新创建。
13. 如果错误里出现 index-BCGy_mkD.js、Power is not defined 或 exportConnectionCheckReport is not defined，说明正在运行旧安装包或旧前端资源；请删除旧解压目录、旧桌面快捷方式和旧历史 ZIP，再重新解压最新 ZIP。

跨电脑正确使用步骤
1. 先删旧目录，再解压到一个全新的空目录。
2. 不要覆盖解压到旧目录，旧目录里可能还有旧前端资源。
3. 不要继续使用旧桌面快捷方式，旧快捷方式可能仍指向旧 EXE。
4. 第一次启动请直接双击新解压目录里的 SSH-Agent-Tool.exe。

当前版本重点
1. SSH 服务器管理、连接测试、会话连接/断开/重连。
2. SFTP 文件浏览、预览、上传、下载、重命名、删除。
3. Agent 对话、任务审批、Skill/MCP/CLI 扩展框架。
4. 自定义模型 API、OpenAI 兼容 API、中转站 API 配置。
5. 服务器信息备份、导入、CSV 清单、OpenSSH Config 导出。
6. 批量连接校验、失败修复计划、Agent 排查队列。

SSH 终端快速使用
1. 选中服务器后点击“连接 SSH 会话”，或直接在终端输入命令后按回车自动建立会话。
2. 回车会直接发送命令，不要再次确认；这和常规 SSH 工具保持一致。
3. 常用控制键会发送到远端 SSH：Ctrl+C 中断、Ctrl+D 发送 EOF、Ctrl+Z 挂起、Ctrl+L 清屏、Ctrl+R 历史搜索、Ctrl\ 强制退出；方向键、Tab、Esc 也可正常发送。
4. 复制粘贴支持常规 Windows 终端习惯：Ctrl+Shift+C 或 Ctrl+Insert 复制终端输出/选中内容，Ctrl+Shift+V、Ctrl+V 或 Shift+Insert 粘贴到当前终端。
5. 终端右键菜单可复制输出、重连、断开、导出终端内容、查看会话日志和诊断包。
6. 第一次连接测试服务器后，建议在顶部“SSH 操作”里运行“一键基础自检”；它会检查 SSH 会话、回车执行、Ctrl+C 中断、SFTP 临时文件读写和清理。
7. 自检完成后可点击“导出基础自检报告”，用于确认其他电脑上的客户端、凭据、SSH 和 SFTP 能力是否正常。
8. 遇到终端白屏、命令无输出或快捷键异常时，先打开“工具日志”和“会话日志”查看最近错误。

模型 API 快速使用
1. 打开“模型 API”，填写 Base URL、API Key 和默认模型。
2. 如果是 OpenAI 兼容中转站，可以先点击“获取模型”读取模型列表，再选择默认模型保存。
3. 获取模型失败时，确认 Base URL 是否为兼容地址，例如 https://你的中转站/v1，或查看工具日志中的返回内容。
4. 自定义 Header 可用于 HTTP-Referer、X-Title 等中转站要求；Authorization、Token、API-Key、Cookie 等敏感 Header 请使用上方 API Key 保存。

安全说明
1. 默认导出不会包含明文密码、私钥、API Key 或 MCP Header 密钥。
2. 如需迁移密码/密钥，请使用“备份导出”中的加密导出，并牢记备份主密码。
3. 首次接入生产服务器前，建议先用测试服务器验证连接、备份和 Agent 流程。

日志与问题反馈
1. 工具日志、会话日志、加密凭据和本机配置默认保存在 Windows 用户数据目录的 SSHAgentTool 下。
2. 如果旧版配置目录 SSHAgentToolPreview 已存在，首次启动正式版会自动复制旧配置到 SSHAgentTool；旧目录不会被删除。
3. 放到其他电脑后如果打不开，请先确认系统是 Windows 10/11 x64，并安装 Microsoft Edge WebView2 Runtime：https://go.microsoft.com/fwlink/?LinkId=2124703。
4. 如果界面打不开，可以到 Windows 用户数据目录的 SSHAgentTool 文件夹查看 startup-failure-latest.log；里面会记录 WebView2 Runtime、版本清单和前端资源信息。
5. 工具能打开但功能异常时，可在“版本信息”里点击“打开日志目录”或“导出诊断包”。
6. 遇到 SSH 连接、终端白屏、SFTP、模型 API 或 Agent 异常时，先在工具内打开“会话日志”或“工具日志”查看最近错误。
7. 工具内的“导出诊断包”会把版本清单和本机日志打成 zip，默认输出到 SSHAgentTool\diagnostic-packages，不收集配置、密码、私钥或 API Key。
8. 反馈 BUG 时建议导出“诊断包”，并同时说明操作步骤、服务器类型、认证方式、模型 API 提供商和发生时间。
9. 日志会尽量脱敏密码、私钥、API Key、Token 等敏感字段；发送给他人前仍建议自行检查一遍。

跨电脑启动排查
1. 普通用户只需要双击 SSH-Agent-Tool.exe；Windows 图形客户端 EXE 不会像命令行程序一样阻塞等待输出，所以不要用普通命令行直接运行结果来判断是否启动成功。
2. 如果需要在其他电脑确认包完整，可在解压目录打开 PowerShell，执行：Start-Process -FilePath '.\SSH-Agent-Tool.exe' -ArgumentList @('--startup-smoke','--smoke-output','startup-smoke.json') -WindowStyle Hidden -PassThru -Wait
3. 执行后查看 startup-smoke.json；如果里面出现 "state": "passed"，说明 EXE、前端资源、manifest、日志目录和 WebView2 Runtime 基础检查通过。
4. 如果没有生成 startup-smoke.json，或 state 不是 passed，请把 startup-smoke.json、startup-failure-latest.log 和工具内导出的诊断包一起反馈。

更新发布步骤
1. 打包完成后，release 目录会生成 SSH-Agent-Tool-$Version.zip 和 latest.json。
2. 将 SSH-Agent-Tool-$Version.zip 与 latest.json 放到同一个下载站点、对象存储或内网静态文件服务，并托管 latest.json 作为更新清单。
3. 下次打包时可传入 -UpdateCheckUrl 指向远程 latest.json，例如 https://example.com/ssh-agent/latest.json。
4. 可传入 -CurrentPackageUrl 指向远程 ZIP 下载地址，传入 -ReleaseNotesUrl 指向更新说明页面；如果不传 -CurrentPackageUrl 但 -UpdateCheckUrl 指向远程 latest.json，会自动推导同目录 ZIP 地址。
5. 用户在工具内点击“版本信息 / 检查更新”后，会在线读取 latest.json 并显示新版本、下载地址和校验信息。
6. 当前版本支持在线检查、工具内下载、SHA256 校验，以及在工具内点击“安装并重启”；后台更新器启动后会自动替换并重启新版本。

校验信息
文件大小：$([Math]::Round($ExeItem.Length / 1MB, 2)) MB
SHA256：$ExeHash
生成时间：$GeneratedAt

构建验证
$($PublicVerification | ForEach-Object { "[$($_.status)] $($_.name)：$($_.result)" } | Out-String)
"@

Write-Utf8File -Path $ReadmePath -Content $Readme

$SupportTemplate = @"
SSH Agent 工具问题反馈模板

一、版本信息
- 版本：$Version
- 生成时间：$GeneratedAt
- EXE SHA256：$ExeHash
- 前端资源：$($FrontendAssets.script)
- 前端资源 SHA256：$($FrontendAssets.scriptSha256)
- ZIP SHA256：稍后可对照 SHA256校验.txt 或版本指纹.txt。

二、问题现象
- 问题类型：无法启动 / SSH 连接失败 / 终端白屏 / 命令无输出 / SFTP 异常 / 模型 API 异常 / Agent 异常 / 在线更新异常 / 其他
- 发生时间：
- 操作步骤：
- 期望结果：
- 实际结果：
- 是否只在某台电脑出现：

三、普通用户启动确认
普通用户不需要打开 PowerShell，也不需要运行 BAT、CMD 或脚本。
请先确认是完整解压后双击 SSH-Agent-Tool.exe，不要从压缩包预览窗口、旧解压目录或旧桌面快捷方式启动。
如果出现错误页，请优先反馈截图、当前页面脚本、清单前端脚本和版本指纹.txt。
如果怀疑打开了旧包，请同时反馈：
- 实际启动的 SSH-Agent-Tool.exe 完整路径：
- 桌面快捷方式右键属性里的“目标”：
- 错误页里的 dist/assets/index-*.js 文件名：
- 版本指纹.txt 里的前端资源：

四、开发者补充自检
以下命令只用于开发者或技术支持确认包完整性，不是普通启动方式：
Start-Process -FilePath '.\SSH-Agent-Tool.exe' -ArgumentList @('--startup-smoke','--smoke-output','startup-smoke.json') -WindowStyle Hidden -PassThru -Wait

如已执行补充自检，请反馈：
- startup-smoke.json 是否生成：
- startup-smoke.json 里的 state：
- startup-smoke.json 里的 frontendAssets.script：
- 错误页里的 dist/assets/index-*.js 文件名：

五、日志和诊断包
- 工具日志目录：%APPDATA%\SSHAgentTool\tool-logs
- 会话日志目录：%APPDATA%\SSHAgentTool\session-logs
- 启动失败日志：%APPDATA%\SSHAgentTool\startup-failure-latest.log
- 诊断包目录：%APPDATA%\SSHAgentTool\diagnostic-packages
- 如果工具能打开：请在“版本信息”里点击“导出诊断包”。
- 如果工具打不开：请发送错误页截图、版本指纹.txt、startup-failure-latest.log；如已执行补充自检，再发送 startup-smoke.json。

六、环境信息
- Windows 版本：
- 是否 Windows 10/11 x64：
- 是否安装 Microsoft Edge WebView2 Runtime：
- 是否从压缩包预览窗口直接运行：
- 是否删除旧解压目录和旧桌面快捷方式后重新解压：
- 当前启动路径：

七、SSH / SFTP 信息（不要包含密码）
- 服务器系统：
- 连接方式：密码 / 私钥 / SSH Agent / 其他
- 主机/IP：
- 端口：
- 用户名：
- 错误提示：
- 是否能用其他 SSH 客户端连接：
- 是否已运行“一键基础自检”：
- 自检结果：通过 / 失败 / 跳过：
- 是否已导出“基础自检报告”：
- 失败或跳过的自检步骤名称：

八、模型 API / Agent 信息（不要包含密钥）
- 模型供应商或中转站：
- Base URL：
- 默认模型：
- 获取模型列表是否成功：
- Agent 使用的 Skill / MCP / CLI：
- 错误提示：

安全提醒
不要发送服务器密码、私钥、API Key、Token、Cookie、Authorization Header、MCP 密钥或任何生产环境敏感内容。日志和诊断包会尽量脱敏，但发送前仍建议自行检查。
"@

Write-Utf8File -Path $PackageSupportTemplatePath -Content $SupportTemplate

$ClientFingerprint = @"
SSH Agent 工具解压目录内版本指纹

用于确认当前解压目录是否为最新版客户端。目标电脑报错时，请对比错误页里的前端资源文件名和这里的前端资源。

版本：$Version
生成时间：$GeneratedAt
EXE SHA256：$ExeHash
前端资源：$($FrontendAssets.script)
前端资源 SHA256：$($FrontendAssets.scriptSha256)
样式资源：$($FrontendAssets.stylesheet)
样式资源 SHA256：$($FrontendAssets.stylesheetSha256)

如果错误页里的 dist/assets/index-*.js 不是上面的前端资源，说明仍在运行旧包、旧解压目录、旧桌面快捷方式或复制不完整。
处理方式：删除旧解压目录和旧桌面快捷方式，重新完整解压最新版 ZIP，再双击 SSH-Agent-Tool.exe。
"@
Write-Utf8File -Path $PackageFingerprintPath -Content $ClientFingerprint
Write-Utf8File -Path $PackageReadmeAliasPath -Content $Readme
Write-Utf8File -Path $PackageVersionAliasPath -Content $ClientFingerprint
Write-Utf8File -Path $PackageBugReportAliasPath -Content $SupportTemplate

$Manifest = [ordered]@{
    appName = "SSH Agent 工具"
    version = $Version
    generatedAt = $GeneratedAt
    packageName = $PackageName
    executable = "SSH-Agent-Tool.exe"
    sha256 = $ExeHash
    sizeBytes = $ExeItem.Length
    updateChannel = "stable"
    updateCheckUrl = $UpdateCheckUrl
    releaseNotesUrl = $ReleaseNotesUrl
    supportUrl = $SupportUrl
    updatePolicy = "支持远程版本清单和应用内检查更新。"
    currentPackageUrl = $CurrentPackageUrl
    standaloneExe = "SSH-Agent-Tool.exe"
    standaloneExeSha256 = $ExeHash
    minWindows = "Windows 10/11 x64"
    sensitiveDataPolicy = "默认不明文导出密码、私钥、API Key 或 MCP Header 密钥。"
    verification = $PublicVerification
    frontendAssets = $FrontendAssets
    features = @(
        "SSH 服务器管理与连接测试",
        "SSH 会话连接、断开与重连",
        "SFTP 文件浏览与基础操作",
        "Agent 对话、审批、Skill/MCP/CLI 扩展",
        "模型 API 与 OpenAI 兼容中转站配置",
        "服务器信息备份、导入和脱敏导出",
        "批量连接校验与失败修复计划"
    )
}

Write-Utf8File -Path $ManifestPath -Content (($Manifest | ConvertTo-Json -Depth 5) + [Environment]::NewLine)

Invoke-WithRetry -Action {
    Compress-Archive -Path $PackageArchiveRoot -DestinationPath $ZipPath -Force
}
$ZipItem = Get-Item -LiteralPath $ZipPath
$ZipHash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash

$Manifest.packageFile = (Split-Path -Leaf $ZipPath)
$Manifest.packageSha256 = $ZipHash
$Manifest.packageSizeBytes = $ZipItem.Length
Write-Utf8File -Path $ManifestPath -Content (($Manifest | ConvertTo-Json -Depth 5) + [Environment]::NewLine)

$LatestManifest = [ordered]@{
    appName = "SSH Agent 工具"
    version = $Version
    generatedAt = $GeneratedAt
    updateChannel = "stable"
    updateCheckUrl = $UpdateCheckUrl
    releaseNotesUrl = $ReleaseNotesUrl
    supportUrl = $SupportUrl
    updatePolicy = "支持远程版本清单和应用内检查更新。"
    currentPackageUrl = $CurrentPackageUrl
    packageName = $PackageName
    packageFile = (Split-Path -Leaf $ZipPath)
    packageSha256 = $ZipHash
    packageSizeBytes = $ZipItem.Length
    executable = "SSH-Agent-Tool.exe"
    sha256 = $ExeHash
    sizeBytes = $ExeItem.Length
    standaloneExe = "SSH-Agent-Tool.exe"
    standaloneExeSha256 = $ExeHash
    minWindows = "Windows 10/11 x64"
    verification = $PublicVerification
    frontendAssets = $FrontendAssets
    features = $Manifest.features
}

Write-Utf8File -Path $LatestManifestPath -Content (($LatestManifest | ConvertTo-Json -Depth 5) + [Environment]::NewLine)

New-Item -ItemType Directory -Force -Path $PrimaryClientDir | Out-Null
Copy-Item -LiteralPath $PackageExe -Destination $PrimaryClientExePath -Force
Copy-Item -LiteralPath $ReadmePath -Destination $PrimaryClientReadmePath -Force
Copy-Item -LiteralPath $PackageFingerprintPath -Destination $PrimaryClientFingerprintPath -Force
Copy-Item -LiteralPath $PackageSupportTemplatePath -Destination $PrimaryClientSupportTemplatePath -Force
Copy-Item -LiteralPath $ManifestPath -Destination $PrimaryClientManifestPath -Force
Copy-Item -LiteralPath $LatestManifestPath -Destination $PrimaryClientLatestManifestPath -Force

New-Item -ItemType Directory -Force -Path $DeliveryDir | Out-Null
try {
    Copy-Item -LiteralPath $PackageExe -Destination $DeliveryExePath -Force
}
catch [System.IO.IOException] {
    $FallbackDeliveryDir = Join-Path $ReleaseRoot "用户交付-$PackageName"
    Write-Host "用户交付目录中的旧 EXE 正在运行，改用新的交付目录继续打包：$FallbackDeliveryDir"
    $DeliveryDir = $FallbackDeliveryDir
    $DeliveryExePath = Join-Path $DeliveryDir "SSH-Agent-Tool.exe"
    $DeliveryReadmePath = Join-Path $DeliveryDir "使用说明.txt"
    $DeliveryFingerprintPath = Join-Path $DeliveryDir "版本指纹.txt"
    $DeliverySupportTemplatePath = Join-Path $DeliveryDir "问题反馈模板.txt"
    $DeliveryManifestPath = Join-Path $DeliveryDir "manifest.json"
    $DeliveryZipPath = Join-Path $DeliveryDir (Split-Path -Leaf $ZipPath)
    $DeliveryLatestManifestPath = Join-Path $DeliveryDir "latest.json"
    New-Item -ItemType Directory -Force -Path $DeliveryDir | Out-Null
    Copy-Item -LiteralPath $PackageExe -Destination $DeliveryExePath -Force
}
Copy-Item -LiteralPath $ReadmePath -Destination $DeliveryReadmePath -Force
Copy-Item -LiteralPath $PackageFingerprintPath -Destination $DeliveryFingerprintPath -Force
Copy-Item -LiteralPath $PackageSupportTemplatePath -Destination $DeliverySupportTemplatePath -Force
Copy-Item -LiteralPath $ManifestPath -Destination $DeliveryManifestPath -Force
Copy-Item -LiteralPath $ZipPath -Destination $DeliveryZipPath -Force
Copy-Item -LiteralPath $LatestManifestPath -Destination $DeliveryLatestManifestPath -Force

New-Item -ItemType Directory -Force -Path $PlainClientDir | Out-Null
try {
    Copy-Item -LiteralPath $PackageExe -Destination $PlainClientExePath -Force
}
catch [System.IO.IOException] {
    $FallbackPlainClientDir = Join-Path $ReleaseRoot "正式Windows客户端-$PackageName"
    Write-Host "正式 Windows 客户端目录中的旧 EXE 正在运行，改用新的正式客户端目录继续打包：$FallbackPlainClientDir"
    $PlainClientDir = $FallbackPlainClientDir
    $PlainClientExePath = Join-Path $PlainClientDir "SSH-Agent-Tool.exe"
    $PlainClientReadmePath = Join-Path $PlainClientDir "使用说明.txt"
    $PlainClientFingerprintPath = Join-Path $PlainClientDir "版本指纹.txt"
    $PlainClientSupportTemplatePath = Join-Path $PlainClientDir "问题反馈模板.txt"
    $PlainClientManifestPath = Join-Path $PlainClientDir "manifest.json"
    $PlainClientLatestManifestPath = Join-Path $PlainClientDir "latest.json"
    New-Item -ItemType Directory -Force -Path $PlainClientDir | Out-Null
    Copy-Item -LiteralPath $PackageExe -Destination $PlainClientExePath -Force
}
Copy-Item -LiteralPath $ReadmePath -Destination $PlainClientReadmePath -Force
Copy-Item -LiteralPath $PackageFingerprintPath -Destination $PlainClientFingerprintPath -Force
Copy-Item -LiteralPath $PackageSupportTemplatePath -Destination $PlainClientSupportTemplatePath -Force
Copy-Item -LiteralPath $ManifestPath -Destination $PlainClientManifestPath -Force
Copy-Item -LiteralPath $LatestManifestPath -Destination $PlainClientLatestManifestPath -Force

New-Item -ItemType Directory -Force -Path $LatestClientDir | Out-Null
Copy-Item -LiteralPath $PackageExe -Destination $LatestClientExePath -Force
Copy-Item -LiteralPath $ReadmePath -Destination $LatestClientReadmePath -Force
Copy-Item -LiteralPath $PackageFingerprintPath -Destination $LatestClientFingerprintPath -Force
Copy-Item -LiteralPath $PackageSupportTemplatePath -Destination $LatestClientSupportTemplatePath -Force
Copy-Item -LiteralPath $ManifestPath -Destination $LatestClientManifestPath -Force
Copy-Item -LiteralPath $LatestManifestPath -Destination $LatestClientLatestManifestPath -Force

New-Item -ItemType Directory -Force -Path $DirectRunClientDir | Out-Null
Copy-Item -LiteralPath $PackageExe -Destination $DirectRunClientExePath -Force
Copy-Item -LiteralPath $ReadmePath -Destination $DirectRunClientReadmePath -Force
Copy-Item -LiteralPath $PackageFingerprintPath -Destination $DirectRunClientFingerprintPath -Force
Copy-Item -LiteralPath $PackageSupportTemplatePath -Destination $DirectRunClientSupportTemplatePath -Force
Copy-Item -LiteralPath $PackageReadmeAliasPath -Destination $DirectRunClientReadmeAliasPath -Force
Copy-Item -LiteralPath $PackageVersionAliasPath -Destination $DirectRunClientVersionAliasPath -Force
Copy-Item -LiteralPath $PackageBugReportAliasPath -Destination $DirectRunClientBugReportAliasPath -Force
Copy-Item -LiteralPath $ManifestPath -Destination $DirectRunClientManifestPath -Force
Copy-Item -LiteralPath $LatestManifestPath -Destination $DirectRunClientLatestManifestPath -Force
Invoke-WithRetry -Action {
    Compress-Archive -Path $DirectRunClientArchiveRoot -DestinationPath $DirectRunClientZipPath -Force
}
Copy-Item -LiteralPath $DirectRunClientZipPath -Destination $LatestDeliveryZipPath -Force
$LatestDeliveryZipHash = (Get-FileHash -LiteralPath $LatestDeliveryZipPath -Algorithm SHA256).Hash

New-Item -ItemType Directory -Force -Path $SendOnlyDir | Out-Null
Copy-Item -LiteralPath $LatestDeliveryZipPath -Destination $SendOnlyZipPath -Force
Copy-Item -LiteralPath $LatestManifestPath -Destination $SendOnlyLatestManifestPath -Force
Copy-Item -LiteralPath $PackageSupportTemplatePath -Destination $SendOnlySupportTemplatePath -Force
Copy-Item -LiteralPath $PackageSupportTemplatePath -Destination $SendOnlyBugReportAliasPath -Force
$SendOnlyChecksum = @"
SSH Agent 工具最新版分发校验

只发这个目录只保留最新版分发文件，避免误发 release 根目录里的历史版本。

分发文件：请发这个-最新版Windows客户端.zip
SHA256：$LatestDeliveryZipHash
版本：$Version
生成时间：$GeneratedAt

使用方法：把“请发这个-最新版Windows客户端.zip”发给对方；对方删除旧解压目录和旧快捷方式后，重新解压并双击 SSH-Agent-Tool.exe。
"@
Write-Utf8File -Path $SendOnlyChecksumPath -Content $SendOnlyChecksum
$SendOnlyFingerprint = @"
SSH Agent 工具版本指纹

用于确认测试电脑是否打开了最新版客户端。目标电脑报错时，请对比错误页里的前端资源文件名和这里的前端资源。

版本：$Version
生成时间：$GeneratedAt
推荐分发 ZIP：请发这个-最新版Windows客户端.zip
推荐分发 ZIP SHA256：$LatestDeliveryZipHash
在线更新 ZIP SHA256：$ZipHash
EXE SHA256：$ExeHash
前端资源：$($FrontendAssets.script)
前端资源 SHA256：$($FrontendAssets.scriptSha256)

如果目标电脑错误页里的 dist/assets/index-*.js 不是上面的前端资源，说明仍在运行旧包、旧解压目录或旧桌面快捷方式。
"@
Write-Utf8File -Path $SendOnlyFingerprintPath -Content $SendOnlyFingerprint
$SendOnlyGuide = @"
先看这里

请只发送本目录里的“请发这个-最新版Windows客户端.zip”。
不要从 release 根目录挑历史 ZIP，也不要发送旧日期目录。
如果需要核对版本，请打开“版本指纹.txt”，对比版本、EXE SHA256、ZIP SHA256 和前端资源名。

目标电脑要求：Windows 10/11 x64。正常情况下直接双击 SSH-Agent-Tool.exe 即可，不需要 Node、Python 或 BAT。
如果目标电脑没有 WebView2，界面可能无法打开；请安装 Microsoft Edge WebView2 Runtime：
https://go.microsoft.com/fwlink/?LinkId=2124703

跨电脑正确使用步骤：
1. 先删旧目录，再解压到一个全新的空目录。
2. 不要覆盖解压到旧目录，旧目录里可能还有旧前端资源。
3. 不要继续使用旧桌面快捷方式，旧快捷方式可能仍指向旧 EXE。
4. 第一次启动请直接双击新解压目录里的 SSH-Agent-Tool.exe。
5. 第一次连上测试服务器后，在顶部“SSH 操作”里运行“一键基础自检”，确认 SSH 会话、回车执行、Ctrl+C 中断、SFTP 临时文件读写和清理都正常。

当前正确前端资源：$($FrontendAssets.script)
当前正确前端资源 SHA256：$($FrontendAssets.scriptSha256)
如果报错路径里的前端资源不是上面这个文件名，就是旧包、旧解压目录或旧快捷方式。
判断方法：看错误页里的 dist/assets/index-*.js 文件名；它必须和“当前正确前端资源”一致。

如果目标电脑报 Power is not defined、exportConnectionCheckReport is not defined，或错误路径出现 index-BCGy_mkD.js / index-C55DkVKK.js，基本就是仍在运行旧包或旧快捷方式。
处理方式：删除旧解压目录和旧桌面快捷方式，重新解压本目录的最新版 ZIP，再双击 SSH-Agent-Tool.exe。
如果使用桌面快捷方式启动，桌面快捷方式右键属性里的“目标”必须指向新解压目录里的 SSH-Agent-Tool.exe。
反馈时请同时提供：实际启动路径、快捷方式目标、错误页 JS 文件名，方便快速判断是否仍在运行旧包。

SHA256 可查看 SHA256校验.txt；latest.json 仅用于在线更新清单。
"@
Write-Utf8File -Path $SendOnlyGuidePath -Content $SendOnlyGuide
Write-Utf8File -Path $SendOnlyReadmeAliasPath -Content $SendOnlyGuide
Write-Utf8File -Path $SendOnlyVersionAliasPath -Content $SendOnlyFingerprint

New-Item -ItemType Directory -Force -Path $OnlineUpdateDir | Out-Null
Copy-Item -LiteralPath $ZipPath -Destination $OnlineUpdateZipPath -Force
Copy-Item -LiteralPath $LatestManifestPath -Destination $OnlineUpdateLatestManifestPath -Force
$OnlineUpdateGuide = @"
SSH Agent 工具在线更新发布说明

本目录只用于托管在线更新文件，不是客户端运行目录。

需要上传的文件：
1. latest.json
2. $(Split-Path -Leaf $ZipPath)

发布方式：
1. 把本目录里的 latest.json 和 ZIP 放到同一个 HTTP/HTTPS 目录。
2. 如果打包时传入 -UpdateCheckUrl，客户端版本信息里会默认带上该 latest.json 地址。
3. 如果未传入 -CurrentPackageUrl，但 -UpdateCheckUrl 指向远程 latest.json，脚本会自动推导同目录 ZIP 下载地址。
4. 用户在工具内打开“版本信息”，点击“检查更新”“下载并校验更新包”“安装并重启”即可升级。

当前 latest.json：
$UpdateCheckUrl

当前 ZIP：
$(Split-Path -Leaf $ZipPath)

ZIP SHA256：
$ZipHash

注意：
- 不要把 SSH-Agent-Tool.exe 单独放进本目录。
- 不要混放历史 ZIP，避免用户检查更新时拿到旧包。
- 如果内网地址变化，请重新打包并传入新的 -UpdateCheckUrl 和 -CurrentPackageUrl。
"@
Write-Utf8File -Path $OnlineUpdateGuidePath -Content $OnlineUpdateGuide

New-Item -ItemType Directory -Force -Path $StandardClientDir | Out-Null
Copy-Item -LiteralPath $PackageExe -Destination $StandardClientExePath -Force
Copy-Item -LiteralPath $ReadmePath -Destination $StandardClientReadmePath -Force
Copy-Item -LiteralPath $PackageFingerprintPath -Destination $StandardClientFingerprintPath -Force
Copy-Item -LiteralPath $PackageSupportTemplatePath -Destination $StandardClientSupportTemplatePath -Force
Copy-Item -LiteralPath $PackageReadmeAliasPath -Destination $StandardClientReadmeAliasPath -Force
Copy-Item -LiteralPath $PackageVersionAliasPath -Destination $StandardClientVersionAliasPath -Force
Copy-Item -LiteralPath $PackageBugReportAliasPath -Destination $StandardClientBugReportAliasPath -Force
Copy-Item -LiteralPath $ManifestPath -Destination $StandardClientManifestPath -Force
Copy-Item -LiteralPath $LatestManifestPath -Destination $StandardClientLatestManifestPath -Force
Invoke-WithRetry -Action {
    Compress-Archive -Path $StandardClientArchiveRoot -DestinationPath $StandardClientZipPath -Force
}

$ReleaseRootGuide = @"
SSH Agent 工具正式版启动入口

请优先发送：请发这个-最新版Windows客户端.zip
这个文件每次打包都会刷新，避免误发历史目录里的旧版本。
更稳妥的交付方式：打开 release\只发这个，只发送里面的“请发这个-最新版Windows客户端.zip”。

如果你只是要打开工具或交付给用户，只需要双击：
1. SSH-Agent-Windows-Client\SSH-Agent-Tool.exe
2. 可直接运行Windows客户端\SSH-Agent-Tool.exe
3. Windows客户端\SSH-Agent-Tool.exe
4. 最新版Windows客户端\SSH-Agent-Tool.exe
5. 用户交付\SSH-Agent-Tool.exe

不要打开旧版本目录、历史 ZIP 或任何脚本文件；旧目录仅作为构建历史保留。
ZIP 文件用于分发、备份和在线更新；最简单的分发包是 `SSH-Agent-Windows-Client.zip`，解压后双击 `SSH-Agent-Windows-Client\SSH-Agent-Tool.exe`。
latest.json 是在线更新清单，不是启动入口。

如果其他电脑提示 Power is not defined、exportConnectionCheckReport is not defined，或错误路径里出现 index-BCGy_mkD.js / index-C55DkVKK.js，基本就是打开了旧包。
请删除目标电脑上的旧解压目录和旧桌面快捷方式；旧快捷方式可能仍指向旧 EXE。然后只重新解压“请发这个-最新版Windows客户端.zip”并双击其中的 SSH-Agent-Tool.exe。
当前正确前端资源：$($FrontendAssets.script)
当前正确前端资源 SHA256：$($FrontendAssets.scriptSha256)
如果报错路径里的前端资源不是上面这个文件名，就是旧包、旧解压目录或旧快捷方式。
判断方法：看错误页里的 dist/assets/index-*.js 文件名；它必须和“当前正确前端资源”一致。
如果使用桌面快捷方式启动，桌面快捷方式右键属性里的“目标”必须指向新解压目录里的 SSH-Agent-Tool.exe。

跨电脑启动排查：
普通用户只需要双击 SSH-Agent-Tool.exe；Windows 图形客户端 EXE 不会像命令行程序一样阻塞等待输出。
如需确认包完整，可在解压目录打开 PowerShell 执行：Start-Process -FilePath '.\SSH-Agent-Tool.exe' -ArgumentList @('--startup-smoke','--smoke-output','startup-smoke.json') -WindowStyle Hidden -PassThru -Wait
然后查看 startup-smoke.json；出现 "state": "passed" 表示基础启动自检通过。

当前版本：$Version
EXE SHA256：$ExeHash
推荐分发 ZIP SHA256：$LatestDeliveryZipHash
在线更新 ZIP SHA256：$ZipHash
生成时间：$GeneratedAt
"@

Write-Utf8File -Path $ReleaseRootGuidePath -Content $ReleaseRootGuide

Invoke-PackageSmokeCheck

Write-Host "正式版安装包已生成：$ZipPath"
Write-Host "目录：$PackageDir"
Write-Host "Windows 客户端目录：$PrimaryClientDir"
Write-Host "用户交付目录：$DeliveryDir"
Write-Host "正式 Windows 客户端目录：$PlainClientDir"
Write-Host "最新版 Windows 客户端目录：$LatestClientDir"
Write-Host "可直接运行 Windows 客户端目录：$DirectRunClientDir"
Write-Host "可直接运行 Windows 客户端 ZIP：$DirectRunClientZipPath"
Write-Host "最新版交付 ZIP：$LatestDeliveryZipPath"
Write-Host "只发这个目录：$SendOnlyDir"
Write-Host "在线更新发布目录：$OnlineUpdateDir"
Write-Host "标准 Windows 客户端目录：$StandardClientDir"
Write-Host "标准 Windows 客户端 ZIP：$StandardClientZipPath"
Write-Host "ZIP 大小：$([Math]::Round($ZipItem.Length / 1MB, 2)) MB"
Write-Host "EXE SHA256：$ExeHash"
Write-Host "推荐分发 ZIP SHA256：$LatestDeliveryZipHash"
Write-Host "ZIP SHA256：$ZipHash"
Write-Host "更新清单：$LatestManifestPath"
