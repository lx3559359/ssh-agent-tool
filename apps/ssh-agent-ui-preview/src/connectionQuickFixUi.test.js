import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = join(projectRoot, "src", "App.jsx");

test("server diagnostics expose quick fix actions", () => {
  const app = readFileSync(appPath, "utf8");
  const topbarSource = app.slice(app.indexOf("function DesktopTopBar"), app.indexOf("function buildModelMessages"));

  assert.match(topbarSource, /buildConnectionQuickFixActions/);
  assert.match(topbarSource, /sshQuickFixActions\.map/);
  assert.match(topbarSource, /onRunConnectionQuickFix\(action\)/);
  assert.match(app, /onRunConnectionQuickFix=\{runConnectionQuickFix\}/);
});

test("terminal workspace exposes connection failure repair actions", () => {
  const app = readFileSync(appPath, "utf8");
  const terminalSource = app.slice(app.indexOf("function TerminalWorkspace"), app.indexOf("function LegacyAgentPanel"));

  assert.match(terminalSource, /buildConnectionQuickFixActions\(server\?\.sshDiagnostics,\s*server\)/);
  assert.match(terminalSource, /terminalConnectionQuickFixActions\.length > 0/);
  assert.match(terminalSource, /className="terminal-connection-repair"/);
  assert.match(terminalSource, /terminalConnectionQuickFixActions\.map/);
  assert.match(terminalSource, /onRunConnectionQuickFix\(action\)/);
  assert.match(app, /onRunConnectionQuickFix=\{runConnectionQuickFix\}/);
});

test("quick fix dispatcher opens the right repair surfaces", () => {
  const app = readFileSync(appPath, "utf8");
  const source = app.slice(app.indexOf("function runConnectionQuickFix"), app.indexOf("async function testSelectedConnection"));

  assert.match(source, /case "auth-center"/);
  assert.match(source, /setAuthCenterOpen\(true\)/);
  assert.match(source, /case "server-editor"/);
  assert.match(source, /openEditHost\(name\)/);
  assert.match(source, /case "host-key-trust"/);
  assert.match(source, /trustSelectedHostKey\(name\)/);
  assert.match(source, /case "connection-test"/);
  assert.match(source, /testSelectedConnection\(name\)/);
  assert.match(source, /case "agent-diagnostic"/);
  assert.match(source, /queueSelectedSshDiagnostic\(name\)/);
  assert.match(source, /case "tool-logs"/);
  assert.match(source, /openToolLogs\(\)/);
  assert.match(source, /case "diagnostic-package"/);
  assert.match(source, /exportDiagnosticPackage\(\)/);
});
