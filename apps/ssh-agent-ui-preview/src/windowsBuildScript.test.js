import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findSuspiciousLocalizationText } from "./localizationQuality.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildScriptPath = join(projectRoot, "build-windows-exe.ps1");
const releasePackageScriptPath = join(projectRoot, "build-windows-client-package.ps1");
const releasePackageAliasScriptPath = join(projectRoot, "build-release-package.ps1");
const legacyTrialPackageScriptPath = join(projectRoot, "build-trial-package.ps1");
const pyinstallerSpecPath = join(projectRoot, "ssh-agent-ui-preview.spec");
const packageJsonPath = join(projectRoot, "package.json");
const buildInfoPath = join(projectRoot, "build_info.py");
const desktopAppPath = join(projectRoot, "desktop_app.py");
const documentedReleaseGateExclusions = new Set(["desktopLayoutUi.test.js"]);

test("Windows release package contract tests are not skipped", () => {
  const source = readFileSync(fileURLToPath(import.meta.url), "utf8");

  assert.doesNotMatch(source, /test\.skip\(/);
});

test("Windows PyInstaller spec builds a normal GUI client without a console window", () => {
  const spec = readFileSync(pyinstallerSpecPath, "utf8");

  assert.match(spec, /name="SSH-Agent-Tool"/);
  assert.match(spec, /console=False/);
  assert.doesNotMatch(spec, /console=True/);
});

test("Windows build script rejects console-subsystem executables", () => {
  const script = readFileSync(buildScriptPath, "utf8");

  assert.match(script, /function Assert-WindowsGuiSubsystem/);
  assert.match(script, /\[System\.IO\.File\]::ReadAllBytes\(\$TargetExePath\)/);
  assert.match(script, /\[BitConverter\]::ToUInt16\(\$Bytes,\s*\$PeOffset\s*\+\s*24\s*\+\s*68\)/);
  assert.match(script, /\$Subsystem\s+-ne\s+2/);
  assert.match(script, /Assert-WindowsGuiSubsystem\s+\$ExePath/);
  assert.ok(
    script.indexOf("Assert-WindowsGuiSubsystem $ExePath") > script.indexOf('Invoke-CheckedCommand $PyInstaller'),
  );
});

test("Windows build script keeps PowerShell 5 parser messages ASCII safe", () => {
  const script = readFileSync(buildScriptPath, "utf8");

  assert.doesNotMatch(script, /[^\x00-\x7F]/);
});

test("Windows build scripts resolve tool paths without a developer-specific user directory", () => {
  const buildScript = readFileSync(buildScriptPath, "utf8");
  const releaseScript = readFileSync(releasePackageScriptPath, "utf8");
  const combined = `${buildScript}\n${releaseScript}`;

  assert.doesNotMatch(combined, /C:\\Users\\luojixiang1/i);
  assert.match(combined, /function Resolve-ToolPath/);
  assert.match(combined, /Get-Command\s+\$CommandName/);
  assert.match(combined, /\$env:USERPROFILE/);
  assert.match(buildScript, /SSH_AGENT_NODE_BIN/);
  assert.match(buildScript, /SSH_AGENT_PNPM/);
  assert.match(buildScript, /SSH_AGENT_PYINSTALLER/);
  assert.match(releaseScript, /SSH_AGENT_NODE_BIN/);
  assert.match(releaseScript, /SSH_AGENT_PNPM/);
  assert.match(releaseScript, /SSH_AGENT_PYTHON/);
});

test("Windows build script stops stale release exe before rebuilding dist", () => {
  const script = readFileSync(buildScriptPath, "utf8");

  assert.match(script, /function Stop-RunningReleaseExe/);
  assert.match(script, /Get-CimInstance\s+Win32_Process/);
  assert.match(script, /SSH-Agent-Tool\.exe/);
  assert.doesNotMatch(script, /SSH-Agent-Tool-Preview\.exe/);
  assert.match(script, /Stop-RunningReleaseExe\s+\$ExePath/);
  assert.ok(script.indexOf("Stop-RunningReleaseExe $ExePath") < script.indexOf('Invoke-CheckedCommand $Pnpm "build"'));
});

test("Windows build script Chinese output is not mojibake", () => {
  const script = readFileSync(buildScriptPath, "utf8");

  assert.deepEqual(findSuspiciousLocalizationText(script), []);
});

test("release package script creates versioned standalone zip with stable manifest", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /param\s*\(/);
  assert.match(script, /\$Version/);
  assert.match(script, /\$ReleaseRoot/);
  assert.match(script, /\$SourceExe/);
  assert.match(script, /SSH-Agent-Tool\.exe/);
  assert.doesNotMatch(script, /SSH-Agent-Tool-Preview\.exe/);
  assert.match(script, /Get-FileHash[\s\S]*SHA256/);
  assert.match(script, /manifest\.json/);
  assert.match(script, /使用说明\.txt/);
  assert.match(script, /function Invoke-ReleaseVerification/);
  assert.match(script, /ForEach-Object\s*\{\s*Write-Host\s+\$_\s*\}/);
  assert.match(script, /pnpm\s+run\s+test:release/);
  assert.match(script, /unittest\s+discover/);
  assert.match(script, /pytest/);
  assert.match(script, /verification\s+=\s+\$PublicVerification/);
  assert.match(script, /Compress-Archive/);
  assert.match(script, /SSH-Agent-Tool-\$Version\.zip/);
  assert.match(script, /updateChannel = "stable"/);
});

test("release package zip extracts to a directly runnable client root", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /\$PackageArchiveRoot\s*=\s*Join-Path\s+\$PackageDir\s+"\*"/);
  assert.match(script, /Compress-Archive\s+-Path\s+\$PackageArchiveRoot\s+-DestinationPath\s+\$ZipPath\s+-Force/);
  assert.match(script, /\$ZipRootExeEntry\s*=\s*\$ZipArchive\.Entries\s*\|\s*Where-Object\s*\{\s*\$_.FullName\s+-eq\s+"SSH-Agent-Tool\.exe"\s*\}/);
  assert.match(script, /ZIP 根目录缺少 SSH-Agent-Tool\.exe/);
  assert.doesNotMatch(script, /Compress-Archive\s+-LiteralPath\s+\$PackageDir\s+-DestinationPath\s+\$ZipPath\s+-Force/);
});

test("release package skipped verification metadata points to the formal release entry", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /command\s*=\s*"build-release-package\.ps1 -SkipVerification"/);
  assert.doesNotMatch(script, /command\s*=\s*"build-trial-package\.ps1 -SkipVerification"/);
});

function assertReleaseGateIncludesTestFile(fileName) {
  const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const releaseTestCommand = manifest.scripts["test:release"];
  const source = readFileSync(join(projectRoot, "src", fileName), "utf8");
  const usesSourceDirectory = /(?:^|\s)\.\/src(?:\s|$)/.test(releaseTestCommand);

  if (!usesSourceDirectory) {
    assert.match(releaseTestCommand, new RegExp(fileName.replace(".", "\\.")));
  }
  assert.match(fileName, /\.test\.js$/);
  assert.ok(source.length > 0);
}

test("release verification uses the stable release frontend gate", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");
  const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  assert.match(script, /pnpm run test:release/);
  assert.match(script, /-Arguments\s+@\("run",\s*"test:release"\)/);
  assert.match(manifest.scripts["test:release"], /^node --test \.\/src\//);
});

test("release frontend gate covers every current frontend test file", () => {
  const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const releaseTestCommand = manifest.scripts["test:release"];
  const usesSourceDirectory = /^node --test \.\/src(?:\s|$)/.test(releaseTestCommand);
  const listedFiles = new Set(
    [...releaseTestCommand.matchAll(/\.\/src\/([^\s]+\.test\.js)/g)].map((match) => match[1]),
  );
  const allTestFiles = readdirSync(join(projectRoot, "src"))
    .filter((fileName) => fileName.endsWith(".test.js"))
    .sort();
  const releaseTestFiles = allTestFiles.filter((fileName) => !documentedReleaseGateExclusions.has(fileName));
  const missingFiles = usesSourceDirectory
    ? []
    : releaseTestFiles.filter((fileName) => !listedFiles.has(fileName));
  const accidentalExclusions = allTestFiles.filter((fileName) => !listedFiles.has(fileName) && !documentedReleaseGateExclusions.has(fileName));

  assert.deepEqual(missingFiles, []);
  assert.deepEqual(accidentalExclusions, []);
  assert.doesNotMatch(releaseTestCommand, /desktopLayoutUi\.test\.js/);
});

test("package scripts expose a complete frontend audit command", () => {
  const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  assert.equal(manifest.scripts["test"], "node --test");
  assert.equal(manifest.scripts["test:full"], manifest.scripts["test"]);
});

