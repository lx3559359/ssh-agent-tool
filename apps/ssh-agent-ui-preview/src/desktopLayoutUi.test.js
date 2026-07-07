import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { findSuspiciousLocalizationText } from "./localizationQuality.js";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const main = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const contextMenuActions = readFileSync(new URL("./contextMenuActions.js", import.meta.url), "utf8");

function componentSource(name, nextName) {
  const start = app.indexOf(`function ${name}`);
  const end = nextName ? app.indexOf(`function ${nextName}`, start) : app.length;
  assert.notEqual(start, -1, `${name} component should exist`);
  assert.notEqual(end, -1, `${nextName} component should exist after ${name}`);
  return app.slice(start, end);
}

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `${selector} rule should exist`);
  return match[1];
}

test("desktop workspace exposes resizable left and AI panels", () => {
  assert.match(app, /layoutColumns/);
  assert.match(app, /startLayoutResize/);
  assert.match(app, /--left-panel-width/);
  assert.match(app, /--right-panel-width/);
  assert.match(app, /className="layout-resizer left-resizer"/);
  assert.match(app, /className="layout-resizer right-resizer"/);
  assert.match(styles, /\.workspace-grid[\s\S]*grid-template-columns:[\s\S]*--left-panel-width[\s\S]*--right-panel-width/);
  assert.match(styles, /\.layout-resizer[\s\S]*cursor:\s*col-resize/);
});

