import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function mainAppWindowsClientActionsSource() {
  const start = app.indexOf("async function exportDiagnosticPackage()");
  const end = app.indexOf("async function exportSessionLogs()", start);
  assert.notEqual(start, -1, "exportDiagnosticPackage should exist before Windows client helpers");
  assert.notEqual(end, -1, "exportSessionLogs should follow Windows client helpers");
  return app.slice(start, end);
}

test("main app Windows client helpers use relevant Chinese fallback notices", () => {
  const source = mainAppWindowsClientActionsSource();

  assert.match(source, /async function createDesktopShortcut\(\)/);
  assert.match(source, /showNotice\(result\?\.message \|\| "桌面快捷方式已创建。"\)/);
  assert.match(source, /async function createStartMenuShortcut\(\)/);
  assert.match(source, /showNotice\(result\?\.message \|\| "开始菜单快捷方式已创建。"\)/);
  assert.match(source, /async function openInstallDirectory\(\)/);
  assert.match(source, /showNotice\(result\?\.message \|\| "安装目录已打开。"\)/);
  assert.match(source, /async function openAppDataDirectory\(\)/);
  assert.match(source, /showNotice\(result\?\.message \|\| "数据目录已打开。"\)/);
  assert.doesNotMatch(source, /请选择一行终端输出/);
  assert.doesNotMatch(source, /没有可用的终端内容/);
});

test("diagnostic package export copies the generated package path for sharing", () => {
  const source = mainAppWindowsClientActionsSource();
  const exportSource = source.slice(source.indexOf("async function exportDiagnosticPackage"), source.indexOf("async function createDesktopShortcut"));

  assert.match(exportSource, /const result = await api\.export_diagnostic_package\(\)/);
  assert.match(exportSource, /const diagnosticPackagePath = String\(result\?\.path \|\| ""\)\.trim\(\)/);
  assert.match(exportSource, /await navigator\.clipboard\.writeText\(diagnosticPackagePath\)/);
  assert.match(exportSource, /formatDiagnosticPackageNotice\(result,\s*\{ copiedPath \}\)/);
  assert.match(app, /\u8def\u5f84\u5df2\u590d\u5236/);
});