test("release frontend gate includes Chinese localization scanning", () => {
  assertReleaseGateIncludesTestFile("runtimeSafety.test.js");
  assertReleaseGateIncludesTestFile("localizationQuality.test.js");
  assertReleaseGateIncludesTestFile("windowsBuildScript.test.js");
});

test("release verification exposes Python Chinese localization scanning as its own gate", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /Invoke-VerificationStep -Name "Python 中文扫描"/);
  assert.match(script, /test_python_localization\.py/);
  assert.match(script, /python -m unittest test_python_localization\.py/);
});

test("release verification runs real SSH protocol smoke coverage before packaging", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");
  const smokeTestPath = join(projectRoot, "test_desktop_ssh_protocol_smoke.py");
  const smokeTest = readFileSync(smokeTestPath, "utf8");

  assert.match(script, /Invoke-VerificationStep -Name "SSH 协议自检"/);
  assert.match(script, /test_desktop_ssh_protocol_smoke\.py/);
  assert.match(script, /python -m unittest test_desktop_ssh_protocol_smoke\.py/);
  assert.match(smokeTest, /SshSessionManager/);
  assert.match(smokeTest, /send_input/);
  assert.match(smokeTest, /interrupt_command/);
  assert.match(smokeTest, /read_output/);
  assert.match(smokeTest, /close_session/);
});

test("release verification runs real SFTP protocol smoke coverage before packaging", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");
  const smokeTestPath = join(projectRoot, "test_desktop_sftp_protocol_smoke.py");
  const smokeTest = readFileSync(smokeTestPath, "utf8");

  assert.match(script, /Invoke-VerificationStep -Name "SFTP 协议自检"/);
  assert.match(script, /test_desktop_sftp_protocol_smoke\.py/);
  assert.match(script, /python -m unittest test_desktop_sftp_protocol_smoke\.py/);
  assert.match(smokeTest, /list_sftp_directory/);
  assert.match(smokeTest, /upload_sftp_file/);
  assert.match(smokeTest, /download_sftp_file/);
  assert.match(smokeTest, /rename_sftp_path/);
  assert.match(smokeTest, /delete_sftp_path/);
});

test("release frontend gate includes frontend runtime crash logging coverage", () => {
  assertReleaseGateIncludesTestFile("frontendRuntimeLogUi.test.js");
});

test("release frontend gate includes SSH terminal control coverage", () => {
  assertReleaseGateIncludesTestFile("sshInterruptUi.test.js");
});

test("release frontend gate includes SSH terminal recovery coverage", () => {
  assertReleaseGateIncludesTestFile("terminalRecoveryUi.test.js");
});

test("release frontend gate includes SSH terminal tab model recovery coverage", () => {
  assertReleaseGateIncludesTestFile("terminalTabs.test.js");
});

test("release frontend gate includes backup export credential coverage UI", () => {
  assertReleaseGateIncludesTestFile("backupUi.test.js");
});

test("release frontend gate includes Agent chat reliability coverage", () => {
  assertReleaseGateIncludesTestFile("agentChatUi.test.js");
});

test("release frontend gate includes core SSH terminal interaction coverage", () => {
  assertReleaseGateIncludesTestFile("connectionState.test.js");
  assertReleaseGateIncludesTestFile("terminalHistory.test.js");
  assertReleaseGateIncludesTestFile("terminalCopyShortcutUi.test.js");
  assertReleaseGateIncludesTestFile("terminalPasteShortcutUi.test.js");
  assertReleaseGateIncludesTestFile("terminalExportToolbarUi.test.js");
});

test("release frontend gate includes complete SSH terminal client coverage", () => {
  assertReleaseGateIncludesTestFile("terminalOutput.test.js");
  assertReleaseGateIncludesTestFile("terminalAutoConnectFailureUi.test.js");
  assertReleaseGateIncludesTestFile("terminalInputFailureUi.test.js");
  assertReleaseGateIncludesTestFile("terminalInputSuccessUi.test.js");
  assertReleaseGateIncludesTestFile("contextMenuActions.test.js");
  assertReleaseGateIncludesTestFile("terminalContextMenuCompactUi.test.js");
  assertReleaseGateIncludesTestFile("terminalContextMenuServerActionsUi.test.js");
  assertReleaseGateIncludesTestFile("terminalDisconnectUi.test.js");
  assertReleaseGateIncludesTestFile("terminalResizeUi.test.js");
  assertReleaseGateIncludesTestFile("terminalSensitivePromptUi.test.js");
  assertReleaseGateIncludesTestFile("terminalSurfaceScrollPriorityUi.test.js");
  assertReleaseGateIncludesTestFile("terminalSurfaceSelectionUi.test.js");
  assertReleaseGateIncludesTestFile("terminalAutocompleteUi.test.js");
  assertReleaseGateIncludesTestFile("terminalCommandInputEscapeUi.test.js");
  assertReleaseGateIncludesTestFile("terminalCommandInputLayoutUi.test.js");
  assertReleaseGateIncludesTestFile("terminalHistorySearchShortcutUi.test.js");
});

test("release frontend gate includes Windows client workflow coverage", () => {
  assertReleaseGateIncludesTestFile("serverManagement.test.js");
  assertReleaseGateIncludesTestFile("hostConnectionModalUi.test.js");
  assertReleaseGateIncludesTestFile("hostEditorAuthUi.test.js");
  assertReleaseGateIncludesTestFile("serverRemovalUi.test.js");
  assertReleaseGateIncludesTestFile("serverRowActionsUi.test.js");
  assertReleaseGateIncludesTestFile("modelSettings.test.js");
  assertReleaseGateIncludesTestFile("modelSettingsSaveFetchUi.test.js");
  assertReleaseGateIncludesTestFile("modelSettingsUi.test.js");
  assertReleaseGateIncludesTestFile("sftpBookmarks.test.js");
  assertReleaseGateIncludesTestFile("sftpNavigation.test.js");
  assertReleaseGateIncludesTestFile("sftpUiLayout.test.js");
  assertReleaseGateIncludesTestFile("portForwardSettings.test.js");
  assertReleaseGateIncludesTestFile("backupData.test.js");
  assertReleaseGateIncludesTestFile("backupModalLayout.test.js");
  assertReleaseGateIncludesTestFile("releaseInfo.test.js");
  assertReleaseGateIncludesTestFile("releaseInfoUi.test.js");
  assertReleaseGateIncludesTestFile("sshAutoPortForwardUi.test.js");
  assertReleaseGateIncludesTestFile("windowsClientActionsUi.test.js");
  assertReleaseGateIncludesTestFile("windowsClientTitle.test.js");
});

test("release frontend gate includes desktop api contract coverage", () => {
  assertReleaseGateIncludesTestFile("desktopApiContract.test.js");
});

test("release package has a formal script name that delegates to the Windows client package builder", () => {
  const script = readFileSync(releasePackageAliasScriptPath, "utf8");

  assert.match(script, /build-windows-client-package\.ps1/);
  assert.doesNotMatch(script, /build-trial-package\.ps1/);
  assert.match(script, /@PSBoundParameters/);
  assert.match(script, /Release package entry/);
  assert.deepEqual(findSuspiciousLocalizationText(script), []);
});

test("legacy trial package script is only a compatibility delegate", () => {
  const script = readFileSync(legacyTrialPackageScriptPath, "utf8");

  assert.match(script, /build-windows-client-package\.ps1/);
  assert.match(script, /@PSBoundParameters/);
  assert.doesNotMatch(script, /function Invoke-ReleaseVerification/);
  assert.doesNotMatch(script, /Compress-Archive/);
  assert.deepEqual(findSuspiciousLocalizationText(script), []);
});

test("formal release entry shows normal Windows client wording", () => {
  const script = readFileSync(releasePackageAliasScriptPath, "utf8");

  assert.match(script, /formal Windows client release package/);
  assert.doesNotMatch(script, /compatible builder/i);
  assert.doesNotMatch(script, /trial package/i);
});

test("package scripts expose the formal Windows release package command", () => {
  const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  assert.equal(manifest.name, "ssh-agent-tool");
  assert.doesNotMatch(manifest.name, /preview|trial/i);
  assert.equal(
    manifest.scripts["package:release"],
    "powershell -NoProfile -ExecutionPolicy Bypass -File ./build-release-package.ps1",
  );
});

test("release package readme avoids trial or preview product wording", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.doesNotMatch(script, /trial package/i);
  assert.match(script, /SSHAgentToolPreview/);
});

