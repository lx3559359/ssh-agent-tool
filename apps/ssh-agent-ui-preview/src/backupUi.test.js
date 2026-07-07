import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = join(projectRoot, "src", "App.jsx");

function appSource() {
  return readFileSync(appPath, "utf8");
}

function backupExportModalSource() {
  const app = appSource();
  return app.slice(app.indexOf("function BackupExportModal"), app.indexOf("function BackupImportModal"));
}

test("backup export modal shows credential coverage before exporting", () => {
  const modalSource = backupExportModalSource();

  assert.match(modalSource, /const credentialMatrix = buildBackupCredentialMatrix\(servers,\s*\{ includeSecrets \}\)/);
  assert.match(modalSource, /buildBackupCredentialChecklistText\(servers,\s*\{ includeSecrets/);
  assert.match(modalSource, /backup-credential-matrix/);
  assert.match(modalSource, /凭据覆盖/);
  assert.match(modalSource, /复制凭据清单/);
  assert.match(modalSource, /credentialMatrix\.summary\.encryptedReady/);
  assert.match(modalSource, /credentialMatrix\.rows\.slice\(0,\s*6\)\.map/);
  assert.match(modalSource, /row\.restoreMode/);
  assert.match(modalSource, /row\.manualAction/);
  assert.match(modalSource, /row\.tone/);
});
