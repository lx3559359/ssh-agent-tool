import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexHtmlPath = join(projectRoot, "index.html");

test("Windows client HTML title uses formal desktop wording", () => {
  const source = readFileSync(indexHtmlPath, "utf8");

  assert.match(source, /<title>SSH Agent 工具<\/title>/);
  assert.doesNotMatch(source, /预览|Preview|试用|trial/i);
});