test("release package script rebuilds the Windows exe before packaging", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /\[switch\]\$SkipExeBuild/);
  assert.match(script, /\$BuildExeScript\s*=\s*Join-Path\s+\$ProjectRoot\s+"build-windows-exe\.ps1"/);
  assert.match(script, /function Invoke-WindowsExeBuild/);
  assert.match(script, /build-windows-exe\.ps1/);
  assert.match(script, /Invoke-WindowsExeBuild/);
  assert.match(script, /\nInvoke-WindowsExeBuild\s*\n\s*if \(-not \(Test-Path -LiteralPath \$SourceExe\)\)/);
});

test("release package embeds the release version into standalone exe builds", () => {
  const buildScript = readFileSync(buildScriptPath, "utf8");
  const releaseScript = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(buildScript, /\[string\]\$Version\s*=\s*"dev"/);
  assert.match(buildScript, /\$BuildInfoPath\s*=\s*Join-Path\s+\$ProjectRoot\s+"build_info\.py"/);
  assert.match(buildScript, /embedded release metadata for standalone exe mode/);
  assert.match(buildScript, /BUILD_VERSION\s*=\s*"\$SafeVersion"/);
  assert.match(releaseScript, /Invoke-CheckedCommand\s+-Command\s+"powershell"\s+-Arguments\s+@\("-NoProfile",\s*"-ExecutionPolicy",\s*"Bypass",\s*"-File",\s*\$BuildExeScript,\s*"-Version",\s*\$Version\)/);
});

test("Windows exe build restores local dev build info after embedding release metadata", () => {
  const buildScript = readFileSync(buildScriptPath, "utf8");
  const buildInfo = readFileSync(buildInfoPath, "utf8");

  assert.match(buildInfo, /BUILD_VERSION\s*=\s*"dev"/);
  assert.match(buildInfo, /BUILD_PACKAGE_NAME\s*=\s*""/);
  assert.match(buildInfo, /BUILD_UPDATE_CHANNEL\s*=\s*"local"/);
  assert.match(buildScript, /function Restore-DefaultBuildInfo/);
  assert.match(buildScript, /Restore-DefaultBuildInfo/);
  assert.ok(
    buildScript.lastIndexOf("Restore-DefaultBuildInfo") > buildScript.indexOf("finally {"),
    "build script should restore build_info.py in the outer finally block",
  );
});

test("release package manifest carries future update channel metadata", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /appName\s+=\s+"SSH Agent 工具"/);
  assert.match(script, /updateCheckUrl/);
  assert.match(script, /releaseNotesUrl/);
  assert.match(script, /supportUrl/);
  assert.match(script, /updatePolicy/);
  assert.match(script, /currentPackageUrl/);
});

test("release package publishes verification status without developer command lines", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /function Convert-ToPublicVerification/);
  assert.match(script, /\$PublicVerification\s*=\s*Convert-ToPublicVerification\s+-Verification\s+\$Verification/);
  assert.match(script, /verification\s+=\s+\$PublicVerification/);
  assert.doesNotMatch(script, /构建验证\s*\n\$[\s\S]*\$\(\$Verification\s*\|/);
  assert.doesNotMatch(script, /"\[\$\(\$_.status\)\] \$\(\$_.name\)：\$\(\$_.result\).*?\$\(\$_.command\)/);
});

test("release package script emits latest update manifest for hosting", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /\$LatestManifestPath/);
  assert.match(script, /latest\.json/);
  assert.match(script, /\$ZipHash/);
  assert.match(script, /packageSha256/);
  assert.match(script, /currentPackageUrl\s+=\s+\$CurrentPackageUrl/);
  assert.match(script, /Write-Utf8File\s+-Path\s+\$LatestManifestPath/);
});

test("latest update manifest carries the same updater policy text", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");
  const latestManifestSource = script.slice(script.indexOf("$LatestManifest = [ordered]@{"), script.indexOf("Write-Utf8File -Path $LatestManifestPath"));

  assert.match(latestManifestSource, /updatePolicy\s+=\s+"支持远程版本清单和应用内检查更新。"/);
  assert.doesNotMatch(latestManifestSource, /后续可接入远程版本清单|后续可将 updateCheckUrl/);
});

test("release package does not publish a confusing root quick-trial exe", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.doesNotMatch(script, /\$StandaloneExePath\s*=\s*Join-Path\s+\$ReleaseRoot\s+"SSH-Agent-Tool\.exe"/);
  assert.doesNotMatch(script, /Copy-Item\s+-LiteralPath\s+\$SourceExe\s+-Destination\s+\$StandaloneExePath\s+-Force/);
  assert.doesNotMatch(script, /\$StandaloneExeHash\s*=\s*\(Get-FileHash\s+-LiteralPath\s+\$StandaloneExePath\s+-Algorithm\s+SHA256\)\.Hash/);
  assert.match(script, /standaloneExe\s+=\s+"SSH-Agent-Tool\.exe"/);
  assert.match(script, /standaloneExeSha256\s+=\s+\$ExeHash/);
  assert.doesNotMatch(script, /快速试用.*release 目录里的 SSH-Agent-Tool\.exe/);
  assert.doesNotMatch(script, /优先打开 release\\当前正式版\\SSH-Agent-Tool\.exe/);
});

test("release package does not publish extra compatibility client folders", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.doesNotMatch(script, /\$ClientDir\s*=/);
  assert.doesNotMatch(script, /\$CurrentClientDir\s*=/);
  assert.match(script, /\$LegacyCompatibilityClientDirs\s*=\s*@\("当前正式版"\)/);
  assert.doesNotMatch(script, /Copy-Item\s+-LiteralPath\s+\$PackageExe\s+-Destination\s+\$ClientExePath/);
  assert.doesNotMatch(script, /Copy-Item\s+-LiteralPath\s+\$PackageExe\s+-Destination\s+\$CurrentClientExePath/);
  assert.doesNotMatch(script, /compatCurrentClientExecutable/);
});

test("release package readme points users to the formal Windows client exe first", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /普通用户优先打开当前目录中的 SSH-Agent-Tool\.exe/);
  assert.match(script, /用户交付根目录每次打包都会刷新，只保留普通客户端入口、说明、版本清单和 ZIP/);
  assert.match(script, /给用户分发时只使用“Windows客户端”“最新版Windows客户端”“正式Windows客户端”或“用户交付”目录，不需要运行任何 BAT、CMD、PowerShell 脚本/);
  assert.match(script, /不要从 release 根目录里的旧版本文件夹或开发目录启动/);
  assert.match(script, /如果错误里出现 index-BCGy_mkD\.js、Power is not defined 或 exportConnectionCheckReport is not defined/);
  assert.match(script, /请删除旧解压目录、旧桌面快捷方式和旧历史 ZIP/);
  assert.doesNotMatch(script, /currentClientFolder/);
  assert.doesNotMatch(script, /currentClientExecutable/);
  assert.doesNotMatch(script, /compatCurrentClientExecutable/);
});

test("release package writes a root guide that avoids old packages and scripts", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /\$ReleaseRootGuidePath\s*=\s*Join-Path\s+\$ReleaseRoot\s+"请先打开这里\.txt"/);
  assert.match(script, /Write-Utf8File\s+-Path\s+\$ReleaseRootGuidePath\s+-Content\s+\$ReleaseRootGuide/);
  assert.match(script, /用户交付\\SSH-Agent-Tool\.exe/);
  assert.match(script, /最新版Windows客户端\\SSH-Agent-Tool\.exe/);
  assert.match(script, /不要打开旧版本目录、历史 ZIP 或任何脚本文件/);
  assert.match(script, /如果其他电脑提示 Power is not defined/);
  assert.match(script, /旧快捷方式可能仍指向旧 EXE/);
});

test("release root guide uses formal client wording instead of trial wording", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");
  const guideSource = script.slice(script.indexOf("$ReleaseRootGuide = @\""), script.indexOf("Write-Utf8File -Path $ReleaseRootGuidePath"));

  assert.match(guideSource, /如果你只是要打开工具或交付给用户/);
  assert.doesNotMatch(guideSource, /试用/);
});

