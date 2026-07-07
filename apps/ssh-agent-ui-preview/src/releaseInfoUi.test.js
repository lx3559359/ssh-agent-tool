import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = join(projectRoot, "src", "App.jsx");
const desktopAppPath = join(projectRoot, "desktop_app.py");
const releasePackageScriptPath = join(projectRoot, "build-windows-client-package.ps1");

function appSource() {
  return readFileSync(appPath, "utf8");
}

function desktopAppSource() {
  return readFileSync(desktopAppPath, "utf8");
}

function releasePackageScriptSource() {
  return readFileSync(releasePackageScriptPath, "utf8");
}

function releaseInfoModalSource() {
  const app = appSource();
  return app.slice(app.indexOf("function ReleaseInfoModal"), app.indexOf("function BackupExportModal"));
}

test("agent toolbar exposes release info entry", () => {
  const app = appSource();
  const agentPanelSource = app.slice(app.indexOf("function AgentPanel"), app.indexOf("function buildAgentResponse"));
  const mainSource = app.slice(app.indexOf("<AgentPanel"), app.indexOf("{settingsOpen"));

  assert.match(agentPanelSource, /onOpenReleaseInfo/);
  assert.match(agentPanelSource, /aria-label="版本信息"/);
  assert.match(mainSource, /onOpenReleaseInfo=\{\(\) => setReleaseInfoOpen\(true\)\}/);
});

test("app reads release manifest and runtime diagnostics from desktop api", () => {
  const app = appSource();

  assert.match(app, /const \[releaseManifest, setReleaseManifest\]/);
  assert.match(app, /const \[runtimeDiagnostics, setRuntimeDiagnostics\]/);
  assert.match(app, /read_release_manifest/);
  assert.match(app, /read_runtime_diagnostics/);
  assert.match(app, /runtimeDiagnostics=\{runtimeDiagnostics\}/);
  assert.match(app, /releaseInfoOpen &&/);
  assert.match(app, /<ReleaseInfoModal/);
});

test("default release manifest policy describes the current updater", () => {
  const app = appSource();
  const desktop = desktopAppSource();
  const script = releasePackageScriptSource();

  assert.match(app, /updatePolicy: "支持远程版本清单和应用内检查更新。"/);
  assert.match(desktop, /"updatePolicy": "支持远程版本清单和应用内检查更新。"/);
  assert.match(script, /updatePolicy = "支持远程版本清单和应用内检查更新。"/);
  assert.doesNotMatch(app, /后续可接入远程版本清单|后续可将 updateCheckUrl/);
  assert.doesNotMatch(desktop, /后续可接入远程版本清单|鍚庣画/);
  assert.doesNotMatch(script, /后续可接入远程版本清单|后续可将 updateCheckUrl/);
});

