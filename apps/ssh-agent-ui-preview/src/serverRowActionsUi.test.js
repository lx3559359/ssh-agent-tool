import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function componentSource(name, nextName) {
  const start = app.indexOf(`function ${name}`);
  const end = nextName ? app.indexOf(`function ${nextName}`, start) : app.length;
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should exist after ${name}`);
  return app.slice(start, end);
}

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escaped}\\s*\\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${selector} rule should exist`);
  return match[0];
}

test("server rows expose a visible compact action menu for edit delete and export", () => {
  const source = componentSource("Sidebar", "TerminalWorkspace");
  const rowRule = cssRule(".server-row");
  const menuRule = cssRule(".server-row-menu");

  assert.match(app, /MoreHorizontal/);
  assert.match(rowRule, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+26px\s+26px/);
  assert.match(source, /className="server-row-menu"/);
  assert.ok(source.includes('aria-label={`${name} \\u64cd\\u4f5c`}'));
  assert.ok(source.includes('title="\\u670d\\u52a1\\u5668\\u64cd\\u4f5c"'));
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /onOpenServerContextMenu\(event,\s*name\)/);
  assert.match(menuRule, /width:\s*24px/);
  assert.match(menuRule, /height:\s*24px/);
  assert.match(menuRule, /place-items:\s*center/);
});

test("server context actions switch the active server before opening terminal or SFTP", () => {
  const source = app.slice(
    app.indexOf("function openServerContextMenu"),
    app.indexOf("function openSftpContextMenu"),
  );

  assert.match(source, /connect:\s*\(\)\s*=>\s*\{\s*setSelectedServer\(targetName\);\s*return openSelectedSession\(targetName\);?\s*\}/);
  assert.match(source, /"open-sftp":\s*\(\)\s*=>\s*\{\s*setSelectedServer\(targetName\);\s*return refreshSelectedSftp\(currentSftpPath\(targetName\),\s*"",\s*targetName\);?\s*\}/);
  assert.match(source, /"refresh-sftp":\s*\(\)\s*=>\s*\{\s*setSelectedServer\(targetName\);\s*return refreshSelectedSftp\(currentSftpPath\(targetName\),\s*"",\s*targetName\);?\s*\}/);
  assert.match(source, /"upload-sftp":\s*\(\)\s*=>\s*\{\s*setSelectedServer\(targetName\);\s*return uploadSelectedSftp\(targetName\);?\s*\}/);
});

test("server context actions switch active server before opening target-specific tools", () => {
  const source = app.slice(
    app.indexOf("function openServerContextMenu"),
    app.indexOf("function openSftpContextMenu"),
  );

  assert.match(source, /test:\s*\(\)\s*=>\s*\{\s*setSelectedServer\(targetName\);\s*return testSelectedConnection\(targetName\);?\s*\}/);
  assert.match(source, /basic:\s*\(\)\s*=>\s*\{\s*setSelectedServer\(targetName\);\s*return readSelectedBasicInfo\(targetName\);?\s*\}/);
  assert.match(source, /"server-auth-center":\s*\(\)\s*=>\s*\{\s*setSelectedServer\(targetName\);\s*return openAuthCenter\(targetName\);?\s*\}/);
  assert.match(source, /"edit":\s*\(\)\s*=>\s*\{\s*setSelectedServer\(targetName\);\s*return openEditHost\(targetName\);?\s*\}/);
  assert.match(source, /"duplicate-server-as-new-host":\s*\(\)\s*=>\s*\{\s*setSelectedServer\(targetName\);\s*return openNewHost\(\{ \.\.\.serverToHostForm\(targetName,\s*server\),\s*name:\s*buildDuplicateServerName\(targetName,\s*servers\) \}\);?\s*\}/);
  assert.match(source, /"export":\s*\(\)\s*=>\s*\{\s*setSelectedServer\(targetName\);\s*return exportServerProfile\(targetName\);?\s*\}/);
  assert.match(source, /"backup-server":\s*\(\)\s*=>\s*\{\s*setSelectedServer\(targetName\);\s*return openServerBackup\(targetName\);?\s*\}/);
});