test("release package creates a clean user delivery folder", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /\$DeliveryDir\s*=\s*Join-Path\s+\$ReleaseRoot\s+"用户交付"/);
  assert.match(script, /\$DeliveryExePath\s*=\s*Join-Path\s+\$DeliveryDir\s+"SSH-Agent-Tool\.exe"/);
  assert.doesNotMatch(script, /\$DeliveryCurrentClientDir\s*=/);
  assert.match(script, /\$DeliveryZipPath\s*=\s*Join-Path\s+\$DeliveryDir\s+\(Split-Path\s+-Leaf\s+\$ZipPath\)/);
  assert.match(script, /Remove-Item\s+-LiteralPath\s+\$DeliveryDir\s+-Recurse\s+-Force/);
  assert.match(script, /Copy-Item\s+-LiteralPath\s+\$PackageExe\s+-Destination\s+\$DeliveryExePath\s+-Force/);
  assert.doesNotMatch(script, /Copy-Item\s+-LiteralPath\s+\$CurrentClientDir\s+-Destination/);
  assert.match(script, /Copy-Item\s+-LiteralPath\s+\$ZipPath\s+-Destination\s+\$DeliveryZipPath\s+-Force/);
  assert.match(script, /Copy-Item\s+-LiteralPath\s+\$LatestManifestPath\s+-Destination\s+\$DeliveryLatestManifestPath\s+-Force/);
  assert.match(script, /用户交付目录：\$DeliveryDir/);
});

test("release package creates a plain formal Windows client folder", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /\$PlainClientDir\s*=\s*Join-Path\s+\$ReleaseRoot\s+"正式Windows客户端"/);
  assert.match(script, /\$PlainClientExePath\s*=\s*Join-Path\s+\$PlainClientDir\s+"SSH-Agent-Tool\.exe"/);
  assert.match(script, /Remove-Item\s+-LiteralPath\s+\$PlainClientDir\s+-Recurse\s+-Force/);
  assert.match(script, /Copy-Item\s+-LiteralPath\s+\$PackageExe\s+-Destination\s+\$PlainClientExePath\s+-Force/);
  assert.match(script, /catch\s+\[System\.IO\.IOException\][\s\S]*正式 Windows 客户端目录中的旧 EXE 正在运行/);
  assert.match(script, /\$FallbackPlainClientDir\s*=\s*Join-Path\s+\$ReleaseRoot\s+"正式Windows客户端-\$PackageName"/);
  assert.match(script, /Copy-Item\s+-LiteralPath\s+\$LatestManifestPath\s+-Destination\s+\$PlainClientLatestManifestPath\s+-Force/);
  assert.match(script, /正式 Windows 客户端目录：\$PlainClientDir/);
  assert.doesNotMatch(script, /PlainClientZipPath/);
});

test("release package creates an obvious direct-run Windows client folder and zip", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /\$DirectRunClientDir\s*=\s*Join-Path\s+\$ReleaseRoot\s+"可直接运行Windows客户端"/);
  assert.match(script, /\$DirectRunClientExePath\s*=\s*Join-Path\s+\$DirectRunClientDir\s+"SSH-Agent-Tool\.exe"/);
  assert.match(script, /\$DirectRunClientZipPath\s*=\s*Join-Path\s+\$ReleaseRoot\s+"可直接运行Windows客户端\.zip"/);
  assert.match(script, /Remove-Item\s+-LiteralPath\s+\$DirectRunClientDir\s+-Recurse\s+-Force/);
  assert.match(script, /Copy-Item\s+-LiteralPath\s+\$PackageExe\s+-Destination\s+\$DirectRunClientExePath\s+-Force/);
  assert.match(script, /Compress-Archive\s+-Path\s+\$DirectRunClientArchiveRoot\s+-DestinationPath\s+\$DirectRunClientZipPath\s+-Force/);
  assert.match(script, /可直接运行Windows客户端\\SSH-Agent-Tool\.exe/);
  assert.doesNotMatch(script, /Join-Path\s+\$DirectRunClientDir\s+"[^"]+\.(?:bat|cmd|ps1|psm1)"/);
});

test("release package publishes an unmistakable latest delivery zip", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /\$LatestDeliveryZipPath\s*=\s*Join-Path\s+\$ReleaseRoot\s+"请发这个-最新版Windows客户端\.zip"/);
  assert.match(script, /Remove-Item\s+-LiteralPath\s+\$LatestDeliveryZipPath\s+-Force/);
  assert.match(script, /Copy-Item\s+-LiteralPath\s+\$DirectRunClientZipPath\s+-Destination\s+\$LatestDeliveryZipPath\s+-Force/);
  assert.match(script, /\$LatestDeliveryZipHash\s*=\s*\(Get-FileHash\s+-LiteralPath\s+\$LatestDeliveryZipPath\s+-Algorithm\s+SHA256\)\.Hash/);
  assert.match(script, /请优先发送：请发这个-最新版Windows客户端\.zip/);
  assert.match(script, /这个文件每次打包都会刷新，避免误发历史目录里的旧版本/);
  assert.match(script, /最新版交付 ZIP：\$LatestDeliveryZipPath/);
  assert.match(script, /推荐分发 ZIP SHA256：\$LatestDeliveryZipHash/);
  assert.match(script, /在线更新 ZIP SHA256：\$ZipHash/);
});

test("release package creates a send-only folder without historical packages", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /\$SendOnlyDir\s*=\s*Join-Path\s+\$ReleaseRoot\s+"只发这个"/);
  assert.match(script, /\$SendOnlyZipPath\s*=\s*Join-Path\s+\$SendOnlyDir\s+"请发这个-最新版Windows客户端\.zip"/);
  assert.match(script, /\$SendOnlyChecksumPath\s*=\s*Join-Path\s+\$SendOnlyDir\s+"SHA256校验\.txt"/);
  assert.match(script, /\$SendOnlyGuidePath\s*=\s*Join-Path\s+\$SendOnlyDir\s+"先看这里\.txt"/);
  assert.match(script, /\$SendOnlyFingerprintPath\s*=\s*Join-Path\s+\$SendOnlyDir\s+"版本指纹\.txt"/);
  assert.match(script, /\$SendOnlyReadmeAliasPath\s*=\s*Join-Path\s+\$SendOnlyDir\s+"README\.txt"/);
  assert.match(script, /\$SendOnlyVersionAliasPath\s*=\s*Join-Path\s+\$SendOnlyDir\s+"VERSION\.txt"/);
  assert.match(script, /\$SendOnlyBugReportAliasPath\s*=\s*Join-Path\s+\$SendOnlyDir\s+"BUG_REPORT\.txt"/);
  assert.match(script, /Remove-Item\s+-LiteralPath\s+\$SendOnlyDir\s+-Recurse\s+-Force/);
  assert.match(script, /Copy-Item\s+-LiteralPath\s+\$LatestDeliveryZipPath\s+-Destination\s+\$SendOnlyZipPath\s+-Force/);
  assert.match(script, /Copy-Item\s+-LiteralPath\s+\$LatestManifestPath\s+-Destination\s+\$SendOnlyLatestManifestPath\s+-Force/);
  assert.match(script, /Copy-Item\s+-LiteralPath\s+\$PackageSupportTemplatePath\s+-Destination\s+\$SendOnlyBugReportAliasPath\s+-Force/);
  assert.match(script, /Write-Utf8File\s+-Path\s+\$SendOnlyReadmeAliasPath\s+-Content\s+\$SendOnlyGuide/);
  assert.match(script, /Write-Utf8File\s+-Path\s+\$SendOnlyVersionAliasPath\s+-Content\s+\$SendOnlyFingerprint/);
  assert.match(script, /只发这个目录只保留最新版分发文件/);
  assert.match(script, /Write-Utf8File\s+-Path\s+\$SendOnlyFingerprintPath\s+-Content\s+\$SendOnlyFingerprint/);
  assert.match(script, /\$SendOnlyHistoricalPackages\s*=\s*@\(Get-ChildItem\s+-LiteralPath\s+\$SendOnlyDir\s+-File/);
  assert.match(script, /发布包自检失败，只发这个目录不应包含历史版本文件/);
  assert.match(script, /只发这个目录：\$SendOnlyDir/);
});

test("release package creates a host-ready online update folder", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /\$OnlineUpdateDir\s*=\s*Join-Path\s+\$ReleaseRoot\s+"在线更新发布"/);
  assert.match(script, /\$OnlineUpdateZipPath\s*=\s*Join-Path\s+\$OnlineUpdateDir\s+\(Split-Path\s+-Leaf\s+\$ZipPath\)/);
  assert.match(script, /\$OnlineUpdateLatestManifestPath\s*=\s*Join-Path\s+\$OnlineUpdateDir\s+"latest\.json"/);
  assert.match(script, /\$OnlineUpdateGuidePath\s*=\s*Join-Path\s+\$OnlineUpdateDir\s+"在线更新发布说明\.txt"/);
  assert.match(script, /Remove-Item\s+-LiteralPath\s+\$OnlineUpdateDir\s+-Recurse\s+-Force/);
  assert.match(script, /Copy-Item\s+-LiteralPath\s+\$ZipPath\s+-Destination\s+\$OnlineUpdateZipPath\s+-Force/);
  assert.match(script, /Copy-Item\s+-LiteralPath\s+\$LatestManifestPath\s+-Destination\s+\$OnlineUpdateLatestManifestPath\s+-Force/);
  assert.match(script, /把本目录里的 latest\.json 和 ZIP 放到同一个 HTTP\/HTTPS 目录/);
  assert.match(script, /\$OnlineUpdateUnexpectedFiles\s*=\s*@\(Get-ChildItem\s+-LiteralPath\s+\$OnlineUpdateDir\s+-File/);
  assert.match(script, /发布包自检失败，在线更新发布目录只能包含 ZIP、latest\.json 和说明/);
  assert.match(script, /在线更新发布目录：\$OnlineUpdateDir/);
  assert.doesNotMatch(script, /Join-Path\s+\$OnlineUpdateDir\s+"SSH-Agent-Tool\.exe"/);
}
);