test("desktop shell exposes global tools in a top toolbar", () => {
  const source = componentSource("DesktopTopBar", "Sidebar");
  assert.match(app, /<DesktopTopBar/);
  assert.match(source, /className="desktop-topbar"/);
  assert.match(source, /className="topbar-menu"/);
  assert.match(source, /sshTopbarActions/);
  assert.match(source, /onBatchOpenSessions/);
  assert.match(source, /diagnosticTopbarActions/);
  assert.match(source, /sftpTopbarActions/);
  assert.match(source, /onQueueDiagnosticSkill/);
  assert.match(source, /configTopbarActions/);
  assert.match(source, /connectionTopbarActions/);
  assert.match(source, /dataTopbarActions/);
  assert.match(source, /helpTopbarActions/);
  assert.match(source, /工具设置/);
  assert.match(source, /新建连接/);
  assert.match(source, /模型 API/);
  assert.match(source, /密钥认证/);
  assert.match(source, /端口转发/);
  assert.match(source, /会话日志/);
  assert.match(source, /工具日志/);
  assert.match(source, /备份导出/);
  assert.match(source, /导入配置/);
  assert.match(source, /版本信息/);
  assert.match(styles, /\.app-shell[\s\S]*grid-template-rows:\s*44px minmax\(0,\s*1fr\)/);
  assert.match(styles, /\.desktop-topbar[\s\S]*display:\s*flex/);
  assert.match(source, /onBatchTestConnections\(visibleServerNames\)/);
  assert.match(source, /onQueueBatchAgent\(visibleServerNames\)/);
  assert.match(source, /diagnosticSkills\.map/);
  assert.match(source, /onQueueDiagnosticSkill\(skill,\s*selectedServer\)/);
  assert.doesNotMatch(source, /已选择诊断技能/);
  assert.match(source, /handleTopbarMenuAction/);
  assert.match(source, /event\.currentTarget\.closest\("details"\)\?\.removeAttribute\("open"\)/);
  assert.match(styles, /\.topbar-menu-panel[\s\S]*position:\s*absolute/);
  assert.match(styles, /\.workspace-grid[\s\S]*height:\s*100%/);
  assert.match(source, /renderTopbarMenu\("配置"/);
  assert.match(source, /renderTopbarMenu\("连接"/);
  assert.match(source, /renderTopbarMenu\("SFTP 文件"/);
  assert.match(source, /renderTopbarMenu\("数据"/);
  assert.match(source, /renderTopbarMenu\("帮助"/);
  assert.match(source, /aria-label=\{label\}/);
  assert.match(source, /title=\{label\}/);
  assert.doesNotMatch(source, /actions\.map\(\(action\)/);
  assert.match(styles, /\.topbar-context[\s\S]*flex:\s*1 1 auto/);
  assert.match(styles, /\.topbar-actions[\s\S]*flex:\s*0 1 auto/);
  assert.match(styles, /\.topbar-menu[\s\S]*flex:\s*0 0 auto/);
  assert.match(styles, /@media \(max-width:\s*1280px\)[\s\S]*\.topbar-menu > summary span[\s\S]*display:\s*none/);
});

test("top toolbar menus stay scrollable and compact when many actions are available", () => {
  const panelRule = cssRule(".topbar-menu-panel");
  const buttonRule = cssRule(".topbar-menu-panel button");

  assert.match(panelRule, /max-height:\s*min\(520px,\s*calc\(100vh - 72px\)\)/);
  assert.match(panelRule, /overflow:\s*auto/);
  assert.match(panelRule, /overscroll-behavior:\s*contain/);
  assert.match(panelRule, /scrollbar-width:\s*thin/);
  assert.match(panelRule, /gap:\s*2px/);
  assert.match(buttonRule, /min-height:\s*28px/);
  assert.match(buttonRule, /padding:\s*0 8px/);
  assert.match(buttonRule, /font-size:\s*12px/);
  assert.match(buttonRule, /white-space:\s*nowrap/);
});

test("top toolbar keeps only one dropdown menu open at a time", () => {
  const source = componentSource("DesktopTopBar", "Sidebar");

  assert.match(source, /const \[openTopbarMenu,\s*setOpenTopbarMenu\] = useState\(""\)/);
  assert.match(source, /open=\{openTopbarMenu === label\}/);
  assert.match(source, /onToggle=\{\(event\) => handleTopbarMenuToggle\(event,\s*label\)\}/);
  assert.match(source, /function handleTopbarMenuToggle\(event,\s*label\)/);
  assert.match(source, /if \(event\.currentTarget\.open\) setOpenTopbarMenu\(label\)/);
  assert.match(source, /else if \(openTopbarMenu === label\) setOpenTopbarMenu\(""\)/);
  assert.match(source, /setOpenTopbarMenu\(""\);[\s\S]*event\.currentTarget\.closest\("details"\)\?\.removeAttribute\("open"\)/);
});

test("top toolbar dropdowns close on Escape and outside desktop clicks", () => {
  const source = componentSource("DesktopTopBar", "Sidebar");

  assert.match(source, /const topbarRef = useRef\(null\)/);
  assert.match(source, /if \(!openTopbarMenu\) return undefined/);
  assert.match(source, /function handleTopbarOutsidePointerDown\(event\)/);
  assert.match(source, /topbarRef\.current\?\.contains\(event\.target\)/);
  assert.match(source, /function handleTopbarEscape\(event\)/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /document\.addEventListener\("pointerdown",\s*handleTopbarOutsidePointerDown\)/);
  assert.match(source, /document\.addEventListener\("keydown",\s*handleTopbarEscape\)/);
  assert.match(source, /document\.removeEventListener\("pointerdown",\s*handleTopbarOutsidePointerDown\)/);
  assert.match(source, /document\.removeEventListener\("keydown",\s*handleTopbarEscape\)/);
  assert.match(source, /<header className="desktop-topbar" aria-label="全局工具栏" ref=\{topbarRef\}>/);
});

test("top toolbar opens session logs filtered to the selected server", () => {
  const renderSource = app.slice(app.indexOf("<DesktopTopBar"), app.indexOf("<Sidebar"));

  assert.match(renderSource, /onOpenSessionLogs=\{\(\) => openSessionLogs\(\{ server:\s*selectedServer \}\)\}/);
  assert.doesNotMatch(renderSource, /onOpenSessionLogs=\{openSessionLogs\}/);
});

test("top toolbar SSH menu exposes current remote directory actions", () => {
  const source = componentSource("DesktopTopBar", "Sidebar");
  const renderSource = app.slice(app.indexOf("<DesktopTopBar"), app.indexOf("<Sidebar"));

  assert.match(source, /onCopyCurrentWorkingDirectory,/);
  assert.match(source, /onOpenCurrentWorkingDirectoryInSftp,/);
  assert.match(source, /label: "复制当前远程目录"/);
  assert.match(source, /label: "在 SFTP 打开当前目录"/);
  assert.match(source, /onClick: \(\) => onCopyCurrentWorkingDirectory\?\.\(selectedServer\)/);
  assert.match(source, /onClick: \(\) => onOpenCurrentWorkingDirectoryInSftp\?\.\(selectedServer\)/);
  assert.match(renderSource, /onCopyCurrentWorkingDirectory=\{copyCurrentWorkingDirectory\}/);
  assert.match(renderSource, /onOpenCurrentWorkingDirectoryInSftp=\{openCurrentWorkingDirectoryInSftp\}/);
});

test("context menus use compact readable desktop menu items with clipped Chinese labels", () => {
  const menuRule = cssRule(".context-menu");
  const buttonRule = cssRule(".context-menu button");
  const labelRule = cssRule(".context-menu button span");
  const titleRule = cssRule(".context-menu-title");
  const sectionRule = cssRule(".context-menu-section");
  const source = componentSource("ContextMenu", "DesktopTopBar");

  assert.match(menuRule, /width:\s*min\(336px,\s*calc\(100vw - 16px\)\)/);
  assert.match(menuRule, /padding:\s*3px/);
  assert.match(menuRule, /max-height:\s*calc\(100vh - 8px\)/);
  assert.match(menuRule, /overflow:\s*auto/);
  assert.match(menuRule, /scrollbar-width:\s*thin/);
  assert.match(buttonRule, /min-height:\s*16px/);
  assert.match(buttonRule, /grid-template-columns:\s*10px minmax\(0,\s*1fr\)/);
  assert.match(buttonRule, /gap:\s*5px/);
  assert.match(buttonRule, /padding:\s*1px 5px/);
  assert.match(buttonRule, /font-size:\s*8px/);
  assert.match(buttonRule, /line-height:\s*1\.1/);
  assert.match(labelRule, /overflow:\s*hidden/);
  assert.match(labelRule, /display:\s*block/);
  assert.match(labelRule, /white-space:\s*nowrap/);
  assert.match(labelRule, /overflow-wrap:\s*anywhere/);
  assert.match(labelRule, /text-overflow:\s*ellipsis/);
  assert.match(titleRule, /font-size:\s*8px/);
  assert.match(sectionRule, /font-size:\s*8px/);
  assert.match(cssRule(".context-menu button svg"), /width:\s*10px/);
  assert.match(source, /title=\{item\.title \|\| \(item\.shortcut \? `\$\{item\.label\} \$\{item\.shortcut\}` : item\.label\)\}/);
});

test("desktop tool log modal can list and export tool runtime logs", () => {
  const source = componentSource("ToolLogModal", "BatchEditServersModal");
  assert.match(app, /<ToolLogModal/);
  assert.match(source, /ToolLogModal/);
  assert.match(source, /component/);
  assert.match(source, /level/);
  assert.match(app, /api\.list_tool_log_entries\(\{ \.\.\.filters,\s*limit:\s*200 \}\)/);
  assert.match(app, /api\.build_tool_log_export\(exportEntries,\s*\{\s*filters:\s*toolLogFilters,\s*total:\s*toolLogTotal\s*\}\)/);
  assert.match(app, /api\.delete_old_tool_logs\(30\)/);
  assert.match(source, /onDeleteOldLogs/);
  assert.match(app, /onOpenToolLogs=\{openToolLogs\}/);
});

test("frontend runtime errors are recorded in tool logs", () => {
  assert.match(app, /function writeToolLogEvent\(event\)/);
  assert.match(app, /function sanitizeFrontendRuntimeError\(error\)/);
  assert.match(app, /window\.addEventListener\("error",\s*handleFrontendError\)/);
  assert.match(app, /window\.addEventListener\("unhandledrejection",\s*handleUnhandledRejection\)/);
  assert.match(app, /window\.removeEventListener\("error",\s*handleFrontendError\)/);
  assert.match(app, /window\.removeEventListener\("unhandledrejection",\s*handleUnhandledRejection\)/);
  assert.match(app, /api\.write_tool_log_event\(event\)/);
  assert.match(app, /component:\s*"frontend"/);
  assert.match(app, /action:\s*"runtime_error"/);
  assert.match(app, /action:\s*"unhandled_rejection"/);
});

test("SSH terminal Enter submits through the bridge submit flag", () => {
  const source = app.slice(app.indexOf("async function sendSelectedSessionInput"), app.indexOf("async function sendSelectedCommand"));

  assert.match(source, /api\.send_ssh_session_input\(sessionId,\s*text,\s*submit\)/);
  assert.doesNotMatch(source, /const payload = submit \? text \+ "\\n" : text/);
});

test("local configuration read failures fall back and are recorded in tool logs", () => {
  const source = app.slice(app.indexOf("function readLocalJson"), app.indexOf("function writeLocalJson"));
  assert.match(source, /catch \(error\)/);
  assert.match(source, /writeToolLogEvent\(\{/);
  assert.match(source, /component:\s*"frontend"/);
  assert.match(source, /action:\s*"local_storage_read_failed"/);
  assert.match(source, /key/);
  assert.match(source, /sanitizeFrontendRuntimeError\(error\)/);
  assert.match(source, /return fallback/);
});

test("local configuration writes fail softly and are recorded in tool logs", () => {
  const source = app.slice(app.indexOf("function writeLocalJson"), app.indexOf("function pickTextFileFromBrowser"));
  assert.match(source, /try\s*\{/);
  assert.match(source, /localStorage\.setItem\(key,\s*JSON\.stringify\(value\)\)/);
  assert.match(source, /catch \(error\)/);
  assert.match(source, /writeToolLogEvent\(\{/);
  assert.match(source, /component:\s*"frontend"/);
  assert.match(source, /action:\s*"local_storage_write_failed"/);
  assert.match(source, /key/);
  assert.match(source, /sanitizeFrontendRuntimeError\(error\)/);
});

test("desktop config sync persists SSH workflow presets and snippets", () => {
  const loadSource = app.slice(app.indexOf("async function loadDesktopConfig"), app.indexOf("loadDesktopConfig();"));
  const persistSource = app.slice(app.indexOf("async function persistAppConfig"), app.indexOf("async function trustSelectedHostKey"));
  const snippetSource = app.slice(app.indexOf("function saveCurrentCommandSnippet"), app.indexOf("async function rerunLastCommandFromHistory"));
  const portForwardSource = app.slice(app.indexOf("function savePortForwardPreset"), app.indexOf("async function stopPortForward"));
  const backupImportSource = app.slice(app.indexOf("async function confirmBackupImport"), app.indexOf("async function importSshConfig"));
  const sshConfigImportSource = app.slice(app.indexOf("async function confirmImportSshConfig"), app.indexOf("function runConnectionCheckRepair"));

  assert.match(loadSource, /config\.portForwardPresets/);
  assert.match(loadSource, /setPortForwardPresets\(config\.portForwardPresets\)/);
  assert.match(loadSource, /config\.customCommandSnippets/);
  assert.match(loadSource, /setCustomCommandSnippets\(config\.customCommandSnippets\)/);
  assert.match(persistSource, /portForwardPresets:\s*nextPortForwardPresets/);
  assert.match(persistSource, /customCommandSnippets:\s*nextCustomCommandSnippets/);
  assert.match(snippetSource, /persistAppConfig\([\s\S]*nextSnippets/);
  assert.match(portForwardSource, /persistAppConfig\([\s\S]*next/);
  assert.match(backupImportSource, /persistAppConfig\([\s\S]*portForwardImport\.presets[\s\S]*commandSnippetImport\.snippets/);
  assert.match(sshConfigImportSource, /persistAppConfig\([\s\S]*portForwardImport\.presets[\s\S]*customCommandSnippets/);
});

test("port forward modal can copy a running local access url", () => {
  const source = componentSource("PortForwardModal", "SessionLogModal");
  const appSource = app.slice(app.indexOf("async function copyPortForwardLocalUrl"), app.indexOf("async function refreshPortForwards"));

  assert.match(source, /onCopyLocalUrl/);
  assert.match(source, /buildPortForwardLocalUrl\(item\)/);
  assert.match(source, />\s*复制地址\s*</);
  assert.match(appSource, /buildPortForwardLocalUrl\(forward\)/);
  assert.match(appSource, /navigator\.clipboard\.writeText\(url\)/);
});

test("port forward modal shows the latest operation status", () => {
  const source = componentSource("PortForwardModal", "SessionLogModal");
  const appSource = app.slice(app.indexOf("async function copyPortForwardLocalUrl"), app.indexOf("function currentSftpPath"));

  assert.match(source, /operationStatus/);
  assert.match(source, /className=\{`port-forward-operation-status \$\{operationStatus\.status\}`\}/);
  assert.match(source, /最近操作/);
  assert.match(app, /portForwardOperation,\s*setPortForwardOperation\] = useState\(null\)/);
  assert.match(appSource, /setPortForwardOperation\(\{ type:\s*"list",\s*status:\s*"running"/);
  assert.match(appSource, /setPortForwardOperation\(\{ type:\s*"start",\s*status:\s*"running"/);
  assert.match(appSource, /setPortForwardOperation\(\{ type:\s*"stop",\s*status:\s*"running"/);
  assert.match(app, /operationStatus=\{portForwardOperation\}/);
  assert.match(cssRule(".port-forward-operation-status"), /font-size:\s*12px/);
  assert.match(cssRule(".port-forward-operation-status.failed"), /background:\s*#fff5f5/);
});

test("frontend render crashes show a Chinese recovery screen instead of a blank window", () => {
  assert.match(main, /class AppErrorBoundary extends React\.Component/);
  assert.match(main, /componentDidCatch\(error,\s*info\)/);
  assert.match(main, /action:\s*"react_error_boundary"/);
  assert.match(main, /window\.pywebview\?\.api\?\.write_tool_log_event/);
  assert.match(main, /<AppErrorBoundary>/);
  assert.match(main, /<App \/>/);
  assert.match(main, /界面发生错误/);
  assert.match(main, /重新加载/);
  assert.match(main, /打开工具日志/);
  assert.match(main, /window\.location\.reload\(\)/);
  assert.match(styles, /\.app-crash-screen/);
  assert.match(styles, /\.app-crash-actions/);
});

test("desktop session log modal can delete old session logs", () => {
  const source = componentSource("SessionLogModal", "ToolLogModal");
  assert.match(app, /<SessionLogModal/);
  assert.match(source, /onDeleteOldLogs/);
  assert.match(app, /api\.delete_old_session_logs\(30\)/);
  assert.match(app, /onDeleteOldLogs=\{deleteOldSessionLogs\}/);
});

test("desktop session log modal can filter by type and status", () => {
  const source = componentSource("SessionLogModal", "ToolLogModal");
  assert.match(app, /sessionLogFilters,\s*setSessionLogFilters\] = useState\(\{ server:\s*"",\s*query:\s*"",\s*type:\s*"",\s*status:\s*"",\s*failureKind:\s*"" \}\)/);
  assert.match(source, /value=\{filters\.type \|\| ""\}/);
  assert.match(source, /onChange=\{\(event\) => onFiltersChange\(\{ \.\.\.filters,\s*type:\s*event\.target\.value \}\)\}/);
  assert.match(source, /value=\{filters\.status \|\| ""\}/);
  assert.match(source, /onChange=\{\(event\) => onFiltersChange\(\{ \.\.\.filters,\s*status:\s*event\.target\.value \}\)\}/);
  assert.match(source, /onRefresh=\{\(\) => onRefresh\(filters\)\}/);
  assert.match(app, /api\.list_session_log_entries\(\{ \.\.\.filters,\s*limit:\s*200 \}\)/);
});

test("desktop session log modal can filter by SSH failure kind", () => {
  const source = componentSource("SessionLogModal", "ToolLogModal");
  assert.match(app, /sessionLogFilters,\s*setSessionLogFilters\] = useState\(\{ server:\s*"",\s*query:\s*"",\s*type:\s*"",\s*status:\s*"",\s*failureKind:\s*"" \}\)/);
  assert.match(source, /value=\{filters\.failureKind \|\| ""\}/);
  assert.match(source, /onChange=\{\(event\) => onFiltersChange\(\{ \.\.\.filters,\s*failureKind:\s*event\.target\.value \}\)\}/);
  assert.match(source, /failureKinds = \["transport",\s*"auth"/);
  assert.match(source, /failureKinds\.map\(\(kind\) => <option key=\{kind\} value=\{kind\}>\{kind\}<\/option>\)/);
});

test("desktop session log list previews show failure kind metadata", () => {
  const source = componentSource("LogListModal", "BatchEditServersModal");
  assert.match(app, /function formatLogEntryPreview\(entry\)/);
  assert.match(source, /formatLogEntryPreview\(entry\)/);
  assert.match(app, /entry\?\.failureKind/);
  assert.match(app, /"\\u5931\\u8d25\\u7c7b\\u578b"/);
});

test("desktop session log modal shows structured SSH connection context", () => {
  const source = componentSource("SessionLogModal", "ToolLogModal");
  assert.match(source, /entry\.context/);
  assert.match(source, /JSON\.stringify\(entry\.context,\s*null,\s*2\)/);
});

test("desktop session log export reloads the full filtered result before writing Markdown", () => {
  const source = app.slice(app.indexOf("async function exportSessionLogs"), app.indexOf("async function refreshPortForwards"));

  assert.match(source, /sessionLogTotal > sessionLogEntries\.length/);
  assert.match(source, /api\.list_session_log_entries\(\{ \.\.\.sessionLogFilters,\s*limit:\s*Math\.max\(sessionLogTotal,\s*sessionLogEntries\.length,\s*200\) \}\)/);
  assert.match(source, /exportEntries = Array\.isArray\(result\.entries\) \? result\.entries : exportEntries/);
  assert.match(source, /api\.build_session_log_export\(exportEntries,\s*\{\s*filters:\s*sessionLogFilters,\s*total:\s*sessionLogTotal\s*\}\)/);
});

test("desktop tool log export reloads the full filtered result before writing Markdown", () => {
  const source = app.slice(app.indexOf("async function exportToolLogs"), app.indexOf("async function deleteOldToolLogs"));

  assert.match(source, /toolLogTotal > toolLogEntries\.length/);
  assert.match(source, /api\.list_tool_log_entries\(\{ \.\.\.toolLogFilters,\s*limit:\s*Math\.max\(toolLogTotal,\s*toolLogEntries\.length,\s*200\) \}\)/);
  assert.match(source, /exportEntries = Array\.isArray\(result\.entries\) \? result\.entries : exportEntries/);
  assert.match(source, /api\.build_tool_log_export\(exportEntries,\s*\{\s*filters:\s*toolLogFilters,\s*total:\s*toolLogTotal\s*\}\)/);
});

test("desktop log directory actions open the local folder when running as exe", () => {
  const sessionSource = app.slice(app.indexOf("async function openSessionLogDir"), app.indexOf("async function deleteOldSessionLogs"));
  const toolSource = app.slice(app.indexOf("async function openToolLogDir"), app.indexOf("async function openToolLogs"));

  assert.match(sessionSource, /const path = await api\.get_session_log_dir\(\)/);
  assert.match(sessionSource, /if \(api\.open_path\) \{\s*const result = await api\.open_path\(path\)/);
  assert.match(sessionSource, /showNotice\(result\?\.message \|\| `会话日志目录：\$\{path\}`\)/);
  assert.match(toolSource, /const path = await api\.get_tool_log_dir\(\)/);
  assert.match(toolSource, /if \(api\.open_path\) \{\s*const result = await api\.open_path\(path\)/);
  assert.match(toolSource, /showNotice\(result\?\.message \|\| `工具日志目录：\$\{path\}`\)/);
});

test("top toolbar can export a diagnostic package for bug reports", () => {
  const source = componentSource("DesktopTopBar", "Sidebar");
  assert.match(source, /onExportDiagnosticPackage/);
  assert.match(source, /label:\s*"导出诊断包"/);
  assert.match(app, /async function exportDiagnosticPackage\(\)/);
  assert.match(app, /api\.export_diagnostic_package/);
  assert.match(app, /onExportDiagnosticPackage=\{exportDiagnosticPackage\}/);
});

test("top toolbar exposes common SFTP file actions", () => {
  const source = componentSource("DesktopTopBar", "Sidebar");
  assert.match(source, /sftpTopbarActions/);
  assert.match(source, /onRefreshSftp/);
  assert.match(source, /onUploadSftp/);
  assert.match(source, /onDownloadSftp/);
  assert.match(source, /onPreviewSftpFile/);
  assert.match(source, /onCreateSftpFile/);
  assert.match(source, /onCreateSftpDirectory/);
  assert.match(source, /onRenameSftpItem/);
  assert.match(source, /onDeleteSftpItem/);
  assert.match(source, /renderTopbarMenu\("SFTP 文件"/);
  assert.match(source, /selectedFile\?\.type === "folder"/);
  assert.match(source, /isSftpBusy/);
  assert.match(app, /onRefreshSftp=\{\(\) => refreshSelectedSftp\(\)\}/);
  assert.match(app, /onUploadSftp=\{uploadSelectedSftp\}/);
  assert.match(app, /onDownloadSftp=\{downloadSelectedSftp\}/);
  assert.match(app, /onPreviewSftpFile=\{previewSelectedSftpFile\}/);
  assert.match(app, /onCreateSftpFile=\{createSelectedSftpFile\}/);
});

test("top toolbar exposes current SSH session connect and disconnect actions", () => {
  const source = componentSource("DesktopTopBar", "Sidebar");
  assert.match(source, /sessionState/);
  assert.match(source, /isSshSessionBusy/);
  assert.match(source, /isSshSessionConnected/);
  assert.match(source, /onOpenSession/);
  assert.match(source, /onCloseSession/);
  assert.match(source, /onReconnectSession/);
  assert.match(source, /onInterruptCommand/);
  assert.match(source, /label:\s*"连接 SSH 会话"/);
  assert.match(source, /label:\s*"重连 SSH 会话"/);
  assert.match(source, /label:\s*"中断当前命令"/);
  assert.match(source, /label:\s*isSshSessionBusy \? "强制断开会话" : "断开当前会话"/);
  assert.match(source, /disabled:\s*isSshSessionBusy \|\| isSshSessionConnected/);
  assert.match(source, /disabled:\s*isSshSessionBusy/);
  assert.match(source, /disabled:\s*!isSshSessionConnected/);
  assert.match(source, /disabled:\s*!isSshSessionConnected,\s*force:/);
  assert.doesNotMatch(source, /label:\s*isSshSessionBusy \? "强制断开会话" : "断开当前会话"[\s\S]{0,180}disabled:\s*isSshSessionBusy \|\| !isSshSessionConnected/);
  assert.match(app, /sessionState=\{sshSessions\[selectedTerminalSessionKey\] \|\| \{\}\}/);
  assert.match(app, /onOpenSession=\{openSelectedSession\}/);
  assert.match(app, /onCloseSession=\{closeSelectedSession\}/);
  assert.match(app, /onReconnectSession=\{reconnectSelectedSession\}/);
  assert.match(app, /onInterruptCommand=\{stopSelectedCommand\}/);
});

test("top toolbar exposes copyable SSH connection details", () => {
  const source = componentSource("DesktopTopBar", "Sidebar");
  assert.match(source, /onCopyServerSshCommand/);
  assert.match(source, /onCopyServerConnectionInfo/);
  assert.match(source, /onCopyServerTroubleshootingSummary/);
  assert.match(source, /label:\s*"复制 SSH 命令"/);
  assert.match(source, /label:\s*"复制连接信息"/);
  assert.match(source, /label:\s*"复制排障摘要"/);
  assert.match(app, /onCopyServerSshCommand=\{copyServerSshCommand\}/);
  assert.match(app, /onCopyServerConnectionInfo=\{copyServerConnectionInfo\}/);
  assert.match(app, /onCopyServerTroubleshootingSummary=\{copyServerTroubleshootingSummary\}/);
});

test("ssh command sender sends manual commands through the connected PTY input stream", () => {
  const start = app.indexOf("async function sendSelectedCommand");
  const end = app.indexOf("\n  return (", start);
  assert.notEqual(start, -1, "sendSelectedCommand should exist");
  assert.notEqual(end, -1, "sendSelectedCommand should appear before the app render");
  const source = app.slice(start, end);

  assert.match(source, /const rawCommand = String\(options\.command \?\? commandInputs\[commandInputKey\] \?\? ""\)/);
  assert.match(source, /const command = rawCommand\.trim\(\)/);
  assert.match(source, /sessionId = await ensureCommandSession\(name,\s*\{ sessionKey \}\)/);
  assert.match(source, /const result = await sendSelectedSessionInput\(event,\s*\{ text:\s*rawCommand,\s*submit:\s*true,\s*sessionKey,\s*commandInputKey,\s*targetName:\s*name,\s*clearInput:\s*false,\s*submittedCommand:\s*rawCommand \}\)/);
  assert.doesNotMatch(source, /api\.send_ssh_session_command\(sessionId,\s*command\)/);
});

test("ssh command sender preserves the exact typed command for the PTY", () => {
  const start = app.indexOf("async function sendSelectedCommand");
  const end = app.indexOf("\n  return (", start);
  assert.notEqual(start, -1, "sendSelectedCommand should exist");
  assert.notEqual(end, -1, "sendSelectedCommand should appear before the app render");
  const source = app.slice(start, end);

  assert.match(source, /const rawCommand = String\(options\.command \?\? commandInputs\[commandInputKey\] \?\? ""\)/);
  assert.match(source, /const command = rawCommand\.trim\(\)/);
  assert.match(source, /text:\s*rawCommand/);
  assert.match(source, /submittedCommand:\s*rawCommand/);
});

test("ssh command sender shows local command echo before waiting for remote output", () => {
  const start = app.indexOf("async function sendSelectedCommand");
  const end = app.indexOf("\n  return (", start);
  assert.notEqual(start, -1, "sendSelectedCommand should exist");
  assert.notEqual(end, -1, "sendSelectedCommand should appear before the app render");
  const source = app.slice(start, end);

  assert.match(source, /appendTerminalLines\(name,\s*\[`\$\{terminalPromptLabel\(name\)\} \$\{rawCommand\}`\],\s*\{ terminalKey:\s*sessionKey \}\)/);
  assert.match(source, /submittedCommand:\s*rawCommand/);
  assert.ok(source.indexOf("appendTerminalLines(name, [`${terminalPromptLabel(name)} ${rawCommand}`]") < source.indexOf("const result = await sendSelectedSessionInput"));
});

test("ssh command sender keeps ordinary commands in normal shell mode", () => {
  const start = app.indexOf("async function sendSelectedCommand");
  const end = app.indexOf("\n  return (", start);
  assert.notEqual(start, -1, "sendSelectedCommand should exist");
  assert.notEqual(end, -1, "sendSelectedCommand should appear before the app render");
  const source = app.slice(start, end);

  assert.match(source, /const interactiveMode = isLongRunningCommand\(command\)/);
  assert.match(source, /setSshSessions\(\(current\) => \{/);
  assert.match(source, /if \(!interactiveMode\) \{/);
  assert.ok(source.indexOf("if (!interactiveMode)") < source.indexOf("busy: true"));
});

test("ssh command sender marks long-running PTY commands interruptible", () => {
  const start = app.indexOf("async function sendSelectedCommand");
  const end = app.indexOf("\n  return (", start);
  assert.notEqual(start, -1, "sendSelectedCommand should exist");
  assert.notEqual(end, -1, "sendSelectedCommand should appear before the app render");
  const source = app.slice(start, end);

  assert.match(source, /const interactiveMode = isLongRunningCommand\(command\)/);
  assert.match(source, /busy:\s*true/);
  assert.match(source, /interactiveMode:\s*true/);
  assert.ok(source.indexOf("if (!interactiveMode)") < source.indexOf("busy: true"));
  assert.ok(source.indexOf("busy: true") < source.indexOf("const result = await sendSelectedSessionInput"));
});

test("ssh command sender forwards an empty Enter to an already connected shell", () => {
  const start = app.indexOf("async function sendSelectedCommand");
  const end = app.indexOf("\n  return (", start);
  assert.notEqual(start, -1, "sendSelectedCommand should exist");
  assert.notEqual(end, -1, "sendSelectedCommand should appear before the app render");
  const source = app.slice(start, end);

  assert.match(source, /const rawCommand = String\(options\.command \?\? commandInputs\[commandInputKey\] \?\? ""\)/);
  assert.match(source, /const command = rawCommand\.trim\(\)/);
  assert.match(source, /if \(!command && sessionId\) \{/);
  assert.match(source, /await sendSelectedSessionInput\(event,\s*\{ text:\s*"",\s*submit:\s*true,\s*sessionKey,\s*commandInputKey,\s*targetName:\s*name \}\)/);
});

test("manual SSH command sender does not open blocking browser confirmation dialogs", () => {
  const start = app.indexOf("async function sendSelectedCommand");
  const end = app.indexOf("\n  return (", start);
  assert.notEqual(start, -1, "sendSelectedCommand should exist");
  assert.notEqual(end, -1, "sendSelectedCommand should appear before the app render");
  const source = app.slice(start, end);

  assert.doesNotMatch(source, /policy\.action === COMMAND_POLICY_ACTIONS\.block/);
  assert.doesNotMatch(source, /command_blocked/);
  assert.doesNotMatch(source, /命令策略已阻断/);
  assert.doesNotMatch(source, /window\.confirm/);
  assert.doesNotMatch(source, /command_review_(?:cancelled|approved)/);
});

test("manual SSH command sender does not route normal Enter through command review execution", () => {
  const start = app.indexOf("async function sendSelectedCommand");
  const end = app.indexOf("\n  return (", start);
  assert.notEqual(start, -1, "sendSelectedCommand should exist");
  assert.notEqual(end, -1, "sendSelectedCommand should appear before the app render");
  const source = app.slice(start, end);

  assert.doesNotMatch(source, /const keepCommandBusy = isLongRunningCommand\(command\)/);
  assert.doesNotMatch(source, /COMMAND_POLICY_ACTIONS/);
  assert.doesNotMatch(source, /buildCommandExecutionPlan/);
});

test("SSH terminal core session messages stay readable Chinese", () => {
  const start = app.indexOf("async function openSelectedSession");
  const end = app.indexOf("  return (", start);
  assert.notEqual(start, -1, "openSelectedSession should exist");
  assert.notEqual(end, -1, "terminal session source should end before TerminalWorkspace render");
  const source = app.slice(start, end);

  assert.match(source, /SSH 会话连接失败/);
  assert.match(source, /SSH 会话已连接/);
  assert.match(source, /未连接，正在自动连接 SSH 会话/);
  assert.match(source, /已发送 Ctrl\+C 中断当前 SSH 命令/);
  assert.match(source, /当前没有已连接的 SSH 会话/);
  assert.deepEqual(findSuspiciousLocalizationText(source), []);
});

test("top toolbar exposes terminal output copy and clear actions", () => {
  const source = componentSource("DesktopTopBar", "Sidebar");
  assert.match(source, /onCopyTerminal/);
  assert.match(source, /onClearTerminal/);
  assert.match(source, /label:\s*"复制选中\/输出"/);
  assert.match(source, /label:\s*"清空当前终端"/);
  assert.match(app, /onCopyTerminal=\{copySelectedTerminalTextOrOutput\}/);
  assert.match(app, /onClearTerminal=\{clearSelectedTerminalOutput\}/);
});

test("terminal workspace supports familiar desktop SSH shortcuts", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  assert.match(app, /getTerminalShortcutAction/);
  assert.match(app, /function runTerminalShortcutAction\(event\)/);
  assert.match(app, /action === "copy-output"/);
  assert.match(app, /action === "interrupt-session"/);
  assert.match(app, /action === "paste-command"/);
  assert.match(app, /action === "clear-output"/);
  assert.match(app, /action === "clear-input"/);
  assert.match(app, /action === "disconnect-session"/);
  assert.match(source, /onTerminalShortcutKeyDown/);
  assert.match(source, /tabIndex=\{0\}/);
  assert.match(source, /function handleTerminalShellKeyDown\(event\)/);
  assert.match(source, /onTerminalShortcutKeyDown\(event\)/);
  assert.match(source, /onKeyDown=\{handleTerminalShellKeyDown\}/);
  assert.match(app, /onTerminalShortcutKeyDown=\{handleTerminalShortcutKeyDown\}/);
});

test("terminal shell Ctrl+C interrupts the connected SSH session from the output area", () => {
  const source = app.slice(app.indexOf("function runTerminalShortcutAction"), app.indexOf("function handleTerminalShortcutKeyDown"));

  assert.match(source, /action === "interrupt-session"/);
  assert.match(source, /sshSessions\[selectedTerminalSessionKey\]\?\.sessionId/);
  assert.match(source, /stopSelectedCommand\(\)/);
});

test("terminal shell Ctrl+C sends the PTY control byte before desktop shortcuts", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  const directControlSource = source.slice(source.indexOf("function sendConnectedShellSurfaceDirectControlInput"), source.indexOf("function focusCommandInputFromTerminalSurface"));
  const whitelistSource = app.slice(app.indexOf("function isConnectedShellDirectControlKey"), app.indexOf("const SERVER_DATA"));

  assert.match(whitelistSource, /"c"/);
  assert.match(directControlSource, /controlInput\?\.action === "interrupt"/);
  assert.match(directControlSource, /text:\s*"\\x03"/);
  assert.ok(source.indexOf("if (sendConnectedShellSurfaceDirectControlInput(event)) return;") < source.indexOf("if (onTerminalShortcutKeyDown(event)) return;"));
});

test("terminal shell Ctrl+V can paste directly into a connected SSH session from the output area", () => {
  const shortcutSource = app.slice(app.indexOf("function runTerminalShortcutAction"), app.indexOf("function handleTerminalShortcutKeyDown"));
  const pasteSource = app.slice(app.indexOf("async function pasteClipboardToCommandInput"), app.indexOf("function getSftpRemotePath"));

  assert.match(shortcutSource, /pasteClipboardToCommandInput\(\{ sendToConnectedSession:\s*true \}\)/);
  assert.match(pasteSource, /options = \{\}/);
  assert.match(pasteSource, /const shouldPasteIntoConnectedSession = Boolean\(/);
  assert.match(pasteSource, /options\?\.sendToConnectedSession/);
  assert.match(pasteSource, /runningSession\?\.sessionId/);
  assert.match(pasteSource, /!\(commandInputs\[inputKey\] \|\| ""\)\.trim\(\)/);
  assert.match(pasteSource, /if \(shouldPasteIntoConnectedSession \|\| \(runningSession\?\.busy && runningSession\?\.sessionId\)\)/);
});

test("TerminalWorkspace can type into the SSH command line from the terminal surface", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  assert.match(source, /const commandInputRef = useRef\(null\)/);
  assert.match(source, /ref=\{commandInputRef\}/);
  assert.match(source, /function draftTerminalSurfaceInput\(event\)/);
  assert.match(source, /function focusCommandInputFromTerminalSurface\(event\)/);
  assert.match(source, /if \(event\.button !== 0\) return/);
  assert.match(source, /if \(isTerminalInputEventTarget\(event\)\) return/);
  assert.match(source, /commandInputRef\.current\?\.focus\(\)/);
  assert.match(source, /onCommandChange\(`\$\{commandValue\}\$\{key\}`\)/);
  assert.match(source, /key === "Backspace"[\s\S]{0,180}onCommandChange\(commandValue\.slice\(0,\s*-1\)\)/);
  assert.match(source, /onMouseDown=\{focusCommandInputFromTerminalSurface\}/);
  assert.match(source, /isRunningInteractiveCommand\) \{\s*onCommandKeyDown\(event\)/);
});

test("TerminalWorkspace sends connected shell keystrokes directly from the terminal surface", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");

  assert.match(source, /function sendConnectedShellSurfaceInput\(event\)/);
  assert.match(source, /if \(!isConnected \|\| isRunningInteractiveCommand \|\| commandValue\) return false/);
  assert.match(source, /const controlInput = buildRunningSessionControlInput\(event,\s*""\)/);
  assert.match(source, /const metaInput = buildRunningSessionMetaInput\(event,\s*""\)/);
  assert.match(source, /const keyInput = buildRunningSessionKeyInput\(event\.key,\s*"",\s*event\)/);
  assert.match(source, /const textInput = buildRunningSessionTextInput\(event,\s*""\)/);
  assert.match(source, /onSendInteractiveInput\(event,\s*\{ \.\.\.connectedShellInput,\s*clearInput:\s*false \}\)/);
  assert.ok(source.indexOf("if (sendConnectedShellSurfaceInput(event)) return;") < source.indexOf("if (scrollTerminalOutputByKey(event)) return;"));
  assert.ok(source.indexOf("if (sendConnectedShellSurfaceInput(event)) return;") < source.indexOf("if (draftTerminalSurfaceInput(event)) return;"));
});

test("TerminalWorkspace sends connected shell direct control keys from the terminal surface before desktop shortcuts", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");

  assert.match(source, /function sendConnectedShellSurfaceDirectControlInput\(event\)/);
  assert.match(source, /const controlInput = isConnectedShellDirectControlKey\(event\) \? buildRunningSessionControlInput\(event,\s*""\) : null/);
  assert.match(source, /const connectedShellControlInput = controlInput\?\.action === "interrupt"/);
  assert.match(source, /onSendInteractiveInput\(event,\s*\{ \.\.\.connectedShellControlInput,\s*clearInput:\s*false \}\)/);
  assert.ok(source.indexOf("if (sendConnectedShellSurfaceDirectControlInput(event)) return;") < source.indexOf("if (onTerminalShortcutKeyDown(event)) return;"));
  assert.ok(source.indexOf("if (onTerminalShortcutKeyDown(event)) return;") < source.indexOf("if (sendConnectedShellSurfaceInput(event)) return;"));
});

test("terminal shell Ctrl+L clears the remote shell before local terminal output", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  const directControlSource = source.slice(source.indexOf("function sendConnectedShellSurfaceDirectControlInput"), source.indexOf("function focusCommandInputFromTerminalSurface"));
  const whitelistSource = app.slice(app.indexOf("function isConnectedShellDirectControlKey"), app.indexOf("const SERVER_DATA"));

  assert.match(whitelistSource, /"l"/);
  assert.match(directControlSource, /onSendInteractiveInput\(event,\s*\{ \.\.\.connectedShellControlInput,\s*clearInput:\s*false \}\)/);
  assert.ok(source.indexOf("if (sendConnectedShellSurfaceDirectControlInput(event)) return;") < source.indexOf("if (onTerminalShortcutKeyDown(event)) return;"));
});

test("TerminalWorkspace supports Ctrl+F to focus terminal search", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  assert.match(source, /terminalSearchInputRef/);
  assert.match(source, /function focusTerminalSearchShortcut\(event\)/);
  assert.match(source, /action !== "focus-search"/);
  assert.match(source, /terminalSearchInputRef\.current\?\.focus\(\)/);
  assert.match(source, /terminalSearchInputRef\.current\?\.select\?\.\(\)/);
  assert.match(source, /onKeyDown=\{handleTerminalShellKeyDown\}/);
  assert.match(source, /onKeyDown=\{handleCommandInputKeyDown\}/);
  assert.match(source, /ref=\{terminalSearchInputRef\}/);
});

test("TerminalWorkspace sends interactive SSH Ctrl+F before local terminal search", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  const handler = source.slice(source.indexOf("function handleTerminalShellKeyDown"), source.indexOf("function handleHistoryUse"));

  assert.match(handler, /if \(isRunningInteractiveCommand\) \{\s*onCommandKeyDown\(event\)/);
  assert.match(handler, /if \(focusTerminalSearchShortcut\(event\)\) return/);
  assert.ok(handler.indexOf("if (isRunningInteractiveCommand)") < handler.indexOf("if (focusTerminalSearchShortcut(event)) return;"));
});

test("Terminal command input sends interactive SSH Ctrl+F before local terminal search", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  const handler = source.slice(source.indexOf("function handleCommandInputKeyDown"), source.indexOf("function applyCommandEditShortcut"));

  assert.match(handler, /if \(isRunningInteractiveCommand\) \{\s*onCommandKeyDown\(event\)/);
  assert.match(handler, /if \(focusTerminalSearchShortcut\(event\)\) return/);
  assert.ok(handler.indexOf("if (isRunningInteractiveCommand)") < handler.indexOf("if (focusTerminalSearchShortcut(event)) return;"));
});

test("TerminalWorkspace supports keyboard navigation inside terminal search", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  assert.match(app, /getTerminalSearchKeyAction/);
  assert.match(source, /function handleTerminalSearchKeyDown\(event\)/);
  assert.match(source, /action === "next-match"/);
  assert.match(source, /jumpTerminalSearch\(1\)/);
  assert.match(source, /action === "previous-match"/);
  assert.match(source, /jumpTerminalSearch\(-1\)/);
  assert.match(source, /action === "blur-search"/);
  assert.match(source, /terminalSearchInputRef\.current\?\.blur\(\)/);
  assert.match(source, /onKeyDown=\{handleTerminalSearchKeyDown\}/);
});

test("terminal shortcuts can switch and close SSH tabs", () => {
  const source = app.slice(app.indexOf("function selectAdjacentServerTab"), app.indexOf("function applyTerminalZoom"));
  assert.match(app, /selectedTerminalTabId/);
  assert.match(app, /function selectAdjacentServerTab\(direction\)/);
  assert.match(source, /visibleTerminalTabs\.findIndex\(\(tab\) => tab\.id === selectedTerminalTabId\)/);
  assert.match(source, /selectTerminalTab\(visibleTerminalTabs\[nextIndex\]\?\.id\)/);
  assert.match(app, /function selectServerTabAtIndex\(position\)/);
  assert.match(app, /const targetIndex = Number\(position\) - 1/);
  assert.match(app, /selectTerminalTab\(visibleTerminalTabs\[targetIndex\]\?\.id\)/);
  assert.match(app, /action === "previous-tab"/);
  assert.match(app, /selectAdjacentServerTab\(-1\)/);
  assert.match(app, /action === "next-tab"/);
  assert.match(app, /selectAdjacentServerTab\(1\)/);
  assert.match(app, /const selectTabMatch = action\.match\(\/\^select-tab-\(\\d\+\)\$\/\)/);
  assert.match(app, /selectServerTabAtIndex\(selectTabMatch\[1\]\)/);
  assert.match(app, /action === "close-tab"/);
  assert.match(app, /closeServerTab\(selectedTerminalTabId\)/);
  assert.match(app, /action === "duplicate-tab"/);
  assert.match(app, /openDuplicateSelectedTerminalTab\(\)/);
  assert.match(app, /action === "rename-tab"/);
  assert.match(app, /renameSelectedTerminalTabTitle\(\)/);
  assert.match(app, /action === "open-cwd-in-sftp"/);
  assert.match(app, /openCurrentWorkingDirectoryInSftp\(\)/);
  assert.match(app, /action === "toggle-pin-tab"/);
  assert.match(app, /toggleSelectedTerminalTabPinned\(\)/);
  assert.match(app, /action === "reconnect-session"/);
  assert.match(app, /sshSessions\[selectedTerminalSessionKey\]\?\.busy/);
  assert.match(app, /当前 SSH 命令运行中，请先停止后再重连。/);
  assert.match(app, /reconnectSelectedSession\(\)/);
});

test("terminal shortcuts can zoom terminal font size", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  assert.match(app, /terminalFontSize/);
  assert.match(app, /sshAgentTerminalFontSize/);
  assert.match(app, /adjustTerminalFontSize/);
  assert.match(app, /function applyTerminalZoom\(action\)/);
  assert.match(app, /\["zoom-in", "zoom-out", "zoom-reset"\]\.includes\(action\)/);
  assert.match(app, /applyTerminalZoom\(action\)/);
  assert.match(source, /"--terminal-font-size": `\$\{terminalFontSize \|\| DEFAULT_TERMINAL_FONT_SIZE\}px`/);
  assert.match(styles, /\.terminal-lines pre[\s\S]*font-size:\s*var\(--terminal-font-size,\s*14px\)/);
  assert.match(styles, /\.terminal-command-line[\s\S]*font-size:\s*var\(--terminal-font-size,\s*14px\)/);
});

test("terminal output supports Ctrl wheel font zoom", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");

  assert.match(source, /function handleTerminalOutputWheel\(event\)/);
  assert.match(source, /if \(!\(event\.ctrlKey \|\| event\.metaKey\)\) return/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /onTerminalZoom\?\.\(event\.deltaY < 0 \? "zoom-in" : "zoom-out"\)/);
  assert.match(source, /onWheel=\{handleTerminalOutputWheel\}/);
});

test("terminal workspace supports F11 focus mode", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  const renderSource = app.slice(app.indexOf("<TerminalWorkspace"), app.indexOf("<div\n          className=\"layout-resizer right-resizer\""));

  assert.match(app, /const \[terminalFocusMode,\s*setTerminalFocusMode\] = useState\(false\)/);
  assert.match(app, /action === "toggle-terminal-focus"/);
  assert.match(app, /setTerminalFocusMode\(\(current\) => !current\)/);
  assert.match(app, /className=\{`workspace-grid \$\{terminalFocusMode \? "terminal-focus-mode" : ""\}`\}/);
  assert.match(renderSource, /terminalFocusMode=\{terminalFocusMode\}/);
  assert.match(renderSource, /onToggleTerminalFocusMode=\{toggleTerminalFocusMode\}/);
  assert.match(source, /onToggleTerminalFocusMode/);
  assert.match(source, /aria-pressed=\{terminalFocusMode\}/);
  assert.match(source, /终端专注模式/);
  assert.match(styles, /\.workspace-grid\.terminal-focus-mode[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(styles, /\.workspace-grid\.terminal-focus-mode \.sidebar[\s\S]*display:\s*none/);
  assert.match(styles, /\.workspace-grid\.terminal-focus-mode \.agent-panel[\s\S]*display:\s*none/);
  assert.match(styles, /\.workspace-grid\.terminal-focus-mode \.layout-resizer[\s\S]*display:\s*none/);
});

test("tool settings opens a dedicated terminal display settings modal", () => {
  const topbarRender = app.slice(app.indexOf("<DesktopTopBar"), app.indexOf("<Sidebar"));
  const modalSource = componentSource("ToolSettingsModal", "ModelSettingsModal");

  assert.match(app, /const \[toolSettingsOpen,\s*setToolSettingsOpen\] = useState\(false\)/);
  assert.match(topbarRender, /onOpenToolSettings=\{\(\) => setToolSettingsOpen\(true\)\}/);
  assert.match(topbarRender, /onOpenModelSettings=\{\(\) => setSettingsOpen\(true\)\}/);
  assert.match(app, /toolSettingsOpen &&/);
  assert.match(app, /<ToolSettingsModal/);
  assert.match(app, /terminalFontSize=\{terminalFontSize\}/);
  assert.match(app, /onTerminalZoom=\{applyTerminalZoom\}/);
  assert.match(modalSource, /aria-label="工具设置"/);
  assert.match(modalSource, /终端显示/);
  assert.match(modalSource, /当前字号/);
  assert.match(modalSource, /onTerminalZoom\("zoom-out"\)/);
  assert.match(modalSource, /onTerminalZoom\("zoom-reset"\)/);
  assert.match(modalSource, /onTerminalZoom\("zoom-in"\)/);
});

test("tool settings exposes terminal scroll behavior and log shortcuts", () => {
  const modalSource = componentSource("ToolSettingsModal", "ModelSettingsModal");
  const renderSource = app.slice(app.indexOf("<ToolSettingsModal"), app.indexOf("{releaseInfoOpen &&"));

  assert.match(renderSource, /terminalScrollLocked=\{terminalScrollLocked\}/);
  assert.match(renderSource, /onToggleTerminalScrollLock=\{toggleTerminalScrollLock\}/);
  assert.match(renderSource, /onOpenSessionLogs=\{\(\) => openSessionLogs\(\{ server:\s*selectedServer \}\)\}/);
  assert.match(renderSource, /onOpenToolLogs=\{openToolLogs\}/);
  assert.match(renderSource, /onExportDiagnosticPackage=\{exportDiagnosticPackage\}/);
  assert.match(modalSource, /const scrollStatus = terminalScrollLocked \? "滚动已锁定" : "自动跟随输出"/);
  assert.match(modalSource, /<p>\{scrollStatus\}<\/p>/);
  assert.match(modalSource, /onToggleTerminalScrollLock/);
  assert.match(modalSource, /运行日志/);
  assert.match(modalSource, /onClose\?\.\(\);[\s\S]*onOpenSessionLogs\?\.\(\)/);
  assert.match(modalSource, /onClose\?\.\(\);[\s\S]*onOpenToolLogs\?\.\(\)/);
  assert.match(modalSource, /onClose\?\.\(\);[\s\S]*onExportDiagnosticPackage\?\.\(\)/);
  assert.match(modalSource, /onOpenSessionLogs/);
  assert.match(modalSource, /onOpenToolLogs/);
  assert.match(modalSource, /onExportDiagnosticPackage/);
  assert.match(modalSource, /导出诊断包/);
  assert.match(app, /Ctrl\+Shift\+G 打开工具日志/);
  assert.doesNotMatch(app, /Ctrl\+Shift\+G 打开\/关闭 Agent/);
});

test("tool settings exposes native Windows client maintenance actions", () => {
  const modalSource = componentSource("ToolSettingsModal", "ModelSettingsModal");
  const renderSource = app.slice(app.indexOf("<ToolSettingsModal"), app.indexOf("{releaseInfoOpen &&"));

  assert.match(renderSource, /onCreateDesktopShortcut=\{createDesktopShortcut\}/);
  assert.match(renderSource, /onOpenInstallDirectory=\{openInstallDirectory\}/);
  assert.match(renderSource, /onOpenAppDataDirectory=\{openAppDataDirectory\}/);
  assert.match(modalSource, /本机客户端/);
  assert.match(modalSource, /创建桌面快捷方式/);
  assert.match(modalSource, /打开安装目录/);
  assert.match(modalSource, /打开数据目录/);
  assert.match(modalSource, /onCreateDesktopShortcut/);
  assert.match(modalSource, /onOpenInstallDirectory/);
  assert.match(modalSource, /onOpenAppDataDirectory/);
});

test("release info copy actions show readable clipboard failure status", () => {
  const releaseSource = app.slice(app.indexOf("function ReleaseInfoModal"), app.indexOf("function HostFormModal"));
  const copyReleaseSource = releaseSource.slice(releaseSource.indexOf("async function copyReleaseInfo"), releaseSource.indexOf("async function copyTroubleshootingInfo"));
  const copyTroubleshootingSource = releaseSource.slice(releaseSource.indexOf("async function copyTroubleshootingInfo"), releaseSource.indexOf("function openLatestPackageUrl"));

  assert.match(copyReleaseSource, /try\s*\{/);
  assert.match(copyReleaseSource, /catch\s*\(error\)\s*\{/);
  assert.match(copyReleaseSource, /版本信息复制失败/);
  assert.match(copyReleaseSource, /剪贴板/);
  assert.match(copyTroubleshootingSource, /try\s*\{/);
  assert.match(copyTroubleshootingSource, /catch\s*\(error\)\s*\{/);
  assert.match(copyTroubleshootingSource, /排查说明复制失败/);
  assert.match(copyTroubleshootingSource, /剪贴板/);
});

test("tool settings can reset the resizable desktop layout", () => {
  const modalSource = componentSource("ToolSettingsModal", "ModelSettingsModal");
  const renderSource = app.slice(app.indexOf("<ToolSettingsModal"), app.indexOf("{releaseInfoOpen &&"));

  assert.match(app, /const DEFAULT_LAYOUT_COLUMNS = \{ left:\s*230,\s*right:\s*380 \}/);
  assert.match(app, /function resetLayoutColumns\(\)/);
  assert.match(app, /setLayoutColumns\(DEFAULT_LAYOUT_COLUMNS\)/);
  assert.match(app, /writeLocalJson\("sshAgentLayoutColumns",\s*DEFAULT_LAYOUT_COLUMNS\)/);
  assert.match(renderSource, /onResetLayout=\{resetLayoutColumns\}/);
  assert.match(modalSource, /界面布局/);
  assert.match(modalSource, /恢复默认三栏宽度/);
  assert.match(modalSource, /onResetLayout/);
});

test("Sidebar is focused on server and SFTP resources", () => {
  const source = componentSource("Sidebar", "TerminalWorkspace");
  const topbar = componentSource("DesktopTopBar", "Sidebar");
  assert.match(source, /className="panel sidebar-section server-section"/);
  assert.match(source, /className="panel sidebar-section sftp-section"/);
  assert.match(topbar, /renderTopbarMenu\("SSH 操作"/);
  assert.match(topbar, /renderTopbarMenu\("诊断"/);
  assert.match(topbar, /sshTopbarActions/);
  assert.match(topbar, /diagnosticTopbarActions/);
  assert.doesNotMatch(source, /sidebar-brand/);
  assert.doesNotMatch(source, /本地桌面版/);
  assert.doesNotMatch(source, /compact-section/);
  assert.doesNotMatch(source, /skill-section/);
  assert.doesNotMatch(source, /diagnostic-skills/);
  assert.doesNotMatch(source, /connection-repair-plan/);
  assert.doesNotMatch(source, /<span>SSH 操作<\/span>/);
  assert.doesNotMatch(source, /<span>诊断技能<\/span>/);
  assert.doesNotMatch(source, /diagnosticSkills\.map/);
  assert.doesNotMatch(source, /onBatchTestConnections\(filteredServerNames\)/);
  assert.doesNotMatch(source, /onQueueBatchAgent\(filteredServerNames\)/);
  assert.doesNotMatch(source, /onTestConnection/);
  assert.doesNotMatch(source, /onReadBasicInfo/);
  assert.doesNotMatch(source, /onExportConnectionCheckReport/);
  assert.doesNotMatch(source, /onClick=\{onOpenNewHost\}[\s\S]*新建连接/);
  assert.doesNotMatch(source, /onClick=\{onImportSshConfig\}[\s\S]*导入配置/);
  assert.doesNotMatch(source, /onClick=\{onOpenPortForward\}[\s\S]*端口转发/);
  assert.doesNotMatch(source, /onClick=\{onOpenSessionLogs\}[\s\S]*会话日志/);
  assert.doesNotMatch(source, /onClick=\{onOpenAuthCenter\}[\s\S]*密钥认证/);
  assert.doesNotMatch(source, /onClick=\{onOpenBackup\}[\s\S]*备份导出/);
  assert.doesNotMatch(source, /onClick=\{onImportBackup\}[\s\S]*导入备份/);
  assert.doesNotMatch(source, /onOpenBackup,/);
  assert.doesNotMatch(source, /onImportSshConfig,/);
  assert.doesNotMatch(source, /onImportBackup,/);
  assert.doesNotMatch(source, /onOpenPortForward,/);
  assert.doesNotMatch(source, /onOpenSessionLogs,/);
});

test("tool settings can restore hidden builtin servers", () => {
  const modalSource = componentSource("ToolSettingsModal", "ModelSettingsModal");
  const renderSource = app.slice(app.indexOf("{toolSettingsOpen &&"), app.indexOf("{releaseInfoOpen &&"));
  const actionSource = app.slice(app.indexOf("async function restoreHiddenBuiltinServers"), app.indexOf("function openServerBackup"));

  assert.match(modalSource, /hiddenBuiltinServerCount/);
  assert.match(modalSource, /恢复隐藏服务器/);
  assert.match(modalSource, /onRestoreHiddenBuiltinServers/);
  assert.match(modalSource, /disabled=\{hiddenBuiltinServerCount === 0\}/);
  assert.match(renderSource, /hiddenBuiltinServerCount=\{\(hiddenBuiltinServers \|\| \[\]\)\.length\}/);
  assert.match(renderSource, /onRestoreHiddenBuiltinServers=\{restoreHiddenBuiltinServers\}/);
  assert.match(actionSource, /setHiddenBuiltinServers\(\[\]\)/);
  assert.match(actionSource, /persistAppConfig\(customServers,\s*modelConfig,\s*customAgentCapabilities,\s*modelProfiles,\s*activeModelProfileId,\s*\[\]/);
  assert.match(actionSource, /writeServerManagementLog\("restore_hidden_builtin_servers"/);
});

test("topbar connection check report export handler is defined before render", () => {
  const renderIndex = app.indexOf("onExportConnectionCheckReport={exportConnectionCheckReport}");
  const handlerIndex = app.indexOf("async function exportConnectionCheckReport");

  assert.ok(renderIndex > -1);
  assert.ok(handlerIndex > -1);
  assert.ok(handlerIndex < renderIndex);
  assert.match(app, /buildConnectionCheckReport/);
  assert.match(app, /latestConnectionCheck/);
});

test("App render does not pass undefined bare handler references", () => {
  const renderStart = app.indexOf("<DesktopTopBar");
  const beforeRender = app.slice(0, renderStart);
  const renderSource = app.slice(renderStart);
  const handlerNames = [...new Set(
    [...renderSource.matchAll(/\bon[A-Z][A-Za-z0-9_]*=\{([A-Za-z_$][\w$]*)\}/g)].map((match) => match[1]),
  )].sort();
  const missing = handlerNames.filter((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`(?:async\\s+function|function)\\s+${escaped}\\s*\\(`).test(beforeRender)
      && !new RegExp(`(?:const|let|var)\\s+${escaped}\\b`).test(beforeRender)
      && !new RegExp(`[,\\[]\\s*${escaped}\\s*[,\\]]`).test(beforeRender);
  });

  assert.deepEqual(missing, []);
});

test("Sidebar can open an SSH session by double clicking a server", () => {
  const source = componentSource("Sidebar", "TerminalWorkspace");
  assert.match(source, /onOpenServerSession/);
  assert.match(source, /onDoubleClick=\{\(\) => onOpenServerSession\(name\)\}/);
  assert.match(app, /onOpenServerSession=\{openSelectedSession\}/);
});

test("auth center can unlink an encrypted SSH credential", () => {
  const modalSource = componentSource("AuthCenterModal", "NewHostModal");
  const actionSource = app.slice(app.indexOf("async function removeSelectedCredential"), app.indexOf("async function materializeBuiltinServerForEdit"));
  const renderSource = app.slice(app.indexOf("{authCenterOpen &&"), app.indexOf("{batchEditOpen &&"));

  assert.match(modalSource, /onRemoveCredential/);
  assert.match(modalSource, /server\?\.credentialRef/);
  assert.match(modalSource, /onClick=\{onRemoveCredential\}/);
  assert.match(actionSource, /api\?\.delete_credential/);
  assert.match(actionSource, /await api\.delete_credential\(server\.credentialRef\)/);
  assert.match(actionSource, /credentialRef:\s*""/);
  assert.match(actionSource, /hasCredential:\s*false/);
  assert.match(actionSource, /await persistAppConfig\(nextCustomServers,\s*modelConfig\)/);
  assert.match(renderSource, /onRemoveCredential=\{removeSelectedCredential\}/);
  assert.doesNotMatch(actionSource, /window\.confirm/);
  assert.match(actionSource, /setPendingConfirmAction\(\{/);
});

test("SSH destructive server actions use a desktop confirmation modal", () => {
  const credentialSource = app.slice(app.indexOf("async function removeSelectedCredential"), app.indexOf("async function materializeBuiltinServerForEdit"));
  const deleteSource = app.slice(app.indexOf("async function deleteSelectedHost"), app.indexOf("async function hideBuiltinServer"));
  const hideSource = app.slice(app.indexOf("async function hideBuiltinServer"), app.indexOf("async function toggleServerFavorite"));

  assert.match(app, /function DesktopConfirmModal/);
  assert.match(app, /pendingConfirmAction/);
  assert.match(app, /submitPendingConfirmAction/);
  assert.match(app, /<DesktopConfirmModal/);
  assert.doesNotMatch(credentialSource, /window\.confirm/);
  assert.doesNotMatch(deleteSource, /window\.confirm/);
  assert.doesNotMatch(hideSource, /window\.confirm/);
  assert.match(credentialSource, /setPendingConfirmAction\(\{/);
  assert.match(deleteSource, /setPendingConfirmAction\(\{/);
  assert.match(hideSource, /setPendingConfirmAction\(\{/);
});

test("opening a SSH session selects and opens the target terminal tab first", () => {
  const source = app.slice(app.indexOf("async function openSelectedSession"), app.indexOf("async function ensureCommandSession"));
  assert.match(source, /selectServerTab\(name\)/);
  assert.match(source, /const server = servers\[name\]/);
  assert.ok(source.indexOf("selectServerTab(name)") < source.indexOf("const api = safeFileApi()"));
});

test("opening an already connected SSH session reuses the existing session", () => {
  const source = app.slice(app.indexOf("async function openSelectedSession"), app.indexOf("async function ensureCommandSession"));
  assert.match(source, /const current = sshSessions\[sessionKey\] \|\| \{\}/);
  assert.match(source, /if \(current\.sessionId && !force\)/);
  assert.match(source, /return current\.sessionId/);
  assert.ok(source.indexOf("const current = sshSessions[sessionKey] || {}") < source.indexOf("const api = safeFileApi()"));
  assert.ok(source.indexOf("return current.sessionId") < source.indexOf("api.open_ssh_session"));
});

test("opening a SSH session while connecting does not start another backend session", () => {
  const source = app.slice(app.indexOf("async function openSelectedSession"), app.indexOf("async function ensureCommandSession"));
  assert.match(source, /if \(current\.busy && !force\)/);
  assert.match(source, /return current\.sessionId \|\| ""/);
  assert.ok(source.indexOf("if (current.busy && !force)") < source.indexOf("const api = safeFileApi()"));
  assert.ok(source.indexOf("if (current.busy && !force)") < source.indexOf("api.open_ssh_session"));
});

test("opening a SSH session restores the configured working directory", () => {
  const source = app.slice(app.indexOf("async function openSelectedSession"), app.indexOf("async function ensureCommandSession"));
  assert.match(app, /async function restoreSessionWorkingDirectory\(name,\s*sessionId,\s*server,\s*options = \{\}\)/);
  assert.match(app, /quoteSftpPathForShell\(cwd\)/);
  assert.match(app, /const command = "cd " \+ quoteSftpPathForShell\(cwd\)/);
  assert.match(app, /api\.send_ssh_session_command\(sessionId,\s*command\)/);
  assert.match(app, /type:\s*"session_restore_cwd"/);
  assert.match(source, /restoreSessionWorkingDirectory\(name,\s*result\.sessionId,\s*server,\s*\{ terminalKey: sessionKey \}\)/);
  assert.ok(source.indexOf("sessionId: result.sessionId") < source.indexOf("restoreSessionWorkingDirectory(name, result.sessionId, server"));
});

test("terminal remembers successful cd commands for reconnect recovery", () => {
  const commandSource = app.slice(app.indexOf("async function sendSelectedCommand"), app.indexOf("\n  return (\n    <div", app.indexOf("async function sendSelectedCommand")));
  assert.match(app, /resolveShellWorkingDirectory/);
  assert.match(app, /const \[sessionWorkingDirectories,\s*setSessionWorkingDirectories\]/);
  assert.match(app, /function rememberSessionWorkingDirectory\(name,\s*command,\s*server\)/);
  assert.match(app, /sessionWorkingDirectories\[name\] \|\| server\?\.cwd/);
  assert.match(commandSource, /if \(result\?\.ok\) rememberSessionWorkingDirectory\(name,\s*command,\s*servers\[name\]\)/);
  assert.match(app, /resolveShellWorkingDirectory\(command,\s*currentPath,\s*server\?\.cwd \|\| "\."\)/);
});

test("saving a SSH connection opens its terminal tab", () => {
  assert.match(app, /function openSavedServerTab\(name, nextServers\)/);
  assert.match(app, /const nextServerNames = Object\.keys\(buildVisibleServerMap\(SERVER_DATA, nextServers, hiddenBuiltinServers\)\)/);
  assert.match(app, /normalizeTerminalTabModels\(\[\.\.\.visibleTerminalTabs,\s*\{ id: name,\s*serverName: name,\s*title: name \}\],\s*nextServerNames\)/);
  assert.match(app, /saveTerminalTabs\(normalizeTerminalTabModels\(nextTabs,\s*serverNames\)\)/);
  assert.match(app, /setSelectedTerminalTabId\(name\)/);
  assert.match(app, /openSavedServerTab\(result\.name, result\.servers\)/);
});

test("saving a SSH connection automatically tests the saved login", () => {
  assert.match(app, /async function autoTestSavedHostConnection\(name,\s*form,\s*credentialRef = ""\)/);
  assert.match(app, /await autoTestSavedHostConnection\(result\.name,\s*form,\s*result\.servers\[result\.name\]\?\.credentialRef \|\| ""\)/);
  assert.match(app, /await autoTestSavedHostConnection\(result\.name,\s*editableForm,\s*result\.servers\[result\.name\]\?\.credentialRef \|\| ""\)/);
  const source = app.slice(app.indexOf("async function autoTestSavedHostConnection"), app.indexOf("function deleteSelectedHost"));
  assert.match(source, /testHostFormConnection\(\{\s*\.\.\.form,\s*name,\s*credentialRef,\s*credentialSecret:\s*""\s*\}\)/);
  assert.match(source, /连接测试通过/);
  assert.match(source, /连接测试失败/);
  assert.match(source, /writeToolLogEvent\(\{/);
  assert.match(source, /action:\s*"auto_test_saved_connection"/);
  return;
  assert.match(source, /连接测试通过/);
  assert.match(source, /连接测试失败/);
  assert.match(source, /writeToolLogEvent\(\{/);
  assert.match(source, /action:\s*"auto_test_saved_connection"/);
  return;
  assert.match(source, /连接测试通过|杩炴帴娴嬭瘯閫氳繃/);
  assert.match(source, /连接测试失败|杩炴帴娴嬭瘯澶辫触/);
  assert.match(source, /writeToolLogEvent\(\{/);
  assert.match(source, /action:\s*"auto_test_saved_connection"/);
});

test("editing a SSH connection closes stale active sessions before saving", () => {
  const source = app.slice(app.indexOf("function shouldResetEditedServerSession"), app.indexOf("async function closeRemovedServerSession"));
  assert.match(source, /function shouldResetEditedServerSession\(oldName, form, existingServer, credentialSecret\)/);
  assert.match(source, /async function closeEditedServerSession\(oldName, form, existingServer, credentialSecret\)/);
  assert.match(source, /getSessionKeysForServer\(oldName\)/);
  assert.match(source, /shouldResetEditedServerSession\(oldName, form, existingServer, credentialSecret\)/);
  assert.match(source, /await closeSessionByName\(oldName, "编辑连接后断开旧 SSH 会话。", \{ sessionKey \}\)/);
  assert.match(app, /await closeEditedServerSession\(oldName, editableForm, customServers\[oldName\] \|\| sourceServer, editableForm\.credentialSecret\)/);
  assert.match(source, /oldName !== String\(form\?\.name \|\| oldName\)\.trim\(\)/);
  assert.match(source, /credentialSecret/);
  return;
  assert.match(source, /await closeSessionByName\(oldName, "编辑连接后断开旧 SSH 会话。", \{ sessionKey \}\)/);
  assert.match(source, /await closeEditedServerSession\(oldName, editableForm, customServers\[oldName\] \|\| sourceServer, editableForm\.credentialSecret\)/);
  assert.match(source, /oldName !== String\(form\?\.name \|\| oldName\)\.trim\(\)/);
  assert.match(source, /credentialSecret/);
  return;
  assert.match(source, /await closeSessionByName\(oldName, "编辑连接后断开旧 SSH 会话。"\)/);
  assert.match(source, /await closeEditedServerSession\(oldName, editableForm, customServers\[oldName\] \|\| sourceServer, editableForm\.credentialSecret\)/);
  assert.match(source, /oldName !== String\(form\?\.name \|\| oldName\)\.trim\(\)/);
  assert.match(source, /credentialSecret/);
});

test("editing a SSH connection clears stale runtime state when identity changes", () => {
  const source = app.slice(app.indexOf("async function saveEditedHost"), app.indexOf("async function closeRemovedServerSession"));
  assert.match(source, /const shouldResetRuntimeState = shouldResetEditedServerSession\(oldName, editableForm, customServers\[oldName\] \|\| sourceServer, editableForm\.credentialSecret\)/);
  assert.match(source, /if \(shouldResetRuntimeState\) \{/);
  assert.match(source, /clearRemovedServerState\(oldName\)/);
  assert.ok(source.indexOf("clearRemovedServerState(oldName)") < source.indexOf("openSavedServerTab(result.name, result.servers)"));
});

test("editing a SSH connection renames the open terminal tab", () => {
  const source = app.slice(app.indexOf("function renameEditedServerTab"), app.indexOf("async function removeSelectedCredential"));
  assert.match(app, /renameServerTerminalTab/);
  assert.match(source, /function renameEditedServerTab\(oldName, newName, nextServers\)/);
  assert.match(source, /renameServerTerminalTab\(visibleTerminalTabs, oldName, newName, selectedServer, nextServerNames\)/);
  assert.match(source, /saveTerminalTabs\(normalizeTerminalTabModels\(nextTabs,\s*serverNames\)\)/);
  assert.match(source, /setSelectedServer\(terminalState\.selectedServer\)/);
  assert.match(app, /if \(result\.name !== oldName\) renameEditedServerTab\(oldName, result\.name, result\.servers\)/);
  const saveSource = app.slice(app.indexOf("async function saveEditedHost"), app.indexOf("async function autoTestSavedHostConnection"));
  assert.ok(saveSource.indexOf("renameEditedServerTab(oldName, result.name, result.servers)") < saveSource.indexOf("openSavedServerTab(result.name, result.servers)"));
});

test("importing SSH config opens the first imported terminal tab", () => {
  const source = app.slice(app.indexOf("async function importSshConfig"), app.indexOf("function runConnectionCheckRepair"));
  assert.match(source, /openSavedServerTab\(preview\.importedNames\[0\], preview\.servers\)/);
  assert.doesNotMatch(source, /setSelectedServer\(preview\.importedNames\[0\]\)/);
});

test("importing SSH config uses the desktop confirmation modal", () => {
  const source = app.slice(app.indexOf("async function importSshConfig"), app.indexOf("function runConnectionCheckRepair"));

  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /setPendingConfirmAction\(\{/);
  assert.match(source, /title:\s*"导入 SSH config"/);
  assert.match(source, /confirmLabel:\s*"确认导入"/);
  assert.match(source, /onConfirm:\s*\(\) => confirmImportSshConfig\(preview\)/);
  assert.match(source, /async function confirmImportSshConfig\(preview\)/);
});

test("importing a backup opens the first imported terminal tab after restore", () => {
  const source = app.slice(app.indexOf("async function applyBackupImport"), app.indexOf("async function confirmBackupImport"));
  assert.match(source, /if \(hostImport\.importedNames\[0\]\) selectServerTab\(hostImport\.importedNames\[0\]\)/);
  assert.doesNotMatch(source, /setSelectedServer\(hostImport\.importedNames\[0\]\)/);
});

test("backup import flow uses the dedicated desktop modal without browser prompts", () => {
  const source = app.slice(app.indexOf("async function importBackup"), app.indexOf("async function importSshConfig"));

  assert.match(source, /setBackupImportDraft\(\{ backup,\s*preview,\s*sourcePath,\s*sourceName \}\)/);
  assert.match(app, /<BackupImportModal/);
  assert.doesNotMatch(source, /window\.(confirm|prompt)/);
});

test("backup export and import include redacted model API profiles", () => {
  const exportSource = app.slice(app.indexOf("function BackupExportModal"), app.indexOf("function BackupImportModal"));
  const importSource = app.slice(app.indexOf("async function applyBackupImport"), app.indexOf("async function confirmBackupImport"));
  const renderSource = app.slice(app.indexOf("{backupOpen &&"), app.indexOf("{backupImportDraft &&"));

  assert.match(exportSource, /modelConfig/);
  assert.match(exportSource, /modelProfiles/);
  assert.match(exportSource, /modelProfiles:\s*true/);
  assert.match(exportSource, /buildBackupExportPreview\(\{ servers,\s*scope,\s*agentCapabilities,\s*portForwardPresets,\s*commandSnippets,\s*modelConfig,\s*modelProfiles \}\)/);
  assert.match(exportSource, /buildBackupPayload\(\{[\s\S]*servers,[\s\S]*scope,[\s\S]*agentCapabilities,[\s\S]*portForwardPresets,[\s\S]*commandSnippets,[\s\S]*modelConfig,[\s\S]*modelProfiles,[\s\S]*exportedAt: new Date\(\)\.toISOString\(\),[\s\S]*\}\)/);
  assert.match(exportSource, /api\.export_backup_file\(servers,\s*scope,\s*masterPassword,\s*targetPath,\s*agentCapabilities,\s*portForwardPresets,\s*commandSnippets,\s*modelConfig,\s*modelProfiles\)/);
  assert.match(renderSource, /modelConfig=\{modelConfig\}/);
  assert.match(renderSource, /modelProfiles=\{modelProfiles\}/);
  assert.match(importSource, /mergeBackupModelProfiles\(modelProfiles,\s*plan\.backup\)/);
  assert.match(importSource, /setModelProfiles\(modelProfileImport\.profiles\)/);
  assert.match(importSource, /persistAppConfig\([\s\S]*nextServers,\s*modelConfig,\s*capabilityImport\.capabilities,\s*modelProfileImport\.profiles/);
});

test("backup import merge plan includes model API profiles", () => {
  const source = app.slice(app.indexOf("function BackupImportModal"), app.indexOf("function ToolLogModal"));
  const importSource = app.slice(app.indexOf("async function applyBackupImport"), app.indexOf("async function confirmBackupImport"));

  assert.match(importSource, /modelProfiles:\s*true/);
  assert.match(source, /summary\.modelProfiles/);
  assert.match(source, /onConfirm\?\.\(\{ restoreSecrets,\s*masterPassword,\s*importScope: "merge" \}\)/);
});

test("deleting servers closes active SSH sessions and removes stale terminal tabs", () => {
  const source = app.slice(app.indexOf("async function confirmDeleteSelectedHost"), app.indexOf("async function removeSelectedCredential"));
  assert.match(app, /removeServerTerminalTab/);
  assert.match(source, /async function closeRemovedServerSession\(name,/);
  assert.match(source, /function clearRemovedServerState\(name\)/);
  assert.match(source, /function removeClosedServerTab\(name, remainingServerNames\)/);
  assert.match(source, /await closeRemovedServerSession\(name, "服务器已删除"\)/);
  assert.match(source, /removeClosedServerTab\(name, remainingServerNames\)/);
  assert.match(source, /clearRemovedServerState\(name\)/);
  assert.match(source, /saveTerminalTabs\(normalizeTerminalTabModels\(nextTabs,\s*serverNames\)\)/);
  assert.match(source, /setSelectedServer\(nextSelectedTab\?\.serverName \|\| remainingServerNames\[0\] \|\| ""\)/);
});

test("terminal can type commands before connecting and auto-connects on send", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  assert.match(source, /disabled=\{isSessionOpening\}/);
  assert.doesNotMatch(source, /disabled=\{!isConnected \|\| isBusy\}/);
  assert.match(app, /正在自动连接 SSH 会话/);
  assert.match(app, /async function ensureCommandSession\(name,\s*options = \{\}\)/);
  assert.match(app, /return openSelectedSession\(name,\s*\{ \.\.\.options,\s*force:\s*false \}\)/);
  assert.match(app, /sessionId = await ensureCommandSession\(name,\s*\{ sessionKey \}\)/);
  return;
  assert.match(source, /自动连接 SSH 会话/);
  assert.match(app, /async function ensureCommandSession\(name,\s*options = \{\}\)/);
  assert.match(app, /return openSelectedSession\(name,\s*\{ \.\.\.options,\s*force:\s*false \}\)/);
  assert.match(app, /sessionId = await ensureCommandSession\(name,\s*\{ sessionKey \}\)/);
});

test("terminal command input uses shell-style editing shortcuts", () => {
  const source = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));

  assert.match(app, /applyTerminalCommandEditKey/);
  assert.match(source, /applyTerminalCommandEditKey\(/);
  assert.match(source, /event\.currentTarget\?\.selectionStart/);
  assert.match(source, /setCommandInputs\(\(current\) => \(\{ \.\.\.current,\s*\[inputKey\]: edit\.value \}\)\)/);
  assert.match(source, /commandInputRef\.current\?\.setSelectionRange\?\.\(edit\.selectionStart,\s*edit\.selectionEnd\)/);
});

test("terminal command failures mark the session disconnected for recovery", () => {
  const start = app.indexOf("async function sendSelectedCommand");
  const commandSource = app.slice(start, app.indexOf("\n  return (\n    <div", start));
  const inputSource = app.slice(app.indexOf("async function sendSelectedSessionInput"), start);
  assert.match(commandSource, /const result = await sendSelectedSessionInput/);
  assert.match(commandSource, /writeAuditEvent\(\{ type:\s*"command_failed"/);
  assert.match(commandSource, /writeSessionLogEvent\(\{ type:\s*"command_failed"/);
  assert.ok(inputSource.includes("!result?.ok"));
  assert.ok(inputSource.includes("catch (error)"));
  assert.ok((inputSource.match(/const disconnectedAt = new Date\(\)\.toISOString\(\)/g) || []).length >= 2);
  assert.ok((inputSource.match(/disconnectedAt,\s*lastError: message/g) || []).length >= 2);
});

test("SSH command input failures append a visible reconnect recovery hint", () => {
  const source = app.slice(app.indexOf("async function sendSelectedSessionInput"), app.indexOf("async function sendSelectedCommand"));

  assert.ok((source.match(/# SSH 发送失败/g) || []).length >= 2);
  assert.ok((source.match(/会话已断开，可点击“重连会话”重新连接/g) || []).length >= 2);
  assert.doesNotMatch(source, /会话已断开，可点击“连接会话”重新连接/);
});

test("closing an active SSH terminal tab uses the desktop confirmation modal", () => {
  const source = app.slice(app.indexOf("async function closeServerTab"), app.indexOf("function reopenLastClosedServerTab"));

  assert.match(source, /getTerminalTabCloseImpact\(sessionKey,\s*sshSessions,\s*name,\s*tab\)/);
  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /setPendingConfirmAction\(\{/);
  assert.match(source, /title:\s*"关闭 SSH 标签"/);
  assert.match(source, /onConfirm:\s*\(\) => confirmCloseServerTab\(tab\.id\)/);
  assert.match(app, /async function confirmCloseServerTab\(target\)/);
  assert.match(app, /await closeSessionByName\(name,\s*"关闭标签时断开 SSH 会话。",\s*\{ sessionKey \}\)/);
});

test("terminal PTY input failures clear busy state for recovery", () => {
  const source = app.slice(app.indexOf("async function sendSelectedSessionInput"), app.indexOf("async function sendSelectedCommand"));
  const failedResultBranch = source.slice(source.indexOf("if (!result?.ok)"), source.indexOf("} else if", source.indexOf("if (!result?.ok)")));
  const catchBranch = source.slice(source.indexOf("} catch (error)"), source.indexOf("\n  }\n\n  async function sendSelectedCommand"));

  assert.match(failedResultBranch, /busy:\s*false/);
  assert.match(catchBranch, /busy:\s*false/);
});

test("terminal PTY input sender returns backend results to command sender", () => {
  const source = app.slice(app.indexOf("async function sendSelectedSessionInput"), app.indexOf("async function sendSelectedCommand"));
  const catchBranch = source.slice(source.indexOf("} catch (error)"), source.indexOf("\n  }\n\n  async function sendSelectedCommand"));

  assert.match(source, /const result = await withSshApiTimeout\(\s*api\.send_ssh_session_input\(sessionId,\s*text,\s*submit\),\s*"SSH 交互输入响应超时，请检查网络或重新连接会话。",?\s*\)/);
  assert.match(source, /return result;\s*}\s*catch \(error\)/);
  assert.match(catchBranch, /return \{ ok:\s*false,\s*message \}/);
});

test("terminal PTY input sender has a timeout guard so the UI can recover", () => {
  const source = app.slice(app.indexOf("async function sendSelectedSessionInput"), app.indexOf("async function sendSelectedCommand"));

  assert.match(app, /const SSH_API_TIMEOUT_MS = 8000/);
  assert.match(app, /function withSshApiTimeout\(promise,\s*message\)/);
  assert.match(source, /withSshApiTimeout\(/);
  assert.match(source, /SSH 交互输入响应超时，请检查网络或重新连接会话。/);
  assert.match(source, /writeAuditEvent\(\{ type:\s*"interactive_input_failed"/);
  assert.match(source, /writeSessionLogEvent\(\{ type:\s*"interactive_input_failed"/);
});

test("Ctrl+C sends ETX to connected idle shells without clearing the command draft", () => {
  const source = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));
  const interruptBranch = source.slice(
    source.indexOf("runningSessionControlInput?.action === \"interrupt\" && isConnectedSession"),
    source.indexOf("if (isRunningSession && runningSessionControlInput)"),
  );

  assert.match(interruptBranch, /sendSelectedSessionInput\(event,\s*\{ text:\s*"\\x03",\s*submit:\s*false,\s*clearInput:\s*false \}\)/);
  assert.doesNotMatch(interruptBranch, /stopSelectedCommand\(\)/);
});

test("direct SSH session failures update connection diagnostics for repair actions", () => {
  const source = app.slice(app.indexOf("async function openSelectedSession"), app.indexOf("async function ensureCommandSession"));
  assert.match(source, /buildConnectionOverride\(result, server\)/);
  assert.match(source, /buildConnectionOverride\(\{ ok: false, message \}, server\)/);
  assert.match(source, /setConnectionOverrides\(\(current\) => \(\{/);
  assert.ok(source.indexOf("buildConnectionOverride(result, server)") < source.indexOf("writeAuditEvent({ type: \"connect_failed\""));
});

test("basic info read failures update connection diagnostics for repair actions", () => {
  const source = app.slice(app.indexOf("async function readSelectedBasicInfo"), app.indexOf("async function batchReadBasicInfo"));
  assert.match(source, /if \(!result\?\.ok\)/);
  assert.match(source, /buildConnectionOverride\(result, server\)/);
  assert.match(source, /buildConnectionOverride\(\{ ok: false, message \}, server\)/);
  assert.ok((source.match(/setConnectionOverrides\(\(current\) => \(\{/g) || []).length >= 3);
  assert.ok(source.indexOf("buildConnectionOverride(result, server)") < source.indexOf("showNotice(result?.ok"));
});

test("main panels and dialogs are scrollable instead of clipping content", () => {
  assert.match(styles, /\.sidebar[\s\S]*overflow-y:\s*auto/);
  assert.match(cssRule(".sidebar-section"), /min-height:\s*0/);
  assert.match(cssRule(".server-section"), /overflow:\s*auto/);
  assert.match(cssRule(".server-section"), /scrollbar-width:\s*thin/);
  assert.match(cssRule(".sftp-section"), /overflow:\s*auto/);
  assert.match(cssRule(".sftp-section"), /scrollbar-width:\s*thin/);
  assert.match(styles, /\.sidebar-footer\s*\{[\s\S]*flex:\s*0 0 auto/);
  assert.match(styles, /\.agent-panel[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto/);
  assert.match(styles, /\.agent-content[\s\S]*overflow:\s*auto/);
  assert.match(styles, /\.settings-modal[\s\S]*max-height:\s*min/);
  assert.match(styles, /\.settings-modal[\s\S]*overflow:\s*auto/);
  assert.match(styles, /overflow-wrap:\s*anywhere/);
});

test("server and SFTP sidebar modules can be vertically resized without clipping", () => {
  const serverRule = cssRule(".server-section");
  const sftpRule = cssRule(".sftp-section");

  assert.match(serverRule, /flex:\s*1 1 var\(--server-section-height,\s*220px\)/);
  assert.match(serverRule, /min-height:\s*132px/);
  assert.match(serverRule, /resize:\s*vertical/);
  assert.match(serverRule, /overflow:\s*auto/);
  assert.match(serverRule, /scrollbar-width:\s*thin/);
  assert.match(serverRule, /overscroll-behavior:\s*contain/);

  assert.match(sftpRule, /flex:\s*1 1 var\(--sftp-section-height,\s*260px\)/);
  assert.match(sftpRule, /min-height:\s*150px/);
  assert.match(sftpRule, /resize:\s*vertical/);
  assert.match(sftpRule, /overflow:\s*auto/);
  assert.match(sftpRule, /scrollbar-width:\s*thin/);
  assert.match(sftpRule, /overscroll-behavior:\s*contain/);
});

test("server and SFTP sidebar module heights are persisted as desktop layout settings", () => {
  assert.match(app, /const DEFAULT_SIDEBAR_SECTIONS = \{ server:\s*220,\s*sftp:\s*260 \}/);
  assert.match(app, /readLocalJson\("sshAgentSidebarSections",\s*DEFAULT_SIDEBAR_SECTIONS\)/);
  assert.match(app, /writeLocalJson\("sshAgentSidebarSections",\s*next\)/);
  assert.match(app, /--server-section-height/);
  assert.match(app, /--sftp-section-height/);
  assert.match(app, /setSidebarSections\(DEFAULT_SIDEBAR_SECTIONS\)/);
  assert.match(app, /writeLocalJson\("sshAgentSidebarSections",\s*DEFAULT_SIDEBAR_SECTIONS\)/);

  assert.match(cssRule(".server-section"), /flex:\s*1 1 var\(--server-section-height,\s*220px\)/);
  assert.match(cssRule(".sftp-section"), /flex:\s*1 1 var\(--sftp-section-height,\s*260px\)/);
});

test("AgentPanel keeps the right side as a pure chat surface", () => {
  const source = componentSource("AgentPanel", "PlanCard");
  assert.doesNotMatch(source, /agent-tabs/);
  assert.doesNotMatch(source, /activeTab/);
  assert.doesNotMatch(source, /<PlanCard/);
  assert.doesNotMatch(source, /<ApprovalQueue|approval-queue|summary-card|mcp-strip/);
  assert.match(source, /agent-chat-shell/);
  assert.match(source, /className="chat-list"/);
  assert.match(source, /className="agent-input"/);
});

test("AgentPanel keeps AI interaction simple like a chat assistant", () => {
  const source = componentSource("AgentPanel", "PlanCard");
  assert.match(source, /AGENT_QUICK_PROMPTS/);
  assert.match(source, /className="agent-quick-prompts"/);
  assert.match(source, /applyQuickPrompt/);
  assert.match(source, /handleAgentInputKeyDown/);
  assert.match(source, /event\.key === "Enter"/);
  assert.match(source, /event\.shiftKey/);
  assert.match(source, /event\.ctrlKey/);
  assert.match(source, /requestSubmit\(\)/);
  assert.doesNotMatch(source, /setActiveTab|role="tablist"/);
});

test("Agent MCP runner executes builtin connectors through the desktop API", () => {
  const source = app.slice(app.indexOf("async function approveQueuedAgentTask"), app.indexOf("function cancelAgentTask"));

  assert.match(source, /plan\.transport === "http"/);
  assert.match(source, /plan\.transport === "builtin"/);
  assert.match(source, /api\.call_mcp_http\(plan\.endpoint,\s*plan\.requests,\s*15,\s*plan\.headers \|\| \[\]\)/);
});

test("AgentPanel appends external context drafts without overwriting typed input", () => {
  const source = componentSource("AgentPanel", "PlanCard");
  assert.match(source, /const draftText = agentDraftRequest\.text \|\| ""/);
  assert.match(source, /setMessage\(\(current\) => \{/);
  assert.match(source, /if \(!current\.trim\(\)\) return draftText/);
  assert.match(source, /current\.trimEnd\(\)/);
  assert.match(source, /---/);
  assert.match(source, /agentInputRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(source, /setMessage\(agentDraftRequest\.text \|\| ""\)/);
});

test("AgentPanel appends quick prompts without overwriting typed input", () => {
  const source = componentSource("AgentPanel", "PlanCard");
  assert.match(source, /function applyQuickPrompt\(prompt\)/);
  assert.match(source, /const promptText = prompt\.text \|\| ""/);
  assert.match(source, /setMessage\(\(current\) => \{/);
  assert.match(source, /if \(!current\.trim\(\)\) return promptText/);
  assert.match(source, /current\.trimEnd\(\)/);
  assert.match(source, /promptText/);
  assert.doesNotMatch(source, /setMessage\(prompt\.text\)/);
});

test("AgentPanel exposes AI input attachments and search tools", () => {
  const source = componentSource("AgentPanel", "PlanCard");
  assert.match(source, /agentAttachments/);
  assert.match(source, /webSearchEnabled/);
  assert.match(source, /agentFileInputRef/);
  assert.match(source, /type="file" multiple/);
  assert.match(source, /FileReader/);
  assert.match(source, /agentFileInputRef\.current\?\.click\(\)/);
  assert.match(source, /className="agent-tool-row"/);
  assert.match(source, />\{"\\u4e0a\\u4f20\\u6587\\u4ef6"\}<\//);
  assert.match(source, />\{"\\u5f15\\u7528\\u7ec8\\u7aef"\}<\//);
  assert.match(source, />\{"\\u5f15\\u7528 SFTP"\}<\//);
  assert.match(source, />\{"\\u8054\\u7f51\\u641c\\u7d22"\}<\//);
  assert.match(source, /className="agent-attachments"/);
  assert.match(source, /buildModelMessages\(nextConversation, selectedServer, server, selectedFile, capabilities, sftpPreview, \{/);
  assert.match(app, /buildAgentAttachmentContext/);
  assert.match(source, /webSearchEnabled:\s*requestWebSearchEnabled/);
});

test("AgentPanel keeps prompt shortcuts and AI tools in a compact input row", () => {
  const source = componentSource("AgentPanel", "PlanCard");
  assert.match(source, /className="agent-input-card"/);
  assert.match(source, /className="agent-quick-prompts"/);
  assert.match(source, /className="agent-tool-row"/);
  assert.match(styles, /\.agent-input-card[\s\S]*display:\s*grid/);
  assert.match(styles, /\.agent-quick-prompts[\s\S]*display:\s*flex/);
  assert.match(styles, /\.agent-quick-prompts[\s\S]*flex-wrap:\s*wrap/);
  assert.match(styles, /\.agent-tool-row[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /\.agent-tool-row button[\s\S]*white-space:\s*nowrap/);
});

test("AgentPanel sends web search results into model context when enabled", () => {
  const source = componentSource("AgentPanel", "PlanCard");
  assert.match(source, /api\.search_web\(text\)/);
  assert.match(source, /requestAttachments/);
  assert.match(source, /type:\s*"web"/);
  assert.match(source, /name:\s*"\\u8054\\u7f51\\u641c\\u7d22\\u7ed3\\u679c"/);
  assert.match(source, /content:\s*JSON\.stringify\(searchResult\.results \|\| \[\],\s*null,\s*2\)/);
  assert.match(source, /attachments:\s*requestAttachments/);
  assert.match(source, /webSearchEnabled:\s*requestWebSearchEnabled/);
  assert.match(source, /onNotice\?\.\(searchResult\?\.message/);
});

test("AgentPanel shows compact web search feedback inside the chat", () => {
  const source = componentSource("AgentPanel", "PlanCard");
  assert.match(app, /function buildAgentSearchStatusMessage/);
  assert.match(app, /\\u8054\\u7f51\\u641c\\u7d22\\u5b8c\\u6210/);
  assert.match(app, /searchResult\?\.provider/);
  assert.match(app, /\\u6765\\u6e90\\uff1a\$\{provider\}/);
  assert.match(app, /\\u4f60\\u53ef\\u4ee5\\u7ed3\\u5408\\u8fd9\\u4e9b\\u7ed3\\u679c\\u7ee7\\u7eed\\u5206\\u6790 SSH \\u8f93\\u51fa/);
  assert.match(source, /buildAgentSearchStatusMessage\(searchResult,\s*text\)/);
  assert.match(source, /setConversation\(\(current\) => \[\.\.\.current,\s*\{ role:\s*"agent",\s*text:\s*buildAgentSearchStatusMessage/);
  assert.match(source, /<ChatMessageContent text=\{item\.text\} \/>/);
  assert.doesNotMatch(source, /kind:\s*"tool"/);
});

test("AgentPanel shows model API readiness before sending chat", () => {
  const source = componentSource("AgentPanel", "PlanCard");
  assert.match(app, /function getAgentReadiness/);
  assert.match(app, /模型 API 未配置/);
  assert.match(app, /请先配置模型 API/);
  assert.match(app, /需要运行 exe/);
  assert.match(source, /agentReadiness/);
  assert.match(source, /hasModelApi:\s*Boolean\(api\?\.chat_with_model\)/);
  assert.match(source, /if \(!agentReadiness\.ready\)/);
  assert.match(source, /text:\s*agentReadiness\.message/);
  assert.match(source, /className=\{`agent-status-pill \$\{agentReadiness\.ready \? "ready" : "blocked"\}`\}/);
  assert.match(source, /agentReadiness\.placeholder/);
  assert.doesNotMatch(source, /role="tablist"/);
});

test("AgentPanel blocked status opens model API settings directly", () => {
  const source = componentSource("AgentPanel", "PlanCard");
  assert.match(source, /openAgentReadinessAction/);
  assert.match(source, /if \(agentReadiness\.ready\) return/);
  assert.match(source, /onOpenModelSettings\?\.\(\)/);
  assert.match(source, /aria-label=\{agentReadiness\.ready \? "Agent 状态" : "打开模型 API 配置"\}/);
  assert.match(source, /onClick=\{openAgentReadinessAction\}/);
  assert.match(source, /title=\{agentReadiness\.message \|\| "Agent 已连接模型 API"\}/);
});

test("model API connection test persists profile status", () => {
  const modalSource = componentSource("ModelSettingsModal", "BackupExportModal");
  const testSource = app.slice(app.indexOf("async function testModelConnection"), app.indexOf("async function listModelOptions"));

  assert.match(app, /updateModelProfileTestResult/);
  assert.match(app, /formatModelProfileTestStatus/);
  assert.match(modalSource, /className="model-profile-status"/);
  assert.match(modalSource, /formatModelProfileTestStatus\(profile\)/);
  assert.match(testSource, /const startedAt = performance\.now\(\)/);
  assert.match(testSource, /updateModelProfileTestResult\(modelProfiles,\s*activeModelProfileId,\s*result/);
  assert.match(testSource, /setModelProfiles\(nextProfiles\)/);
  assert.match(testSource, /persistAppConfig\(customServers,\s*modelConfig,\s*customAgentCapabilities,\s*nextProfiles,\s*activeModelProfileId\)/);
});

test("model API save reports failure instead of showing false success", () => {
  const modalSource = componentSource("ModelSettingsModal", "BackupExportModal");
  const saveConfigSource = modalSource.slice(modalSource.indexOf("async function saveConfig"), modalSource.indexOf("async function saveProfile"));
  const saveProfileSource = modalSource.slice(modalSource.indexOf("async function saveProfile"), modalSource.indexOf("async function createProfile"));
  const createProfileSource = modalSource.slice(modalSource.indexOf("async function createProfile"), modalSource.indexOf("async function deleteProfile"));
  const appSaveSource = app.slice(app.indexOf("async function saveModelConfig"), app.indexOf("function saveAgentCapabilities"));
  const appProfileSource = app.slice(app.indexOf("async function saveModelProfile"), app.indexOf("async function deleteModelProfile"));

  assert.match(saveConfigSource, /const nextConfig = buildModelConfigForSave\(config,\s*modelOptions\)/);
  assert.match(saveConfigSource, /const saved = await onSave\(\{ \.\.\.nextConfig,\s*extraHeaders:\s*parseModelHeaderLines\(headersText\) \}\)/);
  assert.match(saveConfigSource, /setTestStatus\(buildSavedModelStatus\(nextConfig\)\)/);
  assert.match(saveConfigSource, /if \(saved === false\)/);
  assert.match(saveConfigSource, /setStatus\("保存失败，请检查 API Key、Base URL 或工具日志。"\)/);
  assert.match(saveConfigSource, /return/);
  assert.match(saveProfileSource, /const saved = await onSaveProfile\?\.\(\{ id: activeProfileId, name: profileName, config: buildSubmitConfig\(\) \}\)/);
  assert.match(saveProfileSource, /if \(saved === false\)/);
  assert.match(createProfileSource, /const created = await onCreateProfile\?\.\(\{ name: profileName, config: buildSubmitConfig\(\) \}\)/);
  assert.match(createProfileSource, /if \(created === false\)/);
  assert.match(appSaveSource, /if \(!storedConfig\) return false/);
  assert.match(appSaveSource, /return true/);
  assert.match(appProfileSource, /if \(!storedConfig\) return false/);
  assert.match(appProfileSource, /return true/);
});

test("model API presets cover common OpenAI-compatible relays", () => {
  const source = app.slice(app.indexOf("const PROVIDER_PRESETS = {"), app.indexOf("const AGENT_QUICK_PROMPTS"));

  assert.match(source, /"硅基流动":\s*\{\s*baseUrl:\s*"https:\/\/api\.siliconflow\.cn\/v1"/);
  assert.match(source, /model:\s*"Qwen\/Qwen3-32B"/);
  assert.match(source, /OpenRouter:\s*\{\s*baseUrl:\s*"https:\/\/openrouter\.ai\/api\/v1"/);
  assert.match(source, /model:\s*"openai\/gpt-4\.1-mini"/);
});

test("model API presets include Anthropic Claude with native API format", () => {
  const source = app.slice(app.indexOf("const PROVIDER_PRESETS = {"), app.indexOf("const AGENT_QUICK_PROMPTS"));
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));

  assert.match(source, /"Anthropic Claude":\s*\{/);
  assert.match(source, /baseUrl:\s*"https:\/\/api\.anthropic\.com"/);
  assert.match(source, /model:\s*"claude-3-5-sonnet-latest"/);
  assert.match(source, /apiFormat:\s*"anthropic"/);
  assert.match(modalSource, /apiFormat:\s*preset\.apiFormat \|\| current\.apiFormat \|\| "openai"/);
});

test("model API presets can fill safe relay headers", () => {
  const presetsSource = app.slice(app.indexOf("const PROVIDER_PRESETS = {"), app.indexOf("const AGENT_QUICK_PROMPTS"));
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));

  assert.match(presetsSource, /OpenRouter:[\s\S]*extraHeaders:\s*\[/);
  assert.match(presetsSource, /name:\s*"X-Title",\s*value:\s*"SSH Agent Tool"/);
  assert.match(modalSource, /const preset = PROVIDER_PRESETS\[provider\]/);
  assert.match(modalSource, /setHeadersText\(formatModelHeaderLines\(preset\.extraHeaders \|\| \[\]\)\)/);
});

test("release info uses production wording instead of trial package wording", () => {
  const manifestSource = app.slice(app.indexOf("const DEFAULT_RELEASE_MANIFEST"), app.indexOf("const PROVIDER_PRESETS"));
  const releaseInfoSource = componentSource("ReleaseInfoModal", "BackupExportModal");

  assert.doesNotMatch(manifestSource, /试用包/);
  assert.doesNotMatch(releaseInfoSource, /当前试用包/);
  assert.match(releaseInfoSource, /当前版本/);
});

test("release info explains the normal Windows client entry and launcher scan", () => {
  const source = componentSource("ReleaseInfoModal", "BackupExportModal");

  assert.match(source, /commandLineLaunchers/);
  assert.match(source, /launcherStatusText/);
  assert.match(source, /正式客户端入口/);
  assert.match(source, /推荐入口/);
  assert.match(source, /脚本入口/);
  assert.match(source, /未发现 BAT\/CMD\/PowerShell 启动脚本/);
  assert.match(source, /recommendedClientText = `双击 \$\{recommendedClientEntry\}`/);
  assert.match(source, /脚本入口：\$\{launcherStatusText\}/);
});

test("SFTP and Agent tool buttons keep Chinese labels readable", () => {
  const sidebar = componentSource("Sidebar", "TerminalWorkspace");
  assert.match(sidebar, /aria-label="(?:返回上级|\\u8fd4\\u56de\\u4e0a\\u7ea7)"/);
  assert.match(sidebar, /title="(?:返回上级|\\u8fd4\\u56de\\u4e0a\\u7ea7)"/);
  assert.match(sidebar, /aria-label="(?:预览文件|\\u9884\\u89c8\\u6587\\u4ef6)"/);
  assert.match(sidebar, /aria-label="(?:重命名|\\u91cd\\u547d\\u540d)"/);
  assert.match(sidebar, /aria-label="(?:删除|\\u5220\\u9664)"/);
  assert.match(sidebar, /<ChevronUp size=\{14\} \/>/);
  assert.match(sidebar, /<FileSearch size=\{14\} \/>/);
  assert.match(sidebar, /<PencilLine size=\{14\} \/>/);
  assert.match(sidebar, /<Trash2 size=\{14\} \/>/);
  assert.match(styles, /\.sftp-path-row button[\s\S]*width:\s*30px/);
  assert.match(styles, /\.sftp-path-row button[\s\S]*min-width:\s*30px/);
  assert.match(styles, /\.sftp-path-row button[\s\S]*padding:\s*0/);
  assert.match(styles, /\.sftp-selection-actions button[\s\S]*width:\s*30px/);
  assert.match(styles, /\.sftp-selection-actions button[\s\S]*min-width:\s*30px/);
  assert.match(styles, /\.sftp-selection-actions button[\s\S]*padding:\s*0/);
  assert.match(styles, /\.agent-input \.agent-tool-strip button[\s\S]*width:\s*30px/);
  assert.match(styles, /\.agent-input \.agent-tool-strip button[\s\S]*min-width:\s*0/);
  assert.match(styles, /\.agent-input \.agent-tool-strip button[\s\S]*padding:\s*0/);
  assert.match(styles, /\.agent-input-footer[\s\S]*justify-content:\s*space-between/);
  assert.match(styles, /\.agent-input \.agent-input-actions[\s\S]*justify-content:\s*space-between/);
  assert.doesNotMatch(styles, /\.agent-input div\s*\{/);
});

test("AgentPanel can stop a pending model reply without adding stale output", () => {
  const source = componentSource("AgentPanel", "PlanCard");
  assert.match(source, /agentRequestRef/);
  assert.match(source, /cancelAgentResponse/);
  assert.match(source, /agentRequestRef\.current !== requestId/);
  assert.match(source, /setAgentThinking\(false\)/);
  assert.match(source, /已停止等待模型回复/);
  assert.match(source, /停止/);
  assert.match(source, /aria-label="停止 Agent 回复"/);
});

test("AgentPanel can clear chat history and cancel stale model replies", () => {
  const source = componentSource("AgentPanel", "PlanCard");
  assert.match(source, /buildAgentWelcomeMessage/);
  assert.match(source, /clearAgentConversation/);
  assert.match(source, /agentRequestRef\.current \+= 1/);
  assert.match(source, /setAgentThinking\(false\)/);
  assert.match(source, /setMessage\(""\)/);
  assert.match(source, /setAgentAttachments\(\[\]\)/);
  assert.match(source, /setConversation\(\[buildAgentWelcomeMessage\(selectedServer\)\]\)/);
  assert.match(source, /label="清空对话"/);
  assert.match(source, /onClick=\{clearAgentConversation\}/);
  assert.match(source, /AI 对话已清空/);
});

test("AgentPanel can confirm or cancel queued Agent work without extra tabs", () => {
  const source = componentSource("AgentPanel", "PlanCard");
  assert.match(source, /onApproveTask/);
  assert.match(source, /onCancelTask/);
  assert.match(source, /className="chat-bubble agent agent-inline-task"/);
  assert.match(source, /className="agent-inline-actions"/);
  assert.match(source, /expandedTaskId/);
  assert.match(source, /togglePendingTaskDetail/);
  assert.match(source, /formatPendingTaskDetail/);
  assert.match(source, /className="agent-tool-preview"/);
  assert.match(source, /onApproveTask\(pendingTasks\[0\]\)/);
  assert.match(source, /onCancelTask\(pendingTasks\[0\]\)/);
  assert.match(source, /执行/);
  assert.match(source, /取消/);
  assert.match(source, /查看命令/);
  assert.doesNotMatch(source, /onNotice\(`待确认操作/);
  assert.doesNotMatch(source, /agent-pending-actions/);
  assert.doesNotMatch(source, /agent-tabs|role="tablist"/);
});

test("legacy Agent capability deletion uses the desktop confirmation flow", () => {
  const source = componentSource("LegacyAgentPanel", "AgentPanel");

  assert.match(source, /onRequestConfirm/);
  assert.match(source, /function deleteCapability\(capability\)/);
  assert.doesNotMatch(source, /window\.confirm/);
  assert.doesNotMatch(source, /暂不能确认删除能力/);
  assert.match(source, /onRequestConfirm\(\{/);
  assert.match(source, /title:\s*"删除 Agent 能力"/);
  assert.match(source, /confirmLabel:\s*"删除能力"/);
  assert.match(source, /onConfirm:\s*\(\) => confirmDeleteCapability\(capability\)/);
  assert.match(source, /function confirmDeleteCapability\(capability\)/);
  assert.match(source, /removeAgentCapability\(capabilities,\s*capability\.id\)/);
});

test("AgentPanel exposes a stop action for running local CLI tasks", () => {
  const source = componentSource("AgentPanel", "PlanCard");
  assert.match(app, /runningAgentTasks/);
  assert.match(source, /runningTasks/);
  assert.match(source, /正在执行/);
  assert.match(source, /onCancelRunningTask\(runningTasks\[0\]\)/);
  assert.match(app, /api\.run_local_cli_command\(plan\.command,\s*20,\s*task\.id\)/);
  assert.match(app, /api\.cancel_local_cli_command\(task\.id\)/);
});

test("TerminalWorkspace exposes a stop action while an SSH command is running", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  assert.match(source, /onStopCommand/);
  assert.match(source, /isBusy/);
  assert.match(source, /停止命令/);
  assert.match(source, /onStopCommand/);
  assert.match(app, /stopSelectedCommand/);
  assert.match(app, /onStopCommand=\{stopSelectedCommand\}/);
});

test("TerminalWorkspace session toolbar does not pass click events as server names", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");

  assert.doesNotMatch(source, /className="pill-button" onClick=\{onOpenSession\}/);
  assert.doesNotMatch(source, /className="pill-button" onClick=\{onCloseSession\}/);
  assert.doesNotMatch(source, /className="command-icon" type="button" onClick=\{onOpenSession\}/);
  assert.doesNotMatch(source, /aria-label="\\u6e05\\u7a7a\\u7ec8\\u7aef"[\s\S]{0,140}onClick=\{onClearTerminal\}/);
  assert.match(source, /className="pill-button" onClick=\{\(\) => onOpenSession\?\.\(selectedServer\)\}/);
  assert.match(source, /className="pill-button" onClick=\{\(\) => onCloseSession\?\.\(selectedServer\)\}/);
  assert.match(source, /className="command-icon" type="button" onClick=\{\(\) => onOpenSession\?\.\(selectedServer\)\}/);
  assert.match(source, /aria-label="\\u6e05\\u7a7a\\u7ec8\\u7aef"[\s\S]{0,140}onClick=\{\(\) => onClearTerminal\?\.\(selectedServer\)\}/);
});

test("TerminalWorkspace can leave interactive mode without disconnecting SSH", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");

  assert.match(source, /onFinishInteractiveMode/);
  assert.match(source, /terminal-finish-interactive/);
  assert.match(source, /退出交互/);
  assert.match(app, /function finishSelectedInteractiveMode/);
  assert.match(app, /busy:\s*false/);
  assert.match(app, /writeSessionLogEvent\(\{ type:\s*"interactive_mode_finished"/);
  assert.match(app, /onFinishInteractiveMode=\{finishSelectedInteractiveMode\}/);
});

test("TerminalWorkspace main session button shows reconnect after SSH disconnects", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");

  assert.match(source, /const isSessionOpening = isBusy && !isConnected/);
  assert.match(source, /const isRunningInteractiveCommand = isTerminalInteractiveMode\(sessionState\)/);
  assert.match(source, /const isDisconnectedRecoverable = !isConnected && Boolean\(sessionState\?\.(lastError|disconnectedAt) \|\| sessionState\?\.(lastError|disconnectedAt)\)/);
  assert.match(source, /className="pill-button"/);
  assert.match(source, /onClick=\{onOpenSession\}/);
  assert.match(source, /disabled=\{isSessionOpening\}/);
  assert.match(source, /isDisconnectedRecoverable \? "重连会话" : "\\u8fde\\u63a5\\u4f1a\\u8bdd"/);
  assert.doesNotMatch(source, /className="pill-button"[\s\S]{0,220}disabled=\{isBusy \|\| isConnected\}/);
});

test("TerminalWorkspace can send interactive input to a running SSH command", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  const sender = app.slice(app.indexOf("async function sendSelectedSessionInput"), app.indexOf("async function sendSelectedCommand"));
  assert.match(source, /isSessionOpening/);
  assert.match(source, /disabled=\{isSessionOpening\}/);
  assert.match(source, /onSendCommand/);
  assert.match(source, /发送输入/);
  assert.match(source, /Ctrl\+Enter/);
  assert.match(app, /async function sendSelectedSessionInput/);
  assert.match(app, /api\.send_ssh_session_input\(sessionId,\s*text,\s*submit\)/);
  assert.match(app, /sendSelectedSessionInput\(event,\s*\{ submit: !event\.ctrlKey \}\)/);
  assert.match(sender, /inputLength/);
  assert.doesNotMatch(sender, /command:\s*text/);
});

test("Terminal Ctrl+D leaves interactive input mode after sending EOF", () => {
  const sender = app.slice(app.indexOf("async function sendSelectedSessionInput"), app.indexOf("async function sendSelectedCommand"));

  assert.match(app, /finishInteractiveMode:\s*true/);
  assert.match(sender, /finishInteractiveMode = false/);
  assert.match(sender, /shouldFinishInteractiveMode/);
  assert.match(sender, /else if \(shouldFinishInteractiveMode\) \{/);
  assert.match(sender, /busy:\s*false/);
});

test("Terminal submitted exit commands leave interactive input mode", () => {
  const sender = app.slice(app.indexOf("async function sendSelectedSessionInput"), app.indexOf("async function sendSelectedCommand"));

  assert.match(app, /isInteractiveExitInput/);
  assert.match(sender, /shouldFinishInteractiveMode/);
  assert.match(sender, /isInteractiveExitInput\(text,\s*submit\)/);
  assert.match(sender, /else if \(shouldFinishInteractiveMode\) \{/);
});

test("TerminalWorkspace exposes clickable SSH control keys whenever the session is connected", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  const renderSource = app.slice(app.indexOf("<TerminalWorkspace"), app.indexOf("<LegacyAgentPanel"));

  assert.match(app, /TERMINAL_INTERACTIVE_CONTROL_BUTTONS/);
  assert.match(source, /onSendInteractiveInput/);
  assert.match(source, /terminal-interactive-controls/);
  assert.match(source, /terminal-interactive-control-button/);
  assert.match(source, /isConnected && \(/);
  assert.doesNotMatch(source, /isRunningInteractiveCommand && \(\s*<div className="terminal-interactive-controls"/);
  assert.match(source, /onClick=\{\(event\) => onSendInteractiveInput\(event,\s*\{ text:\s*control\.text,\s*submit:\s*false,\s*clearInput:\s*false,\s*finishInteractiveMode:\s*Boolean\(control\.finishInteractiveMode\) \}\)\}/);
  assert.match(app, /label:\s*"Tab"[\s\S]*text:\s*"\\t"/);
  assert.match(app, /label:\s*"Esc"[\s\S]*text:\s*"\\x1b"/);
  assert.match(app, /label:\s*"Ctrl\+C"[\s\S]*text:\s*"\\x03"/);
  assert.match(app, /label:\s*"Ctrl\+Z"[\s\S]*text:\s*"\\x1a"/);
  assert.match(app, /label:\s*"Ctrl\\\\"[\s\S]*text:\s*"\\x1c"/);
  assert.match(app, /label:\s*"Ctrl\+R"[\s\S]*text:\s*"\\x12"/);
  assert.match(app, /label:\s*"Ctrl\+P"[\s\S]*text:\s*"\\x10"/);
  assert.match(app, /label:\s*"Ctrl\+N"[\s\S]*text:\s*"\\x0e"/);
  assert.match(renderSource, /onSendInteractiveInput=\{sendSelectedSessionInput\}/);
  assert.match(styles, /\.terminal-interactive-controls/);
  assert.match(styles, /\.terminal-interactive-control-button/);
});

test("TerminalWorkspace can copy saved command snippets without writing them into the terminal", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  const renderSource = app.slice(app.indexOf("<TerminalWorkspace"), app.indexOf("<LegacyAgentPanel"));
  const actionSource = app.slice(app.indexOf("function copyCommandSnippet"), app.indexOf("function useCommandSnippet"));
  const copyButtonIndex = source.indexOf('className="terminal-snippet-copy"');
  const customOnlyIndex = source.indexOf("{item.custom && (");
  const removeButtonIndex = source.indexOf('className="terminal-snippet-remove"');

  assert.match(source, /onCopySnippet/);
  assert.match(source, /className="terminal-snippet-copy"/);
  assert.match(source, /onClick=\{\(\) => onCopySnippet\(item\.command\)\}/);
  assert.match(source, /aria-label=\{`复制命令片段 \$\{item\.label\}`\}/);
  assert.ok(copyButtonIndex > -1 && customOnlyIndex > -1 && copyButtonIndex < customOnlyIndex);
  assert.ok(removeButtonIndex > customOnlyIndex);
  assert.match(actionSource, /const text = String\(command \|\| ""\)\.trim\(\)/);
  assert.match(actionSource, /await navigator\.clipboard\.writeText\(text\)/);
  assert.match(actionSource, /showNotice\(`已复制常用命令：\$\{text\}`\)/);
  assert.match(renderSource, /onCopySnippet=\{copyCommandSnippet\}/);
  assert.match(styles, /\.terminal-snippet-copy/);
});

test("Terminal command input sends Shift+Enter to running SSH programs", () => {
  const source = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));
  assert.match(source, /if \(event\.key === "Enter" && !event\.isComposing\)/);
  assert.match(source, /if \(isRunningSession\) \{\s*event\.preventDefault\(\);\s*sendSelectedSessionInput\(event,\s*\{ submit: !event\.ctrlKey \}\);\s*return;\s*\}/);
  assert.match(source, /if \(!event\.shiftKey\) \{/);
  assert.ok(source.indexOf("if (isRunningSession)") < source.indexOf("if (!event.shiftKey)"));
});

test("Terminal treats busy connected sessions as interactive only when explicitly marked", () => {
  const workspaceSource = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  const keyDownSource = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));
  const senderStart = app.indexOf("async function sendSelectedCommand");
  const senderSource = app.slice(senderStart, app.indexOf("\n  return (\n    <div", senderStart));

  assert.match(app, /isTerminalInteractiveMode/);
  assert.match(workspaceSource, /const isRunningInteractiveCommand = isTerminalInteractiveMode\(sessionState\)/);
  assert.doesNotMatch(workspaceSource, /const isRunningInteractiveCommand = isBusy && isConnected/);
  assert.match(keyDownSource, /const isRunningSession = isTerminalInteractiveMode\(sshSessions\[selectedTerminalSessionKey\]\)/);
  assert.doesNotMatch(keyDownSource, /const isRunningSession = Boolean\(sshSessions\[selectedTerminalSessionKey\]\?\.busy && isConnectedSession\)/);
  assert.match(senderSource, /const interactiveMode = isLongRunningCommand\(command\)/);
  assert.match(senderSource, /interactiveMode/);
});

test("Terminal command input sends empty Enter to connected SSH shell", () => {
  const source = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));
  assert.match(source, /if \(isConnectedSession && !isRunningSession && !String\(commandInputs\[inputKey\] \|\| ""\)\.trim\(\)\) \{\s*event\.preventDefault\(\);\s*sendSelectedSessionInput\(event,\s*\{ text:\s*"",\s*submit:\s*true,\s*clearInput:\s*false \}\);\s*return;\s*\}/);
});

test("Terminal command input forwards Tab and navigation keys to connected SSH shell", () => {
  const source = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));
  assert.match(source, /const connectedShellKeyInput = buildRunningSessionKeyInput\(event\.key,\s*commandInputs\[inputKey\] \|\| "",\s*event\)/);
  assert.match(source, /if \(isConnectedSession && !isRunningSession && connectedShellKeyInput\) \{\s*event\.preventDefault\(\);\s*sendSelectedSessionInput\(event,\s*\{ \.\.\.connectedShellKeyInput,\s*clearInput:\s*false \}\);\s*return;\s*\}/);
  assert.ok(source.indexOf("const connectedShellKeyInput") > source.indexOf("if (event.key === \"Enter\" && !event.isComposing)"));
  assert.ok(source.indexOf("const connectedShellKeyInput") < source.indexOf("const name = selectedServer"));
});

test("Terminal command input forwards special keys to running SSH programs", () => {
  const source = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));
  assert.match(app, /buildRunningSessionKeyInput/);
  assert.match(source, /const runningSessionKeyInput = buildRunningSessionKeyInput\(event\.key,\s*commandInputs\[inputKey\] \|\| "",\s*event\)/);
  assert.match(source, /sendSelectedSessionInput\(event,\s*\{ \.\.\.runningSessionKeyInput,\s*clearInput:\s*false \}\)/);
  assert.match(source, /event\.preventDefault\(\)/);
});

test("Terminal command input forwards printable keys to running SSH programs", () => {
  const source = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));
  assert.match(app, /buildRunningSessionTextInput/);
  assert.match(source, /const runningSessionTextInput = buildRunningSessionTextInput\(event,\s*commandInputs\[inputKey\] \|\| ""\)/);
  assert.match(source, /sendSelectedSessionInput\(event,\s*\{ \.\.\.runningSessionTextInput,\s*clearInput:\s*false \}\)/);
  assert.ok(source.indexOf("const runningSessionTextInput") > source.indexOf("const runningSessionKeyInput"));
});

test("Terminal command input forwards running SSH control keys", () => {
  const source = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));
  assert.match(app, /buildRunningSessionControlInput/);
  assert.match(source, /const runningSessionControlInput = buildRunningSessionControlInput\(event,\s*commandInputs\[inputKey\] \|\| ""\)/);
  assert.match(source, /runningSessionControlInput\?\.action === "interrupt"/);
  assert.match(source, /sendSelectedSessionInput\(event,\s*\{ \.\.\.runningSessionControlInput,\s*clearInput:\s*false \}\)/);
  assert.ok(source.indexOf("const runningSessionControlInput") < source.indexOf("const runningSessionKeyInput"));
});

test("Terminal command input uses the unified stop flow for Ctrl+C while an SSH program is running", () => {
  const source = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));

  assert.match(source, /if \(runningSessionControlInput\?\.action === "interrupt" && isRunningSession\) \{/);
  assert.match(source, /stopSelectedCommand\(\)/);
  assert.ok(source.indexOf('runningSessionControlInput?.action === "interrupt" && isRunningSession') < source.indexOf('runningSessionControlInput?.action === "interrupt" && isConnectedSession'));
  assert.ok(source.indexOf("stopSelectedCommand()") < source.indexOf("const connectedShellDirectControlInput"));
});

test("Terminal command input sends Ctrl+C to a connected SSH shell even when not marked busy", () => {
  const source = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));

  assert.match(source, /const isConnectedSession = Boolean\(sshSessions\[selectedTerminalSessionKey\]\?\.sessionId\)/);
  assert.match(source, /if \(runningSessionControlInput\?\.action === "interrupt" && isConnectedSession && !isRunningSession\) \{/);
  assert.match(source, /text:\s*"\\x03"/);
  assert.match(source, /clearInput:\s*false/);
  assert.match(source, /const connectedShellDirectControlInput = isConnectedShellDirectControlKey\(event\) \? runningSessionControlInput : null/);
  assert.match(source, /sendSelectedSessionInput\(event,\s*\{ \.\.\.connectedShellDirectControlInput,\s*clearInput:\s*false \}\)/);
  assert.ok(source.indexOf('runningSessionControlInput?.action === "interrupt" && isConnectedSession && !isRunningSession') < source.indexOf("const connectedShellDirectControlInput"));
  assert.ok(source.indexOf("const connectedShellDirectControlInput") < source.indexOf("if (runTerminalShortcutAction(event)) return;"));
});

test("Terminal command input forwards SSH direct control keys to connected shell before desktop shortcuts", () => {
  const source = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));

  assert.match(source, /const connectedShellDirectControlInput = isConnectedShellDirectControlKey\(event\) \? runningSessionControlInput : null/);
  assert.match(source, /if \(isConnectedSession && !isRunningSession && connectedShellDirectControlInput\) \{\s*event\.preventDefault\(\);\s*sendSelectedSessionInput\(event,\s*\{ \.\.\.connectedShellDirectControlInput,\s*clearInput:\s*false \}\);\s*return;\s*\}/);
  assert.ok(source.indexOf("connectedShellDirectControlInput") < source.indexOf("if (runTerminalShortcutAction(event)) return;"));
  assert.match(app, /function isConnectedShellFlowControlKey\(event = \{\}\)/);
  assert.match(app, /function isConnectedShellDirectControlKey\(event = \{\}\)/);
  assert.match(app, /return event\?\.ctrlKey && !event\?\.shiftKey && !event\?\.altKey && !event\?\.metaKey && \[" ",\s*"2",\s*"3",\s*"4",\s*"5",\s*"6",\s*"7",\s*"8",\s*"\[",\s*"\\\\",\s*"\]",\s*"\^",\s*"_",\s*"a",\s*"b",\s*"c",\s*"d",\s*"e",\s*"f",\s*"g",\s*"h",\s*"k",\s*"l",\s*"n",\s*"o",\s*"p",\s*"q",\s*"r",\s*"s",\s*"t",\s*"u",\s*"w",\s*"x",\s*"y",\s*"z"\]\.includes\(key\)/);
});

test("Terminal command input forwards Ctrl+S and Ctrl+Q flow control to connected shell", () => {
  const source = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));

  assert.match(source, /const connectedShellFlowControlInput = isConnectedShellFlowControlKey\(event\) \? buildRunningSessionControlInput\(event,\s*""\) : null/);
  assert.match(source, /if \(isConnectedSession && !isRunningSession && connectedShellFlowControlInput\) \{\s*event\.preventDefault\(\);\s*sendSelectedSessionInput\(event,\s*\{ \.\.\.connectedShellFlowControlInput,\s*clearInput:\s*false \}\);\s*return;\s*\}/);
  assert.ok(source.indexOf("connectedShellFlowControlInput") < source.indexOf("if (runTerminalShortcutAction(event)) return;"));
  assert.match(app, /\["q",\s*"s"\]\.includes\(key\)/);
});

test("Terminal direct control key whitelist includes numeric control sequences", () => {
  const source = app.slice(app.indexOf("function isConnectedShellDirectControlKey"), app.indexOf("const SERVER_DATA"));

  for (const key of ["3", "4", "5", "6", "7", "8"]) {
    assert.match(source, new RegExp(`"${key}"`));
  }
});

test("Terminal direct control key whitelist includes Ctrl+H backspace", () => {
  const source = app.slice(app.indexOf("function isConnectedShellDirectControlKey"), app.indexOf("const SERVER_DATA"));

  assert.match(source, /"h"/);
});

test("Terminal direct control key whitelist includes readline navigation controls", () => {
  const source = app.slice(app.indexOf("function isConnectedShellDirectControlKey"), app.indexOf("const SERVER_DATA"));

  for (const key of ["b", "f", "n", "p", "y"]) {
    assert.match(source, new RegExp(`"${key}"`));
  }
});

test("Terminal direct control key whitelist includes readline editing controls", () => {
  const source = app.slice(app.indexOf("function isConnectedShellDirectControlKey"), app.indexOf("const SERVER_DATA"));

  for (const key of ["g", "o", "t", "x"]) {
    assert.match(source, new RegExp(`"${key}"`));
  }
});

test("Terminal command input forwards Alt key combinations to connected shell", () => {
  const source = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));

  assert.match(source, /const connectedShellMetaInput = buildRunningSessionMetaInput\(event,\s*commandInputs\[inputKey\] \|\| ""\)/);
  assert.match(source, /if \(isConnectedSession && !isRunningSession && connectedShellMetaInput\) \{\s*event\.preventDefault\(\);\s*sendSelectedSessionInput\(event,\s*\{ \.\.\.connectedShellMetaInput,\s*clearInput:\s*false \}\);\s*return;\s*\}/);
  assert.ok(source.indexOf("const connectedShellMetaInput") > source.indexOf("const connectedShellFlowControlInput"));
  assert.ok(source.indexOf("const connectedShellMetaInput") < source.indexOf("const connectedShellKeyInput"));
});

test("Terminal command input sends connected-shell Alt keys before local command editing", () => {
  const source = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));

  assert.ok(source.indexOf("const connectedShellMetaInput") >= 0);
  assert.ok(source.indexOf("const edit = applyTerminalCommandEditKey") >= 0);
  assert.ok(
    source.indexOf("const connectedShellMetaInput") < source.indexOf("const edit = applyTerminalCommandEditKey"),
    "Alt+Backspace should reach the connected SSH shell before local empty-draft editing can consume it",
  );
});

test("Terminal command input forwards running SSH Alt key combinations", () => {
  const source = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));
  assert.match(app, /buildRunningSessionMetaInput/);
  assert.match(source, /const runningSessionMetaInput = buildRunningSessionMetaInput\(event,\s*commandInputs\[inputKey\] \|\| ""\)/);
  assert.match(source, /sendSelectedSessionInput\(event,\s*\{ \.\.\.runningSessionMetaInput,\s*clearInput:\s*false \}\)/);
  assert.ok(source.indexOf("const runningSessionControlInput") < source.indexOf("const runningSessionMetaInput"));
  assert.ok(source.indexOf("const runningSessionMetaInput") < source.indexOf("const runningSessionKeyInput"));
});

test("Terminal command input sends SSH control keys before desktop shortcuts while busy", () => {
  const source = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));
  assert.ok(source.indexOf("const runningSessionControlInput") >= 0);
  assert.ok(source.indexOf("if (runTerminalShortcutAction(event)) return;") >= 0);
  assert.ok(source.indexOf("const runningSessionControlInput") < source.indexOf("if (runTerminalShortcutAction(event)) return;"));
});

test("TerminalWorkspace syncs remote PTY size when the panel resizes", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  assert.match(source, /onResizeSession/);
  assert.match(source, /onTerminalSizeChange/);
  assert.match(source, /ResizeObserver/);
  assert.match(source, /terminalLinesRef\.current/);
  assert.match(source, /onTerminalSizeChange\(selectedTerminalTabId,\s*cols,\s*rows\)/);
  assert.match(source, /onResizeSession\(cols,\s*rows\)/);
  assert.match(app, /async function resizeSelectedSession\(cols,\s*rows\)/);
  assert.match(app, /api\.resize_ssh_session\(sessionId,\s*cols,\s*rows\)/);
  assert.match(app, /function rememberTerminalPtySize\(terminalKey,\s*cols,\s*rows\)/);
  assert.match(app, /terminalPtySizesRef\.current\[terminalKey\]/);
  assert.match(app, /onResizeSession=\{resizeSelectedSession\}/);
  assert.match(app, /onTerminalSizeChange=\{rememberTerminalPtySize\}/);
});

test("opening a SSH session passes the measured terminal size into the desktop API", () => {
  const source = app.slice(app.indexOf("async function openSelectedSession"), app.indexOf("async function ensureCommandSession"));

  assert.match(app, /function getInitialTerminalPtySize\(terminalKey\)/);
  assert.match(source, /const initialTerminalSize = getInitialTerminalPtySize\(sessionKey\)/);
  assert.match(source, /api\.open_ssh_session\(server,\s*server\.credentialRef,\s*initialTerminalSize\)/);
});

test("TerminalWorkspace resyncs PTY size after session or font changes", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  assert.match(source, /lastPtySizeRef\.current = ""/);
  assert.match(source, /\}, \[isConnected,\s*onResizeSession,\s*onTerminalSizeChange,\s*selectedTerminalTabId,\s*sessionState\?\.sessionId,\s*terminalFontSize\]\)/);
});

test("TerminalWorkspace can lock auto-follow scrolling while reviewing output", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  assert.match(source, /terminalScrollLocked/);
  assert.match(source, /target\.scrollTop = target\.scrollHeight/);
  assert.match(source, /if \(!terminalScrollLocked\)/);
  assert.match(source, /terminalScrollLocked \? "滚动已锁定" : "自动跟随"/);
  assert.match(app, /const \[terminalScrollLocked,\s*setTerminalScrollLocked\]/);
  assert.match(app, /readLocalJson\("sshAgentTerminalScrollLocked",\s*false\)/);
  assert.match(app, /function toggleTerminalScrollLock\(\)/);
  assert.match(app, /writeLocalJson\("sshAgentTerminalScrollLocked",\s*nextLocked\)/);
  assert.match(app, /terminalScrollLocked=\{terminalScrollLocked\}/);
  assert.match(app, /id:\s*"toggle-scroll-lock"/);
  assert.match(app, /label:\s*terminalScrollLocked \? "自动跟随输出" : "锁定滚动"/);
  assert.match(app, /onSelect:\s*toggleTerminalScrollLock/);
});

test("TerminalWorkspace exposes a return-to-bottom action when auto-follow is locked", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");

  assert.match(source, /className="terminal-follow-status"/);
  assert.match(source, /terminalScrollLocked &&/);
  assert.match(source, /className="terminal-follow-bottom"/);
  assert.match(source, /onTerminalScrollLockChange\(false\)/);
  assert.match(source, /回到底部/);
  assert.match(styles, /\.terminal-follow-status/);
  assert.match(styles, /\.terminal-follow-bottom/);
});

test("TerminalWorkspace updates auto-follow when the terminal output is manually scrolled", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");

  assert.match(source, /function handleTerminalOutputScroll\(\)/);
  assert.match(source, /target\.scrollHeight - target\.scrollTop - target\.clientHeight <= 12/);
  assert.match(source, /onTerminalScrollLockChange\(!isAtBottom\)/);
  assert.match(source, /className="terminal-lines" ref=\{terminalLinesRef\} onScroll=\{handleTerminalOutputScroll\}/);
});

test("TerminalWorkspace scrolls terminal output with review keys", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");

  assert.match(source, /getTerminalScrollKeyAction\(event\)/);
  assert.match(source, /function scrollTerminalOutputByKey\(event\)/);
  assert.match(source, /target\.scrollTop -= target\.clientHeight \* 0\.85/);
  assert.match(source, /target\.scrollTop \+= target\.clientHeight \* 0\.85/);
  assert.match(source, /target\.scrollTop = 0/);
  assert.match(source, /target\.scrollTop = target\.scrollHeight/);
  assert.match(source, /onTerminalScrollLockChange\(true\)/);
  assert.match(source, /onTerminalScrollLockChange\(false\)/);
  assert.match(app, /onTerminalScrollLockChange=\{setTerminalScrollLockedFromWorkspace\}/);
  assert.match(app, /function setTerminalScrollLockedFromWorkspace\(nextLocked\)/);
  assert.match(source, /if \(scrollTerminalOutputByKey\(event\)\) return/);
});

test("TerminalWorkspace does not show command policy prompts in manual SSH terminal input", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  assert.doesNotMatch(source, /commandPolicyPreview/);
  assert.doesNotMatch(source, /evaluateCommandPolicy\(commandValue\)/);
  assert.doesNotMatch(source, /terminal-command-policy/);
  assert.doesNotMatch(source, /手动风险提示/);
  assert.doesNotMatch(source, /二次确认/);
  assert.doesNotMatch(source, /不会拦截手动输入/);
});

test("TerminalWorkspace renders ANSI styled terminal output safely", () => {
  const source = componentSource("TerminalLine", "TerminalWorkspace");
  const workspace = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  assert.match(app, /highlightTerminalSearchSegments/);
  assert.match(source, /function TerminalLine/);
  assert.match(source, /highlightTerminalSearchSegments\(line,\s*searchQuery\)/);
  assert.match(source, /segment\.className/);
  assert.match(source, /segment\.text/);
  assert.match(source, /style=\{segment\.style\}/);
  assert.match(workspace, /<TerminalLine/);
  assert.match(styles, /\.terminal-ansi\.ansi-fg-red/);
  assert.match(styles, /\.terminal-ansi\.ansi-fg-green/);
  assert.match(styles, /\.terminal-ansi\.ansi-bold/);
  assert.match(styles, /\.terminal-ansi\.ansi-bg-red/);
  assert.match(styles, /\.terminal-ansi\.ansi-bg-yellow/);
  assert.match(styles, /\.terminal-ansi\.ansi-inverse/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
});

test("TerminalWorkspace renders OSC 8 hyperlinks as clickable terminal links", () => {
  const source = componentSource("TerminalLine", "TerminalWorkspace");

  assert.match(source, /segment\.href/);
  assert.match(source, /<a\s+className=\{`terminal-ansi/);
  assert.match(source, /href=\{segment\.href\}/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noreferrer"/);
  assert.match(styles, /\.terminal-ansi\.terminal-link/);
});

test("TerminalWorkspace highlights terminal search terms inside matching lines", () => {
  const source = componentSource("TerminalLine", "TerminalWorkspace");
  const workspace = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  assert.match(app, /highlightTerminalSearchSegments/);
  assert.match(source, /function TerminalLine\(\{ line, index, className = "", searchQuery = "" \}\)/);
  assert.match(source, /highlightTerminalSearchSegments\(line,\s*searchQuery\)/);
  assert.match(workspace, /searchQuery=\{terminalSearchQuery\}/);
  assert.match(styles, /\.terminal-search-hit/);
});

test("Terminal command input sends Ctrl+L to the connected shell instead of clearing local output", () => {
  const source = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));

  assert.match(app, /function handleCommandHistoryKeyDown\(event\)/);
  assert.match(source, /const connectedShellScreenControlInput = isConnectedShellScreenControlKey\(event\) \? buildRunningSessionControlInput\(event,\s*""\) : null/);
  assert.match(source, /sendSelectedSessionInput\(event,\s*\{ \.\.\.connectedShellScreenControlInput,\s*clearInput:\s*false \}\)/);
  assert.ok(source.indexOf("connectedShellScreenControlInput") < source.indexOf("if (runTerminalShortcutAction(event)) return;"));
  assert.match(app, /function isConnectedShellScreenControlKey\(event = \{\}\)/);
});

test("Terminal command input supports Ctrl+U clear line shortcut", () => {
  assert.match(app, /action === "clear-input"/);
  assert.match(app, /updateCommandInput\(selectedCommandInputKey,\s*""\)/);
});

test("Terminal command input supports readline style editing shortcuts", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  assert.match(app, /applyTerminalCommandEditKey/);
  assert.match(source, /function applyCommandEditShortcut\(event\)/);
  assert.match(source, /applyTerminalCommandEditKey\([\s\S]*event,[\s\S]*commandValue,[\s\S]*target\?\.selectionStart/);
  assert.match(source, /onCommandChange\(edit\.value\)/);
  assert.match(source, /setSelectionRange\?\.\(edit\.selectionStart,\s*edit\.selectionEnd\)/);
  assert.match(source, /if \(isRunningInteractiveCommand\) \{[\s\S]*onCommandKeyDown\(event\);[\s\S]*return;[\s\S]*\}/);
  assert.match(source, /if \(applyCommandEditShortcut\(event\)\) return/);
});

test("terminal shortcut help mentions Ctrl+Y shell yank control", () => {
  assert.match(app, /Ctrl\+Y 粘回刚删除的内容/);
});

test("terminal shortcut help mentions Ctrl+G remote cancel control", () => {
  assert.match(app, /Ctrl\+G 取消远端搜索或编辑状态/);
});

test("terminal shortcut help mentions Ctrl+B and Ctrl+F cursor controls", () => {
  assert.match(app, /Ctrl\+B \/ Ctrl\+F 左右移动一个字符/);
});

test("Terminal command input supports Ctrl+D disconnect when command is empty", () => {
  assert.match(app, /action === "disconnect-session"/);
  assert.match(app, /closeSelectedSession\(\)/);
});

test("Terminal command input prevents default when Escape restores draft", () => {
  assert.match(app, /historyKeyAction === "restore"[\s\S]{0,120}event\.preventDefault\(\)/);
  assert.match(app, /setCommandInputs\(\(current\) => \(\{ \.\.\.current, \[inputKey\]: draft \}\)\)/);
  assert.match(app, /setHistoryCursors\(\(current\) => \(\{ \.\.\.current, \[inputKey\]: createHistoryCursor\(draft\) \}\)\)/);
});

test("Terminal command input supports reviewed multiline paste", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  const pasteSource = app.slice(app.indexOf("async function pasteClipboardToCommandInput"), app.indexOf("function getSftpRemotePath"));
  assert.match(source, /<textarea/);
  assert.match(source, /rows=\{terminalCommandInputRows\}/);
  assert.match(styles, /\.terminal-command-line textarea/);
  assert.match(app, /prepareClipboardCommandPaste/);
  assert.match(pasteSource, /pastePlan\.requiresConfirmation/);
  assert.doesNotMatch(pasteSource, /window\.confirm/);
  assert.match(pasteSource, /setPendingConfirmAction\(\{/);
  assert.match(pasteSource, /title:\s*"确认多行粘贴"/);
  assert.match(pasteSource, /onConfirm:\s*\(\) => confirmClipboardCommandPaste\(text,\s*existing,\s*inputKey\)/);
  assert.match(app, /function confirmClipboardCommandPaste\(text,\s*existing,\s*inputKey\)/);
  assert.match(app, /prepareClipboardCommandPaste\(text,\s*existing,\s*\{ allowMultiline: true \}\)/);
});

test("Terminal surface lets paste shortcuts win before sending control bytes to SSH", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  assert.match(app, /function handleTerminalShortcutKeyDown\(event\) \{\s*return runTerminalShortcutAction\(event\);\s*\}/);
  assert.match(source, /if \(onTerminalShortcutKeyDown\(event\)\) return;\s*if \(sendConnectedShellSurfaceInput\(event\)\) return;/);
});

test("Terminal paste sends clipboard directly to a running SSH program", () => {
  const source = app.slice(app.indexOf("async function pasteClipboardToCommandInput"), app.indexOf("function getSftpRemotePath"));
  assert.match(source, /const runningSession = sshSessions\[sessionKey\]/);
  assert.match(source, /if \(shouldPasteIntoConnectedSession \|\| \(runningSession\?\.busy && runningSession\?\.sessionId\)\)/);
  assert.match(source, /sendSelectedSessionInput\(null,\s*\{ text:\s*pasteText,\s*submit:\s*false,\s*clearInput:\s*false,\s*sessionKey,\s*targetName \}\)/);
  assert.match(source, /showNotice\("已粘贴到当前 SSH 程序。"\)/);
});

test("Terminal paste confirms risky text before sending to a running SSH program", () => {
  const source = app.slice(app.indexOf("async function pasteClipboardToCommandInput"), app.indexOf("function getSftpRemotePath"));
  assert.match(app, /prepareInteractiveClipboardPaste/);
  assert.match(source, /let interactivePastePlan = prepareInteractiveClipboardPaste\(text\)/);
  assert.match(source, /interactivePastePlan\.requiresConfirmation/);
  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /setPendingConfirmAction\(\{/);
  assert.match(source, /title:\s*"确认粘贴到 SSH 程序"/);
  assert.match(source, /onConfirm:\s*\(\) => confirmInteractiveClipboardPaste\(text,\s*sessionKey,\s*targetName\)/);
  assert.match(app, /function confirmInteractiveClipboardPaste\(text,\s*sessionKey,\s*targetName\)/);
  assert.match(app, /prepareInteractiveClipboardPaste\(text,\s*\{ allowRiskyPaste:\s*true \}\)/);
  assert.match(source, /const pasteText = wrapBracketedPasteText\(interactivePastePlan\.text,\s*bracketedPasteEnabled\)/);
});

test("terminal context menu keeps paste available while SSH program is running", () => {
  const source = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  assert.match(source, /id:\s*"paste"/);
  assert.match(source, /label:\s*"粘贴到终端"/);
  assert.doesNotMatch(source, /id:\s*"paste"[\s\S]{0,180}disabled:\s*Boolean\(sshSessions\[selectedServer\]\?\.busy\)/);
});

test("terminal context menu paste sends to connected SSH session when possible", () => {
  const source = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  assert.match(source, /id:\s*"paste"[\s\S]{0,220}onSelect:\s*\(\) => pasteClipboardToCommandInput\(\{ sendToConnectedSession:\s*true \}\)/);
});

test("terminal context menu uses the shared action model for common SSH actions", () => {
  const source = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));

  assert.match(source, /buildTerminalContextActionModel\(\{/);
  assert.match(source, /const terminalModelActions = \{/);
  assert.match(source, /"copy-selection-or-output":\s*copySelectedTerminalOutput/);
  assert.match(source, /"paste-to-terminal":\s*\(\) => pasteClipboardToCommandInput\(\{ sendToConnectedSession:\s*true \}\)/);
  assert.match(source, /"interrupt-terminal-command":\s*\(\) => sendTerminalControlSignal\("interrupt"\)/);
  assert.match(source, /"reconnect-terminal-session":\s*\(\) => reconnectSelectedSession\(contextServer\)/);
  assert.match(source, /"disconnect-terminal-session":\s*\(\) => closeSelectedSession\(contextServer\)/);
  assert.match(source, /mergeContextMenuItems\(/);
  assert.match(source, /terminalModel\.items\.map\(\(item\) =>/);
});

test("terminal context menu can copy current server connection details", () => {
  const source = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));

  assert.match(source, /id:\s*"copy-terminal-ssh-command"/);
  assert.match(source, /label:\s*"复制 SSH 命令"/);
  assert.match(source, /onSelect:\s*\(\) => copyServerSshCommand\(contextServer\)/);
  assert.match(source, /id:\s*"copy-terminal-server-info"/);
  assert.match(source, /label:\s*"复制连接信息"/);
  assert.match(source, /onSelect:\s*\(\) => copyServerConnectionInfo\(contextServer\)/);
  assert.match(source, /id:\s*"copy-terminal-openssh-config"/);
  assert.match(source, /onSelect:\s*\(\) => copyServerOpenSshConfig\(contextServer\)/);
  assert.match(source, /id:\s*"copy-terminal-troubleshooting-summary"/);
  assert.match(source, /onSelect:\s*\(\) => copyServerTroubleshootingSummary\(contextServer\)/);
});

test("terminal context menu uses the right-clicked tab server for connection actions", () => {
  const source = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));

  assert.match(source, /"reconnect-terminal-session":\s*\(\) => reconnectSelectedSession\(contextServer\)/);
  assert.match(source, /"disconnect-terminal-session":\s*\(\) => closeSelectedSession\(contextServer\)/);
  assert.match(source, /id:\s*"copy-terminal-ssh-command"[\s\S]{0,160}onSelect:\s*\(\) => copyServerSshCommand\(contextServer\)/);
  assert.match(source, /id:\s*"copy-terminal-server-info"[\s\S]{0,160}onSelect:\s*\(\) => copyServerConnectionInfo\(contextServer\)/);
  assert.match(source, /id:\s*"copy-terminal-openssh-config"[\s\S]{0,180}onSelect:\s*\(\) => copyServerOpenSshConfig\(contextServer\)/);
  assert.match(source, /id:\s*"copy-terminal-troubleshooting-summary"[\s\S]{0,180}onSelect:\s*\(\) => copyServerTroubleshootingSummary\(contextServer\)/);
  assert.match(source, /id:\s*"terminal-auth-center"[\s\S]{0,160}onSelect:\s*\(\) => openAuthCenter\(contextServer\)/);
  assert.match(source, /id:\s*"edit-terminal-connection"[\s\S]{0,160}onSelect:\s*\(\) => openEditHost\(contextServer\)/);
  assert.match(source, /id:\s*"terminal-session-logs"[\s\S]{0,160}onSelect:\s*\(\) => openSessionLogs\(\{ server:\s*contextServer \}\)/);
  assert.match(source, /id:\s*"export-terminal-server-profile"[\s\S]{0,180}onSelect:\s*\(\) => exportServerProfile\(contextServer\)/);
});

test("terminal context menu can copy the tracked remote working directory", () => {
  const menuSource = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  const copySource = app.slice(app.indexOf("async function copyCurrentWorkingDirectory"), app.indexOf("async function copySelectedSessionErrorDetail"));

  assert.match(app, /async function copyCurrentWorkingDirectory\(name = selectedServer,\s*options = \{\}\)/);
  assert.match(copySource, /const cwd = normalizeSftpPath\(/);
  assert.match(copySource, /copyTextToClipboard\(cwd,\s*`当前远程目录已复制：\$\{cwd\}`\)/);
  assert.doesNotMatch(copySource, /navigator\.clipboard\.writeText\(cwd\)/);
  assert.match(menuSource, /id:\s*"copy-terminal-cwd"/);
  assert.match(menuSource, /onSelect:\s*\(\) => copyCurrentWorkingDirectory\(contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
});

test("terminal context menu can open the tracked remote directory in SFTP", () => {
  const menuSource = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  const actionSource = app.slice(app.indexOf("async function openCurrentWorkingDirectoryInSftp"), app.indexOf("async function refreshSelectedSftp"));

  assert.match(app, /async function openCurrentWorkingDirectoryInSftp\(name = selectedServer\)/);
  assert.match(actionSource, /const cwd = normalizeSftpPath\(sessionWorkingDirectories\[name\] \|\| server\?\.cwd \|\| ""\)/);
  assert.match(actionSource, /await refreshSelectedSftp\(cwd,\s*"",\s*name\)/);
  assert.match(menuSource, /id:\s*"open-terminal-cwd-in-sftp"/);
  assert.match(menuSource, /onSelect:\s*\(\) => openCurrentWorkingDirectoryInSftp\(contextServer\)/);
});

test("terminal context menu can edit current connection and open session logs", () => {
  const source = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));

  assert.match(source, /id:\s*"edit-terminal-connection"/);
  assert.match(source, /label:\s*"编辑当前连接"/);
  assert.match(source, /onSelect:\s*\(\) => openEditHost\(contextServer\)/);
  assert.match(source, /id:\s*"terminal-session-logs"/);
  assert.match(source, /label:\s*"查看会话日志"/);
  assert.match(source, /onSelect:\s*\(\) => openSessionLogs\(\{ server:\s*contextServer \}\)/);
});

test("terminal context menu can open tool logs for troubleshooting the desktop app", () => {
  const source = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));

  assert.match(source, /id:\s*"terminal-tool-logs"/);
  assert.match(source, /onSelect:\s*\(\) => openToolLogs\(\{ query:\s*contextServer \}\)/);
});

test("terminal context menu can export current connection profile", () => {
  const source = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));

  assert.match(app, /async function exportServerProfile\(targetName = ""\)/);
  assert.match(source, /id:\s*"export-terminal-server-profile"/);
  assert.match(source, /label:\s*"导出连接档案"/);
  assert.match(source, /onSelect:\s*\(\) => exportServerProfile\(contextServer\)/);
});

test("terminal context menu can open credential auth center", () => {
  const source = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));

  assert.match(source, /id:\s*"terminal-auth-center"/);
  assert.match(source, /onSelect:\s*\(\) => openAuthCenter\(contextServer\)/);
});

test("terminal context menu can send common SSH control signals", () => {
  const source = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));

  assert.match(app, /function sendTerminalControlSignal\(signal,\s*targetName = selectedServer\)/);
  assert.match(source, /id:\s*"send-ctrl-c"/);
  assert.match(source, /label:\s*"发送 Ctrl\+C"/);
  assert.match(source, /onSelect:\s*\(\) => sendTerminalControlSignal\("interrupt",\s*contextServer\)/);
  assert.match(source, /id:\s*"send-ctrl-d"/);
  assert.match(source, /label:\s*"发送 Ctrl\+D"/);
  assert.match(source, /onSelect:\s*\(\) => sendTerminalControlSignal\("eof",\s*contextServer\)/);
  assert.match(source, /id:\s*"send-ctrl-z"/);
  assert.match(source, /label:\s*"发送 Ctrl\+Z"/);
  assert.match(source, /onSelect:\s*\(\) => sendTerminalControlSignal\("suspend",\s*contextServer\)/);
  assert.match(source, /id:\s*"send-ctrl-backslash"/);
  assert.match(source, /label:\s*"发送 Ctrl\\\\?"/);
  assert.match(source, /onSelect:\s*\(\) => sendTerminalControlSignal\("quit",\s*contextServer\)/);
  assert.match(source, /id:\s*"send-ctrl-r"/);
  assert.match(source, /label:\s*"发送 Ctrl\+R"/);
  assert.match(source, /onSelect:\s*\(\) => sendTerminalControlSignal\("history-search",\s*contextServer\)/);
  assert.match(source, /id:\s*"send-ctrl-p"/);
  assert.match(source, /onSelect:\s*\(\) => sendTerminalControlSignal\("history-previous",\s*contextServer\)/);
  assert.match(source, /id:\s*"send-ctrl-n"/);
  assert.match(source, /onSelect:\s*\(\) => sendTerminalControlSignal\("history-next",\s*contextServer\)/);
  assert.match(source, /id:\s*"send-ctrl-l"/);
  assert.match(source, /label:\s*"发送 Ctrl\+L"/);
  assert.match(source, /onSelect:\s*\(\) => sendTerminalControlSignal\("clear-remote-screen",\s*contextServer\)/);
  assert.match(source, /id:\s*"send-ctrl-s"/);
  assert.match(source, /label:\s*"发送 Ctrl\+S"/);
  assert.match(source, /onSelect:\s*\(\) => sendTerminalControlSignal\("pause-output",\s*contextServer\)/);
  assert.match(source, /id:\s*"send-ctrl-q"/);
  assert.match(source, /label:\s*"发送 Ctrl\+Q"/);
  assert.match(source, /onSelect:\s*\(\) => sendTerminalControlSignal\("resume-output",\s*contextServer\)/);
  assert.match(source, /disabled:\s*!terminalSession\.sessionId/);
});

test("terminal context menu sends control actions to the right-clicked tab session", () => {
  const source = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));

  assert.match(source, /id:\s*"stop-command"[\s\S]{0,180}onSelect:\s*\(\) => stopSelectedCommand\(contextServer\)/);
  assert.match(source, /id:\s*"send-ctrl-c"[\s\S]{0,180}onSelect:\s*\(\) => sendTerminalControlSignal\("interrupt",\s*contextServer\)/);
  assert.match(source, /id:\s*"send-ctrl-d"[\s\S]{0,180}onSelect:\s*\(\) => sendTerminalControlSignal\("eof",\s*contextServer\)/);
  assert.match(source, /id:\s*"send-ctrl-z"[\s\S]{0,180}onSelect:\s*\(\) => sendTerminalControlSignal\("suspend",\s*contextServer\)/);
  assert.match(source, /id:\s*"send-ctrl-backslash"[\s\S]{0,180}onSelect:\s*\(\) => sendTerminalControlSignal\("quit",\s*contextServer\)/);
  assert.match(source, /id:\s*"send-ctrl-r"[\s\S]{0,180}onSelect:\s*\(\) => sendTerminalControlSignal\("history-search",\s*contextServer\)/);
  assert.match(source, /id:\s*"send-ctrl-p"[\s\S]{0,180}onSelect:\s*\(\) => sendTerminalControlSignal\("history-previous",\s*contextServer\)/);
  assert.match(source, /id:\s*"send-ctrl-n"[\s\S]{0,180}onSelect:\s*\(\) => sendTerminalControlSignal\("history-next",\s*contextServer\)/);
  assert.match(source, /id:\s*"send-ctrl-l"[\s\S]{0,180}onSelect:\s*\(\) => sendTerminalControlSignal\("clear-remote-screen",\s*contextServer\)/);
  assert.match(source, /id:\s*"send-ctrl-s"[\s\S]{0,180}onSelect:\s*\(\) => sendTerminalControlSignal\("pause-output",\s*contextServer\)/);
  assert.match(source, /id:\s*"send-ctrl-q"[\s\S]{0,180}onSelect:\s*\(\) => sendTerminalControlSignal\("resume-output",\s*contextServer\)/);
  assert.match(source, /id:\s*"finish-interactive-mode"[\s\S]{0,200}onSelect:\s*\(\) => finishSelectedInteractiveMode\(contextServer\)/);
});

test("Terminal paste uses bracketed paste when the remote program enables it", () => {
  const pasteSource = app.slice(app.indexOf("async function pasteClipboardToCommandInput"), app.indexOf("function getSftpRemotePath"));
  const appendSource = app.slice(app.indexOf("function appendTerminalLines"), app.indexOf("function readSelectedTerminalText"));
  assert.match(app, /getTerminalControlModeUpdate/);
  assert.match(app, /wrapBracketedPasteText/);
  assert.match(app, /terminalControlModesRef = useRef\(\{\}\)/);
  assert.match(appendSource, /getTerminalControlModeUpdate\(options\.rawOutput\)/);
  assert.match(appendSource, /terminalControlModesRef\.current\[terminalKey\]/);
  assert.match(pasteSource, /const bracketedPasteEnabled = Boolean\(terminalControlModesRef\.current\[selectedTerminalSessionKey\]\?\.bracketedPaste\)/);
  assert.match(pasteSource, /const pasteText = wrapBracketedPasteText\(interactivePastePlan\.text,\s*bracketedPasteEnabled\)/);
  assert.match(pasteSource, /sendSelectedSessionInput\(null,\s*\{ text:\s*pasteText,\s*submit:\s*false,\s*clearInput:\s*false,\s*sessionKey:\s*selectedTerminalSessionKey \}\)/);
  assert.match(app, /rawOutput:\s*result\.output/);
});

test("terminal context menu exposes reconnect and diagnostics after session disconnects", () => {
  const source = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));

  assert.match(source, /terminalSessionReconnectable/);
  assert.match(source, /terminalSession\.lastError \|\| terminalSession\.disconnectedAt/);
  assert.match(source, /label:\s*terminalSessionReconnectable \? "重连 SSH 会话" : "连接 SSH 会话"/);
  assert.match(source, /onSelect:\s*terminalSessionReconnectable \? \(\) => reconnectSelectedSession\(contextServer\) : \(\) => openSelectedSession\(contextServer\)/);
  assert.match(source, /id:\s*"export-diagnostic-package"/);
  assert.match(source, /label:\s*"导出诊断包"/);
  assert.match(source, /onSelect:\s*exportDiagnosticPackage/);
});

test("TerminalWorkspace recovery actions can copy SSH error details", () => {
  const source = app.slice(app.indexOf("function runTerminalSessionRecoveryAction"), app.indexOf("async function restoreSessionWorkingDirectory"));

  assert.match(source, /case "copy-error-detail":/);
  assert.match(source, /copySelectedSessionErrorDetail\(\)/);
  assert.match(app, /async function copySelectedSessionErrorDetail\(\)/);
  assert.match(app, /const session = sshSessions\[selectedTerminalSessionKey\] \|\| \{\}/);
  assert.match(app, /navigator\.clipboard\.writeText\(content\)/);
  assert.match(app, /document\.execCommand\("copy"\)/);
});

test("TerminalWorkspace recovery actions can copy a redacted SSH diagnostic summary", () => {
  const source = app.slice(app.indexOf("function runTerminalSessionRecoveryAction"), app.indexOf("async function restoreSessionWorkingDirectory"));

  assert.match(source, /case "copy-diagnostic-summary":/);
  assert.match(source, /copySelectedSessionDiagnosticSummary\(\)/);
  assert.match(app, /async function copySelectedSessionDiagnosticSummary\(\)/);
  assert.match(app, /SSH 连接排障摘要/);
  assert.match(app, /buildServerCopySshCommand\(selectedServer,\s*server\)/);
  assert.match(app, /serverAuthStatus\.label/);
  assert.match(app, /navigator\.clipboard\.writeText\(content\)/);
  assert.doesNotMatch(app, /copySelectedSessionDiagnosticSummary[\s\S]*credentialRef[\s\S]*writeText\(content\)/);
});

test("TerminalWorkspace recovery actions can copy a reproducible SSH command", () => {
  const source = app.slice(app.indexOf("function runTerminalSessionRecoveryAction"), app.indexOf("async function restoreSessionWorkingDirectory"));

  assert.match(source, /case "copy-ssh-command":/);
  assert.match(source, /copyServerSshCommand\(selectedServer\)/);
  assert.match(app, /function copyServerSshCommand\(name = selectedServer\)/);
  assert.match(app, /buildServerCopySshCommand\(name,\s*server\)/);
});

test("TerminalWorkspace recovery actions can open the selected connection editor", () => {
  const source = app.slice(app.indexOf("function runTerminalSessionRecoveryAction"), app.indexOf("async function openSelectedSession"));

  assert.match(source, /case "edit-connection":/);
  assert.match(source, /openEditHost\(selectedServer\)/);
  assert.match(app, /function openEditHost\(targetName = selectedServer\)/);
});

test("TerminalWorkspace recovery actions can open failed session logs for the selected server", () => {
  const source = app.slice(app.indexOf("function runTerminalSessionRecoveryAction"), app.indexOf("async function openSelectedSession"));

  assert.match(source, /case "reconnect":/);
  assert.match(source, /reconnectSelectedSession\(\)/);
  assert.match(source, /case "session-logs":/);
  assert.match(source, /openSessionLogs\(\{ server:\s*selectedServer,\s*status:\s*"failed" \}\)/);
  assert.match(app, /async function openSessionLogs\(initialFilters = \{\}\)/);
  assert.match(app, /const filters = \{ server:\s*selectedServer,\s*query:\s*"",\s*type:\s*"",\s*status:\s*"",\s*failureKind:\s*"",\s*\.\.\.initialFilters \}/);
});

test("SSH connect failure session logs include safe connection context", () => {
  const source = app.slice(app.indexOf("async function openSelectedSession"), app.indexOf("async function ensureCommandSession"));
  assert.match(app, /buildSshSessionLogContext/);
  assert.match(source, /const sessionLogContext = buildSshSessionLogContext\(name,\s*server\)/);
  assert.ok((source.match(/writeSessionLogEvent\(\{ type:\s*"session_open_failed"[\s\S]{0,220}context:\s*sessionLogContext/g) || []).length >= 5);
  assert.match(source, /writeSessionLogEvent\(\{ type:\s*"session_opened"[\s\S]{0,220}context:\s*sessionLogContext/);
});

test("TerminalWorkspace recovery actions can hide the selected session recovery notice", () => {
  const actionSource = app.slice(app.indexOf("function runTerminalSessionRecoveryAction"), app.indexOf("async function restoreSessionWorkingDirectory"));
  const dismissSource = app.slice(app.indexOf("function dismissSelectedSessionRecovery"), app.indexOf("function runTerminalSessionRecoveryAction"));

  assert.match(actionSource, /case "dismiss-recovery":/);
  assert.match(actionSource, /dismissSelectedSessionRecovery\(\)/);
  assert.match(app, /function dismissSelectedSessionRecovery\(\)/);
  assert.match(dismissSource, /const sessionKey = selectedTerminalSessionKey/);
  assert.match(dismissSource, /lastError:\s*""/);
  assert.match(dismissSource, /disconnectedAt:\s*""/);
});

test("TerminalWorkspace can expand and reuse command history from the input area", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  assert.match(source, /historyPanelOpen/);
  assert.match(source, /setHistoryPanelOpen/);
  assert.match(source, /terminal-history-toggle/);
  assert.match(source, /terminal-history-panel/);
  assert.match(source, /filterCommandHistory\(commandHistory,\s*historyFilter,\s*12\)/);
  assert.match(source, /onUseHistoryCommand\(command\)/);
  assert.match(app, /onUseHistoryCommand=\{useCommandHistoryItem\}/);
  assert.match(app, /function useCommandHistoryItem\(command\)/);
  assert.match(styles, /\.terminal-history-panel/);
  assert.match(styles, /\.terminal-history-item/);
});

test("TerminalWorkspace can filter command history inside the history panel", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");

  assert.match(app, /filterCommandHistory/);
  assert.match(source, /historyFilter,\s*setHistoryFilter/);
  assert.match(source, /const filteredCommandHistory = filterCommandHistory\(commandHistory,\s*historyFilter,\s*12\)/);
  assert.match(source, /className="terminal-history-search"/);
  assert.match(source, /placeholder="搜索历史命令"/);
  assert.match(source, /filteredCommandHistory\.map\(\(command\)/);
  assert.match(source, /没有匹配的历史命令/);
  assert.match(styles, /\.terminal-history-search/);
});

test("terminal command input can search command history with Ctrl+R", () => {
  const keyDownSource = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));

  assert.match(app, /searchCommandHistory/);
  assert.match(keyDownSource, /event\.key\.toLowerCase\(\) === "r"/);
  assert.match(keyDownSource, /searchCommandHistory\(history,\s*commandInputs\[inputKey\] \|\| ""\)/);
  assert.match(keyDownSource, /setCommandInputs\(\(current\) => \(\{ \.\.\.current,\s*\[inputKey\]: searchResult\.value \}\)\)/);
});

test("terminal command input supports Ctrl+P and Ctrl+N history navigation", () => {
  const keyDownSource = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));

  assert.match(app, /getCommandHistoryKeyAction/);
  assert.match(keyDownSource, /const historyKeyAction = getCommandHistoryKeyAction\(event\)/);
  assert.match(keyDownSource, /if \(!historyKeyAction\) return/);
  assert.match(keyDownSource, /if \(historyKeyAction === "restore"\)/);
  assert.match(keyDownSource, /moveHistoryCursor\(cursor,\s*history,\s*historyKeyAction\)/);
});

test("SSH command stop invalidates stale interactive state", () => {
  assert.match(app, /terminalCommandRequestRef/);
  assert.match(app, /function nextTerminalCommandRequestId\(sessionKey\)/);
  assert.match(app, /function invalidateTerminalCommandRequest\(sessionKey\)/);
  assert.match(app, /invalidateTerminalCommandRequest\(sessionKey\)/);
  assert.match(app, /async function stopSelectedCommand/);
  assert.doesNotMatch(app, /api\.send_ssh_session_command\(sessionId,\s*command\)/);
});

test("SSH command stop clears stale interactive mode even without a live session", () => {
  const source = app.slice(app.indexOf("async function stopSelectedCommand"), app.indexOf("async function sendTerminalControlSignal"));
  const noSessionBranch = source.slice(source.indexOf("if (!session?.sessionId)"), source.indexOf("const sessionId = session.sessionId"));

  assert.match(noSessionBranch, /busy:\s*false/);
  assert.match(noSessionBranch, /interactiveMode:\s*false/);
});

test("SSH command request tokens remain isolated by terminal session key for cancellation", () => {
  const helperSource = app.slice(app.indexOf("function nextTerminalCommandRequestId"), app.indexOf("async function persistAppConfig"));
  const senderSource = app.slice(app.indexOf("async function sendSelectedCommand"), app.indexOf("\n  return (\n    <div", app.indexOf("async function sendSelectedCommand")));

  assert.match(app, /terminalCommandRequestRef = useRef\(\{\}\)/);
  assert.match(helperSource, /const key = String\(sessionKey \|\| "default"\)/);
  assert.match(helperSource, /terminalCommandRequestRef\.current\[key\]/);
  assert.match(senderSource, /const sessionKey = resolveTerminalSessionKey\(name,\s*options\)/);
  assert.match(app, /invalidateTerminalCommandRequest\(sessionKey\)/);
  assert.doesNotMatch(senderSource, /terminalCommandRequestRef\.current \+= 1/);
  assert.doesNotMatch(senderSource, /terminalCommandRequestRef\.current !== requestId/);
});

test("SSH command sender ignores stale backend results after interruption", () => {
  const start = app.indexOf("async function sendSelectedCommand");
  const end = app.indexOf("\n  return (\n    <div", start);
  assert.notEqual(start, -1, "sendSelectedCommand should exist");
  assert.notEqual(end, -1, "sendSelectedCommand should appear before the app render");
  const source = app.slice(start, end);

  assert.match(source, /const requestId = nextTerminalCommandRequestId\(sessionKey\)/);
  assert.match(source, /if \(!isCurrentTerminalCommandRequest\(sessionKey,\s*requestId\)\) return/);
  assert.ok(source.indexOf("const requestId = nextTerminalCommandRequestId(sessionKey)") < source.indexOf("const result = await sendSelectedSessionInput"));
  assert.ok(source.indexOf("if (!isCurrentTerminalCommandRequest(sessionKey, requestId)) return") < source.indexOf("if (result?.ok)"));
});

test("Terminal output appends use the shared screen buffer reducer", () => {
  assert.match(app, /import \{[^}]*appendTerminalOutputState[^}]*\} from "\.\/terminalOutput\.js"/);
  assert.match(app, /terminalOpenLineRef = useRef\(\{\}\)/);
  assert.match(app, /appendTerminalOutputState\(\s*\{\s*lines: current\[terminalKey\] \|\| \[\],\s*openLine: Boolean\(terminalOpenLineRef\.current\[terminalKey\]\)/);
  assert.match(app, /terminalOpenLineRef\.current\[terminalKey\] = result\.openLine/);
});

test("Terminal output OSC title updates the current SSH tab title", () => {
  const appendSource = app.slice(app.indexOf("function appendTerminalLines"), app.indexOf("function readSelectedTerminalText"));

  assert.match(appendSource, /controlUpdate\.title/);
  assert.match(appendSource, /renameTerminalTabTitle\(visibleTerminalTabs,\s*terminalKey,\s*controlUpdate\.title\)/);
  assert.match(appendSource, /saveTerminalTabs\(normalizeTerminalTabModels\(nextTabs,\s*serverNames\)\)/);
});

test("Terminal output OSC cwd keeps the selected SSH session working directory in sync", () => {
  const appendSource = app.slice(app.indexOf("function appendTerminalLines"), app.indexOf("function readSelectedTerminalText"));

  assert.match(appendSource, /controlUpdate\.cwd/);
  assert.match(app, /function syncTerminalWorkingDirectoryFromOutput\(name,\s*cwd\)/);
  assert.match(appendSource, /syncTerminalWorkingDirectoryFromOutput\(name,\s*controlUpdate\.cwd\)/);
  assert.match(app, /setSessionWorkingDirectories\(\(current\) => \(\{ \.\.\.current,\s*\[name\]: nextCwd \}\)\)/);
  assert.match(app, /setSftpPaths\(\(current\) => \(\{ \.\.\.current,\s*\[name\]: nextCwd \}\)\)/);
  assert.match(app, /if \(name === selectedServer && currentSftpPath\(name\) !== nextCwd\) \{/);
  assert.match(app, /void refreshSelectedSftp\(nextCwd,\s*"",\s*name\)/);
});

test("SSH output polling failures mark the session disconnected for recovery", () => {
  const source = app.slice(app.indexOf("api?.read_ssh_session_output"), app.indexOf("api?.check_ssh_session_health"));
  assert.match(source, /if \(result && result\.ok === false\) \{/);
  assert.match(source, /catch \(error\) \{/);
  assert.ok((source.match(/setSshSessions\(\(current\) =>/g) || []).length >= 2);
  assert.ok((source.match(/sessionId: ""/g) || []).length >= 2);
  assert.ok((source.match(/busy: false/g) || []).length >= 2);
  assert.ok((source.match(/lastError: message/g) || []).length >= 2);
  assert.ok((source.match(/disconnectedAt: new Date\(\)\.toISOString\(\)/g) || []).length >= 2);
});

test("SSH output polling failures append a visible reconnect recovery hint", () => {
  const source = app.slice(app.indexOf("api?.read_ssh_session_output"), app.indexOf("api?.check_ssh_session_health"));

  assert.ok((source.match(/SSH 输出读取失败/g) || []).length >= 2);
  assert.ok((source.match(/会话已断开，可点击“重连会话”重新连接/g) || []).length >= 2);
  assert.doesNotMatch(source, /会话已断开，可点击“连接会话”重新连接/);
});

test("SSH output polling avoids overlapping reads for the same session", () => {
  const source = app.slice(app.indexOf("api?.read_ssh_session_output"), app.indexOf("api?.check_ssh_session_health"));
  assert.match(app, /sshOutputPollingSessionsRef = useRef\(new Set\(\)\)/);
  assert.match(source, /sshOutputPollingSessionsRef\.current\.has\(session\.sessionId\)/);
  assert.match(source, /sshOutputPollingSessionsRef\.current\.add\(session\.sessionId\)/);
  assert.match(source, /finally \{/);
  assert.match(source, /sshOutputPollingSessionsRef\.current\.delete\(session\.sessionId\)/);
});

test("SSH output polling immediately continues when backend reports more output", () => {
  const source = app.slice(app.indexOf("api?.read_ssh_session_output"), app.indexOf("api?.check_ssh_session_health"));

  assert.match(source, /let readMoreOutput = true/);
  assert.match(source, /let readMoreGuard = 0/);
  assert.match(source, /while \(readMoreOutput && readMoreGuard < 4\)/);
  assert.match(source, /readMoreOutput = Boolean\(result\?\.hasMore && result\?\.ok !== false\)/);
});

test("SSH command submit triggers immediate output polling instead of waiting for the interval", () => {
  const pollingSource = app.slice(app.indexOf("api?.read_ssh_session_output"), app.indexOf("api?.check_ssh_session_health"));
  const commandSource = app.slice(app.indexOf("async function sendSelectedCommand"), app.indexOf("return (", app.indexOf("async function sendSelectedCommand")));

  assert.match(app, /sshOutputPollTick,\s*setSshOutputPollTick/);
  assert.match(app, /function triggerSshOutputPoll\(\)/);
  assert.match(pollingSource, /pollActiveSshSessionOutput\(\)/);
  assert.match(pollingSource, /\[sshSessions,\s*sshOutputPollTick\]/);
  assert.match(commandSource, /triggerSshOutputPoll\(\)/);
});

test("SSH interactive input and Ctrl+C trigger immediate output polling", () => {
  const inputSource = app.slice(app.indexOf("async function sendSelectedSessionInput"), app.indexOf("async function sendSelectedCommand"));
  const stopSource = app.slice(app.indexOf("async function stopSelectedCommand"), app.indexOf("function finishSelectedInteractiveMode"));

  assert.match(inputSource, /const result = api\?\.send_ssh_session_input[\s\S]*withSshApiTimeout/);
  assert.match(inputSource, /triggerSshOutputPoll\(\)/);
  assert.match(stopSource, /interrupt_ssh_session_command\(session\.sessionId\)/);
  assert.match(stopSource, /triggerSshOutputPoll\(\)/);
});

test("SSH health polling avoids overlapping checks for the same session", () => {
  const source = app.slice(app.indexOf("api?.check_ssh_session_health"), app.indexOf("function showNotice"));
  assert.match(app, /sshHealthPollingSessionsRef = useRef\(new Set\(\)\)/);
  assert.match(source, /sshHealthPollingSessionsRef\.current\.has\(session\.sessionId\)/);
  assert.match(source, /sshHealthPollingSessionsRef\.current\.add\(session\.sessionId\)/);
  assert.match(source, /finally \{/);
  assert.match(source, /sshHealthPollingSessionsRef\.current\.delete\(session\.sessionId\)/);
});

test("SSH health polling disconnects append a visible reconnect recovery hint", () => {
  const source = app.slice(app.indexOf("api?.check_ssh_session_health"), app.indexOf("function showNotice"));

  assert.match(source, /SSH 会话断开/);
  assert.match(source, /SSH 健康检查失败/);
  assert.ok((source.match(/会话已断开，可点击“重连会话”重新连接/g) || []).length >= 2);
});

test("SSH command stop failures are logged and shown without dropping the session", () => {
  const source = app.slice(app.indexOf("async function stopSelectedCommand"), app.indexOf("function finishSelectedInteractiveMode"));
  assert.match(source, /if \(!result\?\.ok\) throw new Error/);
  assert.match(source, /catch \(error\) \{/);
  assert.match(source, /session_interrupt_failed/);
  assert.match(source, /appendTerminalLines\(targetName,\s*\["# " \+ message\]/);
  assert.doesNotMatch(source, /sessionId:\s*""/);
});

test("SSH PTY command failures are recorded as command_failed session events", () => {
  const start = app.indexOf("async function sendSelectedCommand");
  const source = app.slice(start, app.indexOf("return (", start));

  assert.match(source, /const result = await sendSelectedSessionInput/);
  assert.match(source, /const commandLogContext = \{ \.\.\.buildSshSessionLogContext\(name,\s*servers\[name\] \|\| \{\}\),\s*sessionKey \}/);
  assert.match(source, /const message = result\?\.message \|\| "SSH 命令发送失败。"/);
  assert.match(source, /writeAuditEvent\(\{ type:\s*"command_failed"/);
  assert.match(source, /writeSessionLogEvent\(\{ type:\s*"command_failed"/);
  assert.match(source, /command,\s*message,\s*status:\s*"failed",\s*context:\s*commandLogContext/);
});

test("AgentPanel keeps Agent tools inside conversation instead of fixed workflow panels", () => {
  const source = componentSource("AgentPanel", "PlanCard");
  assert.match(source, /className="agent-task-dock"/);
  assert.match(source, /Agent 待审批动作/);
  assert.match(source, /Agent 正在执行/);
  assert.match(source, /pendingTasks\.length > 0/);
  assert.doesNotMatch(source, /可加入待执行任务/);
  assert.doesNotMatch(source, /计划预览|证据|报告/);
});

test("desktop tool exposes basic context menus for server and terminal work", () => {
  assert.match(app, /contextMenu/);
  assert.match(app, /openServerContextMenu/);
  assert.match(app, /openTerminalContextMenu/);
  assert.match(app, /className="context-menu"/);
  assert.match(app, /style=\{\{ left:\s*menu\.x,\s*top:\s*menu\.y,\s*maxHeight:\s*menu\.maxHeight \}\}/);
  assert.match(app, /openEditHost\(name\)/);
  assert.match(app, /deleteSelectedHost\(name\)/);
  assert.match(app, /pasteClipboardToCommandInput/);
  assert.match(app, /粘贴到终端/);
  assert.match(app, /navigator\.clipboard\.readText/);
  assert.match(app, /updateCommandInput\(inputKey,\s*nextCommand\)/);
  assert.match(app, /sendSelectedCommand/);
  assert.match(app, /event\?\.preventDefault\?\.\(\)/);
  assert.match(app, /执行当前命令/);
  assert.match(app, /id:\s*"stop-command"[\s\S]{0,140}label:\s*"中断当前命令"/);
  assert.match(app, /disconnect-session/);
  assert.match(app, /断开当前会话/);
  assert.match(app, /onSelect:\s*\(\) => closeSelectedSession\(contextServer\)/);
  assert.match(app, /disabled:\s*!terminalSession\.sessionId/);
  assert.match(app, /onSelect:\s*\(\) => sendSelectedCommand\(null,\s*\{ targetName:\s*contextServer,\s*sessionKey:\s*contextSessionKey,\s*commandInputKey \}\)/);
  assert.match(app, /onSelect:\s*\(\) => stopSelectedCommand\(contextServer\)/);
  assert.match(app, /onCancelTask/);
});

test("context menu renders section labels and remains scrollable for long desktop menus", () => {
  const source = componentSource("ContextMenu", "serverToHostForm");

  assert.match(source, /item\.section/);
  assert.match(source, /className="context-menu-section"/);
  assert.match(source, /role="presentation"/);
  assert.match(styles, /\.context-menu\s*\{[\s\S]*max-height:\s*calc\(100vh - 8px\)/);
  assert.match(styles, /\.context-menu\s*\{[\s\S]*overflow:\s*auto/);
  assert.match(cssRule(".context-menu-section"), /font-size:\s*8px/);
});

test("context menu uses extra compact readable option sizing so long menus fit onscreen", () => {
  assert.match(cssRule(".context-menu"), /width:\s*min\(336px,\s*calc\(100vw - 16px\)\)/);
  assert.match(cssRule(".context-menu"), /gap:\s*0/);
  assert.match(cssRule(".context-menu"), /padding:\s*3px/);
  assert.match(cssRule(".context-menu"), /scrollbar-width:\s*thin/);
  assert.match(cssRule(".context-menu-title"), /padding:\s*2px 6px 1px/);
  assert.match(cssRule(".context-menu-title"), /font-size:\s*8px/);
  assert.match(cssRule(".context-menu-section"), /padding:\s*2px 6px 1px/);
  assert.match(cssRule(".context-menu-section"), /font-size:\s*8px/);
  assert.match(cssRule(".context-menu button"), /min-height:\s*16px/);
  assert.match(cssRule(".context-menu button"), /grid-template-columns:\s*10px minmax\(0,\s*1fr\)/);
  assert.match(cssRule(".context-menu button"), /padding:\s*1px 5px/);
  assert.match(cssRule(".context-menu button"), /font-size:\s*8px/);
  assert.match(cssRule(".context-menu button"), /line-height:\s*1\.1/);
  assert.match(cssRule(".context-menu button svg"), /width:\s*10px/);
  assert.match(cssRule(".context-menu button span"), /white-space:\s*nowrap/);
  assert.match(cssRule(".context-menu button span"), /text-overflow:\s*ellipsis/);
  assert.match(cssRule(".context-menu-separator"), /margin:\s*1px 6px/);
});

test("SFTP delete confirmation modal keeps long remote paths readable", () => {
  assert.match(app, /className="settings-modal sftp-delete-modal"/);
  assert.match(app, /className="confirm-path-box"/);
  assert.match(cssRule(".sftp-delete-modal"), /width:\s*min\(460px,\s*calc\(100vw - 56px\)\)/);
  assert.match(cssRule(".confirm-path-box"), /overflow-wrap:\s*anywhere/);
});

test("context menu exposes full option text in hover titles when labels are clipped", () => {
  const source = componentSource("ContextMenu", "serverToHostForm");

  assert.match(source, /title=\{item\.title \|\| \(item\.shortcut \? `\$\{item\.label\} \$\{item\.shortcut\}` : item\.label\)\}/);
});

test("terminal shortcut can open the new connection dialog", () => {
  const source = app.slice(app.indexOf("function runTerminalShortcutAction"), app.indexOf("function handleTerminalShortcutKeyDown"));

  assert.match(source, /action === "new-connection"/);
  assert.match(source, /openNewHost\(\)/);
});

test("terminal shortcut can open current server session logs", () => {
  const source = app.slice(app.indexOf("function runTerminalShortcutAction"), app.indexOf("function handleTerminalShortcutKeyDown"));

  assert.match(source, /action === "open-session-logs"/);
  assert.match(source, /openSessionLogs\(\{ server:\s*selectedServer \}\)/);
});

test("terminal shortcut can edit the current SSH connection", () => {
  const source = app.slice(app.indexOf("function runTerminalShortcutAction"), app.indexOf("function handleTerminalShortcutKeyDown"));

  assert.match(source, /action === "edit-current-connection"/);
  assert.match(source, /openEditHost\(selectedServer\)/);
});

test("terminal shortcut can open current server auth center", () => {
  const source = app.slice(app.indexOf("function runTerminalShortcutAction"), app.indexOf("function handleTerminalShortcutKeyDown"));

  assert.match(source, /action === "open-auth-center"/);
  assert.match(source, /openAuthCenter\(selectedServer\)/);
});

test("terminal shortcut can open the backup center", () => {
  const source = app.slice(app.indexOf("function runTerminalShortcutAction"), app.indexOf("function handleTerminalShortcutKeyDown"));

  assert.match(source, /action === "open-backup-center"/);
  assert.match(source, /setBackupOpen\(true\)/);
});

test("terminal shortcut can open tool logs for bug diagnostics", () => {
  const source = app.slice(app.indexOf("function runTerminalShortcutAction"), app.indexOf("function handleTerminalShortcutKeyDown"));

  assert.match(source, /action === "open-tool-logs"/);
  assert.match(source, /openToolLogs\(\)/);
});

test("terminal tabs can open the same SSH context menu from right click", () => {
  const workspaceSource = app.slice(app.indexOf("function TerminalWorkspace"), app.indexOf("function AgentPanel"));
  const appSource = app.slice(app.indexOf("function openTerminalTabContextMenu"), app.indexOf("function openSftpContextMenu"));
  const renderSource = app.slice(app.indexOf("<TerminalWorkspace"), app.indexOf("<LegacyAgentPanel"));

  assert.match(workspaceSource, /onOpenTerminalTabContextMenu/);
  assert.match(workspaceSource, /onContextMenu=\{\(event\) => onOpenTerminalTabContextMenu\(event,\s*tabId\)\}/);
  assert.match(app, /function openTerminalTabContextMenu\(event,\s*tabId\)/);
  assert.match(appSource, /setSelectedTerminalTabId\(tabId\)/);
  assert.match(appSource, /openTerminalContextMenu\(event,\s*tabId\)/);
  assert.match(renderSource, /onOpenTerminalTabContextMenu=\{openTerminalTabContextMenu\}/);
});

test("terminal context menu can copy recent diagnostic output", () => {
  assert.match(app, /function copyRecentTerminalOutput\(targetName = selectedServer,\s*options = \{\}\)/);
  assert.match(app, /copySelectedTerminalOutput\(80,\s*targetName,\s*options\)/);
  assert.match(app, /formatTerminalClipboardText\(terminalLines,\s*limit\)/);
  assert.match(app, /id:\s*"copy-recent-output"/);
  assert.match(app, /label:\s*"复制最近输出"/);
  assert.match(app, /onSelect:\s*\(\) => copyRecentTerminalOutput\(contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
});

test("terminal context menu can export the current terminal transcript", () => {
  assert.match(app, /buildTerminalExportFileName/);
  assert.match(app, /buildTerminalExportText/);
  assert.match(app, /function exportSelectedTerminalOutput\(targetName = selectedServer,\s*options = \{\}\)/);
  assert.match(app, /await api\.save_text_file\(fileName,\s*content\)/);
  assert.match(app, /new Blob\(\[content\]/);
  assert.match(contextMenuActions, /id:\s*"export-terminal-output"/);
  assert.match(app, /"export-terminal-output":\s*\(\) => exportSelectedTerminalOutput\(contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(app, /action === "export-terminal-output"/);
  assert.match(app, /exportSelectedTerminalOutput\(\)/);
});

test("terminal context menu can clear the selected server command history", () => {
  const source = app.slice(app.indexOf("function clearSelectedCommandHistory"), app.indexOf("async function exportSelectedTerminalOutput"));

  assert.match(app, /clearCommandHistoryForServer/);
  assert.match(app, /function clearSelectedCommandHistory\(targetName = selectedServer,\s*options = \{\}\)/);
  assert.match(app, /const inputKey = resolveCommandInputKey\(name,\s*options\)/);
  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /setPendingConfirmAction\(\{/);
  assert.match(source, /title:\s*"清空命令历史"/);
  assert.match(source, /onConfirm:\s*\(\) => confirmClearSelectedCommandHistory\(name,\s*inputKey\)/);
  assert.match(app, /function confirmClearSelectedCommandHistory\(name,\s*inputKey\)/);
  assert.match(app, /clearCommandHistoryForServer\(commandHistories,\s*name\)/);
  assert.match(app, /writeLocalJson\("sshAgentCommandHistories",\s*nextHistories\)/);
  assert.match(app, /id:\s*"clear-command-history"/);
  assert.match(app, /onSelect:\s*\(\) => clearSelectedCommandHistory\(contextServer,\s*\{ commandInputKey \}\)/);
});

test("terminal context menu uses the right-clicked tab command draft and history", () => {
  const menuSource = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));

  assert.match(menuSource, /id:\s*"run-command"[\s\S]{0,200}onSelect:\s*\(\) => sendSelectedCommand\(null,\s*\{ targetName:\s*contextServer,\s*sessionKey:\s*contextSessionKey,\s*commandInputKey \}\)/);
  assert.match(menuSource, /id:\s*"rerun-last-command"[\s\S]{0,180}disabled:\s*terminalSession\.busy \|\| !\(commandHistories\[contextServer\] \|\| \[\]\)\[0\]/);
  assert.match(menuSource, /id:\s*"rerun-last-command"[\s\S]{0,260}onSelect:\s*\(\) => rerunLastCommandFromHistory\(contextServer,\s*\{ sessionKey:\s*contextSessionKey,\s*commandInputKey \}\)/);
  assert.match(menuSource, /id:\s*"clear-command-history"[\s\S]{0,180}onSelect:\s*\(\) => clearSelectedCommandHistory\(contextServer,\s*\{ commandInputKey \}\)/);
  assert.match(menuSource, /id:\s*"copy-command-input"[\s\S]{0,180}onSelect:\s*\(\) => copyCurrentCommandInput\(commandInputKey\)/);
  assert.match(menuSource, /id:\s*"snippet"[\s\S]{0,220}onSelect:\s*\(\) => saveCurrentCommandSnippet\(commandInputKey\)/);
});

test("terminal context menu can clear the current command input", () => {
  const source = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));

  assert.match(source, /id:\s*"clear-command-input"/);
  assert.match(source, /label:\s*"清空命令输入"/);
  assert.match(source, /disabled:\s*!hasCommandDraft/);
  assert.match(source, /onSelect:\s*\(\) => updateCommandInput\(commandInputKey,\s*""\)/);
});

test("terminal context menu can copy the current command input", () => {
  const source = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  const copySource = app.slice(app.indexOf("async function copyCurrentCommandInput"), app.indexOf("function selectCurrentTerminalOutput"));

  assert.match(source, /id:\s*"copy-command-input"/);
  assert.match(source, /label:\s*"复制当前命令"/);
  assert.match(source, /disabled:\s*!hasCommandDraft/);
  assert.match(source, /onSelect:\s*\(\) => copyCurrentCommandInput\(commandInputKey\)/);
  assert.match(copySource, /const command = commandInputs\[inputKey\] \|\| ""/);
  assert.match(copySource, /navigator\.clipboard\.writeText\(command\)/);
  assert.match(copySource, /当前命令已复制/);
});

test("terminal context menu can test the current SSH connection", () => {
  const source = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));

  assert.match(source, /id:\s*"test-current-connection"/);
  assert.match(source, /label:\s*"测试连接"/);
  assert.match(source, /disabled:\s*Boolean\(testingConnections\[contextServer\]\)/);
  assert.match(source, /onSelect:\s*\(\) => testSelectedConnection\(contextServer\)/);
});

test("terminal context menu can force disconnect a busy SSH session", () => {
  const source = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));

  assert.match(source, /id:\s*"disconnect-session"/);
  assert.match(source, /label:\s*terminalSession\.busy \? "强制断开会话" : "断开当前会话"/);
  assert.doesNotMatch(source, /id:\s*"disconnect-session"[\s\S]{0,180}disabled:\s*terminalSession\.busy/);
  assert.match(source, /onSelect:\s*\(\) => closeSelectedSession\(contextServer,\s*\{ sessionKey:\s*contextSessionKey \}\)/);
});

test("SSH disconnect backend failures are recorded in session logs", () => {
  const source = app.slice(app.indexOf("async function closeSessionByName"), app.indexOf("async function closeSelectedSession"));

  assert.match(source, /const closeResult = await api\.close_ssh_session\(sessionId\)/);
  assert.match(source, /closeFailureMessage/);
  assert.match(source, /type:\s*closeFailureMessage \? "disconnect_failed" : "disconnect"/);
  assert.match(source, /status:\s*closeFailureMessage \? "failed" : "ok"/);
});

test("SSH disconnect invalidates pending command output for the terminal tab", () => {
  const source = app.slice(app.indexOf("async function closeSessionByName"), app.indexOf("async function closeSelectedSession"));

  assert.match(source, /const sessionKey = resolveTerminalSessionKey\(name,\s*options\)/);
  assert.match(source, /invalidateTerminalCommandRequest\(sessionKey\)/);
  assert.ok(source.indexOf("invalidateTerminalCommandRequest(sessionKey)") < source.indexOf("api.close_ssh_session"));
});

test("terminal context menu can leave interactive mode without disconnecting", () => {
  const source = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));

  assert.match(source, /id:\s*"finish-interactive-mode"/);
  assert.match(source, /label:\s*"退出交互模式"/);
  assert.match(source, /disabled:\s*!\(terminalSession\.busy && terminalSession\.sessionId\)/);
  assert.match(source, /onSelect:\s*\(\) => finishSelectedInteractiveMode\(contextServer,\s*\{ sessionKey:\s*contextSessionKey \}\)/);
});

test("terminal menu Ctrl+C uses the unified stop flow while an SSH program is running", () => {
  const source = app.slice(app.indexOf("function sendTerminalControlSignal"), app.indexOf("async function resizeSelectedSession"));

  assert.match(source, /const sessionKey = resolveTerminalSessionKey\(targetName\)/);
  assert.match(source, /if \(signal === "interrupt"\) \{/);
  assert.match(source, /if \(isTerminalInteractiveMode\(session\)\) \{/);
  assert.match(source, /await stopSelectedCommand\(targetName\)/);
  assert.ok(source.indexOf("isTerminalInteractiveMode(session)") < source.indexOf("await stopSelectedCommand(targetName)"));
  assert.ok(source.indexOf('signal === "interrupt"') < source.indexOf("sendSelectedSessionInput(null"));
});

test("terminal menu Ctrl+C sends ETX to connected idle shells", () => {
  const source = app.slice(app.indexOf("function sendTerminalControlSignal"), app.indexOf("async function resizeSelectedSession"));
  const interruptBranch = source.slice(source.indexOf('if (signal === "interrupt")'), source.indexOf("const controlInputs"));

  assert.match(interruptBranch, /sendSelectedSessionInput\(null,\s*\{ text:\s*"\\x03",\s*submit:\s*false,\s*clearInput:\s*false,\s*targetName,\s*sessionKey \}\)/);
  assert.ok(interruptBranch.indexOf("await stopSelectedCommand(targetName)") < interruptBranch.indexOf('text: "\\x03"'));
});

test("terminal context menu can reconnect and clear the current SSH session", () => {
  const menuSource = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  const actionSource = app.slice(app.indexOf("async function reconnectAndClearSelectedSession"), app.indexOf("async function stopSelectedCommand"));

  assert.match(app, /async function reconnectAndClearSelectedSession\(targetName = selectedServer,\s*options = \{\}\)/);
  assert.match(actionSource, /const name = targetName \|\| selectedServer/);
  assert.match(actionSource, /clearSelectedTerminalOutput\(name,\s*\{ sessionKey \}\)/);
  assert.match(actionSource, /return reconnectSelectedSession\(name,\s*\{ sessionKey \}\)/);
  assert.match(menuSource, /"reconnect-and-clear-session":\s*\(\) => reconnectAndClearSelectedSession\(contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(menuSource, /terminalModel\.items\.map\(\(item\) => item\.separator \|\| item\.section \? item : \{ \.\.\.item,\s*onSelect:\s*terminalModelActions\[item\.id\] \}\)/);
});

test("terminal context menu can rerun the latest command history item", () => {
  const menuSource = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  const actionSource = app.slice(app.indexOf("async function rerunLastCommandFromHistory"), app.indexOf("function closeContextMenu"));
  const senderSource = app.slice(app.indexOf("async function sendSelectedCommand"), app.indexOf("\n  return (\n    <div", app.indexOf("async function sendSelectedCommand")));

  assert.match(app, /async function rerunLastCommandFromHistory\(targetName = selectedServer,\s*options = \{\}\)/);
  assert.match(actionSource, /const lastCommand = \(commandHistories\[name\] \|\| \[\]\)\[0\] \|\| ""/);
  assert.match(actionSource, /await sendSelectedCommand\(null,\s*\{ \.\.\.options,\s*targetName: name,\s*command: lastCommand \}\)/);
  assert.match(senderSource, /async function sendSelectedCommand\(event,\s*options = \{\}\)/);
  assert.match(senderSource, /const name = options\.targetName \|\| selectedServer/);
  assert.match(senderSource, /const rawCommand = String\(options\.command \?\? commandInputs\[commandInputKey\] \?\? ""\)/);
  assert.match(senderSource, /const command = rawCommand\.trim\(\)/);
  assert.match(menuSource, /id:\s*"rerun-last-command"/);
  assert.match(menuSource, /disabled:\s*terminalSession\.busy \|\| !\(commandHistories\[contextServer\] \|\| \[\]\)\[0\]/);
  assert.match(menuSource, /onSelect:\s*\(\) => rerunLastCommandFromHistory\(contextServer,\s*\{ sessionKey:\s*contextSessionKey,\s*commandInputKey \}\)/);
});

test("terminal context menu can open another tab for the same server", () => {
  const menuSource = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  const actionSource = app.slice(app.indexOf("function openDuplicateSelectedTerminalTab"), app.indexOf("function openTerminalContextMenu"));
  const workspaceSource = app.slice(app.indexOf("function TerminalWorkspace"), app.indexOf("function AgentPanel"));

  assert.match(app, /createDuplicateTerminalTab/);
  assert.match(app, /normalizeTerminalTabModels/);
  assert.match(app, /const \[selectedTerminalTabId,\s*setSelectedTerminalTabId\]/);
  assert.match(actionSource, /createDuplicateTerminalTab\(visibleTerminalTabs,\s*name,\s*serverNames\)/);
  assert.match(actionSource, /setSelectedTerminalTabId\(result\.selectedTabId\)/);
  assert.match(workspaceSource, /selectedTerminalTabId/);
  assert.match(workspaceSource, /tab\.id/);
  assert.match(workspaceSource, /tab\.serverName/);
  assert.match(menuSource, /id:\s*"duplicate-terminal-tab"/);
  assert.match(menuSource, /label:\s*"打开同主机新标签"/);
  assert.match(menuSource, /onSelect:\s*openDuplicateSelectedTerminalTab/);
});

test("terminal context menu can rename the current SSH tab title", () => {
  const menuSource = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  const actionSource = app.slice(app.indexOf("function renameSelectedTerminalTabTitle"), app.indexOf("function submitRenameTerminalTabTitle"));

  assert.match(app, /renameTerminalTabTitle/);
  if (false) {
  assert.match(actionSource, /window\.prompt\("请输入新的标签名称",\s*selectedTerminalTab\?\.title \|\| selectedServer\)/);
  assert.match(actionSource, /setRenameTabDraft\(\{/);
  }
  assert.doesNotMatch(actionSource, /window\.prompt/);
  assert.match(actionSource, /setRenameTabDraft\(\{/);
  assert.match(app, /function RenameTerminalTabModal/);
  assert.match(app, /renameTabDraft/);
  assert.match(app, /submitRenameTerminalTabTitle/);
  assert.match(app, /renameTerminalTabTitle\(visibleTerminalTabs,\s*renameTabDraft\.tabId,\s*renameTabDraft\.title\)/);
  assert.match(app, /<RenameTerminalTabModal/);
  assert.match(menuSource, /id:\s*"rename-terminal-tab"/);
  assert.match(menuSource, /label:\s*"重命名标签"/);
  assert.match(menuSource, /onSelect:\s*renameSelectedTerminalTabTitle/);
});

test("terminal tab title can be renamed by double clicking the tab", () => {
  const workspaceSource = app.slice(app.indexOf("function TerminalWorkspace"), app.indexOf("function AgentPanel"));
  const terminalRenderStart = app.indexOf("<TerminalWorkspace");
  const renderSource = app.slice(terminalRenderStart, app.indexOf("<AgentPanel", terminalRenderStart));
  const actionSource = app.slice(app.indexOf("function renameSelectedTerminalTabTitle"), app.indexOf("function submitRenameTerminalTabTitle"));

  assert.match(workspaceSource, /onRenameTerminalTab,/);
  assert.match(workspaceSource, /onDoubleClick=\{\(\) => onRenameTerminalTab\?\.\(tabId\)\}/);
  assert.match(renderSource, /onRenameTerminalTab=\{renameSelectedTerminalTabTitle\}/);
  assert.match(actionSource, /function renameSelectedTerminalTabTitle\(targetTabId = selectedTerminalTabId\)/);
  assert.match(actionSource, /const tab = findVisibleTerminalTab\(targetTabId\)/);
  assert.match(actionSource, /id:\s*tab\.id/);
});

test("terminal tab can be closed with the middle mouse button", () => {
  const workspaceSource = app.slice(app.indexOf("function TerminalWorkspace"), app.indexOf("function AgentPanel"));

  assert.match(workspaceSource, /onAuxClick=\{\(event\) => \{/);
  assert.match(workspaceSource, /if \(event\.button !== 1\) return/);
  assert.match(workspaceSource, /event\.preventDefault\(\)/);
  assert.match(workspaceSource, /onCloseTerminalTab\(tabId\)/);
});

test("terminal context menu can pin the current SSH tab", () => {
  const menuSource = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  const actionSource = app.slice(app.indexOf("function toggleSelectedTerminalTabPinned"), app.indexOf("function moveSelectedTerminalTab"));
  const closeSource = app.slice(app.indexOf("async function closeServerTab"), app.indexOf("function reopenLastClosedServerTab"));
  const workspaceSource = app.slice(app.indexOf("function TerminalWorkspace"), app.indexOf("function AgentPanel"));

  assert.match(app, /toggleTerminalTabPinned/);
  assert.match(actionSource, /toggleTerminalTabPinned\(visibleTerminalTabs,\s*tabId\)/);
  assert.match(actionSource, /saveTerminalTabs\(normalizeTerminalTabModels\(nextTabs,\s*serverNames\)\)/);
  assert.match(contextMenuActions, /id:\s*"toggle-pin-terminal-tab"/);
  assert.match(contextMenuActions, /isPinned \? "取消固定标签" : "固定标签"/);
  assert.match(menuSource, /"toggle-pin-terminal-tab":\s*\(\) => toggleSelectedTerminalTabPinned\(contextSessionKey\)/);
  assert.match(closeSource, /getTerminalTabCloseImpact\(sessionKey,\s*sshSessions,\s*name,\s*tab\)/);
  assert.match(closeSource, /if \(impact\.blocked\)/);
  assert.match(workspaceSource, /tab\.pinned \? <Pin/);
  assert.match(workspaceSource, /disabled=\{Boolean\(tab\.pinned\)\}/);
});
test("terminal context menu can close other or right side SSH tabs", () => {
  const menuSource = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  const actionSource = app.slice(app.indexOf("function requestCloseTerminalTabGroup"), app.indexOf("function openNextServerTab"));

  assert.match(app, /getClosableTerminalTabIds/);
  assert.match(app, /closeTerminalTabModels/);
  assert.match(app, /function confirmCloseTerminalTabGroup\(scope,\s*closableTabIds\)/);
  assert.match(actionSource, /function requestCloseTerminalTabGroup\(scope,\s*anchorTabId = selectedTerminalTabId\)/);
  assert.match(actionSource, /getClosableTerminalTabIds\(visibleTerminalTabs,\s*anchorTabId,\s*scope\)/);
  assert.doesNotMatch(actionSource, /window\.confirm/);
  assert.match(actionSource, /setPendingConfirmAction\(\{/);
  assert.match(actionSource, /title:\s*"关闭 SSH 标签"/);
  assert.match(actionSource, /onConfirm:\s*\(\) => confirmCloseTerminalTabGroup\(scope,\s*closableTabIds\)/);
  assert.match(actionSource, /for \(const tabId of closableTabIds \|\| \[\]\)/);
  assert.match(actionSource, /approvedTabIds\.push\(tabId\)/);
  assert.match(actionSource, /const closeState = closeTerminalTabModels\(visibleTerminalTabs,\s*approvedTabIds,\s*selectedTerminalTabId,\s*serverNames\)/);
  assert.match(actionSource, /saveTerminalTabs\(closeState\.tabs\)/);
  assert.match(actionSource, /setSelectedTerminalTabId\(closeState\.selectedTabId\)/);
  assert.match(actionSource, /setRecentlyClosedTerminalTabs/);
  assert.doesNotMatch(actionSource, /await closeServerTab\(tabId\)/);
  assert.match(actionSource, /showNotice\(scope === "right" \? "已关闭右侧未固定标签。" : "已关闭其他未固定标签。"\)/);
  assert.match(contextMenuActions, /id:\s*"close-other-terminal-tabs",\s*label:\s*"关闭其他标签"/);
  assert.match(menuSource, /"close-other-terminal-tabs":\s*\(\) => requestCloseTerminalTabGroup\("others",\s*contextSessionKey\)/);
  assert.match(contextMenuActions, /id:\s*"close-right-terminal-tabs",\s*label:\s*"关闭右侧标签"/);
  assert.match(menuSource, /"close-right-terminal-tabs":\s*\(\) => requestCloseTerminalTabGroup\("right",\s*contextSessionKey\)/);
});
test("terminal context menu can move SSH tabs left or right", () => {
  const menuSource = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  const actionSource = app.slice(app.indexOf("function moveSelectedTerminalTab"), app.indexOf("function requestCloseTerminalTabGroup"));

  assert.match(app, /moveTerminalTab/);
  assert.match(actionSource, /function moveSelectedTerminalTab\(direction,\s*targetTabId = selectedTerminalTabId\)/);
  assert.match(actionSource, /moveTerminalTab\(visibleTerminalTabs,\s*targetTabId,\s*direction\)/);
  assert.match(actionSource, /saveTerminalTabs\(nextTabs\)/);
  assert.match(menuSource, /"move-terminal-tab-left":\s*\(\) => moveSelectedTerminalTab\(-1,\s*contextSessionKey\)/);
  assert.match(menuSource, /"move-terminal-tab-right":\s*\(\) => moveSelectedTerminalTab\(1,\s*contextSessionKey\)/);
});
test("terminal context menu can close current and reopen closed SSH tabs", () => {
  const menuSource = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));

  assert.match(contextMenuActions, /id:\s*"close-current-terminal-tab",\s*label:\s*"关闭当前标签"/);
  assert.match(menuSource, /"close-current-terminal-tab":\s*\(\) => closeServerTab\(contextSessionKey\)/);
  assert.match(contextMenuActions, /id:\s*"reopen-closed-terminal-tab",\s*label:\s*"恢复关闭的标签"/);
  assert.match(contextMenuActions, /disabled:\s*!hasClosedTabs/);
  assert.match(menuSource, /"reopen-closed-terminal-tab":\s*\(\) => reopenLastClosedServerTab\(\)/);
});
test("closing a duplicated terminal tab disconnects only that tab session", () => {
  const source = app.slice(app.indexOf("async function closeServerTab"), app.indexOf("function openNextServerTab"));

  assert.match(source, /const sessionKey = tab\.id \|\| name/);
  assert.match(source, /getTerminalTabCloseImpact\(sessionKey,\s*sshSessions,\s*name,\s*tab\)/);
  assert.match(source, /setRecentlyClosedTerminalTabs\(\(current\) => \[tab,\s*\.\.\.current\.filter\(\(item\) => item\.id !== tab\.id\)\]\.slice\(0,\s*5\)\)/);
  assert.match(source, /await closeSessionByName\(name,\s*"关闭标签时断开 SSH 会话。",\s*\{ sessionKey \}\)/);
  assert.match(source, /setTerminalAppends\(\(current\) => withoutObjectKey\(current,\s*sessionKey\)\)/);
  assert.match(source, /delete terminalOpenLineRef\.current\[sessionKey\]/);
  assert.match(source, /setTerminalClearMarkers\(\(current\) => withoutObjectKey\(current,\s*sessionKey\)\)/);
  assert.doesNotMatch(source, /getTerminalTabCloseImpact\(name,\s*sshSessions\)/);
  assert.doesNotMatch(source, /await closeSessionByName\(name,\s*"关闭标签时断开 SSH 会话。"\)/);
});

test("terminal shortcut can reopen the most recently closed SSH tab", () => {
  const source = app.slice(app.indexOf("async function closeServerTab"), app.indexOf("function applyTerminalZoom"));

  assert.match(app, /const \[recentlyClosedTerminalTabs,\s*setRecentlyClosedTerminalTabs\] = useState\(\[\]\)/);
  assert.match(source, /function reopenLastClosedServerTab\(\)/);
  assert.match(source, /recentlyClosedTerminalTabs\.find\(\(tab\) => servers\[tab\.serverName\]\)/);
  assert.match(source, /normalizeTerminalTabModels\(\[\.\.\.visibleTerminalTabs,\s*tab\],\s*serverNames\)/);
  assert.match(source, /saveTerminalTabs\(normalizeTerminalTabModels\(nextTabs,\s*serverNames\)\)/);
  assert.match(source, /setSelectedTerminalTabId\(tab\.id\)/);
  assert.match(source, /setSelectedServer\(tab\.serverName\)/);
  assert.match(app, /action === "reopen-closed-tab"/);
  assert.match(app, /reopenLastClosedServerTab\(\)/);
});

test("selected terminal tab keeps its own SSH session and terminal output state", () => {
  const appStateSource = app.slice(app.indexOf("const visibleTerminalTabs = useMemo"), app.indexOf("const agentCapabilities = useMemo"));
  const workspaceRenderSource = app.slice(app.indexOf("<TerminalWorkspace"), app.indexOf("</div>", app.indexOf("<TerminalWorkspace")));
  const openSource = app.slice(app.indexOf("async function openSelectedSession"), app.indexOf("async function ensureCommandSession"));
  const appendSource = app.slice(app.indexOf("function appendTerminalLines"), app.indexOf("function readSelectedTerminalText"));
  const terminalWorkspaceSource = app.slice(app.indexOf("function TerminalWorkspace"), app.indexOf("function AgentPanel"));

  assert.match(appStateSource, /const selectedTerminalTab = useMemo/);
  assert.match(appStateSource, /selectedTerminalTabId/);
  assert.match(appStateSource, /const selectedTerminalSessionKey = selectedTerminalTab\?\.id \|\| selectedServer/);
  assert.match(appStateSource, /const selectedTerminalLines = useMemo/);
  assert.match(appStateSource, /terminalAppends\[selectedTerminalSessionKey\]/);
  assert.match(appStateSource, /terminalClearMarkers\[selectedTerminalSessionKey\]/);
  assert.match(app, /function resolveTerminalSessionKey\(targetName = selectedServer,\s*options = \{\}\)/);
  assert.match(app, /if \(options\.sessionKey\) return options\.sessionKey/);
  assert.match(workspaceRenderSource, /sessionState=\{sshSessions\[selectedTerminalSessionKey\] \|\| \{\}\}/);
  assert.match(workspaceRenderSource, /terminalLines=\{selectedTerminalLines\}/);
  assert.match(terminalWorkspaceSource, /terminalLines,/);
  assert.match(terminalWorkspaceSource, /buildTerminalSearchState\(terminalLines,/);
  assert.match(openSource, /const sessionKey = resolveTerminalSessionKey\(name,\s*options\)/);
  assert.match(openSource, /const existingSessionId = sshSessions\[sessionKey\]\?\.sessionId \|\| ""/);
  assert.match(openSource, /setSshSessions\(\(current\) => \(\{ \.\.\.current, \[sessionKey\]:/);
  assert.match(openSource, /appendTerminalLines\(name,[\s\S]{0,160}\{ terminalKey: sessionKey \}\)/);
  assert.match(appendSource, /function appendTerminalLines\(name,\s*lines,\s*options = \{\}\)/);
  assert.match(appendSource, /const terminalKey = options\.terminalKey \|\| name/);
  assert.match(appendSource, /current\[terminalKey\] \|\| \[\]/);
});

test("selected terminal tab keeps its own command draft and cursor state", () => {
  const appStateSource = app.slice(app.indexOf("const selectedTerminalSessionKey"), app.indexOf("const agentCapabilities = useMemo"));
  const keyDownSource = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function useCommandSnippet"));
  const pasteSource = app.slice(app.indexOf("async function pasteClipboardToCommandInput"), app.indexOf("function getSftpRemotePath"));
  const senderSource = app.slice(app.indexOf("async function sendSelectedCommand"), app.indexOf("\n  return (\n    <div", app.indexOf("async function sendSelectedCommand")));
  const sessionInputSource = app.slice(app.indexOf("async function sendSelectedSessionInput"), app.indexOf("async function sendSelectedCommand"));
  const workspaceRenderSource = app.slice(app.indexOf("<TerminalWorkspace"), app.indexOf("</div>", app.indexOf("<TerminalWorkspace")));

  assert.match(appStateSource, /const selectedCommandInputKey = selectedTerminalSessionKey/);
  assert.match(app, /function resolveCommandInputKey\(targetName = selectedServer,\s*options = \{\}\)/);
  assert.match(app, /if \(options\.commandInputKey\) return options\.commandInputKey/);
  assert.match(app, /return resolveTerminalSessionKey\(targetName,\s*options\)/);
  assert.match(workspaceRenderSource, /commandValue=\{commandInputs\[selectedCommandInputKey\] \|\| ""\}/);
  assert.match(workspaceRenderSource, /onCommandChange=\{\(value\) => updateCommandInput\(selectedCommandInputKey,\s*value\)\}/);
  assert.match(keyDownSource, /const inputKey = selectedCommandInputKey/);
  assert.match(app, /getTerminalShortcutAction\(event,\s*commandInputs\[selectedCommandInputKey\] \|\| ""\)/);
  assert.match(keyDownSource, /buildRunningSessionKeyInput\(event\.key,\s*commandInputs\[inputKey\] \|\| "",\s*event\)/);
  assert.match(keyDownSource, /historyCursors\[inputKey\] \|\| createHistoryCursor\(commandInputs\[inputKey\] \|\| ""\)/);
  assert.match(pasteSource, /const inputKey = selectedCommandInputKey/);
  assert.match(pasteSource, /const existing = commandInputs\[inputKey\] \|\| ""/);
  assert.match(pasteSource, /updateCommandInput\(inputKey,\s*pastePlan\.nextCommand\)/);
  assert.match(sessionInputSource, /const inputKey = resolveCommandInputKey\(name,\s*\{ sessionKey,\s*commandInputKey: inputCommandInputKey \}\)/);
  assert.match(sessionInputSource, /const text = inputText \?\? commandInputs\[inputKey\] \?\? ""/);
  assert.match(senderSource, /const commandInputKey = resolveCommandInputKey\(name,\s*\{ \.\.\.options,\s*sessionKey \}\)/);
  assert.match(senderSource, /const command = \(options\.command \?\? commandInputs\[commandInputKey\]\)\?\.trim\(\)/);
  assert.match(senderSource, /setCommandInputs\(\(current\) => \(\{ \.\.\.current,\s*\[commandInputKey\]: "" \}\)\)/);
});

test("terminal copy prefers selected terminal text before full output", () => {
  const source = app.slice(app.indexOf("function readSelectedTerminalText"), app.indexOf("function copyRecentTerminalOutput"));
  assert.match(app, /formatTerminalSelectionText/);
  assert.match(source, /window\.getSelection\?\.\(\)/);
  assert.match(source, /\.closest\?\.\("\.terminal-shell"\)/);
  assert.match(source, /formatTerminalSelectionText\(selection\.toString\(\)\)/);
  assert.match(source, /const selectedContent = limit \? "" : readSelectedTerminalText\(\)/);
  assert.match(source, /const content = selectedContent \|\| formatTerminalClipboardText\(terminalLines,\s*limit\)/);
});

test("terminal context menu can copy only selected terminal text", () => {
  const source = app.slice(app.indexOf("async function copySelectedTerminalTextOnly"), app.indexOf("function copyRecentTerminalOutput"));
  assert.match(app, /function readSelectedTerminalText\(\)/);
  assert.match(app, /async function copySelectedTerminalTextOnly\(\)/);
  assert.match(source, /const content = readSelectedTerminalText\(\)/);
  assert.match(source, /if \(!content\.trim\(\)\)/);
  assert.match(source, /navigator\.clipboard\.writeText\(content\)/);
  assert.match(source, /document\.execCommand\("copy"\)/);
  assert.match(app, /id:\s*"copy-selection"/);
  assert.match(app, /label:\s*"复制选中内容"/);
  assert.match(app, /onSelect:\s*copySelectedTerminalTextOnly/);
});

test("terminal context menu can copy the clicked terminal line", () => {
  const menuSource = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  const copySource = app.slice(app.indexOf("async function copyCurrentTerminalLine"), app.indexOf("function copyRecentTerminalOutput"));

  assert.match(app, /function getTerminalContextLineIndex\(event\)/);
  assert.match(app, /async function copyCurrentTerminalLine\(lineIndex\)/);
  assert.match(copySource, /formatTerminalClipboardText\(\[line\]\)/);
  assert.match(menuSource, /const terminalLineIndex = getTerminalContextLineIndex\(event\)/);
  assert.match(menuSource, /id:\s*"copy-current-line"/);
  assert.match(menuSource, /label:\s*"复制当前行"/);
  assert.match(menuSource, /disabled:\s*terminalLineIndex < 0/);
  assert.match(menuSource, /onSelect:\s*\(\) => copyCurrentTerminalLine\(terminalLineIndex\)/);
});

test("terminal context menu can reuse a clicked command line as the command draft", () => {
  const menuSource = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  const actionSource = app.slice(app.indexOf("function useTerminalLineCommand"), app.indexOf("async function exportSelectedTerminalOutput"));

  assert.match(app, /extractTerminalCommandFromLine/);
  assert.match(app, /function useTerminalLineCommand\(lineIndex\)/);
  assert.match(actionSource, /const command = extractTerminalCommandFromLine\(selectedTerminalLines\[Number\(lineIndex\)\]\)/);
  assert.match(actionSource, /updateCommandInput\(selectedCommandInputKey,\s*command\)/);
  assert.match(menuSource, /const terminalLineCommand = extractTerminalCommandFromLine\(selectedTerminalLines\[terminalLineIndex\]\)/);
  assert.match(menuSource, /id:\s*"use-current-line-command"/);
  assert.match(menuSource, /label:\s*"使用此行命令"/);
  assert.match(menuSource, /disabled:\s*!terminalLineCommand/);
  assert.match(menuSource, /onSelect:\s*\(\) => useTerminalLineCommand\(terminalLineIndex\)/);
});

test("terminal context menu can rerun a clicked command line", () => {
  const menuSource = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  const actionSource = app.slice(app.indexOf("async function rerunTerminalLineCommand"), app.indexOf("function saveTerminalLineCommandSnippet"));

  assert.match(app, /async function rerunTerminalLineCommand\(lineIndex\)/);
  assert.match(actionSource, /const command = extractTerminalCommandFromLine\(selectedTerminalLines\[Number\(lineIndex\)\]\)/);
  assert.match(actionSource, /await sendSelectedCommand\(null,\s*\{\s*targetName:\s*selectedServer,\s*command\s*\}\)/);
  assert.match(menuSource, /id:\s*"rerun-current-line-command"/);
  assert.match(menuSource, /label:\s*"重新执行此行命令"/);
  assert.match(menuSource, /disabled:\s*terminalSession\.busy \|\| !terminalLineCommand/);
  assert.match(menuSource, /onSelect:\s*\(\) => rerunTerminalLineCommand\(terminalLineIndex\)/);
});

test("terminal context menu can copy only the clicked command without the prompt", () => {
  const menuSource = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  const actionSource = app.slice(app.indexOf("async function copyTerminalLineCommand"), app.indexOf("function useTerminalLineCommand"));

  assert.match(app, /async function copyTerminalLineCommand\(lineIndex\)/);
  assert.match(actionSource, /const command = extractTerminalCommandFromLine\(selectedTerminalLines\[Number\(lineIndex\)\]\)/);
  assert.match(actionSource, /navigator\.clipboard\.writeText\(command\)/);
  assert.match(actionSource, /document\.execCommand\("copy"\)/);
  assert.match(menuSource, /id:\s*"copy-current-line-command"/);
  assert.match(menuSource, /label:\s*"复制此行命令"/);
  assert.match(menuSource, /disabled:\s*!terminalLineCommand/);
  assert.match(menuSource, /onSelect:\s*\(\) => copyTerminalLineCommand\(terminalLineIndex\)/);
});

test("terminal context menu can copy the clicked command output block", () => {
  const menuSource = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  const actionSource = app.slice(app.indexOf("async function copyTerminalLineCommandOutputBlock"), app.indexOf("function useTerminalLineCommand"));

  assert.match(app, /buildTerminalCommandOutputBlock/);
  assert.match(app, /async function copyTerminalLineCommandOutputBlock\(lineIndex\)/);
  assert.match(actionSource, /const block = buildTerminalCommandOutputBlock\(selectedTerminalLines,\s*Number\(lineIndex\)\)/);
  assert.match(actionSource, /const content = formatTerminalClipboardText\(block\)/);
  assert.match(actionSource, /navigator\.clipboard\.writeText\(content\)/);
  assert.match(actionSource, /document\.execCommand\("copy"\)/);
  assert.match(menuSource, /id:\s*"copy-current-line-command-output"/);
  assert.match(menuSource, /label:\s*"复制此命令输出块"/);
  assert.match(menuSource, /disabled:\s*!terminalLineCommand/);
  assert.match(menuSource, /onSelect:\s*\(\) => copyTerminalLineCommandOutputBlock\(terminalLineIndex\)/);
});

test("terminal context menu can export the clicked command output block", () => {
  const menuSource = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  const actionSource = app.slice(app.indexOf("async function exportTerminalLineCommandOutputBlock"), app.indexOf("function draftAgentTerminalAnalysis"));

  assert.match(app, /async function exportTerminalLineCommandOutputBlock\(lineIndex\)/);
  assert.match(actionSource, /const block = buildTerminalCommandOutputBlock\(selectedTerminalLines,\s*Number\(lineIndex\)\)/);
  assert.match(actionSource, /const content = buildTerminalExportText\(selectedServer,\s*block\)/);
  assert.match(actionSource, /const fileName = buildTerminalExportFileName\(selectedServer\)/);
  assert.match(actionSource, /await api\.save_text_file\(fileName,\s*content\)/);
  assert.match(actionSource, /link\.download = fileName/);
  assert.match(menuSource, /id:\s*"export-current-line-command-output"/);
  assert.match(menuSource, /label:\s*"导出此命令输出块"/);
  assert.match(menuSource, /disabled:\s*!terminalLineCommand/);
  assert.match(menuSource, /onSelect:\s*\(\) => exportTerminalLineCommandOutputBlock\(terminalLineIndex\)/);
});

test("terminal context menu can save a clicked command line as a custom snippet", () => {
  const menuSource = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  const actionSource = app.slice(app.indexOf("function saveTerminalLineCommandSnippet"), app.indexOf("async function copyTerminalLineCommand"));

  assert.match(app, /function saveTerminalLineCommandSnippet\(lineIndex\)/);
  assert.match(actionSource, /const command = extractTerminalCommandFromLine\(selectedTerminalLines\[Number\(lineIndex\)\]\)/);
  assert.match(actionSource, /addCustomCommandSnippet\(customCommandSnippets,\s*command\)/);
  assert.match(actionSource, /writeLocalJson\("sshAgentCustomCommandSnippets",\s*nextSnippets\)/);
  assert.match(menuSource, /id:\s*"save-current-line-command-snippet"/);
  assert.match(menuSource, /label:\s*"收藏此行命令"/);
  assert.match(menuSource, /disabled:\s*!terminalLineCommand/);
  assert.match(menuSource, /onSelect:\s*\(\) => saveTerminalLineCommandSnippet\(terminalLineIndex\)/);
});

test("terminal context menu disables copy selection when nothing is selected", () => {
  const source = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  assert.match(app, /function hasSelectedTerminalText\(\)/);
  assert.match(source, /const hasTerminalSelection = hasSelectedTerminalText\(\)/);
  assert.match(source, /id:\s*"copy-selection"[\s\S]{0,180}disabled:\s*!hasTerminalSelection/);
});

test("terminal right click copies selected output before opening the menu", () => {
  const source = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));

  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /const hasTerminalSelection = hasSelectedTerminalText\(\)/);
  assert.match(source, /if \(hasTerminalSelection\) \{\s*copySelectedTerminalTextOnly\(\);\s*return;\s*\}/);
  assert.ok(source.indexOf("if (hasTerminalSelection)") < source.indexOf("openContextMenu(event"));
  assert.match(app, /getContextMenuPosition/);
});

test("terminal context menu can scroll terminal output to top or bottom", () => {
  assert.match(app, /function scrollCurrentTerminalOutput\(position\)/);
  assert.match(app, /document\.querySelector\("\.terminal-shell \.terminal-output"\)/);
  assert.match(app, /position === "top"/);
  assert.match(app, /target\.scrollTop = 0/);
  assert.match(app, /target\.scrollTop = target\.scrollHeight/);
  assert.match(app, /id:\s*"scroll-output-top"/);
  assert.match(app, /label:\s*"滚动到顶部"/);
  assert.match(app, /onSelect:\s*\(\) => scrollCurrentTerminalOutput\("top"\)/);
  assert.match(app, /id:\s*"scroll-output-bottom"/);
  assert.match(app, /label:\s*"滚动到底部"/);
  assert.match(app, /onSelect:\s*\(\) => scrollCurrentTerminalOutput\("bottom"\)/);
});

test("terminal context menu can select all terminal output", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  assert.match(source, /className="terminal-output-region"/);
  assert.match(styles, /\.terminal-output-region/);
  assert.match(app, /function selectCurrentTerminalOutput\(\)/);
  assert.match(app, /document\.querySelector\("\.terminal-shell \.terminal-output-region"\)/);
  assert.match(app, /document\.createRange\(\)/);
  assert.match(app, /range\.selectNodeContents\(target\)/);
  assert.match(app, /selection\.removeAllRanges\(\)/);
  assert.match(app, /selection\.addRange\(range\)/);
  assert.match(app, /id:\s*"select-all-output"/);
  assert.match(app, /label:\s*"全选终端输出"/);
  assert.match(app, /onSelect:\s*selectCurrentTerminalOutput/);
});

test("terminal context menu can draft an Agent analysis from recent output", () => {
  const source = componentSource("AgentPanel", "PlanCard");
  assert.match(app, /agentDraftRequest/);
  assert.match(app, /function draftAgentTerminalAnalysis\(\)/);
  assert.match(app, /formatTerminalClipboardText\(selectedTerminalLines,\s*80\)/);
  assert.match(app, /请分析以下 SSH 终端最近输出/);
  assert.match(app, /setAgentDraftRequest\(\{/);
  assert.match(app, /id:\s*"agent-analyze-recent-output"/);
  assert.match(app, /label:\s*"让 Agent 分析最近输出"/);
  assert.match(app, /onSelect:\s*draftAgentTerminalAnalysis/);
  assert.match(app, /agentDraftRequest=\{agentDraftRequest\}/);
  assert.match(source, /agentDraftRequest/);
  assert.match(source, /setMessage\(\(current\) => \{/);
  assert.match(source, /agentInputRef\.current\?\.focus\(\)/);
});

test("terminal context menu can draft an Agent analysis from the clicked terminal line", () => {
  const menuSource = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  const actionSource = app.slice(app.indexOf("function draftAgentTerminalLineAnalysis"), app.indexOf("function draftAgentSftpPreviewAnalysis"));

  assert.match(app, /function draftAgentTerminalLineAnalysis\(lineIndex\)/);
  assert.match(actionSource, /const line = selectedTerminalLines\[Number\(lineIndex\)\]/);
  assert.match(actionSource, /formatTerminalClipboardText\(\[line\]\)/);
  assert.match(actionSource, /setAgentDraftRequest\(\{/);
  assert.match(actionSource, /SSH 终端当前行/);
  assert.match(menuSource, /id:\s*"agent-analyze-current-line"/);
  assert.match(menuSource, /label:\s*"让 Agent 分析当前行"/);
  assert.match(menuSource, /disabled:\s*terminalLineIndex < 0/);
  assert.match(menuSource, /onSelect:\s*\(\) => draftAgentTerminalLineAnalysis\(terminalLineIndex\)/);
});

test("terminal context menu can draft an Agent analysis from the clicked command output block", () => {
  const menuSource = app.slice(app.indexOf("function openTerminalContextMenu"), app.indexOf("function openSftpContextMenu"));
  const actionSource = app.slice(app.indexOf("function draftAgentTerminalCommandOutputAnalysis"), app.indexOf("function draftAgentSftpPreviewAnalysis"));

  assert.match(app, /function draftAgentTerminalCommandOutputAnalysis\(lineIndex\)/);
  assert.match(actionSource, /const block = buildTerminalCommandOutputBlock\(selectedTerminalLines,\s*Number\(lineIndex\)\)/);
  assert.match(actionSource, /const blockOutput = formatTerminalClipboardText\(block\)/);
  assert.match(actionSource, /setAgentDraftRequest\(\{/);
  assert.match(actionSource, /SSH 终端命令输出块/);
  assert.match(menuSource, /id:\s*"agent-analyze-command-output-block"/);
  assert.match(menuSource, /label:\s*"让 Agent 分析此命令输出块"/);
  assert.match(menuSource, /disabled:\s*!terminalLineCommand/);
  assert.match(menuSource, /onSelect:\s*\(\) => draftAgentTerminalCommandOutputAnalysis\(terminalLineIndex\)/);
});

test("server context menu can edit or hide builtin example servers", () => {
  assert.match(app, /hiddenBuiltinServers/);
  assert.match(app, /buildVisibleServerMap\(SERVER_DATA,\s*customServers,\s*hiddenBuiltinServers\)/);
  assert.match(app, /materializeBuiltinServerForEdit\(name\)/);
  assert.match(app, /hideBuiltinServer\(name\)/);
  assert.match(app, /copyServerSshCommand\(name\)/);
  assert.match(app, /copyServerConnectionInfo\(name\)/);
  assert.match(app, /copyServerTroubleshootingSummary\(name\)/);
  assert.match(app, /buildServerCopySshCommand\(name,\s*server\)/);
  assert.match(app, /buildServerCopyInfo\(name,\s*server\)/);
  assert.match(app, /buildServerTroubleshootingSummary\(name,\s*server\)/);
  assert.match(app, /async function exportServerProfile\(targetName = ""\)/);
  assert.match(app, /const profileServers = targetName \? \{ \[targetName\]: servers\[targetName\] \} : servers/);
  assert.match(app, /buildServerProfileMarkdown\(\{[\s\S]{0,160}servers:\s*profileServers/);
  assert.match(app, /export:\s*\(\) => exportServerProfile\(name\)/);
  assert.doesNotMatch(app, /id:\s*"edit"[\s\S]{0,180}disabled:\s*!customServers\[name\]/);
  assert.doesNotMatch(app, /id:\s*"delete"[\s\S]{0,180}disabled:\s*!customServers\[name\]/);
});

test("server context menu can copy a redacted SSH troubleshooting summary", () => {
  const source = app.slice(app.indexOf("function openServerContextMenu"), app.indexOf("function openTerminalContextMenu"));

  assert.match(app, /async function copyServerTroubleshootingSummary\(name = selectedServer\)/);
  assert.match(source, /"copy-troubleshooting-summary":\s*<FileSearch size=\{15\} \/>/);
  assert.match(source, /"copy-troubleshooting-summary":\s*\(\) => copyServerTroubleshootingSummary\(name\)/);
  assert.match(app, /await navigator\.clipboard\.writeText\(summary\)/);
  assert.doesNotMatch(app, /copyServerTroubleshootingSummary[\s\S]*credentialRef[\s\S]*writeText\(summary\)/);
});

test("server context menu can copy a single-server OpenSSH config snippet", () => {
  const source = app.slice(app.indexOf("function openServerContextMenu"), app.indexOf("function openTerminalContextMenu"));
  const actionSource = app.slice(app.indexOf("async function copyServerOpenSshConfig"), app.indexOf("async function copyServerTroubleshootingSummary"));

  assert.match(app, /async function copyServerOpenSshConfig\(name = selectedServer\)/);
  assert.match(actionSource, /buildOpenSshConfigExport\(\{ \[name\]: server \}/);
  assert.match(actionSource, /await navigator\.clipboard\.writeText\(config\)/);
  assert.doesNotMatch(actionSource, /credentialRef[\s\S]*writeText\(config\)/);
  assert.match(source, /"copy-openssh-config":\s*<FileText size=\{15\} \/>/);
  assert.match(source, /"copy-openssh-config":\s*\(\) => copyServerOpenSshConfig\(name\)/);
});

test("server context menu is driven by the shared action model without legacy unreachable branches", () => {
  const source = app.slice(app.indexOf("function openServerContextMenu"), app.indexOf("function openTerminalContextMenu"));

  assert.match(source, /buildServerContextActionModel\(name/);
  assert.match(source, /openContextMenu\(event/);
  assert.doesNotMatch(source, /return;\s*const isServerSessionConnected/);
  assert.doesNotMatch(source, /setContextMenu\(\{\s*x:\s*event\.clientX/);
});

test("server context menu can duplicate a server as a new connection", () => {
  const source = app.slice(app.indexOf("function openServerContextMenu"), app.indexOf("function openTerminalContextMenu"));
  const actionSource = app.slice(app.indexOf("function openDuplicateServerAsNewHost"), app.indexOf("function openServerContextMenu"));
  const modalSource = app.slice(app.indexOf("{newHostOpen &&"), app.indexOf("{editHostOpen &&"));

  assert.match(app, /const \[newHostInitialForm,\s*setNewHostInitialForm\] = useState\(null\)/);
  assert.match(actionSource, /const sourceForm = serverToHostForm\(name,\s*server\)/);
  assert.match(actionSource, /name:\s*buildDuplicateServerName\(name,\s*servers\)/);
  assert.match(actionSource, /credentialRef:\s*""/);
  assert.match(actionSource, /credentialSecret:\s*""/);
  assert.match(actionSource, /setNewHostInitialForm\(nextForm\)/);
  assert.match(actionSource, /setNewHostOpen\(true\)/);
  assert.match(source, /"duplicate-server-as-new-host":\s*<Plus size=\{15\} \/>/);
  assert.match(source, /"duplicate-server-as-new-host":\s*\(\) => openDuplicateServerAsNewHost\(name\)/);
  assert.match(modalSource, /initialForm=\{newHostInitialForm\}/);
});

test("server context menu can open credential auth center", () => {
  const source = app.slice(app.indexOf("function openServerContextMenu"), app.indexOf("function openTerminalContextMenu"));
  const actionSource = app.slice(app.indexOf("function openAuthCenter"), app.indexOf("function openEditHost"));

  assert.match(app, /function openAuthCenter\(targetName = selectedServer\)/);
  assert.match(actionSource, /setSelectedServer\(name\)/);
  assert.match(actionSource, /setAuthCenterOpen\(true\)/);
  assert.match(source, /"server-auth-center":\s*<Lock size=\{15\} \/>/);
  assert.match(source, /"server-auth-center":\s*\(\) => openAuthCenter\(name\)/);
});

test("server context menu can pin or unpin a custom server", () => {
  const source = app.slice(app.indexOf("function openServerContextMenu"), app.indexOf("function openTerminalContextMenu"));

  assert.match(source, /"toggle-server-favorite":\s*<Pin size=\{15\} \/>/);
  assert.match(source, /"toggle-server-favorite":\s*\(\) => toggleServerFavorite\(name,\s*!Boolean\(servers\[name\]\?\.isFavorite\)\)/);
});

test("server context menu exposes active SSH session controls", () => {
  const source = app.slice(app.indexOf("function openServerContextMenu"), app.indexOf("function openTerminalContextMenu"));

  assert.match(source, /const terminalSession = sshSessions\[name\] \|\| \{\}/);
  assert.match(source, /buildServerContextActionModel\(name/);
  assert.match(source, /session:\s*terminalSession/);
  assert.match(source, /connect:\s*\(\) => openSelectedSession\(name\)/);
  assert.match(source, /"interrupt-server-command":\s*\(\) => stopSelectedCommand\(name\)/);
  assert.match(source, /"reconnect-server-session":\s*\(\) => reconnectSelectedSession\(name\)/);
  assert.match(source, /"disconnect-server-session":\s*\(\) => closeSelectedSession\(name\)/);
  assert.match(app, /async function stopSelectedCommand\(targetName = selectedServer\)/);
});

test("server context menu can open session logs filtered to that server", () => {
  const source = app.slice(app.indexOf("function openServerContextMenu"), app.indexOf("function openTerminalContextMenu"));

  assert.match(app, /async function openSessionLogs\(initialFilters = \{\}\)/);
  assert.match(source, /"server-session-logs":\s*<FileText size=\{15\} \/>/);
  assert.match(source, /"server-session-logs":\s*\(\) => openSessionLogs\(\{ server:\s*name \}\)/);
});

test("server context menu can open tool logs filtered to that server", () => {
  const source = app.slice(app.indexOf("function openServerContextMenu"), app.indexOf("function openTerminalContextMenu"));

  assert.match(app, /async function openToolLogs\(nextFilters = null\)/);
  assert.match(source, /"server-tool-logs":\s*<FileText size=\{15\} \/>/);
  assert.match(source, /"server-tool-logs":\s*\(\) => openToolLogs\(\{ query:\s*name \}\)/);
});

test("server context menu can export a diagnostic package", () => {
  const source = app.slice(app.indexOf("function openServerContextMenu"), app.indexOf("function openTerminalContextMenu"));

  assert.match(app, /async function exportDiagnosticPackage\(\)/);
  assert.match(source, /"server-diagnostic-package":\s*<FileSearch size=\{15\} \/>/);
  assert.match(source, /"server-diagnostic-package":\s*exportDiagnosticPackage/);
});

test("server context menu can open an encrypted backup flow for one server", () => {
  const source = app.slice(app.indexOf("function openServerContextMenu"), app.indexOf("function openSftpContextMenu"));
  const renderSource = app.slice(app.indexOf("{backupOpen &&"), app.indexOf("{backupImportDraft &&"));

  assert.match(app, /const \[backupServerName,\s*setBackupServerName\] = useState\(""\)/);
  assert.match(app, /function openServerBackup\(name = selectedServer\)/);
  assert.match(app, /setBackupServerName\(targetName\)/);
  assert.match(app, /setBackupOpen\(true\)/);
  assert.match(source, /"backup-server":\s*\(\) => openServerBackup\(targetName\)/);
  assert.match(renderSource, /servers=\{backupServerName && servers\[backupServerName\] \? \{ \[backupServerName\]: servers\[backupServerName\] \} : servers\}/);
  assert.match(renderSource, /scopeLabel=\{backupServerName \? `单台服务器：\$\{backupServerName\}` : ""\}/);
});

test("server context menu can open another SSH terminal tab", () => {
  const source = app.slice(app.indexOf("function openServerContextMenu"), app.indexOf("function openTerminalContextMenu"));

  assert.match(source, /"open-server-new-terminal-tab":\s*<Plus size=\{15\} \/>/);
  assert.match(source, /"open-server-new-terminal-tab":\s*\(\) => openDuplicateSelectedTerminalTab\(name\)/);
});

test("server context menu can connect in a fresh SSH terminal tab", () => {
  const menuSource = app.slice(app.indexOf("function openServerContextMenu"), app.indexOf("function openTerminalContextMenu"));
  const actionSource = app.slice(app.indexOf("async function openAndConnectServerInNewTerminalTab"), app.indexOf("function closeContextMenu"));

  assert.match(actionSource, /createDuplicateTerminalTab\(visibleTerminalTabs,\s*name,\s*serverNames\)/);
  assert.match(actionSource, /saveTerminalTabs\(result\.tabs\)/);
  assert.match(actionSource, /setSelectedTerminalTabId\(result\.selectedTabId\)/);
  assert.match(actionSource, /setSelectedServer\(name\)/);
  assert.match(actionSource, /await openSelectedSession\(name,\s*\{ sessionKey:\s*result\.selectedTabId \}\)/);
  assert.match(menuSource, /"connect-server-new-terminal-tab":\s*<TerminalSquare size=\{15\} \/>/);
  assert.match(menuSource, /"connect-server-new-terminal-tab":\s*\(\) => openAndConnectServerInNewTerminalTab\(name\)/);
  assert.match(menuSource, /buildServerContextActionModel\(name/);
});

test("SFTP file browser exposes desktop context menu actions", () => {
  const source = componentSource("Sidebar", "TerminalWorkspace");
  const mkdirSource = app.slice(app.indexOf("async function createSelectedSftpDirectory"), app.indexOf("async function renameSelectedSftpItem"));
  const renameSource = app.slice(app.indexOf("async function renameSelectedSftpItem"), app.indexOf("async function deleteSelectedSftpItem"));
  const deleteSource = app.slice(app.indexOf("async function deleteSelectedSftpItem"), app.indexOf("function dismissSelectedSessionRecovery"));
  const copyPathSource = app.slice(app.indexOf("async function copySftpRemotePath"), app.indexOf("async function copySftpItemName"));
  const copyNameSource = app.slice(app.indexOf("async function copySftpItemName"), app.indexOf("async function copySftpTerminalCommand"));
  assert.match(source, /onOpenSftpContextMenu/);
  assert.match(source, /onContextMenu=\{\(event\) => onOpenSftpContextMenu\(event, item\)\}/);
  assert.match(app, /openSftpContextMenu/);
  assert.match(app, /previewSelectedSftpFile\(file\)/);
  assert.match(app, /downloadSelectedSftp\(file\)/);
  assert.match(app, /copySftpRemotePath/);
  assert.match(app, /"copy-sftp-path":\s*\(\) => copySftpRemotePath\(file\)/);
  assert.match(copyPathSource, /copyTextToClipboard\(remotePath,\s*`SFTP 路径已复制：\$\{remotePath\}`\)/);
  assert.doesNotMatch(copyPathSource, /navigator\.clipboard/);
  assert.match(app, /copySftpItemName/);
  assert.match(app, /复制名称/);
  assert.match(copyNameSource, /copyTextToClipboard\(item\.name,\s*`已复制文件名：\$\{item\.name\}`\)/);
  assert.doesNotMatch(copyNameSource, /navigator\.clipboard/);
  assert.match(app, /insertSftpPathToCommandInput/);
  assert.match(app, /插入到命令行/);
  assert.match(app, /quoteSftpPathForShell/);
  assert.match(app, /updateCommandInput\(selectedCommandInputKey,\s*quoteSftpPathForShell\(getSftpRemotePath\(file\)\)\)/);
  assert.match(app, /buildSftpTerminalCommand/);
  assert.match(app, /insertSftpCommandToCommandInput/);
  assert.match(app, /copySftpTerminalCommand/);
  assert.match(app, /tail -n 200/);
  assert.match(app, /ls -lah/);
  assert.match(app, /renameSelectedSftpItem\(file\)/);
  assert.match(app, /deleteSelectedSftpItem\(file\)/);
  assert.match(app, /createSelectedSftpFile/);
  assert.match(app, /createSelectedSftpDirectory/);
  assert.doesNotMatch(mkdirSource, /window\.prompt/);
  assert.doesNotMatch(renameSource, /window\.prompt/);
  assert.doesNotMatch(deleteSource, /window\.confirm/);
  assert.match(mkdirSource, /setSftpNameDialog\(\{/);
  assert.match(renameSource, /setSftpNameDialog\(\{/);
  assert.match(deleteSource, /setSftpDeleteDialog\(\{/);
  assert.match(app, /function SftpNameModal/);
  assert.match(app, /function SftpDeleteConfirmModal/);
  assert.match(app, /sftpNameDialog/);
  assert.match(app, /sftpDeleteDialog/);
  assert.match(app, /submitSftpNameDialog/);
  assert.match(app, /submitSftpDeleteDialog/);
  assert.match(app, /<SftpNameModal/);
  assert.match(app, /<SftpDeleteConfirmModal/);
  assert.match(app, /refreshSelectedSftp\(\)/);
  assert.match(app, /goSelectedSftpParent/);
  assert.match(app, /上级目录/);
  assert.match(app, /parent:\s*\(\) => goSelectedSftpParent\(\)/);
  assert.match(app, /buildSftpContextActionModel\(\{/);
});

test("SFTP context menu can copy terminal commands without touching a running SSH input", () => {
  const source = app.slice(app.indexOf("function openSftpContextMenu"), app.indexOf("function cancelAgentTask"));
  const copySource = app.slice(app.indexOf("async function copySftpTerminalCommand"), app.indexOf("function insertSftpPathToCommandInput"));

  assert.match(app, /async function copySftpTerminalCommand\(action,\s*file = null\)/);
  assert.match(copySource, /const remotePath = getSftpTerminalCommandPath\(action,\s*file\)/);
  assert.match(copySource, /buildSftpTerminalCommand\(action,\s*remotePath\)/);
  assert.match(copySource, /copyTextToClipboard\(command,\s*`SSH 命令已复制：\$\{command\}`\)/);
  assert.doesNotMatch(copySource, /navigator\.clipboard\.writeText\(command\)/);
  assert.match(source, /id:\s*"copy-list-command"/);
  assert.match(source, /label:\s*"复制 ls -lah"/);
  assert.match(source, /onSelect:\s*\(\) => copySftpTerminalCommand\("list",\s*file\)/);
  assert.match(source, /id:\s*"copy-cd-command"/);
  assert.match(source, /onSelect:\s*\(\) => copySftpTerminalCommand\("cd",\s*file\)/);
  assert.match(source, /id:\s*"copy-tail-command"/);
  assert.match(source, /onSelect:\s*\(\) => copySftpTerminalCommand\("tail",\s*file\)/);
  assert.match(source, /id:\s*"copy-cat-command"/);
  assert.match(source, /onSelect:\s*\(\) => copySftpTerminalCommand\("cat",\s*file\)/);
});

test("SFTP cd terminal commands target a file's containing folder", () => {
  const helperSource = app.slice(app.indexOf("function getSftpTerminalCommandPath"), app.indexOf("async function copySftpTerminalCommand"));
  const insertSource = app.slice(app.indexOf("function insertSftpCommandToCommandInput"), app.indexOf("async function executeSftpCommandInTerminal"));
  const executeSource = app.slice(app.indexOf("async function executeSftpCommandInTerminal"), app.indexOf("function closeContextMenu"));

  assert.match(app, /function getSftpTerminalCommandPath\(action,\s*file = null\)/);
  assert.match(helperSource, /const remotePath = getSftpRemotePath\(file\)/);
  assert.match(helperSource, /if \(action === "cd" && file && file\.type !== "folder"\) return getParentSftpPath\(remotePath\)/);
  assert.match(insertSource, /buildSftpTerminalCommand\(action,\s*getSftpTerminalCommandPath\(action,\s*file\)\)/);
  assert.match(executeSource, /buildSftpTerminalCommand\(action,\s*getSftpTerminalCommandPath\(action,\s*file\)\)/);
});

test("SFTP context menu can execute common file commands in the active SSH terminal", () => {
  const source = app.slice(app.indexOf("function openSftpContextMenu"), app.indexOf("function cancelAgentTask"));
  const executeSource = app.slice(app.indexOf("async function executeSftpCommandInTerminal"), app.indexOf("function openSftpContextMenu"));

  assert.match(app, /async function executeSftpCommandInTerminal\(action,\s*file = null\)/);
  assert.match(executeSource, /const command = buildSftpTerminalCommand\(action,\s*getSftpTerminalCommandPath\(action,\s*file\)\)/);
  assert.match(executeSource, /await sendSelectedCommand\(null,\s*\{ command,\s*targetName:\s*selectedServer \}\)/);
  assert.match(source, /id:\s*"execute-list-command"/);
  assert.match(source, /label:\s*"执行 ls -lah"/);
  assert.match(source, /onSelect:\s*\(\) => executeSftpCommandInTerminal\("list",\s*file\)/);
  assert.match(source, /id:\s*"execute-cd-command"/);
  assert.match(source, /onSelect:\s*\(\) => executeSftpCommandInTerminal\("cd",\s*file\)/);
  assert.match(source, /id:\s*"execute-tail-command"/);
  assert.match(source, /onSelect:\s*\(\) => executeSftpCommandInTerminal\("tail",\s*file\)/);
  assert.match(source, /id:\s*"execute-cat-command"/);
  assert.match(source, /onSelect:\s*\(\) => executeSftpCommandInTerminal\("cat",\s*file\)/);
  assert.match(source, /id:\s*"execute-tail-command"[\s\S]{0,160}disabled:\s*disableSftpTerminalExecute \|\| file\?\.type === "folder"/);
  assert.match(source, /id:\s*"execute-cat-command"[\s\S]{0,160}disabled:\s*disableSftpTerminalExecute \|\| file\?\.type === "folder"/);
});

test("SFTP context menu disables direct terminal execution while the active SSH program is busy", () => {
  const source = app.slice(app.indexOf("function openSftpContextMenu"), app.indexOf("function recordTerminalControlSignalResult"));

  assert.match(source, /const selectedSshSession = sshSessions\[selectedTerminalSessionKey\] \|\| \{\}/);
  assert.match(source, /const disableSftpTerminalExecute = Boolean\(selectedSshSession\.busy\)/);
  assert.match(source, /id:\s*"execute-list-command"[\s\S]{0,140}disabled:\s*disableSftpTerminalExecute/);
  assert.match(source, /id:\s*"execute-cd-command"[\s\S]{0,140}disabled:\s*disableSftpTerminalExecute/);
  assert.match(source, /id:\s*"execute-tail-command"[\s\S]{0,160}disabled:\s*disableSftpTerminalExecute \|\| file\?\.type === "folder"/);
  assert.match(source, /id:\s*"execute-cat-command"[\s\S]{0,160}disabled:\s*disableSftpTerminalExecute \|\| file\?\.type === "folder"/);
  assert.doesNotMatch(source, /id:\s*"copy-tail-command"[\s\S]{0,120}disableSftpTerminalExecute/);
  assert.doesNotMatch(source, /id:\s*"insert-tail-command"[\s\S]{0,120}disableSftpTerminalExecute/);
});

test("SFTP context menu removes trailing advanced separators", () => {
  const source = app.slice(app.indexOf("function openSftpContextMenu"), app.indexOf("function cancelAgentTask"));

  assert.match(source, /items:\s*mergeContextMenuItems\(/);
  assert.match(source, /advancedItems/);
});

test("SFTP upload and download failures are written to session logs", () => {
  const uploadSource = app.slice(app.indexOf("async function uploadSelectedSftp"), app.indexOf("async function downloadSelectedSftp"));
  const downloadSource = app.slice(app.indexOf("async function downloadSelectedSftp"), app.indexOf("async function previewSelectedSftpFile"));

  assert.match(uploadSource, /type:\s*"sftp_upload_failed"/);
  assert.match(uploadSource, /status:\s*"failed"/);
  assert.match(uploadSource, /writeSessionLogEvent/);
  assert.match(downloadSource, /type:\s*"sftp_download_failed"/);
  assert.match(downloadSource, /status:\s*"failed"/);
  assert.match(downloadSource, /writeSessionLogEvent/);
});

test("SFTP upload and download success are written to session logs", () => {
  const uploadSource = app.slice(app.indexOf("async function uploadSelectedSftp"), app.indexOf("async function downloadSelectedSftp"));
  const downloadSource = app.slice(app.indexOf("async function downloadSelectedSftp"), app.indexOf("async function previewSelectedSftpFile"));

  assert.match(uploadSource, /writeSessionLogEvent\(\{ type:\s*"sftp_upload"/);
  assert.match(uploadSource, /status:\s*"ok"/);
  assert.match(downloadSource, /writeSessionLogEvent\(\{ type:\s*"sftp_download"/);
  assert.match(downloadSource, /status:\s*"ok"/);
});

test("SFTP panel shows the latest transfer result for upload and download", () => {
  const sidebarSource = componentSource("Sidebar", "TerminalWorkspace");
  const uploadSource = app.slice(app.indexOf("async function uploadSelectedSftp"), app.indexOf("async function downloadSelectedSftp"));
  const downloadSource = app.slice(app.indexOf("async function downloadSelectedSftp"), app.indexOf("async function previewSelectedSftpFile"));
  const renderSource = app.slice(app.indexOf("<Sidebar"), app.indexOf("<TerminalWorkspace"));

  assert.match(app, /recentSftpOperations/);
  assert.match(renderSource, /recentSftpOperation=\{recentSftpOperations\[selectedServer\]\}/);
  assert.match(sidebarSource, /recentSftpOperation/);
  assert.match(sidebarSource, /className=\{`sftp-operation-status \$\{recentSftpOperation\.status\}`\}/);
  assert.match(sidebarSource, /最近操作/);
  assert.match(sidebarSource, /title=\{recentSftpOperation\.remotePath \|\| recentSftpOperation\.localPath\}/);
  assert.match(uploadSource, /setRecentSftpOperations/);
  assert.match(uploadSource, /type:\s*"upload"/);
  assert.match(downloadSource, /setRecentSftpOperations/);
  assert.match(downloadSource, /type:\s*"download"/);
  assert.match(cssRule(".sftp-operation-status"), /font-size:\s*11px/);
  assert.match(cssRule(".sftp-operation-status small"), /text-overflow:\s*ellipsis/);
}
);

test("SFTP upload and download show a running transfer status before backend work", () => {
  const uploadSource = app.slice(app.indexOf("async function uploadSelectedSftp"), app.indexOf("async function downloadSelectedSftp"));
  const downloadSource = app.slice(app.indexOf("async function downloadSelectedSftp"), app.indexOf("async function previewSelectedSftpFile"));

  assert.match(uploadSource, /status:\s*"running"/);
  assert.match(uploadSource, /label:\s*"上传中"/);
  assert.ok(uploadSource.indexOf('status: "running"') < uploadSource.indexOf("api.upload_sftp_file"));
  assert.match(downloadSource, /status:\s*"running"/);
  assert.match(downloadSource, /label:\s*"下载中"/);
  assert.ok(downloadSource.indexOf('status: "running"') < downloadSource.indexOf("api.download_sftp_file"));
  assert.match(cssRule(".sftp-operation-status.running"), /background:\s*#f0f7ff/);
});

test("SFTP running transfer card exposes a cancel action", () => {
  const sidebarSource = componentSource("Sidebar", "TerminalWorkspace");
  const renderSource = app.slice(app.indexOf("<Sidebar"), app.indexOf("<TerminalWorkspace"));

  assert.match(sidebarSource, /onCancelSftpOperation/);
  assert.match(sidebarSource, /recentSftpOperation\.status === "running"/);
  assert.match(sidebarSource, /取消传输/);
  assert.match(renderSource, /onCancelSftpOperation=\{cancelSftpOperation\}/);
});

test("SFTP download prefers cancellable desktop transfer jobs when available", () => {
  const downloadSource = app.slice(app.indexOf("async function downloadSelectedSftp"), app.indexOf("async function previewSelectedSftpFile"));

  assert.match(downloadSource, /api\?\.start_sftp_download_job/);
  assert.match(downloadSource, /api\?\.get_sftp_transfer_job/);
  assert.match(downloadSource, /await pollSftpTransferJob/);
  assert.match(downloadSource, /jobId:\s*job\.id/);
});

test("SFTP upload prefers cancellable desktop transfer jobs when available", () => {
  const uploadSource = app.slice(app.indexOf("async function uploadSelectedSftp"), app.indexOf("async function downloadSelectedSftp"));

  assert.match(uploadSource, /api\?\.start_sftp_upload_job/);
  assert.match(uploadSource, /api\?\.get_sftp_transfer_job/);
  assert.match(uploadSource, /await pollSftpTransferJob/);
  assert.match(uploadSource, /jobId:\s*job\.id/);
});

test("SFTP preview shows running and result states in the operation card", () => {
  const previewSource = app.slice(app.indexOf("async function previewSelectedSftpFile"), app.indexOf("async function createSelectedSftpDirectory"));

  assert.match(previewSource, /setRecentSftpOperations/);
  assert.match(previewSource, /type:\s*"preview"/);
  assert.match(previewSource, /status:\s*"running"/);
  assert.ok(previewSource.indexOf('status: "running"') < previewSource.indexOf("api.read_sftp_text_file"));
  assert.match(previewSource, /status:\s*"ok"/);
  assert.match(previewSource, /status:\s*"failed"/);
});

test("SFTP text preview can be edited and saved back to the remote file", () => {
  const sidebarSource = componentSource("Sidebar", "TerminalWorkspace");
  const saveSource = app.slice(app.indexOf("async function saveSftpPreviewText"), app.indexOf("async function createSelectedSftpDirectory"));
  const renderSource = app.slice(app.indexOf("<Sidebar"), app.indexOf("<TerminalWorkspace"));

  assert.match(sidebarSource, /sftpPreviewDraft/);
  assert.match(sidebarSource, /onSftpPreviewDraftChange/);
  assert.match(sidebarSource, /onSaveSftpPreviewText/);
  assert.match(sidebarSource, /<textarea/);
  assert.match(sidebarSource, /aria-label="编辑 SFTP 预览内容"/);
  assert.match(sidebarSource, /保存文件/);
  assert.match(saveSource, /api\.write_sftp_text_file/);
  assert.match(saveSource, /type:\s*"sftp_write_text"/);
  assert.match(saveSource, /type:\s*"sftp_write_text_failed"/);
  assert.match(renderSource, /onSaveSftpPreviewText=\{saveSftpPreviewText\}/);
});

test("SFTP recent operation can be copied for troubleshooting", () => {
  const sidebarSource = componentSource("Sidebar", "TerminalWorkspace");
  const renderSource = app.slice(app.indexOf("<Sidebar"), app.indexOf("<TerminalWorkspace"));
  const actionSource = app.slice(app.indexOf("async function copyRecentSftpOperation"), app.indexOf("async function uploadSelectedSftp"));

  assert.match(sidebarSource, /onCopyRecentSftpOperation/);
  assert.match(sidebarSource, /className="sftp-operation-copy"/);
  assert.match(sidebarSource, /onCopyRecentSftpOperation\?\.\(recentSftpOperation\)/);
  assert.match(sidebarSource, /onClick=\{\(\) => onCopyRecentSftpOperation\?\.\(recentSftpOperation\)\}/);
  assert.match(renderSource, /onCopyRecentSftpOperation=\{copyRecentSftpOperation\}/);
  assert.match(app, /async function copyRecentSftpOperation\(operation\)/);
  assert.match(actionSource, /copyTextToClipboard\(text,\s*"SFTP 操作信息已复制"\)/);
  assert.doesNotMatch(actionSource, /navigator\.clipboard/);
  assert.match(cssRule(".sftp-operation-copy"), /white-space:\s*nowrap/);
});

test("SFTP write operations record success and failure details in session logs", () => {
  const nameDialogSource = app.slice(app.indexOf("async function submitSftpNameDialog"), app.indexOf("async function renameSelectedSftpItem"));
  const deleteDialogSource = app.slice(app.indexOf("async function submitSftpDeleteDialog"), app.indexOf("function dismissSelectedSessionRecovery"));

  assert.match(nameDialogSource, /type:\s*"sftp_mkdir_failed"/);
  assert.match(nameDialogSource, /type:\s*"sftp_create_file_failed"/);
  assert.match(nameDialogSource, /type:\s*"sftp_rename_failed"/);
  assert.match(nameDialogSource, /context:\s*\{ remotePath/);
  assert.match(nameDialogSource, /context:\s*\{ parentPath/);
  assert.match(deleteDialogSource, /type:\s*"sftp_delete_failed"/);
  assert.match(deleteDialogSource, /context:\s*\{ remotePath,\s*itemType:\s*file\.type \}/);
});

test("SFTP write operations show running and result states in the operation card", () => {
  const nameDialogSource = app.slice(app.indexOf("async function submitSftpNameDialog"), app.indexOf("async function renameSelectedSftpItem"));
  const deleteDialogSource = app.slice(app.indexOf("async function submitSftpDeleteDialog"), app.indexOf("function dismissSelectedSessionRecovery"));

  assert.match(nameDialogSource, /setRecentSftpOperations/);
  assert.match(nameDialogSource, /type:\s*dialog\.mode/);
  assert.match(nameDialogSource, /status:\s*"running"/);
  assert.ok(nameDialogSource.indexOf('status: "running"') < nameDialogSource.indexOf("api.create_sftp_directory"));
  assert.match(nameDialogSource, /api\.create_sftp_file/);
  assert.match(nameDialogSource, /type:\s*"mkdir"/);
  assert.match(nameDialogSource, /type:\s*"create-file"/);
  assert.match(nameDialogSource, /type:\s*"rename"/);
  assert.match(nameDialogSource, /status:\s*"ok"/);
  assert.match(nameDialogSource, /status:\s*"failed"/);
  assert.match(deleteDialogSource, /setRecentSftpOperations/);
  assert.match(deleteDialogSource, /type:\s*"delete"/);
  assert.match(deleteDialogSource, /status:\s*"running"/);
  assert.ok(deleteDialogSource.indexOf('status: "running"') < deleteDialogSource.indexOf("api.delete_sftp_path"));
  assert.match(deleteDialogSource, /status:\s*"ok"/);
  assert.match(deleteDialogSource, /status:\s*"failed"/);
});

test("SFTP read failures are written to session logs with remote path context", () => {
  const listSource = app.slice(app.indexOf("async function refreshSelectedSftp"), app.indexOf("async function openSelectedSftpFolder"));
  const previewSource = app.slice(app.indexOf("async function previewSelectedSftpFile"), app.indexOf("async function createSelectedSftpDirectory"));

  assert.match(listSource, /type:\s*"sftp_list_failed"/);
  assert.match(listSource, /context:\s*\{ remotePath \}/);
  assert.match(previewSource, /type:\s*"sftp_preview_failed"/);
  assert.match(previewSource, /context:\s*\{ remotePath \}/);
});

test("SFTP directory refresh shows running and result states in the operation card", () => {
  const listSource = app.slice(app.indexOf("async function refreshSelectedSftp"), app.indexOf("async function openSelectedSftpFolder"));

  assert.match(listSource, /setRecentSftpOperations/);
  assert.match(listSource, /type:\s*"list"/);
  assert.match(listSource, /status:\s*"running"/);
  assert.ok(listSource.indexOf('status: "running"') < listSource.indexOf("api.list_sftp_directory"));
  assert.match(listSource, /status:\s*"ok"/);
  assert.match(listSource, /status:\s*"failed"/);
  assert.match(listSource, /label:\s*"目录已刷新"/);
  assert.match(listSource, /label:\s*"读取失败"/);
});

test("SFTP context menu can draft an Agent analysis from the preview", () => {
  assert.match(app, /function draftAgentSftpPreviewAnalysis\(file = null\)/);
  assert.match(app, /sftpPreview\?\.content/);
  assert.match(app, /请分析以下 SFTP 文件预览内容/);
  assert.match(app, /sftpPreview\.content/);
  assert.match(app, /setAgentDraftRequest\(\{/);
  assert.match(contextMenuActions, /id:\s*"agent-analyze-sftp-preview"/);
  assert.match(contextMenuActions, /label:\s*"让 Agent 分析文件"/);
  assert.match(app, /"agent-analyze-sftp-preview":\s*\(\) => draftAgentSftpPreviewAnalysis\(file\)/);
});

test("SFTP Agent analysis refuses stale preview content for a different file", () => {
  assert.match(app, /const requestedRemotePath = getSftpRemotePath\(file\)/);
  assert.match(app, /const previewRemotePath = sftpPreview\?\.remotePath \|\| sftpPreview\?\.path \|\| ""/);
  assert.match(app, /normalizeSftpPath\(previewRemotePath\) !== normalizeSftpPath\(requestedRemotePath\)/);
  assert.match(app, /请先预览当前文件/);
  assert.match(app, /return;\s*}\s*const targetName/);
  assert.match(app, /setSftpPreview\(\{ \.\.\.result, remotePath \}\)/);
});

test("SFTP file browser supports double click open and preview", () => {
  const source = componentSource("Sidebar", "TerminalWorkspace");
  assert.match(source, /onDoubleClick=\{\(\) => \(item\.type === "folder" \? onOpenSftpFolder\(item\) : onPreviewSftpFile\(item\)\)\}/);
  assert.match(source, /onClick=\{\(\) => \(item\.type === "folder" \? onOpenSftpFolder\(item\) : onSelectFile\(item\)\)\}/);
});

test("SFTP file browser Enter opens folders or previews files without changing Space selection", () => {
  const source = componentSource("Sidebar", "TerminalWorkspace");

  assert.match(source, /function handleSftpFileKeyDown\(event,\s*item\)/);
  assert.match(source, /if \(event\.key !== "Enter"\) return/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /item\.type === "folder" \? onOpenSftpFolder\?\.\(item\) : onPreviewSftpFile\?\.\(item\)/);
  assert.match(source, /onKeyDown=\{\(event\) => handleSftpFileKeyDown\(event,\s*item\)\}/);
  assert.doesNotMatch(source, /event\.key === " "/);
  assert.doesNotMatch(source, /event\.key === "Space"/);
});

test("NewHostModal can test real SSH login before saving", () => {
  const source = componentSource("NewHostModal", "App");
  assert.match(source, /onTestConnection/);
  assert.match(source, /hostTestStatus/);
  assert.match(source, /testingHostConnection/);
  assert.match(source, /testHostBeforeSave/);
  assert.match(source, /await onTestConnection\?\.\(form\)/);
  assert.match(source, /保存前测试/);
  assert.match(source, /连接测试通过/);
  assert.match(source, /连接测试失败/);
  assert.match(source, /disabled=\{testingHostConnection/);
  assert.match(app, /testHostFormConnection/);
  assert.match(app, /api\?\.test_ssh_login/);
  assert.match(app, /api\.test_ssh_login\(serverDraft,\s*form\.credentialRef \|\| "",\s*form\.credentialSecret \|\| "",\s*credentialMetadata\)/);
  assert.match(app, /const credentialMetadata = buildSshCredentialMetadata\(form\)/);
  assert.match(app, /onTestConnection=\{testHostFormConnection\}/);
});

test("NewHostModal can fill connection fields from a pasted ssh command", () => {
  const source = componentSource("NewHostModal", "App");

  assert.match(app, /parseSshCommandToServerForm/);
  assert.match(source, /const \[sshCommandDraft,\s*setSshCommandDraft\] = useState\(""\)/);
  assert.match(source, /function importFromSshCommand\(\)/);
  assert.match(source, /parseSshCommandToServerForm\(sshCommandDraft\)/);
  assert.match(source, /setForm\(\(current\) => \(\{ \.\.\.current,\s*\.\.\.result\.form/);
  assert.match(source, /value=\{sshCommandDraft\}/);
  assert.match(source, /setSshCommandDraft\(event\.target\.value\)/);
  assert.match(source, /或 root@10\.0\.1\.23:22022/);
  assert.match(source, /onClick=\{importFromSshCommand\}/);
  assert.match(source, /从 SSH 命令导入/);
});

test("NewHostModal validates SSH form values before saving or testing", () => {
  const source = componentSource("NewHostModal", "App");
  assert.match(app, /validateServerConnectionForm/);
  assert.match(source, /validateServerConnectionForm\(form,\s*existingNames,\s*initialForm\?\.name\)/);
  assert.match(source, /validateServerConnectionForm\(\{ \.\.\.form,\s*name: form\.name \|\| form\.host \|\| "临时连接" \}/);
  assert.match(source, /setError\(validation\.message\)/);
  assert.ok(source.indexOf("validateServerConnectionForm(form, existingNames, initialForm?.name)") < source.indexOf("onSave(form)"));
});

test("NewHostModal exposes configurable SSH keepalive interval", () => {
  const source = componentSource("NewHostModal", "App");
  assert.match(source, /keepaliveSeconds:\s*"30"/);
  assert.match(source, /value=\{form\.keepaliveSeconds\}/);
  assert.match(source, /updateField\("keepaliveSeconds",\s*event\.target\.value\)/);
  assert.match(app, /function formatServerKeepaliveFormValue\(server\)/);
  assert.match(app, /server\?\.keepaliveSeconds === 0 \? "0" : String\(server\?\.keepaliveSeconds \|\| "30"\)/);
  assert.match(app, /keepaliveSeconds:\s*formatServerKeepaliveFormValue\(server\)/);
  assert.match(app, /keepaliveSeconds:\s*form\.keepaliveSeconds \|\| "30"/);
});

test("host form connection test records diagnostics by draft name", () => {
  const source = app.slice(app.indexOf("async function testHostFormConnection"), app.indexOf("async function copyServerSshCommand"));
  assert.match(source, /const draftName = String\(form\.name \|\| form\.host \|\| ""\)\.trim\(\)/);
  assert.match(source, /const override = buildConnectionOverride\(result, serverDraft\)/);
  assert.match(source, /setConnectionOverrides\(\(current\) => \(\{ \.\.\.current, \[draftName \|\| formWithName\.name\]: override \}\)\)/);
  assert.match(source, /recordSingleConnectionCheck\(draftName \|\| formWithName\.name, result, override\)/);
  assert.ok(source.indexOf("buildConnectionOverride(result, serverDraft)") < source.indexOf("return result"));
});

test("saved server connection test verifies SSH login when auth is available", () => {
  assert.match(app, /hasUsableServerAuth\(server\) && api\?\.test_ssh_login/);
  assert.match(app, /api\.test_ssh_login\(server,\s*server\.credentialRef \|\| ""\)/);
  assert.match(app, /api\.test_ssh_connection\(server\.ip,\s*server\.port \|\| "22"\)/);
});

test("saved server connection test records host key evidence", () => {
  const source = app.slice(app.indexOf("async function testSelectedConnection"), app.indexOf("async function batchTestConnections"));

  assert.match(source, /const hostKey = extractHostKeyFromSshResult\(result\)/);
  assert.match(source, /buildHostKeyEvidenceOverride\(\(connectionOverrides\[targetName\] \|\| server\)\.evidence,\s*hostKey,\s*server\.trustedHostKey\)/);
});

test("SSH host key trust uses the desktop confirmation modal", () => {
  const source = app.slice(app.indexOf("async function trustSelectedHostKey"), app.indexOf("async function testModelConnection"));

  assert.match(source, /buildHostKeyTrustPrompt\(name,\s*hostKey,\s*server\.trustedHostKey\)/);
  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /setPendingConfirmAction\(\{/);
  assert.match(source, /onConfirm:\s*\(\) => confirmTrustSelectedHostKey\(name,\s*hostKey\)/);
  assert.match(source, /async function confirmTrustSelectedHostKey\(name,\s*hostKey\)/);
  assert.match(source, /trustHostKeyForServer\(customServers,\s*name,\s*hostKey\)/);
  assert.match(app, /function DesktopConfirmModal/);
});

test("single server connection test records the latest check result", () => {
  const source = app.slice(app.indexOf("async function testSelectedConnection"), app.indexOf("async function batchTestConnections"));
  assert.match(app, /function recordSingleConnectionCheck\(name, result, override = null\)/);
  assert.match(app, /setLatestConnectionCheck\(\{/);
  assert.match(app, /results:\s*\[\{\s*name:\s*targetName,/);
  assert.match(source, /recordSingleConnectionCheck\(targetName, result, override\)/);
});

test("top SSH menu can batch connect the current server list", () => {
  const topbarSource = componentSource("DesktopTopBar", "Sidebar");
  const batchSource = app.slice(app.indexOf("async function batchOpenSshSessions"), app.indexOf("async function batchTestConnections"));
  const renderSource = app.slice(app.indexOf("<DesktopTopBar"), app.indexOf("<div className=\"workspace-grid\">"));

  assert.match(topbarSource, /label:\s*isBatchConnecting \? "批量连接中\.\.\." : `批量连接当前列表 \(\$\{batchCount\}\)`/);
  assert.match(topbarSource, /onClick:\s*\(\) => onBatchOpenSessions\(visibleServerNames\)/);
  assert.match(topbarSource, /disabled:\s*isBatchConnecting \|\| batchCount === 0/);
  assert.match(batchSource, /setBatchBusy\(\(current\) => \(\{ \.\.\.current,\s*connect:\s*true \}\)\)/);
  assert.match(batchSource, /for \(const name of names \|\| \[\]\)/);
  assert.match(batchSource, /await openSelectedSession\(name\)/);
  assert.match(batchSource, /setBatchBusy\(\(current\) => \(\{ \.\.\.current,\s*connect:\s*false \}\)\)/);
  assert.match(renderSource, /onBatchOpenSessions=\{batchOpenSshSessions\}/);
  assert.match(renderSource, /isBatchConnecting=\{batchBusy\.connect\}/);
});

test("top SSH menu can batch disconnect the current server list", () => {
  const topbarSource = componentSource("DesktopTopBar", "Sidebar");
  const batchSource = app.slice(app.indexOf("async function batchCloseSshSessions"), app.indexOf("async function batchReconnectSshSessions"));
  const renderSource = app.slice(app.indexOf("<DesktopTopBar"), app.indexOf("<div className=\"workspace-grid\">"));

  assert.match(topbarSource, /label:\s*isBatchDisconnecting \? "批量断开中\.\.\." : `批量断开当前列表 \(\$\{batchCount\}\)`/);
  assert.match(topbarSource, /onClick:\s*\(\) => onBatchCloseSessions\(visibleServerNames\)/);
  assert.match(topbarSource, /disabled:\s*isBatchDisconnecting \|\| batchCount === 0/);
  assert.match(batchSource, /setBatchBusy\(\(current\) => \(\{ \.\.\.current,\s*disconnect:\s*true \}\)\)/);
  assert.match(batchSource, /for \(const name of names \|\| \[\]\)/);
  assert.match(batchSource, /await closeSessionByName\(name,\s*"批量断开 SSH 会话",\s*\{ actor: "user" \}\)/);
  assert.match(batchSource, /setBatchBusy\(\(current\) => \(\{ \.\.\.current,\s*disconnect:\s*false \}\)\)/);
  assert.match(renderSource, /onBatchCloseSessions=\{batchCloseSshSessions\}/);
  assert.match(renderSource, /isBatchDisconnecting=\{batchBusy\.disconnect\}/);
});

test("top SSH menu can batch reconnect the current server list", () => {
  const topbarSource = componentSource("DesktopTopBar", "Sidebar");
  const batchSource = app.slice(app.indexOf("async function batchReconnectSshSessions"), app.indexOf("async function batchTestConnections"));
  const renderSource = app.slice(app.indexOf("<DesktopTopBar"), app.indexOf("<div className=\"workspace-grid\">"));

  assert.match(topbarSource, /label:\s*isBatchReconnecting \? "批量重连中\.\.\." : `批量重连当前列表 \(\$\{batchCount\}\)`/);
  assert.match(topbarSource, /onClick:\s*\(\) => onBatchReconnectSessions\(visibleServerNames\)/);
  assert.match(topbarSource, /disabled:\s*isBatchReconnecting \|\| batchCount === 0/);
  assert.match(batchSource, /setBatchBusy\(\(current\) => \(\{ \.\.\.current,\s*reconnect:\s*true \}\)\)/);
  assert.match(batchSource, /for \(const name of names \|\| \[\]\)/);
  assert.match(batchSource, /await reconnectSelectedSession\(name\)/);
  assert.match(batchSource, /setBatchBusy\(\(current\) => \(\{ \.\.\.current,\s*reconnect:\s*false \}\)\)/);
  assert.match(renderSource, /onBatchReconnectSessions=\{batchReconnectSshSessions\}/);
  assert.match(renderSource, /isBatchReconnecting=\{batchBusy\.reconnect\}/);
});

test("batch connection test verifies SSH login for authenticated servers", () => {
  const singleSource = app.slice(app.indexOf("async function testSelectedConnection"), app.indexOf("async function testHostEditorConnection"));
  const batchSource = app.slice(app.indexOf("async function batchTestConnections"), app.indexOf("async function batchReadBasicInfo"));

  assert.match(singleSource, /hasUsableServerAuth\(server\) && api\?\.test_ssh_login/);
  assert.match(singleSource, /api\.test_ssh_login\(server,\s*server\.credentialRef \|\| ""\)/);
  assert.match(singleSource, /api\.test_ssh_connection\(server\.ip \|\| server\.host,\s*server\.port \|\| "22"\)/);
  assert.match(batchSource, /const result = await testSelectedConnection\(name\)/);
});
