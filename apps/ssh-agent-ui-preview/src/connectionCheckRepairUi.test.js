import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = join(projectRoot, "src", "App.jsx");

test("top toolbar renders latest connection check repair actions", () => {
  const app = readFileSync(appPath, "utf8");
  const topbarSource = app.slice(app.indexOf("function DesktopTopBar"), app.indexOf("function buildModelMessages"));

  assert.match(topbarSource, /connectionCheckRepairPlan/);
  assert.match(topbarSource, /buildConnectionCheckRepairPlan/);
  assert.match(topbarSource, /connectionCheckRepairPlan\.primaryActions\.map/);
  assert.match(topbarSource, /onRunConnectionCheckRepair\(connectionCheckRepairPlan\.rows\[0\], action\)/);
  assert.match(app, /onRunConnectionCheckRepair=\{runConnectionCheckRepair\}/);
});

test("connection check repair dispatcher selects server before running action", () => {
  const app = readFileSync(appPath, "utf8");
  const source = app.slice(app.indexOf("function runConnectionCheckRepair"), app.indexOf("function runConnectionQuickFix"));

  assert.match(source, /selectServerTab\(row\?\.name\)/);
  assert.match(source, /runConnectionQuickFix\(action, row\?\.name\)/);
});