test("client zips include an unpacked release fingerprint for cross-machine checks", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /\$PackageFingerprintPath\s*=\s*Join-Path\s+\$PackageDir\s+"版本指纹\.txt"/);
  assert.match(script, /\$DirectRunClientFingerprintPath\s*=\s*Join-Path\s+\$DirectRunClientDir\s+"版本指纹\.txt"/);
  assert.match(script, /\$StandardClientFingerprintPath\s*=\s*Join-Path\s+\$StandardClientDir\s+"版本指纹\.txt"/);
  assert.match(script, /Write-Utf8File\s+-Path\s+\$PackageFingerprintPath\s+-Content\s+\$ClientFingerprint/);
  assert.match(script, /Copy-Item\s+-LiteralPath\s+\$PackageFingerprintPath\s+-Destination\s+\$DirectRunClientFingerprintPath\s+-Force/);
  assert.match(script, /Copy-Item\s+-LiteralPath\s+\$PackageFingerprintPath\s+-Destination\s+\$StandardClientFingerprintPath\s+-Force/);
  assert.match(script, /\$ZipFingerprintEntry\s*=\s*\$ZipArchive\.Entries\s*\|\s*Where-Object\s*\{\s*\$_\.FullName\s+-eq\s+"版本指纹\.txt"\s*\}/);
  assert.match(script, /\$DirectRunZipFingerprintEntry\s*=\s*\$DirectRunZipArchive\.Entries\s*\|\s*Where-Object\s*\{\s*\$_\.FullName\s+-eq\s+"版本指纹\.txt"\s*\}/);
  assert.match(script, /\$StandardZipFingerprintEntry\s*=\s*\$StandardZipArchive\.Entries\s*\|\s*Where-Object\s*\{\s*\$_\.FullName\s+-eq\s+"版本指纹\.txt"\s*\}/);
  assert.match(script, /解压目录内版本指纹/);
});

test("client zips include ASCII named help files for cross-machine extraction", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /\$PackageReadmeAliasPath\s*=\s*Join-Path\s+\$PackageDir\s+"README\.txt"/);
  assert.match(script, /\$PackageVersionAliasPath\s*=\s*Join-Path\s+\$PackageDir\s+"VERSION\.txt"/);
  assert.match(script, /\$PackageBugReportAliasPath\s*=\s*Join-Path\s+\$PackageDir\s+"BUG_REPORT\.txt"/);
  assert.match(script, /Write-Utf8File\s+-Path\s+\$PackageReadmeAliasPath\s+-Content\s+\$Readme/);
  assert.match(script, /Write-Utf8File\s+-Path\s+\$PackageVersionAliasPath\s+-Content\s+\$ClientFingerprint/);
  assert.match(script, /Write-Utf8File\s+-Path\s+\$PackageBugReportAliasPath\s+-Content\s+\$SupportTemplate/);
  assert.match(script, /\$ZipReadmeAliasEntry\s*=\s*\$ZipArchive\.Entries\s*\|\s*Where-Object\s*\{\s*\$_\.FullName\s+-eq\s+"README\.txt"\s*\}/);
  assert.match(script, /\$ZipVersionAliasEntry\s*=\s*\$ZipArchive\.Entries\s*\|\s*Where-Object\s*\{\s*\$_\.FullName\s+-eq\s+"VERSION\.txt"\s*\}/);
  assert.match(script, /\$ZipBugReportAliasEntry\s*=\s*\$ZipArchive\.Entries\s*\|\s*Where-Object\s*\{\s*\$_\.FullName\s+-eq\s+"BUG_REPORT\.txt"\s*\}/);
  assert.match(script, /ZIP 根目录缺少 README\.txt/);
  assert.match(script, /ZIP 根目录缺少 VERSION\.txt/);
  assert.match(script, /ZIP 根目录缺少 BUG_REPORT\.txt/);
});

test("client zips include a bug report template with startup diagnostics", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  const templateStart = script.indexOf("$SupportTemplate = @\"");
  const templateEnd = script.indexOf("Write-Utf8File -Path $PackageSupportTemplatePath", templateStart);
  assert.notEqual(templateStart, -1, "support template should exist");
  assert.notEqual(templateEnd, -1, "support template should end before writing files");
  const templateSource = script.slice(templateStart, templateEnd);

  assert.match(script, /\$PackageSupportTemplatePath\s*=\s*Join-Path\s+\$PackageDir\s+"问题反馈模板\.txt"/);
  assert.match(script, /Write-Utf8File\s+-Path\s+\$PackageSupportTemplatePath\s+-Content\s+\$SupportTemplate/);
  assert.match(script, /Copy-Item\s+-LiteralPath\s+\$PackageSupportTemplatePath\s+-Destination\s+\$DirectRunClientSupportTemplatePath\s+-Force/);
  assert.match(script, /\$ZipSupportTemplateEntry\s*=\s*\$ZipArchive\.Entries\s*\|\s*Where-Object\s*\{\s*\$_\.FullName\s+-eq\s+"问题反馈模板\.txt"\s*\}/);
  assert.match(templateSource, /普通用户不需要打开 PowerShell，也不需要运行 BAT、CMD 或脚本/);
  assert.match(templateSource, /先确认是完整解压后双击 SSH-Agent-Tool\.exe/);
  assert.match(templateSource, /如果出现错误页，请优先反馈截图、当前页面脚本、清单前端脚本和版本指纹\.txt/);
  assert.match(templateSource, /实际启动的 SSH-Agent-Tool\.exe 完整路径/);
  assert.match(templateSource, /桌面快捷方式右键属性里的“目标”/);
  assert.match(templateSource, /错误页里的 dist\/assets\/index-\*\.js 文件名/);
  assert.match(templateSource, /版本指纹\.txt 里的前端资源/);
  assert.match(templateSource, /开发者补充自检/);
  assert.match(templateSource, /Start-Process -FilePath '\.\\SSH-Agent-Tool\.exe' -ArgumentList @\('--startup-smoke','--smoke-output','startup-smoke\.json'\)/);
  assert.match(templateSource, /%APPDATA%\\SSHAgentTool\\tool-logs/);
  assert.match(templateSource, /%APPDATA%\\SSHAgentTool\\diagnostic-packages/);
  assert.match(templateSource, /是否已运行“一键基础自检”/);
  assert.match(templateSource, /自检结果：通过\s*\/\s*失败\s*\/\s*跳过/);
  assert.match(templateSource, /是否已导出“基础自检报告”/);
  assert.match(templateSource, /失败或跳过的自检步骤名称/);
  assert.match(templateSource, /不要发送服务器密码、私钥、API Key、Token/);
  assert.doesNotMatch(templateSource, /如果工具无法打开，请在解压目录打开 PowerShell 执行/);
});

test("send-only folder exposes the bug report template before extraction", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /\$SendOnlySupportTemplatePath\s*=\s*Join-Path\s+\$SendOnlyDir\s+"问题反馈模板\.txt"/);
  assert.match(script, /Copy-Item\s+-LiteralPath\s+\$PackageSupportTemplatePath\s+-Destination\s+\$SendOnlySupportTemplatePath\s+-Force/);
  assert.match(script, /\$RequiredFiles\s*=\s*@\([\s\S]*\$SendOnlySupportTemplatePath/);
  assert.match(script, /只发这个目录：\$SendOnlyDir/);
});

test("send-only folder includes a human readable release fingerprint", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /版本指纹\.txt/);
  assert.match(script, /版本指纹/);
  assert.match(script, /版本：\$Version/);
  assert.match(script, /推荐分发 ZIP SHA256：\$LatestDeliveryZipHash/);
  assert.match(script, /EXE SHA256：\$ExeHash/);
  assert.match(script, /前端资源：\$\(\$FrontendAssets\.script\)/);
  assert.match(script, /前端资源 SHA256：\$\(\$FrontendAssets\.scriptSha256\)/);
  assert.match(script, /用于确认测试电脑是否打开了最新版客户端/);
});

