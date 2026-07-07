import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = app.indexOf(`async function ${name}`);
  const end = app.indexOf(`async function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return app.slice(start, end);
}

test("terminal PTY resize failures are recorded in tool logs for diagnostics", () => {
  const source = functionSource("resizeSelectedSession", "sendSelectedSessionInput");

  assert.match(source, /const result = await safeFileApi\(\)\?\.resize_ssh_session\?\.\(session\.sessionId,\s*cols,\s*rows\)/);
  assert.match(source, /if \(!result\?\.ok\)/);
  assert.match(source, /writeToolLogEvent\(\{/);
  assert.match(source, /component:\s*"ssh"/);
  assert.match(source, /action:\s*"resize_session"/);
  assert.match(source, /sessionId:\s*session\.sessionId/);
  assert.match(source, /cols/);
  assert.match(source, /rows/);
  assert.match(source, /catch \(error\)/);
  assert.match(source, /String\(error\?\.message \|\| error \|\| "resize failed"\)/);
});