test("server context diagnostics switch active server before opening logs or diagnostic export", () => {
  const source = app.slice(
    app.indexOf("function openServerContextMenu"),
    app.indexOf("function openSftpContextMenu"),
  );

  assert.match(source, /"server-session-logs":\s*\(\)\s*=>\s*\{\s*setSelectedServer\(targetName\);\s*return openSessionLogs\(\{ server:\s*targetName \}\);?\s*\}/);
  assert.match(source, /"server-tool-logs":\s*\(\)\s*=>\s*\{\s*setSelectedServer\(targetName\);\s*return openToolLogs\(\{ query:\s*targetName \}\);?\s*\}/);
  assert.match(source, /"server-diagnostic-package":\s*\(\)\s*=>\s*\{\s*setSelectedServer\(targetName\);\s*return exportDiagnosticPackage\(\);?\s*\}/);
});

test("server context session controls switch active server before controlling SSH", () => {
  const source = app.slice(
    app.indexOf("function openServerContextMenu"),
    app.indexOf("function openSftpContextMenu"),
  );

  assert.match(source, /"interrupt-server-command":\s*\(\)\s*=>\s*\{\s*setSelectedServer\(targetName\);\s*return sendTerminalControlSignal\("interrupt",\s*targetName\);?\s*\}/);
  assert.match(source, /"reconnect-server-session":\s*\(\)\s*=>\s*\{\s*setSelectedServer\(targetName\);\s*return reconnectSelectedSession\(targetName\);?\s*\}/);
  assert.match(source, /"disconnect-server-session":\s*\(\)\s*=>\s*\{\s*setSelectedServer\(targetName\);\s*return closeSelectedSession\(targetName\);?\s*\}/);
});

test("server context state changes switch active server before pinning or deleting", () => {
  const source = app.slice(
    app.indexOf("function openServerContextMenu"),
    app.indexOf("function openSftpContextMenu"),
  );

  assert.match(source, /"toggle-server-favorite":\s*\(\)\s*=>\s*\{\s*setSelectedServer\(targetName\);\s*return toggleServerFavorite\(targetName,\s*!Boolean\(servers\[targetName\]\?\.isFavorite\)\);?\s*\}/);
  assert.match(source, /"delete":\s*\(\)\s*=>\s*\{\s*setSelectedServer\(targetName\);\s*return customServers\[targetName\]\s*\?\s*deleteSelectedHost\(targetName\)\s*:\s*hideBuiltinServer\(targetName\);?\s*\}/);
});

test("server management changes are written to safe tool logs", () => {
  const helperSource = app.slice(app.indexOf("function writeServerManagementLog"), app.indexOf("async function saveNewHost"));
  const newSource = app.slice(app.indexOf("async function saveNewHost"), app.indexOf("async function saveEditedHost"));
  const editSource = app.slice(app.indexOf("async function saveEditedHost"), app.indexOf("async function autoTestSavedHostConnection"));
  const deleteSource = app.slice(app.indexOf("async function confirmDeleteSelectedHost"), app.indexOf("async function closeRemovedServerSession"));
  const hideSource = app.slice(app.indexOf("async function hideBuiltinServer"), app.indexOf("function openServerBackup"));

  assert.match(helperSource, /function writeServerManagementLog\(action,\s*serverName,\s*server,\s*extra = \{\}\)/);
  assert.match(helperSource, /component:\s*"server-management"/);
  assert.match(helperSource, /action/);
  assert.match(helperSource, /serverName/);
  assert.match(helperSource, /host:\s*server\?\.ip \|\| server\?\.host \|\| ""/);
  assert.match(helperSource, /port:\s*server\?\.port \|\| "22"/);
  assert.match(helperSource, /user:\s*server\?\.user \|\| ""/);
  assert.match(helperSource, /authType:\s*server\?\.authType \|\| ""/);
  assert.match(helperSource, /group:\s*server\?\.group \|\| ""/);
  assert.doesNotMatch(helperSource, /credentialSecret|password|apiKey|token|credentialRef|identityFile/);

  assert.match(newSource, /writeServerManagementLog\("create_server",\s*result\.name,\s*result\.servers\[result\.name\]/);
  assert.match(editSource, /writeServerManagementLog\("edit_server",\s*result\.name,\s*result\.servers\[result\.name\]/);
  assert.match(deleteSource, /writeServerManagementLog\("delete_server",\s*name,\s*deletedServer/);
  assert.match(hideSource, /writeServerManagementLog\("hide_builtin_server",\s*name,\s*servers\[name\]/);
});