test("release package self check validates send-only package fingerprints", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /\$SendOnlyFingerprintPath/);
  assert.match(script, /\$RequiredFiles\s*=\s*@\([\s\S]*\$SendOnlyFingerprintPath/);
  assert.match(script, /\$ActualSendOnlyZipHash\s*=\s*\(Get-FileHash\s+-LiteralPath\s+\$SendOnlyZipPath\s+-Algorithm\s+SHA256\)\.Hash/);
  assert.match(script, /\$ActualSendOnlyZipHash\s+-ne\s+\$LatestDeliveryZipHash/);
  assert.match(script, /只发这个目录 ZIP SHA256 与推荐分发 ZIP 不一致/);
  assert.match(script, /\$SendOnlyLatestData\s*=\s*Get-Content\s+-LiteralPath\s+\$SendOnlyLatestManifestPath\s+-Raw\s*\|\s*ConvertFrom-Json/);
  assert.match(script, /\$SendOnlyLatestData\.packageSha256\s+-ne\s+\$LatestData\.packageSha256/);
  assert.match(script, /\$SendOnlyLatestData\.frontendAssets\.scriptSha256\s+-ne\s+\$LatestData\.frontendAssets\.scriptSha256/);
  assert.match(script, /只发这个目录 latest\.json 与当前更新清单不一致/);
  assert.match(script, /\$SendOnlyFingerprintContent\s*=\s*Get-Content\s+-LiteralPath\s+\$SendOnlyFingerprintPath\s+-Raw/);
  assert.match(script, /\$SendOnlyFingerprintContent\.Contains\("前端资源：\$\(\$LatestData\.frontendAssets\.script\)"\)/);
  assert.match(script, /\$SendOnlyFingerprintContent\.Contains\("前端资源 SHA256：\$\(\$LatestData\.frontendAssets\.scriptSha256\)"\)/);
  assert.match(script, /只发这个目录版本指纹与 latest\.json 前端资源不一致/);
}
);

test("release package self check opens the send-only zip and rejects command-line launchers", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /\$SendOnlyZipArchive\s*=\s*\[System\.IO\.Compression\.ZipFile\]::OpenRead\(\$SendOnlyZipPath\)/);
  assert.match(script, /\$SendOnlyZipCommandLineLaunchers\s*=\s*@\(\$SendOnlyZipArchive\.Entries\s*\|/);
  assert.match(script, /发布包自检失败，只发这个目录推荐 ZIP 内不应包含命令行启动入口/);
  assert.match(script, /\$SendOnlyZipArchive\.Dispose\(\)/);
});

test("send-only guide fingerprints the expected frontend asset for old-package troubleshooting", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /当前正确前端资源：\$\(\$FrontendAssets\.script\)/);
  assert.match(script, /如果报错路径里的前端资源不是上面这个文件名/);
  assert.match(script, /就是旧包、旧解压目录或旧快捷方式/);
  assert.match(script, /看错误页里的 dist\/assets\/index-\*\.js 文件名/);
  assert.match(script, /桌面快捷方式右键属性里的“目标”必须指向新解压目录/);
  assert.match(script, /反馈时请同时提供：实际启动路径、快捷方式目标、错误页 JS 文件名/);
});

test("send-only guide requires a clean extraction folder before cross-machine launch", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /先删旧目录，再解压到一个全新的空目录/);
  assert.match(script, /不要覆盖解压到旧目录/);
  assert.match(script, /不要继续使用旧桌面快捷方式/);
  assert.match(script, /第一次启动请直接双击新解压目录里的 SSH-Agent-Tool\.exe/);
});

test("send-only guide explains cross-machine WebView2 prerequisite", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /Windows 10\/11 x64/);
  assert.match(script, /Microsoft Edge WebView2 Runtime/);
  assert.match(script, /https:\/\/go\.microsoft\.com\/fwlink\/\?LinkId=2124703/);
  assert.match(script, /如果目标电脑没有 WebView2/);
});

test("send-only guide tells recipients to verify SSH with one-click basic smoke test", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");
  const start = script.indexOf("$SendOnlyGuide = @\"");
  const end = script.indexOf("\"@", start + 1);
  assert.notEqual(start, -1, "send-only guide template should exist");
  assert.notEqual(end, -1, "send-only guide template should close");
  const guideSource = script.slice(start, end);

  assert.match(guideSource, /一键基础自检/);
  assert.match(guideSource, /SSH 会话、回车执行、Ctrl\+C 中断/);
  assert.match(guideSource, /SFTP 临时文件读写和清理/);
});

test("release package creates a normal Windows client artifact name without launcher scripts", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /\$StandardClientDir\s*=\s*Join-Path\s+\$ReleaseRoot\s+"SSH-Agent-Windows-Client"/);
  assert.match(script, /\$StandardClientExePath\s*=\s*Join-Path\s+\$StandardClientDir\s+"SSH-Agent-Tool\.exe"/);
  assert.match(script, /\$StandardClientZipPath\s*=\s*Join-Path\s+\$ReleaseRoot\s+"SSH-Agent-Windows-Client\.zip"/);
  assert.match(script, /Copy-Item\s+-LiteralPath\s+\$PackageExe\s+-Destination\s+\$StandardClientExePath\s+-Force/);
  assert.match(script, /Compress-Archive\s+-Path\s+\$StandardClientArchiveRoot\s+-DestinationPath\s+\$StandardClientZipPath\s+-Force/);
  assert.match(script, /SSH-Agent-Windows-Client\\SSH-Agent-Tool\.exe/);
  assert.doesNotMatch(script, /Join-Path\s+\$StandardClientDir\s+"[^"]+\.(?:bat|cmd|ps1|psm1)"/);
});

test("release package script can read hosted update urls from environment variables", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /SSH_AGENT_UPDATE_CHECK_URL/);
  assert.match(script, /SSH_AGENT_PACKAGE_URL/);
  assert.match(script, /SSH_AGENT_RELEASE_NOTES_URL/);
  assert.match(script, /SSH_AGENT_SUPPORT_URL/);
  assert.match(script, /\[string\]::IsNullOrWhiteSpace\(\$UpdateCheckUrl\)/);
  assert.match(script, /\$UpdateCheckUrl\s*=\s*\$env:SSH_AGENT_UPDATE_CHECK_URL/);
  assert.match(script, /\$CurrentPackageUrl\s*=\s*\$env:SSH_AGENT_PACKAGE_URL/);
});

test("release package script infers package download url beside hosted latest manifest", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /function Resolve-CurrentPackageUrlFromUpdateCheckUrl/);
  assert.match(script, /\[System\.UriBuilder\]::new\(\$Uri\)/);
  assert.match(script, /EscapeDataString\(\$SafePackageFileName\)/);
  assert.match(script, /\$Builder\.Query\s*=\s*""/);
  assert.match(script, /\$Builder\.Fragment\s*=\s*""/);
  assert.match(script, /Resolve-CurrentPackageUrlFromUpdateCheckUrl\s+-UpdateCheckUrl\s+\$UpdateCheckUrl\s+-PackageFileName\s+\(Split-Path\s+-Leaf\s+\$ZipPath\)/);
  assert.ok(
    script.indexOf("Resolve-CurrentPackageUrlFromUpdateCheckUrl -UpdateCheckUrl $UpdateCheckUrl") <
      script.indexOf("$Manifest = [ordered]@{"),
  );
});

test("release package keeps latest manifest for online update without a batch launcher", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /latest\.json/);
  assert.match(script, /\$LatestManifestPath/);
  assert.doesNotMatch(script, /\$LatestLauncherPath/);
  assert.match(script, /启动最新版\.bat/);
  assert.match(script, /Remove-Item\s+-LiteralPath\s+\$LegacyLatestLauncherPath\s+-Force/);
  assert.doesNotMatch(script, /Write-Utf8BatchFile\s+-Path\s+\$LatestLauncherPath/);
  assert.match(script, /latest\.json 仅用于在线更新清单，不是启动入口/);
});


test("formal Windows client package does not expose command-line launchers", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /NoBatchLaunchersInFormalPackage/);
  assert.match(script, /EXE-first Windows client package/);
  assert.match(script, /\$BlockedLauncherExtensions\s*=\s*@\("\.bat",\s*"\.cmd",\s*"\.ps1",\s*"\.psm1"\)/);
  assert.match(script, /\$PackagedCommandLineLaunchers\s*=\s*@\(Get-ChildItem\s+-LiteralPath\s+\$PackageDir\s+-Recurse\s+-File/);
  assert.match(script, /\$BlockedLauncherExtensions\s+-contains\s+\$_.Extension\.ToLowerInvariant\(\)/);
  assert.doesNotMatch(script, /Write-Utf8BatchFile\s+-Path/);
  assert.doesNotMatch(script, /Join-Path\s+\$ToolboxDir\s+"[^"]+\.(?:bat|cmd|ps1|psm1)"/);
});

