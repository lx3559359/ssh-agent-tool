import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = join(projectRoot, "src", "App.jsx");

test("trusting a host key requires the desktop confirmation prompt", () => {
  const app = readFileSync(appPath, "utf8");
  const importLine = app.slice(0, app.indexOf("function Sidebar"));
  const trustSource = app.slice(app.indexOf("async function trustSelectedHostKey"), app.indexOf("async function testModelConnection"));

  assert.match(importLine, /buildHostKeyTrustPrompt/);
  assert.match(trustSource, /const trustPrompt = buildHostKeyTrustPrompt\(name, hostKey, server\.trustedHostKey\)/);
  assert.match(trustSource, /if \(!trustPrompt\.canTrust\)/);
  assert.doesNotMatch(trustSource, /window\.confirm/);
  assert.match(trustSource, /setPendingConfirmAction\(\{/);
  assert.match(trustSource, /message:\s*trustPrompt\.message/);
  assert.match(trustSource, /onConfirm:\s*\(\) => confirmTrustSelectedHostKey\(name,\s*hostKey\)/);
  assert.match(trustSource, /showNotice\(trustPrompt\.message\)/);
});

test("trusted host keys can be revoked from the Agent header with confirmation", () => {
  const app = readFileSync(appPath, "utf8");
  const importLine = app.slice(0, app.indexOf("function Sidebar"));
  const panelSource = app.slice(app.indexOf("function AgentPanel"), app.indexOf("function PlanCard"));
  const revokeSource = app.slice(app.indexOf("async function revokeSelectedHostKeyTrust"), app.indexOf("async function testModelConnection"));

  assert.match(importLine, /revokeHostKeyTrustForServer/);
  assert.match(panelSource, /server\?\.trustedHostKey\?\.sha256/);
  assert.match(panelSource, /aria-label="取消信任主机密钥"/);
  assert.match(panelSource, /onClick=\{\(\) => onRevokeHostKeyTrust\?\.\(selectedServer\)\}/);
  assert.match(revokeSource, /setPendingConfirmAction\(\{/);
  assert.match(revokeSource, /confirmLabel:\s*"取消信任"/);
  assert.match(revokeSource, /onConfirm:\s*\(\) => confirmRevokeSelectedHostKeyTrust\(name\)/);
  assert.match(revokeSource, /revokeHostKeyTrustForServer\(customServers,\s*name\)/);
  assert.doesNotMatch(revokeSource, /window\.confirm/);
});
