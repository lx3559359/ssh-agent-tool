import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = join(projectRoot, "src", "App.jsx");

test("SFTP mutations keep the changed item selected after refresh", () => {
  const app = readFileSync(appPath, "utf8");
  const source = app.slice(app.indexOf("async function refreshSelectedSftp"), app.indexOf("async function openSelectedSession"));

  assert.match(source, /chooseSftpSelectionAfterRefresh/);
  assert.match(source, /async function refreshSelectedSftp\(targetPath = currentSftpPath\(\), preferredSelectionPath = "", serverName = selectedServer\)/);
  assert.match(source, /const name = serverName \|\| selectedServer/);
  assert.match(source, /setSelectedFile\(chooseSftpSelectionAfterRefresh\(result\.items \|\| \[\], preferredSelectionPath\)\)/);
  assert.match(source, /await refreshSelectedSftp\(undefined, result\.remotePath\)/);
  assert.match(source, /await refreshSelectedSftp\(undefined, result\.newPath\)/);
});

test("SFTP upload picks multiple local files and uploads each to the current remote directory", () => {
  const app = readFileSync(appPath, "utf8");
  const uploadSource = app.slice(app.indexOf("async function uploadSelectedSftp"), app.indexOf("async function downloadSelectedSftp"));

  assert.match(uploadSource, /api\?\.pick_upload_files/);
  assert.match(uploadSource, /pickedFiles = await api\.pick_upload_files\(\)/);
  assert.match(uploadSource, /for \(const localPath of pickedFiles\)/);
  assert.match(uploadSource, /api\?\.start_sftp_upload_job/);
  assert.match(uploadSource, /api\.upload_sftp_file\(server,\s*server\.credentialRef,\s*localPath,\s*remoteDirectory\)/);
  assert.match(uploadSource, /上传完成/);
  assert.doesNotMatch(uploadSource, /api\.upload_sftp_file\(server,\s*server\.credentialRef,\s*currentSftpPath\(\)\)/);
});

test("SFTP menu exposes folder upload through the desktop directory picker", () => {
  const app = readFileSync(appPath, "utf8");
  const topbarSource = app.slice(app.indexOf("const sftpTopbarActions"), app.indexOf("const sshTopbarActions"));
  const uploadSource = app.slice(app.indexOf("async function uploadSelectedSftp"), app.indexOf("async function downloadSelectedSftp"));

  assert.match(topbarSource, /上传文件夹/);
  assert.match(topbarSource, /onUploadSftpDirectory/);
  assert.match(uploadSource, /api\?\.pick_upload_directory/);
  assert.match(uploadSource, /const pickedDirectory = await api\.pick_upload_directory\(\)/);
  assert.match(uploadSource, /上传完成：\$\{succeeded\.length\} 个项目/);
});

test("SFTP upload asks before overwriting an existing remote file", () => {
  const app = readFileSync(appPath, "utf8");
  const uploadSource = app.slice(app.indexOf("async function uploadSelectedSftp"), app.indexOf("async function downloadSelectedSftp"));

  assert.match(app, /import \{ buildSftpOverwriteCancelledResult, buildSftpOverwriteConfirmMessage, isSftpOverwriteConflict \} from "\.\/sftpOverwrite\.js";/);
  assert.match(app, /function SftpOverwriteConfirmModal/);
  assert.match(app, /requestSftpOverwriteConfirmation/);
  assert.match(uploadSource, /let result;/);
  assert.match(uploadSource, /api\?\.start_sftp_upload_job/);
  assert.match(uploadSource, /const job = await api\.start_sftp_upload_job\(server,\s*server\.credentialRef,\s*localPath,\s*remoteDirectory\)/);
  assert.match(uploadSource, /result = await api\.upload_sftp_file\(server,\s*server\.credentialRef,\s*localPath,\s*remoteDirectory\)/);
  assert.match(uploadSource, /isSftpOverwriteConflict\(result\)/);
  assert.match(uploadSource, /await requestSftpOverwriteConfirmation\(result,\s*"upload"\)/);
  assert.doesNotMatch(uploadSource, /window\.confirm/);
  assert.match(uploadSource, /api\.start_sftp_upload_job\(server,\s*server\.credentialRef,\s*localPath,\s*remoteDirectory,\s*true\)/);
  assert.match(uploadSource, /api\.upload_sftp_file\(server,\s*server\.credentialRef,\s*localPath,\s*remoteDirectory,\s*true\)/);
  assert.match(uploadSource, /buildSftpOverwriteCancelledResult\(result,\s*"upload"\)/);
  assert.match(uploadSource, /const cancelled = results\.filter\(\(item\) => item\?\.cancelled\)/);
  assert.match(uploadSource, /cancelled\.length && !succeeded\.length && !failed\.length/);
});