test("release info modal exposes package identity and support copy details", () => {
  const modalSource = releaseInfoModalSource();

  assert.match(modalSource, /const packageShaText = manifest\.packageSha256/);
  assert.match(modalSource, /manifest\.packageName \|\| "--"/);
  assert.match(modalSource, /manifest\.packageFile \|\| "--"/);
  assert.match(modalSource, /manifest\.currentPackageUrl \|\| "--"/);
  assert.match(modalSource, /buildReleaseDiagnosticsSummary\(/);
  assert.match(modalSource, /navigator\.clipboard\.writeText/);
  assert.match(modalSource, />\{"复制版本信息"\}</);
});

test("release info modal copies a structured diagnostics summary", () => {
  const app = appSource();
  const modalSource = releaseInfoModalSource();

  assert.match(app, /buildReleaseDiagnosticsSummary/);
  assert.match(modalSource, /buildReleaseDiagnosticsSummary\(/);
  assert.match(modalSource, /recommendedClientText/);
  assert.match(modalSource, /clientModeText/);
  assert.match(modalSource, /consoleModeText/);
  assert.match(modalSource, /launcherStatusText/);
  assert.match(modalSource, /webView2Text/);
  assert.match(modalSource, /navigator\.clipboard\.writeText\(text\)/);
});

test("release info modal can copy a concise package fingerprint", () => {
  const app = appSource();
  const modalSource = releaseInfoModalSource();

  assert.match(app, /buildReleaseFingerprintText/);
  assert.match(modalSource, /async function copyReleaseFingerprint\(\)/);
  assert.match(modalSource, /buildReleaseFingerprintText\(manifest,\s*runtime\)/);
  assert.match(modalSource, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(modalSource, /setManualUpdateStatus\("版本指纹已复制。"\)/);
  assert.match(modalSource, />\{"复制版本指纹"\}</);
});

test("release info modal can copy a concise troubleshooting checklist", () => {
  const app = appSource();
  const modalSource = releaseInfoModalSource();

  assert.match(app, /buildSupportTroubleshootingText/);
  assert.match(modalSource, /async function copyTroubleshootingInfo\(\)/);
  assert.match(modalSource, /buildSupportTroubleshootingText\(manifest,\s*runtime\)/);
  assert.match(modalSource, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(modalSource, /setManualUpdateStatus\("排查说明已复制。"\)/);
  assert.match(modalSource, />\{"复制排查说明"\}</);
});

test("release info modal can configure online update source", () => {
  const modalSource = releaseInfoModalSource();

  assert.match(modalSource, /const \[updateSourceDraft,\s*setUpdateSourceDraft\]/);
  assert.match(modalSource, /const \[autoCheckOnStartup,\s*setAutoCheckOnStartup\]/);
  assert.match(modalSource, /read_release_update_settings/);
  assert.match(modalSource, /save_release_update_settings/);
  assert.match(modalSource, /async function saveUpdateSourceSettings\(\)/);
  assert.match(modalSource, /autoCheckOnStartup:\s*autoCheckOnStartup/);
  assert.match(modalSource, /value=\{updateSourceDraft\}/);
  assert.match(modalSource, /checked=\{autoCheckOnStartup\}/);
  assert.match(modalSource, /placeholder="https:\/\/updates\.example\.com\/ssh-agent\/latest\.json"/);
  assert.match(modalSource, />\{"保存更新源"\}</);
});

test("tool settings exposes online update entry through release info", () => {
  const app = appSource();
  const toolSettingsSource = app.slice(app.indexOf("function ToolSettingsModal"), app.indexOf("function ModelSettingsModal"));
  const renderSource = app.slice(app.indexOf("<ToolSettingsModal"), app.indexOf("{releaseInfoOpen &&"));

  assert.match(toolSettingsSource, /onOpenReleaseInfo/);
  assert.match(toolSettingsSource, /<h3>\{"在线更新"\}<\/h3>/);
  assert.match(toolSettingsSource, /closeThen\(onOpenReleaseInfo\)/);
  assert.match(renderSource, /onOpenReleaseInfo=\{\(\) => setReleaseInfoOpen\(true\)\}/);
});

test("release info modal checks updates through desktop api before browser fallback", () => {
  const app = appSource();
  const modalSource = releaseInfoModalSource();

  assert.match(app, /buildUpdateCheckRequest/);
  assert.match(app, /buildUpdateCheckStatus/);
  assert.match(modalSource, /async function checkUpdateStatus\(\)/);
  assert.match(modalSource, /api\?\.check_release_update/);
  assert.match(modalSource, /fetch\(request\.url/);
  assert.match(modalSource, /response\.json\(\)/);
  assert.ok(modalSource.indexOf("check_release_update") < modalSource.indexOf("fetch(request.url"));
  assert.match(modalSource, />\{"检查更新"\}</);
});

test("desktop topbar exposes one-click update check entry", () => {
  const app = appSource();
  const topbarSource = app.slice(app.indexOf("function DesktopTopBar"), app.indexOf("function Sidebar"));
  const appStateSource = app.slice(app.indexOf("export function App()"), app.indexOf("async function persistAppConfig"));
  const renderSource = app.slice(app.indexOf("<DesktopTopBar"), app.indexOf("<main className"));
  const releaseRenderSource = app.slice(app.indexOf("<ReleaseInfoModal"), app.indexOf("onClose={() => setReleaseInfoOpen(false)}"));
  const modalSource = releaseInfoModalSource();

  assert.match(topbarSource, /onCheckReleaseUpdate/);
  assert.match(topbarSource, /\{ label: "检查更新", icon: <RefreshCw size=\{15\} \/>/);
  assert.match(topbarSource, /onClick: onCheckReleaseUpdate/);
  assert.match(appStateSource, /releaseInfoAutoCheckNonce,\s*setReleaseInfoAutoCheckNonce/);
  assert.match(renderSource, /onCheckReleaseUpdate=\{\(\) => \{/);
  assert.match(renderSource, /setReleaseInfoOpen\(true\)/);
  assert.match(renderSource, /setReleaseInfoAutoCheckNonce\(\(value\) => value \+ 1\)/);
  assert.match(releaseRenderSource, /autoCheckNonce=\{releaseInfoAutoCheckNonce\}/);
  assert.match(modalSource, /autoCheckNonce/);
  assert.match(modalSource, /lastAutoCheckNonceRef/);
  assert.match(modalSource, /checkUpdateStatus\(\)/);
});

test("release info modal saves the current update source draft before checking updates", () => {
  const modalSource = releaseInfoModalSource();
  const checkSource = modalSource.slice(modalSource.indexOf("async function checkUpdateStatus"), modalSource.indexOf("function buildRuntimeHealthItems"));

  assert.match(checkSource, /await api\.save_release_update_settings\(\{/);
  assert.match(checkSource, /updateCheckUrl:\s*updateSourceDraft/);
  assert.match(checkSource, /autoCheckOnStartup:\s*autoCheckOnStartup/);
  assert.ok(
    checkSource.indexOf("save_release_update_settings") < checkSource.indexOf("await api.check_release_update()"),
    "检查更新前应先保存当前输入框中的更新源",
  );
});

test("release info modal can open and copy latest update package link", () => {
  const modalSource = releaseInfoModalSource();

  assert.match(modalSource, /latestUpdateStatus,\s*setLatestUpdateStatus/);
  assert.match(modalSource, /latestUpdateStatus\?\.packageUrl/);
  assert.match(modalSource, /window\.open\(latestUpdateStatus\.packageUrl,\s*"_blank",\s*"noopener,noreferrer"\)/);
  assert.match(modalSource, /async function copyLatestPackageUrl\(\)/);
  assert.match(modalSource, /navigator\.clipboard\.writeText\(latestUpdateStatus\.packageUrl\)/);
  assert.match(modalSource, /setManualUpdateStatus\("更新包下载地址已复制。"\)/);
  assert.match(modalSource, />\{"下载更新包"\}</);
  assert.match(modalSource, />\{"复制下载地址"\}</);
});

test("release info modal can copy a shareable online update status", () => {
  const modalSource = releaseInfoModalSource();
  const styles = readFileSync(join(projectRoot, "src", "styles.css"), "utf8");
  const copySource = modalSource.slice(
    modalSource.indexOf("async function copyReleaseUpdateStatus"),
    modalSource.indexOf("async function downloadLatestPackage"),
  );
  const updateStatusSource = modalSource.slice(
    modalSource.indexOf('<h3>{"更新状态"}</h3>'),
    modalSource.indexOf('<div className="release-feature-list">', modalSource.indexOf('<h3>{"更新状态"}</h3>') + 1),
  );

  assert.match(modalSource, /async function copyReleaseUpdateStatus\(\)/);
  assert.match(copySource, /"SSH Agent 工具在线更新状态"/);
  assert.match(copySource, /`当前版本：\$\{manifest\.version \|\| "dev"\}`/);
  assert.match(copySource, /`更新源：\$\{updateUrl \|\| "--"\}`/);
  assert.match(copySource, /`检查状态：\$\{latestUpdateStatus\?\.state \|\| "--"\}`/);
  assert.match(copySource, /`更新包：\$\{latestUpdateStatus\?\.packageUrl \|\| "--"\}`/);
  assert.match(copySource, /`本地更新包：\$\{downloadedUpdatePackagePath \|\| "--"\}`/);
  assert.match(copySource, /`期望 SHA256：\$\{latestUpdateStatus\?\.expectedSha256 \|\| latestUpdateStatus\?\.sha256 \|\| latestUpdateStatus\?\.packageSha256 \|\| "--"\}`/);
  assert.match(copySource, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(copySource, /setManualUpdateStatus\("更新状态已复制。"\)/);
  assert.match(updateStatusSource, />\{"复制更新状态"\}</);
  assert.match(updateStatusSource, /onClick=\{copyReleaseUpdateStatus\}/);
  assert.match(styles, /\.release-feature-head\s*\{[\s\S]*display:\s*flex/);
  assert.match(styles, /\.release-feature-head\s*\{[\s\S]*justify-content:\s*space-between/);
  assert.match(styles, /\.release-feature-head button\s*\{[\s\S]*height:\s*28px/);
  assert.match(styles, /\.release-feature-head button\s*\{[\s\S]*font-size:\s*12px/);
});

test("release info modal downloads, verifies, installs and refreshes updater status", () => {
  const modalSource = releaseInfoModalSource();
  const downloadSource = modalSource.slice(modalSource.indexOf("async function downloadLatestPackage"), modalSource.indexOf("async function startDownloadedUpdateInstall"));
  const installSource = modalSource.slice(modalSource.indexOf("async function startDownloadedUpdateInstall"), modalSource.indexOf("async function createDesktopShortcut"));

  assert.match(downloadSource, /callReleaseApi\("download_release_update"/);
  assert.match(downloadSource, /setLatestUpdateStatus\(result\)/);
  assert.match(downloadSource, /result\?\.localPath/);
  assert.match(downloadSource, /result\.nextActionLabel/);
  assert.match(downloadSource, /await loadReleaseUpdateStatus\(\)/);
  assert.match(installSource, /callReleaseApi\("start_release_update_install"/);
  assert.match(installSource, /latestUpdateStatus\?\.localPath/);
  assert.match(installSource, /expectedSha256:\s*latestUpdateStatus\?\.expectedSha256 \|\| latestUpdateStatus\?\.sha256/);
  assert.match(installSource, /shutdownAfterStart:\s*true/);
  assert.match(installSource, /当前工具会自动关闭/);
  assert.match(installSource, /更新器会在后台运行/);
  assert.match(installSource, /await loadReleaseUpdateStatus\(\)/);
  assert.match(modalSource, />\{"下载并校验更新包"\}</);
  assert.match(modalSource, />\{"安装并重启"\}</);
});

test("release info modal keeps updater script details out of the client UI", () => {
  const modalSource = releaseInfoModalSource();

  assert.doesNotMatch(modalSource, /安装脚本/);
  assert.doesNotMatch(modalSource, /手动运行.*脚本/);
  assert.match(modalSource, /后台更新器/);
  assert.match(modalSource, /更新日志/);
});

test("release info modal opens the real updater log from status", () => {
  const modalSource = releaseInfoModalSource();

  assert.match(modalSource, /const releaseUpdaterLogPath = releaseUpdateStatus\?\.logPath \|\| releaseUpdateStatus\?\.statusPath \|\| "";/);
  assert.match(modalSource, /async function openReleaseUpdaterLog\(\)/);
  assert.match(modalSource, /api\?\.open_path/);
  assert.match(modalSource, /releaseUpdateStatus\?\.logPath/);
  assert.match(modalSource, /releaseUpdateStatus\?\.statusPath/);
  assert.match(modalSource, />\{"打开更新日志"\}</);
  assert.match(modalSource, /disabled=\{busy \|\| !releaseUpdaterLogPath\}/);
});

test("release info modal can open downloaded update package directory", () => {
  const modalSource = releaseInfoModalSource();

  assert.match(modalSource, /const downloadedUpdatePackagePath = latestUpdateStatus\?\.localPath \|\| releaseUpdateStatus\?\.localPath \|\| releaseUpdateStatus\?\.packageZip \|\| "";/);
  assert.match(modalSource, /const downloadedUpdatePackageDir = downloadedUpdatePackagePath\.replace\(/);
  assert.match(modalSource, /async function openDownloadedUpdatePackageDirectory\(\)/);
  assert.match(modalSource, /api\.open_path\(downloadedUpdatePackageDir\)/);
  assert.match(modalSource, />\{"打开更新包目录"\}</);
  assert.match(modalSource, /disabled=\{busy \|\| !downloadedUpdatePackageDir\}/);
});

test("release info modal can create shortcuts and open local directories", () => {
  const modalSource = releaseInfoModalSource();

  assert.match(modalSource, /async function createDesktopShortcut\(\)/);
  assert.match(modalSource, /callReleaseApi\("create_desktop_shortcut"/);
  assert.match(modalSource, />\{"创建桌面快捷方式"\}</);
  assert.match(modalSource, /async function createStartMenuShortcut\(\)/);
  assert.match(modalSource, /callReleaseApi\("create_start_menu_shortcut"/);
  assert.match(modalSource, />\{"创建开始菜单快捷方式"\}</);
  assert.match(modalSource, /async function openCurrentExecutableDirectory\(\)/);
  assert.match(modalSource, /callReleaseApi\("open_current_executable_directory"/);
  assert.match(modalSource, />\{"打开当前程序目录"\}</);
  assert.match(modalSource, /async function copyCurrentExecutablePath\(\)/);
  assert.match(modalSource, /navigator\.clipboard\.writeText\(runtime\.executable\)/);
  assert.match(modalSource, />\{"复制当前程序路径"\}</);
  assert.match(modalSource, /async function openInstallDirectory\(\)/);
  assert.match(modalSource, /callReleaseApi\("open_install_directory"/);
  assert.match(modalSource, />\{"打开安装目录"\}</);
  assert.match(modalSource, /async function openAppDataDirectory\(\)/);
  assert.match(modalSource, /callReleaseApi\("open_app_data_directory"/);
  assert.match(modalSource, />\{"打开数据目录"\}</);
});

test("release info modal lists runtime diagnostics and common terminal shortcuts in Chinese", () => {
  const modalSource = releaseInfoModalSource();

  assert.match(modalSource, /executableMode/);
  assert.match(modalSource, /executableDirectory/);
  assert.match(modalSource, /clientModeText/);
  assert.match(modalSource, /webView2Text/);
  assert.match(modalSource, /WebView2/);
  assert.match(modalSource, /toolLogDir/);
  assert.match(modalSource, /appDataRoot/);
  assert.match(modalSource, /图形客户端/);
  assert.match(modalSource, /窗口模式/);
  assert.doesNotMatch(modalSource, /控制台状态/);
  assert.match(modalSource, /运行环境/);
  assert.match(modalSource, /程序目录/);
  assert.match(modalSource, /日志目录/);
  assert.match(modalSource, /常用快捷键/);
  assert.match(modalSource, /Ctrl\+C/);
  assert.match(modalSource, /Ctrl\+W/);
  assert.match(modalSource, /Ctrl\+Shift\+B/);
  assert.match(modalSource, /Ctrl\+Shift\+G/);
  assert.match(modalSource, /右键菜单/);
});

test("release info modal surfaces startup identity and frontend asset match", () => {
  const modalSource = releaseInfoModalSource();

  assert.match(modalSource, /const startupIdentity = runtime\.startupIdentity \|\| \{\}/);
  assert.match(modalSource, /startupIdentity\.frontendMatchesManifest/);
  assert.match(modalSource, /startupIdentity\.runtimeScript/);
  assert.match(modalSource, /startupFrontendShaText/);
  assert.match(modalSource, /buildReleaseDiagnosticsSummary\(/);
  assert.match(modalSource, /启动身份/);
  assert.match(modalSource, /前端资源/);
  assert.match(modalSource, /前端资源 SHA/);
  assert.match(modalSource, /资源一致/);
});

test("release info modal shows manifest frontend asset beside runtime asset", () => {
  const modalSource = releaseInfoModalSource();

  assert.match(modalSource, /const manifestFrontendText = manifest\.frontendAssets\?\.script \|\| "--"/);
  assert.match(modalSource, /const manifestFrontendShaText = manifest\.frontendAssets\?\.scriptSha256 \|\| "--"/);
  assert.match(modalSource, /startupFrontendText/);
  assert.match(modalSource, /manifestFrontendText/);
  assert.match(modalSource, /startupFrontendShaText/);
  assert.match(modalSource, /manifestFrontendShaText/);
  assert.match(modalSource, /清单前端资源/);
  assert.match(modalSource, /清单前端资源 SHA/);
});

test("release info modal warns clearly when runtime frontend assets are stale", () => {
  const modalSource = releaseInfoModalSource();

  assert.match(modalSource, /const releaseAssetWarning = frontendAssetsMatch === false/);
  assert.match(modalSource, /className="release-warning-panel"/);
  assert.match(modalSource, /检测到前端资源与版本清单不一致/);
  assert.match(modalSource, /旧解压目录/);
  assert.match(modalSource, /旧桌面快捷方式/);
  assert.match(modalSource, /SSH-Agent-Tool\.exe/);
  assert.ok(
    modalSource.indexOf("releaseAssetWarning &&") < modalSource.indexOf("release-info-grid"),
    "旧包提醒应显示在版本明细网格之前，避免用户漏看",
  );
});

test("release info modal exposes runtime health actions for support diagnostics", () => {
  const modalSource = releaseInfoModalSource();

  assert.match(modalSource, /function buildRuntimeHealthItems/);
  assert.match(modalSource, /运行健康摘要/);
  assert.match(modalSource, /async function openRuntimeLogDirectory\(\)/);
  assert.match(modalSource, /async function openDiagnosticPackageDirectory\(\)/);
  assert.match(modalSource, /api\?\.get_tool_log_dir/);
  assert.match(modalSource, /api\?\.open_path/);
  assert.match(modalSource, /callReleaseApi\("open_diagnostic_package_directory"/);
  assert.match(modalSource, /async function exportRuntimeDiagnosticPackage\(\)/);
  assert.match(modalSource, /callReleaseApi\("export_diagnostic_package"/);
  assert.match(modalSource, /formatDiagnosticPackageNotice\(result\)/);
  assert.match(modalSource, />\{"打开日志目录"\}</);
  assert.match(modalSource, />\{"打开诊断包目录"\}</);
  assert.match(modalSource, />\{"导出诊断包"\}</);
});

test("release info modal exposes latest startup failure log diagnostics", () => {
  const modalSource = releaseInfoModalSource();

  assert.match(modalSource, /startupFailureLog/);
  assert.match(modalSource, /startupFailureText/);
  assert.match(modalSource, /async function openStartupFailureLog\(\)/);
  assert.match(modalSource, /启动失败日志/);
  assert.match(modalSource, /startupFailureLog\.path/);
  assert.match(modalSource, /startupFailureLog\.updatedAt/);
  assert.match(modalSource, /api\?\.open_path\(startupFailureLog\.path\)/);
  assert.match(modalSource, /disabled=\{busy \|\| !startupFailureLog\.exists\}/);
  assert.match(modalSource, />\{"打开启动失败日志"\}</);
  assert.match(modalSource, /buildReleaseDiagnosticsSummary\(/);
});

test("release info modal shows actionable startup diagnosis in runtime health", () => {
  const app = appSource();
  const modalSource = releaseInfoModalSource();

  assert.match(app, /buildStartupDiagnosisText/);
  assert.match(modalSource, /const startupDiagnosisText = buildStartupDiagnosisText\(runtime\)/);
  assert.match(modalSource, /\{ label: "启动诊断", value: startupDiagnosisText \}/);
  assert.match(modalSource, /运行健康摘要/);
});

test("release info modal shows client entry diagnostics in runtime health", () => {
  const modalSource = releaseInfoModalSource();

  assert.match(modalSource, /const clientEntry = runtime\.clientEntry \|\| \{\}/);
  assert.match(modalSource, /const clientEntryText = clientEntry\.message \|\|/);
  assert.match(modalSource, /\{ label: "客户端入口", value: clientEntryText \}/);
  assert.match(modalSource, /clientEntry\.recommendedEntry/);
});

test("main diagnostic package action uses backend default save path", () => {
  const app = appSource();
  const start = app.indexOf("async function exportDiagnosticPackage");
  const actionSource = app.slice(start, app.indexOf("async function createDesktopShortcut", start));

  assert.match(actionSource, /api\.export_diagnostic_package\(\)/);
  assert.doesNotMatch(actionSource, /save_text_file|save_file|showSaveFilePicker/);
  assert.match(actionSource, /showNotice\(formatDiagnosticPackageNotice\(result,\s*\{ copiedPath \}\)\)/);
  assert.match(app, /function formatDiagnosticPackageNotice\(result,\s*options = \{\}\)/);
  assert.match(app, /问题反馈模板\.txt/);
  assert.match(app, /支持排查说明\.md/);
  assert.match(app, /共 \$\{result\.files\.length\} 个文件/);
});

test("release info modal update copy is readable Chinese without mojibake", () => {
  const modalSource = releaseInfoModalSource();

  assert.match(modalSource, /aria-label="版本信息"/);
  assert.match(modalSource, />\{"版本信息"\}</);
  assert.match(modalSource, />\{"检查更新"\}</);
  assert.match(modalSource, />\{"下载并校验更新包"\}</);
  assert.match(modalSource, />\{"安装并重启"\}</);
  assert.match(modalSource, /后台更新器/);
  assert.match(modalSource, /运行健康摘要/);
  assert.doesNotMatch(modalSource, /鐗|鏇|涓|瀹|淇|妫|鍦|杩|绔|褰|鈥|€|�/);
});

test("app can automatically check updates on startup when enabled", () => {
  const app = appSource();
  const appSourceSlice = app.slice(app.indexOf("export function App()"), app.indexOf("function resolveSftpEntries"));

  assert.match(appSourceSlice, /startupUpdateCheckRef/);
  assert.match(appSourceSlice, /read_release_update_settings/);
  assert.match(appSourceSlice, /settings\?\.autoCheckOnStartup/);
  assert.match(appSourceSlice, /check_release_update/);
  assert.match(appSourceSlice, /auto_startup_check/);
  assert.match(appSourceSlice, /showNotice/);
});