test("formal Windows client package keeps diagnostics inside the app instead of exposed scripts", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.doesNotMatch(script, /\$ToolboxDir\s*=/);
  assert.doesNotMatch(script, /高级诊断/);
  assert.doesNotMatch(script, /Write-Utf8File\s+-Path\s+\$[A-Za-z]+ScriptPath/);
  assert.doesNotMatch(script, /Join-Path\s+\$PackageDir\s+"[^"]+\.ps1"/);
  assert.doesNotMatch(script, /Join-Path\s+\$PackageDir\s+"[^"]+\.psm1"/);
  assert.match(script, /正常使用只双击 SSH-Agent-Tool\.exe/);
  assert.match(script, /正式包不提供 BAT、CMD 或 PowerShell 启动入口/);
});

test("formal Windows delivery root is the normal client surface", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /用户交付根目录每次打包都会刷新，只保留普通客户端入口、说明、版本清单和 ZIP/);
  assert.match(script, /工具日志和诊断包可在工具内导出/);
  assert.match(script, /给用户分发时只使用“Windows客户端”“最新版Windows客户端”“正式Windows客户端”或“用户交付”目录，不需要运行任何 BAT、CMD、PowerShell 脚本/);
  assert.match(script, /普通用户优先打开当前目录中的 SSH-Agent-Tool\.exe/);
  assert.match(script, /不要从 release 根目录里的旧版本文件夹或开发目录启动/);
  assert.doesNotMatch(script, /DeliveryCurrentClientDir/);
  assert.doesNotMatch(script, /\$CurrentClientDir\s*=/);
  assert.doesNotMatch(script, /\$ClientDir\s*=/);
  assert.doesNotMatch(script, /Set-HiddenFileSystemItem\s+-Path\s+\$ToolboxDir/);
});

test("release package refreshes an obvious latest Windows client directory", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /\$LatestClientDir\s*=\s*Join-Path\s+\$ReleaseRoot\s+"最新版Windows客户端"/);
  assert.match(script, /\$LatestClientExePath\s*=\s*Join-Path\s+\$LatestClientDir\s+"SSH-Agent-Tool\.exe"/);
  assert.match(script, /Remove-Item\s+-LiteralPath\s+\$LatestClientDir\s+-Recurse\s+-Force/);
  assert.match(script, /Copy-Item\s+-LiteralPath\s+\$PackageExe\s+-Destination\s+\$LatestClientExePath\s+-Force/);
  assert.match(script, /Copy-Item\s+-LiteralPath\s+\$LatestManifestPath\s+-Destination\s+\$LatestClientLatestManifestPath\s+-Force/);
  assert.match(script, /最新版 Windows 客户端目录：\$LatestClientDir/);
  assert.match(script, /最新版Windows客户端\\SSH-Agent-Tool\.exe/);
});

test("release package creates a primary normal Windows client folder", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /\$PrimaryClientDir\s*=\s*Join-Path\s+\$ReleaseRoot\s+"Windows客户端"/);
  assert.match(script, /\$PrimaryClientExePath\s*=\s*Join-Path\s+\$PrimaryClientDir\s+"SSH-Agent-Tool\.exe"/);
  assert.match(script, /Remove-Item\s+-LiteralPath\s+\$PrimaryClientDir\s+-Recurse\s+-Force/);
  assert.match(script, /Copy-Item\s+-LiteralPath\s+\$PackageExe\s+-Destination\s+\$PrimaryClientExePath\s+-Force/);
  assert.match(script, /\$PrimaryClientCommandLineLaunchers\s*=\s*@\(Get-ChildItem\s+-LiteralPath\s+\$PrimaryClientDir\s+-Recurse\s+-File/);
  assert.match(script, /\$PrimaryClientExeSubsystem\s*=\s*Get-WindowsPeSubsystem\s+-Path\s+\$PrimaryClientExePath/);
  assert.match(script, /普通用户优先打开当前目录中的 SSH-Agent-Tool\.exe/);
  assert.match(script, /Windows 客户端目录：\$PrimaryClientDir/);
});

test("release package script writes package checksum back into bundled manifest", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  const zipHashIndex = script.indexOf("$ZipHash");
  const manifestWriteIndexes = [...script.matchAll(/Write-Utf8File\s+-Path\s+\$ManifestPath/g)].map((match) => match.index);
  assert.ok(zipHashIndex > 0, "script should compute ZIP hash");
  assert.ok(manifestWriteIndexes.length >= 2, "script should write manifest before and after ZIP metadata is known");
  assert.ok(manifestWriteIndexes.some((index) => index > zipHashIndex), "script should rewrite manifest after ZIP hash is known");
  assert.match(script, /packageFile\s+=\s+\(Split-Path\s+-Leaf\s+\$ZipPath\)/);
  assert.match(script, /packageSha256\s+=\s+\$ZipHash/);
  assert.match(script, /packageSizeBytes\s+=\s+\$ZipItem\.Length/);
});

test("release package manifest records frontend asset fingerprint", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /function Get-FrontendAssetFingerprint/);
  assert.match(script, /dist\\index\.html/);
  assert.match(script, /frontendAssets\s+=\s+\$FrontendAssets/);
  assert.match(script, /scriptSha256/);
  assert.match(script, /stylesheetSha256/);
  assert.match(script, /\$ExpectedFrontendAssets\s*=\s*Get-FrontendAssetFingerprint/);
  assert.match(script, /\$ManifestData\.frontendAssets\.scriptSha256\s+-ne\s+\$ExpectedFrontendAssets\.scriptSha256/);
  assert.match(script, /\$StartupSmoke\.frontendAssets\.scriptSha256\s+-ne\s+\$ManifestData\.frontendAssets\.scriptSha256/);
});

test("release package script blocks stale frontend bundles with undefined report handlers", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /Test-FrontendBundleRuntimeSafety/);
  assert.match(script, /index-C55DkVKK\.js/);
  assert.match(script, /exportConnectionCheckReport/);
  assert.match(script, /function\s+exportConnectionCheckReport/);
  assert.match(script, /前端运行时自检失败/);
  assert.match(script, /Get-Content\s+-LiteralPath\s+\$ScriptPath\s+-Raw/);
});

test("release package script blocks known white-screen frontend signatures", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /index-BCGy_mkD\.js/);
  assert.match(script, /Power is not defined/);
  assert.doesNotMatch(script, /\$ScriptContent\.Contains\(\$Signature\)/);
  assert.match(script, /检测到已知白屏旧资源/);
  assert.match(script, /Test-FrontendLucideIconImports\s+-AppContent\s+\$AppContent/);
});

test("release package script blocks missing lucide icon imports before packaging", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /function Test-FrontendLucideIconImports/);
  assert.match(script, /from\\s\+"lucide-react"/);
  assert.match(script, /\(\?<imports>\[\^\}\]\*\)/);
  assert.match(script, /\[regex\]::Matches\(\$AppContent,\s*'<\(\[A-Z\]\[A-Za-z0-9_\]\*\)'/);
  assert.match(script, /\$LucideImports\.Contains\(\$IconName\)/);
  assert.match(script, /前端运行时自检失败：JSX 使用了未导入的 lucide 图标/);
  assert.match(script, /Test-FrontendLucideIconImports\s+-AppContent\s+\$AppContent/);
});

test("release package self check validates packaged exe startup identity", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /--startup-smoke/);
  assert.match(script, /--smoke-output/);
  assert.match(script, /\$StartupSmoke\.startupIdentity/);
  assert.match(script, /\$StartupSmoke\.startupIdentity\.frontendMatchesManifest\s+-ne\s+\$true/);
  assert.match(script, /\$StartupSmoke\.version\s+-ne\s+\$ManifestData\.version/);
  assert.match(script, /\$StartupSmoke\.packageName\s+-ne\s+\$ManifestData\.packageName/);
  assert.match(script, /-not\s+\$StartupSmoke\.clientEntry/);
  assert.match(script, /\$StartupSmoke\.clientEntry\.ok\s+-eq\s+\$false/);
});

test("startup smoke report includes startup identity for cross machine diagnostics", () => {
  const source = readFileSync(desktopAppPath, "utf8");
  const reportSource = source.slice(source.indexOf("def build_startup_smoke_report"), source.indexOf("def hide_packaged_console"));

  assert.match(reportSource, /startup_identity\s*=\s*build_startup_identity\(manifest,\s*frontend_assets,\s*executable_mode\)/);
  assert.match(reportSource, /"startupIdentity":\s*startup_identity/);
  assert.match(reportSource, /build_startup_repair_advice\(context=report\)/);
});

