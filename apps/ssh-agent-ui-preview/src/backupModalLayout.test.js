import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = join(projectRoot, "src", "App.jsx");

test("backup export modal keeps export actions only in backup center cards", () => {
  const app = readFileSync(appPath, "utf8");
  const modalSource = app.slice(app.indexOf("function BackupExportModal"), app.indexOf("function BackupImportModal"));

  assert.equal(count(modalSource, "onClick={exportBackup}"), 0);
  assert.equal(count(modalSource, "onClick={exportInventoryCsv}"), 0);
  assert.equal(count(modalSource, "onClick={exportOpenSshConfig}"), 0);
  assert.match(modalSource, /card\.id === "backup-json" \? exportBackup/);
  assert.match(modalSource, /card\.id === "inventory-csv" \? exportInventoryCsv/);
  assert.match(modalSource, /: exportOpenSshConfig/);
});

test("backup export prefers desktop backup file API when available", () => {
  const app = readFileSync(appPath, "utf8");
  const modalSource = app.slice(app.indexOf("function BackupExportModal"), app.indexOf("function BackupImportModal"));

  assert.match(modalSource, /api\?\.export_backup_file/);
  assert.match(modalSource, /exportResult = await api\.export_backup_file\(/);
  assert.match(modalSource, /buildBackupHistoryEntry\(\{ payload: exportedPayload[\s\S]*exportResult/);
  assert.match(modalSource, /api\?\.save_text_file/);
});

test("backup history shows exported file sha256 when available", () => {
  const app = readFileSync(appPath, "utf8");
  const modalSource = app.slice(app.indexOf("function BackupExportModal"), app.indexOf("function BackupImportModal"));

  assert.match(modalSource, /item\.sha256/);
  assert.match(modalSource, /item\.sha256\.slice\(0,\s*12\)/);
  assert.match(modalSource, /SHA256/);
});

test("backup export requires confirming the master password before encrypted secret export", () => {
  const app = readFileSync(appPath, "utf8");
  const modalSource = app.slice(app.indexOf("function BackupExportModal"), app.indexOf("function BackupImportModal"));

  assert.match(modalSource, /masterPasswordConfirm,\s*setMasterPasswordConfirm/);
  assert.match(modalSource, /validateBackupMasterPassword\(masterPassword,\s*masterPasswordConfirm,\s*includeSecrets\)/);
  assert.match(modalSource, /placeholder="确认备份主密码"/);
});

test("backup import prefers desktop backup file API when available", () => {
  const app = readFileSync(appPath, "utf8");
  const importSource = app.slice(app.indexOf("async function importBackup"), app.indexOf("async function applyBackupImport"));

  assert.match(importSource, /api\?\.pick_backup_file/);
  assert.match(importSource, /api\?\.open_backup_file/);
  assert.match(importSource, /await api\.open_backup_file\(pickedPath\)/);
  assert.match(importSource, /pickTextFileFromBrowser/);
});

test("app defines backup and ssh config import callbacks used by top toolbar", () => {
  const app = readFileSync(appPath, "utf8");

  assert.match(app, /async function importBackup\(/);
  assert.match(app, /async function applyBackupImport\(/);
  assert.match(app, /async function confirmBackupImport\(/);
  assert.match(app, /async function importSshConfig\(/);
  assert.match(app, /function recordBackupExport\(/);
});

test("import followup actions target ready servers and expose credential repair", () => {
  const app = readFileSync(appPath, "utf8");
  const sidebarSource = app.slice(app.indexOf("function Sidebar"), app.indexOf("function PlanCard"));

  assert.match(sidebarSource, /const followupReadyNames =/);
  assert.match(sidebarSource, /onBatchTestConnections\(followupReadyNames\)/);
  assert.match(sidebarSource, /onBatchReadBasicInfo\(followupReadyNames\)/);
  assert.match(sidebarSource, /onQueueBatchAgent\(followupReadyNames\)/);
  assert.match(sidebarSource, /补录凭据 \/ 认证中心/);
  assert.match(sidebarSource, /onOpenAuthCenter\(\)/);
});

test("backup import empty-target notices mention every supported import type", () => {
  const app = readFileSync(appPath, "utf8");
  const importSource = app.slice(app.indexOf("async function importBackup"), app.indexOf("async function confirmBackupImport"));
  const confirmSource = app.slice(app.indexOf("async function confirmBackupImport"), app.indexOf("function handleSshConfigImportPreviewConfirm"));

  assert.match(importSource, /服务器、Agent 能力、端口转发预设、命令片段或模型 API 档案/);
  assert.match(confirmSource, /服务器、Agent 能力、端口转发预设、命令片段或模型 API 档案/);
});

function count(text, pattern) {
  return text.split(pattern).length - 1;
}