test("SFTP upload cancellation records recent operation status and session log", () => {
  const app = readFileSync(appPath, "utf8");
  const uploadSource = app.slice(app.indexOf("async function uploadSelectedSftp"), app.indexOf("async function downloadSelectedSftp"));

  assert.match(uploadSource, /pickedFiles\.length === 0/);
  assert.match(uploadSource, /status:\s*"cancelled"/);
  assert.match(uploadSource, /label:\s*"已取消上传"/);
  assert.match(uploadSource, /writeSessionLogEvent\(\{ type:\s*"sftp_upload_cancelled"/);
  assert.match(uploadSource, /status:\s*"cancelled"/);
  assert.match(uploadSource, /api\.upload_sftp_file/);
  assert.ok(uploadSource.indexOf('status: "cancelled"') < uploadSource.indexOf("api.upload_sftp_file"));
});

test("SFTP recent operation only shows cancel when a transfer job can be cancelled", () => {
  const app = readFileSync(appPath, "utf8");
  const sidebarSource = app.slice(app.indexOf("{recentSftpOperation &&"), app.indexOf("{selectedFile &&"));

  assert.match(sidebarSource, /recentSftpOperation\.status === "running" && recentSftpOperation\.jobId/);
  assert.match(sidebarSource, /onCancelSftpOperation\?\.\(recentSftpOperation\)/);
});

test("SFTP topbar exposes cancel transfer action for the active transfer job", () => {
  const app = readFileSync(appPath, "utf8");
  const topbarSource = app.slice(app.indexOf("function DesktopTopBar"), app.indexOf("function buildModelMessages"));
  const renderSource = app.slice(app.indexOf("<DesktopTopBar"), app.indexOf("<div className={\"workspace-grid"));

  assert.match(topbarSource, /recentSftpOperation,/);
  assert.match(topbarSource, /onCancelSftpOperation,/);
  assert.match(topbarSource, /const hasCancellableSftpTransfer = recentSftpOperation\?\.status === "running" && recentSftpOperation\?\.jobId/);
  assert.match(topbarSource, /label: "取消 SFTP 传输"/);
  assert.match(topbarSource, /onClick: \(\) => onCancelSftpOperation\?\.\(recentSftpOperation\)/);
  assert.match(topbarSource, /disabled: !hasCancellableSftpTransfer/);
  assert.match(renderSource, /recentSftpOperation=\{recentSftpOperations\[selectedServer\]\}/);
  assert.match(renderSource, /onCancelSftpOperation=\{cancelSftpOperation\}/);
});

test("SFTP transfer job polling treats backend error status as a terminal failure", () => {
  const app = readFileSync(appPath, "utf8");
  const source = app.slice(app.indexOf("async function pollSftpTransferJob"), app.indexOf("async function cancelSftpOperation"));

  assert.match(source, /\["success",\s*"failed",\s*"error",\s*"canceled",\s*"missing"\]\.includes\(current\?\.status\)/);
  assert.match(source, /const isError = current\?\.status === "error"/);
  assert.match(source, /status:\s*isCanceled \? "cancelled" : isError \? "failed" : "running"/);
  assert.match(source, /message:\s*isError \? current\?\.error \|\| "传输失败"/);
});

test("SFTP download records recent operation status and session log", () => {
  const app = readFileSync(appPath, "utf8");
  const source = app.slice(app.indexOf("async function downloadSelectedSftp"), app.indexOf("async function previewSelectedSftpFile"));

  assert.match(source, /const remotePath = targetFile\.path \|\| resolveSftpChildPath\(currentSftpPath\(\), targetFile\.name\)/);
  assert.match(source, /setRecentSftpOperations\(\(current\) => \(\{ \.\.\.current, \[selectedServer\]: \{ type: "download", status: "running"/);
  assert.match(source, /status: "success"/);
  assert.match(source, /label: "下载完成"/);
  assert.match(source, /writeSessionLogEvent\(\{ type: "sftp_download", server: selectedServer, command: remotePath, status: "ok"/);
  assert.match(source, /status: "failed"/);
  assert.match(source, /label: "下载失败"/);
  assert.match(source, /writeSessionLogEvent\(\{ type: "sftp_download_failed", server: selectedServer, command: remotePath, status: "failed"/);
});

test("SFTP download allows selected remote folders because backend saves them as zip files", () => {
  const app = readFileSync(appPath, "utf8");
  const topbarSource = app.slice(app.indexOf("const sftpTopbarActions"), app.indexOf("const sshTopbarActions"));
  const sidebarSource = app.slice(app.indexOf('<section className="panel sidebar-section sftp-section"'), app.indexOf('<div className="sftp-path-row">'));
  const source = app.slice(app.indexOf("async function downloadSelectedSftp"), app.indexOf("async function previewSelectedSftpFile"));

  assert.match(topbarSource, /label: "下载文件\/目录"/);
  assert.match(sidebarSource, /aria-label="\\u4e0b\\u8f7d\\u6587\\u4ef6\\u6216\\u76ee\\u5f55"/);
  assert.doesNotMatch(topbarSource, /下载[^}]+selectedFile\?\.type === "folder"/);
  assert.doesNotMatch(sidebarSource, /selectedFile\?\.type === "folder"/);
  assert.doesNotMatch(source, /targetFile\.type === "folder"/);
  assert.match(source, /message: "正在下载"/);
});

test("SFTP download asks before overwriting an existing local file", () => {
  const app = readFileSync(appPath, "utf8");
  const source = app.slice(app.indexOf("async function downloadSelectedSftp"), app.indexOf("async function previewSelectedSftpFile"));

  assert.match(source, /api\?\.start_sftp_download_job/);
  assert.match(source, /result = await api\.download_sftp_file\(server,\s*server\.credentialRef,\s*remotePath\)/);
  assert.match(source, /isSftpOverwriteConflict\(result\)/);
  assert.match(source, /await requestSftpOverwriteConfirmation\(result,\s*"download"\)/);
  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /api\.start_sftp_download_job\(server,\s*server\.credentialRef,\s*remotePath,\s*result\?\.localPath \|\| "",\s*true\)/);
  assert.match(source, /api\.download_sftp_file\(server,\s*server\.credentialRef,\s*remotePath,\s*result\?\.localPath \|\| "",\s*true\)/);
  assert.match(source, /result = buildSftpOverwriteCancelledResult\(result,\s*"download"\)/);
  assert.match(source, /if \(result\?\.cancelled\)/);
  assert.match(source, /type: "sftp_download_cancelled"/);
  assert.match(source, /if \(!result\?\.ok\) throw new Error\(result\?\.message \|\| "下载失败"\)/);
});

test("SFTP overwrite confirmation uses an in-app desktop modal instead of browser confirm", () => {
  const app = readFileSync(appPath, "utf8");
  const modalSource = app.slice(app.indexOf("function SftpOverwriteConfirmModal"), app.indexOf("function SftpDeleteConfirmModal"));
  const renderSource = app.slice(app.indexOf("{sftpNameDialog &&"), app.indexOf("{confirmAction &&"));

  assert.match(modalSource, /aria-label="确认覆盖 SFTP 文件"/);
  assert.match(modalSource, /buildSftpOverwriteConfirmMessage\(dialog\.result,\s*dialog\.type\)/);
  assert.match(modalSource, /覆盖文件/);
  assert.match(modalSource, /取消/);
  assert.match(modalSource, /确认覆盖/);
  assert.match(renderSource, /sftpOverwriteDialog &&/);
  assert.match(renderSource, /<SftpOverwriteConfirmModal/);
  assert.doesNotMatch(app, /window\.confirm/);
});

test("SFTP text save records recent operation status and session log", () => {
  const app = readFileSync(appPath, "utf8");
  const source = app.slice(app.indexOf("async function saveSftpPreviewText"), app.indexOf("async function createSelectedSftpDirectory"));

  assert.match(source, /setRecentSftpOperations\(\(current\) => \(\{ \.\.\.current, \[selectedServer\]: \{ type: "save", status: "running"/);
  assert.match(source, /writeSessionLogEvent\(\{ type: "sftp_save", server: selectedServer, command: remotePath, status: "ok"/);
  assert.match(source, /setRecentSftpOperations\(\(current\) => \(\{ \.\.\.current, \[selectedServer\]: \{ type: "save", status: "success", label: "保存完成"/);
  assert.match(source, /writeSessionLogEvent\(\{ type: "sftp_save_failed", server: selectedServer, command: remotePath, status: "failed"/);
  assert.match(source, /setRecentSftpOperations\(\(current\) => \(\{ \.\.\.current, \[selectedServer\]: \{ type: "save", status: "failed", label: "保存失败"/);
});

test("SFTP text save skips remote writes when the preview content is unchanged", () => {
  const app = readFileSync(appPath, "utf8");
  const source = app.slice(app.indexOf("async function saveSftpPreviewText"), app.indexOf("async function createSelectedSftpDirectory"));

  assert.match(source, /const draftContent = sftpPreviewDraft \?\? sftpPreview\.content \?\? ""/);
  assert.match(source, /if \(draftContent === \(sftpPreview\.content \|\| ""\)\)/);
  assert.match(source, /文件没有修改，无需保存/);
  assert.ok(
    source.indexOf("文件没有修改，无需保存") < source.indexOf("api.write_sftp_text_file"),
    "unchanged preview content should be handled before remote write",
  );
  assert.match(source, /api\.write_sftp_text_file\(server,\s*server\.credentialRef,\s*remotePath,\s*draftContent,/);
});

test("SFTP name form does not submit while IME composition is active", () => {
  const app = readFileSync(appPath, "utf8");
  const start = app.indexOf("function SftpNameModal");
  const end = app.indexOf("function SftpDeleteConfirmModal", start);
  assert.notEqual(start, -1, "SftpNameModal should exist");
  assert.notEqual(end, -1, "SftpDeleteConfirmModal should follow SftpNameModal");
  const source = app.slice(start, end);

  assert.match(app, /function ignoreComposingEnterSubmit\(event\)/);
  assert.match(source, /<form className="settings-modal sftp-name-modal"[\s\S]{0,180}onKeyDown=\{ignoreComposingEnterSubmit\}/);
});

test("SFTP delete records recent operation status and session log", () => {
  const app = readFileSync(appPath, "utf8");
  const source = app.slice(app.indexOf("async function submitSftpDeleteDialog"), app.indexOf("async function restoreSessionWorkingDirectory"));

  assert.match(source, /setSftpBusy\(\(current\) => \(\{ \.\.\.current, \[selectedServer\]: true \}\)\)/);
  assert.match(source, /setRecentSftpOperations\(\(current\) => \(\{ \.\.\.current, \[selectedServer\]: \{ type: "delete", status: "running"/);
  assert.match(source, /writeSessionLogEvent\(\{ type: "sftp_delete", server: selectedServer, command: dialog\.path, status: "ok"/);
  assert.match(source, /setRecentSftpOperations\(\(current\) => \(\{ \.\.\.current, \[selectedServer\]: \{ type: "delete", status: "success", label: "删除完成"/);
  assert.match(source, /writeSessionLogEvent\(\{ type: "sftp_delete_failed", server: selectedServer, command: dialog\.path, status: "failed"/);
  assert.match(source, /finally \{ setSftpBusy\(\(current\) => \(\{ \.\.\.current, \[selectedServer\]: false \}\)\); \}/);
});

test("SFTP auto refreshes once for an authenticated selected server", () => {
  const app = readFileSync(appPath, "utf8");
  assert.match(app, /const autoSftpRefreshRef = useRef\(new Set\(\)\)/);
  assert.match(app, /function autoRefreshSftpForServer\(serverName, options = \{\}\)/);
  assert.match(app, /autoSftpRefreshRef\.current\.has\(serverName\)/);
  assert.match(app, /hasUsableServerAuth\(server\)/);
  assert.match(app, /api\?\.list_sftp_directory/);
  assert.match(app, /autoSftpRefreshRef\.current\.add\(serverName\)/);
  assert.match(app, /void refreshSelectedSftp\(currentSftpPath\(serverName\), "", serverName\)/);
  assert.match(app, /autoRefreshSftpForServer\(selectedServer\)/);
});

test("SFTP sidebar exposes current directory bookmarks and can jump to them", () => {
  const app = readFileSync(appPath, "utf8");

  assert.match(app, /import \{ addSftpBookmark, normalizeSftpBookmarks, removeSftpBookmark \} from "\.\/sftpBookmarks\.js";/);
  assert.match(app, /sftpBookmarks=\{normalizeSftpBookmarks\((?:server\.sftpBookmarks|servers\[selectedServer\]\?\.sftpBookmarks) \|\| \[\]\)\}/);
  assert.match(app, /onAddSftpBookmark=\{addCurrentSftpBookmark\}/);
  assert.match(app, /onOpenSftpBookmark=\{openSftpBookmark\}/);
  assert.match(app, /常用目录/);
  assert.match(app, /收藏当前目录/);
  assert.match(app, /async function openSftpBookmark\(path, serverName = selectedServer\)/);
  assert.match(app, /await refreshSelectedSftp\(path, "", serverName\)/);
});

test("SSH connect success triggers SFTP refresh for the connected server", () => {
  const app = readFileSync(appPath, "utf8");
  const source = app.slice(app.indexOf("async function openSelectedSession"), app.indexOf("async function ensureCommandSession"));
  assert.match(source, /autoRefreshSftpForServer\(name, \{ force: true \}\)/);
  assert.ok(source.indexOf("autoRefreshSftpForServer(name, { force: true })") > source.indexOf("setSshSessions"));
  assert.ok(source.indexOf("autoRefreshSftpForServer(name, { force: true })") < source.indexOf("return result.sessionId"));
});

test("SFTP user-facing notices stay readable Chinese without placeholders", () => {
  const app = readFileSync(appPath, "utf8");
  const source = app.slice(app.indexOf("async function refreshSelectedSftp"), app.indexOf("async function restoreSessionWorkingDirectory"));

  assert.doesNotMatch(source, /\?{3,}/);
  assert.match(source, /当前环境不支持 SFTP 文件功能，请使用正式 exe。/);
  assert.match(source, /请先绑定或填写 SSH 凭据。/);
  assert.match(source, /正在读取/);
  assert.match(source, /目录已刷新/);
  assert.match(source, /上传完成/);
  assert.match(source, /下载成功/);
  assert.match(source, /文件预览已加载/);
  assert.match(source, /文件已保存/);
  assert.match(source, /新建目录/);
  assert.match(source, /新建文件/);
  assert.match(source, /重命名/);
  assert.match(source, /删除成功/);
});