test("release package self check validates the final send-only zip after extraction", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /function Test-ZipStartupSmoke/);
  assert.match(script, /Expand-Archive\s+-LiteralPath\s+\$ZipPath\s+-DestinationPath\s+\$ExtractRoot\s+-Force/);
  assert.match(script, /\$ExtractedExe\s*=\s*Join-Path\s+\$ExtractRoot\s+"SSH-Agent-Tool\.exe"/);
  assert.match(script, /Start-Process\s+-FilePath\s+\$ExtractedExe[\s\S]*--startup-smoke[\s\S]*--smoke-output/);
  assert.match(script, /\$ZipStartupSmoke\.frontendAssets\.scriptSha256\s+-ne\s+\$ManifestData\.frontendAssets\.scriptSha256/);
  assert.match(script, /-not\s+\$ZipStartupSmoke\.clientEntry/);
  assert.match(script, /\$ZipStartupSmoke\.clientEntry\.ok\s+-eq\s+\$false/);
  assert.match(script, /Test-ZipStartupSmoke\s+-ZipPath\s+\$SendOnlyZipPath\s+-ManifestData\s+\$ManifestData\s+-Label\s+"只发这个分发 ZIP"/);
});

test("release package readme documents hosted update manifest setup", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /更新发布步骤/);
  assert.match(script, /托管 latest\.json/);
  assert.match(script, /-UpdateCheckUrl/);
  assert.match(script, /-CurrentPackageUrl/);
  assert.match(script, /-ReleaseNotesUrl/);
});

test("release package readme documents one-click in-app update install", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /工具内下载/);
  assert.match(script, /安装并重启/);
  assert.doesNotMatch(script, /准备后台更新器/);
});

test("release package readme documents logs and diagnostic package for bug reports", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /diagnostic-packages/);
  assert.match(script, /SSHAgentTool/);
  assert.match(script, /SSHAgentToolPreview/);
  assert.doesNotMatch(script, /启动诊断模式\.ps1/);
  assert.doesNotMatch(script, /导出诊断包\.ps1/);
});

test("release package readme documents reliable cross-machine startup verification", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /跨电脑启动排查/);
  assert.match(script, /Windows 图形客户端 EXE 不会像命令行程序一样阻塞等待输出/);
  assert.match(script, /Start-Process -FilePath '\.\\SSH-Agent-Tool\.exe'/);
  assert.match(script, /--startup-smoke/);
  assert.match(script, /startup-smoke\.json/);
  assert.match(script, /"state": "passed"/);
});

test("release package readme explains cross-machine startup troubleshooting", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /其他电脑/);
  assert.match(script, /打不开/);
  assert.match(script, /WebView2 Runtime/);
  assert.match(script, /https:\/\/go\.microsoft\.com\/fwlink\/\?LinkId=2124703/);
  assert.match(script, /startup-failure-latest\.log/);
  assert.match(script, /打开日志目录/);
  assert.match(script, /导出诊断包/);
  assert.doesNotMatch(script, /启动诊断模式\.ps1/);
  assert.doesNotMatch(script, /导出诊断包\.ps1/);
});

test("release package readme requires clean extraction before cross-machine launch", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");
  const readmeStart = script.indexOf("$Readme = @\"");
  const readmeEnd = script.indexOf("Write-Utf8File -Path $ReadmePath", readmeStart);
  assert.notEqual(readmeStart, -1, "readme template should exist");
  assert.notEqual(readmeEnd, -1, "readme template should be written before support template");
  const readmeSource = script.slice(readmeStart, readmeEnd);

  assert.match(readmeSource, /跨电脑正确使用步骤/);
  assert.match(readmeSource, /先删旧目录，再解压到一个全新的空目录/);
  assert.match(readmeSource, /不要覆盖解压到旧目录/);
  assert.match(readmeSource, /不要继续使用旧桌面快捷方式/);
  assert.match(readmeSource, /第一次启动请直接双击新解压目录里的 SSH-Agent-Tool\.exe/);
});


test("formal Windows client package does not ship a manual cleanup launcher", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.doesNotMatch(script, /IsInRole\(\[Security\.Principal\.WindowsBuiltInRole\]::Administrator\)/);
  assert.doesNotMatch(script, /Start-Process\s+powershell\s+-Verb\s+RunAs/);
  assert.doesNotMatch(script, /--admin-cleanup/);
  assert.doesNotMatch(script, /关闭旧版残留进程\.ps1/);
});



test("release package readme documents first-run SSH terminal and model API usage", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /SSH-Agent-Tool\.exe/);
  assert.match(script, /回车/);
  assert.match(script, /Ctrl\+C/);
  assert.match(script, /Ctrl\+L/);
  assert.match(script, /Ctrl\+R/);
  assert.match(script, /Ctrl\+Shift\+C/);
  assert.match(script, /Ctrl\+Shift\+V/);
  assert.match(script, /Shift\+Insert/);
  assert.match(script, /Ctrl\\+/);
  assert.match(script, /API Key/);
  assert.match(script, /Base URL/);
});

test("release package readme tells trial users to run the one-click basic smoke test", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /一键基础自检/);
  assert.match(script, /SSH 会话、回车执行、Ctrl\+C 中断/);
  assert.match(script, /SFTP 临时文件读写和清理/);
  assert.match(script, /导出基础自检报告/);
});

test("release package script stops stale packaged exe before overwriting release", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /function Stop-RunningReleaseExe/);
  assert.match(script, /function Resolve-AvailablePackageName/);
  assert.match(script, /function Set-ReleasePackagePaths/);
  assert.match(script, /Get-CimInstance\s+Win32_Process/);
  assert.match(script, /Get-Process\s+SSH-Agent-Tool/);
  assert.match(script, /\$Processes\s*=\s*@\(\)/);
  assert.match(script, /Sort-Object\s+Id\s+-Unique/);
  assert.match(script, /Stop-Process\s+-Id\s+\$Process\.Id/);
  assert.match(script, /\$NameFallbackProcesses/);
  assert.match(script, /NameFallbackProcesses/);
  assert.match(script, /Stop-RunningReleaseExe\s+\$PackageExe/);
  assert.match(script, /Resolve-AvailablePackageName\s+-BasePackageName\s+\$BasePackageName/);
  assert.match(script, /packageFile\s+=\s+\(Split-Path\s+-Leaf\s+\$ZipPath\)/);
  assert.match(script, /Invoke-WithRetry\s+-Action\s+\{\s*Remove-Item\s+-LiteralPath\s+\$PackageDir\s+-Recurse\s+-Force\s*\}/);
  assert.ok(script.indexOf("Stop-RunningReleaseExe $PackageExe") < script.indexOf("Remove-Item -LiteralPath $PackageDir"));
});

test("release package script keeps terminal pytest temp and cache inside the workspace", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /\$TerminalPytestTempRoot\s*=\s*Join-Path\s+\$ProjectRoot\s+".build-temp[\\/]winkterm-pytest-runs"/);
  assert.match(script, /\$TerminalPytestRunId\s*=/);
  assert.match(script, /\$TerminalPytestTemp\s*=\s*Join-Path\s+\$TerminalPytestTempRoot\s+\$TerminalPytestRunId/);
  assert.match(script, /New-Item\s+-ItemType\s+Directory\s+-Force\s+-Path\s+\$TerminalPytestTemp/);
  assert.match(script, /"-m",\s*"pytest",\s*"--basetemp",\s*\$TerminalPytestTemp,\s*"-p",\s*"no:cacheprovider"/);
});

test("release package script verifies the bundled Python before backend tests", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.match(script, /\$Python\s*=\s*Resolve-ToolPath\s+-EnvironmentVariable\s+"SSH_AGENT_PYTHON"/);
  assert.match(script, /Join-Path\s+\$ProjectRoot\s+"..\\winkterm\\.venv\\Scripts\\python\.exe"/);
  assert.match(script, /function Assert-ReleasePythonReady/);
  assert.match(script, /Test-Path\s+-LiteralPath\s+\$Python/);
  assert.match(script, /未找到发布验证 Python/);
  assert.match(script, /请先初始化 apps\\winkterm\\.venv/);
  assert.ok(script.indexOf("Assert-ReleasePythonReady") < script.indexOf("后端桥接测试"));
});

test("release package script Chinese output is not mojibake", () => {
  const script = readFileSync(releasePackageScriptPath, "utf8");

  assert.deepEqual(findSuspiciousLocalizationText(script), []);
});

